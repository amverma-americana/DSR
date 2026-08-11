/*==============================================================================================
  MIGRATION 07 -- REPORTING MODULE
  ----------------------------------------------------------------------------------------------
  Run AFTER migrations 01-06.

  GAP ANALYSIS: the reporting requirement asks for 9 fields that do not exist anywhere in the
  schema. They cannot be reported until they are captured, so this migration adds them.

    REQUIRED FIELD              STATUS BEFORE   ADDED HERE AS
    ------------------------    -------------   ---------------------------------------------
    Department                  MISSING         dsr.Departments + Users.DepartmentId
    Work Category               MISSING         dsr.WorkCategories + DSREntries.WorkCategoryId
    Hours Logged (actual)       MISSING         DSREntries.ActualHours
    Remaining Hours             MISSING         DSREntries.RemainingHours (computed)
    DSR Status                  MISSING         DSREntries.StatusCode
    DSR Submission Date         MISSING         DSREntries.SubmittedOn
    Approval Status             MISSING         derived from StatusCode
    Approved By                 MISSING         DSREntries.ApprovedByUserId
    Approval Date               MISSING         DSREntries.ApprovalDate
    Rejected/Returned Comments  MISSING         DSREntries.ReviewComments

    Already present and reused unchanged: Employee Name, Employee Code, Email, Designation,
    Manager, Project Name/Code/Start/End/Status, Task Description, Estimated Hours, Task Entry
    Date, DSR Date, No Work Done flag.

  APPROVAL MODEL
    A DSR entry is SUBMITTED the moment it is saved (the application has no separate submit step),
    then a Manager or Admin may APPROVE or RETURN it. RETURNED entries carry ReviewComments and
    become editable again. This is the minimum workflow that makes the requested approval columns
    meaningful; it is additive and does not change how entries are created.

  Idempotent: safe to re-run.
  ==============================================================================================*/

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

USE [DSRResourceManagement];
GO

/*----------------------------------------------------------------------------------------------
  1. Departments
----------------------------------------------------------------------------------------------*/
IF OBJECT_ID(N'dsr.Departments', N'U') IS NULL
BEGIN
    CREATE TABLE dsr.Departments
    (
        Id                  INT IDENTITY(1,1)   NOT NULL,
        DepartmentCode      NVARCHAR(30)        NOT NULL,
        DepartmentName      NVARCHAR(100)       NOT NULL,
        HeadUserId          INT                     NULL,
        CreatedByUserId     INT                 NOT NULL,
        CreatedDate         DATETIME2(3)        NOT NULL CONSTRAINT DF_Departments_CreatedDate DEFAULT (SYSUTCDATETIME()),
        ModifiedByUserId    INT                     NULL,
        ModifiedDate        DATETIME2(3)            NULL,
        IsActive            BIT                 NOT NULL CONSTRAINT DF_Departments_IsActive DEFAULT (1),

        CONSTRAINT PK_Departments PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_Departments_HeadUser        FOREIGN KEY (HeadUserId)       REFERENCES dsr.Users(Id),
        CONSTRAINT FK_Departments_CreatedByUser   FOREIGN KEY (CreatedByUserId)  REFERENCES dsr.Users(Id),
        CONSTRAINT FK_Departments_ModifiedByUser  FOREIGN KEY (ModifiedByUserId) REFERENCES dsr.Users(Id),
        CONSTRAINT CK_Departments_CodeNoSpaces    CHECK (DepartmentCode NOT LIKE N'% %')
    );

    CREATE UNIQUE NONCLUSTERED INDEX UQ_Departments_Code_Active ON dsr.Departments (DepartmentCode) WHERE IsActive = 1;
    CREATE UNIQUE NONCLUSTERED INDEX UQ_Departments_Name_Active ON dsr.Departments (DepartmentName) WHERE IsActive = 1;
    PRINT N'>> Created dsr.Departments.';
END
ELSE PRINT N'   dsr.Departments already exists.';
GO

IF COL_LENGTH(N'dsr.Users', N'DepartmentId') IS NULL
BEGIN
    ALTER TABLE dsr.Users ADD DepartmentId INT NULL
        CONSTRAINT FK_Users_Department FOREIGN KEY REFERENCES dsr.Departments(Id);
    PRINT N'>> Added Users.DepartmentId.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Users_DepartmentId' AND object_id = OBJECT_ID(N'dsr.Users'))
    CREATE NONCLUSTERED INDEX IX_Users_DepartmentId ON dsr.Users (DepartmentId) WHERE DepartmentId IS NOT NULL;
