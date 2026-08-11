# DSR & Resource Management System

Employee Daily Status Report and resource tracking. ASP.NET Core 9 Web API + React 18 SPA over the existing `DSRResourceManagement` SQL Server database.

**Verified on this machine:** all 4 .NET projects and the React client build with 0 errors; the API starts, connects to SQL Server, and 40+ live endpoint calls were exercised end to end (see *Verification* below).

---

## 1. Solution architecture

```
app/
├─ DSR.sln
├─ src/
│  ├─ DSR.Domain/           entities + enums. No dependencies on anything.
│  ├─ DSR.Application/      DTOs, service interfaces, services, validators, AutoMapper, sanitiser.
│  │                        Depends on Domain only (+ EF abstractions for async LINQ operators).
│  ├─ DSR.Infrastructure/   EF Core DbContext & mappings, repositories, UnitOfWork, JWT,
│  │                        password hashing, Entra ID validation, AuthService, settings cache.
│  └─ DSR.API/              controllers, middleware, Program.cs, appsettings, Swagger.
├─ client/                  React 18 + Vite + MUI 6 + React Router 6 + React Hook Form + Axios.
└─ database/                04_Migration_AppSupport.sql, 05_Set_Dev_Passwords.sql,
                            06_Migration_MultipleEntriesPerProject.sql
```

Dependency direction is strictly inward: `API → Infrastructure → Application → Domain`. Nothing outside Infrastructure references `DbContext`.

**Layer responsibilities**

| Layer | Owns | Never contains |
|---|---|---|
| Domain | Entities, role/status/setting constants, invariants expressible on one entity | Persistence, HTTP, DTOs |
| Application | Business rules, data-scope decisions, DTOs, validators, orchestration | SQL, provider types, HttpContext |
| Infrastructure | EF mappings, repositories, crypto, token issuance, Entra validation | Business rules |
| API | Routing, model binding, auth attributes, exception translation | Business logic (controllers are 1–3 lines) |

---

## 2. Database

The schema is owned by the **hand-written SQL scripts, not EF migrations**, so the DDL reviewed and signed off previously stays authoritative. `Program.cs` verifies connectivity and expected objects at startup and fails fast with a clear message if scripts have not been applied.

### Deployment order

```bash
sqlcmd -S <server> -i DSR_Schema_DDL.sql              # 13 tables + constraints
sqlcmd -S <server> -i DSR_Indexes_Views_Triggers.sql  # 27 indexes, 4 views, 2 TVFs, 4 triggers
sqlcmd -S <server> -i DSR_Seed_SampleData.sql         # seed (set @LoadSampleData = 0 in PROD)
sqlcmd -S <server> -i app/database/04_Migration_AppSupport.sql   # NEW objects for the app
sqlcmd -S <server> -I -i app/database/05_Set_Dev_Passwords.sql   # DEV/QA ONLY
sqlcmd -S <server> -I -i app/database/06_Migration_MultipleEntriesPerProject.sql
```

### What migration 04 adds, and why

Gap analysis against the 13 existing tables. **Nothing is duplicated** — all 13 are reused as-is.

| New object | Why it is required |
|---|---|
| `dsr.RefreshTokens` | "Refresh Token Support" is an explicit requirement and the base schema had no token store. Stores only a SHA-256 hash, supports rotation and **reuse detection** (replaying a rotated token revokes the whole family). |
| `dsr.SsoRoleMappings` | "Role mapping support" for Entra ID. Maps a group objectId → application role, so group membership drives authorisation at each sign-in. |
| `dsr.vw_DsrMonthlySummary` | The Monthly Summary Report needs employee × month rollups; the base schema had only a daily view. |
| `AiTools` += `Gemini` | Required by the UI spec, absent from the base seed. |
| 4 `AppSettings` keys | SSO auto-provisioning on/off, default SSO role, access/refresh token lifetimes. |

Deliberately **not** created: password reset (uses `UserCredentials.MustChangePassword`), activate/deactivate (uses `IsActive`), audit (uses `AuditLog`), report data (uses existing views/TVFs).

Migration 04 is idempotent — verified by running it twice.

---

## 3. Configuration

**No connection string is hard-coded anywhere.** It is read exclusively through `IConfiguration`, and startup throws if absent.

