using DSR.Application.Common;

namespace DSR.Application.DTOs;

/// <summary>
/// Shared filter for all six reports. Applying one filter shape everywhere means the React
/// filter bar is a single reusable component and the API surface stays predictable.
/// </summary>
public class ReportFilter : PagedRequest
{
    public int? UserId { get; set; }
    public int? ProjectId { get; set; }
    public DateOnly? FromDate { get; set; }
    public DateOnly? ToDate { get; set; }

    /// <summary>Tri-state: null = all, true = AI used, false = AI not used.</summary>
    public bool? IsAiUsed { get; set; }

    public int? AiToolId { get; set; }

    /// <summary>Restrict to one manager's direct reports. Forced to the caller for the Manager role.</summary>
    public int? ManagerUserId { get; set; }

    public string? ProjectStatus { get; set; }

    /// <summary>Resolves the effective window, defaulting to the configured report period.</summary>
    public (DateOnly From, DateOnly To) ResolvePeriod(DateOnly today, int defaultDays)
    {
        var to = ToDate ?? today;
        var from = FromDate ?? to.AddDays(-Math.Abs(defaultDays));
        return from > to ? (to, from) : (from, to);
    }
}

/* 1. EMPLOYEE REPORT -- effort per employee over the period, with AI adoption. */
public class EmployeeReportRowDto
{
    public int UserId { get; set; }
    public string? EmployeeCode { get; set; }
    public string EmployeeName { get; set; } = null!;
    public string? ManagerName { get; set; }
    public int EntryCount { get; set; }
    public int DaysLogged { get; set; }
    public int ProjectCount { get; set; }
    public decimal TotalHours { get; set; }
    public decimal AvgHoursPerLoggedDay { get; set; }
    public int NoWorkDayCount { get; set; }
    public int AiUsedDayCount { get; set; }
    public decimal AiAdoptionPct { get; set; }
}

/* 2. PROJECT REPORT -- effort per project, with contributor breakdown. */
public class ProjectReportRowDto
{
    public int ProjectId { get; set; }
    public string ProjectCode { get; set; } = null!;
    public string ProjectName { get; set; } = null!;
    public string ProjectStatus { get; set; } = null!;
    public string? ProjectManagerName { get; set; }
    public int EntryCount { get; set; }
    public int ContributorCount { get; set; }
    public decimal TotalHours { get; set; }
    public DateOnly? FirstEffortDate { get; set; }
    public DateOnly? LastEffortDate { get; set; }
    public decimal SharePct { get; set; }
}

/* 3. RESOURCE UTILIZATION REPORT -- logged vs capacity vs planned. */
public class ResourceUtilizationRowDto
{
    public int UserId { get; set; }
    public string? EmployeeCode { get; set; }
    public string EmployeeName { get; set; } = null!;
    public int WorkingDaysInPeriod { get; set; }
    public decimal StandardDailyHours { get; set; }
    public decimal TotalAllocationPct { get; set; }
    public decimal CapacityHours { get; set; }
    public decimal PlannedHours { get; set; }
    public decimal LoggedHours { get; set; }
    public int DaysLogged { get; set; }
    public decimal UtilizationPct { get; set; }

    /// <summary>GREEN / AMBER / RED against Utilization.TargetPct, computed server-side so all clients agree.</summary>
    public string RagStatus { get; set; } = "RED";
}

/* 4. AI USAGE REPORT -- adoption trend plus per-tool breakdown. */
public class AiUsageReportDto
{
    public int TotalDeclarations { get; set; }
    public int AiUsedDeclarations { get; set; }
    public decimal OverallAdoptionPct { get; set; }
    public List<AiUsageTrendPointDto> Trend { get; set; } = [];
    public List<AiToolUsageDto> ByTool { get; set; } = [];
    public List<AiUsageByEmployeeDto> ByEmployee { get; set; } = [];
}

public class AiUsageTrendPointDto
{
    public DateOnly WorkDate { get; set; }
    public int DeclarationCount { get; set; }
    public int AiUsedCount { get; set; }
    public decimal AdoptionPct { get; set; }
}

