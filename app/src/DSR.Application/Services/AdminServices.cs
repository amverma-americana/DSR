using DSR.Application.Common;
using DSR.Application.DTOs;
using DSR.Application.Interfaces;
using DSR.Domain.Common;
using DSR.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace DSR.Application.Services;

/// <summary>User administration. Deactivation also revokes live refresh tokens (risk S4).</summary>
public class UserService(
    IUnitOfWork uow,
    ICurrentUser currentUser,
    IPasswordHasher hasher,
    IAuthService auth,
    IAuditService audit,
    ILogger<UserService> logger) : IUserService
{
    public async Task<PagedResult<UserDto>> SearchAsync(UserFilter filter, CancellationToken ct = default)
    {
        var query = uow.Users.Query().Where(u => !u.IsServiceAccount);

        // Managers see only their own team; Admin sees everyone.
        if (!currentUser.IsAdmin)
        {
            var me = currentUser.RequireUserId();
            query = query.Where(u => u.ManagerUserId == me || u.Id == me);
        }
        else if (filter.ManagerUserId.HasValue)
        {
            query = query.Where(u => u.ManagerUserId == filter.ManagerUserId);
        }

        if (filter.IsActive.HasValue) query = query.Where(u => u.IsActive == filter.IsActive);
        if (!string.IsNullOrWhiteSpace(filter.AuthenticationType)) query = query.Where(u => u.AuthenticationType == filter.AuthenticationType);
        if (!string.IsNullOrWhiteSpace(filter.RoleCode)) query = query.Where(u => u.UserRoles.Any(r => r.Role.RoleCode == filter.RoleCode && r.IsActive));

        if (!string.IsNullOrWhiteSpace(filter.Search))
        {
            var t = filter.Search.Trim();
            query = query.Where(u => u.FullName.Contains(t) || u.Email.Contains(t)
                                     || (u.EmployeeCode != null && u.EmployeeCode.Contains(t)));
        }

        var total = await query.CountAsync(ct);

        query = (filter.SortBy?.ToLowerInvariant()) switch
        {
            "email" => filter.SortDescending ? query.OrderByDescending(u => u.Email) : query.OrderBy(u => u.Email),
            "code" => filter.SortDescending ? query.OrderByDescending(u => u.EmployeeCode) : query.OrderBy(u => u.EmployeeCode),
            _ => filter.SortDescending ? query.OrderByDescending(u => u.FullName) : query.OrderBy(u => u.FullName)
        };

        var items = await query.Skip((filter.Page - 1) * filter.PageSize).Take(filter.PageSize)
            .Select(Projection).ToListAsync(ct);

        return PagedResult<UserDto>.Create(items, total, filter.Page, filter.PageSize);
    }

    public async Task<UserDto> GetByIdAsync(int id, CancellationToken ct = default)
    {
        var dto = await uow.Users.Query().Where(u => u.Id == id).Select(Projection).FirstOrDefaultAsync(ct)
                  ?? throw new NotFoundException(nameof(User), id);

        if (!currentUser.IsAdmin && dto.Id != currentUser.UserId && dto.ManagerUserId != currentUser.UserId)
            throw new ForbiddenException();

        return dto;
    }

    public async Task<UserDto> CreateAsync(CreateUserRequest request, CancellationToken ct = default)
    {
        var email = request.Email.Trim().ToLowerInvariant();

        if (await uow.Users.AnyAsync(u => u.Email == email && u.IsActive, ct))
            throw new ConflictException($"A user with email '{email}' already exists.");

        if (AuthenticationTypes.AllowsSso(request.AuthenticationType) && string.IsNullOrWhiteSpace(request.ExternalObjectId))
            throw new ValidationAppException(nameof(request.ExternalObjectId),
                "An Entra ID object id is required for SSO-enabled accounts.");

        if (request.ManagerUserId.HasValue &&
            !await uow.Users.AnyAsync(u => u.Id == request.ManagerUserId && u.IsActive, ct))
            throw new ValidationAppException(nameof(request.ManagerUserId), "The selected manager does not exist.");

        var user = new User
        {
            EmployeeCode = string.IsNullOrWhiteSpace(request.EmployeeCode) ? null : request.EmployeeCode.Trim(),
            FirstName = request.FirstName.Trim(),
            LastName = request.LastName.Trim(),
            Email = email,
            AuthenticationType = request.AuthenticationType,
            ExternalObjectId = string.IsNullOrWhiteSpace(request.ExternalObjectId) ? null : request.ExternalObjectId.Trim(),
            ExternalTenantId = request.ExternalTenantId,
            ManagerUserId = request.ManagerUserId,
            Designation = request.Designation,
            StandardDailyHours = request.StandardDailyHours,
            DateOfJoining = request.DateOfJoining
        };

        await uow.Users.AddAsync(user, ct);
        await uow.SaveChangesAsync(ct);

        if (AuthenticationTypes.AllowsDatabaseLogin(request.AuthenticationType))
        {
            var password = string.IsNullOrWhiteSpace(request.InitialPassword)
                ? hasher.GenerateTemporaryPassword()
                : request.InitialPassword;

            await uow.UserCredentials.AddAsync(new UserCredential
            {
                UserId = user.Id,
                PasswordHash = hasher.Hash(password),
                SecurityStamp = Guid.NewGuid(),
                MustChangePassword = true
            }, ct);
        }

        var roleCodes = request.RoleCodes.Count > 0 ? request.RoleCodes : [RoleCodes.Employee];
        await AssignRolesAsync(user.Id, roleCodes, ct);
        await uow.SaveChangesAsync(ct);

        await audit.LogAsync(nameof(User), user.Id, AuditActions.Insert, null,
            new { user.Email, user.AuthenticationType, Roles = roleCodes }, ct);

        logger.LogInformation("User {UserId} ({Email}) created by {ActorId}", user.Id, user.Email, currentUser.UserId);
        return await GetByIdAsync(user.Id, ct);
    }

    public async Task<UserDto> UpdateAsync(int id, UpdateUserRequest request, CancellationToken ct = default)
    {
        var user = await uow.Users.QueryForUpdate().FirstOrDefaultAsync(u => u.Id == id, ct)
                   ?? throw new NotFoundException(nameof(User), id);

        var email = request.Email.Trim().ToLowerInvariant();
        if (await uow.Users.AnyAsync(u => u.Email == email && u.Id != id && u.IsActive, ct))
            throw new ConflictException($"A user with email '{email}' already exists.");

        if (AuthenticationTypes.AllowsSso(request.AuthenticationType) && string.IsNullOrWhiteSpace(request.ExternalObjectId))
            throw new ValidationAppException(nameof(request.ExternalObjectId),
                "An Entra ID object id is required for SSO-enabled accounts.");

        if (request.ManagerUserId == id)
            throw new ValidationAppException(nameof(request.ManagerUserId), "A user cannot be their own manager.");

        var before = new { user.Email, user.AuthenticationType, user.ManagerUserId, user.StandardDailyHours };

        user.EmployeeCode = string.IsNullOrWhiteSpace(request.EmployeeCode) ? null : request.EmployeeCode.Trim();
        user.FirstName = request.FirstName.Trim();
        user.LastName = request.LastName.Trim();
        user.Email = email;
        user.AuthenticationType = request.AuthenticationType;
        user.ExternalObjectId = string.IsNullOrWhiteSpace(request.ExternalObjectId) ? null : request.ExternalObjectId.Trim();
        user.ExternalTenantId = request.ExternalTenantId;
        user.ManagerUserId = request.ManagerUserId;
        user.Designation = request.Designation;
        user.StandardDailyHours = request.StandardDailyHours;
        user.DateOfJoining = request.DateOfJoining;
        user.DateOfExit = request.DateOfExit;

        uow.Users.Update(user);
        await AssignRolesAsync(id, request.RoleCodes, ct);
        await uow.SaveChangesAsync(ct);

        await audit.LogAsync(nameof(User), id, AuditActions.Update, before,
            new { user.Email, user.AuthenticationType, user.ManagerUserId, user.StandardDailyHours }, ct);

        return await GetByIdAsync(id, ct);
    }

    public async Task<UserDto> SetActiveAsync(int id, bool isActive, CancellationToken ct = default)
    {
        var user = await uow.Users.QueryForUpdate().FirstOrDefaultAsync(u => u.Id == id, ct)
                   ?? throw new NotFoundException(nameof(User), id);

        if (id == currentUser.UserId && !isActive)
            throw new BusinessRuleException("You cannot deactivate your own account.");

        user.IsActive = isActive;
        uow.Users.Update(user);
        await uow.SaveChangesAsync(ct);

        // A deactivated user must lose access immediately, not when their access token expires.
        if (!isActive)
            await auth.RevokeAllForUserAsync(id, "User deactivated", ct);

        await audit.LogAsync(nameof(User), id, AuditActions.Update, new { IsActive = !isActive }, new { IsActive = isActive }, ct);
        return await GetByIdAsync(id, ct);
    }

    public async Task<IReadOnlyList<LookupDto>> GetTeamMembersAsync(int? managerUserId = null, CancellationToken ct = default)
    {
        var scopeId = currentUser.IsAdmin ? managerUserId : currentUser.RequireUserId();

        return await uow.Users.Query()
            .Where(u => u.IsActive && !u.IsServiceAccount && (scopeId == null || u.ManagerUserId == scopeId))
            .OrderBy(u => u.FullName)
            .Select(u => new LookupDto(u.Id, u.FullName, u.EmployeeCode))
            .ToListAsync(ct);
    }

    public async Task<IReadOnlyList<LookupDto>> GetManagerLookupAsync(CancellationToken ct = default) =>
        await uow.Users.Query()
            .Where(u => u.IsActive && !u.IsServiceAccount
                        && u.UserRoles.Any(r => r.IsActive && (r.Role.RoleCode == RoleCodes.Manager || r.Role.RoleCode == RoleCodes.Admin)))
            .OrderBy(u => u.FullName)
            .Select(u => new LookupDto(u.Id, u.FullName, u.EmployeeCode))
            .ToListAsync(ct);

    /// <summary>Reconciles role assignments: reactivates, adds, and deactivates as needed.</summary>
    private async Task AssignRolesAsync(int userId, IReadOnlyCollection<string> roleCodes, CancellationToken ct)
    {
        if (roleCodes.Count == 0) return;

        var roles = await uow.Roles.Query().Where(r => r.IsActive && roleCodes.Contains(r.RoleCode)).ToListAsync(ct);

        var unknown = roleCodes.Except(roles.Select(r => r.RoleCode), StringComparer.OrdinalIgnoreCase).ToList();
        if (unknown.Count > 0)
            throw new ValidationAppException(nameof(roleCodes), $"Unknown role code(s): {string.Join(", ", unknown)}.");

        var existing = await uow.UserRoles.QueryForUpdate().Where(ur => ur.UserId == userId).ToListAsync(ct);

        foreach (var role in roles)
        {
            var match = existing.FirstOrDefault(e => e.RoleId == role.Id);
            if (match is null)
            {
                await uow.UserRoles.AddAsync(new UserRole { UserId = userId, RoleId = role.Id, AssignedDate = DateTime.UtcNow }, ct);
            }
            else if (!match.IsActive)
            {
                match.IsActive = true;
                uow.UserRoles.Update(match);
            }
        }

        foreach (var stale in existing.Where(e => e.IsActive && roles.All(r => r.Id != e.RoleId)))
        {
            stale.IsActive = false;
            uow.UserRoles.Update(stale);
        }
    }

    /// <summary>
    /// Expression (not a method) so EF Core translates it into SQL. A static method called inside
    /// Select is evaluated CLIENT-side against materialised entities, which silently returned empty
    /// Roles and a null ManagerName because those navigations were never loaded. As an Expression
    /// the role list and manager name become correlated subqueries in the generated SQL.
    /// </summary>
    private static readonly System.Linq.Expressions.Expression<Func<User, UserDto>> Projection = u => new UserDto
    {
        Id = u.Id,
        EmployeeCode = u.EmployeeCode,
        FirstName = u.FirstName,
        LastName = u.LastName,
        FullName = u.FullName,
        Email = u.Email,
        AuthenticationType = u.AuthenticationType,
        ExternalObjectId = u.ExternalObjectId,
        ManagerUserId = u.ManagerUserId,
        ManagerName = u.Manager != null ? u.Manager.FullName : null,
        Designation = u.Designation,
        StandardDailyHours = u.StandardDailyHours,
        DateOfJoining = u.DateOfJoining,
        DateOfExit = u.DateOfExit,
        LastLoginDate = u.LastLoginDate,
        IsActive = u.IsActive,
        HasDatabaseCredential = u.Credential != null,
        Roles = u.UserRoles.Where(r => r.IsActive).Select(r => r.Role.RoleCode).ToList()
    };
}