`appsettings.json`:

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=.;Database=DSRResourceManagement;Trusted_Connection=True;TrustServerCertificate=True"
  },
  "Jwt": { "Issuer": "...", "Audience": "...", "SigningKey": "<32+ bytes>", "AccessTokenMinutes": 60, "RefreshTokenDays": 14 },
  "AzureAd": { "Enabled": false, "TenantId": "...", "ClientId": "..." },
  "Cors": { "AllowedOrigins": [ "http://localhost:5173" ] }
}
```

**Production overrides** — never commit secrets:

```bash
setx ConnectionStrings__DefaultConnection "Server=...;Database=DSRResourceManagement;..."
setx Jwt__SigningKey "<from Key Vault>"
# or: dotnet user-secrets set "Jwt:SigningKey" "<value>"
```

`Jwt:SigningKey` is validated at startup: under 32 bytes and the app refuses to start (HS256 requires it). `Cors:AllowedOrigins` must be populated — an empty list throws rather than silently allowing any origin.

---

## 4. Running locally

```bash
# API  →  http://localhost:5199  (Swagger at /swagger)
cd app/src/DSR.API && dotnet run

# Client  →  http://localhost:5173  (proxies /api to 5199)
cd app/client && npm install && npm run dev
```

Sign in with any seeded DATABASE account after running script 05:

| Email | Roles | Password |
|---|---|---|
| `admin@contoso.com` | ADMIN, EMPLOYEE | `Dsr@Admin#2026` |
| `priya.sharma@contoso.com` | EMPLOYEE | `Dsr@Admin#2026` |

`manager@contoso.com` and `imran.khan@contoso.com` are SSO-only and correctly have no password credential.

> Script 05 sets `MustChangePassword = 0` for development. With it set to 1 the first sign-in forces
> a password change, which rotates the hash and makes the password above stop working — so the next
> attempt fails with *"Invalid email address or password"* until the script is re-run. Flip
> `@ForcePasswordChange = 1` inside the script only when you specifically want to exercise that flow.
> Note the `-I` flag on sqlcmd: QUOTED_IDENTIFIER must be ON.

> `.NET 9 note`: projects target `net9.0` as specified. `DSR.API.csproj` sets `RollForward=LatestMajor` so it also runs where only a newer runtime (e.g. .NET 10) is installed. Remove that property to pin hard to the 9.0 runtime.

### Ports are pinned — keep three files in step

`src/DSR.API/Properties/launchSettings.json` fixes the API to **`http://localhost:5199`**. This matters because `dotnet run` reads `applicationUrl` from that file and it **overrides `ASPNETCORE_URLS`**. If the file is missing the SDK regenerates it with random ports (e.g. `52399/52400`), and the API then binds a port that neither the Vite proxy nor the CORS policy knows about.

| File | Setting | Value |
|---|---|---|
| `src/DSR.API/Properties/launchSettings.json` | `applicationUrl` | `http://localhost:5199` |
| `client/vite.config.js` | `proxy['/api'].target` | `http://127.0.0.1:5199` |
| `src/DSR.API/appsettings.json` | `Cors:AllowedOrigins` | `http://localhost:5173` |

The proxy targets `127.0.0.1` rather than `localhost` deliberately: Node 17+ resolves `localhost` to `::1` first on Windows, which can miss a Kestrel listener bound only to the IPv4 loopback.

### Troubleshooting: build fails with "the file is locked by DSR.API"

MSBuild cannot overwrite `bin\Debug\net9.0\*.dll` while the API is running, because the running
process holds those assemblies open. Stop it first, or let `dotnet watch` manage the lifecycle:

```powershell
.\dev.ps1 stop      # kill the API, free the DLL locks and port 5199
.\dev.ps1 build     # stop, then build
.\dev.ps1 run       # stop, build, run
.\dev.ps1 watch     # recommended: dotnet watch run, rebuilds on change with no lock conflicts
.\dev.ps1 client    # React dev server
.\dev.ps1 status    # what is running, and on which ports
```

`dev.ps1 stop` only targets `dotnet` processes whose command line references `DSR.API`, so an
unrelated dotnet process elsewhere on the machine is left alone.

