using DSR.Application.Common;

namespace DSR.Application.DTOs;

/// <summary>
/// Advanced filter for the Admin DSR Detail report. Every field the requirement lists is here.
/// All properties are optional; an unset property means "no restriction".
/// </summary>
public class DsrDetailReportFilter : PagedRequest
{
    // Who
    public int? UserId { get; set; }
    public string? EmployeeName { get; set; }
    public string? EmployeeCode { get; set; }
    public int? DepartmentId { get; set; }
    public int? ManagerUserId { get; set; }

    // What
    public int? ProjectId { get; set; }
    public int? WorkCategoryId { get; set; }

    // When -- DSR work date
    public DateOnly? FromDate { get; set; }
    public DateOnly? ToDate { get; set; }

    // When -- submission timestamp (distinct from the work date it describes)
    public DateOnly? SubmittedFromDate { get; set; }
    public DateOnly? SubmittedToDate { get; set; }

    // State
    public string? StatusCode { get; set; }
    public string? ApprovalStatus { get; set; }
    public bool? IsNoWorkDone { get; set; }
    public bool? IsAiUsed { get; set; }

    // Effort band
    public decimal? MinHours { get; set; }
    public decimal? MaxHours { get; set; }

    /// <summary>Free text across employee name, code, email, project name and task description.</summary>
    public string? Search { get; set; }
}

/// <summary>One fully-expanded DSR row. Field order mirrors the requirement's grouping.</summary>
public class DsrDetailReportRowDto
{
    // Employee
    public int UserId { get; set; }
    public string EmployeeName { get; set; } = null!;
    public string? EmployeeCode { get; set; }
    public string EmployeeEmail { get; set; } = null!;
    public string? DepartmentName { get; set; }
    public string? Designation { get; set; }
    public string? ManagerName { get; set; }

    // Project
    public int? ProjectId { get; set; }
    public string? ProjectName { get; set; }
    public string? ProjectCode { get; set; }
    public DateOnly? ProjectStartDate { get; set; }
    public DateOnly? ProjectEndDate { get; set; }
    public string? ProjectStatus { get; set; }

    // Task
    public int DsrEntryId { get; set; }
    public string? TaskDescription { get; set; }
    public string? WorkCategoryName { get; set; }
    public decimal HoursLogged { get; set; }
    public decimal EstimatedHours { get; set; }
    public decimal RemainingHours { get; set; }
    public DateTime TaskEntryDate { get; set; }

    // DSR
    public DateOnly DsrDate { get; set; }
    public DateTime? SubmissionDate { get; set; }
    public string StatusCode { get; set; } = null!;
    public string ApprovalStatus { get; set; } = null!;
    public string? ApprovedBy { get; set; }
    public DateTime? ApprovalDate { get; set; }
    public string? ReviewComments { get; set; }
    public bool IsNoWorkDone { get; set; }

    public bool? IsAiUsed { get; set; }
    public string? AiToolName { get; set; }
}

/// <summary>Totals for the filtered set. Computed over the WHOLE result, not the current page.</summary>
public class DsrDetailReportSummaryDto
{
    public int TotalEntries { get; set; }
    public int EmployeeCount { get; set; }
    public int ProjectCount { get; set; }
    public int DepartmentCount { get; set; }
    public int DistinctDays { get; set; }
    public decimal TotalHoursLogged { get; set; }
    public decimal TotalEstimatedHours { get; set; }
    public decimal TotalRemainingHours { get; set; }
    public decimal AverageHoursPerEntry { get; set; }
    public int NoWorkDoneCount { get; set; }
    public int PendingApprovalCount { get; set; }
    public int ApprovedCount { get; set; }
    public int ReturnedCount { get; set; }
    public decimal AiAdoptionPct { get; set; }
}

/// <summary>Paged rows plus whole-set totals, so the grid footer never lies about the page.</summary>
public class DsrDetailReportDto
{
    public PagedResult<DsrDetailReportRowDto> Rows { get; set; } = new();
    public DsrDetailReportSummaryDto Summary { get; set; } = new();
}

/* ------------------------------- GROUPED ROLL-UPS ------------------------------- */

/// <summary>One shape for employee-wise, project-wise, department-wise and manager-wise reports.</summary>
public class GroupedReportRowDto
{
    public int? GroupId { get; set; }
    public string GroupName { get; set; } = null!;
    public string? GroupSubtitle { get; set; }
    public int EntryCount { get; set; }
    public int EmployeeCount { get; set; }
    public int ProjectCount { get; set; }
    public int DaysLogged { get; set; }
    public decimal TotalHoursLogged { get; set; }
    public decimal TotalEstimatedHours { get; set; }
    public decimal AverageHoursPerDay { get; set; }
    public int NoWorkDoneCount { get; set; }
    public int PendingApprovalCount { get; set; }
    public int ApprovedCount { get; set; }
    public int ReturnedCount { get; set; }
    public decimal SharePct { get; set; }
}

/// <summary>Approval status roll-up.</summary>
public class ApprovalStatusReportRowDto
{
    public string ApprovalStatus { get; set; } = null!;
    public string StatusCode { get; set; } = null!;
    public int EntryCount { get; set; }
    public int EmployeeCount { get; set; }
    public decimal TotalHours { get; set; }
    public decimal SharePct { get; set; }
    public int OldestAgeDays { get; set; }
}

/// <summary>Missing DSR, now carrying manager and department as required.</summary>
public class MissingDsrDetailRowDto
{
    public int UserId { get; set; }
    public string EmployeeName { get; set; } = null!;
    public string? EmployeeCode { get; set; }
    public string EmployeeEmail { get; set; } = null!;
    public string? Designation { get; set; }
    public string? ManagerName { get; set; }
    public string? DepartmentName { get; set; }
    public int MissingDayCount { get; set; }
    public List<DateOnly> MissingDates { get; set; } = [];
    public DateOnly? MostRecentMissingDate { get; set; }
}

// Approval workflow disabled as per current business requirement.
// All DSR entries are treated as automatically approved.
//
// This was the request body for POST /api/admin-reports/review. It had no FluentValidation
// validator -- ReviewAsync validated inline -- so nothing else references it.
/*
/// <summary>Approve or return one or more DSR entries.</summary>
public class ReviewDsrEntriesRequest
{
    public List<int> DsrEntryIds { get; set; } = [];

    /// <summary>APPROVED or RETURNED.</summary>
    public string StatusCode { get; set; } = null!;

    /// <summary>Mandatory when returning; the employee needs to know why.</summary>
    public string? Comments { get; set; }
}
*/

public record DepartmentDto(int Id, string DepartmentCode, string DepartmentName, string? HeadName, int EmployeeCount, bool IsActive);

public record WorkCategoryDto(int Id, string CategoryCode, string CategoryName, short SortOrder, bool IsActive);