GO

/*----------------------------------------------------------------------------------------------
  2. Work categories -- "Work Category (if applicable)", so the FK is nullable.
----------------------------------------------------------------------------------------------*/
IF OBJECT_ID(N'dsr.WorkCategories', N'U') IS NULL
BEGIN
    CREATE TABLE dsr.WorkCategories
    (
        Id                  INT IDENTITY(1,1)   NOT NULL,
        CategoryCode        NVARCHAR(30)        NOT NULL,
        CategoryName        NVARCHAR(100)       NOT NULL,
        SortOrder           SMALLINT            NOT NULL CONSTRAINT DF_WorkCategories_SortOrder DEFAULT (0),
        CreatedByUserId     INT                 NOT NULL,
        CreatedDate         DATETIME2(3)        NOT NULL CONSTRAINT DF_WorkCategories_CreatedDate DEFAULT (SYSUTCDATETIME()),
        ModifiedByUserId    INT                     NULL,
        ModifiedDate        DATETIME2(3)            NULL,
        IsActive            BIT                 NOT NULL CONSTRAINT DF_WorkCategories_IsActive DEFAULT (1),

        CONSTRAINT PK_WorkCategories PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_WorkCategories_CreatedByUser  FOREIGN KEY (CreatedByUserId)  REFERENCES dsr.Users(Id),
        CONSTRAINT FK_WorkCategories_ModifiedByUser FOREIGN KEY (ModifiedByUserId) REFERENCES dsr.Users(Id)
    );
    CREATE UNIQUE NONCLUSTERED INDEX UQ_WorkCategories_Code_Active ON dsr.WorkCategories (CategoryCode) WHERE IsActive = 1;
    PRINT N'>> Created dsr.WorkCategories.';
END
ELSE PRINT N'   dsr.WorkCategories already exists.';
GO

/*----------------------------------------------------------------------------------------------
  3. DSREntries: workflow, actual hours and work category
----------------------------------------------------------------------------------------------*/
IF COL_LENGTH(N'dsr.DSREntries', N'StatusCode') IS NULL
BEGIN
    -- Existing rows are treated as SUBMITTED: they were saved by an employee and are awaiting review.
    ALTER TABLE dsr.DSREntries ADD
        StatusCode          NVARCHAR(20)    NOT NULL CONSTRAINT DF_DSREntries_StatusCode DEFAULT (N'SUBMITTED'),
        SubmittedOn         DATETIME2(3)        NULL,
        ApprovedByUserId    INT                 NULL,
        ApprovalDate        DATETIME2(3)        NULL,
        ReviewComments      NVARCHAR(1000)      NULL,
        ActualHours         DECIMAL(4,2)        NULL,
        WorkCategoryId      INT                 NULL;
    PRINT N'>> Added workflow, ActualHours and WorkCategoryId columns to DSREntries.';
END
ELSE PRINT N'   DSREntries workflow columns already exist.';
GO

/*  Remaining Hours is derived, never stored independently -- otherwise it drifts from its inputs.
    ISNULL keeps it deterministic so SQL Server will persist it.                                 */
