/*==============================================================================================
  DSR & RESOURCE MANAGEMENT SYSTEM  --  SQL SERVER SCHEMA (DDL)
  ----------------------------------------------------------------------------------------------
  Source            : DSR_Resource_Management_System_BRD_v2.docx  (cross-checked against v3)
  Target platform   : SQL Server 2019+ (uses ISJSON, SYSUTCDATETIME, filtered indexes)
  Author            : Solution / Database Architecture
  Version           : 1.0
  ----------------------------------------------------------------------------------------------
  DESIGN DECISIONS THAT DIFFER FROM BRD v2 (see design document, Section 1):
    1. DSR is a SINGLE FLAT TABLE (DSREntries). BRD v2's "DSR + DSRTask" header/detail pair is
       NOT implemented: it contradicts v2's own DSR Business Flow paragraph, is corrected by
       BRD v3 ("Each DSR record stores a single project work entry"), and is excluded by the
       explicit build instruction. One row = one employee + one date + one project.
    2. BRD v2 validation "One DSR per employee per day" is implemented as
       one entry per employee per DATE per PROJECT (UQ_DSREntries_User_Date_Project).
    3. AI usage is day-grained (BRD v2 lists it as a DSR *header* field), so it lives in
       DailyAiUsage keyed (UserId, WorkDate). Storing it on every DSREntries row would be a
       partial dependency on part of the candidate key and permits contradictory rows for the
       same day. This is NOT a DSR master table -- DSREntries has no FK to it.
    4. AI Tool Name is normalised to AiTools. Free text would make the AI Usage Report and
       "AI adoption metrics" dashboard unaggregatable.
  ----------------------------------------------------------------------------------------------
  CONVENTIONS
    - Surrogate PK named "Id", INT IDENTITY(1,1). BIGINT only on the two append-only log tables.
    - All timestamps are DATETIME2(3) in UTC (SYSUTCDATETIME()). Convert in the presentation tier.
    - Money/effort: DECIMAL, never FLOAT.
    - Soft delete via IsActive. Natural-key uniqueness therefore uses FILTERED unique indexes
      (WHERE IsActive = 1) so a deactivated row does not permanently block its natural key.
    - Audit columns on every table: CreatedByUserId, CreatedDate, ModifiedByUserId,
      ModifiedDate, IsActive.
    - CreatedByUserId is NOT NULL everywhere and FK'd to Users. The bootstrap SYSTEM user
      (Users.Id = 1) is inserted with a self-reference; run 02_Seed_SampleData.sql before any
      other insert.
  ==============================================================================================*/

/*  REQUIRED SET OPTIONS. Persisted computed columns (Users.FullName) and filtered indexes
    cannot be created unless both of these are ON. sqlcmd defaults QUOTED_IDENTIFIER to OFF,
    so they are set explicitly here rather than relying on the client. */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

/*----------------------------------------------------------------------------------------------
  0. DATABASE  (optional -- comment out if deploying into an existing database)
----------------------------------------------------------------------------------------------*/
IF DB_ID(N'DSRResourceManagement') IS NULL
BEGIN
    CREATE DATABASE [DSRResourceManagement];
END
GO
ALTER DATABASE [DSRResourceManagement] SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;
GO
USE [DSRResourceManagement];
GO

/*----------------------------------------------------------------------------------------------
  1. SCHEMA
----------------------------------------------------------------------------------------------*/
IF SCHEMA_ID(N'dsr') IS NULL EXEC(N'CREATE SCHEMA [dsr] AUTHORIZATION [dbo];');
GO

/*==============================================================================================
  2. IDENTITY & ACCESS
  ==============================================================================================*/