/// <summary>Project and allocation administration.</summary>
public class ProjectService(
    IUnitOfWork uow,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IAuditService audit) : IProjectService
{
    public async Task<PagedResult<ProjectDto>> SearchAsync(ProjectFilter filter, CancellationToken ct = default)
    {
        var query = uow.Projects.Query();

        if (filter.IsActive.HasValue) query = query.Where(p => p.IsActive == filter.IsActive);
        if (!string.IsNullOrWhiteSpace(filter.Status)) query = query.Where(p => p.Status == filter.Status);
        if (filter.ProjectManagerUserId.HasValue) query = query.Where(p => p.ProjectManagerUserId == filter.ProjectManagerUserId);

        if (filter.OpenForEffortOnly)
        {
            var on = filter.EffortDate ?? clock.TodayUtc;
            query = query.Where(p => p.IsActive && ProjectStatuses.OpenForEffort.Contains(p.Status)
                                     && p.StartDate <= on && (p.EndDate == null || p.EndDate >= on));
        }

        if (!string.IsNullOrWhiteSpace(filter.Search))
        {
            var t = filter.Search.Trim();
            query = query.Where(p => p.ProjectName.Contains(t) || p.ProjectCode.Contains(t));
        }

        var total = await query.CountAsync(ct);

        query = (filter.SortBy?.ToLowerInvariant()) switch
        {
            "code" => filter.SortDescending ? query.OrderByDescending(p => p.ProjectCode) : query.OrderBy(p => p.ProjectCode),
            "status" => filter.SortDescending ? query.OrderByDescending(p => p.Status) : query.OrderBy(p => p.Status),
            "start" => filter.SortDescending ? query.OrderByDescending(p => p.StartDate) : query.OrderBy(p => p.StartDate),
            _ => filter.SortDescending ? query.OrderByDescending(p => p.ProjectName) : query.OrderBy(p => p.ProjectName)
        };

        var today = clock.TodayUtc;
        var items = await query.Skip((filter.Page - 1) * filter.PageSize).Take(filter.PageSize)
            .Select(p => new ProjectDto
            {
                Id = p.Id,
                ProjectCode = p.ProjectCode,
                ProjectName = p.ProjectName,
                Description = p.Description,
                StartDate = p.StartDate,
                EndDate = p.EndDate,
                Status = p.Status,
                ProjectManagerUserId = p.ProjectManagerUserId,
                ProjectManagerName = p.ProjectManager != null ? p.ProjectManager.FullName : null,
                IsActive = p.IsActive,
                AllocatedResourceCount = p.Allocations.Count(a => a.IsActive),
                IsOpenForEffort = p.IsActive && ProjectStatuses.OpenForEffort.Contains(p.Status)
                                  && p.StartDate <= today && (p.EndDate == null || p.EndDate >= today)
            })
            .ToListAsync(ct);

        return PagedResult<ProjectDto>.Create(items, total, filter.Page, filter.PageSize);
    }

    public async Task<ProjectDto> GetByIdAsync(int id, CancellationToken ct = default)
    {
        var result = await SearchAsync(new ProjectFilter { Page = 1, PageSize = 1, Search = null }, ct);
        var dto = result.Items.FirstOrDefault(p => p.Id == id);
        if (dto is not null) return dto;

        var project = await uow.Projects.Query()
            .Where(p => p.Id == id)
            .Select(p => new ProjectDto
            {
                Id = p.Id, ProjectCode = p.ProjectCode, ProjectName = p.ProjectName, Description = p.Description,
                StartDate = p.StartDate, EndDate = p.EndDate, Status = p.Status,
                ProjectManagerUserId = p.ProjectManagerUserId,
                ProjectManagerName = p.ProjectManager != null ? p.ProjectManager.FullName : null,
                IsActive = p.IsActive,
                AllocatedResourceCount = p.Allocations.Count(a => a.IsActive)
            })
            .FirstOrDefaultAsync(ct) ?? throw new NotFoundException(nameof(Project), id);

        project.IsOpenForEffort = project.IsActive && ProjectStatuses.OpenForEffort.Contains(project.Status)
                                  && project.StartDate <= clock.TodayUtc
                                  && (project.EndDate is null || project.EndDate >= clock.TodayUtc);
        return project;
    }

    public async Task<ProjectDto> CreateAsync(CreateProjectRequest request, CancellationToken ct = default)
    {
        var code = request.ProjectCode.Trim();

        if (await uow.Projects.AnyAsync(p => p.ProjectCode == code && p.IsActive, ct))
            throw new ConflictException($"Project code '{code}' is already in use.");

        if (await uow.Projects.AnyAsync(p => p.ProjectName == request.ProjectName.Trim() && p.IsActive, ct))
            throw new ConflictException($"Project name '{request.ProjectName}' is already in use.");

        if (!ProjectStatuses.All.Contains(request.Status))
            throw new ValidationAppException(nameof(request.Status), $"Status must be one of: {string.Join(", ", ProjectStatuses.All)}.");

        if (request.EndDate.HasValue && request.EndDate < request.StartDate)
            throw new ValidationAppException(nameof(request.EndDate), "End date cannot be earlier than start date.");

        var project = new Project
        {
            ProjectCode = code,
            ProjectName = request.ProjectName.Trim(),
            Description = request.Description,
            StartDate = request.StartDate,
            EndDate = request.EndDate,
            Status = request.Status,
            ProjectManagerUserId = request.ProjectManagerUserId
        };

        await uow.Projects.AddAsync(project, ct);
        await uow.SaveChangesAsync(ct);
        await audit.LogAsync(nameof(Project), project.Id, AuditActions.Insert, null, new { project.ProjectCode, project.ProjectName, project.Status }, ct);

        return await GetByIdAsync(project.Id, ct);
    }

    public async Task<ProjectDto> UpdateAsync(int id, UpdateProjectRequest request, CancellationToken ct = default)
    {
        var project = await uow.Projects.QueryForUpdate().FirstOrDefaultAsync(p => p.Id == id, ct)
                      ?? throw new NotFoundException(nameof(Project), id);

        var code = request.ProjectCode.Trim();
        if (await uow.Projects.AnyAsync(p => p.ProjectCode == code && p.Id != id && p.IsActive, ct))
            throw new ConflictException($"Project code '{code}' is already in use.");

        if (!ProjectStatuses.All.Contains(request.Status))
            throw new ValidationAppException(nameof(request.Status), $"Status must be one of: {string.Join(", ", ProjectStatuses.All)}.");

        if (request.EndDate.HasValue && request.EndDate < request.StartDate)
            throw new ValidationAppException(nameof(request.EndDate), "End date cannot be earlier than start date.");

        // Shrinking the window must not orphan effort that has already been logged.
        var conflicting = await uow.DsrEntries.Query().AnyAsync(
            e => e.ProjectId == id && e.IsActive
                 && (e.WorkDate < request.StartDate || (request.EndDate != null && e.WorkDate > request.EndDate)), ct);

        if (conflicting)
            throw new BusinessRuleException("DSR entries already exist outside the requested project window. Adjust the dates or remove those entries first.");

        var before = new { project.ProjectCode, project.ProjectName, project.Status, project.StartDate, project.EndDate };

        project.ProjectCode = code;
        project.ProjectName = request.ProjectName.Trim();
        project.Description = request.Description;
        project.StartDate = request.StartDate;
        project.EndDate = request.EndDate;
        project.Status = request.Status;
        project.ProjectManagerUserId = request.ProjectManagerUserId;

        uow.Projects.Update(project);
        await uow.SaveChangesAsync(ct);
        await audit.LogAsync(nameof(Project), id, AuditActions.Update, before,
            new { project.ProjectCode, project.ProjectName, project.Status, project.StartDate, project.EndDate }, ct);

        return await GetByIdAsync(id, ct);
    }

    public async Task<ProjectDto> SetActiveAsync(int id, bool isActive, CancellationToken ct = default)
    {
        var project = await uow.Projects.QueryForUpdate().FirstOrDefaultAsync(p => p.Id == id, ct)
                      ?? throw new NotFoundException(nameof(Project), id);

        project.IsActive = isActive;
        uow.Projects.Update(project);
        await uow.SaveChangesAsync(ct);
        await audit.LogAsync(nameof(Project), id, AuditActions.Update, new { IsActive = !isActive }, new { IsActive = isActive }, ct);

        return await GetByIdAsync(id, ct);
    }

    public async Task<IReadOnlyList<ProjectAllocationDto>> GetAllocationsAsync(int? projectId, int? userId, CancellationToken ct = default)
    {
        var query = uow.ProjectAllocations.Query().Where(a => a.IsActive);

        if (projectId.HasValue) query = query.Where(a => a.ProjectId == projectId);
        if (userId.HasValue) query = query.Where(a => a.UserId == userId);

        if (!currentUser.IsAdmin && !currentUser.IsManager)
            query = query.Where(a => a.UserId == currentUser.RequireUserId());

        return await query
            .OrderBy(a => a.Project.ProjectName).ThenBy(a => a.User.FullName)
            .Select(a => new ProjectAllocationDto
            {
                Id = a.Id, ProjectId = a.ProjectId, ProjectCode = a.Project.ProjectCode, ProjectName = a.Project.ProjectName,
                UserId = a.UserId, EmployeeName = a.User.FullName,
                AllocationPercentage = a.AllocationPercentage,
                AllocationStartDate = a.AllocationStartDate, AllocationEndDate = a.AllocationEndDate,
                ProjectRole = a.ProjectRole, IsActive = a.IsActive
            })
            .ToListAsync(ct);
    }

    public async Task<ProjectAllocationDto> SaveAllocationAsync(SaveProjectAllocationRequest request, CancellationToken ct = default)
    {
        if (request.AllocationPercentage is <= 0 or > 100)
            throw new ValidationAppException(nameof(request.AllocationPercentage), "Allocation must be between 1 and 100 percent.");

        if (request.AllocationEndDate.HasValue && request.AllocationEndDate < request.AllocationStartDate)
            throw new ValidationAppException(nameof(request.AllocationEndDate), "End date cannot be earlier than start date.");

        if (!await uow.Projects.AnyAsync(p => p.Id == request.ProjectId && p.IsActive, ct))
            throw new NotFoundException(nameof(Project), request.ProjectId);

        if (!await uow.Users.AnyAsync(u => u.Id == request.UserId && u.IsActive, ct))
            throw new NotFoundException(nameof(User), request.UserId);

        // Overlapping windows cannot be prevented by a constraint (no exclusion constraints in
        // SQL Server), so the rule is enforced here -- see design document, R-integrity note.
        var overlapping = await uow.ProjectAllocations.Query().AnyAsync(
            a => a.ProjectId == request.ProjectId && a.UserId == request.UserId && a.IsActive
                 && a.AllocationStartDate <= (request.AllocationEndDate ?? DateOnly.MaxValue)
                 && (a.AllocationEndDate == null || a.AllocationEndDate >= request.AllocationStartDate), ct);

        if (overlapping)
            throw new ConflictException("An overlapping allocation already exists for this employee on this project.");

        var totalPct = await uow.ProjectAllocations.Query()
            .Where(a => a.UserId == request.UserId && a.IsActive
                        && a.AllocationStartDate <= (request.AllocationEndDate ?? DateOnly.MaxValue)
                        && (a.AllocationEndDate == null || a.AllocationEndDate >= request.AllocationStartDate))
            .SumAsync(a => (decimal?)a.AllocationPercentage, ct) ?? 0m;

        if (totalPct + request.AllocationPercentage > 100m)
            throw new BusinessRuleException(
                $"Total allocation for this employee would reach {totalPct + request.AllocationPercentage:0.##}%, exceeding 100%.");

        var allocation = new ProjectAllocation
        {
            ProjectId = request.ProjectId,
            UserId = request.UserId,
            AllocationPercentage = request.AllocationPercentage,
            AllocationStartDate = request.AllocationStartDate,
            AllocationEndDate = request.AllocationEndDate,
            ProjectRole = request.ProjectRole
        };

        await uow.ProjectAllocations.AddAsync(allocation, ct);
        await uow.SaveChangesAsync(ct);
        await audit.LogAsync(nameof(ProjectAllocation), allocation.Id, AuditActions.Insert, null, request, ct);

        return (await GetAllocationsAsync(request.ProjectId, request.UserId, ct)).First(a => a.Id == allocation.Id);
    }

    public async Task RemoveAllocationAsync(int allocationId, CancellationToken ct = default)
    {
        var allocation = await uow.ProjectAllocations.QueryForUpdate().FirstOrDefaultAsync(a => a.Id == allocationId, ct)
                         ?? throw new NotFoundException(nameof(ProjectAllocation), allocationId);

        allocation.IsActive = false;
        uow.ProjectAllocations.Update(allocation);
        await uow.SaveChangesAsync(ct);
        await audit.LogAsync(nameof(ProjectAllocation), allocationId, AuditActions.Delete, allocation, null, ct);
    }
}

