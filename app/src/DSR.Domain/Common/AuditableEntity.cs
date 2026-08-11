namespace DSR.Domain.Common;

/// <summary>
/// The five audit columns present on every table in the DSRResourceManagement schema.
/// Populated centrally by DsrDbContext.SaveChangesAsync from the current request principal,
/// never by callers, so attribution cannot be forgotten or spoofed by a service.
/// </summary>
public abstract class AuditableEntity
{
    public int CreatedByUserId { get; set; }
    public DateTime CreatedDate { get; set; }
    public int? ModifiedByUserId { get; set; }
    public DateTime? ModifiedDate { get; set; }

    /// <summary>Soft-delete flag. No row is ever physically removed; every query filters on this.</summary>
    public bool IsActive { get; set; } = true;
}