/*----------------------------------------------------------------------------------------------
  Users -- employees, managers and admins. Created FIRST because every other table's audit
  columns reference it. Self-references (ManagerUserId, CreatedByUserId) allow the bootstrap row.
----------------------------------------------------------------------------------------------*/
CREATE TABLE dsr.Users
(
    Id                      INT             IDENTITY(1,1)   NOT NULL,
    EmployeeCode            NVARCHAR(30)                        NULL,   -- NULL for the SYSTEM/service account
    FirstName               NVARCHAR(100)                   NOT NULL,
    LastName                NVARCHAR(100)                   NOT NULL,
    FullName                AS (LTRIM(RTRIM(FirstName + N' ' + LastName))) PERSISTED,
    Email                   NVARCHAR(256)                   NOT NULL,
    AuthenticationType      NVARCHAR(20)                    NOT NULL    CONSTRAINT DF_Users_AuthenticationType DEFAULT (N'DATABASE'),
    ExternalObjectId        NVARCHAR(100)                       NULL,   -- Microsoft Entra ID objectId (oid claim)
    ExternalTenantId        NVARCHAR(100)                       NULL,   -- Entra tenant id (tid claim)
    ManagerUserId           INT                                 NULL,   -- reporting line; drives Manager Dashboard scope
    Designation             NVARCHAR(100)                       NULL,
    IsServiceAccount        BIT                             NOT NULL    CONSTRAINT DF_Users_IsServiceAccount DEFAULT (0),
    StandardDailyHours      DECIMAL(4,2)                    NOT NULL    CONSTRAINT DF_Users_StandardDailyHours DEFAULT (8.00),
    DateOfJoining           DATE                                NULL,
    DateOfExit              DATE                                NULL,
    LastLoginDate           DATETIME2(3)                        NULL,
    CreatedByUserId         INT                             NOT NULL,
    CreatedDate             DATETIME2(3)                    NOT NULL    CONSTRAINT DF_Users_CreatedDate DEFAULT (SYSUTCDATETIME()),
    ModifiedByUserId        INT                                 NULL,
    ModifiedDate            DATETIME2(3)                        NULL,
    IsActive                BIT                             NOT NULL    CONSTRAINT DF_Users_IsActive DEFAULT (1),

    CONSTRAINT PK_Users PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT FK_Users_ManagerUser       FOREIGN KEY (ManagerUserId)    REFERENCES dsr.Users(Id),
    CONSTRAINT FK_Users_CreatedByUser     FOREIGN KEY (CreatedByUserId)  REFERENCES dsr.Users(Id),
    CONSTRAINT FK_Users_ModifiedByUser    FOREIGN KEY (ModifiedByUserId) REFERENCES dsr.Users(Id),
    CONSTRAINT CK_Users_AuthenticationType CHECK (AuthenticationType IN (N'SSO', N'DATABASE', N'BOTH')),
    CONSTRAINT CK_Users_SsoRequiresExternalId CHECK (AuthenticationType = N'DATABASE' OR ExternalObjectId IS NOT NULL),
    CONSTRAINT CK_Users_NotOwnManager     CHECK (ManagerUserId IS NULL OR ManagerUserId <> Id),
    CONSTRAINT CK_Users_StandardDailyHours CHECK (StandardDailyHours > 0 AND StandardDailyHours <= 24),
    CONSTRAINT CK_Users_ExitAfterJoining  CHECK (DateOfExit IS NULL OR DateOfJoining IS NULL OR DateOfExit >= DateOfJoining),
    -- A service account is never a person: it cannot file DSRs and is excluded from all
    -- utilization and compliance reporting.
    CONSTRAINT CK_Users_ServiceAccountNoEmployeeCode CHECK (IsServiceAccount = 0 OR EmployeeCode IS NULL),
    CONSTRAINT CK_Users_EmailFormat       CHECK (Email LIKE N'%_@_%._%'),
    CONSTRAINT CK_Users_ModifiedPair      CHECK ((ModifiedByUserId IS NULL AND ModifiedDate IS NULL)
                                              OR (ModifiedByUserId IS NOT NULL AND ModifiedDate IS NOT NULL))
);
GO

/*----------------------------------------------------------------------------------------------
  Roles -- Employee / Manager / Admin (BRD "User Roles"). IsSystemRole protects the three
  built-ins from being renamed or deactivated by an Admin.
----------------------------------------------------------------------------------------------*/
CREATE TABLE dsr.Roles
(
    Id                      INT             IDENTITY(1,1)   NOT NULL,
    RoleCode                NVARCHAR(30)                    NOT NULL,
    RoleName                NVARCHAR(50)                    NOT NULL,
    Description             NVARCHAR(250)                       NULL,
    IsSystemRole            BIT                             NOT NULL    CONSTRAINT DF_Roles_IsSystemRole DEFAULT (0),
    CreatedByUserId         INT                             NOT NULL,
    CreatedDate             DATETIME2(3)                    NOT NULL    CONSTRAINT DF_Roles_CreatedDate DEFAULT (SYSUTCDATETIME()),
    ModifiedByUserId        INT                                 NULL,
    ModifiedDate            DATETIME2(3)                        NULL,
    IsActive                BIT                             NOT NULL    CONSTRAINT DF_Roles_IsActive DEFAULT (1),

    CONSTRAINT PK_Roles PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT UQ_Roles_RoleCode UNIQUE (RoleCode),
    CONSTRAINT FK_Roles_CreatedByUser  FOREIGN KEY (CreatedByUserId)  REFERENCES dsr.Users(Id),
    CONSTRAINT FK_Roles_ModifiedByUser FOREIGN KEY (ModifiedByUserId) REFERENCES dsr.Users(Id),
    CONSTRAINT CK_Roles_RoleCodeUpper  CHECK (RoleCode = UPPER(RoleCode) AND RoleCode NOT LIKE N'% %')
);
GO