/// <summary>Roles, AI tools and the holiday calendar.</summary>
public class MasterDataService(IUnitOfWork uow, IAuditService audit) : IMasterDataService
{
    public async Task<IReadOnlyList<RoleDto>> GetRolesAsync(CancellationToken ct = default) =>
        await uow.Roles.Query().OrderBy(r => r.RoleName)
            .Select(r => new RoleDto(r.Id, r.RoleCode, r.RoleName, r.Description, r.IsSystemRole, r.IsActive,
                r.UserRoles.Count(ur => ur.IsActive)))
            .ToListAsync(ct);

    public async Task<IReadOnlyList<AiToolDto>> GetAiToolsAsync(bool activeOnly = true, CancellationToken ct = default) =>
        await uow.AiTools.Query().Where(t => !activeOnly || t.IsActive).OrderBy(t => t.ToolName)
            .Select(t => new AiToolDto(t.Id, t.ToolName, t.Vendor, t.Category, t.IsActive))
            .ToListAsync(ct);

    public async Task<AiToolDto> SaveAiToolAsync(int? id, string toolName, string? vendor, string? category, CancellationToken ct = default)
    {
        var name = toolName.Trim();
        if (await uow.AiTools.AnyAsync(t => t.ToolName == name && t.IsActive && (id == null || t.Id != id), ct))
            throw new ConflictException($"AI tool '{name}' already exists.");

        AiTool tool;
        if (id is null)
        {
            tool = new AiTool { ToolName = name, Vendor = vendor, Category = category };
            await uow.AiTools.AddAsync(tool, ct);
        }
        else
        {
            tool = await uow.AiTools.QueryForUpdate().FirstOrDefaultAsync(t => t.Id == id, ct)
                   ?? throw new NotFoundException(nameof(AiTool), id);
            tool.ToolName = name;
            tool.Vendor = vendor;
            tool.Category = category;
            uow.AiTools.Update(tool);
        }

        await uow.SaveChangesAsync(ct);
        return new AiToolDto(tool.Id, tool.ToolName, tool.Vendor, tool.Category, tool.IsActive);
    }

