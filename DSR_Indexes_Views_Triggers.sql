/*==============================================================================================
  DSR & RESOURCE MANAGEMENT SYSTEM  --  INDEXES, REPORTING OBJECTS, CROSS-ROW INTEGRITY
  Run AFTER DSR_Schema_DDL.sql
  ==============================================================================================*/
USE [DSRResourceManagement];
GO
/*  REQUIRED for filtered indexes, indexed views and computed-column indexes. */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

/*==============================================================================================
  SECTION 0 -- IDEMPOTENCY
  Makes this script safely re-runnable in a deployment pipeline. Drops every nonclustered index
  in the dsr schema that this script owns, then recreates them below.
  Deliberately EXCLUDES primary keys (is_primary_key = 1) and UNIQUE constraints
  (is_unique_constraint = 1) -- those are declared in DSR_Schema_DDL.sql and are not ours to drop.
  ==============================================================================================*/
DECLARE @DropSql NVARCHAR(MAX) = N'';

SELECT @DropSql = @DropSql
     + N'DROP INDEX ' + QUOTENAME(i.name) + N' ON '
     + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) + N';' + CHAR(13) + CHAR(10)
FROM       sys.indexes i
JOIN       sys.tables  t ON t.object_id = i.object_id
JOIN       sys.schemas s ON s.schema_id = t.schema_id
WHERE      s.name                = N'dsr'
  AND      i.type                = 2      -- NONCLUSTERED only
  AND      i.is_primary_key      = 0
  AND      i.is_unique_constraint = 0
  AND      i.name IS NOT NULL;

IF LEN(@DropSql) > 0
BEGIN
    PRINT N'>> Dropping existing script-owned indexes for re-create.';
    EXEC sys.sp_executesql @DropSql;
END
GO

/*==============================================================================================
  SECTION A -- UNIQUE / NATURAL-KEY INDEXES
  Filtered on IsActive = 1 so a soft-deleted row does not permanently reserve its natural key.
  ==============================================================================================*/

-- Users: email is the login identity for the DATABASE auth path
CREATE UNIQUE NONCLUSTERED INDEX UQ_Users_Email_Active
    ON dsr.Users (Email) WHERE IsActive = 1;
GO
CREATE UNIQUE NONCLUSTERED INDEX UQ_Users_EmployeeCode_Active
    ON dsr.Users (EmployeeCode) WHERE EmployeeCode IS NOT NULL AND IsActive = 1;
GO
-- Users: Entra ID object id is the login identity for the SSO auth path
CREATE UNIQUE NONCLUSTERED INDEX UQ_Users_ExternalObjectId_Active
    ON dsr.Users (ExternalObjectId) WHERE ExternalObjectId IS NOT NULL AND IsActive = 1;
GO

-- Projects
CREATE UNIQUE NONCLUSTERED INDEX UQ_Projects_ProjectCode_Active
    ON dsr.Projects (ProjectCode) WHERE IsActive = 1;
GO
-- Distinct names matter: "Project (single selection)" is a dropdown; duplicates are unusable
CREATE UNIQUE NONCLUSTERED INDEX UQ_Projects_ProjectName_Active
    ON dsr.Projects (ProjectName) WHERE IsActive = 1;
GO

CREATE UNIQUE NONCLUSTERED INDEX UQ_AiTools_ToolName_Active
    ON dsr.AiTools (ToolName) WHERE IsActive = 1;
GO
CREATE UNIQUE NONCLUSTERED INDEX UQ_Holidays_HolidayDate_Active
    ON dsr.Holidays (HolidayDate) WHERE IsActive = 1;
GO

