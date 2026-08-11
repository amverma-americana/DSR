# DSR & Resource Management System — Database Design Document

**Source BRD:** `DSR_Resource_Management_System_BRD_v2.docx` (cross-checked against `_v3.pdf` found in the same folder)
**Target platform:** SQL Server 2019+ · **Version:** 1.0 · **Status:** deployed and verified on SQL Server 2025 (LocalDB)

**Deliverables**

| File | Contents |
|---|---|
| `DSR_Schema_DDL.sql` | Database, schema, 13 tables, all constraints |
| `DSR_Indexes_Views_Triggers.sql` | 27 indexes, 4 views, 2 TVFs, 4 triggers (idempotent, re-runnable) |
| `DSR_Seed_SampleData.sql` | Part 1 seed (all environments) + Part 2 sample data (DEV/QA, switch-guarded) |
| `DSR_Database_Design_Document.md` | This document — Sections 1–9 |

**Verification performed:** clean deploy from an empty instance, all three scripts, zero errors. All six BRD reports return correct data. 10 of 10 negative constraint tests blocked as designed. Index script proven re-runnable.

---

# BRD CHALLENGE — read before the schema

Five findings materially affect the design. Items 1 and 2 are contradictions **inside** the BRD, not preferences.

### C1. BRD v2 contradicts itself on the DSR grain — and v3 corrects it

| Location in BRD v2 | Statement | Implied model |
|---|---|---|
| *DSR Business Flow* | "An employee can create multiple DSR entries on the same day. Each DSR entry is linked to one project only." | **Flat** — one row per employee/date/project |
| *Validation Rules* | "**One DSR per employee per day.**" | Single row per day — contradicts the above |
| *Database Entities* | "Users, Roles, UserRoles, Projects, DSR, **DSRTask**" | **Header/detail** — DSR parent + task children |
| *Recommended Database Structure* | "DSR stores daily submission information. DSRTask stores project-specific work entries" | **Header/detail** |

`DSR_Resource_Management_System_BRD_v3.pdf`, sitting in the same folder under the heading **"Corrected DSR Requirement"**, resolves this: entities are *"Users, Roles, UserRoles, Projects, DSR"* — DSRTask is gone — and *"Each DSR record stores a single project work entry."*

**Resolution adopted:** the flat model. Three independent sources agree — v2's own Business Flow paragraph, v3's correction, and the build instruction. `DSREntries` is a single table with no child. The "One DSR per employee per day" rule is implemented as **one entry per employee per date per project** (`UQ_DSREntries_User_Date_Project_Active`), which is the only reading that does not contradict "multiple DSR entries on the same day".

> **Confirm:** v2 is the attached document but v3 is the corrected one. Please confirm v3 supersedes v2, so the requirement baseline is unambiguous.

### C2. AI usage is day-grained but the DSR row is project-grained

BRD v2 lists AI Used Today / AI Tool Name / AI Usage Remarks under **"DSR Header Fields"** — one declaration per day. BRD v3 lists them among flat DSR fields. In a flat model those two readings diverge:

Storing AI columns on `DSREntries` makes them functionally dependent on `(UserId, WorkDate)` — a *subset* of that table's candidate key `(UserId, WorkDate, ProjectId)`. That is a partial dependency, it breaks 2NF (and therefore the ≥3NF requirement), and it permits genuinely contradictory data: the Project A row says AI = Yes while the Project B row for the same day says AI = No.

**Resolution adopted:** `DailyAiUsage`, keyed `UNIQUE (UserId, WorkDate)`. One declaration per employee per day, contradiction impossible by construction, and the adoption percentage needs no `DISTINCT`.

This is **not** a DSR master table. `DSREntries` has no foreign key to it; they are joined on `(UserId, WorkDate)` for reporting only. The instruction not to build a DSR header/detail pair is fully respected.

> **Fallback if you prefer strict v3 literalism:** move `IsAiUsed`, `AiToolId`, `UsageRemarks` onto `DSREntries`, drop `DailyAiUsage`, and add a trigger to stop same-day rows disagreeing. You gain one join; you lose the guarantee. Section 9, note N6.

### C3. Requirements present in the build instruction but absent from the BRD

"Employee Resource Tracking" and "Resource Utilization Report" are named, but the BRD never states **what utilization is measured against**. Hours logged alone is effort, not utilization — a percentage needs a denominator.

**Resolution adopted:** `ProjectAllocations` (who is assigned to which project, at what percentage, over which window) plus `Users.StandardDailyHours`. Utilization then = logged hours ÷ (working days × standard daily hours). `fn_GetResourceUtilization` implements it.

> **Confirm:** is planned allocation captured anywhere today, or is utilization intended purely as hours-vs-standard-day?

### C4. "Missing DSRs" is unimplementable as specified

The Manager Dashboard requires a missing-DSR metric. Detecting a *missing* record requires knowing which dates were *expected* — otherwise every weekend, public holiday and pre-joining date is reported as a compliance failure.

**Resolution adopted:** `Holidays` table + weekend derivation + `Users.DateOfJoining` / `DateOfExit` boundaries, wrapped in `fn_GetMissingDsrDays`. Verified: it correctly excludes 8–9 Aug 2026 (weekend) from the 3–11 Aug window.

> **Confirm:** is the working week Mon–Fri organisation-wide? Are holidays location-specific (the design assumes one shared calendar)?

### C5. Gaps to note

| Gap | Consequence | Handling |
|---|---|---|
| **No approval or lock workflow.** Manager only "views" reports. | An employee can silently edit a DSR after a report was signed off. | `AppSettings` key `DSR.BackDateWindowDays` (default 7) + `AuditLog`. A real approval workflow is Section 9, R2. |
| **One AI tool per day.** BRD says "AI Tool Name", singular. | An employee using Copilot *and* Claude records only one. | Implemented as-specified. Migration path in Section 9, R3. |
| **No department or business unit.** | Utilization cannot roll up beyond a single manager's direct reports. | Deliberately **not** built — no BRD mention, and the instruction says avoid unnecessary tables. Section 9, R4. |
| **Nothing said about time zone.** | "Future dates not allowed" is ambiguous for distributed teams. | All storage UTC; `CHECK` uses server UTC. Application must re-validate in the user's zone. Risk R6. |
| **"Estimated Hours" is the only effort field.** | Utilization is built on estimates, not actuals. | Named as in the BRD. Flagged — see Section 9, R5. |
| **Rich-text description is unbounded and unsanitised.** | Stored-XSS risk on dashboards. | Two columns: `WorkDescriptionHtml` (as authored) + `WorkDescriptionPlain` (for search/export). Sanitisation is an application obligation — Section 9, S3. |

---

# Section 1 — Assumptions

