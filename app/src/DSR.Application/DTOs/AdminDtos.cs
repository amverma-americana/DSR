using DSR.Application.Common;

namespace DSR.Application.DTOs;

/* ---------------------------------- USERS ---------------------------------- */

public class UserDto
{
    public int Id { get; set; }
    public string? EmployeeCode { get; set; }
    public string FirstName { get; set; } = null!;
    public string LastName { get; set; } = null!;
    public string FullName { get; set; } = null!;
    public string Email { get; set; } = null!;
    public string AuthenticationType { get; set; } = null!;
    public string? ExternalObjectId { get; set; }
    public int? ManagerUserId { get; set; }
    public string? ManagerName { get; set; }
    public string? Designation { get; set; }
    public decimal StandardDailyHours { get; set; }
    public DateOnly? DateOfJoining { get; set; }
    public DateOnly? DateOfExit { get; set; }
    public DateTime? LastLoginDate { get; set; }
    public bool IsActive { get; set; }
    public bool HasDatabaseCredential { get; set; }
    public List<string> Roles { get; set; } = [];
}

public class CreateUserRequest
{
    public string? EmployeeCode { get; set; }
    public string FirstName { get; set; } = null!;
    public string LastName { get; set; } = null!;
    public string Email { get; set; } = null!;

    /// <summary>SSO / DATABASE / BOTH. Anything other than SSO requires an initial password.</summary>
    public string AuthenticationType { get; set; } = "DATABASE";

    /// <summary>Required when AuthenticationType is SSO or BOTH (mirrors CK_Users_SsoRequiresExternalId).</summary>
    public string? ExternalObjectId { get; set; }
    public string? ExternalTenantId { get; set; }

    /// <summary>Optional for DATABASE/BOTH; generated when omitted and flagged must-change.</summary>
    public string? InitialPassword { get; set; }

    public int? ManagerUserId { get; set; }
    public string? Designation { get; set; }
    public decimal StandardDailyHours { get; set; } = 8.00m;
    public DateOnly? DateOfJoining { get; set; }

    /// <summary>Role codes to grant. Defaults to EMPLOYEE when empty.</summary>
    public List<string> RoleCodes { get; set; } = [];
}

public class UpdateUserRequest
{
    public string? EmployeeCode { get; set; }
    public string FirstName { get; set; } = null!;
    public string LastName { get; set; } = null!;
    public string Email { get; set; } = null!;
    public string AuthenticationType { get; set; } = null!;
    public string? ExternalObjectId { get; set; }
    public string? ExternalTenantId { get; set; }
    public int? ManagerUserId { get; set; }
    public string? Designation { get; set; }
    public decimal StandardDailyHours { get; set; }
    public DateOnly? DateOfJoining { get; set; }
    public DateOnly? DateOfExit { get; set; }
    public List<string> RoleCodes { get; set; } = [];
}

public class UserFilter : PagedRequest
{
    public string? Search { get; set; }
    public string? RoleCode { get; set; }
    public int? ManagerUserId { get; set; }
    public bool? IsActive { get; set; }
    public string? AuthenticationType { get; set; }
}

/* --------------------------------- PROJECTS -------------------------------- */

public class ProjectDto
{
    public int Id { get; set; }
    public string ProjectCode { get; set; } = null!;
    public string ProjectName { get; set; } = null!;
    public string? Description { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public string Status { get; set; } = null!;
    public int? ProjectManagerUserId { get; set; }
    public string? ProjectManagerName { get; set; }
    public bool IsActive { get; set; }
    public int AllocatedResourceCount { get; set; }

    /// <summary>False when status or window blocks effort logging -- the DSR dropdown greys it out.</summary>
    public bool IsOpenForEffort { get; set; }
}

public class CreateProjectRequest
{
    public string ProjectCode { get; set; } = null!;
    public string ProjectName { get; set; } = null!;
    public string? Description { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public string Status { get; set; } = "PLANNED";
    public int? ProjectManagerUserId { get; set; }
}

public class UpdateProjectRequest : CreateProjectRequest;

public class ProjectFilter : PagedRequest
{
    public string? Search { get; set; }
    public string? Status { get; set; }
    public int? ProjectManagerUserId { get; set; }
    public bool? IsActive { get; set; }

    /// <summary>True returns only projects the caller may log effort against on <see cref="EffortDate"/>.</summary>
    public bool OpenForEffortOnly { get; set; }
    public DateOnly? EffortDate { get; set; }
}

/* ------------------------------ ALLOCATIONS ------------------------------- */

public class ProjectAllocationDto
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public string ProjectCode { get; set; } = null!;
    public string ProjectName { get; set; } = null!;
    public int UserId { get; set; }
    public string EmployeeName { get; set; } = null!;
    public decimal AllocationPercentage { get; set; }
    public DateOnly AllocationStartDate { get; set; }
    public DateOnly? AllocationEndDate { get; set; }
    public string? ProjectRole { get; set; }
    public bool IsActive { get; set; }
}

public class SaveProjectAllocationRequest
{
    public int ProjectId { get; set; }
    public int UserId { get; set; }
    public decimal AllocationPercentage { get; set; } = 100m;
    public DateOnly AllocationStartDate { get; set; }
    public DateOnly? AllocationEndDate { get; set; }
    public string? ProjectRole { get; set; }
}

/* ------------------------------ MASTER DATA ------------------------------- */

public record RoleDto(int Id, string RoleCode, string RoleName, string? Description, bool IsSystemRole, bool IsActive, int UserCount);

public record AiToolDto(int Id, string ToolName, string? Vendor, string? Category, bool IsActive);

public record HolidayDto(int Id, DateOnly HolidayDate, string HolidayName, bool IsOptional, bool IsActive);

public record LookupDto(int Id, string Name, string? Code = null);

/// <summary>Everything the DSR entry screen needs in one round trip.</summary>
public class DsrFormMetadataDto
{
    public List<ProjectDto> Projects { get; set; } = [];
    public List<AiToolDto> AiTools { get; set; } = [];
    public decimal MaxDailyHours { get; set; }
    public int BackDateWindowDays { get; set; }
    public bool RequireDescription { get; set; }
    public DateOnly MinWorkDate { get; set; }
    public DateOnly MaxWorkDate { get; set; }
}
