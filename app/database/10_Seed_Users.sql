/**********************************************************************************************
  10_Seed_Users.sql -- SEED TWO SIGN-IN ACCOUNTS

      admin@contoso.com     password: Dsr@Admin#2026     roles: ADMIN, EMPLOYEE
      amverma@contoso.com   password: Dsr@Admin#2026     roles: EMPLOYEE

  ** CONTAINS KNOWN PASSWORDS -- DO NOT RUN IN PRODUCTION. **

  ------------------------------------------------------------------------------------------
  WHY THE HASHES ARE LITERALS AND NOT COMPUTED HERE
  ------------------------------------------------------------------------------------------
  The application hashes with PBKDF2-SHA256, 210,000 iterations, a 128-bit salt and a 256-bit
  key, serialised as {version}.{iterations}.{base64 salt}.{base64 key} -- see
  DSR.Infrastructure/Services/SupportServices.cs, class PasswordHasher.

  T-SQL has no PBKDF2 primitive. Emulating 210,000 HASHBYTES rounds in a loop would take
  minutes per password and would be easy to get subtly wrong, and a subtly wrong hash fails as
  "Invalid email address or password" with nothing to indicate the seed was at fault. The two
  hashes below were therefore generated with the identical parameters and verified against the
  same algorithm before being embedded. Each has its OWN random salt, so the two rows do not
  share a hash even though they share a password.

  To regenerate (Node):
      const c=require('crypto'); const s=c.randomBytes(16);
      console.log(['v1',210000,s.toString('base64'),
        c.pbkdf2Sync('Dsr@Admin#2026',s,210000,32,'sha256').toString('base64')].join('.'));

  ------------------------------------------------------------------------------------------
  BEHAVIOUR
  ------------------------------------------------------------------------------------------
  Idempotent. Re-running is safe and converges on the same state:

      * creates each user only if the email is absent; never duplicates
      * creates or updates that user's credential row to the hash below
      * grants the listed roles, reactivating a soft-deleted grant rather than duplicating it
      * clears lockout and failed-attempt counters so a locked test account is usable again
      * leaves MustChangePassword = 0, so the documented password keeps working

  SCOPED BY EMAIL. It touches ONLY the two accounts named above. An earlier password-seed
  script in this project reset EVERY credential unconditionally, which silently reverted
  passwords developers had changed through the UI and produced "Invalid email address or
  password" with no visible cause. This one can never do that.

  @OverwriteExistingPassword controls whether an EXISTING credential is reset:
      1 (default) -- guarantee the documented password works. This is the point of the script.
      0           -- only create missing credentials; leave any existing password untouched.

  Run with:
      sqlcmd -S <server> -d DSRResourceManagement -C -I -i 10_Seed_Users.sql
**********************************************************************************************/

SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO
SET NOCOUNT ON;
GO

USE DSRResourceManagement;
GO

PRINT '--- 10_Seed_Users ---';
GO

DECLARE @OverwriteExistingPassword BIT = 1;

/*  Password for both accounts: Dsr@Admin#2026
    PBKDF2-SHA256 / 210,000 iterations / 128-bit salt / 256-bit key. Distinct salt each.       */
DECLARE @HashAdmin   NVARCHAR(500) = N'v1.210000.ZdNjtoV3+oYigAqoUnvVGw==.sqNjKu1C2Nn7MSAAa/WLVhB5YDTXmMo0ccdrqPlSTm4=';
DECLARE @HashAmverma NVARCHAR(500) = N'v1.210000.j2UUI7nSKkBRQg+f2Ph5hw==.fNrB6LqUEn28Xe2V2pFcWERfmhqdNmLQjmfmbeKKhFc=';

/*  The accounts to seed. Held in a table variable so the logic below is written once and
    applied to both, rather than copy-pasted per user.                                          */
DECLARE @Seed TABLE
(
    Email       NVARCHAR(256) NOT NULL PRIMARY KEY,
    FirstName   NVARCHAR(100) NOT NULL,
    LastName    NVARCHAR(100) NOT NULL,
    EmployeeCode NVARCHAR(30)     NULL,
    Designation NVARCHAR(100)     NULL,
    PasswordHash NVARCHAR(500) NOT NULL,
    IsAdmin     BIT           NOT NULL
);

