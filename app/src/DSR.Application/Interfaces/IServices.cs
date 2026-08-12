using DSR.Application.Common;
using DSR.Application.DTOs;

namespace DSR.Application.Interfaces;

/// <summary>Authentication for both paths, plus token lifecycle. Implemented in Infrastructure.</summary>
public interface IAuthService
{
    Task<AuthResultDto> LoginWithDatabaseAsync(DatabaseLoginRequest request, CancellationToken ct = default);
    Task<AuthResultDto> LoginWithSsoAsync(SsoLoginRequest request, CancellationToken ct = default);
    Task<AuthResultDto> RefreshAsync(RefreshTokenRequest request, CancellationToken ct = default);
    Task RevokeAsync(string refreshToken, string reason, CancellationToken ct = default);

    /// <summary>Revokes every live refresh token for a user (logout everywhere, deactivation, reset).</summary>
    Task RevokeAllForUserAsync(int userId, string reason, CancellationToken ct = default);

    Task ChangePasswordAsync(ChangePasswordRequest request, CancellationToken ct = default);
    Task<ResetPasswordResultDto> ResetPasswordAsync(ResetPasswordRequest request, CancellationToken ct = default);
    Task<AuthenticatedUserDto> GetCurrentUserAsync(CancellationToken ct = default);
}

/// <summary>Password hashing. Abstracted so the algorithm can be replaced without touching services.</summary>
public interface IPasswordHasher
{
    string Hash(string password);

    /// <summary>Constant-time verification. Returns rehashNeeded when the stored format is outdated.</summary>
    (bool Verified, bool RehashNeeded) Verify(string hash, string password);

    /// <summary>Cryptographically random password for admin resets and auto-provisioning.</summary>
    string GenerateTemporaryPassword(int length = 16);
}

/// <summary>Issues application JWTs. Claims are minted from the database, never from client input.</summary>
public interface IJwtTokenService
{
    (string Token, DateTime ExpiresOn, string JwtId) CreateAccessToken(int userId, string email, string fullName, IEnumerable<string> roleCodes);

    /// <summary>Returns the opaque token for the client and the SHA-256 hash to persist.</summary>
    (string Token, byte[] Hash, DateTime ExpiresOn) CreateRefreshToken();

    byte[] HashRefreshToken(string token);
}

/// <summary>Validates an Entra ID token against the tenant's signing keys and extracts its claims.</summary>
public interface IEntraIdTokenValidator
{
    Task<EntraIdPrincipal> ValidateAsync(string idToken, CancellationToken ct = default);
}

/// <summary>The subset of Entra claims this application trusts after signature validation.</summary>
public class EntraIdPrincipal
{
    /// <summary>The oid claim -- the immutable object id. The ONLY safe join key to Users.</summary>
    public string ObjectId { get; set; } = null!;
    public string TenantId { get; set; } = null!;
    public string Email { get; set; } = null!;
    public string? GivenName { get; set; }
    public string? Surname { get; set; }
    public string? DisplayName { get; set; }

    /// <summary>Group object ids from the groups claim, matched against dsr.SsoRoleMappings.</summary>
    public List<string> GroupIds { get; set; } = [];
}

/// <summary>
/// The DSR core. Every method enforces data scope internally from ICurrentUser: an Employee may
/// only touch their own entries, a Manager their direct reports', an Admin anything.
/// </summary>
public interface IDsrEntryService
{
    /// <summary>Saves one entry for one project, and upserts the day's single AI declaration.</summary>
    Task<DsrEntryDto> CreateAsync(CreateDsrEntryRequest request, CancellationToken ct = default);

    Task<DsrEntryDto> UpdateAsync(int id, UpdateDsrEntryRequest request, CancellationToken ct = default);

    /// <summary>Soft delete. Frees the (user, date, project) slot for reuse.</summary>
    Task DeleteAsync(int id, CancellationToken ct = default);

    Task<DsrEntryDto> GetByIdAsync(int id, CancellationToken ct = default);

    /// <summary>All entries for one employee-date plus totals -- what the DSR screen loads.</summary>
    Task<DsrDayDto> GetDayAsync(DateOnly workDate, int? userId = null, CancellationToken ct = default);

    Task<PagedResult<DsrEntryDto>> SearchAsync(DsrEntryFilter filter, CancellationToken ct = default);

    /// <summary>
    /// Dropdowns, limits and date bounds for the entry form, in one call.
    /// The project list is DATE-DEPENDENT: a project only accepts effort inside its own start/end
    /// window, so the caller must pass the work date currently selected on the form. Omitting it
    /// defaults to today. The client re-fetches whenever the user changes the work date.
    /// </summary>
    Task<DsrFormMetadataDto> GetFormMetadataAsync(DateOnly? workDate = null, CancellationToken ct = default);
}

public interface IUserService
{
    Task<PagedResult<UserDto>> SearchAsync(UserFilter filter, CancellationToken ct = default);
    Task<UserDto> GetByIdAsync(int id, CancellationToken ct = default);
    Task<UserDto> CreateAsync(CreateUserRequest request, CancellationToken ct = default);
    Task<UserDto> UpdateAsync(int id, UpdateUserRequest request, CancellationToken ct = default);

    /// <summary>Activate/deactivate. Deactivating also revokes every live refresh token.</summary>
    Task<UserDto> SetActiveAsync(int id, bool isActive, CancellationToken ct = default);