/*----------------------------------------------------------------------------------------------
  THE CORE BUSINESS RULE INDEX
  One DSR entry per employee, per date, per project. This is the reconciliation of BRD v2's
  "One DSR per employee per day" with its own "multiple DSR entries on the same day":
  the day may hold many entries, but not two for the SAME project.
  ** If the business decides multiple entries per project per day ARE valid (e.g. two distinct
     tasks on one project), DROP this index only -- no other object depends on it. **
----------------------------------------------------------------------------------------------*/
CREATE UNIQUE NONCLUSTERED INDEX UQ_DSREntries_User_Date_Project_Active
    ON dsr.DSREntries (UserId, WorkDate, ProjectId)
    WHERE ProjectId IS NOT NULL AND IsActive = 1;
GO

-- A "No Work Done" declaration can exist only once per employee per day
CREATE UNIQUE NONCLUSTERED INDEX UQ_DSREntries_User_Date_NoWork_Active
    ON dsr.DSREntries (UserId, WorkDate)
    WHERE IsNoWorkDone = 1 AND IsActive = 1;
GO

-- Prevents two identical allocation records for the same person/project/start date
CREATE UNIQUE NONCLUSTERED INDEX UQ_ProjectAllocations_Project_User_Start_Active
    ON dsr.ProjectAllocations (ProjectId, UserId, AllocationStartDate) WHERE IsActive = 1;
GO

/*==============================================================================================
  SECTION B -- FOREIGN KEY INDEXES
  Deliberate exclusion: no indexes are created on CreatedByUserId / ModifiedByUserId. They are
  never join or filter predicates in any BRD report, and indexing 13 tables x 2 columns would
  add 26 low-value indexes to the write path. See design document Section 9, note N3.
  ==============================================================================================*/

CREATE NONCLUSTERED INDEX IX_Users_ManagerUserId
    ON dsr.Users (ManagerUserId) WHERE ManagerUserId IS NOT NULL;      -- "my team" scoping
GO
CREATE NONCLUSTERED INDEX IX_UserRoles_RoleId
    ON dsr.UserRoles (RoleId) INCLUDE (UserId);                        -- "all Managers", "all Admins"
GO
CREATE NONCLUSTERED INDEX IX_UserLoginAudit_UserId_AttemptDate
    ON dsr.UserLoginAudit (UserId, AttemptDate DESC);
GO
CREATE NONCLUSTERED INDEX IX_Projects_ProjectManagerUserId
    ON dsr.Projects (ProjectManagerUserId) WHERE ProjectManagerUserId IS NOT NULL;
GO
CREATE NONCLUSTERED INDEX IX_ProjectAllocations_UserId
    ON dsr.ProjectAllocations (UserId, AllocationStartDate, AllocationEndDate)
    INCLUDE (ProjectId, AllocationPercentage);
GO
CREATE NONCLUSTERED INDEX IX_DailyAiUsage_AiToolId
    ON dsr.DailyAiUsage (AiToolId) WHERE AiToolId IS NOT NULL;
GO
CREATE NONCLUSTERED INDEX IX_AuditLog_ChangedByUserId
    ON dsr.AuditLog (ChangedByUserId, ChangedDate DESC);
GO

/*==============================================================================================
  SECTION C -- REPORTING & SEARCH INDEXES
  Each index below is traceable to a named BRD report or dashboard.
  ==============================================================================================*/

/*  Employee Report / Employee Dashboard (daily, weekly, monthly summaries)
    Query shape: WHERE UserId = @u AND WorkDate BETWEEN @from AND @to
    Covering, so the summary never touches the base table.                                    */
CREATE NONCLUSTERED INDEX IX_DSREntries_User_WorkDate_Covering
    ON dsr.DSREntries (UserId, WorkDate)
    INCLUDE (ProjectId, EstimatedHours, IsNoWorkDone)
    WHERE IsActive = 1;
GO

/*  Project Report / project effort roll-up
    Query shape: WHERE ProjectId = @p AND WorkDate BETWEEN @from AND @to                      */
CREATE NONCLUSTERED INDEX IX_DSREntries_Project_WorkDate_Covering
    ON dsr.DSREntries (ProjectId, WorkDate)
    INCLUDE (UserId, EstimatedHours, IsNoWorkDone)
    WHERE IsActive = 1 AND ProjectId IS NOT NULL;