### Dependency security

The build is clean of NuGet advisories (`0` NU1902/NU1903 warnings). Two package versions are
pinned for security and must not be casually downgraded:

| Package | Pinned | Why |
|---|---|---|
| `HtmlSanitizer` | `9.2.995` | `8.2.871-beta` carries GHSA-j92c-7v7g-gj3f (moderate). This package is the stored-XSS defence, so it is the last one to leave unpatched. |
| `AutoMapper` | `15.1.3` | GHSA-rvv3-g6hj-g44x (**high**, DoS via uncontrolled recursion) affects everything below `15.1.1`, including `13.0.1` and `14.0.0`. |

> **AutoMapper licence — needs a procurement decision.** From `15.0.0` AutoMapper is commercially
> licensed (free below a published revenue threshold). If that is unacceptable, removal is cheap:
> **nothing in this solution actually calls `IMapper`** — every read path uses explicit LINQ
> projections so EF Core translates them to SQL. Deleting `MappingProfile` and the package
> reference is a no-op functionally. Staying on `14.0.0` to avoid the licence is *not* a safe
> option, as it reintroduces the high-severity advisory.

### Troubleshooting: `POST /api/auth/login` returns 500

Almost always **the API is not running**. Vite answers with a bare `500` when its proxy target is unreachable, which looks like a server-side bug in the DSR code. The proxy now intercepts this and returns a `502` in the normal response envelope instead:

```json
{ "succeeded": false, "message": "The API is not running on http://127.0.0.1:5199. Start it with: cd src/DSR.API && dotnet run" }
```

Checklist:
1. `curl http://127.0.0.1:5199/health/live` → expect `Healthy`. If it fails, start the API.
2. Confirm the bind: `netstat -ano | findstr :5199` → expect two LISTENING rows (IPv4 + IPv6).
3. Port already in use? A stray `dotnet` process from a previous run:
   `Get-Process dotnet | Stop-Process -Force`
4. Passwords not seeded? A genuine `401` (not `500`) with *"Invalid email address or password"* means script `05_Set_Dev_Passwords.sql` has not been run.

---

## 5. The DSR grain (the central design decision)

One row per **work entry**. Each entry belongs to exactly one project, and an employee may log as
many entries as they like — including several against the *same* project — timesheet style. There is
no header/detail payload and no batch endpoint; each Save is one POST.

```
POST /api/dsr  { workDate: 2026-08-11, projectId: 1, estimatedHours: 4, ... }  # Project A - API Development
POST /api/dsr  { workDate: 2026-08-11, projectId: 1, estimatedHours: 2, ... }  # Project A - Unit Testing
POST /api/dsr  { workDate: 2026-08-11, projectId: 1, estimatedHours: 1, ... }  # Project A - Bug Fixing
POST /api/dsr  { workDate: 2026-08-11, projectId: 2, estimatedHours: 1, ... }  # Project B - Code review
GET  /api/dsr/day/2026-08-11  →  4 entries, totalHours 8, ONE AI declaration
```

### The only limit on a day: the employee's `StandardDailyHours`

Nothing caps how many entries exist, or how often a project repeats. The single rule is:

```
TotalLoggedHours + NewEntryHours  <=  Users.StandardDailyHours
```

It is **per employee**, not global: a part-timer on 6 hours is capped at 6 while a colleague on 8 is
capped at 8. Enforced in `DsrEntryService.EnsureDailyHoursCapAsync` (friendly message, exact
remaining hours) and independently by `trg_DSREntries_DailyRules` (error 51001) so a direct database
insert cannot bypass it.

Rules that deliberately still apply: per-entry hours must be 0–24 (`CK_DSREntries_HoursRange`,
data sanity, not the daily cap); one "No Work Done" declaration per day and never alongside real
work; effort only inside a project's window and only on `ACTIVE`/`COMPLETED` projects; no future
dates; the back-dating window.

> **Changed in migration 06.** The system previously allowed only one entry per project per day and
> hid a project from the dropdown once used. `UQ_DSREntries_User_Date_Project_Active` enforced that
> and has been dropped, replaced by the non-unique `IX_DSREntries_User_Date_Project` so query plans
> do not regress. `trg_DSREntries_DailyRules` now validates against `Users.StandardDailyHours`
> instead of the global `DSR.MaxDailyHours` setting. A rollback script is at the foot of migration 06.