/*----------------------------------------------------------------------------------------------
  UserRoles -- resolves the M:N between Users and Roles. A user may hold more than one role
  (e.g. a Manager who also files their own DSRs).
----------------------------------------------------------------------------------------------*/
CREATE TABLE dsr.UserRoles
(
    Id                      INT             IDENTITY(1,1)   NOT NULL,
    UserId                  INT                             NOT NULL,
    RoleId                  INT                             NOT NULL,
    AssignedDate            DATETIME2(3)                    NOT NULL    CONSTRAINT DF_UserRoles_AssignedDate DEFAULT (SYSUTCDATETIME()),
    CreatedByUserId         INT                             NOT NULL,
    CreatedDate             DATETIME2(3)                    NOT NULL    CONSTRAINT DF_UserRoles_CreatedDate DEFAULT (SYSUTCDATETIME()),
    ModifiedByUserId        INT                                 NULL,
    ModifiedDate            DATETIME2(3)                        NULL,
    IsActive                BIT                             NOT NULL    CONSTRAINT DF_UserRoles_IsActive DEFAULT (1),

    CONSTRAINT PK_UserRoles PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT UQ_UserRoles_User_Role UNIQUE (UserId, RoleId),
    CONSTRAINT FK_UserRoles_User           FOREIGN KEY (UserId) REFERENCES dsr.Users(Id),
    CONSTRAINT FK_UserRoles_Role           FOREIGN KEY (RoleId) REFERENCES dsr.Roles(Id),
    CONSTRAINT FK_UserRoles_CreatedByUser  FOREIGN KEY (CreatedByUserId)  REFERENCES dsr.Users(Id),
    CONSTRAINT FK_UserRoles_ModifiedByUser FOREIGN KEY (ModifiedByUserId) REFERENCES dsr.Users(Id)
);
GO

/*----------------------------------------------------------------------------------------------
  UserCredentials -- DATABASE LOGIN ONLY. Split 1:1 from Users so that (a) SSO-only users carry
  no NULL password columns, (b) the hash can be permission-separated from the profile row, and
  (c) lockout counters are updated without touching the hot Users row.
  SSO login requires no row here; it is resolved by Users.ExternalObjectId.
----------------------------------------------------------------------------------------------*/
CREATE TABLE dsr.UserCredentials
(
    Id                      INT             IDENTITY(1,1)   NOT NULL,
    UserId                  INT                             NOT NULL,
    PasswordHash            NVARCHAR(500)                   NOT NULL,   -- ASP.NET Core PasswordHasher (PBKDF2, base64)
    SecurityStamp           UNIQUEIDENTIFIER                NOT NULL    CONSTRAINT DF_UserCredentials_SecurityStamp DEFAULT (NEWID()),
    PasswordChangedDate     DATETIME2(3)                        NULL,
    MustChangePassword      BIT                             NOT NULL    CONSTRAINT DF_UserCredentials_MustChangePassword DEFAULT (0),
    FailedLoginAttempts     INT                             NOT NULL    CONSTRAINT DF_UserCredentials_FailedLoginAttempts DEFAULT (0),
    LockoutEndDate          DATETIME2(3)                        NULL,
    CreatedByUserId         INT                             NOT NULL,
    CreatedDate             DATETIME2(3)                    NOT NULL    CONSTRAINT DF_UserCredentials_CreatedDate DEFAULT (SYSUTCDATETIME()),
    ModifiedByUserId        INT                                 NULL,
    ModifiedDate            DATETIME2(3)                        NULL,
    IsActive                BIT                             NOT NULL    CONSTRAINT DF_UserCredentials_IsActive DEFAULT (1),

    CONSTRAINT PK_UserCredentials PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT UQ_UserCredentials_UserId UNIQUE (UserId),          -- enforces 1:1
    CONSTRAINT FK_UserCredentials_User           FOREIGN KEY (UserId) REFERENCES dsr.Users(Id),
    CONSTRAINT FK_UserCredentials_CreatedByUser  FOREIGN KEY (CreatedByUserId)  REFERENCES dsr.Users(Id),
    CONSTRAINT FK_UserCredentials_ModifiedByUser FOREIGN KEY (ModifiedByUserId) REFERENCES dsr.Users(Id),
    CONSTRAINT CK_UserCredentials_FailedAttempts CHECK (FailedLoginAttempts >= 0),
    CONSTRAINT CK_UserCredentials_HashLength     CHECK (LEN(PasswordHash) >= 20)
);
GO

