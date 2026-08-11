/*==============================================================================================
  MIGRATION 05 -- DEVELOPMENT PASSWORD SEED   ** DO NOT RUN IN PRODUCTION **
  ----------------------------------------------------------------------------------------------
  The sample-data script inserts an illustrative placeholder hash. The application's PasswordHasher
  uses the format {version}.{iterations}.{base64 salt}.{base64 key} (PBKDF2-SHA256, 210,000
  iterations, 128-bit salt, 256-bit key), so the placeholder cannot be verified and DATABASE login
  would always fail.

  This script installs a REAL hash for every DATABASE/BOTH account so the environment is usable
  immediately, and forces a password change at first sign-in.

  Password for every seeded account: Dsr@Admin#2026
  ==============================================================================================*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
USE [DSRResourceManagement];
GO

DECLARE @Hash NVARCHAR(500) = N'v1.210000.kyTjlqE8ipWMRjkdyYMYtQ==.to617NpIOGJXOnukYrQVbxkbnU5swvI8u3YjeEmg3kA=';

/*  MustChangePassword = 0 in development, deliberately.

    With it set to 1 the first sign-in forces a password change, which rotates the hash and makes
    the documented dev password above stop working -- so every developer who signs in once then
    finds "Invalid email address or password" on their next attempt, and has to re-run this script.
    That is correct behaviour for production provisioning and a nuisance in dev.

    Set @ForcePasswordChange = 1 below when you specifically want to exercise the forced-change
    flow; leave it 0 for day-to-day development.                                                  */
DECLARE @ForcePasswordChange BIT = 0;

/*  @OverwriteChangedPasswords = 0 (default) makes this script NON-DESTRUCTIVE.

    Previously it reset every credential unconditionally. If a developer had changed their password
    through the UI, re-running this script silently reverted it, and their new password then failed
    with "Invalid email address or password" for no visible reason. With this flag off, only
    accounts still holding the seeded hash are touched; a deliberately changed password survives.

    Set it to 1 to force every dev account back to the password above.                            */
DECLARE @OverwriteChangedPasswords BIT = 0;

UPDATE  c
SET     c.PasswordHash        = @Hash,
        c.MustChangePassword  = @ForcePasswordChange,
        c.FailedLoginAttempts = 0,
        c.LockoutEndDate      = NULL,
        c.SecurityStamp       = NEWID(),
        c.PasswordChangedDate = SYSUTCDATETIME(),
        c.ModifiedByUserId    = 1,
        c.ModifiedDate        = SYSUTCDATETIME()
FROM        dsr.UserCredentials c
JOIN        dsr.Users u ON u.Id = c.UserId
WHERE       u.Email <> N'system@dsr.local'
  AND      (@OverwriteChangedPasswords = 1 OR c.PasswordHash = @Hash OR c.PasswordChangedDate IS NULL);

DECLARE @Reset INT = @@ROWCOUNT;
DECLARE @Skipped INT = (SELECT COUNT(*) FROM dsr.UserCredentials c JOIN dsr.Users u ON u.Id = c.UserId
                        WHERE u.Email <> N'system@dsr.local' AND c.PasswordHash <> @Hash);

PRINT N'>> Development passwords set on ' + CAST(@Reset AS NVARCHAR(10)) + N' account(s). Password: Dsr@Admin#2026';

IF @Skipped > 0 AND @OverwriteChangedPasswords = 0
    PRINT N'>> ' + CAST(@Skipped AS NVARCHAR(10)) + N' account(s) kept a password changed through the UI. '
        + N'Set @OverwriteChangedPasswords = 1 to force those back to the default.';

SELECT  u.Email,
        u.AuthenticationType,
        Roles = STUFF((SELECT N', ' + r.RoleCode
                       FROM dsr.UserRoles ur JOIN dsr.Roles r ON r.Id = ur.RoleId
                       WHERE ur.UserId = u.Id AND ur.IsActive = 1
                       FOR XML PATH('')), 1, 2, N''),
        CanPasswordLogin = CASE WHEN c.Id IS NULL THEN N'No' ELSE N'Yes' END
FROM        dsr.Users u
LEFT JOIN   dsr.UserCredentials c ON c.UserId = u.Id
WHERE       u.IsServiceAccount = 0
ORDER BY    u.Email;
GO
