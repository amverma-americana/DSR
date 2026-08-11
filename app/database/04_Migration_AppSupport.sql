/*==============================================================================================
  DSR & RESOURCE MANAGEMENT SYSTEM -- MIGRATION 04: APPLICATION SUPPORT OBJECTS
  ----------------------------------------------------------------------------------------------
  Run AFTER:  DSR_Schema_DDL.sql, DSR_Indexes_Views_Triggers.sql, DSR_Seed_SampleData.sql
  Purpose  :  Adds ONLY the objects required by the ASP.NET Core / React application that do not
              already exist in the base schema. Nothing here duplicates an existing table.
  ----------------------------------------------------------------------------------------------
  GAP ANALYSIS -- base schema (13 tables) vs. application requirements
  ----------------------------------------------------------------------------------------------
  REUSED AS-IS (no change): Users, Roles, UserRoles, UserCredentials, UserLoginAudit, Projects,
      ProjectAllocations, AiTools, Holidays, AppSettings, DSREntries, DailyAiUsage, AuditLog
      + 4 views, 2 TVFs, 4 triggers, 27 indexes.

  MISSING -> CREATED HERE:
    1. RefreshTokens      "Refresh Token Support" is an explicit requirement. The base schema has
                          no token store, so refresh tokens could only live in memory (breaking
                          on restart / scale-out) or be non-revocable. Rotation + reuse detection
                          require persistence.
    2. SsoRoleMappings    "Role mapping support" for Entra ID. Auto-provisioning otherwise has to
                          hard-code a default role. Maps an Entra group objectId -> application
                          Role, so group membership drives authorisation.

  MISSING DATA -> SEEDED HERE:
    3. AiTools            'Gemini' is required by the UI spec and absent from the base seed.
    4. AppSettings        Two SSO keys: default role for auto-provisioned users, and whether
                          auto-provisioning is permitted at all.

  DELIBERATELY NOT CREATED (already satisfied by the base schema):
    - Password reset       -> UserCredentials.MustChangePassword + SecurityStamp
    - Activate/deactivate  -> Users.IsActive (soft delete, organisation-wide pattern)
    - Audit information    -> AuditLog + per-row audit columns
    - Report data          -> vw_* views and fn_* table-valued functions
  ==============================================================================================*/

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

USE [DSRResourceManagement];
GO

/*----------------------------------------------------------------------------------------------
  1. RefreshTokens
     One row per issued refresh token. Rotation model: on refresh the presented token is marked
     revoked and ReplacedByTokenId points at its successor, so a replayed token is detectable as
     "already revoked but has a successor" -> the whole family is revoked (reuse detection).
     TokenHash, not the token itself: a database leak must not yield usable credentials.
----------------------------------------------------------------------------------------------*/
IF OBJECT_ID(N'dsr.RefreshTokens', N'U') IS NULL
BEGIN
    CREATE TABLE dsr.RefreshTokens
    (
        Id                  BIGINT      IDENTITY(1,1)   NOT NULL,   -- BIGINT: one row per login/refresh, unbounded
        UserId              INT                         NOT NULL,
        TokenHash           VARBINARY(32)               NOT NULL,   -- SHA-256 of the opaque token
        JwtId               NVARCHAR(64)                    NULL,   -- 'jti' of the access token it was paired with
        ExpiresOn           DATETIME2(3)                NOT NULL,
        CreatedByIp         NVARCHAR(45)                    NULL,
        RevokedOn           DATETIME2(3)                    NULL,
        RevokedByIp         NVARCHAR(45)                    NULL,
        RevokedReason       NVARCHAR(200)                   NULL,
        ReplacedByTokenId   BIGINT                          NULL,   -- rotation chain
        CreatedByUserId     INT                         NOT NULL,
        CreatedDate         DATETIME2(3)                NOT NULL    CONSTRAINT DF_RefreshTokens_CreatedDate DEFAULT (SYSUTCDATETIME()),
        ModifiedByUserId    INT                             NULL,
        ModifiedDate        DATETIME2(3)                    NULL,
        IsActive            BIT                         NOT NULL    CONSTRAINT DF_RefreshTokens_IsActive DEFAULT (1),

        CONSTRAINT PK_RefreshTokens PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_RefreshTokens_User            FOREIGN KEY (UserId)            REFERENCES dsr.Users(Id),
        CONSTRAINT FK_RefreshTokens_ReplacedByToken FOREIGN KEY (ReplacedByTokenId) REFERENCES dsr.RefreshTokens(Id),
        CONSTRAINT FK_RefreshTokens_CreatedByUser   FOREIGN KEY (CreatedByUserId)   REFERENCES dsr.Users(Id),
        CONSTRAINT FK_RefreshTokens_ModifiedByUser  FOREIGN KEY (ModifiedByUserId)  REFERENCES dsr.Users(Id),
        CONSTRAINT CK_RefreshTokens_ExpiryFuture    CHECK (ExpiresOn > CreatedDate),
        CONSTRAINT CK_RefreshTokens_RevokedPair     CHECK ((RevokedOn IS NULL AND RevokedReason IS NULL)
                                                        OR (RevokedOn IS NOT NULL AND RevokedReason IS NOT NULL)),
        CONSTRAINT CK_RefreshTokens_NoSelfReplace   CHECK (ReplacedByTokenId IS NULL OR ReplacedByTokenId <> Id)
    );

    -- Token lookup on every /auth/refresh call: unique so a hash collision or duplicate insert fails loudly
    CREATE UNIQUE NONCLUSTERED INDEX UQ_RefreshTokens_TokenHash ON dsr.RefreshTokens (TokenHash);

    -- "revoke all live tokens for this user" (logout-everywhere, deactivation, password reset)
    CREATE NONCLUSTERED INDEX IX_RefreshTokens_User_Active
        ON dsr.RefreshTokens (UserId, ExpiresOn) INCLUDE (RevokedOn)
        WHERE RevokedOn IS NULL;

    -- Retention sweep of expired rows
    CREATE NONCLUSTERED INDEX IX_RefreshTokens_ExpiresOn ON dsr.RefreshTokens (ExpiresOn);

    PRINT N'>> Created dsr.RefreshTokens (+3 indexes).';