| # | Assumption | Basis | Risk if wrong |
|---|---|---|---|
| A-01 | The flat DSR model is correct; `DSRTask` is not built. | BRD v2 Business Flow + BRD v3 correction + build instruction 6. | Rework of the core table. **Highest-impact assumption.** |
| A-02 | "One DSR per employee per day" means one entry per employee per date **per project**. | Only reading compatible with "multiple entries on the same day". | If multiple entries per project per day are valid, drop one index (see Section 7). |
| A-03 | AI usage is declared once per employee per day. | BRD v2 "DSR Header Fields". | If per-project, move three columns onto `DSREntries`. |
| A-04 | An employee has exactly one line manager. | "Manager: View team reports"; no matrix structure described. | Matrix reporting needs a `UserManagers` junction. |
| A-05 | Employees are Users; there is no separate Employee entity. | BRD entity list. | — |
| A-06 | A user may hold multiple roles simultaneously. | `UserRoles` is specified as a junction. | — |
| A-07 | Project status is a fixed five-value set, not admin-maintained. | BRD lists "Status" with no maintenance screen. | Convert `CHECK` to a lookup table (Section 9, N2). |
| A-08 | AI tool names are a controlled master list, not free text. | Required for "AI adoption metrics" to aggregate. | Free text makes the AI report unusable. |
| A-09 | Working week is Mon–Fri; one shared holiday calendar. | Not stated. | Location-specific calendars need `Holidays.LocationId`. |
| A-10 | `EstimatedHours` is the effort measure for all reporting. | Only effort field in the BRD. | An `ActualHours` column is additive, not breaking. |
| A-11 | Effort may be logged only against ACTIVE or COMPLETED projects. | Inferred; PLANNED/ON_HOLD/CANCELLED blocked. | Single status list in `trg_DSREntries_ProjectWindow`. |
| A-12 | All timestamps stored UTC; presentation tier converts. | Enterprise standard; BRD silent. | — |
| A-13 | Soft delete (`IsActive`) organisation-wide; no hard deletes. | Build instruction 7. | Drives filtered unique indexes. |
| A-14 | Rich-text descriptions are sanitised HTML, ≤ a few KB. | "Rich Text Description". | `NVARCHAR(MAX)` accommodates any size. |
| A-15 | Passwords use ASP.NET Core `PasswordHasher` (PBKDF2, base64). | "ASP.NET Core Enterprise Application". | Argon2/bcrypt fit the same column. |
| A-16 | SSO is Microsoft Entra ID; users are matched on `oid`, not email. | BRD names Entra ID/Azure AD. | Email-matching is a known account-takeover vector — see S1. |
| A-17 | Single-currency, single-tenant deployment. | No multi-tenancy in the BRD. | Multi-tenancy is a schema-wide change. |
| A-18 | Reporting runs against the OLTP database initially. | No warehouse mentioned. | Covered by covering indexes; see Section 9, P3. |

---

# Section 2 — Entity List

**13 tables in 4 groups.** Every table carries `Id INT IDENTITY(1,1)` (two exceptions justified) and the five audit columns.

## Group A — Identity & Access (5)

| # | Table | Grain | Purpose | Key columns |
|---|---|---|---|---|
| 1 | **Users** | 1 per person | Employees, managers, admins. Actor for every audited action. Created first: every other table's audit FK points here. | `EmployeeCode`, `Email`, `AuthenticationType`, `ExternalObjectId`, `ManagerUserId`, `StandardDailyHours`, `IsServiceAccount` |
| 2 | **Roles** | 1 per role | EMPLOYEE / MANAGER / ADMIN. `IsSystemRole` protects the three built-ins. | `RoleCode`, `RoleName` |
| 3 | **UserRoles** | 1 per user×role | Resolves M:N. A Manager who files their own DSRs holds both roles. | `UserId`, `RoleId` |
| 4 | **UserCredentials** | 0..1 per user | **Database-login only.** Split 1:1 from Users so SSO-only users carry no NULL password columns, the hash is separately grantable, and lockout counters don't touch the hot Users row. | `PasswordHash`, `SecurityStamp`, `FailedLoginAttempts`, `LockoutEndDate` |
| 5 | **UserLoginAudit** | 1 per attempt | Both auth paths, including failures for unknown emails (`UserId` NULL). Append-only. | `AttemptedEmail`, `AuthenticationType`, `IsSuccessful`, `IpAddress` |

## Group B — Master & Configuration (4)

| # | Table | Grain | Purpose | Key columns |
|---|---|---|---|---|
| 6 | **Projects** | 1 per project | BRD Project Management: Name, Code, Description, Start/End, Status. | `ProjectCode`, `ProjectName`, `StartDate`, `EndDate`, `Status`, `ProjectManagerUserId` |
| 7 | **ProjectAllocations** | 1 per person×project×window | **Employee Resource Tracking.** Planned capacity = denominator of utilization. | `AllocationPercentage`, `AllocationStartDate`, `AllocationEndDate`, `ProjectRole` |
| 8 | **AiTools** | 1 per tool | Normalised AI tool master. Stops "Copilot"/"GitHub Copilot"/"co-pilot" fragmenting the report. | `ToolName`, `Vendor`, `Category` |
| 9 | **Holidays** | 1 per date | Working-day calendar for missing-DSR detection. | `HolidayDate`, `HolidayName`, `IsOptional` |
| 10 | **AppSettings** | 1 per key | BRD "system settings". Tunable rules without a release. | `SettingKey`, `SettingValue`, `DataType` |

## Group C — Transactional Core (2)

| # | Table | Grain | Purpose | Key columns |
|---|---|---|---|---|
| 11 | **DSREntries** | **1 per employee × date × project** | The BRD's "DSR" entity, flat. No child table. | `UserId`, `WorkDate`, `ProjectId`, `EstimatedHours`, `IsNoWorkDone`, `WorkDescriptionHtml` |
| 12 | **DailyAiUsage** | 1 per employee × date | The day-grained AI declaration (see C2). | `UserId`, `WorkDate`, `IsAiUsed`, `AiToolId`, `UsageRemarks` |

## Group D — Audit (1)

| # | Table | Grain | Purpose | Key columns |
|---|---|---|---|---|
| 13 | **AuditLog** | 1 per field-level change | Row audit columns answer *who last touched this*; this answers *what changed*. JSON before/after, `ISJSON`-validated. Append-only. | `EntityName`, `EntityId`, `ActionType`, `OldValues`, `NewValues`, `ChangedByUserId` |

**Not built, deliberately:** `DSRTask` (C1) · `Departments` (C5) · `RolePermissions` — three fixed roles do not warrant a permission matrix · `ProjectStatuses` lookup (A-07) · `Employees` — employees are Users · date dimension — the two TVFs generate calendars on the fly.

**PK type deviations (2 of 13):** `UserLoginAudit.Id` and `AuditLog.Id` are `BIGINT IDENTITY`. Both are unbounded append-only logs — one row per login attempt and per field change respectively — and neither is ever joined by `Id`. INT would exhaust. All 11 others are `INT IDENTITY(1,1)`: `DSREntries` at 500 employees × 250 days × 3 projects ≈ 375K rows/year uses 0.017% of INT range per year.

---

# Section 3 — Relationship Matrix

## 3.1 Declared foreign keys (37 total)

Excluding the 24 audit FKs (`CreatedByUserId`/`ModifiedByUserId` → Users on 12 tables), which exist on every table and are listed once at the foot.

