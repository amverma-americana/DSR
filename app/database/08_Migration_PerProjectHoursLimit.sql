/*==============================================================================================
  MIGRATION 08 -- HOURS LIMIT BECOMES PER PROJECT PER DAY
  ----------------------------------------------------------------------------------------------
  Run AFTER migrations 01-07.

  BEHAVIOUR CHANGE
    Before : Users.StandardDailyHours capped the TOTAL hours for a date across all projects.
             An employee on 8 hours who logged 8 against Project A could not log anything at all
             against Project B.
    After  : StandardDailyHours caps hours PER PROJECT per day. The same employee may log up to
             8 against Project A and a further 8 against Project B on the same date, across as
             many separate entries as they like.

                 SUM(EstimatedHours) per (UserId, WorkDate, ProjectId) <= Users.StandardDailyHours

  SECONDARY GUARD (retained deliberately)
    The day's TOTAL across all projects is still capped by the configurable AppSettings key
    DSR.MaxDailyHours (default 24). Without a ceiling, N projects would permit 8 * N hours and
    nothing would prevent a 40-hour Tuesday. This is a physical-sanity limit, not the business
    rule -- raise or lower it in the Admin settings screen, or set it to 24 to make it a no-op.

  UNCHANGED
    - Multiple entries per project per day remain allowed (migration 06).
    - One "No Work Done" declaration per day, never alongside real work.
    - CK_DSREntries_HoursRange (0-24 per single entry).
    - trg_DSREntries_ProjectWindow.
  ==============================================================================================*/

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

USE [DSRResourceManagement];
GO

/*----------------------------------------------------------------------------------------------
  Report any existing data that the NEW rule would reject, before changing the rule.
  Nothing is modified: pre-existing rows are left alone, but you should know they exist because
  editing one of them will now fail until its hours are reduced.
----------------------------------------------------------------------------------------------*/
PRINT N'>> Rows exceeding the new per-project limit (informational only):';

SELECT      EmployeeName = u.FullName,
            ProjectName  = ISNULL(p.ProjectName, N'(no project)'),
            d.WorkDate,
            ProjectHours = SUM(d.EstimatedHours),
            StandardDailyHours = u.StandardDailyHours
FROM        dsr.DSREntries d
JOIN        dsr.Users      u ON u.Id = d.UserId
LEFT JOIN   dsr.Projects   p ON p.Id = d.ProjectId
WHERE       d.IsActive = 1
GROUP BY    u.FullName, p.ProjectName, d.WorkDate, u.StandardDailyHours
HAVING      SUM(d.EstimatedHours) > u.StandardDailyHours
ORDER BY    d.WorkDate DESC;
GO

/*----------------------------------------------------------------------------------------------
  Replace the trigger. Rule 1 is now grouped by ProjectId; rule 1b is the whole-day ceiling.
----------------------------------------------------------------------------------------------*/
CREATE OR ALTER TRIGGER dsr.trg_DSREntries_DailyRules
ON dsr.DSREntries
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    -- Guard on inserted, NOT @@ROWCOUNT: any SET statement (including the one above) resets it to 0.
    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;

    -- Skip metadata-only updates (StatusCode, SubmittedOn, ReviewComments, audit columns...).
    IF EXISTS (SELECT 1 FROM deleted)
       AND NOT (UPDATE(EstimatedHours) OR UPDATE(IsActive) OR UPDATE(UserId)
                OR UPDATE(WorkDate) OR UPDATE(IsNoWorkDone) OR UPDATE(ProjectId))
        RETURN;

    /*  Rule 1: PER PROJECT per day <= that employee's StandardDailyHours.
        Grouping now includes ProjectId, which is the whole point of this migration.           */
    IF EXISTS (
        SELECT 1
        FROM        dsr.DSREntries d
        JOIN        dsr.Users      u ON u.Id = d.UserId
        WHERE       d.IsActive = 1
          AND       d.ProjectId IS NOT NULL
          AND       EXISTS (SELECT 1 FROM inserted i
                            WHERE i.UserId = d.UserId AND i.WorkDate = d.WorkDate AND i.ProjectId = d.ProjectId)
        GROUP BY    d.UserId, d.WorkDate, d.ProjectId, u.StandardDailyHours
        HAVING      SUM(d.EstimatedHours) > u.StandardDailyHours)
    BEGIN
        THROW 51001, N'Hours for a single project on one date exceed the employee''s standard daily hours.', 1;
    END

    /*  Rule 1b: absolute ceiling for the whole day, from AppSettings DSR.MaxDailyHours.        */
    DECLARE @MaxDailyHours DECIMAL(5,2) =
        (SELECT TRY_CAST(SettingValue AS DECIMAL(5,2)) FROM dsr.AppSettings
         WHERE SettingKey = N'DSR.MaxDailyHours' AND IsActive = 1);
    SET @MaxDailyHours = ISNULL(@MaxDailyHours, 24.00);

    IF EXISTS (
        SELECT 1
        FROM        dsr.DSREntries d
        WHERE       d.IsActive = 1
          AND       EXISTS (SELECT 1 FROM inserted i WHERE i.UserId = d.UserId AND i.WorkDate = d.WorkDate)
        GROUP BY    d.UserId, d.WorkDate
        HAVING      SUM(d.EstimatedHours) > @MaxDailyHours)
    BEGIN
        THROW 51004, N'Total hours for this date across all projects exceed the configured daily maximum.', 1;
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

PRINT N'>> trg_DSREntries_DailyRules now enforces StandardDailyHours PER PROJECT, plus a whole-day ceiling.';
GO