/*----------------------------------------------------------------------------------------------
  UserLoginAudit -- append-only. Covers both authentication paths, including failed attempts
  for an email that does not exist (UserId NULL). Required for the security posture the BRD
  implies but does not state.
  BIGINT PK justified: one row per authentication attempt, unbounded growth, never joined by Id.
----------------------------------------------------------------------------------------------*/
CREATE TABLE dsr.UserLoginAudit
(
    Id                      BIGINT          IDENTITY(1,1)   NOT NULL,
    UserId                  INT                                 NULL,
    AttemptedEmail          NVARCHAR(256)                   NOT NULL,
    AuthenticationType      NVARCHAR(20)                    NOT NULL,
    IsSuccessful            BIT                             NOT NULL,
    FailureReason           NVARCHAR(200)                       NULL,
    IpAddress               NVARCHAR(45)                        NULL,   -- IPv6-capable
    UserAgent               NVARCHAR(400)                       NULL,
    AttemptDate             DATETIME2(3)                    NOT NULL    CONSTRAINT DF_UserLoginAudit_AttemptDate DEFAULT (SYSUTCDATETIME()),
    CreatedByUserId         INT                             NOT NULL,
    CreatedDate             DATETIME2(3)                    NOT NULL    CONSTRAINT DF_UserLoginAudit_CreatedDate DEFAULT (SYSUTCDATETIME()),
    ModifiedByUserId        INT                                 NULL,   -- never populated: append-only
    ModifiedDate            DATETIME2(3)                        NULL,   -- never populated: append-only
    IsActive                BIT                             NOT NULL    CONSTRAINT DF_UserLoginAudit_IsActive DEFAULT (1),

    CONSTRAINT PK_UserLoginAudit PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT FK_UserLoginAudit_User          FOREIGN KEY (UserId) REFERENCES dsr.Users(Id),
    CONSTRAINT FK_UserLoginAudit_CreatedByUser FOREIGN KEY (CreatedByUserId) REFERENCES dsr.Users(Id),
    CONSTRAINT CK_UserLoginAudit_AuthType      CHECK (AuthenticationType IN (N'SSO', N'DATABASE')),
    CONSTRAINT CK_UserLoginAudit_FailureReason CHECK (IsSuccessful = 1 OR FailureReason IS NOT NULL)
);
GO

/*==============================================================================================
  3. MASTER / CONFIGURATION DATA
  ==============================================================================================*/

/*----------------------------------------------------------------------------------------------
  Projects -- BRD "Project Management": Name, Code, Description, Start Date, End Date, Status.
  Status is a CHECK-constrained code rather than a lookup table: the set is small, fixed and
  not described as Admin-maintainable. See design document Section 9 for the lookup alternative.
----------------------------------------------------------------------------------------------*/
CREATE TABLE dsr.Projects
(
    Id                      INT             IDENTITY(1,1)   NOT NULL,
    ProjectCode             NVARCHAR(30)                    NOT NULL,
    ProjectName             NVARCHAR(200)                   NOT NULL,
    Description             NVARCHAR(1000)                      NULL,
    StartDate               DATE                            NOT NULL,
    EndDate                 DATE                                NULL,   -- NULL = open-ended
    Status                  NVARCHAR(20)                    NOT NULL    CONSTRAINT DF_Projects_Status DEFAULT (N'PLANNED'),
    ProjectManagerUserId    INT                                 NULL,   -- owner for the Project Report
    CreatedByUserId         INT                             NOT NULL,
    CreatedDate             DATETIME2(3)                    NOT NULL    CONSTRAINT DF_Projects_CreatedDate DEFAULT (SYSUTCDATETIME()),
    ModifiedByUserId        INT                                 NULL,
    ModifiedDate            DATETIME2(3)                        NULL,
    IsActive                BIT                             NOT NULL    CONSTRAINT DF_Projects_IsActive DEFAULT (1),

    CONSTRAINT PK_Projects PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT FK_Projects_ProjectManagerUser FOREIGN KEY (ProjectManagerUserId) REFERENCES dsr.Users(Id),
    CONSTRAINT FK_Projects_CreatedByUser      FOREIGN KEY (CreatedByUserId)  REFERENCES dsr.Users(Id),
    CONSTRAINT FK_Projects_ModifiedByUser     FOREIGN KEY (ModifiedByUserId) REFERENCES dsr.Users(Id),
    CONSTRAINT CK_Projects_Status    CHECK (Status IN (N'PLANNED', N'ACTIVE', N'ON_HOLD', N'COMPLETED', N'CANCELLED')),
    CONSTRAINT CK_Projects_DateOrder CHECK (EndDate IS NULL OR EndDate >= StartDate),
    CONSTRAINT CK_Projects_CodeNoSpaces CHECK (ProjectCode NOT LIKE N'% %')
);
GO