| # | Parent | Child | FK constraint | Type | Optional | Business purpose |
|---|---|---|---|---|---|---|
| 1 | Users | Users | `FK_Users_ManagerUser` | 1:N (self) | Yes | Reporting line. Scopes the Manager Dashboard to direct reports. |
| 2 | Users | UserRoles | `FK_UserRoles_User` | 1:N | No | Which roles a person holds. |
| 3 | Roles | UserRoles | `FK_UserRoles_Role` | 1:N | No | Which people hold a role. |
| 4 | Users | UserCredentials | `FK_UserCredentials_User` | **1:1** | No | Database-login secret. Enforced 1:1 by `UQ_UserCredentials_UserId`. |
| 5 | Users | UserLoginAudit | `FK_UserLoginAudit_User` | 1:N | **Yes** | Login history. NULL when the attempted email matches no account. |
| 6 | Users | Projects | `FK_Projects_ProjectManagerUser` | 1:N | Yes | Project owner for the Project Report. |
| 7 | Projects | ProjectAllocations | `FK_ProjectAllocations_Project` | 1:N | No | Team assigned to a project. |
| 8 | Users | ProjectAllocations | `FK_ProjectAllocations_User` | 1:N | No | Projects a person is assigned to, with planned %. |
| 9 | **Users** | **DSREntries** | `FK_DSREntries_User` | **1:N** | No | **Who logged the work.** Many entries per person per day. |
| 10 | **Projects** | **DSREntries** | `FK_DSREntries_Project` | **1:N** | **Yes** | **Exactly one project per entry.** NULL only for a "No Work Done" declaration (`CK_DSREntries_ProjectRequired`). |
| 11 | Users | DailyAiUsage | `FK_DailyAiUsage_User` | 1:N | No | One AI declaration per person per day. |
| 12 | AiTools | DailyAiUsage | `FK_DailyAiUsage_AiTool` | 1:N | **Yes** | Which tool. NULL iff `IsAiUsed = 0` (`CK_DailyAiUsage_ToolMatchesFlag`). |
| 13 | Users | AuditLog | `FK_AuditLog_ChangedByUser` | 1:N | No | Change attribution. |
| 14–37 | Users | *all 12 tables* | `FK_<Table>_CreatedByUser`, `FK_<Table>_ModifiedByUser` | 1:N | Created No / Modified Yes | Standard audit attribution (instruction 7). |

## 3.2 Logical (non-FK) join — deliberate

| Parent | Child | Join predicate | Why no FK |
|---|---|---|---|
| DailyAiUsage | DSREntries | `UserId AND WorkDate` | Neither is the other's parent. They are **sibling facts at different grains** sharing a natural key. An FK would make `DailyAiUsage` a DSR *header* — precisely what instruction 6 excludes. A DSR entry is valid with no AI declaration and vice versa. |

## 3.3 Cardinality summary

```
Users (1) ──< UserRoles >── (1) Roles                    M:N via junction
Users (1) ──── (0..1) UserCredentials                    1:1 optional  (DB-login only)
Users (1) ──< (self) Users                               hierarchy     (manager line)
Users (1) ──< DSREntries >── (0..1) Projects             M:N + attributes  <<< CORE GRAIN
Users (1) ──< DailyAiUsage >── (0..1) AiTools            1 per user-day
Users (1) ──< ProjectAllocations >── (1) Projects        M:N + attributes  (capacity)
Users (1) ──< UserLoginAudit                             append-only
Users (1) ──< AuditLog                                   append-only
Holidays, AppSettings                                    standalone reference
```

**The two M:N-with-attributes relationships are the heart of the model.** `DSREntries` resolves Users × Projects with effort attributes (what *happened*). `ProjectAllocations` resolves the same pair with capacity attributes (what was *planned*). Utilization is the ratio between them.

---

# Section 4 — Database Design Explanation

## 4.1 The grain decision

Everything follows from one choice: **`DSREntries` is one row per employee per date per project.**

```
DSREntries
Id   UserId  WorkDate     ProjectId  EstimatedHours  IsNoWorkDone
──── ─────── ──────────── ────────── ─────────────── ────────────
 1     3     2026-08-10       1           4.00            0        <- Project A
 2     3     2026-08-10       2           2.00            0        <- Project B
 3     3     2026-08-10       3           2.00            0        <- Project C
 5     3     2026-08-06     NULL          0.00            1        <- No Work Done
```

Three saves, three rows, no parent. This is verified working in `DSR_Seed_SampleData.sql` §2.7.

Why the flat grain is also the better engineering choice, independent of the BRD:

- **A header row would carry no data of its own.** Strip AI usage out (C2) and `DSR` retains only `UserId` + `WorkDate` — both already on every detail row. A parent whose entire content duplicates its child's key is a pure join tax.
- **Every BRD report aggregates at project level.** Employee, Project, Utilization and AI reports all group by employee×date×project or a rollup of it. The flat table *is* the reporting grain — no report needs the header.
- **Simpler transactions.** "Add Entry"/"Remove Entry" become one INSERT and one soft-DELETE. Header/detail requires upsert-parent-then-child, plus orphan cleanup when the last child is removed.

## 4.2 Normalisation — 3NF verified

| Table | Candidate key | 1NF | 2NF | 3NF | Note |
|---|---|---|---|---|---|
| Users | `Id`; `Email`; `EmployeeCode`; `ExternalObjectId` | ✔ | ✔ | ✔ | `FullName` is a *persisted computed column*, not stored redundancy — cannot drift. |
| Roles | `Id`; `RoleCode` | ✔ | ✔ | ✔ | |
| UserRoles | `Id`; `(UserId, RoleId)` | ✔ | ✔ | ✔ | Pure junction. |
| UserCredentials | `Id`; `UserId` | ✔ | ✔ | ✔ | 1:1 split avoids NULL columns for SSO-only users. |
| Projects | `Id`; `ProjectCode`; `ProjectName` | ✔ | ✔ | ✔ | `Status` is atomic; no transitive dependency. |
| ProjectAllocations | `Id`; `(ProjectId, UserId, AllocationStartDate)` | ✔ | ✔ | ✔ | |
| AiTools | `Id`; `ToolName` | ✔ | ✔ | ✔ | Extracted from DSR to eliminate a repeating text value. |
| **DSREntries** | `Id`; `(UserId, WorkDate, ProjectId)` | ✔ | ✔ | ✔ | Every non-key column depends on the whole key. **AI fields are absent precisely because they would depend on only part of it.** |
| **DailyAiUsage** | `Id`; `(UserId, WorkDate)` | ✔ | ✔ | ✔ | Correct home for `(UserId, WorkDate)`-dependent attributes. |
| Holidays / AppSettings / UserLoginAudit / AuditLog | `Id` + natural key | ✔ | ✔ | ✔ | Logs are append-only event records. |

**Two conscious, documented denormalisations:**

1. `Users.FullName` — persisted computed, indexed for name search. Derived by the engine; cannot diverge.
2. `DSREntries.WorkDescriptionPlain` — tag-stripped copy of the HTML. `LIKE '%payment%'` over markup produces false positives on attribute values and misses text split by tags. Populated by the application in the same transaction; the trade is one write for correct search and clean CSV export.

## 4.3 Dual authentication

```
                 ┌──────────────────────────────────────────┐
   SSO path      │ Users.AuthenticationType IN ('SSO','BOTH')│
   (Entra ID)    │ match on ExternalObjectId  (oid claim)    │  no credential row
                 └──────────────────────────────────────────┘
                 ┌──────────────────────────────────────────┐
   DB path       │ Users.AuthenticationType IN ('DATABASE',  │
                 │                              'BOTH')      │──> UserCredentials (1:1)
                 │ match on Email, verify PasswordHash       │    hash, stamp, lockout
                 └──────────────────────────────────────────┘
```

