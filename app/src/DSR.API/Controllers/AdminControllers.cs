using DSR.Application.Common;
using DSR.Application.DTOs;
using DSR.Application.Interfaces;
using DSR.Domain.Common;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DSR.API.Controllers;

/// <summary>
/// User administration. Read endpoints are open to Managers (scoped to their own team by the
/// service); all write endpoints require Admin.
/// </summary>
[Authorize]
[Route("api/users")]
public class UsersController(IUserService users) : ApiControllerBase
{
    [Authorize(Roles = RoleCodes.AdminOrManager)]
    [HttpGet]
    public async Task<ActionResult<ApiResponse<PagedResult<UserDto>>>> Search([FromQuery] UserFilter filter, CancellationToken ct) =>
        Success(await users.SearchAsync(filter, ct));

    [HttpGet("{id:int}")]
    public async Task<ActionResult<ApiResponse<UserDto>>> GetById(int id, CancellationToken ct) =>
        Success(await users.GetByIdAsync(id, ct));

    /// <summary>Direct reports. Managers get their own team; Admins may pass any managerUserId.</summary>
    [HttpGet("team")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<LookupDto>>>> Team([FromQuery] int? managerUserId, CancellationToken ct) =>
        Success(await users.GetTeamMembersAsync(managerUserId, ct));

    /// <summary>Users holding MANAGER or ADMIN, for the "reports to" picker.</summary>
    [Authorize(Roles = RoleCodes.AdminOrManager)]
    [HttpGet("managers")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<LookupDto>>>> Managers(CancellationToken ct) =>
        Success(await users.GetManagerLookupAsync(ct));

    [Authorize(Roles = RoleCodes.Admin)]
    [HttpPost]
    public async Task<ActionResult<ApiResponse<UserDto>>> Create([FromBody] CreateUserRequest request, CancellationToken ct) =>
        Created(await users.CreateAsync(request, ct), "User created.");

    [Authorize(Roles = RoleCodes.Admin)]
    [HttpPut("{id:int}")]
    public async Task<ActionResult<ApiResponse<UserDto>>> Update(int id, [FromBody] UpdateUserRequest request, CancellationToken ct) =>
        Success(await users.UpdateAsync(id, request, ct), "User updated.");

    /// <summary>Activate or deactivate. Deactivating revokes every live refresh token immediately.</summary>
    [Authorize(Roles = RoleCodes.Admin)]
    [HttpPatch("{id:int}/active")]
    public async Task<ActionResult<ApiResponse<UserDto>>> SetActive(int id, [FromQuery] bool isActive, CancellationToken ct) =>
        Success(await users.SetActiveAsync(id, isActive, ct), isActive ? "User activated." : "User deactivated.");
}

/// <summary>Project and resource-allocation administration.</summary>
[Authorize]
[Route("api/projects")]
public class ProjectsController(IProjectService projects) : ApiControllerBase
{
    /// <summary>
    /// Open to all roles: the DSR entry screen needs the project list. Pass openForEffortOnly=true
    /// to return only projects that accept effort on the given date.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<ApiResponse<PagedResult<ProjectDto>>>> Search([FromQuery] ProjectFilter filter, CancellationToken ct) =>
        Success(await projects.SearchAsync(filter, ct));

    [HttpGet("{id:int}")]
    public async Task<ActionResult<ApiResponse<ProjectDto>>> GetById(int id, CancellationToken ct) =>
        Success(await projects.GetByIdAsync(id, ct));

    [Authorize(Roles = RoleCodes.Admin)]
    [HttpPost]
    public async Task<ActionResult<ApiResponse<ProjectDto>>> Create([FromBody] CreateProjectRequest request, CancellationToken ct) =>
        Created(await projects.CreateAsync(request, ct), "Project created.");

    [Authorize(Roles = RoleCodes.Admin)]
    [HttpPut("{id:int}")]
    public async Task<ActionResult<ApiResponse<ProjectDto>>> Update(int id, [FromBody] UpdateProjectRequest request, CancellationToken ct) =>
        Success(await projects.UpdateAsync(id, request, ct), "Project updated.");

    [Authorize(Roles = RoleCodes.Admin)]
    [HttpPatch("{id:int}/active")]
    public async Task<ActionResult<ApiResponse<ProjectDto>>> SetActive(int id, [FromQuery] bool isActive, CancellationToken ct) =>
        Success(await projects.SetActiveAsync(id, isActive, ct), isActive ? "Project activated." : "Project deactivated.");

    [HttpGet("allocations")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ProjectAllocationDto>>>> Allocations(
        [FromQuery] int? projectId, [FromQuery] int? userId, CancellationToken ct) =>
        Success(await projects.GetAllocationsAsync(projectId, userId, ct));

    /// <summary>
    /// Create a resource allocation. Rejected when it overlaps an existing allocation for the same
    /// employee and project, or when the employee's total allocation would exceed 100 percent.
    /// </summary>
    [Authorize(Roles = RoleCodes.AdminOrManager)]
    [HttpPost("allocations")]
    public async Task<ActionResult<ApiResponse<ProjectAllocationDto>>> SaveAllocation(
        [FromBody] SaveProjectAllocationRequest request, CancellationToken ct) =>
        Created(await projects.SaveAllocationAsync(request, ct), "Allocation saved.");

    [Authorize(Roles = RoleCodes.AdminOrManager)]
    [HttpDelete("allocations/{allocationId:int}")]
    public async Task<ActionResult<ApiResponse<string>>> RemoveAllocation(int allocationId, CancellationToken ct)
    {
        await projects.RemoveAllocationAsync(allocationId, ct);
        return Success("Removed.", "Allocation removed.");
    }
}

/// <summary>Roles, AI tools, holiday calendar and runtime application settings.</summary>
[Authorize]
[Route("api/masters")]
public class MastersController(IMasterDataService masters, IAppSettingService settings) : ApiControllerBase
{
    [HttpGet("roles")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<RoleDto>>>> Roles(CancellationToken ct) =>
        Success(await masters.GetRolesAsync(ct));

    /// <summary>AI tool list for the DSR screen dropdown.</summary>
    [HttpGet("ai-tools")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<AiToolDto>>>> AiTools([FromQuery] bool activeOnly = true, CancellationToken ct = default) =>
        Success(await masters.GetAiToolsAsync(activeOnly, ct));

    [Authorize(Roles = RoleCodes.Admin)]
    [HttpPost("ai-tools")]
    public async Task<ActionResult<ApiResponse<AiToolDto>>> SaveAiTool(
        [FromQuery] int? id, [FromQuery] string toolName, [FromQuery] string? vendor,
        [FromQuery] string? category, CancellationToken ct) =>
        Success(await masters.SaveAiToolAsync(id, toolName, vendor, category, ct), "AI tool saved.");

    /// <summary>Holiday calendar. Drives working-day calculation for utilization and missing DSRs.</summary>
    [HttpGet("holidays")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<HolidayDto>>>> Holidays([FromQuery] int? year, CancellationToken ct) =>
        Success(await masters.GetHolidaysAsync(year, ct));

    [Authorize(Roles = RoleCodes.Admin)]
    [HttpPost("holidays")]
    public async Task<ActionResult<ApiResponse<HolidayDto>>> SaveHoliday(
        [FromQuery] int? id, [FromQuery] DateOnly date, [FromQuery] string name,
        [FromQuery] bool isOptional, CancellationToken ct) =>
        Success(await masters.SaveHolidayAsync(id, date, name, isOptional, ct), "Holiday saved.");

    [Authorize(Roles = RoleCodes.Admin)]
    [HttpDelete("holidays/{id:int}")]
    public async Task<ActionResult<ApiResponse<string>>> DeleteHoliday(int id, CancellationToken ct)
    {
        await masters.DeleteHolidayAsync(id, ct);
        return Success("Removed.", "Holiday removed.");
    }

    /// <summary>Departments, for the department filter and department-wise reporting.</summary>
    [HttpGet("departments")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<DepartmentDto>>>> Departments(CancellationToken ct) =>
        Success(await masters.GetDepartmentsAsync(ct));

    /// <summary>Work categories, for the "Work Category (if applicable)" filter.</summary>
    [HttpGet("work-categories")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<WorkCategoryDto>>>> WorkCategories(CancellationToken ct) =>
        Success(await masters.GetWorkCategoriesAsync(ct));

    /// <summary>Runtime settings (daily hour cap, back-date window, lockout policy, SSO behaviour).</summary>
    [Authorize(Roles = RoleCodes.Admin)]
    [HttpGet("settings")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<AppSettingDto>>>> Settings(CancellationToken ct) =>
        Success(await settings.GetAllAsync(ct));

    [Authorize(Roles = RoleCodes.Admin)]
    [HttpPut("settings/{key}")]
    public async Task<ActionResult<ApiResponse<string>>> UpdateSetting(string key, [FromBody] string value, CancellationToken ct)
    {
        await settings.UpdateAsync(key, value, ct);
        return Success(value, $"Setting '{key}' updated.");
    }
}