/*----------------------------------------------------------------------------------------------
  ProjectAllocations -- EMPLOYEE RESOURCE TRACKING. Planned capacity: who is assigned to which
  project, at what percentage, over which window. This is the DENOMINATOR of the Resource
  Utilization Report (actual DSR hours / planned capacity); without it "utilization" can only
  ever be reported as raw hours.
----------------------------------------------------------------------------------------------*/
CREATE TABLE dsr.ProjectAllocations
(
    Id                      INT             IDENTITY(1,1)   NOT NULL,
    ProjectId               INT                             NOT NULL,
    UserId                  INT                             NOT NULL,
    AllocationPercentage    DECIMAL(5,2)                    NOT NULL    CONSTRAINT DF_ProjectAllocations_AllocationPercentage DEFAULT (100.00),
    AllocationStartDate     DATE                            NOT NULL,
    AllocationEndDate       DATE                                NULL,   -- NULL = until further notice
    ProjectRole             NVARCHAR(100)                       NULL,   -- e.g. Developer, QA, BA
    CreatedByUserId         INT                             NOT NULL,
    CreatedDate             DATETIME2(3)                    NOT NULL    CONSTRAINT DF_ProjectAllocations_CreatedDate DEFAULT (SYSUTCDATETIME()),
    ModifiedByUserId        INT                                 NULL,
    ModifiedDate            DATETIME2(3)                        NULL,
    IsActive                BIT                             NOT NULL    CONSTRAINT DF_ProjectAllocations_IsActive DEFAULT (1),

    CONSTRAINT PK_ProjectAllocations PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT FK_ProjectAllocations_Project          FOREIGN KEY (ProjectId) REFERENCES dsr.Projects(Id),
    CONSTRAINT FK_ProjectAllocations_User             FOREIGN KEY (UserId)    REFERENCES dsr.Users(Id),
    CONSTRAINT FK_ProjectAllocations_CreatedByUser    FOREIGN KEY (CreatedByUserId)  REFERENCES dsr.Users(Id),
    CONSTRAINT FK_ProjectAllocations_ModifiedByUser   FOREIGN KEY (ModifiedByUserId) REFERENCES dsr.Users(Id),
    CONSTRAINT CK_ProjectAllocations_Percentage CHECK (AllocationPercentage > 0 AND AllocationPercentage <= 100),
    CONSTRAINT CK_ProjectAllocations_DateOrder  CHECK (AllocationEndDate IS NULL OR AllocationEndDate >= AllocationStartDate)
);
GO

/*----------------------------------------------------------------------------------------------
  AiTools -- normalised "AI Tool Name". Prevents "Copilot"/"GitHub Copilot"/"co-pilot" from
  fragmenting the AI Usage Report and AI adoption metrics.
----------------------------------------------------------------------------------------------*/
CREATE TABLE dsr.AiTools
(
    Id                      INT             IDENTITY(1,1)   NOT NULL,
    ToolName                NVARCHAR(100)                   NOT NULL,
    Vendor                  NVARCHAR(100)                       NULL,
    Category                NVARCHAR(30)                        NULL,
    CreatedByUserId         INT                             NOT NULL,
    CreatedDate             DATETIME2(3)                    NOT NULL    CONSTRAINT DF_AiTools_CreatedDate DEFAULT (SYSUTCDATETIME()),
    ModifiedByUserId        INT                                 NULL,
    ModifiedDate            DATETIME2(3)                        NULL,
    IsActive                BIT                             NOT NULL    CONSTRAINT DF_AiTools_IsActive DEFAULT (1),

    CONSTRAINT PK_AiTools PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT FK_AiTools_CreatedByUser  FOREIGN KEY (CreatedByUserId)  REFERENCES dsr.Users(Id),
    CONSTRAINT FK_AiTools_ModifiedByUser FOREIGN KEY (ModifiedByUserId) REFERENCES dsr.Users(Id),
    CONSTRAINT CK_AiTools_Category CHECK (Category IS NULL OR Category IN
                (N'CODE_ASSISTANT', N'CHAT_LLM', N'TESTING', N'DOCUMENTATION', N'DESIGN', N'OTHER'))
);
GO