- One `Users` row per person regardless of path — a user switching from DB to SSO keeps their history and DSRs.
- `BOTH` supports migration: SSO primary, password as break-glass.
- `CK_Users_SsoRequiresExternalId` guarantees an SSO-capable account actually has an object id, so the SSO lookup can never silently fall through to email matching (see S1).
- `UQ_Users_ExternalObjectId_Active` prevents two accounts claiming one Entra identity.
- Lockout state lives in `UserCredentials`, so failed-attempt writes never contend with profile reads.

## 4.4 Where each business rule is enforced

| BRD rule | Enforcement | Object |
|---|---|---|
| Future dates not allowed | `CHECK` | `CK_DSREntries_NoFutureDate`, `CK_DailyAiUsage_NoFutureDate` |
| Hours between 0 and 24 | `CHECK` | `CK_DSREntries_HoursRange` |
| No Work Done ⇒ hours = 0 | `CHECK` | `CK_DSREntries_NoWorkZeroHours` |
| Project mandatory for work entries | `CHECK` | `CK_DSREntries_ProjectRequired` |
| AI selection mandatory | `NOT NULL` + unique key | `DailyAiUsage.IsAiUsed`, `UQ_DailyAiUsage_User_WorkDate` |
| AI tool shown/required when AI = Yes | `CHECK` | `CK_DailyAiUsage_ToolMatchesFlag` |
| Each DSR = exactly one project | FK + `CHECK` | `FK_DSREntries_Project` + `CK_DSREntries_ProjectRequired` |
| One entry per employee/date/project | Filtered unique index | `UQ_DSREntries_User_Date_Project_Active` |
| Daily total ≤ configured cap | **Trigger** (cross-row) | `trg_DSREntries_DailyRules` (51001) |
| No Work Done excludes other entries | **Trigger** (cross-row) | `trg_DSREntries_DailyRules` (51002) |
| Effort only on open projects, inside window | **Trigger** (cross-table) | `trg_DSREntries_ProjectWindow` (51003) |
| Audit logs immutable | **`INSTEAD OF` trigger** | `trg_AuditLog_PreventChange` (51010), `trg_UserLoginAudit_PreventChange` (51011) |

Rules are pushed to the lowest layer that can express them. Only the four that span rows or tables use triggers — a `CHECK` constraint cannot see sibling rows.

## 4.5 ERD explanation

```
                        ┌──────────────┐
                        │    Roles     │
                        └──────┬───────┘
                               │ 1:N
                        ┌──────┴───────┐
                        │  UserRoles   │
                        └──────┬───────┘
                               │ N:1
   ┌───────────────────────────┴────────────────────────────────┐
   │                          USERS                             │◄──┐ self 1:N
   │  identity · SSO ids · manager line · StandardDailyHours     │───┘ ManagerUserId
   └──┬────────┬──────────┬───────────┬───────────┬──────────┬───┘
      │1:1     │1:N       │1:N        │1:N        │1:N       │1:N (audit, all tables)
      │        │          │           │           │          │
┌─────┴────┐ ┌─┴────────┐ │      ┌────┴──────┐ ┌──┴───────┐  │
│ UserCred │ │ LoginAud │ │      │DailyAiUsage│ │ AuditLog │  │
│ (DB auth)│ │(both)    │ │      │ 1/user-day │ └──────────┘  │
└──────────┘ └──────────┘ │      └────┬───────┘               │
                          │           │ N:1                   │
                          │      ┌────┴────┐                  │
                          │      │ AiTools │                  │
                          │      └─────────┘                  │
                          │                                   │
        ┌─────────────────┴──────────┐                        │
        │        DSREntries          │  <<< CORE FACT         │
        │  UserId + WorkDate +       │                        │
        │  ProjectId (exactly one)   │                        │
        │  EstimatedHours            │                        │
        └─────────────┬──────────────┘                        │
                      │ N:1                                   │
        ┌─────────────┴──────────────┐                        │
        │         PROJECTS           │────────────────────────┘
        │  code · name · window ·    │
        │  status · manager          │
        └─────────────┬──────────────┘
                      │ 1:N
        ┌─────────────┴──────────────┐        Holidays      AppSettings
        │    ProjectAllocations      │       (calendar)     (system config)
        │  planned capacity %        │       standalone      standalone
        └────────────────────────────┘
```

**Reading the ERD.** `Users` is the hub — every table reaches it, if only through audit columns. Two spokes carry the business meaning:

- **`DSREntries`** is the fact table: Users × Projects with effort. It has exactly two business parents (`UserId`, `ProjectId`) and no children — the flat grain made visible.
- **`ProjectAllocations`** is the same pair with planned capacity. Utilization = `DSREntries` ÷ `ProjectAllocations` × calendar.

`DailyAiUsage` deliberately hangs off `Users` and **not** off `DSREntries` — a sibling fact at day grain, joined for reporting, never a parent.

`UserCredentials` is the only 1:1 in the model, and it is optional: its absence is meaningful (an SSO-only account).

## 4.6 Reporting layer

The join logic lives in the database once, so five reports cannot drift apart.

| Object | Serves | Notes |
|---|---|---|
| `vw_DsrEntryDetail` | All reports; export; drill-down | Flat spine: entry + employee + manager + project + that day's AI declaration, plus pre-computed year/month/ISO-week. |
| `vw_DsrDailySummary` | Employee Dashboard (daily/weekly/monthly) | Per employee-day: entry count, project count, total hours, day utilization %. |
| `vw_ProjectEffortSummary` | Project Report | Per project: hours, contributor count, first/last effort date. `LEFT JOIN` so zero-effort projects still appear. |
| `vw_AiAdoptionDaily` | AI Usage Report, AI adoption metrics | Adoption % needs no `DISTINCT` because the grain is already one row per employee-day. |
| `fn_GetMissingDsrDays(@from, @to, @managerId)` | Manager/Admin missing-DSR metric | Generates working days (excludes weekends, mandatory holidays), respects joining/exit dates, skips service accounts. `@managerId = NULL` ⇒ organisation-wide. |
| `fn_GetResourceUtilization(@from, @to)` | Resource Utilization Report | Capacity, planned and logged hours + utilization %. TVFs because the date window is a parameter, which a view cannot accept. |

---

# Section 5 — Complete SQL Server CREATE TABLE Script

Full script: **`DSR_Schema_DDL.sql`** (tables + all constraints) and **`DSR_Indexes_Views_Triggers.sql`** (indexes, views, functions, triggers).

**Deployment order — mandatory:**

```
1. DSR_Schema_DDL.sql              -- database, schema, 13 tables, all constraints
2. DSR_Indexes_Views_Triggers.sql  -- 27 indexes, 4 views, 2 TVFs, 4 triggers  (re-runnable)
3. DSR_Seed_SampleData.sql         -- Part 1 seed (all envs); Part 2 sample (@LoadSampleData)
```

`Users` is created first: every other table's `CreatedByUserId` references it, and the bootstrap SYSTEM user (`Id = 1`) is inserted with a self-referencing `CreatedByUserId`, which SQL Server resolves within the single INSERT.

**Two SET options are mandatory and are set inside every script:**

```sql
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
```

Without them, `Users.FullName` (persisted computed) and all 10 filtered unique indexes fail with **Msg 1934**. `sqlcmd` defaults `QUOTED_IDENTIFIER` to OFF, so this is not theoretical — it was the first deployment failure encountered and fixed.