GO

/*  Date-wise filtering across the organisation (Admin Dashboard, missing-DSR detection).
    WorkDate leads because these queries are not employee-scoped.                             */
CREATE NONCLUSTERED INDEX IX_DSREntries_WorkDate_Covering
    ON dsr.DSREntries (WorkDate)
    INCLUDE (UserId, ProjectId, EstimatedHours, IsNoWorkDone)
    WHERE IsActive = 1;
GO

/*  "No Work Done" exception listing -- small filtered index, cheap to maintain               */
CREATE NONCLUSTERED INDEX IX_DSREntries_NoWorkDone
    ON dsr.DSREntries (WorkDate, UserId)
    WHERE IsNoWorkDone = 1 AND IsActive = 1;
GO

/*  AI Usage Report + AI adoption metrics
    Query shape: WHERE WorkDate BETWEEN @from AND @to GROUP BY IsAiUsed / AiToolId            */
CREATE NONCLUSTERED INDEX IX_DailyAiUsage_WorkDate_Covering
    ON dsr.DailyAiUsage (WorkDate)
    INCLUDE (UserId, IsAiUsed, AiToolId)
    WHERE IsActive = 1;
GO
CREATE NONCLUSTERED INDEX IX_DailyAiUsage_User_WorkDate_Covering
    ON dsr.DailyAiUsage (UserId, WorkDate)
    INCLUDE (IsAiUsed, AiToolId)
    WHERE IsActive = 1;
GO

/*  Resource Utilization Report -- allocation windows overlapping a reporting period          */
CREATE NONCLUSTERED INDEX IX_ProjectAllocations_Project_Window
    ON dsr.ProjectAllocations (ProjectId, AllocationStartDate, AllocationEndDate)
    INCLUDE (UserId, AllocationPercentage)
    WHERE IsActive = 1;
GO

/*  Project pickers and Admin project list: active projects by status, ordered by name        */
CREATE NONCLUSTERED INDEX IX_Projects_Status_Name
    ON dsr.Projects (Status, ProjectName)
    INCLUDE (ProjectCode, StartDate, EndDate)
    WHERE IsActive = 1;
GO

/*  Employee search by name (Admin user administration, manager team lists)                   */
CREATE NONCLUSTERED INDEX IX_Users_FullName
    ON dsr.Users (FullName)
    INCLUDE (Email, EmployeeCode, ManagerUserId)
    WHERE IsActive = 1;
GO

/*  Audit trail drill-down: "show me everything that happened to DSR entry 4711"              */
CREATE NONCLUSTERED INDEX IX_AuditLog_Entity
    ON dsr.AuditLog (EntityName, EntityId, ChangedDate DESC);
GO

PRINT N'>> Indexes created.';
GO

/*==============================================================================================
  SECTION D -- REPORTING OBJECTS
  Views expose the join logic once, so five reports cannot drift apart.
  ==============================================================================================*/

/*----------------------------------------------------------------------------------------------
  vw_DsrEntryDetail -- the flat reporting spine. One row per DSR entry with employee, project
  and that day's AI declaration already resolved.
----------------------------------------------------------------------------------------------*/
CREATE OR ALTER VIEW dsr.vw_DsrEntryDetail
AS
SELECT  d.Id                    AS DsrEntryId,
        d.WorkDate,
        DATEPART(YEAR,  d.WorkDate)     AS WorkYear,
        DATEPART(MONTH, d.WorkDate)     AS WorkMonth,
        DATEPART(ISO_WEEK, d.WorkDate)  AS WorkIsoWeek,
        u.Id                    AS UserId,
        u.EmployeeCode,
        u.FullName              AS EmployeeName,
        u.Email                 AS EmployeeEmail,
        u.ManagerUserId,
        mgr.FullName            AS ManagerName,
        u.StandardDailyHours,
        p.Id                    AS ProjectId,
        p.ProjectCode,
        p.ProjectName,
        p.Status                AS ProjectStatus,
        d.EstimatedHours,
        d.IsNoWorkDone,
        d.WorkDescriptionPlain,
        ai.IsAiUsed,
        ai.AiToolId,
        t.ToolName              AS AiToolName,
        ai.UsageRemarks         AS AiUsageRemarks,
        d.CreatedDate,
        d.ModifiedDate