public class AiToolUsageDto
{
    public int? AiToolId { get; set; }
    public string ToolName { get; set; } = null!;
    public string? Vendor { get; set; }
    public int UsageDayCount { get; set; }
    public int DistinctUserCount { get; set; }
    public decimal SharePct { get; set; }
}

public class AiUsageByEmployeeDto
{
    public int UserId { get; set; }
    public string EmployeeName { get; set; } = null!;
    public int DeclaredDayCount { get; set; }
    public int AiUsedDayCount { get; set; }
    public decimal AdoptionPct { get; set; }
    public string? MostUsedTool { get; set; }
}

/* 5. DAILY SUMMARY REPORT */
public class DailySummaryRowDto
{
    public int UserId { get; set; }
    public string EmployeeName { get; set; } = null!;
    public DateOnly WorkDate { get; set; }
    public int EntryCount { get; set; }
    public int ProjectCount { get; set; }
    public decimal TotalHours { get; set; }
    public decimal StandardDailyHours { get; set; }
    public decimal DayUtilizationPct { get; set; }
    public bool HasNoWorkDeclaration { get; set; }
}

/* 6. MONTHLY SUMMARY REPORT */
public class MonthlySummaryRowDto
{
    public int UserId { get; set; }
    public string EmployeeName { get; set; } = null!;
    public string? EmployeeCode { get; set; }
    public int WorkYear { get; set; }
    public int WorkMonth { get; set; }
    public string MonthLabel { get; set; } = null!;
    public int EntryCount { get; set; }
    public int DaysLogged { get; set; }
    public int ProjectCount { get; set; }
    public decimal TotalHours { get; set; }
    public int NoWorkDayCount { get; set; }
    public decimal AvgHoursPerLoggedDay { get; set; }
}

/* MISSING DSR REPORT -- manager compliance view. */
public class MissingDsrRowDto
{
    public int UserId { get; set; }
    public string? EmployeeCode { get; set; }
    public string EmployeeName { get; set; } = null!;
    public int MissingDayCount { get; set; }
    public List<DateOnly> MissingDates { get; set; } = [];
}

/* DASHBOARDS */

public class EmployeeDashboardDto
{
    public decimal TodayHours { get; set; }
    public decimal WeekHours { get; set; }
    public decimal MonthHours { get; set; }
    public decimal StandardDailyHours { get; set; }
    public int WeekDaysLogged { get; set; }
    public int MonthDaysLogged { get; set; }
    public int MissingDaysThisMonth { get; set; }
    public decimal MonthAiAdoptionPct { get; set; }
    public bool HasSubmittedToday { get; set; }
    public List<DailySummaryRowDto> Last14Days { get; set; } = [];
    public List<ProjectReportRowDto> TopProjectsThisMonth { get; set; } = [];
}

public class ManagerDashboardDto
{
    public int TeamSize { get; set; }
    public decimal TeamHoursThisMonth { get; set; }
    public decimal TeamAvgUtilizationPct { get; set; }
    public int TeamMissingDsrCount { get; set; }
    public decimal TeamAiAdoptionPct { get; set; }
    public int ActiveProjectCount { get; set; }
    public List<ResourceUtilizationRowDto> Utilization { get; set; } = [];
    public List<MissingDsrRowDto> MissingDsr { get; set; } = [];
    public List<ProjectReportRowDto> ProjectEffort { get; set; } = [];
    public List<AiUsageTrendPointDto> AiTrend { get; set; } = [];
}

public class AdminDashboardDto
{
    public int TotalUsers { get; set; }
    public int ActiveUsers { get; set; }
    public int TotalProjects { get; set; }
    public int ActiveProjects { get; set; }
    public int DsrEntriesThisMonth { get; set; }
    public decimal HoursThisMonth { get; set; }
    public decimal OrgAiAdoptionPct { get; set; }
    public int MissingDsrCountThisMonth { get; set; }
    public List<AiUsageTrendPointDto> AiTrend { get; set; } = [];
    public List<ProjectReportRowDto> TopProjects { get; set; } = [];
}
