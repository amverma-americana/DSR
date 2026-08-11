using DSR.Application.Common;

namespace DSR.Application.DTOs;

/*  DSR ENTRY -- the core screen.
    One request = one saved entry for exactly one project. The employee presses Save three times
    for three projects, producing three independent rows; there is no header object here by design. */

/// <summary>Create request for a single DSR entry.</summary>
public class CreateDsrEntryRequest
{
    public DateOnly WorkDate { get; set; }

    /// <summary>Required unless IsNoWorkDone. Validated by CreateDsrEntryRequestValidator.</summary>
    public int? ProjectId { get; set; }

    public decimal EstimatedHours { get; set; }
    public bool IsNoWorkDone { get; set; }
    public string? WorkDescriptionHtml { get; set; }

    /*  The day-level AI declaration travels with the entry because the UI captures it on the same
        form. The service upserts dsr.DailyAiUsage for (UserId, WorkDate) -- it does not create a
        row per DSR entry, so a second save on the same date updates the one declaration.        */

    /// <summary>Mandatory: the BRD makes the AI answer compulsory. Nullable only to detect omission.</summary>
    public bool? IsAiUsed { get; set; }

    /// <summary>Required iff IsAiUsed is true; must be null otherwise.</summary>
    public int? AiToolId { get; set; }

    public string? AiUsageRemarks { get; set; }

    /// <summary>Admin/Manager only. When null the entry is filed for the caller.</summary>
    public int? OnBehalfOfUserId { get; set; }
}

/// <summary>Update request. WorkDate and UserId are immutable -- change those by deleting and re-creating.</summary>
public class UpdateDsrEntryRequest
{
    public int? ProjectId { get; set; }
    public decimal EstimatedHours { get; set; }
    public bool IsNoWorkDone { get; set; }
    public string? WorkDescriptionHtml { get; set; }
    public bool? IsAiUsed { get; set; }
    public int? AiToolId { get; set; }
    public string? AiUsageRemarks { get; set; }
}

/// <summary>A single DSR entry as returned to the client.</summary>
public class DsrEntryDto
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string EmployeeName { get; set; } = null!;
    public string? EmployeeCode { get; set; }
    public DateOnly WorkDate { get; set; }
    public int? ProjectId { get; set; }
    public string? ProjectCode { get; set; }
    public string? ProjectName { get; set; }
    public decimal EstimatedHours { get; set; }
    public bool IsNoWorkDone { get; set; }
    public string? WorkDescriptionHtml { get; set; }
    public string? WorkDescriptionPlain { get; set; }
    public bool? IsAiUsed { get; set; }
    public int? AiToolId { get; set; }
    public string? AiToolName { get; set; }
    public string? AiUsageRemarks { get; set; }
    public DateTime CreatedDate { get; set; }
    public DateTime? ModifiedDate { get; set; }
    public bool IsEditable { get; set; }
}

/// <summary>
/// All entries for one employee on one date, plus that day's totals and single AI declaration.
/// This is what the DSR screen loads when the user picks a work date: it shows the running total
/// so they can see 4 + 2 + 2 reaching a full day.
/// </summary>
public class DsrDayDto
{
    public DateOnly WorkDate { get; set; }
    public int UserId { get; set; }
    public string EmployeeName { get; set; } = null!;
    public List<DsrEntryDto> Entries { get; set; } = [];
    public decimal TotalHours { get; set; }
    public decimal StandardDailyHours { get; set; }
    public decimal MaxDailyHours { get; set; }
    public decimal RemainingHours => Math.Max(0, MaxDailyHours - TotalHours);
    public bool HasNoWorkDeclaration { get; set; }
    public bool? IsAiUsed { get; set; }
    public int? AiToolId { get; set; }
    public string? AiToolName { get; set; }
    public string? AiUsageRemarks { get; set; }

    /// <summary>Projects already logged on this date -- the UI removes them from the dropdown.</summary>
    public List<int> UsedProjectIds { get; set; } = [];
}

/// <summary>Filter for DSR history and the admin "all entries" grid.</summary>
public class DsrEntryFilter : PagedRequest
{
    public int? UserId { get; set; }
    public int? ProjectId { get; set; }
    public DateOnly? FromDate { get; set; }
    public DateOnly? ToDate { get; set; }
    public bool? IsAiUsed { get; set; }
    public bool? IsNoWorkDone { get; set; }

    /// <summary>Free-text search over WorkDescriptionPlain, employee name and project name.</summary>
    public string? Search { get; set; }

    /// <summary>Manager scope: restrict to this manager's direct reports.</summary>
    public int? ManagerUserId { get; set; }
}