FROM        dsr.DSREntries    d
JOIN        dsr.Users         u   ON u.Id = d.UserId
LEFT JOIN   dsr.Users         mgr ON mgr.Id = u.ManagerUserId
LEFT JOIN   dsr.Projects      p   ON p.Id = d.ProjectId
LEFT JOIN   dsr.DailyAiUsage  ai  ON ai.UserId = d.UserId AND ai.WorkDate = d.WorkDate AND ai.IsActive = 1
LEFT JOIN   dsr.AiTools       t   ON t.Id = ai.AiToolId
WHERE       d.IsActive = 1;
GO

/*----------------------------------------------------------------------------------------------
  vw_DsrDailySummary -- Employee Dashboard daily total. Note SUM over the day's entries:
  this is where the flat grain pays off.
----------------------------------------------------------------------------------------------*/
CREATE OR ALTER VIEW dsr.vw_DsrDailySummary
AS
SELECT  d.UserId,
        u.FullName                          AS EmployeeName,
        u.ManagerUserId,
        d.WorkDate,
        COUNT(*)                            AS EntryCount,
        COUNT(DISTINCT d.ProjectId)         AS ProjectCount,
        SUM(d.EstimatedHours)               AS TotalHours,
        u.StandardDailyHours,
        CAST(CASE WHEN u.StandardDailyHours = 0 THEN 0
                  ELSE SUM(d.EstimatedHours) * 100.0 / u.StandardDailyHours
             END AS DECIMAL(9,2))           AS DayUtilizationPct,
        MAX(CAST(d.IsNoWorkDone AS INT))    AS HasNoWorkDeclaration
FROM        dsr.DSREntries d
JOIN        dsr.Users      u ON u.Id = d.UserId
WHERE       d.IsActive = 1
GROUP BY    d.UserId, u.FullName, u.ManagerUserId, d.WorkDate, u.StandardDailyHours;
GO

/*----------------------------------------------------------------------------------------------
  vw_ProjectEffortSummary -- Project Report: effort and contributor count per project.
----------------------------------------------------------------------------------------------*/
CREATE OR ALTER VIEW dsr.vw_ProjectEffortSummary
AS
SELECT  p.Id                        AS ProjectId,
        p.ProjectCode,
        p.ProjectName,
        p.Status                    AS ProjectStatus,
        p.StartDate,
        p.EndDate,
        p.ProjectManagerUserId,
        COUNT(d.Id)                 AS EntryCount,
        COUNT(DISTINCT d.UserId)    AS ContributorCount,
        ISNULL(SUM(d.EstimatedHours), 0) AS TotalHours,
        MIN(d.WorkDate)             AS FirstEffortDate,
        MAX(d.WorkDate)             AS LastEffortDate
FROM        dsr.Projects   p
LEFT JOIN   dsr.DSREntries d ON d.ProjectId = p.Id AND d.IsActive = 1
WHERE       p.IsActive = 1
GROUP BY    p.Id, p.ProjectCode, p.ProjectName, p.Status, p.StartDate, p.EndDate, p.ProjectManagerUserId;
GO

/*----------------------------------------------------------------------------------------------
  vw_AiAdoptionDaily -- AI Usage Report / AI adoption metrics, at the correct grain.
  Because DailyAiUsage is one row per employee-day, the adoption percentage needs no DISTINCT.
----------------------------------------------------------------------------------------------*/
CREATE OR ALTER VIEW dsr.vw_AiAdoptionDaily
AS
SELECT  a.WorkDate,
        COUNT(*)                                            AS DeclarationCount,
        SUM(CAST(a.IsAiUsed AS INT))                        AS AiUsedCount,
        CAST(SUM(CAST(a.IsAiUsed AS INT)) * 100.0 / NULLIF(COUNT(*), 0) AS DECIMAL(5,2)) AS AiAdoptionPct,
        COUNT(DISTINCT a.AiToolId)                          AS DistinctToolsUsed
