using DSR.Domain.Common;

namespace DSR.Domain.Entities;

/// <summary>dsr.Users -- employees, managers, admins. The actor for every audited action.</summary>
public class User : AuditableEntity
{
    public int Id { get; set; }
    public string? EmployeeCode { get; set; }
    public string FirstName { get; set; } = null!;
    public string LastName { get; set; } = null!;

    /// <summary>Persisted computed column in SQL Server. Never assigned by the application.</summary>
    public string FullName { get; private set; } = null!;

    public string Email { get; set; } = null!;
    public string AuthenticationType { get; set; } = AuthenticationTypes.Database;

    /// <summary>Entra ID oid claim. The only safe SSO join key -- never match on email (risk S1).</summary>
    public string? ExternalObjectId { get; set; }
    public string? ExternalTenantId { get; set; }

    public int? ManagerUserId { get; set; }
    public string? Designation { get; set; }
    public int? DepartmentId { get; set; }
    public bool IsServiceAccount { get; set; }
    public decimal StandardDailyHours { get; set; } = 8.00m;
    public DateOnly? DateOfJoining { get; set; }
    public DateOnly? DateOfExit { get; set; }
    public DateTime? LastLoginDate { get; set; }

    public Department? Department { get; set; }
    public User? Manager { get; set; }
    public ICollection<User> DirectReports { get; set; } = [];
    public UserCredential? Credential { get; set; }
    public ICollection<UserRole> UserRoles { get; set; } = [];
    public ICollection<DsrEntry> DsrEntries { get; set; } = [];
    public ICollection<DailyAiUsage> DailyAiUsages { get; set; } = [];
    public ICollection<ProjectAllocation> ProjectAllocations { get; set; } = [];
    public ICollection<RefreshToken> RefreshTokens { get; set; } = [];
}

/// <summary>dsr.Roles -- EMPLOYEE / MANAGER / ADMIN.</summary>
public class Role : AuditableEntity
{
    public int Id { get; set; }
    public string RoleCode { get; set; } = null!;
    public string RoleName { get; set; } = null!;
    public string? Description { get; set; }
    public bool IsSystemRole { get; set; }

    public ICollection<UserRole> UserRoles { get; set; } = [];
    public ICollection<SsoRoleMapping> SsoRoleMappings { get; set; } = [];
}

/// <summary>dsr.UserRoles -- M:N junction. A manager who files their own DSRs holds both roles.</summary>
public class UserRole : AuditableEntity
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public int RoleId { get; set; }
    public DateTime AssignedDate { get; set; }

    public User User { get; set; } = null!;
    public Role Role { get; set; } = null!;
}

/// <summary>
/// dsr.UserCredentials -- database-login secret, 1:1 optional with User.
/// Absent for SSO-only accounts; that absence is meaningful, not missing data.
/// </summary>
public class UserCredential : AuditableEntity
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string PasswordHash { get; set; } = null!;
    public Guid SecurityStamp { get; set; }
    public DateTime? PasswordChangedDate { get; set; }
    public bool MustChangePassword { get; set; }
    public int FailedLoginAttempts { get; set; }
    public DateTime? LockoutEndDate { get; set; }

    public User User { get; set; } = null!;

    public bool IsLockedOut(DateTime utcNow) => LockoutEndDate.HasValue && LockoutEndDate.Value > utcNow;
}

/// <summary>dsr.UserLoginAudit -- append-only. UserId is null for attempts on unknown emails.</summary>
public class UserLoginAudit : AuditableEntity
{
    public long Id { get; set; }
    public int? UserId { get; set; }
    public string AttemptedEmail { get; set; } = null!;
    public string AuthenticationType { get; set; } = null!;
    public bool IsSuccessful { get; set; }
    public string? FailureReason { get; set; }
    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }
    public DateTime AttemptDate { get; set; }

    public User? User { get; set; }
}

/// <summary>
/// dsr.RefreshTokens -- rotation with reuse detection. Only the SHA-256 hash is stored, so a
/// database leak yields no usable credential.
/// </summary>
public class RefreshToken : AuditableEntity
{
    public long Id { get; set; }
    public int UserId { get; set; }
    public byte[] TokenHash { get; set; } = null!;
    public string? JwtId { get; set; }
    public DateTime ExpiresOn { get; set; }
    public string? CreatedByIp { get; set; }
    public DateTime? RevokedOn { get; set; }
    public string? RevokedByIp { get; set; }
    public string? RevokedReason { get; set; }
    public long? ReplacedByTokenId { get; set; }

    public User User { get; set; } = null!;
    public RefreshToken? ReplacedByToken { get; set; }

    public bool IsExpired(DateTime utcNow) => ExpiresOn <= utcNow;
    public bool IsRevoked => RevokedOn.HasValue;
    public bool IsUsable(DateTime utcNow) => !IsRevoked && !IsExpired(utcNow);
}

/// <summary>dsr.SsoRoleMappings -- Entra group objectId to application role. Highest Priority wins.</summary>
public class SsoRoleMapping : AuditableEntity
{
    public int Id { get; set; }
    public string ExternalGroupId { get; set; } = null!;
    public string? ExternalGroupName { get; set; }
    public int RoleId { get; set; }
    public short Priority { get; set; } = 100;

    public Role Role { get; set; } = null!;
}