INSERT @Seed (Email, FirstName, LastName, EmployeeCode, Designation, PasswordHash, IsAdmin)
VALUES
    (N'admin@contoso.com',   N'System', N'Administrator', N'EMP-0001', N'Administrator',   @HashAdmin,   1),
    (N'amverma@contoso.com', N'Amrit',  N'Verma',         N'EMP-0005', N'Software Engineer', @HashAmverma, 0);

/*----------------------------------------------------------------------------------------------
  0. Roles

  The base schema (DSR_Schema_DDL.sql) creates dsr.Roles EMPTY -- the rows come from the sample
  data script, which a lean environment may never run. Testing this seed against a freshly built
  database showed both users created and able to sign in, but with "roles = (none)": an
  administrator who cannot open a single admin screen, and no error anywhere to explain why.

  So the three system roles are ensured here. Matching is on RoleCode, never on Id, so an
  environment whose ids differ is not disturbed and no IDENTITY_INSERT is required.
----------------------------------------------------------------------------------------------*/
DECLARE @SystemRoles TABLE (RoleCode NVARCHAR(30) PRIMARY KEY, RoleName NVARCHAR(100));
INSERT @SystemRoles (RoleCode, RoleName)
VALUES (N'EMPLOYEE', N'Employee'), (N'MANAGER', N'Manager'), (N'ADMIN', N'Admin');

/*  Roles.CreatedByUserId is NOT NULL and FKs to Users, which may itself be empty at this point.
    The constraint is briefly disabled for exactly this insert and then restored WITH CHECK, so
    it ends up trusted again. Step 1 repoints the value at a real user once one exists.          */
IF NOT EXISTS (SELECT 1 FROM dsr.Roles r JOIN @SystemRoles s ON s.RoleCode = r.RoleCode)
   AND NOT EXISTS (SELECT 1 FROM dsr.Users)
    ALTER TABLE dsr.Roles NOCHECK CONSTRAINT ALL;

INSERT dsr.Roles (RoleCode, RoleName, IsSystemRole, CreatedByUserId, CreatedDate, IsActive)
SELECT s.RoleCode, s.RoleName, 1, ISNULL((SELECT MIN(Id) FROM dsr.Users), 1), SYSUTCDATETIME(), 1
FROM   @SystemRoles s
WHERE  NOT EXISTS (SELECT 1 FROM dsr.Roles r WHERE r.RoleCode = s.RoleCode);

PRINT '  roles created      : ' + CAST(@@ROWCOUNT AS VARCHAR(10));

-- Reactivate a soft-deleted system role, else the grants below would attach to a dead row.
UPDATE r SET r.IsActive = 1
FROM dsr.Roles r JOIN @SystemRoles s ON s.RoleCode = r.RoleCode
WHERE r.IsActive = 0;

/*----------------------------------------------------------------------------------------------
  1. Users
----------------------------------------------------------------------------------------------*/
/*  Users.CreatedByUserId is a self-referencing FK, so the FIRST row in an empty table has
    nobody to point at. Where users already exist we borrow the lowest existing id; on a
    completely empty table the FK is briefly disabled, the row inserted, then repointed at
    itself and the FK re-enabled WITH CHECK so it is trusted again afterwards.                 */
DECLARE @Bootstrap INT = (SELECT MIN(Id) FROM dsr.Users);
DECLARE @EmptyUsers BIT = CASE WHEN @Bootstrap IS NULL THEN 1 ELSE 0 END;

IF @EmptyUsers = 1
    ALTER TABLE dsr.Users NOCHECK CONSTRAINT FK_Users_CreatedByUser;

INSERT dsr.Users (FirstName, LastName, Email, EmployeeCode, Designation,
                  AuthenticationType, StandardDailyHours, IsServiceAccount,
                  CreatedByUserId, CreatedDate, IsActive)
SELECT s.FirstName, s.LastName, s.Email, s.EmployeeCode, s.Designation,
       N'DATABASE', 8.00, 0,
       ISNULL(@Bootstrap, 1), SYSUTCDATETIME(), 1