    public async Task<IReadOnlyList<HolidayDto>> GetHolidaysAsync(int? year, CancellationToken ct = default) =>
        await uow.Holidays.Query()
            .Where(h => h.IsActive && (year == null || h.HolidayDate.Year == year))
            .OrderBy(h => h.HolidayDate)
            .Select(h => new HolidayDto(h.Id, h.HolidayDate, h.HolidayName, h.IsOptional, h.IsActive))
            .ToListAsync(ct);

    public async Task<HolidayDto> SaveHolidayAsync(int? id, DateOnly date, string name, bool isOptional, CancellationToken ct = default)
    {
        if (await uow.Holidays.AnyAsync(h => h.HolidayDate == date && h.IsActive && (id == null || h.Id != id), ct))
            throw new ConflictException($"A holiday is already defined for {date:dd-MMM-yyyy}.");

        Holiday holiday;
        if (id is null)
        {
            holiday = new Holiday { HolidayDate = date, HolidayName = name.Trim(), IsOptional = isOptional };
            await uow.Holidays.AddAsync(holiday, ct);
        }
        else
        {
            holiday = await uow.Holidays.QueryForUpdate().FirstOrDefaultAsync(h => h.Id == id, ct)
                      ?? throw new NotFoundException(nameof(Holiday), id);
            holiday.HolidayDate = date;
            holiday.HolidayName = name.Trim();
            holiday.IsOptional = isOptional;
            uow.Holidays.Update(holiday);
        }

        await uow.SaveChangesAsync(ct);
        await audit.LogAsync(nameof(Holiday), holiday.Id, id is null ? AuditActions.Insert : AuditActions.Update, null,
            new { holiday.HolidayDate, holiday.HolidayName }, ct);

        return new HolidayDto(holiday.Id, holiday.HolidayDate, holiday.HolidayName, holiday.IsOptional, holiday.IsActive);
    }

