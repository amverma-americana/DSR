using DSR.Domain.Common;

namespace DSR.Application.Common;

/// <summary>
/// The authenticated caller, resolved from the JWT by the API layer. Injected into services so
/// authorisation and audit attribution never depend on a caller-supplied user id -- the single
/// most common source of horizontal privilege escalation (risk S4).
/// </summary>
public interface ICurrentUser
{
    int? UserId { get; }
    string? Email { get; }
    IReadOnlyCollection<string> Roles { get; }
    string? IpAddress { get; }
    bool IsAuthenticated { get; }

    bool IsInRole(string roleCode);
    bool IsAdmin => IsInRole(RoleCodes.Admin);
    bool IsManager => IsInRole(RoleCodes.Manager);

    /// <summary>Throws if unauthenticated. Use where a user id is structurally required.</summary>
    int RequireUserId();
}

/// <summary>Abstracted clock. Makes date-boundary rules (future dates, back-dating) testable.</summary>
public interface IDateTimeProvider
{
    DateTime UtcNow { get; }
    DateOnly TodayUtc { get; }
}

/// <summary>Typed, cached accessor over dsr.AppSettings so services never parse raw strings.</summary>
public interface IAppSettingService
{
    Task<string?> GetStringAsync(string key, CancellationToken ct = default);
    Task<int> GetIntAsync(string key, int fallback, CancellationToken ct = default);
    Task<decimal> GetDecimalAsync(string key, decimal fallback, CancellationToken ct = default);
    Task<bool> GetBoolAsync(string key, bool fallback, CancellationToken ct = default);
    Task<IReadOnlyList<AppSettingDto>> GetAllAsync(CancellationToken ct = default);
    Task UpdateAsync(string key, string value, CancellationToken ct = default);
    void InvalidateCache();
}

public record AppSettingDto(int Id, string SettingKey, string SettingValue, string DataType, string? Description, bool IsEditable);

/// <summary>
/// Writes dsr.AuditLog rows from the application rather than from database triggers, because only
/// the application knows the acting user and their IP address (recommendation R8).
/// </summary>
public interface IAuditService
{
    Task LogAsync(string entityName, int entityId, string actionType, object? oldValues, object? newValues, CancellationToken ct = default);
}

/// <summary>Strips markup from rich-text descriptions to populate WorkDescriptionPlain.</summary>
public interface IHtmlContentService
{
    /// <summary>Removes script/style/event handlers and disallowed tags. Never trust client input (risk S3).</summary>
    string Sanitize(string? html);

    /// <summary>Tag-stripped, entity-decoded, whitespace-collapsed text for search and export.</summary>
    string ToPlainText(string? html);
}