FROM   @Seed s
WHERE  NOT EXISTS (SELECT 1 FROM dsr.Users u WHERE u.Email = s.Email);

PRINT '  users created      : ' + CAST(@@ROWCOUNT AS VARCHAR(10));

IF @EmptyUsers = 1
BEGIN
    -- Repoint the bootstrap row(s) at themselves, then restore the constraint as trusted.
    UPDATE dsr.Users SET CreatedByUserId = Id WHERE CreatedByUserId NOT IN (SELECT Id FROM dsr.Users);
    ALTER TABLE dsr.Users WITH CHECK CHECK CONSTRAINT FK_Users_CreatedByUser;

    -- Roles inserted in step 0 point at a placeholder id; repoint them at the seeded admin and
    -- re-enable the constraints so nothing is left untrusted.
    UPDATE dsr.Roles
    SET    CreatedByUserId = (SELECT MIN(Id) FROM dsr.Users)
    WHERE  CreatedByUserId NOT IN (SELECT Id FROM dsr.Users);

    ALTER TABLE dsr.Roles WITH CHECK CHECK CONSTRAINT ALL;
END

/*  Reactivate a soft-deleted account, otherwise the credential below would be set on a user who
    still cannot sign in. ModifiedByUserId and ModifiedDate move together -- CK_Users_ModifiedPair
    requires both or neither.                                                                    */
UPDATE u
SET    u.IsActive = 1,
       u.ModifiedByUserId = u.Id,
       u.ModifiedDate = SYSUTCDATETIME()
FROM   dsr.Users u
JOIN   @Seed s ON s.Email = u.Email
WHERE  u.IsActive = 0;

IF @@ROWCOUNT > 0 PRINT '  users reactivated  : ' + CAST(@@ROWCOUNT AS VARCHAR(10));

/*----------------------------------------------------------------------------------------------
  2. Credentials
----------------------------------------------------------------------------------------------*/
INSERT dsr.UserCredentials (UserId, PasswordHash, SecurityStamp, PasswordChangedDate,
                            MustChangePassword, FailedLoginAttempts,
                            CreatedByUserId, CreatedDate, IsActive)
SELECT u.Id, s.PasswordHash, NEWID(), SYSUTCDATETIME(), 0, 0, u.Id, SYSUTCDATETIME(), 1
FROM   @Seed s
JOIN   dsr.Users u ON u.Email = s.Email
WHERE  NOT EXISTS (SELECT 1 FROM dsr.UserCredentials c WHERE c.UserId = u.Id);

PRINT '  credentials created: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

IF @OverwriteExistingPassword = 1
BEGIN
    /*  Rotating SecurityStamp invalidates every issued refresh token for these accounts, which is
        what should happen when a password changes -- otherwise an old session keeps working
        against a password that no longer exists.                                                */
    UPDATE c
    SET    c.PasswordHash        = s.PasswordHash,
           c.SecurityStamp       = NEWID(),
           c.PasswordChangedDate = SYSUTCDATETIME(),
           c.MustChangePassword  = 0,
           c.FailedLoginAttempts = 0,
           c.LockoutEndDate      = NULL,
           c.IsActive            = 1,
           c.ModifiedByUserId    = u.Id,
           c.ModifiedDate        = SYSUTCDATETIME()
    FROM   dsr.UserCredentials c
    JOIN   dsr.Users u ON u.Id = c.UserId
    JOIN   @Seed s ON s.Email = u.Email
    WHERE  c.PasswordHash <> s.PasswordHash
       OR  c.MustChangePassword <> 0
       OR  c.FailedLoginAttempts <> 0
       OR  c.LockoutEndDate IS NOT NULL
       OR  c.IsActive = 0;

    PRINT '  credentials reset  : ' + CAST(@@ROWCOUNT AS VARCHAR(10));
END
ELSE
    PRINT '  credentials reset  : skipped (@OverwriteExistingPassword = 0)';

/*----------------------------------------------------------------------------------------------
  3. Roles
----------------------------------------------------------------------------------------------*/
/*  Every seeded account gets EMPLOYEE; admin@contoso.com also gets ADMIN. A previously
    soft-deleted grant is reactivated rather than re-inserted, which would breach the unique
    (UserId, RoleId) index.                                                                     */