END
ELSE PRINT N'   dsr.RefreshTokens already exists - skipped.';
GO

/*----------------------------------------------------------------------------------------------
  2. SsoRoleMappings
     Entra ID group objectId -> application Role. Evaluated on every SSO sign-in so that removing
     a user from an Entra group removes the application role on their next login.
     Precedence: highest Priority wins when a user belongs to several mapped groups.
----------------------------------------------------------------------------------------------*/
IF OBJECT_ID(N'dsr.SsoRoleMappings', N'U') IS NULL
BEGIN
    CREATE TABLE dsr.SsoRoleMappings
    (
        Id                  INT         IDENTITY(1,1)   NOT NULL,
        ExternalGroupId     NVARCHAR(100)               NOT NULL,   -- Entra group objectId (from the 'groups' claim)
        ExternalGroupName   NVARCHAR(200)                   NULL,   -- display only
        RoleId              INT                         NOT NULL,
        Priority            SMALLINT                    NOT NULL    CONSTRAINT DF_SsoRoleMappings_Priority DEFAULT (100),
        CreatedByUserId     INT                         NOT NULL,
        CreatedDate         DATETIME2(3)                NOT NULL    CONSTRAINT DF_SsoRoleMappings_CreatedDate DEFAULT (SYSUTCDATETIME()),
        ModifiedByUserId    INT                             NULL,
        ModifiedDate        DATETIME2(3)                    NULL,
        IsActive            BIT                         NOT NULL    CONSTRAINT DF_SsoRoleMappings_IsActive DEFAULT (1),

        CONSTRAINT PK_SsoRoleMappings PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_SsoRoleMappings_Role            FOREIGN KEY (RoleId)           REFERENCES dsr.Roles(Id),
        CONSTRAINT FK_SsoRoleMappings_CreatedByUser   FOREIGN KEY (CreatedByUserId)  REFERENCES dsr.Users(Id),
        CONSTRAINT FK_SsoRoleMappings_ModifiedByUser  FOREIGN KEY (ModifiedByUserId) REFERENCES dsr.Users(Id),
        CONSTRAINT CK_SsoRoleMappings_Priority        CHECK (Priority >= 0)
    );

    CREATE UNIQUE NONCLUSTERED INDEX UQ_SsoRoleMappings_Group_Role_Active
        ON dsr.SsoRoleMappings (ExternalGroupId, RoleId) WHERE IsActive = 1;

    CREATE NONCLUSTERED INDEX IX_SsoRoleMappings_RoleId ON dsr.SsoRoleMappings (RoleId);

    PRINT N'>> Created dsr.SsoRoleMappings (+2 indexes).';
