using DSR.Domain.Common;

namespace DSR.Domain.Entities;

/// <summary>
/// dsr.DSREntries -- THE FLAT DSR GRAIN. One row = one employee + one work date + one project.
/// There is deliberately no header/detail pair: an employee working three projects on one date
/// saves three independent rows, each a complete DSR entry in its own right.
/// </summary>
public class DsrEntry : AuditableEntity
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public DateOnly WorkDate { get; set; }

    /// <summary>Null ONLY when IsNoWorkDone is true. Mirrors CK_DSREntries_ProjectRequired.</summary>
    public int? ProjectId { get; set; }

    public decimal EstimatedHours { get; set; }
    public bool IsNoWorkDone { get; set; }

    /// <summary>Rich text as authored. Sanitised server-side before persisting (risk S3).</summary>
    public string? WorkDescriptionHtml { get; set; }

    /// <summary>Tag-stripped copy used for search and CSV export.</summary>
    public string? WorkDescriptionPlain { get; set; }

    /// <summary>DRAFT | SUBMITTED | APPROVED | RETURNED. Mirrors CK_DSREntries_StatusCode.</summary>
    public string StatusCode { get; set; } = "SUBMITTED";

    public DateTime? SubmittedOn { get; set; }
    public int? ApprovedByUserId { get; set; }
    public DateTime? ApprovalDate { get; set; }

    /// <summary>Required when RETURNED; the employee needs to know why.</summary>
    public string? ReviewComments { get; set; }

    /// <summary>Hours actually logged, distinct from the estimate. Null means not separately captured.</summary>
    public decimal? ActualHours { get; set; }

    public int? WorkCategoryId { get; set; }

    /// <summary>Computed in SQL as EstimatedHours - ISNULL(ActualHours, 0). Never assigned.</summary>
    public decimal RemainingHours { get; private set; }

    public User User { get; set; } = null!;
    public Project? Project { get; set; }
    public User? ApprovedByUser { get; set; }
    public WorkCategory? WorkCategory { get; set; }
}

/// <summary>
/// dsr.DailyAiUsage -- one AI declaration per employee per DAY (unique on UserId + WorkDate).
/// Deliberately NOT a child of DsrEntry: it is a sibling fact at day grain, joined on
/// (UserId, WorkDate) for reporting. This is what stops the Project A row from claiming
/// "AI = Yes" while the Project B row for the same day claims "No".
/// </summary>
public class DailyAiUsage : AuditableEntity
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public DateOnly WorkDate { get; set; }
    public bool IsAiUsed { get; set; }

    /// <summary>Required iff IsAiUsed; must be null otherwise. Mirrors CK_DailyAiUsage_ToolMatchesFlag.</summary>
    public int? AiToolId { get; set; }

    public string? UsageRemarks { get; set; }

    public User User { get; set; } = null!;
    public AiTool? AiTool { get; set; }
}

/// <summary>
/// dsr.AuditLog -- append-only field-level change history with JSON before/after payloads.
/// Not an AuditableEntity: it IS the audit, and its base table is trigger-protected against
/// UPDATE and DELETE, so it has no Modified columns to populate.
/// </summary>
public class AuditLog
{
    public long Id { get; set; }
    public string EntityName { get; set; } = null!;
    public int EntityId { get; set; }
    public string ActionType { get; set; } = null!;
    public string? OldValues { get; set; }
    public string? NewValues { get; set; }
    public int ChangedByUserId { get; set; }
    public DateTime ChangedDate { get; set; }
    public string? IpAddress { get; set; }

    public int CreatedByUserId { get; set; }
    public DateTime CreatedDate { get; set; }
    public bool IsActive { get; set; } = true;

    public User ChangedByUser { get; set; } = null!;
}