**Deployed object inventory (verified by query against the live database):**

| Object type | Count |
|---|---|
| Tables | 13 |
| Primary keys | 13 |
| Foreign keys | 37 |
| CHECK constraints | 32 |
| DEFAULT constraints | 43 |
| UNIQUE constraints | 5 |
| Nonclustered indexes | 27 (10 unique+filtered) |
| Views | 4 |
| Table-valued functions | 2 |
| Triggers | 4 |

---

# Section 6 — Constraints

## 6.1 Primary keys (13)

`PK_<Table>` on `Id`, clustered. `INT IDENTITY(1,1)` on 11 tables; `BIGINT IDENTITY(1,1)` on `UserLoginAudit` and `AuditLog` (Section 2 justification).

## 6.2 Unique constraints & unique indexes

Declared `UNIQUE` constraints — used where the key must hold even for deactivated rows:

| Constraint | Table | Columns | Purpose |
|---|---|---|---|
| `UQ_Roles_RoleCode` | Roles | RoleCode | One code per role. |
| `UQ_UserRoles_User_Role` | UserRoles | UserId, RoleId | No duplicate assignment. |
| `UQ_UserCredentials_UserId` | UserCredentials | UserId | **Enforces 1:1 with Users.** |
| `UQ_DailyAiUsage_User_WorkDate` | DailyAiUsage | UserId, WorkDate | **One AI declaration per employee-day** — makes C2's contradiction impossible. |
| `UQ_AppSettings_SettingKey` | AppSettings | SettingKey | One row per setting. |

Filtered unique indexes (`WHERE IsActive = 1`) — used for natural keys that must be reusable after soft delete, since a plain `UNIQUE` would let one deactivated row block its key forever:

| Index | Table | Columns |
|---|---|---|
| `UQ_Users_Email_Active` | Users | Email |
| `UQ_Users_EmployeeCode_Active` | Users | EmployeeCode *(also `IS NOT NULL`)* |
| `UQ_Users_ExternalObjectId_Active` | Users | ExternalObjectId *(also `IS NOT NULL`)* |
| `UQ_Projects_ProjectCode_Active` | Projects | ProjectCode |
| `UQ_Projects_ProjectName_Active` | Projects | ProjectName |
| `UQ_AiTools_ToolName_Active` | AiTools | ToolName |
| `UQ_Holidays_HolidayDate_Active` | Holidays | HolidayDate |
| **`UQ_DSREntries_User_Date_Project_Active`** | DSREntries | UserId, WorkDate, ProjectId | ← **the core business rule (A-02)** |
| `UQ_DSREntries_User_Date_NoWork_Active` | DSREntries | UserId, WorkDate *(where `IsNoWorkDone = 1`)* |
| `UQ_ProjectAllocations_Project_User_Start_Active` | ProjectAllocations | ProjectId, UserId, AllocationStartDate |

## 6.3 CHECK constraints (32) — by table

**Users (8)** — `AuthenticationType` in (SSO, DATABASE, BOTH) · SSO/BOTH requires `ExternalObjectId` · not own manager · `StandardDailyHours` in (0, 24] · exit ≥ joining · email contains `@` and a dot · service account has no employee code · `ModifiedByUserId`/`ModifiedDate` set together or both NULL.

**Roles (1)** — `RoleCode` upper-case, no spaces.

**UserCredentials (2)** — `FailedLoginAttempts ≥ 0` · `LEN(PasswordHash) ≥ 20` (blocks a plaintext or truncated hash).

**UserLoginAudit (2)** — `AuthenticationType` in (SSO, DATABASE) · failure must carry a reason.

**Projects (3)** — `Status` in the five-value set · `EndDate ≥ StartDate` · code has no spaces.

**ProjectAllocations (2)** — `AllocationPercentage` in (0, 100] · end ≥ start.

**AiTools (1)** — `Category` NULL or in the six-value set.

**AppSettings (1)** — `DataType` in (STRING, INT, DECIMAL, BOOL, DATE, JSON).

**DSREntries (6)** — the BRD validation block:

```sql
CK_DSREntries_HoursRange      EstimatedHours >= 0 AND EstimatedHours <= 24
CK_DSREntries_NoWorkZeroHours IsNoWorkDone = 0 OR EstimatedHours = 0
CK_DSREntries_ProjectRequired IsNoWorkDone = 1 OR ProjectId IS NOT NULL
CK_DSREntries_WorkHasHours    IsNoWorkDone = 1 OR EstimatedHours > 0
CK_DSREntries_NoFutureDate    WorkDate <= CAST(SYSUTCDATETIME() AS DATE)
CK_DSREntries_ModifiedPair    both ModifiedBy/ModifiedDate, or neither
```

**DailyAiUsage (2)** — tool required iff `IsAiUsed = 1`, forbidden otherwise · no future date.

**AuditLog (4)** — `ActionType` in (INSERT, UPDATE, DELETE) · `ISJSON(OldValues) = 1` when present · same for `NewValues` · payload present for the action type (INSERT needs New, DELETE needs Old, UPDATE needs both).

## 6.4 DEFAULT constraints (43)

`DF_<Table>_<Column>`, all explicitly named for clean scripting and diffing.

| Pattern | Value | Applied to |
|---|---|---|
| `CreatedDate` | `SYSUTCDATETIME()` | all 13 tables |
| `IsActive` | `1` | all 13 tables |
| `Users.AuthenticationType` | `N'DATABASE'` | conservative default |
| `Users.StandardDailyHours` | `8.00` | standard working day |
| `Users.IsServiceAccount` | `0` | |
| `Projects.Status` | `N'PLANNED'` | new project not yet started |
| `ProjectAllocations.AllocationPercentage` | `100.00` | full-time unless stated |
| `DSREntries.EstimatedHours` | `0` | works with the No-Work-Done rule |
| `DSREntries.IsNoWorkDone` | `0` | |
| `UserCredentials.SecurityStamp` | `NEWID()` | never NULL |
| `AiTools`/`Holidays`/`AppSettings` flags | `0` / `1` | per column semantics |

## 6.5 Cross-row & cross-table rules (4 triggers)

Not expressible as `CHECK` — a `CHECK` cannot see other rows or tables.

| Trigger | Error | Rule |
|---|---|---|
| `trg_DSREntries_DailyRules` | 51001 | Daily total hours ≤ `AppSettings['DSR.MaxDailyHours']` (default 24). Without this, four 8-hour entries pass all per-row checks and total 32. |
| | 51002 | A "No Work Done" declaration cannot coexist with real entries on the same date. |
| `trg_DSREntries_ProjectWindow` | 51003 | `WorkDate` inside the project window; project not PLANNED / ON_HOLD / CANCELLED and not soft-deleted (A-11). |
| `trg_AuditLog_PreventChange` | 51010 | `INSTEAD OF UPDATE, DELETE` — AuditLog is append-only. |
| `trg_UserLoginAudit_PreventChange` | 51011 | Same for the login log. |

> **Implementation note.** Both AFTER triggers guard with `IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;` and **not** `IF @@ROWCOUNT = 0`. Any `SET` statement — including the `SET NOCOUNT ON` that conventionally opens a trigger — resets `@@ROWCOUNT` to 0, which silently turns the trigger into a no-op. This was caught by the negative test suite: tests 8 and 9 initially passed data that should have been rejected.

## 6.6 Negative test results