END
ELSE PRINT N'   dsr.SsoRoleMappings already exists - skipped.';
GO

/*----------------------------------------------------------------------------------------------
  3. AiTools -- add 'Gemini' (required by the UI spec, absent from the base seed)
----------------------------------------------------------------------------------------------*/
INSERT INTO dsr.AiTools (ToolName, Vendor, Category, CreatedByUserId)
SELECT N'Gemini', N'Google', N'CHAT_LLM', 1
WHERE NOT EXISTS (SELECT 1 FROM dsr.AiTools WHERE ToolName = N'Gemini');
GO

/*----------------------------------------------------------------------------------------------
  4. AppSettings -- SSO auto-provisioning behaviour + token lifetimes
----------------------------------------------------------------------------------------------*/
INSERT INTO dsr.AppSettings (SettingKey, SettingValue, DataType, Description, IsEditable, CreatedByUserId)
SELECT v.SettingKey, v.SettingValue, v.DataType, v.Description, 1, 1
FROM (VALUES
    (N'Sso.AutoProvisionEnabled',  N'true',     N'BOOL',   N'Create a Users row automatically on first successful Entra ID sign-in.'),
    (N'Sso.DefaultRoleCode',       N'EMPLOYEE', N'STRING', N'Role granted to an auto-provisioned SSO user when no SsoRoleMappings entry matches.'),
    (N'Auth.AccessTokenMinutes',   N'60',       N'INT',    N'Access token lifetime in minutes.'),
    (N'Auth.RefreshTokenDays',     N'14',       N'INT',    N'Refresh token lifetime in days.')
) v (SettingKey, SettingValue, DataType, Description)
WHERE NOT EXISTS (SELECT 1 FROM dsr.AppSettings s WHERE s.SettingKey = v.SettingKey);
GO

/*----------------------------------------------------------------------------------------------
  5. Reporting object required by the application that the base schema does not provide:
     monthly rollup per employee. The base schema has a DAILY summary view; the Monthly Summary
     Report needs employee x month with distinct-day and AI-adoption measures.
----------------------------------------------------------------------------------------------*/
CREATE OR ALTER VIEW dsr.vw_DsrMonthlySummary
AS
SELECT  d.UserId,
        u.FullName                              AS EmployeeName,
        u.EmployeeCode,
        u.ManagerUserId,
        DATEPART(YEAR,  d.WorkDate)             AS WorkYear,
        DATEPART(MONTH, d.WorkDate)             AS WorkMonth,
        COUNT(*)                                AS EntryCount,
        COUNT(DISTINCT d.WorkDate)              AS DaysLogged,
        COUNT(DISTINCT d.ProjectId)             AS ProjectCount,
        SUM(d.EstimatedHours)                   AS TotalHours,
        SUM(CASE WHEN d.IsNoWorkDone = 1 THEN 1 ELSE 0 END) AS NoWorkDayCount,
        u.StandardDailyHours,
        CAST(SUM(d.EstimatedHours) * 1.0
             / NULLIF(COUNT(DISTINCT d.WorkDate), 0) AS DECIMAL(9,2)) AS AvgHoursPerLoggedDay
FROM        dsr.DSREntries d
JOIN        dsr.Users      u ON u.Id = d.UserId
WHERE       d.IsActive = 1
GROUP BY    d.UserId, u.FullName, u.EmployeeCode, u.ManagerUserId,
            DATEPART(YEAR, d.WorkDate), DATEPART(MONTH, d.WorkDate), u.StandardDailyHours;
GO

PRINT N'>> Migration 04 complete.';
GO

/*----------------------------------------------------------------------------------------------
  VERIFICATION
----------------------------------------------------------------------------------------------*/
SELECT 'Tables' AS Item, COUNT(*) AS Cnt FROM sys.tables WHERE SCHEMA_NAME(schema_id) = 'dsr'
UNION ALL SELECT 'Views', COUNT(*) FROM sys.views WHERE SCHEMA_NAME(schema_id) = 'dsr'
UNION ALL SELECT 'AiTools rows', COUNT(*) FROM dsr.AiTools
UNION ALL SELECT 'AppSettings rows', COUNT(*) FROM dsr.AppSettings;
GO