/*----------------------------------------------------------------------------------------------
  Holidays -- required by the Manager Dashboard's "missing DSRs" metric. Without a holiday
  calendar every weekend and public holiday is reported as a compliance failure.
----------------------------------------------------------------------------------------------*/
CREATE TABLE dsr.Holidays
(
    Id                      INT             IDENTITY(1,1)   NOT NULL,
    HolidayDate             DATE                            NOT NULL,
    HolidayName             NVARCHAR(100)                   NOT NULL,
    IsOptional              BIT                             NOT NULL    CONSTRAINT DF_Holidays_IsOptional DEFAULT (0),
    CreatedByUserId         INT                             NOT NULL,
    CreatedDate             DATETIME2(3)                    NOT NULL    CONSTRAINT DF_Holidays_CreatedDate DEFAULT (SYSUTCDATETIME()),
    ModifiedByUserId        INT                                 NULL,
    ModifiedDate            DATETIME2(3)                        NULL,
    IsActive                BIT                             NOT NULL    CONSTRAINT DF_Holidays_IsActive DEFAULT (1),

    CONSTRAINT PK_Holidays PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT FK_Holidays_CreatedByUser  FOREIGN KEY (CreatedByUserId)  REFERENCES dsr.Users(Id),
    CONSTRAINT FK_Holidays_ModifiedByUser FOREIGN KEY (ModifiedByUserId) REFERENCES dsr.Users(Id)
);
GO

/*----------------------------------------------------------------------------------------------
  AppSettings -- BRD "Admin: ... and system settings". Key/value so operational rules
  (working days, daily hour cap, DSR back-dating window) are tunable without a release.
----------------------------------------------------------------------------------------------*/
CREATE TABLE dsr.AppSettings
(
    Id                      INT             IDENTITY(1,1)   NOT NULL,
    SettingKey              NVARCHAR(100)                   NOT NULL,
    SettingValue            NVARCHAR(500)                   NOT NULL,
    DataType                NVARCHAR(20)                    NOT NULL    CONSTRAINT DF_AppSettings_DataType DEFAULT (N'STRING'),
    Description             NVARCHAR(300)                       NULL,
    IsEditable              BIT                             NOT NULL    CONSTRAINT DF_AppSettings_IsEditable DEFAULT (1),
    CreatedByUserId         INT                             NOT NULL,
    CreatedDate             DATETIME2(3)                    NOT NULL    CONSTRAINT DF_AppSettings_CreatedDate DEFAULT (SYSUTCDATETIME()),
    ModifiedByUserId        INT                                 NULL,
    ModifiedDate            DATETIME2(3)                        NULL,
    IsActive                BIT                             NOT NULL    CONSTRAINT DF_AppSettings_IsActive DEFAULT (1),

    CONSTRAINT PK_AppSettings PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT UQ_AppSettings_SettingKey UNIQUE (SettingKey),
    CONSTRAINT FK_AppSettings_CreatedByUser  FOREIGN KEY (CreatedByUserId)  REFERENCES dsr.Users(Id),
    CONSTRAINT FK_AppSettings_ModifiedByUser FOREIGN KEY (ModifiedByUserId) REFERENCES dsr.Users(Id),
    CONSTRAINT CK_AppSettings_DataType CHECK (DataType IN (N'STRING', N'INT', N'DECIMAL', N'BOOL', N'DATE', N'JSON'))
);
GO

/*==============================================================================================
  4. TRANSACTIONAL CORE
  ==============================================================================================*/

