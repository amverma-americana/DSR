/*==============================================================================================
  DSR & RESOURCE MANAGEMENT SYSTEM  --  SEED + SAMPLE DATA
  Run AFTER DSR_Schema_DDL.sql and DSR_Indexes_Views_Triggers.sql
  ----------------------------------------------------------------------------------------------
  PART 1 (seed)   : mandatory reference data -- deploy to ALL environments including PRODUCTION.
  PART 2 (sample) : demonstration transactions -- DEV/QA ONLY. Guarded by @LoadSampleData.
  ----------------------------------------------------------------------------------------------
  Bootstrap note: Users.Id = 1 is the SYSTEM account. It is inserted with a self-referencing
  CreatedByUserId, which satisfies FK_Users_CreatedByUser within the same statement. Every
  other row in the database can then be attributed to a real user.
  ==============================================================================================*/
USE [DSRResourceManagement];
GO
/*  REQUIRED: inserts touch tables carrying filtered indexes and a persisted computed column. */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

DECLARE @LoadSampleData BIT = 1;        -- <<< SET TO 0 FOR PRODUCTION DEPLOYMENTS

BEGIN TRY
    BEGIN TRANSACTION;

    /*==========================================================================================
      PART 1 -- SEED DATA (all environments)
      ==========================================================================================*/

    /*---- 1.1 Bootstrap SYSTEM user (self-referencing audit) --------------------------------*/
    IF NOT EXISTS (SELECT 1 FROM dsr.Users WHERE Email = N'system@dsr.local')
    BEGIN
        SET IDENTITY_INSERT dsr.Users ON;
        INSERT INTO dsr.Users
            (Id, EmployeeCode, FirstName, LastName, Email, AuthenticationType,
             ExternalObjectId, ManagerUserId, Designation, IsServiceAccount,
             StandardDailyHours, DateOfJoining, CreatedByUserId, IsActive)
        VALUES
            (1, NULL, N'System', N'Account', N'system@dsr.local', N'DATABASE',
             NULL, NULL, N'Service Account', 1,
             8.00, NULL, 1, 1);    -- CreatedByUserId = 1 = its own Id
        SET IDENTITY_INSERT dsr.Users OFF;
        PRINT N'   Seeded SYSTEM user (Id = 1).';
    END

    /*---- 1.2 Roles (BRD "User Roles") -----------------------------------------------------*/
    INSERT INTO dsr.Roles (RoleCode, RoleName, Description, IsSystemRole, CreatedByUserId)
    SELECT v.RoleCode, v.RoleName, v.Description, 1, 1
    FROM (VALUES
        (N'EMPLOYEE', N'Employee', N'Creates and manages own DSR entries.'),
        (N'MANAGER',  N'Manager',  N'Views team reports, utilization and AI adoption for direct reports.'),
        (N'ADMIN',    N'Admin',    N'Manages users, projects, roles and system settings.')
    ) v (RoleCode, RoleName, Description)
    WHERE NOT EXISTS (SELECT 1 FROM dsr.Roles r WHERE r.RoleCode = v.RoleCode);

    /*---- 1.3 AppSettings -- operational rules that must be tunable without a release ------*/
    INSERT INTO dsr.AppSettings (SettingKey, SettingValue, DataType, Description, IsEditable, CreatedByUserId)
    SELECT v.SettingKey, v.SettingValue, v.DataType, v.Description, v.IsEditable, 1
    FROM (VALUES
        (N'DSR.MaxDailyHours',          N'24',    N'DECIMAL', N'Maximum total DSR hours an employee may log on one date.', 1),
        (N'DSR.BackDateWindowDays',     N'7',     N'INT',     N'How many days back a DSR entry may be created or edited.', 1),
        (N'DSR.AllowEditAfterLock',     N'false', N'BOOL',    N'Whether Admin may edit a DSR entry past the back-date window.', 1),
        (N'DSR.RequireDescription',     N'true',  N'BOOL',    N'Whether the rich-text description is mandatory for work entries.', 1),
        (N'Calendar.WeekendDays',       N'6,7',   N'STRING',  N'ISO weekday numbers treated as non-working (6=Sat, 7=Sun).', 1),
        (N'Auth.MaxFailedAttempts',     N'5',     N'INT',     N'Failed DATABASE-login attempts before lockout.', 1),
        (N'Auth.LockoutMinutes',        N'15',    N'INT',     N'Lockout duration in minutes.', 1),
        (N'Auth.AllowDatabaseLogin',    N'true',  N'BOOL',    N'Global kill-switch for the DATABASE authentication path.', 1),
        (N'Report.DefaultPeriodDays',   N'30',    N'INT',     N'Default reporting window on dashboards.', 1),
        (N'Utilization.TargetPct',      N'85',    N'DECIMAL', N'Target utilization percentage used for RAG colouring.', 1)
    ) v (SettingKey, SettingValue, DataType, Description, IsEditable)
    WHERE NOT EXISTS (SELECT 1 FROM dsr.AppSettings s WHERE s.SettingKey = v.SettingKey);

    /*---- 1.4 AI tools master (BRD "AI Tool Name") ----------------------------------------*/
    INSERT INTO dsr.AiTools (ToolName, Vendor, Category, CreatedByUserId)
    SELECT v.ToolName, v.Vendor, v.Category, 1
    FROM (VALUES
        (N'GitHub Copilot',    N'GitHub / Microsoft', N'CODE_ASSISTANT'),
        (N'Claude',            N'Anthropic',          N'CHAT_LLM'),
        (N'ChatGPT',           N'OpenAI',             N'CHAT_LLM'),
        (N'Microsoft 365 Copilot', N'Microsoft',      N'DOCUMENTATION'),
        (N'Cursor',            N'Anysphere',          N'CODE_ASSISTANT'),
        (N'Figma AI',          N'Figma',              N'DESIGN'),
        (N'Other',             NULL,                  N'OTHER')
    ) v (ToolName, Vendor, Category)
    WHERE NOT EXISTS (SELECT 1 FROM dsr.AiTools t WHERE t.ToolName = v.ToolName);

    PRINT N'>> PART 1 seed data applied.';

    /*==========================================================================================
      PART 2 -- SAMPLE DATA (DEV / QA ONLY)
      ==========================================================================================*/
    IF @LoadSampleData = 1
    BEGIN
        DECLARE @AdminId INT, @MgrId INT, @Emp1Id INT, @Emp2Id INT;
        DECLARE @RoleEmp INT = (SELECT Id FROM dsr.Roles WHERE RoleCode = N'EMPLOYEE');
        DECLARE @RoleMgr INT = (SELECT Id FROM dsr.Roles WHERE RoleCode = N'MANAGER');
        DECLARE @RoleAdm INT = (SELECT Id FROM dsr.Roles WHERE RoleCode = N'ADMIN');

        /*---- 2.1 Users: one of each authentication path -----------------------------------*/

        -- Admin, DATABASE login
        IF NOT EXISTS (SELECT 1 FROM dsr.Users WHERE Email = N'admin@contoso.com')
        INSERT INTO dsr.Users (EmployeeCode, FirstName, LastName, Email, AuthenticationType,
                               Designation, StandardDailyHours, DateOfJoining, CreatedByUserId)
        VALUES (N'EMP-0001', N'Aditi', N'Rao', N'admin@contoso.com', N'DATABASE',
                N'System Administrator', 8.00, '2023-01-09', 1);
        SET @AdminId = (SELECT Id FROM dsr.Users WHERE Email = N'admin@contoso.com');

        -- Manager, SSO login (Entra ID)
        IF NOT EXISTS (SELECT 1 FROM dsr.Users WHERE Email = N'manager@contoso.com')
        INSERT INTO dsr.Users (EmployeeCode, FirstName, LastName, Email, AuthenticationType,
                               ExternalObjectId, ExternalTenantId, Designation,
                               StandardDailyHours, DateOfJoining, CreatedByUserId)
        VALUES (N'EMP-0002', N'Rahul', N'Menon', N'manager@contoso.com', N'SSO',
                N'8f3c1a90-4d2e-4b77-9a15-6c0e5b21d7f4', N'c1a7e0b2-9f44-4d13-8b6a-2e5f70c9a318',
                N'Delivery Manager', 8.00, '2022-06-01', @AdminId);
        SET @MgrId = (SELECT Id FROM dsr.Users WHERE Email = N'manager@contoso.com');

        -- Employee 1, BOTH paths
        IF NOT EXISTS (SELECT 1 FROM dsr.Users WHERE Email = N'priya.sharma@contoso.com')
        INSERT INTO dsr.Users (EmployeeCode, FirstName, LastName, Email, AuthenticationType,
                               ExternalObjectId, ExternalTenantId, ManagerUserId, Designation,
                               StandardDailyHours, DateOfJoining, CreatedByUserId)
        VALUES (N'EMP-0003', N'Priya', N'Sharma', N'priya.sharma@contoso.com', N'BOTH',
                N'2b9d4c11-7e35-42aa-b0c8-91f6d3e45a27', N'c1a7e0b2-9f44-4d13-8b6a-2e5f70c9a318',
                @MgrId, N'Senior Software Engineer', 8.00, '2024-02-19', @AdminId);
        SET @Emp1Id = (SELECT Id FROM dsr.Users WHERE Email = N'priya.sharma@contoso.com');

        -- Employee 2, SSO only, 6-hour standard day (part-time -> proves capacity is per-employee)
        IF NOT EXISTS (SELECT 1 FROM dsr.Users WHERE Email = N'imran.khan@contoso.com')
        INSERT INTO dsr.Users (EmployeeCode, FirstName, LastName, Email, AuthenticationType,
                               ExternalObjectId, ExternalTenantId, ManagerUserId, Designation,
                               StandardDailyHours, DateOfJoining, CreatedByUserId)
        VALUES (N'EMP-0004', N'Imran', N'Khan', N'imran.khan@contoso.com', N'SSO',
                N'6e21f7a3-0c58-4d94-8b3f-45a7c2e91d60', N'c1a7e0b2-9f44-4d13-8b6a-2e5f70c9a318',
                @MgrId, N'QA Engineer', 6.00, '2025-03-03', @AdminId);
        SET @Emp2Id = (SELECT Id FROM dsr.Users WHERE Email = N'imran.khan@contoso.com');

        /*---- 2.2 Credentials -- ONLY for users whose AuthenticationType allows DB login ---*/
        -- Hash shown is an illustrative ASP.NET Core PasswordHasher (v3) output. Replace on load.
        INSERT INTO dsr.UserCredentials (UserId, PasswordHash, MustChangePassword, CreatedByUserId)
        SELECT u.Id,
               N'AQAAAAIAAYagAAAAEL9Xk3rQ2mJ8pV6tYwZs1nH4bG7dK0cF5aR3uT8eW2xQ9yN6mB1vC4oP7sD5fJ0gLw==',
               1, 1
        FROM   dsr.Users u
        WHERE  u.AuthenticationType IN (N'DATABASE', N'BOTH')
          AND  u.Email <> N'system@dsr.local'
          AND  NOT EXISTS (SELECT 1 FROM dsr.UserCredentials c WHERE c.UserId = u.Id);

        /*---- 2.3 Role assignments (note: the Manager also holds EMPLOYEE) ----------------*/
        INSERT INTO dsr.UserRoles (UserId, RoleId, CreatedByUserId)
        SELECT v.UserId, v.RoleId, 1
        FROM (VALUES
            (@AdminId, @RoleAdm), (@AdminId, @RoleEmp),
            (@MgrId,   @RoleMgr), (@MgrId,   @RoleEmp),
            (@Emp1Id,  @RoleEmp),
            (@Emp2Id,  @RoleEmp)
        ) v (UserId, RoleId)
        WHERE NOT EXISTS (SELECT 1 FROM dsr.UserRoles ur
                          WHERE ur.UserId = v.UserId AND ur.RoleId = v.RoleId);

        /*---- 2.4 Projects ----------------------------------------------------------------*/
        INSERT INTO dsr.Projects (ProjectCode, ProjectName, Description, StartDate, EndDate,
                                  Status, ProjectManagerUserId, CreatedByUserId)
        SELECT v.ProjectCode, v.ProjectName, v.Description, v.StartDate, v.EndDate,
               v.Status, @MgrId, @AdminId
        FROM (VALUES
            (N'PRJ-A', N'Project A - Customer Portal',   N'Customer self-service portal rebuild.',      CAST('2026-01-05' AS DATE), CAST('2026-12-31' AS DATE), N'ACTIVE'),
            (N'PRJ-B', N'Project B - Billing Engine',    N'Billing and invoicing platform migration.',  CAST('2026-02-02' AS DATE), CAST('2026-11-30' AS DATE), N'ACTIVE'),
            (N'PRJ-C', N'Project C - Mobile App',        N'Cross-platform mobile application.',         CAST('2026-03-16' AS DATE), NULL,                       N'ACTIVE'),
            (N'PRJ-D', N'Project D - Data Platform',     N'Enterprise reporting and data warehouse.',   CAST('2026-06-01' AS DATE), NULL,                       N'ON_HOLD'),
            (N'PRJ-E', N'Project E - Legacy Retirement', N'Decommission of the legacy CRM.',            CAST('2025-04-01' AS DATE), CAST('2026-01-31' AS DATE), N'COMPLETED')
        ) v (ProjectCode, ProjectName, Description, StartDate, EndDate, Status)
        WHERE NOT EXISTS (SELECT 1 FROM dsr.Projects p WHERE p.ProjectCode = v.ProjectCode);

        DECLARE @PrjA INT = (SELECT Id FROM dsr.Projects WHERE ProjectCode = N'PRJ-A');
        DECLARE @PrjB INT = (SELECT Id FROM dsr.Projects WHERE ProjectCode = N'PRJ-B');
        DECLARE @PrjC INT = (SELECT Id FROM dsr.Projects WHERE ProjectCode = N'PRJ-C');

        /*---- 2.5 Resource allocations (capacity denominator) -----------------------------*/
        INSERT INTO dsr.ProjectAllocations (ProjectId, UserId, AllocationPercentage,
                                            AllocationStartDate, AllocationEndDate, ProjectRole, CreatedByUserId)
        SELECT v.ProjectId, v.UserId, v.Pct, v.StartDate, v.EndDate, v.ProjectRole, @MgrId
        FROM (VALUES
            (@PrjA, @Emp1Id, CAST(50.00 AS DECIMAL(5,2)), CAST('2026-01-05' AS DATE), NULL, N'Senior Developer'),
            (@PrjB, @Emp1Id, CAST(30.00 AS DECIMAL(5,2)), CAST('2026-02-02' AS DATE), NULL, N'Developer'),
            (@PrjC, @Emp1Id, CAST(20.00 AS DECIMAL(5,2)), CAST('2026-03-16' AS DATE), NULL, N'Developer'),
            (@PrjA, @Emp2Id, CAST(60.00 AS DECIMAL(5,2)), CAST('2026-03-03' AS DATE), NULL, N'QA Engineer'),
            (@PrjC, @Emp2Id, CAST(40.00 AS DECIMAL(5,2)), CAST('2026-03-16' AS DATE), NULL, N'QA Engineer')
        ) v (ProjectId, UserId, Pct, StartDate, EndDate, ProjectRole)
        WHERE NOT EXISTS (SELECT 1 FROM dsr.ProjectAllocations a
                          WHERE a.ProjectId = v.ProjectId AND a.UserId = v.UserId
                            AND a.AllocationStartDate = v.StartDate);

        /*---- 2.6 Holidays ----------------------------------------------------------------*/
        INSERT INTO dsr.Holidays (HolidayDate, HolidayName, IsOptional, CreatedByUserId)
        SELECT v.HolidayDate, v.HolidayName, v.IsOptional, @AdminId
        FROM (VALUES
            (CAST('2026-01-01' AS DATE), N'New Year''s Day',    CAST(0 AS BIT)),
            (CAST('2026-01-26' AS DATE), N'Republic Day',       CAST(0 AS BIT)),
            (CAST('2026-08-15' AS DATE), N'Independence Day',   CAST(0 AS BIT)),
            (CAST('2026-10-02' AS DATE), N'Gandhi Jayanti',     CAST(0 AS BIT)),
            (CAST('2026-11-09' AS DATE), N'Diwali (optional)',  CAST(1 AS BIT)),
            (CAST('2026-12-25' AS DATE), N'Christmas Day',      CAST(0 AS BIT))
        ) v (HolidayDate, HolidayName, IsOptional)
        WHERE NOT EXISTS (SELECT 1 FROM dsr.Holidays h WHERE h.HolidayDate = v.HolidayDate);

        /*==========================================================================
          2.7 THE CANONICAL BRD SCENARIO
          10-Aug-2026, Priya Sharma:  Project A 4h | Project B 2h | Project C 2h
          Three SEPARATE DSREntries rows, one AI declaration for the day.
          ==========================================================================*/
        DECLARE @D1 DATE = '2026-08-10';   -- Monday
        DECLARE @D2 DATE = '2026-08-07';   -- Friday
        DECLARE @D3 DATE = '2026-08-06';   -- Thursday

        INSERT INTO dsr.DSREntries (UserId, WorkDate, ProjectId, EstimatedHours, IsNoWorkDone,
                                    WorkDescriptionHtml, WorkDescriptionPlain, CreatedByUserId)
        SELECT v.UserId, v.WorkDate, v.ProjectId, v.Hours, v.NoWork, v.Html, v.Plain, v.UserId
        FROM (VALUES
            -- 10-Aug-2026: the three-project day from the BRD example
            (@Emp1Id, @D1, @PrjA, CAST(4.00 AS DECIMAL(4,2)), CAST(0 AS BIT),
                N'<p>Implemented <strong>OAuth refresh-token rotation</strong> and unit tests.</p>',
                N'Implemented OAuth refresh-token rotation and unit tests.'),
            (@Emp1Id, @D1, @PrjB, CAST(2.00 AS DECIMAL(4,2)), CAST(0 AS BIT),
                N'<p>Reviewed invoice rounding defects; raised 3 bugs.</p>',
                N'Reviewed invoice rounding defects; raised 3 bugs.'),
            (@Emp1Id, @D1, @PrjC, CAST(2.00 AS DECIMAL(4,2)), CAST(0 AS BIT),
                N'<p>Sprint planning and API contract walkthrough.</p>',
                N'Sprint planning and API contract walkthrough.'),
            -- 07-Aug-2026: single-project day
            (@Emp1Id, @D2, @PrjA, CAST(8.00 AS DECIMAL(4,2)), CAST(0 AS BIT),
                N'<p>Built the <em>account summary</em> screen end to end.</p>',
                N'Built the account summary screen end to end.'),
            -- 06-Aug-2026: NO WORK DONE -- project NULL, hours 0 (proves the CHECK constraints)
            (@Emp1Id, @D3, NULL,  CAST(0.00 AS DECIMAL(4,2)), CAST(1 AS BIT),
                N'<p>Sick leave.</p>', N'Sick leave.'),
            -- Second employee, 6-hour standard day
            (@Emp2Id, @D1, @PrjA, CAST(3.50 AS DECIMAL(4,2)), CAST(0 AS BIT),
                N'<p>Regression suite execution for release 2.4.</p>',
                N'Regression suite execution for release 2.4.'),
            (@Emp2Id, @D1, @PrjC, CAST(2.50 AS DECIMAL(4,2)), CAST(0 AS BIT),
                N'<p>Authored 14 mobile test cases.</p>', N'Authored 14 mobile test cases.'),
            (@Emp2Id, @D2, @PrjA, CAST(6.00 AS DECIMAL(4,2)), CAST(0 AS BIT),
                N'<p>Defect triage and retest.</p>', N'Defect triage and retest.')
        ) v (UserId, WorkDate, ProjectId, Hours, NoWork, Html, Plain)
        WHERE NOT EXISTS (SELECT 1 FROM dsr.DSREntries d
                          WHERE d.UserId = v.UserId AND d.WorkDate = v.WorkDate
                            AND ISNULL(d.ProjectId, -1) = ISNULL(v.ProjectId, -1));

        /*---- 2.8 Daily AI declarations -- ONE per employee per date ----------------------*/
        DECLARE @Copilot INT = (SELECT Id FROM dsr.AiTools WHERE ToolName = N'GitHub Copilot');
        DECLARE @Claude  INT = (SELECT Id FROM dsr.AiTools WHERE ToolName = N'Claude');

        INSERT INTO dsr.DailyAiUsage (UserId, WorkDate, IsAiUsed, AiToolId, UsageRemarks, CreatedByUserId)
        SELECT v.UserId, v.WorkDate, v.IsAiUsed, v.AiToolId, v.Remarks, v.UserId
        FROM (VALUES
            (@Emp1Id, @D1, CAST(1 AS BIT), @Copilot, N'Generated unit-test scaffolding; saved roughly 1 hour.'),
            (@Emp1Id, @D2, CAST(1 AS BIT), @Claude,  N'Used for API contract review and edge-case discovery.'),
            (@Emp1Id, @D3, CAST(0 AS BIT), NULL,     N'On leave.'),
            (@Emp2Id, @D1, CAST(0 AS BIT), NULL,     NULL),
            (@Emp2Id, @D2, CAST(1 AS BIT), @Copilot, N'Test-data generation.')
        ) v (UserId, WorkDate, IsAiUsed, AiToolId, Remarks)
        WHERE NOT EXISTS (SELECT 1 FROM dsr.DailyAiUsage a
                          WHERE a.UserId = v.UserId AND a.WorkDate = v.WorkDate);

        /*---- 2.9 Login audit + change-history examples -----------------------------------*/
        INSERT INTO dsr.UserLoginAudit (UserId, AttemptedEmail, AuthenticationType, IsSuccessful,
                                        FailureReason, IpAddress, UserAgent, CreatedByUserId)
        VALUES
            (@Emp1Id, N'priya.sharma@contoso.com', N'SSO',      1, NULL,                 N'10.14.2.51', N'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 1),
            (@AdminId,N'admin@contoso.com',        N'DATABASE', 1, NULL,                 N'10.14.2.10', N'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 1),
            (NULL,    N'unknown@contoso.com',      N'DATABASE', 0, N'User not found',     N'203.0.113.9', N'curl/8.4.0', 1);

        INSERT INTO dsr.AuditLog (EntityName, EntityId, ActionType, OldValues, NewValues,
                                  ChangedByUserId, IpAddress, CreatedByUserId)
        SELECT N'DSREntries', d.Id, N'UPDATE',
               N'{"EstimatedHours":3.00}', N'{"EstimatedHours":4.00}',
               @Emp1Id, N'10.14.2.51', @Emp1Id
        FROM   dsr.DSREntries d
        WHERE  d.UserId = @Emp1Id AND d.WorkDate = @D1 AND d.ProjectId = @PrjA;

        PRINT N'>> PART 2 sample data applied.';
    END
    ELSE
        PRINT N'>> PART 2 skipped (@LoadSampleData = 0).';

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT N'!! Seed failed: ' + ERROR_MESSAGE() + N' (line ' + CAST(ERROR_LINE() AS NVARCHAR(10)) + N')';
    THROW;
END CATCH
GO

/*==============================================================================================
  VERIFICATION -- prove the BRD's core scenario and each report path
  ==============================================================================================*/
PRINT N'';
PRINT N'--- 1. BRD scenario: three separate entries on 10-Aug-2026 -------------------------';
SELECT EmployeeName, WorkDate, ProjectName, EstimatedHours, AiToolName
FROM   dsr.vw_DsrEntryDetail
WHERE  WorkDate = '2026-08-10'
ORDER BY EmployeeName, ProjectName;

PRINT N'--- 2. Employee Dashboard: daily totals --------------------------------------------';
SELECT EmployeeName, WorkDate, EntryCount, ProjectCount, TotalHours, DayUtilizationPct
FROM   dsr.vw_DsrDailySummary
ORDER BY WorkDate DESC, EmployeeName;

PRINT N'--- 3. Project Report: effort per project ------------------------------------------';
SELECT ProjectCode, ProjectName, ProjectStatus, ContributorCount, TotalHours
FROM   dsr.vw_ProjectEffortSummary
ORDER BY TotalHours DESC;

PRINT N'--- 4. AI Usage Report: adoption per day -------------------------------------------';
SELECT WorkDate, DeclarationCount, AiUsedCount, AiAdoptionPct, DistinctToolsUsed
FROM   dsr.vw_AiAdoptionDaily
ORDER BY WorkDate DESC;

PRINT N'--- 5. Resource Utilization Report (Aug-2026) --------------------------------------';
SELECT EmployeeName, WorkingDaysInPeriod, CapacityHours, PlannedHours, LoggedHours, UtilizationPct
FROM   dsr.fn_GetResourceUtilization('2026-08-01', '2026-08-31')
ORDER BY UtilizationPct DESC;

PRINT N'--- 6. Manager Dashboard: missing DSRs, first week of Aug-2026 ---------------------';
SELECT EmployeeName, MissingDate
FROM   dsr.fn_GetMissingDsrDays('2026-08-03', '2026-08-11', NULL)
ORDER BY EmployeeName, MissingDate;
GO

/*==============================================================================================
  NEGATIVE TESTS -- each statement below MUST fail. Run manually to prove the constraints.
  ==============================================================================================*/
/*
-- (a) Hours > 24  -> CK_DSREntries_HoursRange
INSERT INTO dsr.DSREntries (UserId, WorkDate, ProjectId, EstimatedHours, CreatedByUserId)
VALUES (3, '2026-08-05', 1, 25.00, 3);

-- (b) Future date  -> CK_DSREntries_NoFutureDate
INSERT INTO dsr.DSREntries (UserId, WorkDate, ProjectId, EstimatedHours, CreatedByUserId)
VALUES (3, '2099-01-01', 1, 4.00, 3);

-- (c) No Work Done with hours  -> CK_DSREntries_NoWorkZeroHours
INSERT INTO dsr.DSREntries (UserId, WorkDate, ProjectId, EstimatedHours, IsNoWorkDone, CreatedByUserId)
VALUES (3, '2026-08-05', NULL, 4.00, 1, 3);

-- (d) Work entry with no project  -> CK_DSREntries_ProjectRequired
INSERT INTO dsr.DSREntries (UserId, WorkDate, ProjectId, EstimatedHours, IsNoWorkDone, CreatedByUserId)
VALUES (3, '2026-08-05', NULL, 4.00, 0, 3);

-- (e) Duplicate project on the same date  -> UQ_DSREntries_User_Date_Project_Active
INSERT INTO dsr.DSREntries (UserId, WorkDate, ProjectId, EstimatedHours, CreatedByUserId)
VALUES (3, '2026-08-10', 1, 1.00, 3);

-- (f) AI = Yes with no tool  -> CK_DailyAiUsage_ToolMatchesFlag
INSERT INTO dsr.DailyAiUsage (UserId, WorkDate, IsAiUsed, AiToolId, CreatedByUserId)
VALUES (3, '2026-08-04', 1, NULL, 3);

-- (g) Two AI declarations for one employee-day  -> UQ_DailyAiUsage_User_WorkDate
INSERT INTO dsr.DailyAiUsage (UserId, WorkDate, IsAiUsed, AiToolId, CreatedByUserId)
VALUES (3, '2026-08-10', 0, NULL, 3);

-- (h) Daily total over the cap  -> trg_DSREntries_DailyRules (51001)
INSERT INTO dsr.DSREntries (UserId, WorkDate, ProjectId, EstimatedHours, CreatedByUserId)
VALUES (3, '2026-08-07', 2, 20.00, 3);

-- (i) Effort against an ON_HOLD project  -> trg_DSREntries_ProjectWindow (51003)
INSERT INTO dsr.DSREntries (UserId, WorkDate, ProjectId, EstimatedHours, CreatedByUserId)
VALUES (3, '2026-08-05', (SELECT Id FROM dsr.Projects WHERE ProjectCode='PRJ-D'), 2.00, 3);

-- (j) Tamper with the audit log  -> trg_AuditLog_PreventChange (51010)
DELETE FROM dsr.AuditLog;
*/