DECLARE @Grant TABLE (UserId INT NOT NULL, RoleId INT NOT NULL PRIMARY KEY (UserId, RoleId));

INSERT @Grant (UserId, RoleId)
SELECT u.Id, r.Id
FROM   @Seed s
JOIN   dsr.Users u ON u.Email = s.Email
JOIN   dsr.Roles r ON r.RoleCode = N'EMPLOYEE'
UNION
SELECT u.Id, r.Id
FROM   @Seed s
JOIN   dsr.Users u ON u.Email = s.Email
JOIN   dsr.Roles r ON r.RoleCode = N'ADMIN'
WHERE  s.IsAdmin = 1;

INSERT dsr.UserRoles (UserId, RoleId, AssignedDate, CreatedByUserId, CreatedDate, IsActive)
SELECT g.UserId, g.RoleId, SYSUTCDATETIME(), g.UserId, SYSUTCDATETIME(), 1
FROM   @Grant g
WHERE  NOT EXISTS (SELECT 1 FROM dsr.UserRoles ur WHERE ur.UserId = g.UserId AND ur.RoleId = g.RoleId);

PRINT '  roles granted      : ' + CAST(@@ROWCOUNT AS VARCHAR(10));

UPDATE ur
SET    ur.IsActive = 1, ur.ModifiedByUserId = ur.UserId, ur.ModifiedDate = SYSUTCDATETIME()
FROM   dsr.UserRoles ur
JOIN   @Grant g ON g.UserId = ur.UserId AND g.RoleId = ur.RoleId
WHERE  ur.IsActive = 0;

IF @@ROWCOUNT > 0 PRINT '  roles reactivated  : ' + CAST(@@ROWCOUNT AS VARCHAR(10));
GO

/*----------------------------------------------------------------------------------------------
  4. Verification
----------------------------------------------------------------------------------------------*/
PRINT '';
PRINT '  Email                  Active  Auth      MustChange  Locked  Roles';
PRINT '  ---------------------- ------  --------  ----------  ------  --------------------';

SELECT '  ' + LEFT(u.Email + REPLICATE(' ', 22), 22)
     + ' ' + LEFT(CAST(u.IsActive AS CHAR(1)) + REPLICATE(' ', 6), 6)
     + '  ' + LEFT(u.AuthenticationType + REPLICATE(' ', 8), 8)
     + '  ' + LEFT(CAST(c.MustChangePassword AS CHAR(1)) + REPLICATE(' ', 10), 10)
     + '  ' + LEFT(CASE WHEN c.LockoutEndDate IS NULL THEN 'no' ELSE 'YES' END + REPLICATE(' ', 6), 6)
     + '  ' + ISNULL(STUFF((SELECT ',' + r.RoleCode
                            FROM dsr.UserRoles ur JOIN dsr.Roles r ON r.Id = ur.RoleId
                            WHERE ur.UserId = u.Id AND ur.IsActive = 1
                            ORDER BY r.RoleCode FOR XML PATH('')), 1, 1, ''), '(none)')
FROM   dsr.Users u
LEFT   JOIN dsr.UserCredentials c ON c.UserId = u.Id AND c.IsActive = 1
WHERE  u.Email IN (N'admin@contoso.com', N'amverma@contoso.com');
GO

/*  An SSO-only account cannot sign in with a password no matter what is seeded here, so say so
    rather than leaving the operator to discover it at the login screen.                        */
IF EXISTS (SELECT 1 FROM dsr.Users
           WHERE Email IN (N'admin@contoso.com', N'amverma@contoso.com')
             AND AuthenticationType = N'SSO')
BEGIN
    PRINT '';
    PRINT '  *** WARNING: an account above is AuthenticationType = SSO. Password sign-in will be';
    PRINT '      refused for it regardless of this seed. Set it to DATABASE or BOTH to use one.';
END
GO

PRINT '';
PRINT '  Password for both accounts: Dsr@Admin#2026';
PRINT '--- 10_Seed_Users complete ---';
GO