FROM        dsr.DailyAiUsage a
WHERE       a.IsActive = 1
GROUP BY    a.WorkDate;
GO

/*----------------------------------------------------------------------------------------------
  fn_GetMissingDsrDays -- Manager Dashboard "missing DSRs".
  Generates the working-day calendar for a window (excluding weekends and mandatory holidays)
  and returns the employee-days with no active DSR entry. Table-valued function because the
  date window is a parameter, which a view cannot accept.
  Weekend definition is Saturday/Sunday and is DATEFIRST-independent.
----------------------------------------------------------------------------------------------*/
CREATE OR ALTER FUNCTION dsr.fn_GetMissingDsrDays
(
    @FromDate       DATE,
    @ToDate         DATE,
    @ManagerUserId  INT = NULL      -- NULL = whole organisation (Admin Dashboard)
)
RETURNS TABLE
AS
RETURN
(
    WITH Dates AS
    (
        SELECT TOP (DATEDIFF(DAY, @FromDate, @ToDate) + 1)
               CalendarDate = DATEADD(DAY, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1, @FromDate)
        FROM   sys.all_objects a CROSS JOIN sys.all_objects b
    ),
    WorkingDays AS
    (
        SELECT d.CalendarDate
        FROM   Dates d
        WHERE  DATEDIFF(DAY, '19000101', d.CalendarDate) % 7 NOT IN (5, 6)      -- Sat, Sun
          AND  NOT EXISTS (SELECT 1 FROM dsr.Holidays h
                           WHERE h.HolidayDate = d.CalendarDate
                             AND h.IsOptional = 0 AND h.IsActive = 1)
    ),
    EligibleUsers AS
    (
        SELECT u.Id, u.EmployeeCode, u.FullName, u.ManagerUserId, u.DateOfJoining, u.DateOfExit
        FROM   dsr.Users u
        WHERE  u.IsActive = 1
          AND  u.IsServiceAccount = 0          -- service accounts never file DSRs
          AND (@ManagerUserId IS NULL OR u.ManagerUserId = @ManagerUserId)
    )
    SELECT  u.Id            AS UserId,
            u.EmployeeCode,
            u.FullName      AS EmployeeName,
            u.ManagerUserId,
            w.CalendarDate  AS MissingDate
    FROM        EligibleUsers u
    CROSS JOIN  WorkingDays  w
    WHERE   (u.DateOfJoining IS NULL OR w.CalendarDate >= u.DateOfJoining)
      AND   (u.DateOfExit    IS NULL OR w.CalendarDate <= u.DateOfExit)
      AND   NOT EXISTS (SELECT 1 FROM dsr.DSREntries d
                        WHERE d.UserId = u.Id AND d.WorkDate = w.CalendarDate AND d.IsActive = 1)
);
GO