All ten executed against the deployed database; every one blocked.

| # | Attempt | Blocked by |
|---|---|---|
| 1 | 25 hours in one entry | `CK_DSREntries_HoursRange` |
| 2 | WorkDate 2099-01-01 | `CK_DSREntries_NoFutureDate` |
| 3 | No Work Done with 4 hours | `CK_DSREntries_NoWorkZeroHours` |
| 4 | Work entry with no project | `CK_DSREntries_ProjectRequired` |
| 5 | Second entry, same project + date | `UQ_DSREntries_User_Date_Project_Active` |
| 6 | AI = Yes with no tool | `CK_DailyAiUsage_ToolMatchesFlag` |
| 7 | Two AI declarations, one employee-day | `UQ_DailyAiUsage_User_WorkDate` |
| 8 | Daily total 28 hours across entries | `trg_DSREntries_DailyRules` (51001) |
| 9 | Effort against an ON_HOLD project | `trg_DSREntries_ProjectWindow` (51003) |
| 10 | `DELETE FROM AuditLog` | `trg_AuditLog_PreventChange` (51010) |

Reproduce: uncommented block at the foot of `DSR_Seed_SampleData.sql`.

---

# Section 7 — Indexes

27 nonclustered indexes. Every one traces to a named BRD report, dashboard or lookup path.

## 7.1 Clustered

`PK_<Table>` on `Id` for all 13 tables. `Id` is monotonically increasing, so inserts append to the end of the B-tree — no page splits, no fragmentation from the write pattern, and the narrow 4-byte (8 for the two logs) key keeps every nonclustered index small.

## 7.2 Foreign key indexes (7)

| Index | Table | Key / Include | Purpose |
|---|---|---|---|
| `IX_Users_ManagerUserId` | Users | ManagerUserId *(filtered NOT NULL)* | "My team" scoping on every manager screen. |
| `IX_UserRoles_RoleId` | UserRoles | RoleId → UserId | "All Managers", "All Admins". The reverse direction is served by `UQ_UserRoles_User_Role`. |
| `IX_UserLoginAudit_UserId_AttemptDate` | UserLoginAudit | UserId, AttemptDate DESC | Login history, newest first. |
| `IX_Projects_ProjectManagerUserId` | Projects | *(filtered NOT NULL)* | "Projects I manage". |
| `IX_ProjectAllocations_UserId` | ProjectAllocations | UserId, start, end → ProjectId, % | Per-person capacity lookup. |
| `IX_DailyAiUsage_AiToolId` | DailyAiUsage | *(filtered NOT NULL)* | Tool-level AI report; also makes `AiTools` deletes cheap. |
| `IX_AuditLog_ChangedByUserId` | AuditLog | ChangedByUserId, ChangedDate DESC | "What did this user change?" |

> **Deliberate exclusion.** No index on `CreatedByUserId` / `ModifiedByUserId`. They appear in no BRD report as a join or filter predicate, and indexing 12 tables × 2 columns would add 24 near-useless indexes to every write path. FK columns are indexed **when queried**, not reflexively.

## 7.3 Reporting & search indexes (18)

Each named against the report that needs it. `DSREntries` and `DailyAiUsage` indexes are filtered `WHERE IsActive = 1` so soft-deleted rows cost nothing to scan.

| Index | Serves | Key → Include |
|---|---|---|
| `IX_DSREntries_User_WorkDate_Covering` | **Employee Report / Dashboard** daily-weekly-monthly | `(UserId, WorkDate)` → ProjectId, EstimatedHours, IsNoWorkDone |
| `IX_DSREntries_Project_WorkDate_Covering` | **Project Report**, project effort | `(ProjectId, WorkDate)` → UserId, EstimatedHours, IsNoWorkDone |
| `IX_DSREntries_WorkDate_Covering` | **Date-wise filtering**, Admin Dashboard, missing-DSR | `(WorkDate)` → UserId, ProjectId, EstimatedHours, IsNoWorkDone |
| `IX_DSREntries_NoWorkDone` | No-Work exception listing | `(WorkDate, UserId)` filtered `IsNoWorkDone = 1` |
| `IX_DailyAiUsage_WorkDate_Covering` | **AI Usage Report**, adoption trend | `(WorkDate)` → UserId, IsAiUsed, AiToolId |
| `IX_DailyAiUsage_User_WorkDate_Covering` | Per-employee AI history; the `vw_DsrEntryDetail` join | `(UserId, WorkDate)` → IsAiUsed, AiToolId |
| `IX_ProjectAllocations_Project_Window` | **Resource Utilization**, project staffing | `(ProjectId, start, end)` → UserId, % |
| `IX_Projects_Status_Name` | Project dropdown, Admin project list | `(Status, ProjectName)` → Code, dates |
| `IX_Users_FullName` | Employee search, team lists | `(FullName)` → Email, EmployeeCode, ManagerUserId |
| `IX_AuditLog_Entity` | Audit drill-down on one record | `(EntityName, EntityId, ChangedDate DESC)` |
| + the 10 unique/filtered indexes from §6.2 | natural-key enforcement **and** lookup | |

**Why three overlapping `DSREntries` indexes rather than one.** The three reports lead with different columns. An index on `(UserId, WorkDate)` cannot seek a project-scoped query — `ProjectId` is not the leading column, forcing a scan. Each index is covering for its own report, so the plan never touches the base table or does key lookups. Cost: three narrow indexes on a table taking roughly 375K inserts/year — trivial against the read benefit on every dashboard load.

## 7.4 Composite key-order rationale

Leading column = highest-selectivity equality predicate; second = the range predicate; the rest as `INCLUDE`:

- `(UserId, WorkDate)` — dashboards always fix one employee then range-scan dates.
- `(ProjectId, WorkDate)` — project reports fix one project then range-scan dates.
- `(WorkDate)` alone — org-wide queries have no employee or project predicate to lead with.
- `(EntityName, EntityId, ChangedDate DESC)` — `DESC` matches "newest first" so no sort operator is needed.

## 7.5 The one index tied to an unconfirmed assumption

`UQ_DSREntries_User_Date_Project_Active` implements A-02. **If the business confirms multiple entries per project per day are valid** (two distinct tasks on one project), drop that single index — nothing else depends on it:

```sql
DROP INDEX UQ_DSREntries_User_Date_Project_Active ON dsr.DSREntries;
-- optional replacement, non-unique, same query benefit:
CREATE NONCLUSTERED INDEX IX_DSREntries_User_Date_Project
    ON dsr.DSREntries (UserId, WorkDate, ProjectId) WHERE IsActive = 1;
```

## 7.6 Idempotency

`DSR_Indexes_Views_Triggers.sql` opens by dropping every nonclustered index in the `dsr` schema that it owns, then recreating them — explicitly excluding `is_primary_key = 1` and `is_unique_constraint = 1`, which belong to the DDL script. Views, functions and triggers use `CREATE OR ALTER`. The whole script is therefore safely re-runnable in a CI/CD pipeline; verified by running it twice against a populated database.

---

# Section 8 — Sample Data Script

Full script: **`DSR_Seed_SampleData.sql`**. Two parts, one switch.

```sql
DECLARE @LoadSampleData BIT = 1;   -- SET TO 0 FOR PRODUCTION
```

The whole script runs in one explicit transaction with `TRY/CATCH` + `XACT_ABORT ON`; any failure rolls back completely and rethrows. Every insert is `WHERE NOT EXISTS`-guarded, so re-running changes nothing.

