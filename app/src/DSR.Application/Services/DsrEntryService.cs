
using DSR.Application.Common;
using DSR.Application.DTOs;
using DSR.Application.Interfaces;
using DSR.Domain.Common;
using DSR.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace DSR.Application.Services;

/// <summary>
/// The DSR core.
///
/// GRAIN: one row per (employee, work date, project). Pressing Save three times for three projects
/// on 10-Aug-2026 produces three independent <see cref="DsrEntry"/> rows. There is no header entity.
///
/// AI DECLARATION: captured on the same form but stored once per (employee, date) in
/// <see cref="DailyAiUsage"/>. Create/Update therefore UPSERTS that single row rather than writing
/// one per entry, which is what keeps the same day from claiming both "AI = Yes" and "AI = No".
///
/// SCOPE: every method resolves the acting user from <see cref="ICurrentUser"/> and calls
/// <see cref="EnsureCanAccessUserAsync"/>. No method trusts a user id from the request body except
/// OnBehalfOfUserId, which is itself authorisation-checked.
///
/// Every rule enforced here is also enforced by a CHECK constraint or trigger in the database. The
/// duplication is deliberate: this layer produces a friendly message, the database guarantees the
/// invariant even if a future caller bypasses this service.
/// </summary>
public class DsrEntryService(
    IUnitOfWork uow,
    IReportingRepository reporting,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IAppSettingService settings,
    IAuditService audit,
    IHtmlContentService html,
    ILogger<DsrEntryService> logger) : IDsrEntryService
{
    public async Task<DsrEntryDto> CreateAsync(CreateDsrEntryRequest request, CancellationToken ct = default)
    {
        var actingUserId = currentUser.RequireUserId();
        var targetUserId = request.OnBehalfOfUserId ?? actingUserId;

        if (targetUserId != actingUserId && !currentUser.IsAdmin && !currentUser.IsManager)
            throw new ForbiddenException("Only an Admin or Manager may file a DSR on behalf of another employee.");

        await EnsureCanAccessUserAsync(targetUserId, ct);
        await ValidateWorkDateAsync(request.WorkDate, ct);

        var requireDescription = await settings.GetBoolAsync(SettingKeys.RequireDescription, true, ct);

        // --- AI declaration is mandatory (BRD validation rule) --------------------------------
        if (request.IsAiUsed is null)
            throw new ValidationAppException(nameof(request.IsAiUsed), "Please state whether AI was used today.");

        ValidateAiPair(request.IsAiUsed.Value, request.AiToolId);

        // --- No Work Done branch ---------------------------------------------------------------
        if (request.IsNoWorkDone)
        {
            if (request.EstimatedHours != 0)
                throw new ValidationAppException(nameof(request.EstimatedHours), "Hours must be zero when 'No Work Done' is selected.");

            /*  Two DIFFERENT situations block a 'No Work Done' declaration, and they need different
                messages. Counting all rows and reporting "already has work entries" was wrong for
                the duplicate case: the row being counted was the existing No-Work declaration
                itself, so the user was told to remove work entries that did not exist.          */
            var existing = await uow.DsrEntries.Query()
                .Where(e => e.UserId == targetUserId && e.WorkDate == request.WorkDate && e.IsActive)
                .Select(e => new { e.IsNoWorkDone, e.EstimatedHours })
                .ToListAsync(ct);

            if (existing.Any(x => x.IsNoWorkDone))
                throw new BusinessRuleException(
                    $"{request.WorkDate:dd MMM yyyy} is already marked as 'No Work Done'. There is nothing further to record for this date.");

            if (existing.Count > 0)
            {
                var hours = existing.Sum(x => x.EstimatedHours);
                throw new BusinessRuleException(
                    $"You have already logged {existing.Count} work {(existing.Count == 1 ? "entry" : "entries")} " +
                    $"totalling {hours:0.##} hour(s) on {request.WorkDate:dd MMM yyyy}. " +
                    $"Delete {(existing.Count == 1 ? "it" : "them")} first if you did not work on this date.");
            }
        }
        else
        {
            if (request.ProjectId is null)
                throw new ValidationAppException(nameof(request.ProjectId), "Project is required for a work entry.");

            if (request.EstimatedHours <= 0)
                throw new ValidationAppException(nameof(request.EstimatedHours), "Hours must be greater than zero for a work entry.");

            if (requireDescription && string.IsNullOrWhiteSpace(html.ToPlainText(request.WorkDescriptionHtml)))
                throw new ValidationAppException(nameof(request.WorkDescriptionHtml), "Description is required when work has been performed.");

            // A 'No Work Done' declaration already present makes any work entry contradictory
            var hasNoWorkDeclaration = await uow.DsrEntries.AnyAsync(
                e => e.UserId == targetUserId && e.WorkDate == request.WorkDate && e.IsNoWorkDone && e.IsActive, ct);

            if (hasNoWorkDeclaration)
                throw new BusinessRuleException("This date is marked 'No Work Done'. Remove that declaration before adding work entries.");

            await ValidateProjectAsync(request.ProjectId.Value, request.WorkDate, ct);

            /*  No duplicate check. Multiple entries against the SAME project on the SAME date are
                deliberately allowed (timesheet style: API Development 4h, Unit Testing 2h,
                Bug Fixing 1h all against Project A).

                DAILY HOURS LIMITS REMOVED as per current business requirement.
                8 hours is now a utilisation BENCHMARK, not a validation ceiling: an employee may
                log any number of hours against a project and any total across a day. See
                EnsureHoursCapAsync below, which is retained but no longer called.            */
            // await EnsureHoursCapAsync(targetUserId, request.WorkDate, request.ProjectId, request.EstimatedHours, null, ct);
        }

        var sanitizedHtml = html.Sanitize(request.WorkDescriptionHtml);

        var entry = new DsrEntry
        {
            UserId = targetUserId,
            WorkDate = request.WorkDate,
            ProjectId = request.IsNoWorkDone ? null : request.ProjectId,
            EstimatedHours = request.IsNoWorkDone ? 0m : request.EstimatedHours,
            IsNoWorkDone = request.IsNoWorkDone,
            WorkDescriptionHtml = sanitizedHtml,
            WorkDescriptionPlain = html.ToPlainText(sanitizedHtml)
        };

        await uow.DsrEntries.AddAsync(entry, ct);
        await UpsertDailyAiUsageAsync(targetUserId, request.WorkDate, request.IsAiUsed.Value, request.AiToolId, request.AiUsageRemarks, ct);
        await uow.SaveChangesAsync(ct);

        await audit.LogAsync(nameof(DsrEntry), entry.Id, AuditActions.Insert, null, new
        {
            entry.UserId, entry.WorkDate, entry.ProjectId, entry.EstimatedHours, entry.IsNoWorkDone
        }, ct);

        logger.LogInformation("DSR entry {EntryId} created for user {UserId} on {WorkDate} project {ProjectId}",
            entry.Id, targetUserId, request.WorkDate, entry.ProjectId);

        return await GetByIdAsync(entry.Id, ct);
    }

    public async Task<DsrEntryDto> UpdateAsync(int id, UpdateDsrEntryRequest request, CancellationToken ct = default)
    {
        var entry = await uow.DsrEntries.QueryForUpdate().FirstOrDefaultAsync(e => e.Id == id && e.IsActive, ct)
                    ?? throw new NotFoundException(nameof(DsrEntry), id);

        await EnsureCanAccessUserAsync(entry.UserId, ct);
        await EnsureEditableAsync(entry, ct);

        if (request.IsAiUsed is null)
            throw new ValidationAppException(nameof(request.IsAiUsed), "Please state whether AI was used today.");

        ValidateAiPair(request.IsAiUsed.Value, request.AiToolId);

        var requireDescription = await settings.GetBoolAsync(SettingKeys.RequireDescription, true, ct);

        var before = new { entry.ProjectId, entry.EstimatedHours, entry.IsNoWorkDone };

        if (request.IsNoWorkDone)
        {
            if (request.EstimatedHours != 0)
                throw new ValidationAppException(nameof(request.EstimatedHours), "Hours must be zero when 'No Work Done' is selected.");

            // Same distinction as CreateAsync, excluding the row being edited.
            var others = await uow.DsrEntries.Query()
                .Where(e => e.UserId == entry.UserId && e.WorkDate == entry.WorkDate && e.Id != id && e.IsActive)
                .Select(e => new { e.IsNoWorkDone, e.EstimatedHours })
                .ToListAsync(ct);

            if (others.Any(x => x.IsNoWorkDone))
                throw new BusinessRuleException(
                    $"{entry.WorkDate:dd MMM yyyy} is already marked as 'No Work Done' by another entry.");

            if (others.Count > 0)
            {
                var hours = others.Sum(x => x.EstimatedHours);
                throw new BusinessRuleException(
                    $"There {(others.Count == 1 ? "is" : "are")} still {others.Count} other work " +
                    $"{(others.Count == 1 ? "entry" : "entries")} totalling {hours:0.##} hour(s) on " +
                    $"{entry.WorkDate:dd MMM yyyy}. Delete {(others.Count == 1 ? "it" : "them")} before marking the day as 'No Work Done'.");
            }

            entry.ProjectId = null;
            entry.EstimatedHours = 0m;
        }
        else
        {
            if (request.ProjectId is null)
                throw new ValidationAppException(nameof(request.ProjectId), "Project is required for a work entry.");

            if (request.EstimatedHours <= 0)
                throw new ValidationAppException(nameof(request.EstimatedHours), "Hours must be greater than zero for a work entry.");

            if (requireDescription && string.IsNullOrWhiteSpace(html.ToPlainText(request.WorkDescriptionHtml)))
                throw new ValidationAppException(nameof(request.WorkDescriptionHtml), "Description is required when work has been performed.");

            await ValidateProjectAsync(request.ProjectId.Value, entry.WorkDate, ct);

            /*  Duplicate project on the same date is permitted.
                DAILY HOURS LIMITS REMOVED as per current business requirement -- 8 hours is a
                utilisation benchmark, not a ceiling. See EnsureHoursCapAsync below.            */
            // await EnsureHoursCapAsync(entry.UserId, entry.WorkDate, request.ProjectId, request.EstimatedHours, id, ct);

            entry.ProjectId = request.ProjectId;
            entry.EstimatedHours = request.EstimatedHours;
        }

        entry.IsNoWorkDone = request.IsNoWorkDone;
        entry.WorkDescriptionHtml = html.Sanitize(request.WorkDescriptionHtml);
        entry.WorkDescriptionPlain = html.ToPlainText(entry.WorkDescriptionHtml);

        uow.DsrEntries.Update(entry);
        await UpsertDailyAiUsageAsync(entry.UserId, entry.WorkDate, request.IsAiUsed.Value, request.AiToolId, request.AiUsageRemarks, ct);
        await uow.SaveChangesAsync(ct);

        await audit.LogAsync(nameof(DsrEntry), entry.Id, AuditActions.Update, before, new
        {
            entry.ProjectId, entry.EstimatedHours, entry.IsNoWorkDone
        }, ct);

        return await GetByIdAsync(entry.Id, ct);
    }

    public async Task DeleteAsync(int id, CancellationToken ct = default)
    {
        var entry = await uow.DsrEntries.QueryForUpdate().FirstOrDefaultAsync(e => e.Id == id && e.IsActive, ct)
                    ?? throw new NotFoundException(nameof(DsrEntry), id);

        await EnsureCanAccessUserAsync(entry.UserId, ct);
        await EnsureEditableAsync(entry, ct);

        // Soft delete only: the filtered unique index excludes inactive rows, so the
        // (user, date, project) slot becomes available again immediately.
        entry.IsActive = false;
        uow.DsrEntries.Update(entry);
        await uow.SaveChangesAsync(ct);

        await audit.LogAsync(nameof(DsrEntry), entry.Id, AuditActions.Delete,
            new { entry.UserId, entry.WorkDate, entry.ProjectId, entry.EstimatedHours }, null, ct);

        logger.LogInformation("DSR entry {EntryId} soft-deleted by user {ActorId}", id, currentUser.UserId);
    }

    public async Task<DsrEntryDto> GetByIdAsync(int id, CancellationToken ct = default)
    {
        var dto = await uow.DsrEntries.Query()
            .Where(e => e.Id == id && e.IsActive)
            .Select(e => new DsrEntryDto
            {
                Id = e.Id,
                UserId = e.UserId,
                EmployeeName = e.User.FullName,
                EmployeeCode = e.User.EmployeeCode,
                WorkDate = e.WorkDate,
                ProjectId = e.ProjectId,
                ProjectCode = e.Project != null ? e.Project.ProjectCode : null,
                ProjectName = e.Project != null ? e.Project.ProjectName : null,
                EstimatedHours = e.EstimatedHours,
                IsNoWorkDone = e.IsNoWorkDone,
                WorkDescriptionHtml = e.WorkDescriptionHtml,
                WorkDescriptionPlain = e.WorkDescriptionPlain,
                CreatedDate = e.CreatedDate,
                ModifiedDate = e.ModifiedDate
            })
            .FirstOrDefaultAsync(ct)
            ?? throw new NotFoundException(nameof(DsrEntry), id);

        await EnsureCanAccessUserAsync(dto.UserId, ct);
        await AttachAiDeclarationAsync([dto], ct);
        dto.IsEditable = await IsEditableAsync(dto.WorkDate, ct);
        return dto;
    }

    public async Task<DsrDayDto> GetDayAsync(DateOnly workDate, int? userId = null, CancellationToken ct = default)
    {
        var targetUserId = userId ?? currentUser.RequireUserId();
        await EnsureCanAccessUserAsync(targetUserId, ct);

        var user = await uow.Users.Query()
            .Where(u => u.Id == targetUserId)
            .Select(u => new { u.FullName, u.StandardDailyHours })
            .FirstOrDefaultAsync(ct)
            ?? throw new NotFoundException(nameof(User), targetUserId);

        var entries = await uow.DsrEntries.Query()
            .Where(e => e.UserId == targetUserId && e.WorkDate == workDate && e.IsActive)
            .OrderBy(e => e.Id)
            .Select(e => new DsrEntryDto
            {
                Id = e.Id,
                UserId = e.UserId,
                EmployeeName = e.User.FullName,
                EmployeeCode = e.User.EmployeeCode,
                WorkDate = e.WorkDate,
                ProjectId = e.ProjectId,
                ProjectCode = e.Project != null ? e.Project.ProjectCode : null,
                ProjectName = e.Project != null ? e.Project.ProjectName : null,
                EstimatedHours = e.EstimatedHours,
                IsNoWorkDone = e.IsNoWorkDone,
                WorkDescriptionHtml = e.WorkDescriptionHtml,
                WorkDescriptionPlain = e.WorkDescriptionPlain,
                CreatedDate = e.CreatedDate,
                ModifiedDate = e.ModifiedDate
            })
            .ToListAsync(ct);

        var aiUsage = await uow.DailyAiUsages.Query()
            .Where(a => a.UserId == targetUserId && a.WorkDate == workDate && a.IsActive)
            .Select(a => new { a.IsAiUsed, a.AiToolId, ToolName = a.AiTool != null ? a.AiTool.ToolName : null, a.UsageRemarks })
            .FirstOrDefaultAsync(ct);

        var isEditable = await IsEditableAsync(workDate, ct);
        foreach (var e in entries)
        {
            e.IsAiUsed = aiUsage?.IsAiUsed;
            e.AiToolId = aiUsage?.AiToolId;
            e.AiToolName = aiUsage?.ToolName;
            e.AiUsageRemarks = aiUsage?.UsageRemarks;
            e.IsEditable = isEditable;
        }

        return new DsrDayDto
        {
            WorkDate = workDate,
            UserId = targetUserId,
            EmployeeName = user.FullName,
            Entries = entries,
            TotalHours = entries.Sum(e => e.EstimatedHours),
            StandardDailyHours = user.StandardDailyHours,

            // The daily cap IS the employee's standard daily hours, so RemainingHours on the DTO
            // reflects the limit actually enforced on save.
            MaxDailyHours = user.StandardDailyHours,
            HasNoWorkDeclaration = entries.Any(e => e.IsNoWorkDone),
            IsAiUsed = aiUsage?.IsAiUsed,
            AiToolId = aiUsage?.AiToolId,
            AiToolName = aiUsage?.ToolName,
            AiUsageRemarks = aiUsage?.UsageRemarks,
            UsedProjectIds = entries.Where(e => e.ProjectId.HasValue).Select(e => e.ProjectId!.Value).ToList()
        };
    }

    public async Task<PagedResult<DsrEntryDto>> SearchAsync(DsrEntryFilter filter, CancellationToken ct = default)
    {
        var query = reporting.DsrEntryDetail.AsQueryable();

        // ---- Data scoping. Applied BEFORE any client filter so it can never be widened. --------
        if (currentUser.IsAdmin)
        {
            if (filter.ManagerUserId.HasValue)
                query = query.Where(v => v.ManagerUserId == filter.ManagerUserId);
        }
        else if (currentUser.IsManager)
        {
            var managerId = currentUser.RequireUserId();
            query = query.Where(v => v.ManagerUserId == managerId || v.UserId == managerId);
        }
        else
        {
            query = query.Where(v => v.UserId == currentUser.RequireUserId());
        }

        if (filter.UserId.HasValue) query = query.Where(v => v.UserId == filter.UserId);
        if (filter.ProjectId.HasValue) query = query.Where(v => v.ProjectId == filter.ProjectId);
        if (filter.FromDate.HasValue) query = query.Where(v => v.WorkDate >= filter.FromDate);
        if (filter.ToDate.HasValue) query = query.Where(v => v.WorkDate <= filter.ToDate);
        if (filter.IsAiUsed.HasValue) query = query.Where(v => v.IsAiUsed == filter.IsAiUsed);
        if (filter.IsNoWorkDone.HasValue) query = query.Where(v => v.IsNoWorkDone == filter.IsNoWorkDone);

        if (!string.IsNullOrWhiteSpace(filter.Search))
        {
            var term = filter.Search.Trim();
            query = query.Where(v =>
                (v.WorkDescriptionPlain != null && v.WorkDescriptionPlain.Contains(term))
                || v.EmployeeName.Contains(term)
                || (v.ProjectName != null && v.ProjectName.Contains(term)));
        }

        var totalCount = await query.CountAsync(ct);

        query = (filter.SortBy?.ToLowerInvariant()) switch
        {
            "hours" => filter.SortDescending ? query.OrderByDescending(v => v.EstimatedHours) : query.OrderBy(v => v.EstimatedHours),
            "employee" => filter.SortDescending ? query.OrderByDescending(v => v.EmployeeName) : query.OrderBy(v => v.EmployeeName),
            "project" => filter.SortDescending ? query.OrderByDescending(v => v.ProjectName) : query.OrderBy(v => v.ProjectName),
            _ => filter.SortDescending
                ? query.OrderBy(v => v.WorkDate).ThenBy(v => v.DsrEntryId)
                : query.OrderByDescending(v => v.WorkDate).ThenByDescending(v => v.DsrEntryId)
        };

        var items = await query
            .Skip((filter.Page - 1) * filter.PageSize)
            .Take(filter.PageSize)
            .Select(v => new DsrEntryDto
            {
                Id = v.DsrEntryId,
                UserId = v.UserId,
                EmployeeName = v.EmployeeName,
                EmployeeCode = v.EmployeeCode,
                WorkDate = v.WorkDate,
                ProjectId = v.ProjectId,
                ProjectCode = v.ProjectCode,
                ProjectName = v.ProjectName,
                EstimatedHours = v.EstimatedHours,
                IsNoWorkDone = v.IsNoWorkDone,
                WorkDescriptionPlain = v.WorkDescriptionPlain,
                IsAiUsed = v.IsAiUsed,
                AiToolId = v.AiToolId,
                AiToolName = v.AiToolName,
                AiUsageRemarks = v.AiUsageRemarks,
                CreatedDate = v.CreatedDate,
                ModifiedDate = v.ModifiedDate
            })
            .ToListAsync(ct);

        var backDateWindow = await settings.GetIntAsync(SettingKeys.BackDateWindowDays, 7, ct);
        var allowEditAfterLock = await settings.GetBoolAsync(SettingKeys.AllowEditAfterLock, false, ct);
        var today = clock.TodayUtc;

        foreach (var item in items)
            item.IsEditable = (currentUser.IsAdmin && allowEditAfterLock)
                              || item.WorkDate >= today.AddDays(-backDateWindow);

        return PagedResult<DsrEntryDto>.Create(items, totalCount, filter.Page, filter.PageSize);
    }

    public async Task<DsrFormMetadataDto> GetFormMetadataAsync(DateOnly? workDate = null, CancellationToken ct = default)
    {
        var today = clock.TodayUtc;
        var backDateWindow = await settings.GetIntAsync(SettingKeys.BackDateWindowDays, 7, ct);

        // The date the dropdown is being built for. Clamped to today so a future date cannot widen
        // the list, and defaulted to today when the caller does not supply one.
        var effortDate = workDate is null || workDate > today ? today : workDate.Value;

        /*  Filter on status AND the project window.

            Filtering on status alone offered projects that CreateAsync then rejected with
            "the work date falls outside the window for project X" -- the user could pick a
            COMPLETED project whose end date had long passed and only discover the problem on Save.
            This predicate is the queryable twin of Project.AcceptsEffortOn(effortDate); keep the
            two in step, and both in step with trg_DSREntries_ProjectWindow.                     */
        var projects = await uow.Projects.Query()
            .Where(p => p.IsActive
                        && ProjectStatuses.OpenForEffort.Contains(p.Status)
                        && p.StartDate <= effortDate
                        && (p.EndDate == null || p.EndDate >= effortDate))
            .OrderBy(p => p.ProjectName)
            .Select(p => new ProjectDto
            {
                Id = p.Id,
                ProjectCode = p.ProjectCode,
                ProjectName = p.ProjectName,
                Status = p.Status,
                StartDate = p.StartDate,
                EndDate = p.EndDate,
                IsActive = p.IsActive,

                // True by construction: the predicate above already guarantees it for effortDate.
                IsOpenForEffort = true
            })
            .ToListAsync(ct);

        var tools = await uow.AiTools.Query()
            .Where(t => t.IsActive)
            .OrderBy(t => t.ToolName)
            .Select(t => new AiToolDto(t.Id, t.ToolName, t.Vendor, t.Category, t.IsActive))
            .ToListAsync(ct);

        // The cap shown on the form is the caller's own standard daily hours, matching what
        // EnsureDailyHoursCapAsync actually enforces.
        var standardDailyHours = await uow.Users.Query()
            .Where(u => u.Id == currentUser.RequireUserId())
            .Select(u => u.StandardDailyHours)
            .FirstOrDefaultAsync(ct);

        return new DsrFormMetadataDto
        {
            Projects = projects,
            AiTools = tools,
            MaxDailyHours = standardDailyHours <= 0 ? 8m : standardDailyHours,
            BackDateWindowDays = backDateWindow,
            RequireDescription = await settings.GetBoolAsync(SettingKeys.RequireDescription, true, ct),
            MinWorkDate = today.AddDays(-backDateWindow),
            MaxWorkDate = today
        };
    }

    /* ------------------------------- private helpers ------------------------------- */

    /// <summary>
    /// Upserts the ONE AI declaration for (user, date). Called by both Create and Update, which is
    /// why a second entry on the same date updates rather than duplicates the declaration.
    /// </summary>
    private async Task UpsertDailyAiUsageAsync(int userId, DateOnly workDate, bool isAiUsed, int? aiToolId, string? remarks, CancellationToken ct)
    {
        var existing = await uow.DailyAiUsages.QueryForUpdate()
            .FirstOrDefaultAsync(a => a.UserId == userId && a.WorkDate == workDate, ct);

        if (existing is null)
        {
            await uow.DailyAiUsages.AddAsync(new DailyAiUsage
            {
                UserId = userId,
                WorkDate = workDate,
                IsAiUsed = isAiUsed,
                AiToolId = isAiUsed ? aiToolId : null,
                UsageRemarks = remarks
            }, ct);
            return;
        }

        existing.IsAiUsed = isAiUsed;
        existing.AiToolId = isAiUsed ? aiToolId : null;
        existing.UsageRemarks = remarks;
        existing.IsActive = true;   // revive a previously soft-deleted declaration
        uow.DailyAiUsages.Update(existing);
    }

    private static void ValidateAiPair(bool isAiUsed, int? aiToolId)
    {
        // Mirrors CK_DailyAiUsage_ToolMatchesFlag
        if (isAiUsed && aiToolId is null)
            throw new ValidationAppException(nameof(CreateDsrEntryRequest.AiToolId), "Select the AI tool you used.");

        if (!isAiUsed && aiToolId is not null)
            throw new ValidationAppException(nameof(CreateDsrEntryRequest.AiToolId), "An AI tool cannot be selected when AI was not used.");
    }

    private async Task ValidateWorkDateAsync(DateOnly workDate, CancellationToken ct)
    {
        // BRD: future dates not allowed. Uses UTC today, matching CK_DSREntries_NoFutureDate.
        if (workDate > clock.TodayUtc)
            throw new ValidationAppException(nameof(CreateDsrEntryRequest.WorkDate), "A DSR cannot be filed for a future date.");

        var backDateWindow = await settings.GetIntAsync(SettingKeys.BackDateWindowDays, 7, ct);
        var earliest = clock.TodayUtc.AddDays(-backDateWindow);

        if (workDate >= earliest) return;

        var allowEditAfterLock = await settings.GetBoolAsync(SettingKeys.AllowEditAfterLock, false, ct);
        if (currentUser.IsAdmin && allowEditAfterLock) return;

        throw new BusinessRuleException(
            $"DSR entries may only be filed within the last {backDateWindow} day(s). Contact an administrator for older dates.");
    }

    private async Task ValidateProjectAsync(int projectId, DateOnly workDate, CancellationToken ct)
    {
        var project = await uow.Projects.Query()
            .Where(p => p.Id == projectId)
            .Select(p => new { p.Id, p.ProjectName, p.Status, p.StartDate, p.EndDate, p.IsActive })
            .FirstOrDefaultAsync(ct)
            ?? throw new NotFoundException(nameof(Project), projectId);

        if (!project.IsActive)
            throw new BusinessRuleException($"Project '{project.ProjectName}' is inactive.");

        if (!ProjectStatuses.OpenForEffort.Contains(project.Status))
            throw new BusinessRuleException($"Project '{project.ProjectName}' is {project.Status} and is not open for effort logging.");

        if (workDate < project.StartDate || (project.EndDate.HasValue && workDate > project.EndDate.Value))
            throw new BusinessRuleException(
                $"Project '{project.ProjectName}' only accepts effort between {project.StartDate:dd-MMM-yyyy} and " +
                $"{(project.EndDate.HasValue ? project.EndDate.Value.ToString("dd-MMM-yyyy") : "no end date")}. " +
                $"The selected work date of {workDate:dd-MMM-yyyy} is outside that window.");
    }

    /// <summary>
    /// HOURS LIMITS.
    ///
    /// Primary rule: <c>StandardDailyHours</c> is the cap PER PROJECT PER DAY, not per day overall.
    /// An employee on 8 standard hours may log up to 8 hours against Project A and a further 8
    /// against Project B on the same date, in as many separate entries as they like. The cap is the
    /// employee's own <see cref="User.StandardDailyHours"/>, so a part-timer on 6 is capped at 6
    /// per project while a colleague on 8 is capped at 8.
    ///
    ///     ProjectHoursAlreadyLogged + NewEntryHours &lt;= StandardDailyHours
    ///
    /// Secondary guard: the day's TOTAL across all projects may still not exceed the configurable
    /// AppSettings key DSR.MaxDailyHours (default 24). Without it, N projects would permit
    /// 8 * N hours in one day and nothing would stop a 40-hour Tuesday. This is a physical-sanity
    /// ceiling, not the business rule.
    ///
    /// Both exclude the entry being edited, so an in-place update never counts itself twice.
    /// Mirrored by trg_DSREntries_DailyRules, which is the last line of defence.
    /// </summary>
    /*  ---------------------------------------------------------------------------------------------
        DAILY HOURS LIMITS REMOVED as per current business requirement.

        8 hours is now the utilisation BENCHMARK only -- it no longer restricts what can be entered:
            Project A = 12h  -> allowed
            Project B = 15h  -> allowed
            day total = 25h  -> allowed  (utilisation 312.5%)

        This method enforced two ceilings, both now disabled:
            1. per project per day  <= the employee's StandardDailyHours
            2. whole day            <= AppSettings 'DSR.MaxDailyHours'

        IMPORTANT: removing this method alone was NOT sufficient. The same two rules were enforced
        independently by the database trigger dsr.trg_DSREntries_DailyRules (THROW 51001 and 51004),
        so entries above the cap failed at the database even with this code gone. Migration
        09_Migration_RemoveDailyHoursLimits.sql rebuilds that trigger without those two rules and
        must be applied to every environment. The trigger's remaining rule -- a "No Work Done"
        declaration cannot coexist with real entries (51002) -- is deliberately kept.

        Retained, not deleted, so the cap can be reinstated by uncommenting this body and its two
        call sites above, and re-running the trigger's previous definition from migration 06/08.
        --------------------------------------------------------------------------------------------- */
    /*
    private async Task EnsureHoursCapAsync(int userId, DateOnly workDate, int? projectId, decimal newHours, int? excludeEntryId, CancellationToken ct)
    {
        var standardDailyHours = await uow.Users.Query()
            .Where(u => u.Id == userId)
            .Select(u => u.StandardDailyHours)
            .FirstOrDefaultAsync(ct);

        if (standardDailyHours <= 0) standardDailyHours = 8m;   // defensive: never cap at zero

        // ---- Primary: per project, per day ---------------------------------------------------
        if (projectId.HasValue)
        {
            var projectHours = await uow.DsrEntries.Query()
                .Where(e => e.UserId == userId && e.WorkDate == workDate && e.ProjectId == projectId
                            && e.IsActive && (excludeEntryId == null || e.Id != excludeEntryId))
                .SumAsync(e => (decimal?)e.EstimatedHours, ct) ?? 0m;

            var projectTotal = projectHours + newHours;
            if (projectTotal > standardDailyHours)
            {
                var projectName = await uow.Projects.Query()
                    .Where(p => p.Id == projectId).Select(p => p.ProjectName).FirstOrDefaultAsync(ct) ?? "this project";

                throw new BusinessRuleException(
                    $"Hours for '{projectName}' on {workDate:dd MMM yyyy} would be {projectTotal:0.##}, which exceeds the " +
                    $"limit of {standardDailyHours:0.##} hour(s) per project per day. {projectHours:0.##} hour(s) are " +
                    $"already logged against this project, so you have {Math.Max(0, standardDailyHours - projectHours):0.##} " +
                    $"hour(s) remaining for it. You can still log time against a different project.");
            }
        }

        // ---- Secondary: absolute ceiling for the whole day ------------------------------------
        var maxDailyHours = await settings.GetDecimalAsync(SettingKeys.MaxDailyHours, 24m, ct);

        var dayHours = await uow.DsrEntries.Query()
            .Where(e => e.UserId == userId && e.WorkDate == workDate && e.IsActive
                        && (excludeEntryId == null || e.Id != excludeEntryId))
            .SumAsync(e => (decimal?)e.EstimatedHours, ct) ?? 0m;

        var dayTotal = dayHours + newHours;
        if (dayTotal > maxDailyHours)
            throw new BusinessRuleException(
                $"Total hours for {workDate:dd MMM yyyy} would be {dayTotal:0.##} across all projects, which exceeds the " +
                $"maximum of {maxDailyHours:0.##} hour(s) a day. {dayHours:0.##} hour(s) are already logged.");
    }
    */

    /// <summary>
    /// Data scope. Employee: self only. Manager: self and direct reports. Admin: anyone.
    /// A 404 is deliberately NOT used for out-of-scope users the caller could otherwise enumerate.
    /// </summary>
    private async Task EnsureCanAccessUserAsync(int targetUserId, CancellationToken ct)
    {
        var actingUserId = currentUser.RequireUserId();
        if (actingUserId == targetUserId || currentUser.IsAdmin) return;

        if (currentUser.IsManager)
        {
            var isDirectReport = await uow.Users.AnyAsync(
                u => u.Id == targetUserId && u.ManagerUserId == actingUserId && u.IsActive, ct);

            if (isDirectReport) return;
        }

        throw new ForbiddenException("You do not have access to this employee's DSR data.");
    }

    private async Task<bool> IsEditableAsync(DateOnly workDate, CancellationToken ct)
    {
        var allowEditAfterLock = await settings.GetBoolAsync(SettingKeys.AllowEditAfterLock, false, ct);
        if (currentUser.IsAdmin && allowEditAfterLock) return true;

        var backDateWindow = await settings.GetIntAsync(SettingKeys.BackDateWindowDays, 7, ct);
        return workDate >= clock.TodayUtc.AddDays(-backDateWindow);
    }

    private async Task EnsureEditableAsync(DsrEntry entry, CancellationToken ct)
    {
        if (await IsEditableAsync(entry.WorkDate, ct)) return;

        var backDateWindow = await settings.GetIntAsync(SettingKeys.BackDateWindowDays, 7, ct);
        throw new BusinessRuleException(
            $"This DSR entry is older than the {backDateWindow}-day editing window and can no longer be changed.");
    }

    private async Task AttachAiDeclarationAsync(IReadOnlyCollection<DsrEntryDto> entries, CancellationToken ct)
    {
        if (entries.Count == 0) return;

        var keys = entries.Select(e => new { e.UserId, e.WorkDate }).Distinct().ToList();
        var userIds = keys.Select(k => k.UserId).Distinct().ToList();
        var dates = keys.Select(k => k.WorkDate).Distinct().ToList();

        var declarations = await uow.DailyAiUsages.Query()
            .Where(a => userIds.Contains(a.UserId) && dates.Contains(a.WorkDate) && a.IsActive)
            .Select(a => new
            {
                a.UserId, a.WorkDate, a.IsAiUsed, a.AiToolId,
                ToolName = a.AiTool != null ? a.AiTool.ToolName : null,
                a.UsageRemarks
            })
            .ToListAsync(ct);

        foreach (var entry in entries)
        {
            var match = declarations.FirstOrDefault(d => d.UserId == entry.UserId && d.WorkDate == entry.WorkDate);
            if (match is null) continue;

            entry.IsAiUsed = match.IsAiUsed;
            entry.AiToolId = match.AiToolId;
            entry.AiToolName = match.ToolName;
            entry.AiUsageRemarks = match.UsageRemarks;
        }
    }
}