/*----------------------------------------------------------------------------------------------
  fn_GetResourceUtilization -- Resource Utilization Report.
  Actual logged hours vs planned capacity, where capacity = standard daily hours
  x working days in the window x allocation percentage.
----------------------------------------------------------------------------------------------*/
CREATE OR ALTER FUNCTION dsr.fn_GetResourceUtilization
(
    @FromDate DATE,
    @ToDate   DATE
)
RETURNS TABLE
AS
RETURN
(
    WITH Dates AS
    (
        SELECT TOP (DATEDIFF(DAY, @FromDate, @ToDate) + 1)
               CalendarDate = DATEADD(DAY, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1, @FromDate)
        FROM   sys.all_objects a CROSS JOIN sys.all_objects b
    ),
    WorkingDayCount AS
    (
        SELECT COUNT(*) AS Days
        FROM   Dates d
        WHERE  DATEDIFF(DAY, '19000101', d.CalendarDate) % 7 NOT IN (5, 6)
          AND  NOT EXISTS (SELECT 1 FROM dsr.Holidays h
                           WHERE h.HolidayDate = d.CalendarDate
                             AND h.IsOptional = 0 AND h.IsActive = 1)
    ),
    Actual AS
    (
        SELECT d.UserId, SUM(d.EstimatedHours) AS LoggedHours, COUNT(DISTINCT d.WorkDate) AS DaysLogged
        FROM   dsr.DSREntries d
        WHERE  d.IsActive = 1 AND d.WorkDate BETWEEN @FromDate AND @ToDate
        GROUP BY d.UserId
    ),
    Planned AS
    (
        SELECT  a.UserId,
                SUM(a.AllocationPercentage) AS TotalAllocationPct
        FROM    dsr.ProjectAllocations a
        WHERE   a.IsActive = 1
          AND   a.AllocationStartDate <= @ToDate
          AND  (a.AllocationEndDate IS NULL OR a.AllocationEndDate >= @FromDate)
        GROUP BY a.UserId
    )
    SELECT  u.Id                                AS UserId,
            u.EmployeeCode,
            u.FullName                          AS EmployeeName,
            u.ManagerUserId,
            wd.Days                             AS WorkingDaysInPeriod,
            u.StandardDailyHours,
            ISNULL(pl.TotalAllocationPct, 0)    AS TotalAllocationPct,
            CAST(wd.Days * u.StandardDailyHours AS DECIMAL(10,2))                       AS CapacityHours,
            CAST(wd.Days * u.StandardDailyHours * ISNULL(pl.TotalAllocationPct, 0) / 100.0
                 AS DECIMAL(10,2))                                                      AS PlannedHours,
            ISNULL(ac.LoggedHours, 0)                                                   AS LoggedHours,
            ISNULL(ac.DaysLogged, 0)                                                    AS DaysLogged,
            CAST(ISNULL(ac.LoggedHours, 0) * 100.0
                 / NULLIF(wd.Days * u.StandardDailyHours, 0) AS DECIMAL(9,2))           AS UtilizationPct
    FROM        dsr.Users u
    CROSS JOIN  WorkingDayCount wd
    LEFT JOIN   Actual  ac ON ac.UserId = u.Id
    LEFT JOIN   Planned pl ON pl.UserId = u.Id
    WHERE       u.IsActive = 1
      AND       u.IsServiceAccount = 0         -- service accounts have no capacity
);
GO

PRINT N'>> Reporting views and functions created.';
GO

/*==============================================================================================
  SECTION E -- CROSS-ROW BUSINESS RULES (TRIGGERS)
  These two rules span multiple rows and therefore CANNOT be expressed as CHECK constraints.
  They are enforced here as a last line of defence; the application must validate first so the
  user receives a friendly message rather than a trigger error.
  ==============================================================================================*/