**AI usage is day-grained.** It travels on the entry payload because the UI captures it on the same form, but the service *upserts* one `DailyAiUsage` row per `(user, date)`. A second save on the same date updates that declaration rather than creating another — which is what makes "Project A says AI=Yes, Project B says AI=No on the same day" structurally impossible.

---

## 6. Role permissions

**Employees have no report rights of any kind.** All eight `/api/reports/*` endpoints — including CSV
export and the missing-DSR view — require ADMIN or MANAGER. This is enforced once with
`[Authorize(Roles = RoleCodes.AdminOrManager)]` at the `ReportsController` class level, so a report
added later cannot accidentally be left open to Employees.

| Capability | Employee | Manager | Admin |
|---|:--:|:--:|:--:|
| Record / edit / delete own DSR | ✅ | ✅ | ✅ |
| Own DSR history (`GET /api/dsr`) | ✅ | ✅ | ✅ |
| Own dashboard (`/dashboard/employee`) | ✅ | ✅ | ✅ |
| **Any report** (`/api/reports/*`) | **❌ 403** | ✅ | ✅ |
| **CSV export** | **❌ 403** | ✅ | ✅ |
| **Missing-DSR compliance view** | **❌ 403** | ✅ | ✅ |
| Team dashboard | ❌ 403 | ✅ | ✅ |
| Organisation dashboard | ❌ 403 | ❌ 403 | ✅ |
| View user list | ❌ 403 | ✅ (own team) | ✅ (all) |
| Create / edit users, reset passwords | ❌ 403 | ❌ 403 | ✅ |
| Create / edit projects, settings | ❌ 403 | ❌ 403 | ✅ |
| Resource allocations | ❌ 403 | ✅ | ✅ |

An Employee therefore sees only their own recorded work — the DSR form, their own history, and a
personal dashboard of their own hours. Those are data-entry views over their own rows, not reports.
If that personal dashboard should also be withdrawn, remove the `/dashboard/employee` route and
change `DashboardController.Employee` to `[Authorize(Roles = RoleCodes.AdminOrManager)]`.

Row-level scope still applies **on top of** the role check: a Manager's reports return only their
direct reports, never the whole organisation. Role checks and row scope are independent layers.

The client hides the Reports navigation item and guards the `/reports` route for Employees, but that
is UX only — the API rejects the request regardless of what the SPA renders.

## 7. Security posture

| Concern | Implementation |
|---|---|
| Passwords | PBKDF2-SHA256, 210,000 iterations, 128-bit salt, 256-bit key. Versioned hash format allows transparent work-factor upgrade on next login. Constant-time comparison. |
| SSO identity matching | On the Entra `oid` claim **only** — never email. `CK_Users_SsoRequiresExternalId` guarantees SSO accounts carry one, so the lookup cannot fall through to email matching. |
| Refresh tokens | Only the SHA-256 hash is stored. Rotated on every use; replaying a rotated token revokes the entire family. |
| Session invalidation | Password change, admin reset and deactivation all revoke every live refresh token immediately. |
| Horizontal scope | `ICurrentUser` is the only identity source. Employee → own rows; Manager → direct reports; Admin → all. Applied **before** any client filter so a filter cannot widen scope. |
| Vertical scope | `[Authorize(Roles = …)]` on every privileged endpoint, verified returning 403. |
| Stored XSS | HTML sanitised **on write** with a tag allow-list; `KeepChildNodes = false` so a `<script>` subtree is dropped rather than unwrapped. A plain-text copy is stored for search/export. |
| Lockout | Configurable failed-attempt threshold and lockout window; login audit records every attempt including unknown emails. |
| Error leakage | Internal details logged, never returned. Clients get a stable message plus a trace id. |
| CSV injection | Values starting `= + - @` are prefixed with an apostrophe on export. |

---

## 8. Verification performed

Live calls against the running API and real SQL Server.

**Working:** database + SSO-less login, `/auth/me`, DSR metadata, the three-project scenario, day view with running total and single AI declaration, edit, soft delete, DSR history with paging/filtering/search, all six reports, missing-DSR, all three dashboards, CSV export (correct headers + BOM), refresh-token rotation, users/projects/settings administration.

