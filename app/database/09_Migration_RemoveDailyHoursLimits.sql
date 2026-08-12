/**********************************************************************************************
  09_Migration_RemoveDailyHoursLimits.sql

  DAILY HOURS LIMITS REMOVED as per current business requirement.
  8 hours becomes the utilisation BENCHMARK only; it no longer restricts what may be entered.

  ------------------------------------------------------------------------------------------
  WHY A MIGRATION IS REQUIRED AT ALL
  ------------------------------------------------------------------------------------------
  The cap was enforced in TWO independent layers:

      1. C#  -- DsrEntryService.EnsureHoursCapAsync  (now commented out)
      2. SQL -- dsr.trg_DSREntries_DailyRules        (this migration)

  Disabling only the C# check leaves the trigger throwing 51001 / 51004, so a 12-hour entry
  still fails -- and it fails as a raw SQL error rather than a handled business rule, which
  reads to the user as a crash. Both layers must change together.

  ------------------------------------------------------------------------------------------
  WHAT THIS SCRIPT DOES
  ------------------------------------------------------------------------------------------
  Rebuilds dsr.trg_DSREntries_DailyRules, dropping:

      * Rule 1  (THROW 51001) -- per project per day <= Users.StandardDailyHours
      * Rule 1b (THROW 51004) -- whole day <= AppSettings 'DSR.MaxDailyHours'

  and KEEPING:

      * Rule 2  (THROW 51002) -- a "No Work Done" declaration cannot coexist with real entries.
        This is a data-integrity rule about contradictory statements, not an hours limit, so it
        stays. Without it an employee could simultaneously declare "no work" and log 6 hours.

  NOT changed, deliberately:

      * CK_DSREntries_HoursRange (EstimatedHours BETWEEN 0 AND 24) stays. It bounds a SINGLE
        entry, not a day: a day may now total 25h+ across several entries, but no one entry can
        claim more than 24 hours, which is physically impossible and almost always a typo
        (entering 80 instead of 8). It never blocked anything above 8, so it is not one of the
        restrictions being removed. The matching FluentValidation rule is kept in step with it.

      * dsr.fn_GetResourceUtilization is UNCHANGED. It already computes
            LoggedHours * 100 / (WorkingDays * StandardDailyHours)
        which is exactly the requested benchmark formula, and it is not capped -- 25 hours
        against an 8-hour benchmark already returns 312.50. Nothing needed to change; the only
        reason such a figure was never seen is that the validation prevented logging 25 hours.

  Idempotent and safe to re-run. No data is modified.

  Run with:  sqlcmd -S <server> -d DSRResourceManagement -C -I -i 09_Migration_RemoveDailyHoursLimits.sql
**********************************************************************************************/

SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

USE DSRResourceManagement;
GO

PRINT '--- 09_Migration_RemoveDailyHoursLimits ---';
GO

/*----------------------------------------------------------------------------------------------
  Rebuild the trigger without the two hours ceilings.

  DROP-then-CREATE rather than CREATE OR ALTER, deliberately.

  CREATE OR ALTER requires SQL Server 2016 SP1 or later. The server here is 2025, so it EXECUTES
  fine -- but the design-time T-SQL parser in Visual Studio / older SSDT targets an earlier
  version, rejects it, and then loses its place in the file. Once desynced the parser no longer
  knows it is inside a trigger body, so it misreads the BEGIN further down as the start of
  BEGIN TRANSACTION and reports:

      Incorrect syntax near 'THROW'. Expecting CONVERSATION, DIALOG, DISTRIBUTED, or TRANSACTION.
      Incorrect syntax near 'GO'.    Expecting CONVERSATION.

  Those THROW/GO errors are CASCADING noise, not defects -- THROW is valid from SQL Server 2012.
  Removing the one unsupported construct clears all of them, and this pattern is just as
  idempotent and re-runnable.
----------------------------------------------------------------------------------------------*/
IF OBJECT_ID(N'dsr.trg_DSREntries_DailyRules', N'TR') IS NOT NULL
    DROP TRIGGER dsr.trg_DSREntries_DailyRules;
GO

CREATE TRIGGER dsr.trg_DSREntries_DailyRules
ON dsr.DSREntries
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    -- Guard on inserted, NOT @@ROWCOUNT: any SET statement (including the one above) resets it to 0.
    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;

    -- Skip metadata-only updates (StatusCode, SubmittedOn, audit columns...).
    IF EXISTS (SELECT 1 FROM deleted)
       AND NOT (UPDATE(EstimatedHours) OR UPDATE(IsActive) OR UPDATE(UserId)
                OR UPDATE(WorkDate) OR UPDATE(IsNoWorkDone) OR UPDATE(ProjectId))
        RETURN;

    /*  DAILY HOURS LIMITS REMOVED as per current business requirement.
        8 hours is a utilisation benchmark, not a ceiling.

        Rule 1  (51001): per project per day <= u.StandardDailyHours   -- REMOVED
        Rule 1b (51004): whole day <= AppSettings 'DSR.MaxDailyHours'  -- REMOVED

        Previous definitions are preserved in 06_Migration_MultipleEntriesPerProject.sql and
        08_Migration_PerProjectHoursLimit.sql should either ever need reinstating.              */

    /*  Rule 2: a "No Work Done" declaration cannot coexist with real work entries.
        RETAINED -- this is contradictory-data protection, not an hours limit.                  */
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

PRINT '  trg_DSREntries_DailyRules rebuilt: hours ceilings removed, No-Work-Done rule kept.';
GO

/*----------------------------------------------------------------------------------------------
  Verification. Confirms the two rules are gone and the third survives.
----------------------------------------------------------------------------------------------*/
DECLARE @def NVARCHAR(MAX) =
    (SELECT definition FROM sys.sql_modules WHERE object_id = OBJECT_ID(N'dsr.trg_DSREntries_DailyRules'));

/*  Match on 'THROW 51001', not on the bare number.

    The first version of this check tested LIKE '%51001%' and reported the ceiling as still
    present -- because the explanatory comment block inside the new trigger body mentions 51001
    and 51004 by name. It was matching its own documentation. Testing for the THROW statement
    distinguishes executable code from a comment about it.                                      */
IF @def LIKE N'%THROW 51001%' OR @def LIKE N'%THROW 51004%'
    PRINT '  *** WARNING: an hours ceiling (THROW 51001/51004) is still present in the trigger.';
ELSE
    PRINT '  OK: no hours ceiling (THROW 51001 / 51004) remains.';

IF @def LIKE N'%THROW 51002%'
    PRINT '  OK: No-Work-Done coexistence rule (THROW 51002) retained.';
ELSE
    PRINT '  *** WARNING: the No-Work-Done rule (51002) was lost.';
GO

PRINT '--- 09_Migration_RemoveDailyHoursLimits complete ---';
GO