    /// <summary>Direct reports of the caller (Manager) or of any user (Admin).</summary>
    Task<IReadOnlyList<LookupDto>> GetTeamMembersAsync(int? managerUserId = null, CancellationToken ct = default);

    Task<IReadOnlyList<LookupDto>> GetManagerLookupAsync(CancellationToken ct = default);
}

public interface IProjectService
{
    Task<PagedResult<ProjectDto>> SearchAsync(ProjectFilter filter, CancellationToken ct = default);
    Task<ProjectDto> GetByIdAsync(int id, CancellationToken ct = default);
    Task<ProjectDto> CreateAsync(CreateProjectRequest request, CancellationToken ct = default);
    Task<ProjectDto> UpdateAsync(int id, UpdateProjectRequest request, CancellationToken ct = default);
    Task<ProjectDto> SetActiveAsync(int id, bool isActive, CancellationToken ct = default);

    Task<IReadOnlyList<ProjectAllocationDto>> GetAllocationsAsync(int? projectId, int? userId, CancellationToken ct = default);
    Task<ProjectAllocationDto> SaveAllocationAsync(SaveProjectAllocationRequest request, CancellationToken ct = default);
    Task RemoveAllocationAsync(int allocationId, CancellationToken ct = default);
}

public interface IMasterDataService
{
    Task<IReadOnlyList<RoleDto>> GetRolesAsync(CancellationToken ct = default);
    Task<IReadOnlyList<AiToolDto>> GetAiToolsAsync(bool activeOnly = true, CancellationToken ct = default);
    Task<AiToolDto> SaveAiToolAsync(int? id, string toolName, string? vendor, string? category, CancellationToken ct = default);
    Task<IReadOnlyList<HolidayDto>> GetHolidaysAsync(int? year, CancellationToken ct = default);
    Task<HolidayDto> SaveHolidayAsync(int? id, DateOnly date, string name, bool isOptional, CancellationToken ct = default);
    Task DeleteHolidayAsync(int id, CancellationToken ct = default);

    /// <summary>Departments, for the department filter and department-wise reporting.</summary>
    Task<IReadOnlyList<DepartmentDto>> GetDepartmentsAsync(CancellationToken ct = default);

    /// <summary>Work categories, for the "Work Category (if applicable)" filter.</summary>
    Task<IReadOnlyList<WorkCategoryDto>> GetWorkCategoriesAsync(CancellationToken ct = default);
}

/// <summary>All six BRD reports plus the three role dashboards.</summary>
public interface IReportingService
{
    Task<PagedResult<EmployeeReportRowDto>> GetEmployeeReportAsync(ReportFilter filter, CancellationToken ct = default);
    Task<PagedResult<ProjectReportRowDto>> GetProjectReportAsync(ReportFilter filter, CancellationToken ct = default);
    Task<PagedResult<ResourceUtilizationRowDto>> GetResourceUtilizationAsync(ReportFilter filter, CancellationToken ct = default);
    Task<AiUsageReportDto> GetAiUsageReportAsync(ReportFilter filter, CancellationToken ct = default);
    Task<PagedResult<DailySummaryRowDto>> GetDailySummaryAsync(ReportFilter filter, CancellationToken ct = default);
    Task<PagedResult<MonthlySummaryRowDto>> GetMonthlySummaryAsync(ReportFilter filter, CancellationToken ct = default);
    Task<IReadOnlyList<MissingDsrRowDto>> GetMissingDsrAsync(ReportFilter filter, CancellationToken ct = default);

    Task<EmployeeDashboardDto> GetEmployeeDashboardAsync(CancellationToken ct = default);
    Task<ManagerDashboardDto> GetManagerDashboardAsync(ReportFilter filter, CancellationToken ct = default);
    Task<AdminDashboardDto> GetAdminDashboardAsync(CancellationToken ct = default);

    /// <summary>CSV export of any report. Streamed so a large export does not buffer in memory.</summary>
    Task<(string FileName, string ContentType, byte[] Content)> ExportAsync(string reportKey, ReportFilter filter, CancellationToken ct = default);
}

/// <summary>
/// Admin reporting module: full DSR detail with advanced filters, grouped roll-ups, missing DSR
/// and Excel/CSV export.
///
/// Approval workflow disabled as per current business requirement.
/// All DSR entries are treated as automatically approved.
/// </summary>
public interface IDetailReportService
{
    Task<DsrDetailReportDto> GetDetailReportAsync(DsrDetailReportFilter filter, CancellationToken ct = default);

    /// <summary>groupBy: employee | project | department | manager | category.</summary>
    Task<IReadOnlyList<GroupedReportRowDto>> GetGroupedReportAsync(string groupBy, DsrDetailReportFilter filter, CancellationToken ct = default);

    Task<IReadOnlyList<MissingDsrDetailRowDto>> GetMissingDsrDetailAsync(DsrDetailReportFilter filter, CancellationToken ct = default);

    // Approval workflow disabled as per current business requirement.
    // All DSR entries are treated as automatically approved.
    /*
    Task<IReadOnlyList<ApprovalStatusReportRowDto>> GetApprovalStatusReportAsync(DsrDetailReportFilter filter, CancellationToken ct = default);

    /// <summary>Approve or return entries. Returns the number affected.</summary>
    Task<int> ReviewAsync(ReviewDsrEntriesRequest request, CancellationToken ct = default);
    */

    /// <summary>format: xlsx | csv.</summary>
    Task<(string FileName, string ContentType, byte[] Content)> ExportDetailAsync(string format, DsrDetailReportFilter filter, CancellationToken ct = default);
}