**Validation rules — all rejected correctly:** future date · hours > 24 · hours ≤ 0 on a work entry · missing project · missing description · AI answer omitted · AI=Yes with no tool · No-Work-Done with hours · No-Work-Done alongside work entries · duplicate project on the same date (409) · daily total above the cap (422, with remaining hours in the message) · effort on an ON_HOLD project · back-dating beyond the configured window.

**Authorisation:** Employee → 403 on admin/manager dashboards, user list and project creation; 200 on their own dashboard. Cross-employee data access blocked; DSR history returned only the caller's rows for an Employee vs. all rows for an Admin.

### Defects found by running it, and fixed

1. **`QUOTED_IDENTIFIER OFF`** — persisted computed column and all 10 filtered indexes failed (Msg 1934). Now set explicitly in every SQL script.
2. **Triggers vs. EF `OUTPUT` clause** — every `INSERT` into `DSREntries` failed (Msg 334). Fixed with `HasTrigger(...)` on the three trigger-bearing tables so EF uses `SCOPE_IDENTITY()`.
3. **Silent trigger no-ops** — both business triggers opened with `SET NOCOUNT ON` before `IF @@ROWCOUNT = 0 RETURN`, and any `SET` resets `@@ROWCOUNT`, disabling them. Now guard on `inserted`.
4. **Index script not re-runnable** — Msg 1913 on second run, fatal in CI. Now drops its own indexes first.
5. **XSS unwrapping** — `<script>alert(1)</script>` was stripped to the text `alert(1)`. `KeepChildNodes` now false.
6. **Roles always empty in the user list** — `Select(u => Project(u))` called a static method, which EF evaluates client-side over un-Included navigations. Replaced with a translatable `Expression`.
7. **Future dates counted as "missing DSR"** — a 1–31 Aug filter run on the 10th reported every remaining working day as non-compliance (37 vs 7). Window now clamped to today.
8. **Service account in reports** — the SYSTEM row appeared in utilisation and missing-DSR. Added `Users.IsServiceAccount` and filtered both TVFs.

---

## 9. Deployment

**API (IIS / Azure App Service):**
```bash
dotnet publish src/DSR.API -c Release -o ./publish
```
Set `ConnectionStrings__DefaultConnection`, `Jwt__SigningKey`, `Cors__AllowedOrigins__0`, `ASPNETCORE_ENVIRONMENT=Production`. HSTS and HTTPS redirection activate automatically outside Development. Grant the app's SQL login `SELECT/INSERT/UPDATE` on schema `dsr` and `EXECUTE` on the two TVFs — **withhold `DELETE`**, since the model is soft-delete only.

**Client:**
```bash
cd client && npm ci && npm run build     # → client/dist
```
Serve `dist` from any static host; set `VITE_API_BASE_URL` to the API origin and add that origin to `Cors:AllowedOrigins`. Configure the host to rewrite unknown paths to `index.html` for client-side routing.

**Health probes:** `/health/live` (process) and `/health/ready` (database).

---

## 10. Not yet done

Stated plainly so nothing is assumed complete:

1. **Entra ID token acquisition in the browser.** The server side is finished — validation against tenant signing keys, `oid` matching, auto-provisioning, group→role mapping — and `POST /auth/sso-login` works. The client needs `@azure/msal-browser` wired to `signInWithSso()`; the button is disabled until `VITE_AZURE_CLIENT_ID` is set so it cannot fail silently.
2. **Automated tests.** Verification above was performed by live API calls, not a committed test suite. Recommend xUnit + `WebApplicationFactory` integration tests over the validation matrix in §7, plus Vitest for the client.
3. **AI tools and holiday admin screens.** The API endpoints exist and are exercised; no dedicated React pages yet (settings, users and projects do have them).
4. **No UI design file was supplied** — I searched `C:\Amrit\Projects\DSR\` for images/Figma/PPT and found none. The DSR screen was built from the field list in the requirements. Expect visual rework once the design is available.
5. **Charts.** Dashboards and the AI report present tabular and stat-tile data; no charting library is included.