/*----------------------------------------------------------------------------------------------
  DSREntries -- THE FLAT DSR GRAIN.  One row = one employee + one work date + one project.
  This is the BRD's "DSR" entity. There is deliberately NO DSRTask child table.

      10-Aug-2026  Project A  4.00 h   -> row 1
      10-Aug-2026  Project B  2.00 h   -> row 2
      10-Aug-2026  Project C  2.00 h   -> row 3

  ProjectId is NULLABLE for one reason only: a "No Work Done" declaration has no project.
  CK_DSREntries_ProjectRequired makes ProjectId mandatory for every real work entry.
----------------------------------------------------------------------------------------------*/
CREATE TABLE dsr.DSREntries
(
    Id                      INT             IDENTITY(1,1)   NOT NULL,
    UserId                  INT                             NOT NULL,
    WorkDate                DATE                            NOT NULL,
    ProjectId               INT                                 NULL,   -- NULL only when IsNoWorkDone = 1
    EstimatedHours          DECIMAL(4,2)                    NOT NULL    CONSTRAINT DF_DSREntries_EstimatedHours DEFAULT (0),
    IsNoWorkDone            BIT                             NOT NULL    CONSTRAINT DF_DSREntries_IsNoWorkDone DEFAULT (0),
    WorkDescriptionHtml     NVARCHAR(MAX)                       NULL,   -- rich text as authored
    WorkDescriptionPlain    NVARCHAR(MAX)                       NULL,   -- tag-stripped copy for search/export
    CreatedByUserId         INT                             NOT NULL,
    CreatedDate             DATETIME2(3)                    NOT NULL    CONSTRAINT DF_DSREntries_CreatedDate DEFAULT (SYSUTCDATETIME()),
    ModifiedByUserId        INT                                 NULL,
    ModifiedDate            DATETIME2(3)                        NULL,
    IsActive                BIT                             NOT NULL    CONSTRAINT DF_DSREntries_IsActive DEFAULT (1),

    CONSTRAINT PK_DSREntries PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT FK_DSREntries_User           FOREIGN KEY (UserId)    REFERENCES dsr.Users(Id),
    CONSTRAINT FK_DSREntries_Project        FOREIGN KEY (ProjectId) REFERENCES dsr.Projects(Id),
    CONSTRAINT FK_DSREntries_CreatedByUser  FOREIGN KEY (CreatedByUserId)  REFERENCES dsr.Users(Id),
    CONSTRAINT FK_DSREntries_ModifiedByUser FOREIGN KEY (ModifiedByUserId) REFERENCES dsr.Users(Id),

    -- BRD: "Hours must be between 0 and 24"
    CONSTRAINT CK_DSREntries_HoursRange       CHECK (EstimatedHours >= 0 AND EstimatedHours <= 24),
    -- BRD: "If No Work Done is checked, hours become 0"
    CONSTRAINT CK_DSREntries_NoWorkZeroHours  CHECK (IsNoWorkDone = 0 OR EstimatedHours = 0),
    -- BRD: "Project selection is mandatory for normal work entries"
    CONSTRAINT CK_DSREntries_ProjectRequired  CHECK (IsNoWorkDone = 1 OR ProjectId IS NOT NULL),
    -- A real work entry must record more than zero hours
    CONSTRAINT CK_DSREntries_WorkHasHours     CHECK (IsNoWorkDone = 1 OR EstimatedHours > 0),
    -- BRD: "Future dates not allowed". Server-UTC guard; the app must also validate in the
    -- user's timezone (see design document Section 9, risk R4).
    CONSTRAINT CK_DSREntries_NoFutureDate     CHECK (WorkDate <= CAST(SYSUTCDATETIME() AS DATE)),
    CONSTRAINT CK_DSREntries_ModifiedPair     CHECK ((ModifiedByUserId IS NULL AND ModifiedDate IS NULL)
                                                  OR (ModifiedByUserId IS NOT NULL AND ModifiedDate IS NOT NULL))
);
GO