## Part 1 — Seed (all environments, including production)

| Data | Rows | Notes |
|---|---|---|
| Bootstrap SYSTEM user | 1 | `Id = 1`, `IsServiceAccount = 1`, self-referencing `CreatedByUserId` |
| Roles | 3 | EMPLOYEE, MANAGER, ADMIN — all `IsSystemRole = 1` |
| AppSettings | 10 | `DSR.MaxDailyHours`, `DSR.BackDateWindowDays`, `DSR.RequireDescription`, `Calendar.WeekendDays`, `Auth.MaxFailedAttempts`, `Auth.LockoutMinutes`, `Auth.AllowDatabaseLogin`, `Report.DefaultPeriodDays`, `Utilization.TargetPct`, `DSR.AllowEditAfterLock` |
| AiTools | 7 | GitHub Copilot, Claude, ChatGPT, M365 Copilot, Cursor, Figma AI, Other |

## Part 2 — Sample (DEV/QA only)

Deliberately exercises every branch of the design:

| Data | Rows | What it proves |
|---|---|---|
| Users | 4 | One per auth path: `DATABASE` (Admin), `SSO` (Manager), `BOTH` (Employee), `SSO` (part-time employee at 6.00 standard hours) |
| UserCredentials | 2 | Created **only** for `DATABASE`/`BOTH` users — SSO-only users correctly have no row |
| UserRoles | 6 | Manager holds MANAGER **and** EMPLOYEE — multi-role support |
| Projects | 5 | ACTIVE ×3, ON_HOLD, COMPLETED; one with `EndDate = NULL` |
| ProjectAllocations | 5 | Employee split 50/30/20 across three projects = exactly 100% |
| Holidays | 6 | Including one `IsOptional = 1`, which the missing-DSR TVF ignores |
| **DSREntries** | **8** | See below |
| DailyAiUsage | 5 | AI = Yes with tool, AI = No with NULL tool, two different tools |
| UserLoginAudit | 3 | SSO success, DB success, failure with `UserId = NULL` |
| AuditLog | 1 | JSON before/after on an hours correction |

### The canonical BRD scenario

```
10-Aug-2026  Priya Sharma  Project A  4.00 h   -> DSREntries row
10-Aug-2026  Priya Sharma  Project B  2.00 h   -> DSREntries row
10-Aug-2026  Priya Sharma  Project C  2.00 h   -> DSREntries row
                                      ──────
                                       8.00 h  = 100% of an 8-hour day
+ ONE DailyAiUsage row for 10-Aug: AI = Yes, GitHub Copilot
```

Plus `06-Aug-2026`: a **No Work Done** row with `ProjectId = NULL` and `0.00` hours — proving `CK_DSREntries_ProjectRequired` permits exactly this case and no other.

## Verification output (actual, from the deployed database)

```
--- 2. Employee Dashboard: daily totals ---
Imran Khan    2026-08-10  entries 2  projects 2  6.00 h  100.00 %
Priya Sharma  2026-08-10  entries 3  projects 3  8.00 h  100.00 %

--- 3. Project Report ---
PRJ-A  Project A - Customer Portal   ACTIVE     contributors 2  21.50 h
PRJ-C  Project C - Mobile App        ACTIVE     contributors 2   4.50 h
PRJ-B  Project B - Billing Engine    ACTIVE     contributors 1   2.00 h
PRJ-D  Project D - Data Platform     ON_HOLD    contributors 0   0.00 h
PRJ-E  Project E - Legacy Retirement COMPLETED  contributors 0   0.00 h

--- 4. AI Usage Report ---
2026-08-10  declarations 2  aiUsed 1  adoption  50.00 %  tools 1
2026-08-07  declarations 2  aiUsed 2  adoption 100.00 %  tools 2

--- 5. Resource Utilization (Aug-2026, 21 working days) ---
Priya Sharma  capacity 168.00  planned 168.00  logged 16.00   9.52 %
Imran Khan    capacity 126.00  planned 126.00  logged 12.00   9.52 %

--- 6. Missing DSRs (3-11 Aug 2026) ---
23 rows across 4 employees; 8-9 Aug (weekend) correctly excluded
```

Imran's 126.00 capacity vs Priya's 168.00 confirms per-employee `StandardDailyHours` flows through utilization. Priya's planned = capacity confirms the 50+30+20 allocation resolves to 100%.

---

# Section 9 — Design Review and Recommendations

## 9.1 Validation against the required criteria

### Data integrity — **Strong**

Every BRD validation rule is enforced in the database, not only the application: 13 PKs, 37 FKs, 32 CHECKs, 5 UNIQUE constraints, 10 unique filtered indexes, 4 triggers. All 10 negative tests blocked. The four rules that span rows or tables use triggers because a `CHECK` provably cannot express them. Two logs are trigger-protected against UPDATE/DELETE. `ModifiedByUserId`/`ModifiedDate` are constrained to move together, so "modified by nobody at some time" is unrepresentable.

**Residual gap:** overlapping `ProjectAllocations` windows for one person+project are not prevented — SQL Server has no exclusion constraint. Application-level, or a trigger if it proves to be a real problem. Deliberately not over-engineered.

### Performance — **Strong for the stated scale**

`DSREntries` at 500 employees × 250 days × 3 projects ≈ 375K rows/year. The three covering indexes mean the Employee, Project and date-wise reports are index-only. `READ_COMMITTED_SNAPSHOT` is enabled so dashboard reads never block DSR writes — important because managers run reports while teams are submitting. Clustered on an ever-increasing `Id`, so inserts append.

**Watch:** `vw_DsrEntryDetail` joins six tables; for very wide date ranges, query the base tables with the covering indexes instead.

### Scalability — **Good, with a known ceiling**

INT PKs on transactional tables give ~5,700 years of headroom at projected volume. The two log tables are BIGINT. `DSREntries` and `AuditLog` are the natural partitioning candidates (monthly on `WorkDate` / `ChangedDate`) at roughly 50M+ rows — not needed now, and the design does not obstruct it.

**Watch:** the two TVFs generate calendars from `sys.all_objects` cross-joined. Fine to ~4,000 days; beyond that use a real date dimension.

### Reporting — **All six BRD reports delivered and verified**

Employee, Project, Resource Utilization, AI Usage, date-wise and project-wise filtering, plus the missing-DSR metric the BRD names but does not specify. Logic is centralised in 4 views + 2 TVFs so reports cannot drift apart.

**Gap:** utilization is built on **estimated** hours (the only effort field the BRD provides). See R5.

### Future enhancements — **Accommodated without restructuring**

Additive: `ActualHours`, `BillableFlag`, `TaskCategoryId`, `DepartmentId`, approval columns, `Holidays.LocationId`, an `AiToolUsage` bridge. None requires changing the DSR grain — the single most expensive change to make later, and the one this design gets right up front.

## 9.2 Recommendations