/*----------------------------------------------------------------------------------------------
  trg_DSREntries_DailyRules
    Rule 1: total EstimatedHours for one employee on one date may not exceed the configured cap
            (AppSettings key 'DSR.MaxDailyHours', default 24). BRD states 0-24 per entry only;
            without this, three 8-hour entries on one day total 24 and a fourth would pass.
    Rule 2: a "No Work Done" declaration cannot coexist with real work entries on the same date.
----------------------------------------------------------------------------------------------*/
CREATE OR ALTER TRIGGER dsr.trg_DSREntries_DailyRules
ON dsr.DSREntries
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    -- Guard on the inserted table, NOT on @@ROWCOUNT: any SET statement (including the
    -- SET NOCOUNT ON above) resets @@ROWCOUNT to 0, which would make the trigger a no-op.
    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;

    DECLARE @MaxDailyHours DECIMAL(5,2) =
        (SELECT TRY_CAST(SettingValue AS DECIMAL(5,2)) FROM dsr.AppSettings
         WHERE SettingKey = N'DSR.MaxDailyHours' AND IsActive = 1);
    SET @MaxDailyHours = ISNULL(@MaxDailyHours, 24.00);

    -- Rule 1
    IF EXISTS (
        SELECT 1
        FROM   dsr.DSREntries d
        WHERE  d.IsActive = 1
          AND  EXISTS (SELECT 1 FROM inserted i WHERE i.UserId = d.UserId AND i.WorkDate = d.WorkDate)
        GROUP BY d.UserId, d.WorkDate
        HAVING SUM(d.EstimatedHours) > @MaxDailyHours)
    BEGIN
        THROW 51001, N'Total DSR hours for an employee on a single date exceed the configured daily maximum.', 1;
    END

    -- Rule 2
    IF EXISTS (
        SELECT 1
        FROM   dsr.DSREntries d
        WHERE  d.IsActive = 1
          AND  EXISTS (SELECT 1 FROM inserted i WHERE i.UserId = d.UserId AND i.WorkDate = d.WorkDate)
        GROUP BY d.UserId, d.WorkDate
        HAVING MAX(CAST(d.IsNoWorkDone AS INT)) = 1 AND COUNT(*) > 1)
    BEGIN
        THROW 51002, N'A "No Work Done" declaration cannot coexist with other DSR entries on the same date.', 1;
    END
END
GO

/*----------------------------------------------------------------------------------------------
  trg_DSREntries_ProjectWindow
    A DSR entry may not be logged against a project outside its Start/End window, nor against a
    project that is not open for effort logging. Cross-table, so not expressible as a CHECK.

    ASSUMPTION (A-11 -- requires business confirmation): effort may be logged only against
    ACTIVE or COMPLETED projects. PLANNED (not started), ON_HOLD (work paused) and CANCELLED
    (abandoned) are blocked. COMPLETED is permitted because the WorkDate must still fall inside
    the project window, so it only allows legitimate back-dated entries for finished work.
    To relax any of these, edit the status list below -- it is the single point of control.
----------------------------------------------------------------------------------------------*/
CREATE OR ALTER TRIGGER dsr.trg_DSREntries_ProjectWindow
ON dsr.DSREntries
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    -- Guard on the inserted table, NOT on @@ROWCOUNT: any SET statement (including the
    -- SET NOCOUNT ON above) resets @@ROWCOUNT to 0, which would make the trigger a no-op.
    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;

    IF EXISTS (
        SELECT 1
        FROM   inserted i
        JOIN   dsr.Projects p ON p.Id = i.ProjectId
        WHERE  i.ProjectId IS NOT NULL
          AND (i.WorkDate < p.StartDate
            OR (p.EndDate IS NOT NULL AND i.WorkDate > p.EndDate)
            OR  p.Status IN (N'PLANNED', N'ON_HOLD', N'CANCELLED')
            OR  p.IsActive = 0))
    BEGIN
        THROW 51003, N'DSR work date falls outside the project window, or the project is not open for effort logging.', 1;
    END
END
GO

/*----------------------------------------------------------------------------------------------
  trg_AuditLog_PreventChange / trg_UserLoginAudit_PreventChange
    Immutability guards for the two append-only tables.
----------------------------------------------------------------------------------------------*/
CREATE OR ALTER TRIGGER dsr.trg_AuditLog_PreventChange
ON dsr.AuditLog
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    THROW 51010, N'AuditLog is append-only. UPDATE and DELETE are not permitted.', 1;
END
GO

CREATE OR ALTER TRIGGER dsr.trg_UserLoginAudit_PreventChange
ON dsr.UserLoginAudit
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    THROW 51011, N'UserLoginAudit is append-only. UPDATE and DELETE are not permitted.', 1;
END
GO

PRINT N'>> Cross-row integrity triggers created.';
PRINT N'>> Schema deployment complete.';
GO