/*----------------------------------------------------------------------------------------------
  DailyAiUsage -- BRD v2 DSR HEADER fields: "AI Used Today (Yes/No), AI Tool Name (shown when
  AI is Yes), AI Usage Remarks". Grain is (Employee, WorkDate): the declaration is about the
  DAY, not about one project line. Keyed uniquely so the same day cannot be simultaneously
  "AI = Yes" and "AI = No".
----------------------------------------------------------------------------------------------*/
CREATE TABLE dsr.DailyAiUsage
(
    Id                      INT             IDENTITY(1,1)   NOT NULL,
    UserId                  INT                             NOT NULL,
    WorkDate                DATE                            NOT NULL,
    IsAiUsed                BIT                             NOT NULL,
    AiToolId                INT                                 NULL,   -- mandatory when IsAiUsed = 1
    UsageRemarks            NVARCHAR(1000)                      NULL,
    CreatedByUserId         INT                             NOT NULL,
    CreatedDate             DATETIME2(3)                    NOT NULL    CONSTRAINT DF_DailyAiUsage_CreatedDate DEFAULT (SYSUTCDATETIME()),
    ModifiedByUserId        INT                                 NULL,
    ModifiedDate            DATETIME2(3)                        NULL,
    IsActive                BIT                             NOT NULL    CONSTRAINT DF_DailyAiUsage_IsActive DEFAULT (1),

    CONSTRAINT PK_DailyAiUsage PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT UQ_DailyAiUsage_User_WorkDate UNIQUE (UserId, WorkDate),
    CONSTRAINT FK_DailyAiUsage_User           FOREIGN KEY (UserId)   REFERENCES dsr.Users(Id),
    CONSTRAINT FK_DailyAiUsage_AiTool         FOREIGN KEY (AiToolId) REFERENCES dsr.AiTools(Id),
    CONSTRAINT FK_DailyAiUsage_CreatedByUser  FOREIGN KEY (CreatedByUserId)  REFERENCES dsr.Users(Id),
    CONSTRAINT FK_DailyAiUsage_ModifiedByUser FOREIGN KEY (ModifiedByUserId) REFERENCES dsr.Users(Id),
    -- BRD: "AI Tool Name (shown when AI is Yes)" -> tool required iff AI used
    CONSTRAINT CK_DailyAiUsage_ToolMatchesFlag CHECK ((IsAiUsed = 1 AND AiToolId IS NOT NULL)
                                                   OR (IsAiUsed = 0 AND AiToolId IS NULL)),
    CONSTRAINT CK_DailyAiUsage_NoFutureDate    CHECK (WorkDate <= CAST(SYSUTCDATETIME() AS DATE))
);
GO

/*----------------------------------------------------------------------------------------------
  AuditLog -- centralised field-level change history (requirement: "Audit Information").
  The per-row audit columns answer "who last touched this"; this table answers "what changed".
  Append-only: no UPDATE/DELETE path is provided.
  BIGINT PK justified: highest-volume table in the schema, never joined by Id.
----------------------------------------------------------------------------------------------*/
CREATE TABLE dsr.AuditLog
(
    Id                      BIGINT          IDENTITY(1,1)   NOT NULL,
    EntityName              NVARCHAR(100)                   NOT NULL,
    EntityId                INT                             NOT NULL,
    ActionType              NVARCHAR(20)                    NOT NULL,
    OldValues               NVARCHAR(MAX)                       NULL,   -- JSON
    NewValues               NVARCHAR(MAX)                       NULL,   -- JSON
    ChangedByUserId         INT                             NOT NULL,
    ChangedDate             DATETIME2(3)                    NOT NULL    CONSTRAINT DF_AuditLog_ChangedDate DEFAULT (SYSUTCDATETIME()),
    IpAddress               NVARCHAR(45)                        NULL,
    CreatedByUserId         INT                             NOT NULL,
    CreatedDate             DATETIME2(3)                    NOT NULL    CONSTRAINT DF_AuditLog_CreatedDate DEFAULT (SYSUTCDATETIME()),
    ModifiedByUserId        INT                                 NULL,   -- never populated: append-only
    ModifiedDate            DATETIME2(3)                        NULL,   -- never populated: append-only
    IsActive                BIT                             NOT NULL    CONSTRAINT DF_AuditLog_IsActive DEFAULT (1),

    CONSTRAINT PK_AuditLog PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT FK_AuditLog_ChangedByUser FOREIGN KEY (ChangedByUserId) REFERENCES dsr.Users(Id),
    CONSTRAINT FK_AuditLog_CreatedByUser FOREIGN KEY (CreatedByUserId) REFERENCES dsr.Users(Id),
    CONSTRAINT CK_AuditLog_ActionType CHECK (ActionType IN (N'INSERT', N'UPDATE', N'DELETE')),
    CONSTRAINT CK_AuditLog_OldValuesJson CHECK (OldValues IS NULL OR ISJSON(OldValues) = 1),
    CONSTRAINT CK_AuditLog_NewValuesJson CHECK (NewValues IS NULL OR ISJSON(NewValues) = 1),
    CONSTRAINT CK_AuditLog_PayloadPresent CHECK (
             (ActionType = N'INSERT' AND NewValues IS NOT NULL)
          OR (ActionType = N'DELETE' AND OldValues IS NOT NULL)
          OR (ActionType = N'UPDATE' AND OldValues IS NOT NULL AND NewValues IS NOT NULL))
);
GO
PRINT N'>> Tables created.';
GO