| # | Recommendation | Priority | Rationale |
|---|---|---|---|
| **R1** | **Confirm BRD v3 supersedes v2.** | **Critical** | v2 specifies `DSRTask` and "one DSR per day"; v3 removes both. The whole schema turns on this. |
| **R2** | **Add a DSR submit/lock/approve workflow.** | High | Nothing stops an employee editing a DSR after a manager signs off a report. Minimum: `StatusCode` (DRAFT/SUBMITTED/APPROVED) + `SubmittedDate` + `ApprovedByUserId` on `DSREntries`. `AppSettings['DSR.BackDateWindowDays']` is a stopgap, not a control. |
| **R3** | **Plan for multiple AI tools per day.** | Medium | "AI Tool Name" is singular; an employee using Copilot *and* Claude records one. Migration is additive: `DailyAiUsageTools (DailyAiUsageId, AiToolId)`, keep `AiToolId` as the primary tool. |
| **R4** | **Add `Departments` when org-level reporting is required.** | Medium | Utilization currently rolls up only to one manager's direct reports. Not built — no BRD mention. Additive: `Departments` + `Users.DepartmentId`. |
| **R5** | **Add `ActualHours` alongside `EstimatedHours`.** | Medium | Utilization on estimates measures planning, not delivery. Additive nullable column; reports pick `ISNULL(ActualHours, EstimatedHours)`. |
| **R6** | **Decide the time-zone policy explicitly.** | Medium | "Future dates not allowed" is ambiguous across zones. Storage is UTC and the `CHECK` uses server UTC; a user in UTC+13 can be blocked from logging their own "today". The API must validate in the user's zone *and* pass a date the CHECK accepts. |
| **R7** | **Move reporting to a read replica or nightly snapshot at scale.** | Low | Fine on OLTP now (`READ_COMMITTED_SNAPSHOT` + covering indexes). Revisit past ~500 concurrent users. |
| **R8** | **Populate `AuditLog` from the application, not triggers.** | Medium | EF Core `SaveChanges` interception gives correct user attribution and IP without per-table trigger sprawl. Triggers cannot see the HTTP context. |
| **R9** | **Add retention policies for the two log tables.** | Low | Unbounded growth. Suggest 24 months online, then archive. |
| **R10** | **Confirm A-11's blocked-status list.** | Medium | Effort is blocked on PLANNED/ON_HOLD/CANCELLED — inferred, not stated. Single list in `trg_DSREntries_ProjectWindow`. |

## 9.3 Security review

| # | Concern | Severity | Recommendation |
|---|---|---|---|
| **S1** | **SSO account matching.** Matching Entra users on *email* is an account-takeover vector (email reassignment, alias collision). | **High** | Match on `ExternalObjectId` (`oid` claim) only. `CK_Users_SsoRequiresExternalId` already guarantees SSO-capable accounts have one. Use email only for first-time linking, with an admin approval step. |
| **S2** | **Password storage.** | High | `PasswordHash NVARCHAR(500)` + `SecurityStamp` + `FailedLoginAttempts` + `LockoutEndDate` are in place, and `CK_UserCredentials_HashLength` blocks plaintext. Use ASP.NET Core `PasswordHasher` (PBKDF2, ≥100k iterations) or Argon2id. Never log the hash. Consider `Auth.AllowDatabaseLogin = false` once SSO rollout completes — the switch is already seeded. |
| **S3** | **Stored XSS via rich text.** `WorkDescriptionHtml` is rendered on dashboards. | **High** | Sanitise server-side on write (HtmlSanitizer allow-list), not just on render. The database cannot do this. `WorkDescriptionPlain` should be used for exports and search. |
| **S4** | **Horizontal privilege escalation.** Nothing in the schema stops employee A reading employee B's DSRs. | High | Enforce in the application: Employee → own rows; Manager → `WHERE u.ManagerUserId = @me`; Admin → all. Optionally add Row-Level Security as defence in depth. `IX_Users_ManagerUserId` supports the predicate efficiently. |
| **S5** | **Least privilege at the database.** | Medium | The application account needs no `db_owner`. Grant `SELECT/INSERT/UPDATE` on the `dsr` schema, `EXECUTE` on the TVFs, and **no `DELETE`** — soft delete is the model. This makes the append-only guarantee real rather than conventional. |
| **S6** | **Sensitive data in `AuditLog` JSON.** | Medium | Exclude `PasswordHash` and `SecurityStamp` from captured payloads. Enforce in the interceptor (R8). |
| **S7** | **Login-audit as an attack signal.** | Low | `UserLoginAudit` already records IP, user agent and failure reason. Alert on failure spikes per IP; `IX_UserLoginAudit_UserId_AttemptDate` supports the query. |
| **S8** | **Encryption at rest / in transit.** | Medium | Enable TDE (or rely on Azure SQL default) and require `Encrypt=True;TrustServerCertificate=False` in the connection string. |

## 9.4 Notes on specific design choices

| # | Choice | Rationale | Alternative if you disagree |
|---|---|---|---|
| **N1** | `DailyAiUsage` as a separate table | 3NF: AI attributes depend on `(UserId, WorkDate)`, a strict subset of `DSREntries`' candidate key. Prevents same-day contradictions structurally. | See N6. |
| **N2** | `Projects.Status` as `CHECK`, not a lookup table | Five fixed values, no admin maintenance screen in the BRD, avoids a join on every project query. | `CREATE TABLE dsr.ProjectStatuses (Id, StatusCode, StatusName, SortOrder, IsActive)`, swap the CHECK for an FK. Do this if the client wants custom statuses. |
| **N3** | No indexes on audit FK columns | Never a join or filter predicate in any BRD report; 24 indexes would tax every write. | Add selectively if an "activity by user" screen appears. |
| **N4** | Soft delete + filtered unique indexes | A plain `UNIQUE` on `Email` would let one deactivated user block that address permanently. | — |
| **N5** | `WorkDescriptionPlain` alongside the HTML | `LIKE` over markup gives false positives on attribute values and misses text split across tags. Also the correct column for CSV export. | Drop it and use Full-Text Search on the HTML column with a filter. |
| **N6** | Fallback to strict BRD v3 literalism | If you want AI fields physically on the DSR row: | `ALTER TABLE dsr.DSREntries ADD IsAiUsed BIT NOT NULL DEFAULT 0, AiToolId INT NULL, AiUsageRemarks NVARCHAR(1000) NULL;` then add `FK_DSREntries_AiTool`, a CHECK mirroring `CK_DailyAiUsage_ToolMatchesFlag`, a trigger enforcing same-day agreement, and drop `DailyAiUsage`. You gain one join; you lose the structural guarantee and drop below 3NF. |

## 9.5 Deployment checklist

1. `SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;` — already inside all three scripts. Do not strip them; the persisted computed column and 10 filtered indexes will not build.
2. Run in order: `DSR_Schema_DDL.sql` → `DSR_Indexes_Views_Triggers.sql` → `DSR_Seed_SampleData.sql`.
3. **Set `@LoadSampleData = 0` for production.**
4. Rotate the illustrative password hash in the seed script before any real deployment.
5. Grant the application login `SELECT/INSERT/UPDATE` on schema `dsr` + `EXECUTE` on the TVFs. Withhold `DELETE`.
6. Confirm `READ_COMMITTED_SNAPSHOT ON` took effect (the DDL sets it).
7. Load the real holiday calendar into `dsr.Holidays` before the first missing-DSR report.
8. Review the 10 `AppSettings` values with the business — especially `DSR.MaxDailyHours` and `DSR.BackDateWindowDays`.
9. Resolve **R1** (which BRD version is authoritative) before writing application code.
10. Optionally run the negative test block at the foot of the seed script as a post-deployment smoke test.
