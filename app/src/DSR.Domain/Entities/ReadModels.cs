namespace DSR.Domain.Entities;

/*  Keyless read models mapped to the database views and table-valued functions.
    Reporting logic stays in SQL so the six reports cannot drift apart, and EF Core projects
    directly onto these types -- no client-side aggregation over large result sets.            */

/// <summary>dsr.vw_DsrEntryDetail -- flat reporting spine (entry + employee + project + day AI).</summary>
public class DsrEntryDetailView
{
    public int DsrEntryId { get; set; }
    public DateOnly WorkDate { get; set; }
    public int WorkYear { get; set; }
    public int WorkMonth { get; set; }
    public int WorkIsoWeek { get; set; }
    public int UserId { get; set; }
    public string? EmployeeCode { get; set; }
    public string EmployeeName { get; set; } = null!;
    public string EmployeeEmail { get; set; } = null!;
    public int? ManagerUserId { get; set; }
    public string? ManagerName { get; set; }
    public decimal StandardDailyHours { get; set; }
    public int? ProjectId { get; set; }
    public string? ProjectCode { get; set; }
    public string? ProjectName { get; set; }
    public string? ProjectStatus { get; set; }
    public decimal EstimatedHours { get; set; }
    public bool IsNoWorkDone { get; set; }
    public string? WorkDescriptionPlain { get; set; }
    public bool? IsAiUsed { get; set; }
    public int? AiToolId { get; set; }
    public string? AiToolName { get; set; }
    public string? AiUsageRemarks { get; set; }
    public DateTime CreatedDate { get; set; }
    public DateTime? ModifiedDate { get; set; }
}

/// <summary>dsr.vw_DsrDailySummary -- Daily Summary Report.</summary>
public class DsrDailySummaryView
{
    public int UserId { get; set; }
    public string EmployeeName { get; set; } = null!;
    public int? ManagerUserId { get; set; }
    public DateOnly WorkDate { get; set; }
    public int EntryCount { get; set; }
    public int ProjectCount { get; set; }
    public decimal TotalHours { get; set; }
    public decimal StandardDailyHours { get; set; }
    public decimal DayUtilizationPct { get; set; }
    public int HasNoWorkDeclaration { get; set; }
}

/// <summary>dsr.vw_DsrMonthlySummary -- Monthly Summary Report.</summary>
public class DsrMonthlySummaryView
{
    public int UserId { get; set; }
    public string EmployeeName { get; set; } = null!;
    public string? EmployeeCode { get; set; }
    public int? ManagerUserId { get; set; }
    public int WorkYear { get; set; }
    public int WorkMonth { get; set; }
    public int EntryCount { get; set; }
    public int DaysLogged { get; set; }
    public int ProjectCount { get; set; }
    public decimal TotalHours { get; set; }
    public int NoWorkDayCount { get; set; }
    public decimal StandardDailyHours { get; set; }
    public decimal? AvgHoursPerLoggedDay { get; set; }
}

/// <summary>dsr.vw_ProjectEffortSummary -- Project Report.</summary>
public class ProjectEffortSummaryView
{
    public int ProjectId { get; set; }
    public string ProjectCode { get; set; } = null!;
    public string ProjectName { get; set; } = null!;
    public string ProjectStatus { get; set; } = null!;
    public DateOnly StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public int? ProjectManagerUserId { get; set; }
    public int EntryCount { get; set; }
    public int ContributorCount { get; set; }
    public decimal TotalHours { get; set; }
    public DateOnly? FirstEffortDate { get; set; }
    public DateOnly? LastEffortDate { get; set; }
}

/// <summary>dsr.vw_AiAdoptionDaily -- AI Usage Report.</summary>
public class AiAdoptionDailyView
{
    public DateOnly WorkDate { get; set; }
    public int DeclarationCount { get; set; }
    public int AiUsedCount { get; set; }
    public decimal? AiAdoptionPct { get; set; }
    public int DistinctToolsUsed { get; set; }
}

/// <summary>dsr.fn_GetResourceUtilization -- Resource Utilization Report.</summary>
public class ResourceUtilizationView
{
    public int UserId { get; set; }
    public string? EmployeeCode { get; set; }
    public string EmployeeName { get; set; } = null!;
    public int? ManagerUserId { get; set; }
    public int WorkingDaysInPeriod { get; set; }
    public decimal StandardDailyHours { get; set; }
    public decimal TotalAllocationPct { get; set; }
    public decimal CapacityHours { get; set; }
    public decimal PlannedHours { get; set; }
    public decimal LoggedHours { get; set; }
    public int DaysLogged { get; set; }
    public decimal? UtilizationPct { get; set; }
}

/// <summary>
/// dsr.vw_DsrDetailReport -- the Admin detail report spine. Every field the reporting requirement
/// asks for on one row: employee, department, manager, project, task, hours and approval workflow.
/// </summary>
public class DsrDetailReportView
{
    // DSR
    public int DsrEntryId { get; set; }
    public DateOnly WorkDate { get; set; }
    public DateTime? SubmittedOn { get; set; }
    public string StatusCode { get; set; } = null!;
    public string ApprovalStatus { get; set; } = null!;
    public int? ApprovedByUserId { get; set; }
    public string? ApprovedByName { get; set; }
    public DateTime? ApprovalDate { get; set; }
    public string? ReviewComments { get; set; }
    public bool IsNoWorkDone { get; set; }

    // Employee
    public int UserId { get; set; }
    public string? EmployeeCode { get; set; }
    public string EmployeeName { get; set; } = null!;
    public string EmployeeEmail { get; set; } = null!;
    public string? Designation { get; set; }
    public int? DepartmentId { get; set; }
    public string? DepartmentName { get; set; }
    public string? DepartmentCode { get; set; }
    public int? ManagerUserId { get; set; }
    public string? ManagerName { get; set; }
    public string? ManagerEmail { get; set; }
    public decimal StandardDailyHours { get; set; }

    // Project
    public int? ProjectId { get; set; }
    public string? ProjectCode { get; set; }
    public string? ProjectName { get; set; }
    public DateOnly? ProjectStartDate { get; set; }
    public DateOnly? ProjectEndDate { get; set; }
    public string? ProjectStatus { get; set; }
    public string? ProjectManagerName { get; set; }

    // Task
    public string? TaskDescription { get; set; }
    public string? TaskDescriptionHtml { get; set; }
    public int? WorkCategoryId { get; set; }
    public string? WorkCategoryName { get; set; }
    public decimal EstimatedHours { get; set; }
    public decimal HoursLogged { get; set; }
    public decimal? ActualHours { get; set; }
    public decimal RemainingHours { get; set; }
    public DateTime TaskEntryDate { get; set; }
    public DateTime? ModifiedDate { get; set; }

    // AI (day grain)
    public bool? IsAiUsed { get; set; }
    public string? AiToolName { get; set; }
}

/// <summary>dsr.fn_GetMissingDsrDays -- now carries manager and department for the Missing DSR report.</summary>
public class MissingDsrDetailView
{
    public int UserId { get; set; }
    public string? EmployeeCode { get; set; }
    public string EmployeeName { get; set; } = null!;
    public string EmployeeEmail { get; set; } = null!;
    public string? Designation { get; set; }
    public int? ManagerUserId { get; set; }
    public string? ManagerName { get; set; }
    public int? DepartmentId { get; set; }
    public string? DepartmentName { get; set; }
    public DateOnly MissingDate { get; set; }
}
