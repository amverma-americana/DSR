using DSR.Domain.Common;

namespace DSR.Domain.Entities;

/// <summary>dsr.Projects.</summary>
public class Project : AuditableEntity
{
    public int Id { get; set; }
    public string ProjectCode { get; set; } = null!;
    public string ProjectName { get; set; } = null!;
    public string? Description { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public string Status { get; set; } = ProjectStatuses.Planned;
    public int? ProjectManagerUserId { get; set; }

    public User? ProjectManager { get; set; }
    public ICollection<DsrEntry> DsrEntries { get; set; } = [];
    public ICollection<ProjectAllocation> Allocations { get; set; } = [];

    /// <summary>
    /// Mirrors trg_DSREntries_ProjectWindow so the API can reject with a friendly message before
    /// the database raises error 51003. Keep the two in step.
    /// </summary>
    public bool AcceptsEffortOn(DateOnly workDate) =>
        IsActive
        && ProjectStatuses.OpenForEffort.Contains(Status)
        && workDate >= StartDate
        && (EndDate is null || workDate <= EndDate.Value);
}

/// <summary>dsr.ProjectAllocations -- planned capacity; the denominator of resource utilization.</summary>
public class ProjectAllocation : AuditableEntity
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public int UserId { get; set; }
    public decimal AllocationPercentage { get; set; } = 100.00m;
    public DateOnly AllocationStartDate { get; set; }
    public DateOnly? AllocationEndDate { get; set; }
    public string? ProjectRole { get; set; }

    public Project Project { get; set; } = null!;
    public User User { get; set; } = null!;

    public bool OverlapsPeriod(DateOnly from, DateOnly to) =>
        AllocationStartDate <= to && (AllocationEndDate is null || AllocationEndDate.Value >= from);
}

/// <summary>dsr.AiTools -- normalised tool master so AI adoption metrics aggregate correctly.</summary>
public class AiTool : AuditableEntity
{
    public int Id { get; set; }
    public string ToolName { get; set; } = null!;
    public string? Vendor { get; set; }
    public string? Category { get; set; }

    public ICollection<DailyAiUsage> DailyAiUsages { get; set; } = [];
}

/// <summary>dsr.Holidays -- working-day calendar behind the Missing DSR report.</summary>
public class Holiday : AuditableEntity
{
    public int Id { get; set; }
    public DateOnly HolidayDate { get; set; }
    public string HolidayName { get; set; } = null!;
    public bool IsOptional { get; set; }
}

/// <summary>dsr.AppSettings -- operational rules tunable without a release.</summary>
public class AppSetting : AuditableEntity
{
    public int Id { get; set; }
    public string SettingKey { get; set; } = null!;
    public string SettingValue { get; set; } = null!;
    public string DataType { get; set; } = "STRING";
    public string? Description { get; set; }
    public bool IsEditable { get; set; } = true;
}

/// <summary>dsr.Departments -- required by department-wise reporting.</summary>
public class Department : AuditableEntity
{
    public int Id { get; set; }
    public string DepartmentCode { get; set; } = null!;
    public string DepartmentName { get; set; } = null!;
    public int? HeadUserId { get; set; }

    public User? Head { get; set; }
    public ICollection<User> Members { get; set; } = [];
}

/// <summary>dsr.WorkCategories -- the "Work Category (if applicable)" reporting dimension.</summary>
public class WorkCategory : AuditableEntity
{
    public int Id { get; set; }
    public string CategoryCode { get; set; } = null!;
    public string CategoryName { get; set; } = null!;
    public short SortOrder { get; set; }

    public ICollection<DsrEntry> DsrEntries { get; set; } = [];
}
