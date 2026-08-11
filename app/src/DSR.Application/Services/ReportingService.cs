using System.Globalization;
using System.Text;
using DSR.Application.Common;
using DSR.Application.DTOs;
using DSR.Application.Interfaces;
using DSR.Domain.Common;
using Microsoft.EntityFrameworkCore;

namespace DSR.Application.Services;

/// <summary>
/// All six BRD reports, the three role dashboards, and CSV export.
///
/// Aggregation happens in SQL (views + table-valued functions), never in memory: the reports must
/// stay correct and fast as the DSR table grows. <see cref="ApplyScope"/> is called first on every
/// query so a Manager can never widen their filter to another team, and an Employee can never see
/// anyone but themselves -- the filter object is client-supplied and therefore untrusted.
/// </summary>
public class ReportingService(
    IReportingRepository reporting,
    IDetailReportRepository detailReporting,
    IUnitOfWork uow,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IAppSettingService settings) : IReportingService
{
    /* ------------------------------- 1. EMPLOYEE REPORT ------------------------------- */

    public async Task<PagedResult<EmployeeReportRowDto>> GetEmployeeReportAsync(ReportFilter filter, CancellationToken ct = default)
    {
        var (from, to) = await ResolvePeriodAsync(filter, ct);
        var entries = ApplyScope(reporting.DsrEntryDetail).Where(v => v.WorkDate >= from && v.WorkDate <= to);

        if (filter.UserId.HasValue) entries = entries.Where(v => v.UserId == filter.UserId);
        if (filter.ProjectId.HasValue) entries = entries.Where(v => v.ProjectId == filter.ProjectId);
        if (filter.IsAiUsed.HasValue) entries = entries.Where(v => v.IsAiUsed == filter.IsAiUsed);

        var grouped = entries
            .GroupBy(v => new { v.UserId, v.EmployeeCode, v.EmployeeName, v.ManagerName })
            .Select(g => new
            {
                g.Key.UserId, g.Key.EmployeeCode, g.Key.EmployeeName, g.Key.ManagerName,
                EntryCount = g.Count(),
                DaysLogged = g.Select(x => x.WorkDate).Distinct().Count(),
                ProjectCount = g.Where(x => x.ProjectId != null).Select(x => x.ProjectId).Distinct().Count(),
                TotalHours = g.Sum(x => x.EstimatedHours),
                NoWorkDayCount = g.Count(x => x.IsNoWorkDone),
                AiUsedDayCount = g.Where(x => x.IsAiUsed == true).Select(x => x.WorkDate).Distinct().Count()
            });

        var total = await grouped.CountAsync(ct);

        var rows = await grouped
            .OrderByDescending(g => g.TotalHours)
            .Skip((filter.Page - 1) * filter.PageSize).Take(filter.PageSize)
            .ToListAsync(ct);

        var items = rows.Select(r => new EmployeeReportRowDto
        {
            UserId = r.UserId,
            EmployeeCode = r.EmployeeCode,
            EmployeeName = r.EmployeeName,
            ManagerName = r.ManagerName,
            EntryCount = r.EntryCount,
            DaysLogged = r.DaysLogged,
            ProjectCount = r.ProjectCount,
            TotalHours = r.TotalHours,
            AvgHoursPerLoggedDay = r.DaysLogged == 0 ? 0 : Math.Round(r.TotalHours / r.DaysLogged, 2),
            NoWorkDayCount = r.NoWorkDayCount,
            AiUsedDayCount = r.AiUsedDayCount,
            AiAdoptionPct = r.DaysLogged == 0 ? 0 : Math.Round(r.AiUsedDayCount * 100m / r.DaysLogged, 2)
        }).ToList();

        return PagedResult<EmployeeReportRowDto>.Create(items, total, filter.Page, filter.PageSize);
    }

    /* -------------------------------- 2. PROJECT REPORT -------------------------------- */

    public async Task<PagedResult<ProjectReportRowDto>> GetProjectReportAsync(ReportFilter filter, CancellationToken ct = default)
    {
        var (from, to) = await ResolvePeriodAsync(filter, ct);
        var entries = ApplyScope(reporting.DsrEntryDetail)
            .Where(v => v.WorkDate >= from && v.WorkDate <= to && v.ProjectId != null);

        if (filter.ProjectId.HasValue) entries = entries.Where(v => v.ProjectId == filter.ProjectId);
        if (filter.UserId.HasValue) entries = entries.Where(v => v.UserId == filter.UserId);
        if (!string.IsNullOrWhiteSpace(filter.ProjectStatus)) entries = entries.Where(v => v.ProjectStatus == filter.ProjectStatus);

        var grouped = entries
            .GroupBy(v => new { v.ProjectId, v.ProjectCode, v.ProjectName, v.ProjectStatus })
            .Select(g => new
            {
                ProjectId = g.Key.ProjectId!.Value,
                ProjectCode = g.Key.ProjectCode!,
                ProjectName = g.Key.ProjectName!,
                ProjectStatus = g.Key.ProjectStatus!,
                EntryCount = g.Count(),
                ContributorCount = g.Select(x => x.UserId).Distinct().Count(),
                TotalHours = g.Sum(x => x.EstimatedHours),
                FirstEffortDate = g.Min(x => x.WorkDate),
                LastEffortDate = g.Max(x => x.WorkDate)
            });

        var total = await grouped.CountAsync(ct);
        var grandTotalHours = await entries.SumAsync(v => (decimal?)v.EstimatedHours, ct) ?? 0m;

        var rows = await grouped.OrderByDescending(g => g.TotalHours)
            .Skip((filter.Page - 1) * filter.PageSize).Take(filter.PageSize).ToListAsync(ct);

        var managerNames = await uow.Projects.Query()
            .Where(p => rows.Select(r => r.ProjectId).Contains(p.Id))
            .Select(p => new { p.Id, Name = p.ProjectManager != null ? p.ProjectManager.FullName : null })
            .ToDictionaryAsync(x => x.Id, x => x.Name, ct);

        var items = rows.Select(r => new ProjectReportRowDto
        {
            ProjectId = r.ProjectId,
            ProjectCode = r.ProjectCode,
            ProjectName = r.ProjectName,
            ProjectStatus = r.ProjectStatus,
            ProjectManagerName = managerNames.GetValueOrDefault(r.ProjectId),
            EntryCount = r.EntryCount,
            ContributorCount = r.ContributorCount,
            TotalHours = r.TotalHours,
            FirstEffortDate = r.FirstEffortDate,
            LastEffortDate = r.LastEffortDate,
            SharePct = grandTotalHours == 0 ? 0 : Math.Round(r.TotalHours * 100m / grandTotalHours, 2)
        }).ToList();

        return PagedResult<ProjectReportRowDto>.Create(items, total, filter.Page, filter.PageSize);
    }

    /* --------------------------- 3. RESOURCE UTILIZATION ------------------------------- */

    public async Task<PagedResult<ResourceUtilizationRowDto>> GetResourceUtilizationAsync(ReportFilter filter, CancellationToken ct = default)
    {
        var (from, to) = await ResolvePeriodAsync(filter, ct);
        var target = await settings.GetDecimalAsync(SettingKeys.UtilizationTargetPct, 85m, ct);

        // The TVF already excludes service accounts and computes working days from the holiday calendar.
        var query = reporting.GetResourceUtilization(from, to);

        if (currentUser.IsAdmin)
        {
            if (filter.ManagerUserId.HasValue) query = query.Where(r => r.ManagerUserId == filter.ManagerUserId);
        }
        else if (currentUser.IsManager)
        {
            var me = currentUser.RequireUserId();
            query = query.Where(r => r.ManagerUserId == me || r.UserId == me);
        }
        else
        {
            query = query.Where(r => r.UserId == currentUser.RequireUserId());
        }

        if (filter.UserId.HasValue) query = query.Where(r => r.UserId == filter.UserId);

        var total = await query.CountAsync(ct);

        var rows = await query.OrderByDescending(r => r.UtilizationPct ?? 0)
            .Skip((filter.Page - 1) * filter.PageSize).Take(filter.PageSize).ToListAsync(ct);

        var items = rows.Select(r =>
        {
            var pct = r.UtilizationPct ?? 0m;
            return new ResourceUtilizationRowDto
            {
                UserId = r.UserId,
                EmployeeCode = r.EmployeeCode,
                EmployeeName = r.EmployeeName,
                WorkingDaysInPeriod = r.WorkingDaysInPeriod,
                StandardDailyHours = r.StandardDailyHours,
                TotalAllocationPct = r.TotalAllocationPct,
                CapacityHours = r.CapacityHours,
                PlannedHours = r.PlannedHours,
                LoggedHours = r.LoggedHours,
                DaysLogged = r.DaysLogged,
                UtilizationPct = pct,
                RagStatus = pct >= target ? "GREEN" : pct >= target * 0.7m ? "AMBER" : "RED"
            };
        }).ToList();

        return PagedResult<ResourceUtilizationRowDto>.Create(items, total, filter.Page, filter.PageSize);
    }

    /* ------------------------------- 4. AI USAGE REPORT -------------------------------- */

    public async Task<AiUsageReportDto> GetAiUsageReportAsync(ReportFilter filter, CancellationToken ct = default)
    {
        var (from, to) = await ResolvePeriodAsync(filter, ct);

        // Grain is one declaration per employee-day, so no DISTINCT gymnastics are required.
        var declarations = uow.DailyAiUsages.Query()
            .Where(a => a.IsActive && a.WorkDate >= from && a.WorkDate <= to && !a.User.IsServiceAccount);

        declarations = ApplyScopeToAi(declarations);

        if (filter.UserId.HasValue) declarations = declarations.Where(a => a.UserId == filter.UserId);
        if (filter.IsAiUsed.HasValue) declarations = declarations.Where(a => a.IsAiUsed == filter.IsAiUsed);
        if (filter.AiToolId.HasValue) declarations = declarations.Where(a => a.AiToolId == filter.AiToolId);

        var totalDeclarations = await declarations.CountAsync(ct);
        var aiUsed = await declarations.CountAsync(a => a.IsAiUsed, ct);

        var trend = await declarations
            .GroupBy(a => a.WorkDate)
            .Select(g => new AiUsageTrendPointDto
            {
                WorkDate = g.Key,
                DeclarationCount = g.Count(),
                AiUsedCount = g.Count(x => x.IsAiUsed)
            })
            .OrderBy(t => t.WorkDate)
            .ToListAsync(ct);

        foreach (var point in trend)
            point.AdoptionPct = point.DeclarationCount == 0 ? 0 : Math.Round(point.AiUsedCount * 100m / point.DeclarationCount, 2);

        var byTool = await declarations.Where(a => a.IsAiUsed && a.AiToolId != null)
            .GroupBy(a => new { a.AiToolId, a.AiTool!.ToolName, a.AiTool.Vendor })
            .Select(g => new AiToolUsageDto
            {
                AiToolId = g.Key.AiToolId,
                ToolName = g.Key.ToolName,
                Vendor = g.Key.Vendor,
                UsageDayCount = g.Count(),
                DistinctUserCount = g.Select(x => x.UserId).Distinct().Count()
            })
            .OrderByDescending(t => t.UsageDayCount)
            .ToListAsync(ct);

        foreach (var tool in byTool)
            tool.SharePct = aiUsed == 0 ? 0 : Math.Round(tool.UsageDayCount * 100m / aiUsed, 2);

        var byEmployee = await declarations
            .GroupBy(a => new { a.UserId, a.User.FullName })
            .Select(g => new AiUsageByEmployeeDto
            {
                UserId = g.Key.UserId,
                EmployeeName = g.Key.FullName,
                DeclaredDayCount = g.Count(),
                AiUsedDayCount = g.Count(x => x.IsAiUsed),
                MostUsedTool = g.Where(x => x.AiTool != null)
                    .GroupBy(x => x.AiTool!.ToolName)
                    .OrderByDescending(t => t.Count())
                    .Select(t => t.Key)
                    .FirstOrDefault()
            })
            .OrderByDescending(e => e.AiUsedDayCount)
            .ToListAsync(ct);

        foreach (var emp in byEmployee)
            emp.AdoptionPct = emp.DeclaredDayCount == 0 ? 0 : Math.Round(emp.AiUsedDayCount * 100m / emp.DeclaredDayCount, 2);

        return new AiUsageReportDto
        {
            TotalDeclarations = totalDeclarations,
            AiUsedDeclarations = aiUsed,
            OverallAdoptionPct = totalDeclarations == 0 ? 0 : Math.Round(aiUsed * 100m / totalDeclarations, 2),
            Trend = trend,
            ByTool = byTool,
            ByEmployee = byEmployee
        };
    }

    /* ------------------------------ 5. DAILY SUMMARY ---------------------------------- */

    public async Task<PagedResult<DailySummaryRowDto>> GetDailySummaryAsync(ReportFilter filter, CancellationToken ct = default)
    {
        var (from, to) = await ResolvePeriodAsync(filter, ct);
        var query = reporting.DailySummary.Where(v => v.WorkDate >= from && v.WorkDate <= to);

        if (currentUser.IsAdmin)
        {
            if (filter.ManagerUserId.HasValue) query = query.Where(v => v.ManagerUserId == filter.ManagerUserId);
        }
        else if (currentUser.IsManager)
        {
            var me = currentUser.RequireUserId();
            query = query.Where(v => v.ManagerUserId == me || v.UserId == me);
        }
        else
        {
            query = query.Where(v => v.UserId == currentUser.RequireUserId());
        }

        if (filter.UserId.HasValue) query = query.Where(v => v.UserId == filter.UserId);

        var total = await query.CountAsync(ct);

        var items = await query
            .OrderByDescending(v => v.WorkDate).ThenBy(v => v.EmployeeName)
            .Skip((filter.Page - 1) * filter.PageSize).Take(filter.PageSize)
            .Select(v => new DailySummaryRowDto
            {
                UserId = v.UserId,
                EmployeeName = v.EmployeeName,
                WorkDate = v.WorkDate,
                EntryCount = v.EntryCount,
                ProjectCount = v.ProjectCount,
                TotalHours = v.TotalHours,
                StandardDailyHours = v.StandardDailyHours,
                DayUtilizationPct = v.DayUtilizationPct,
                HasNoWorkDeclaration = v.HasNoWorkDeclaration == 1
            })
            .ToListAsync(ct);

        return PagedResult<DailySummaryRowDto>.Create(items, total, filter.Page, filter.PageSize);
    }

    /* ----------------------------- 6. MONTHLY SUMMARY --------------------------------- */

    public async Task<PagedResult<MonthlySummaryRowDto>> GetMonthlySummaryAsync(ReportFilter filter, CancellationToken ct = default)
    {
        var (from, to) = await ResolvePeriodAsync(filter, ct);
        var fromKey = from.Year * 100 + from.Month;
        var toKey = to.Year * 100 + to.Month;

        var query = reporting.MonthlySummary
            .Where(v => v.WorkYear * 100 + v.WorkMonth >= fromKey && v.WorkYear * 100 + v.WorkMonth <= toKey);

        if (currentUser.IsAdmin)
        {
            if (filter.ManagerUserId.HasValue) query = query.Where(v => v.ManagerUserId == filter.ManagerUserId);
        }
        else if (currentUser.IsManager)
        {
            var me = currentUser.RequireUserId();
            query = query.Where(v => v.ManagerUserId == me || v.UserId == me);
        }
        else
        {
            query = query.Where(v => v.UserId == currentUser.RequireUserId());
        }

        if (filter.UserId.HasValue) query = query.Where(v => v.UserId == filter.UserId);

        var total = await query.CountAsync(ct);

        var rows = await query
            .OrderByDescending(v => v.WorkYear).ThenByDescending(v => v.WorkMonth).ThenBy(v => v.EmployeeName)
            .Skip((filter.Page - 1) * filter.PageSize).Take(filter.PageSize)
            .ToListAsync(ct);

        var items = rows.Select(v => new MonthlySummaryRowDto
        {
            UserId = v.UserId,
            EmployeeName = v.EmployeeName,
            EmployeeCode = v.EmployeeCode,
            WorkYear = v.WorkYear,
            WorkMonth = v.WorkMonth,
            MonthLabel = $"{CultureInfo.InvariantCulture.DateTimeFormat.GetAbbreviatedMonthName(v.WorkMonth)}-{v.WorkYear}",
            EntryCount = v.EntryCount,
            DaysLogged = v.DaysLogged,
            ProjectCount = v.ProjectCount,
            TotalHours = v.TotalHours,
            NoWorkDayCount = v.NoWorkDayCount,
            AvgHoursPerLoggedDay = v.AvgHoursPerLoggedDay ?? 0m
        }).ToList();

        return PagedResult<MonthlySummaryRowDto>.Create(items, total, filter.Page, filter.PageSize);
    }

    /* ------------------------------ MISSING DSR REPORT -------------------------------- */

    public async Task<IReadOnlyList<MissingDsrRowDto>> GetMissingDsrAsync(ReportFilter filter, CancellationToken ct = default)
    {
        var (from, to) = await ResolvePeriodAsync(filter, ct);

        /*  Clamp the upper bound to today. A DSR cannot be "missing" for a date that has not
            happened yet, but the working-day calendar in fn_GetMissingDsrDays happily generates
            future dates -- so a filter of 01-Aug to 31-Aug run on the 10th would report every
            remaining working day of the month as a compliance failure.                          */
        if (to > clock.TodayUtc) to = clock.TodayUtc;
        if (from > to) return [];

        int? managerScope = currentUser.IsAdmin
            ? filter.ManagerUserId
            : currentUser.IsManager ? currentUser.RequireUserId() : null;

        // Single wrapper, shared with the Admin reporting module. Department is not filtered here,
        // so it is passed as null -- but it MUST be passed: a table-valued function cannot be
        // called with fewer arguments than it declares.
        var query = detailReporting.GetMissingDsrDetail(from, to, managerScope, departmentId: null);

        if (!currentUser.IsAdmin && !currentUser.IsManager)
            query = query.Where(m => m.UserId == currentUser.RequireUserId());

        if (filter.UserId.HasValue) query = query.Where(m => m.UserId == filter.UserId);

        var raw = await query.ToListAsync(ct);

        return raw
            .GroupBy(m => new { m.UserId, m.EmployeeCode, m.EmployeeName })
            .Select(g => new MissingDsrRowDto
            {
                UserId = g.Key.UserId,
                EmployeeCode = g.Key.EmployeeCode,
                EmployeeName = g.Key.EmployeeName,
                MissingDayCount = g.Count(),
                MissingDates = g.Select(x => x.MissingDate).OrderBy(d => d).ToList()
            })
            .OrderByDescending(r => r.MissingDayCount)
            .ToList();
    }

    /* --------------------------------- DASHBOARDS ------------------------------------- */

    public async Task<EmployeeDashboardDto> GetEmployeeDashboardAsync(CancellationToken ct = default)
    {
        var userId = currentUser.RequireUserId();
        var today = clock.TodayUtc;
        var weekStart = today.AddDays(-(int)((today.DayOfWeek == DayOfWeek.Sunday ? 7 : (int)today.DayOfWeek) - 1));
        var monthStart = new DateOnly(today.Year, today.Month, 1);

        var entries = uow.DsrEntries.Query().Where(e => e.UserId == userId && e.IsActive);

        var standardHours = await uow.Users.Query().Where(u => u.Id == userId)
            .Select(u => u.StandardDailyHours).FirstOrDefaultAsync(ct);

        var monthAi = await uow.DailyAiUsages.Query()
            .Where(a => a.UserId == userId && a.IsActive && a.WorkDate >= monthStart && a.WorkDate <= today)
            .Select(a => a.IsAiUsed).ToListAsync(ct);

        var last14 = await GetDailySummaryAsync(new ReportFilter
        {
            UserId = userId, FromDate = today.AddDays(-13), ToDate = today, Page = 1, PageSize = 14
        }, ct);

        var topProjects = await GetProjectReportAsync(new ReportFilter
        {
            UserId = userId, FromDate = monthStart, ToDate = today, Page = 1, PageSize = 5
        }, ct);

        var missing = await GetMissingDsrAsync(new ReportFilter
        {
            UserId = userId, FromDate = monthStart, ToDate = today
        }, ct);

        return new EmployeeDashboardDto
        {
            TodayHours = await entries.Where(e => e.WorkDate == today).SumAsync(e => (decimal?)e.EstimatedHours, ct) ?? 0m,
            WeekHours = await entries.Where(e => e.WorkDate >= weekStart && e.WorkDate <= today).SumAsync(e => (decimal?)e.EstimatedHours, ct) ?? 0m,
            MonthHours = await entries.Where(e => e.WorkDate >= monthStart && e.WorkDate <= today).SumAsync(e => (decimal?)e.EstimatedHours, ct) ?? 0m,
            StandardDailyHours = standardHours,
            WeekDaysLogged = await entries.Where(e => e.WorkDate >= weekStart && e.WorkDate <= today).Select(e => e.WorkDate).Distinct().CountAsync(ct),
            MonthDaysLogged = await entries.Where(e => e.WorkDate >= monthStart && e.WorkDate <= today).Select(e => e.WorkDate).Distinct().CountAsync(ct),
            MissingDaysThisMonth = missing.FirstOrDefault()?.MissingDayCount ?? 0,
            MonthAiAdoptionPct = monthAi.Count == 0 ? 0 : Math.Round(monthAi.Count(x => x) * 100m / monthAi.Count, 2),
            HasSubmittedToday = await entries.AnyAsync(e => e.WorkDate == today, ct),
            Last14Days = last14.Items.ToList(),
            TopProjectsThisMonth = topProjects.Items.ToList()
        };
    }

    public async Task<ManagerDashboardDto> GetManagerDashboardAsync(ReportFilter filter, CancellationToken ct = default)
    {
        var today = clock.TodayUtc;
        var monthStart = new DateOnly(today.Year, today.Month, 1);
        filter.FromDate ??= monthStart;
        filter.ToDate ??= today;
        filter.PageSize = 100;

        var utilization = await GetResourceUtilizationAsync(filter, ct);
        var missing = await GetMissingDsrAsync(filter, ct);
        var projects = await GetProjectReportAsync(filter, ct);
        var ai = await GetAiUsageReportAsync(filter, ct);

        var managerId = currentUser.IsAdmin ? filter.ManagerUserId : currentUser.RequireUserId();
        var teamSize = await uow.Users.CountAsync(
            u => u.IsActive && !u.IsServiceAccount && (managerId == null || u.ManagerUserId == managerId), ct);

        return new ManagerDashboardDto
        {
            TeamSize = teamSize,
            TeamHoursThisMonth = utilization.Items.Sum(u => u.LoggedHours),
            TeamAvgUtilizationPct = utilization.Items.Count == 0 ? 0 : Math.Round(utilization.Items.Average(u => u.UtilizationPct), 2),
            TeamMissingDsrCount = missing.Sum(m => m.MissingDayCount),
            TeamAiAdoptionPct = ai.OverallAdoptionPct,
            ActiveProjectCount = projects.Items.Count,
            Utilization = utilization.Items.ToList(),
            MissingDsr = missing.ToList(),
            ProjectEffort = projects.Items.ToList(),
            AiTrend = ai.Trend
        };
    }

    public async Task<AdminDashboardDto> GetAdminDashboardAsync(CancellationToken ct = default)
    {
        if (!currentUser.IsAdmin) throw new ForbiddenException("The administration dashboard requires the Admin role.");

        var today = clock.TodayUtc;
        var monthStart = new DateOnly(today.Year, today.Month, 1);
        var filter = new ReportFilter { FromDate = monthStart, ToDate = today, Page = 1, PageSize = 10 };

        var monthEntries = uow.DsrEntries.Query().Where(e => e.IsActive && e.WorkDate >= monthStart && e.WorkDate <= today);
        var ai = await GetAiUsageReportAsync(filter, ct);
        var projects = await GetProjectReportAsync(filter, ct);
        var missing = await GetMissingDsrAsync(new ReportFilter { FromDate = monthStart, ToDate = today }, ct);

        return new AdminDashboardDto
        {
            TotalUsers = await uow.Users.CountAsync(u => !u.IsServiceAccount, ct),
            ActiveUsers = await uow.Users.CountAsync(u => u.IsActive && !u.IsServiceAccount, ct),
            TotalProjects = await uow.Projects.CountAsync(null, ct),
            ActiveProjects = await uow.Projects.CountAsync(p => p.IsActive && p.Status == ProjectStatuses.Active, ct),
            DsrEntriesThisMonth = await monthEntries.CountAsync(ct),
            HoursThisMonth = await monthEntries.SumAsync(e => (decimal?)e.EstimatedHours, ct) ?? 0m,
            OrgAiAdoptionPct = ai.OverallAdoptionPct,
            MissingDsrCountThisMonth = missing.Sum(m => m.MissingDayCount),
            AiTrend = ai.Trend,
            TopProjects = projects.Items.ToList()
        };
    }

    /* ----------------------------------- EXPORT --------------------------------------- */

    public async Task<(string FileName, string ContentType, byte[] Content)> ExportAsync(string reportKey, ReportFilter filter, CancellationToken ct = default)
    {
        filter.Page = 1;
        filter.PageSize = 5000;   // hard ceiling: an export is not a data dump

        var (headers, rows, name) = reportKey.ToLowerInvariant() switch
        {
            "employee" => BuildCsv(await GetEmployeeReportAsync(filter, ct),
                ["Employee Code", "Employee", "Manager", "Entries", "Days Logged", "Projects", "Total Hours", "Avg Hours/Day", "No-Work Days", "AI Days", "AI Adoption %"],
                r => [r.EmployeeCode, r.EmployeeName, r.ManagerName, r.EntryCount, r.DaysLogged, r.ProjectCount, r.TotalHours, r.AvgHoursPerLoggedDay, r.NoWorkDayCount, r.AiUsedDayCount, r.AiAdoptionPct],
                "EmployeeReport"),

            "project" => BuildCsv(await GetProjectReportAsync(filter, ct),
                ["Project Code", "Project", "Status", "Manager", "Entries", "Contributors", "Total Hours", "First Effort", "Last Effort", "Share %"],
                r => [r.ProjectCode, r.ProjectName, r.ProjectStatus, r.ProjectManagerName, r.EntryCount, r.ContributorCount, r.TotalHours, r.FirstEffortDate, r.LastEffortDate, r.SharePct],
                "ProjectReport"),

            "utilization" => BuildCsv(await GetResourceUtilizationAsync(filter, ct),
                ["Employee Code", "Employee", "Working Days", "Std Hours/Day", "Allocation %", "Capacity Hours", "Planned Hours", "Logged Hours", "Days Logged", "Utilization %", "RAG"],
                r => [r.EmployeeCode, r.EmployeeName, r.WorkingDaysInPeriod, r.StandardDailyHours, r.TotalAllocationPct, r.CapacityHours, r.PlannedHours, r.LoggedHours, r.DaysLogged, r.UtilizationPct, r.RagStatus],
                "ResourceUtilization"),

            "daily" => BuildCsv(await GetDailySummaryAsync(filter, ct),
                ["Employee", "Work Date", "Entries", "Projects", "Total Hours", "Std Hours", "Day Utilization %", "No Work"],
                r => [r.EmployeeName, r.WorkDate, r.EntryCount, r.ProjectCount, r.TotalHours, r.StandardDailyHours, r.DayUtilizationPct, r.HasNoWorkDeclaration],
                "DailySummary"),

            "monthly" => BuildCsv(await GetMonthlySummaryAsync(filter, ct),
                ["Employee Code", "Employee", "Month", "Entries", "Days Logged", "Projects", "Total Hours", "No-Work Days", "Avg Hours/Day"],
                r => [r.EmployeeCode, r.EmployeeName, r.MonthLabel, r.EntryCount, r.DaysLogged, r.ProjectCount, r.TotalHours, r.NoWorkDayCount, r.AvgHoursPerLoggedDay],
                "MonthlySummary"),

            "ai" => BuildAiCsv(await GetAiUsageReportAsync(filter, ct)),

            "missing" => BuildMissingCsv(await GetMissingDsrAsync(filter, ct)),

            _ => throw new ValidationAppException(nameof(reportKey),
                "Unknown report. Valid values: employee, project, utilization, daily, monthly, ai, missing.")
        };

        var sb = new StringBuilder();
        sb.AppendLine(string.Join(',', headers.Select(Escape)));
        foreach (var row in rows) sb.AppendLine(string.Join(',', row.Select(Escape)));

        // UTF-8 BOM so Excel opens non-ASCII names correctly
        var content = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
        return ($"{name}_{clock.TodayUtc:yyyyMMdd}.csv", "text/csv", content);
    }

    /* ------------------------------- private helpers ---------------------------------- */

    private static (string[] Headers, List<object?[]> Rows, string Name) BuildCsv<T>(
        PagedResult<T> result, string[] headers, Func<T, object?[]> selector, string name) =>
        (headers, result.Items.Select(selector).ToList(), name);

    private static (string[] Headers, List<object?[]> Rows, string Name) BuildAiCsv(AiUsageReportDto report) =>
        (["Employee", "Declared Days", "AI Days", "Adoption %", "Most Used Tool"],
         report.ByEmployee.Select(e => new object?[] { e.EmployeeName, e.DeclaredDayCount, e.AiUsedDayCount, e.AdoptionPct, e.MostUsedTool }).ToList(),
         "AiUsageReport");

    private static (string[] Headers, List<object?[]> Rows, string Name) BuildMissingCsv(IReadOnlyList<MissingDsrRowDto> rows) =>
        (["Employee Code", "Employee", "Missing Days", "Dates"],
         rows.Select(r => new object?[] { r.EmployeeCode, r.EmployeeName, r.MissingDayCount, string.Join("; ", r.MissingDates.Select(d => d.ToString("dd-MMM-yyyy"))) }).ToList(),
         "MissingDsrReport");

    private static string Escape(object? value)
    {
        var text = value switch
        {
            null => string.Empty,
            bool b => b ? "Yes" : "No",
            DateOnly d => d.ToString("dd-MMM-yyyy"),
            DateTime dt => dt.ToString("dd-MMM-yyyy HH:mm"),
            decimal dec => dec.ToString("0.##", CultureInfo.InvariantCulture),
            _ => value.ToString() ?? string.Empty
        };

        // Guard against CSV formula injection in spreadsheet applications
        if (text.Length > 0 && text[0] is '=' or '+' or '-' or '@') text = "'" + text;

        return text.Contains(',') || text.Contains('"') || text.Contains('\n')
            ? $"\"{text.Replace("\"", "\"\"")}\""
            : text;
    }

    private async Task<(DateOnly From, DateOnly To)> ResolvePeriodAsync(ReportFilter filter, CancellationToken ct)
    {
        var defaultDays = await settings.GetIntAsync(SettingKeys.ReportDefaultPeriodDays, 30, ct);
        return filter.ResolvePeriod(clock.TodayUtc, defaultDays);
    }

    /// <summary>Applies row-level data scope to the reporting spine before any client filter.</summary>
    private IQueryable<Domain.Entities.DsrEntryDetailView> ApplyScope(IQueryable<Domain.Entities.DsrEntryDetailView> query)
    {
        if (currentUser.IsAdmin) return query;

        var me = currentUser.RequireUserId();
        return currentUser.IsManager
            ? query.Where(v => v.ManagerUserId == me || v.UserId == me)
            : query.Where(v => v.UserId == me);
    }

    private IQueryable<Domain.Entities.DailyAiUsage> ApplyScopeToAi(IQueryable<Domain.Entities.DailyAiUsage> query)
    {
        if (currentUser.IsAdmin) return query;

        var me = currentUser.RequireUserId();
        return currentUser.IsManager
            ? query.Where(a => a.User.ManagerUserId == me || a.UserId == me)
            : query.Where(a => a.UserId == me);
    }
}