IF COL_LENGTH(N'dsr.DSREntries', N'RemainingHours') IS NULL
BEGIN
    ALTER TABLE dsr.DSREntries
        ADD RemainingHours AS (CONVERT(DECIMAL(5,2), [EstimatedHours] - ISNULL([ActualHours], 0))) PERSISTED;
    PRINT N'>> Added computed column DSREntries.RemainingHours.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_DSREntries_StatusCode')
    ALTER TABLE dsr.DSREntries ADD CONSTRAINT CK_DSREntries_StatusCode
        CHECK (StatusCode IN (N'DRAFT', N'SUBMITTED', N'APPROVED', N'RETURNED'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_DSREntries_ApprovalPair')
    -- APPROVED and RETURNED must record who acted and when; other states must not.
    ALTER TABLE dsr.DSREntries ADD CONSTRAINT CK_DSREntries_ApprovalPair
        CHECK ((StatusCode IN (N'APPROVED', N'RETURNED') AND ApprovedByUserId IS NOT NULL AND ApprovalDate IS NOT NULL)
            OR (StatusCode IN (N'DRAFT', N'SUBMITTED') AND ApprovedByUserId IS NULL AND ApprovalDate IS NULL));
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_DSREntries_ReturnNeedsComment')
    -- A return without a reason is useless to the employee receiving it.
    ALTER TABLE dsr.DSREntries ADD CONSTRAINT CK_DSREntries_ReturnNeedsComment
        CHECK (StatusCode <> N'RETURNED' OR (ReviewComments IS NOT NULL AND LEN(LTRIM(ReviewComments)) >= 5));
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_DSREntries_ActualHoursRange')
    ALTER TABLE dsr.DSREntries ADD CONSTRAINT CK_DSREntries_ActualHoursRange
        CHECK (ActualHours IS NULL OR (ActualHours >= 0 AND ActualHours <= 24));
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_DSREntries_ApprovedByUser')
    ALTER TABLE dsr.DSREntries ADD CONSTRAINT FK_DSREntries_ApprovedByUser
        FOREIGN KEY (ApprovedByUserId) REFERENCES dsr.Users(Id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_DSREntries_WorkCategory')
    ALTER TABLE dsr.DSREntries ADD CONSTRAINT FK_DSREntries_WorkCategory
        FOREIGN KEY (WorkCategoryId) REFERENCES dsr.WorkCategories(Id);
GO

/*----------------------------------------------------------------------------------------------
  3a. Fix trg_DSREntries_DailyRules so it only validates when the hours could actually have changed.

  As written in migration 06 it re-validated the whole employee-day on ANY update, including
  metadata-only ones. The SubmittedOn backfill below therefore failed with error 51001 on rows
  whose hours predate the StandardDailyHours cap and were never touched by the backfill. Any future
  column addition would hit the same wall. Inserts are always validated; updates are validated only
  when a column that participates in the rule is in the SET list.
----------------------------------------------------------------------------------------------*/
CREATE OR ALTER TRIGGER dsr.trg_DSREntries_DailyRules
ON dsr.DSREntries
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    -- Guard on inserted, NOT @@ROWCOUNT: any SET statement resets @@ROWCOUNT to 0.
    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;

    -- Skip metadata-only updates (e.g. StatusCode, SubmittedOn, ReviewComments, audit columns).
    IF EXISTS (SELECT 1 FROM deleted)
       AND NOT (UPDATE(EstimatedHours) OR UPDATE(IsActive) OR UPDATE(UserId)
                OR UPDATE(WorkDate) OR UPDATE(IsNoWorkDone))
        RETURN;

    /*  Rule 1: daily total may not exceed that employee's StandardDailyHours. Multiple entries
        against the SAME project are allowed; only the daily total is policed.                  */
    IF EXISTS (
        SELECT 1
        FROM        dsr.DSREntries d
        JOIN        dsr.Users      u ON u.Id = d.UserId
        WHERE       d.IsActive = 1
          AND       EXISTS (SELECT 1 FROM inserted i WHERE i.UserId = d.UserId AND i.WorkDate = d.WorkDate)
        GROUP BY    d.UserId, d.WorkDate, u.StandardDailyHours
        HAVING      SUM(d.EstimatedHours) > u.StandardDailyHours)
    BEGIN
        THROW 51001, N'Total DSR hours for this date exceed the employee''s standard daily hours.', 1;
    END

    /*  Rule 2: a "No Work Done" declaration cannot coexist with real work entries.             */
    IF EXISTS (
        SELECT 1
        FROM        dsr.DSREntries d
        WHERE       d.IsActive = 1
          AND       EXISTS (SELECT 1 FROM inserted i WHERE i.UserId = d.UserId AND i.WorkDate = d.WorkDate)
        GROUP BY    d.UserId, d.WorkDate
        HAVING      MAX(CAST(d.IsNoWorkDone AS INT)) = 1 AND COUNT(*) > 1)
    BEGIN
        THROW 51002, N'A "No Work Done" declaration cannot coexist with other DSR entries on the same date.', 1;
    END
END
GO

PRINT N'>> trg_DSREntries_DailyRules now skips metadata-only updates.';
GO

-- Backfill: existing rows were submitted when they were created.
UPDATE dsr.DSREntries SET SubmittedOn = CreatedDate WHERE SubmittedOn IS NULL;
GO

/*----------------------------------------------------------------------------------------------
  4. Reporting indexes for the new filter columns
----------------------------------------------------------------------------------------------*/
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_DSREntries_Status_WorkDate' AND object_id = OBJECT_ID(N'dsr.DSREntries'))
    CREATE NONCLUSTERED INDEX IX_DSREntries_Status_WorkDate
        ON dsr.DSREntries (StatusCode, WorkDate) INCLUDE (UserId, ProjectId, EstimatedHours, ActualHours)
        WHERE IsActive = 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_DSREntries_SubmittedOn' AND object_id = OBJECT_ID(N'dsr.DSREntries'))
    CREATE NONCLUSTERED INDEX IX_DSREntries_SubmittedOn ON dsr.DSREntries (SubmittedOn) WHERE IsActive = 1;
GO

/*----------------------------------------------------------------------------------------------
  5. Seed departments and work categories
----------------------------------------------------------------------------------------------*/
INSERT INTO dsr.Departments (DepartmentCode, DepartmentName, CreatedByUserId)
SELECT v.Code, v.Name, 1
FROM (VALUES (N'ENG', N'Engineering'), (N'QA', N'Quality Assurance'), (N'PMO', N'Project Management'),
             (N'DES', N'Design'), (N'OPS', N'Operations'), (N'CORP', N'Corporate Services')) v (Code, Name)
WHERE NOT EXISTS (SELECT 1 FROM dsr.Departments d WHERE d.DepartmentCode = v.Code);
GO

INSERT INTO dsr.WorkCategories (CategoryCode, CategoryName, SortOrder, CreatedByUserId)
SELECT v.Code, v.Name, v.Sort, 1
FROM (VALUES (N'DEV', N'Development', 1), (N'TEST', N'Testing', 2), (N'BUGFIX', N'Bug Fixing', 3),
             (N'REVIEW', N'Code Review', 4), (N'MEETING', N'Meetings', 5), (N'ANALYSIS', N'Analysis & Design', 6),
             (N'DOC', N'Documentation', 7), (N'SUPPORT', N'Production Support', 8), (N'OTHER', N'Other', 99)) v (Code, Name, Sort)
WHERE NOT EXISTS (SELECT 1 FROM dsr.WorkCategories w WHERE w.CategoryCode = v.Code);
GO

-- Assign departments to the sample users so reports have something to group by.
UPDATE u SET u.DepartmentId = d.Id
FROM dsr.Users u CROSS APPLY (SELECT TOP 1 Id FROM dsr.Departments WHERE DepartmentCode =
        CASE WHEN u.Designation LIKE N'%QA%' OR u.Designation LIKE N'%Quality%' THEN N'QA'
             WHEN u.Designation LIKE N'%Manager%' THEN N'PMO'
             WHEN u.Designation LIKE N'%Administrator%' THEN N'CORP'
             ELSE N'ENG' END) d
WHERE u.DepartmentId IS NULL AND u.IsServiceAccount = 0;
GO

/*==============================================================================================
  6. THE REPORTING SPINE -- every requested field on one row.
     Replaces nothing; vw_DsrEntryDetail is left intact for the existing reports.
  ==============================================================================================*/
CREATE OR ALTER VIEW dsr.vw_DsrDetailReport
AS
SELECT
    /* ---- DSR ---- */
    d.Id                            AS DsrEntryId,
    d.WorkDate,
    d.SubmittedOn,
    d.StatusCode,
    ApprovalStatus = CASE d.StatusCode
                        WHEN N'APPROVED' THEN N'Approved'
                        WHEN N'RETURNED' THEN N'Returned'
                        WHEN N'SUBMITTED' THEN N'Pending Approval'
                        ELSE N'Draft' END,
    d.ApprovedByUserId,
    ApprovedByName = appr.FullName,
    d.ApprovalDate,
    d.ReviewComments,
    d.IsNoWorkDone,

    /* ---- Employee ---- */
    u.Id                            AS UserId,
    u.EmployeeCode,
    EmployeeName = u.FullName,
    EmployeeEmail = u.Email,
    u.Designation,
    u.DepartmentId,
    DepartmentName = dept.DepartmentName,
    DepartmentCode = dept.DepartmentCode,
    u.ManagerUserId,
    ManagerName = mgr.FullName,
    ManagerEmail = mgr.Email,
    u.StandardDailyHours,

    /* ---- Project ---- */
    d.ProjectId,
    p.ProjectCode,
    p.ProjectName,
    ProjectStartDate = p.StartDate,
    ProjectEndDate = p.EndDate,
    ProjectStatus = p.Status,
    ProjectManagerName = pmgr.FullName,

    /* ---- Task ---- */
    TaskDescription = d.WorkDescriptionPlain,
    TaskDescriptionHtml = d.WorkDescriptionHtml,
    d.WorkCategoryId,
    WorkCategoryName = wc.CategoryName,
    d.EstimatedHours,
    HoursLogged = ISNULL(d.ActualHours, d.EstimatedHours),
    d.ActualHours,
    d.RemainingHours,
    TaskEntryDate = d.CreatedDate,
    d.ModifiedDate,

    /* ---- AI (day grain, joined for completeness) ---- */
    ai.IsAiUsed,
    AiToolName = t.ToolName
FROM        dsr.DSREntries      d
JOIN        dsr.Users           u    ON u.Id  = d.UserId
LEFT JOIN   dsr.Departments     dept ON dept.Id = u.DepartmentId
LEFT JOIN   dsr.Users           mgr  ON mgr.Id = u.ManagerUserId
LEFT JOIN   dsr.Projects        p    ON p.Id  = d.ProjectId
LEFT JOIN   dsr.Users           pmgr ON pmgr.Id = p.ProjectManagerUserId
LEFT JOIN   dsr.Users           appr ON appr.Id = d.ApprovedByUserId
LEFT JOIN   dsr.WorkCategories  wc   ON wc.Id = d.WorkCategoryId
LEFT JOIN   dsr.DailyAiUsage    ai   ON ai.UserId = d.UserId AND ai.WorkDate = d.WorkDate AND ai.IsActive = 1
LEFT JOIN   dsr.AiTools         t    ON t.Id = ai.AiToolId
WHERE       d.IsActive = 1;
GO

PRINT N'>> Created dsr.vw_DsrDetailReport.';
GO

/*==============================================================================================
  7. fn_GetMissingDsrDays -- now returns Manager, Department and Email.
     The requirement asks for "Employee, Manager, Department"; the previous signature returned
     only UserId/Code/Name/ManagerUserId, so the report could not display a manager or department
     name at all. Service accounts, weekends, mandatory holidays, pre-joining and post-exit dates
     remain excluded.
  ==============================================================================================*/
CREATE OR ALTER FUNCTION dsr.fn_GetMissingDsrDays
(
    @FromDate       DATE,
    @ToDate         DATE,
    @ManagerUserId  INT = NULL,
    @DepartmentId   INT = NULL
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
                           WHERE h.HolidayDate = d.CalendarDate AND h.IsOptional = 0 AND h.IsActive = 1)
    ),
    EligibleUsers AS
    (
        SELECT  u.Id, u.EmployeeCode, u.FullName, u.Email, u.Designation,
                u.ManagerUserId, ManagerName = mgr.FullName,
                u.DepartmentId, DepartmentName = dept.DepartmentName,
                u.DateOfJoining, u.DateOfExit
        FROM        dsr.Users u
        LEFT JOIN   dsr.Users mgr ON mgr.Id = u.ManagerUserId
        LEFT JOIN   dsr.Departments dept ON dept.Id = u.DepartmentId
        WHERE       u.IsActive = 1
          AND       u.IsServiceAccount = 0
          AND      (@ManagerUserId IS NULL OR u.ManagerUserId = @ManagerUserId)
          AND      (@DepartmentId  IS NULL OR u.DepartmentId  = @DepartmentId)
    )
    SELECT  UserId = u.Id,
            u.EmployeeCode,
            EmployeeName = u.FullName,
            EmployeeEmail = u.Email,
            u.Designation,
            u.ManagerUserId,
            u.ManagerName,
            u.DepartmentId,
            u.DepartmentName,
            MissingDate = w.CalendarDate
    FROM        EligibleUsers u
    CROSS JOIN  WorkingDays  w
    WHERE   (u.DateOfJoining IS NULL OR w.CalendarDate >= u.DateOfJoining)
      AND   (u.DateOfExit    IS NULL OR w.CalendarDate <= u.DateOfExit)
      AND   NOT EXISTS (SELECT 1 FROM dsr.DSREntries d
                        WHERE d.UserId = u.Id AND d.WorkDate = w.CalendarDate AND d.IsActive = 1)
);
GO

PRINT N'>> fn_GetMissingDsrDays now returns Manager, Department, Email and Designation.';
GO

/*----------------------------------------------------------------------------------------------
  8. Verification
----------------------------------------------------------------------------------------------*/
SELECT Item = 'Departments',        Cnt = (SELECT COUNT(*) FROM dsr.Departments)
UNION ALL SELECT 'WorkCategories',  (SELECT COUNT(*) FROM dsr.WorkCategories)
UNION ALL SELECT 'Users with dept', (SELECT COUNT(*) FROM dsr.Users WHERE DepartmentId IS NOT NULL)
UNION ALL SELECT 'DSR rows',        (SELECT COUNT(*) FROM dsr.DSREntries WHERE IsActive = 1)
UNION ALL SELECT 'Detail view rows',(SELECT COUNT(*) FROM dsr.vw_DsrDetailReport);
GO

PRINT N'>> Migration 07 complete.';
GO
