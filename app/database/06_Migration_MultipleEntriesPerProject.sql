/*==============================================================================================
  MIGRATION 06 -- ALLOW MULTIPLE WORK ENTRIES PER PROJECT PER DAY
  ----------------------------------------------------------------------------------------------
  Run AFTER migrations 01-05.

  BEHAVIOUR CHANGE
    Before : one DSR entry per (employee, work date, project). Logging a project removed it from
             the dropdown for the rest of that day.
    After  : an employee may log any number of entries against the same project on the same date,
             timesheet style:
                 Project A -> API Development -> 4h
                 Project A -> Unit Testing    -> 2h
                 Project A -> Bug Fixing      -> 1h
             The only limit on the day is the employee's own StandardDailyHours.

  WHAT CHANGES HERE
    1. UQ_DSREntries_User_Date_Project_Active is DROPPED. That filtered unique index was the
       database-level enforcement of the old rule.
    2. It is replaced with a NON-unique index on the same columns, so the per-project reporting
       and duplicate-detection queries keep their seek path and nothing regresses.
    3. trg_DSREntries_DailyRules now validates the daily total against the employee's
       Users.StandardDailyHours instead of the global AppSettings key DSR.MaxDailyHours.

  WHAT DELIBERATELY DOES NOT CHANGE
    - CK_DSREntries_HoursRange (0-24 per entry) stays: it is a data-sanity rule, not the daily cap.
    - UQ_DSREntries_User_Date_NoWork_Active stays: a "No Work Done" declaration is still once
      per day, and still cannot coexist with real work entries.
    - trg_DSREntries_ProjectWindow stays: effort still cannot be logged outside a project window.

  REVERSIBILITY
    To restore the old one-entry-per-project rule, drop IX_DSREntries_User_Date_Project and
    recreate the unique filtered index (script at the foot of this file). That will FAIL if
    duplicate rows already exist, which is the correct outcome.
  ==============================================================================================*/

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

USE [DSRResourceManagement];
GO

/*----------------------------------------------------------------------------------------------
  1. Drop the one-entry-per-project unique index
----------------------------------------------------------------------------------------------*/
IF EXISTS (SELECT 1 FROM sys.indexes
           WHERE name = N'UQ_DSREntries_User_Date_Project_Active'
             AND object_id = OBJECT_ID(N'dsr.DSREntries'))
BEGIN
    DROP INDEX UQ_DSREntries_User_Date_Project_Active ON dsr.DSREntries;
    PRINT N'>> Dropped UQ_DSREntries_User_Date_Project_Active (one entry per project per day).';
END
ELSE PRINT N'   UQ_DSREntries_User_Date_Project_Active not present - nothing to drop.';
GO

/*----------------------------------------------------------------------------------------------
  2. Replace it with a non-unique covering index so query plans do not regress.
     The same (UserId, WorkDate, ProjectId) seek is still used by the day view and by the
     per-project reporting paths; it simply no longer enforces uniqueness.
----------------------------------------------------------------------------------------------*/
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = N'IX_DSREntries_User_Date_Project'
                 AND object_id = OBJECT_ID(N'dsr.DSREntries'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_DSREntries_User_Date_Project
        ON dsr.DSREntries (UserId, WorkDate, ProjectId)
        INCLUDE (EstimatedHours, IsNoWorkDone)
        WHERE IsActive = 1;

    PRINT N'>> Created IX_DSREntries_User_Date_Project (non-unique replacement).';
END
ELSE PRINT N'   IX_DSREntries_User_Date_Project already exists.';
GO

/*----------------------------------------------------------------------------------------------
  3. Daily total is now capped by the EMPLOYEE'S StandardDailyHours, not a global setting.

     A CHECK constraint cannot express this: the rule spans every row for that employee-date and
     joins to Users. The trigger remains the last line of defence behind the service-layer check,
     which produces the friendly message.
----------------------------------------------------------------------------------------------*/
CREATE OR ALTER TRIGGER dsr.trg_DSREntries_DailyRules
ON dsr.DSREntries
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    -- Guard on inserted, NOT @@ROWCOUNT: any SET statement (including the one above) resets
    -- @@ROWCOUNT to 0, which would silently turn this trigger into a no-op.
    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;

    /*  Rule 1: total hours for an employee on one date may not exceed that employee's
        StandardDailyHours. Multiple entries against the SAME project are explicitly allowed;
        only the daily total is policed.                                                        */
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

    /*  Rule 2: a "No Work Done" declaration cannot coexist with real work entries.            */
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

PRINT N'>> trg_DSREntries_DailyRules now validates against Users.StandardDailyHours.';
GO

/*----------------------------------------------------------------------------------------------
  4. Verification
----------------------------------------------------------------------------------------------*/
SELECT  IndexName   = i.name,
        IsUnique    = i.is_unique,
        Filtered    = i.has_filter,
        Columns     = STUFF((SELECT N', ' + c.name
                             FROM sys.index_columns ic
                             JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                             WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
                             ORDER BY ic.key_ordinal
                             FOR XML PATH('')), 1, 2, N'')
FROM    sys.indexes i
WHERE   i.object_id = OBJECT_ID(N'dsr.DSREntries') AND i.name IS NOT NULL
ORDER BY i.name;
GO

PRINT N'>> Migration 06 complete. Multiple entries per project per day are now permitted.';
GO

/*==============================================================================================
  ROLLBACK (run only to restore the old one-entry-per-project rule).
  This intentionally fails if duplicates already exist -- clean them up first.
  ----------------------------------------------------------------------------------------------
  DROP INDEX IX_DSREntries_User_Date_Project ON dsr.DSREntries;

  CREATE UNIQUE NONCLUSTERED INDEX UQ_DSREntries_User_Date_Project_Active
      ON dsr.DSREntries (UserId, WorkDate, ProjectId)
      WHERE ProjectId IS NOT NULL AND IsActive = 1;
  ==============================================================================================*/