    public async Task<IReadOnlyList<DepartmentDto>> GetDepartmentsAsync(CancellationToken ct = default) =>
        await uow.Departments.Query().Where(d => d.IsActive).OrderBy(d => d.DepartmentName)
            .Select(d => new DepartmentDto(d.Id, d.DepartmentCode, d.DepartmentName,
                d.Head != null ? d.Head.FullName : null,
                d.Members.Count(m => m.IsActive), d.IsActive))
            .ToListAsync(ct);

    public async Task<IReadOnlyList<WorkCategoryDto>> GetWorkCategoriesAsync(CancellationToken ct = default) =>
        await uow.WorkCategories.Query().Where(c => c.IsActive)
            .OrderBy(c => c.SortOrder).ThenBy(c => c.CategoryName)
            .Select(c => new WorkCategoryDto(c.Id, c.CategoryCode, c.CategoryName, c.SortOrder, c.IsActive))
            .ToListAsync(ct);

    public async Task DeleteHolidayAsync(int id, CancellationToken ct = default)
    {
        var holiday = await uow.Holidays.QueryForUpdate().FirstOrDefaultAsync(h => h.Id == id, ct)
                      ?? throw new NotFoundException(nameof(Holiday), id);

        holiday.IsActive = false;
        uow.Holidays.Update(holiday);
        await uow.SaveChangesAsync(ct);
    }
}
