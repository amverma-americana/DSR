using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using DSR.Application.Common;
using DSR.Application.Interfaces;
using DSR.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using DSR.Infrastructure.Persistence;

namespace DSR.Infrastructure.Services;

/// <summary>System clock. All timestamps are UTC; the presentation tier converts for display.</summary>
public class DateTimeProvider : IDateTimeProvider
{
    public DateTime UtcNow => DateTime.UtcNow;
    public DateOnly TodayUtc => DateOnly.FromDateTime(DateTime.UtcNow);
}

/// <summary>
/// Typed accessor over dsr.AppSettings with a short in-memory cache. Settings are read on almost
/// every DSR save (daily cap, back-date window, description requirement), so an uncached read would
/// add a round trip to the hot path.
/// </summary>
public class AppSettingService(DsrDbContext context, IMemoryCache cache) : IAppSettingService
{
    private const string CacheKey = "dsr:appsettings";
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(5);

    public async Task<string?> GetStringAsync(string key, CancellationToken ct = default)
    {
        var all = await LoadAsync(ct);
        return all.GetValueOrDefault(key);
    }

    public async Task<int> GetIntAsync(string key, int fallback, CancellationToken ct = default) =>
        int.TryParse(await GetStringAsync(key, ct), out var v) ? v : fallback;

    public async Task<decimal> GetDecimalAsync(string key, decimal fallback, CancellationToken ct = default) =>
        decimal.TryParse(await GetStringAsync(key, ct), out var v) ? v : fallback;

    public async Task<bool> GetBoolAsync(string key, bool fallback, CancellationToken ct = default)
    {
        var raw = await GetStringAsync(key, ct);
        if (string.IsNullOrWhiteSpace(raw)) return fallback;
        return raw.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "y" => true,
            "false" or "0" or "no" or "n" => false,
            _ => fallback
        };
    }

    public async Task<IReadOnlyList<AppSettingDto>> GetAllAsync(CancellationToken ct = default) =>
        await context.AppSettings.AsNoTracking()
            .Where(s => s.IsActive)
            .OrderBy(s => s.SettingKey)
            .Select(s => new AppSettingDto(s.Id, s.SettingKey, s.SettingValue, s.DataType, s.Description, s.IsEditable))
            .ToListAsync(ct);

    public async Task UpdateAsync(string key, string value, CancellationToken ct = default)
    {
        var setting = await context.AppSettings.FirstOrDefaultAsync(s => s.SettingKey == key, ct)
                      ?? throw new NotFoundException(nameof(AppSetting), key);

        if (!setting.IsEditable)
            throw new BusinessRuleException($"Setting '{key}' is not editable.");

        // Reject a value the declared data type cannot hold, so a bad edit fails now and not later
        // inside the DSR save path.
        var valid = setting.DataType switch
        {
            "INT" => int.TryParse(value, out _),
            "DECIMAL" => decimal.TryParse(value, out _),
            "BOOL" => bool.TryParse(value, out _) || value is "0" or "1",
            "DATE" => DateOnly.TryParse(value, out _),
            "JSON" => IsJson(value),
            _ => true
        };

        if (!valid)
            throw new ValidationAppException(nameof(value), $"Value '{value}' is not a valid {setting.DataType}.");

        setting.SettingValue = value;
        await context.SaveChangesAsync(ct);
        InvalidateCache();
    }

    public void InvalidateCache() => cache.Remove(CacheKey);

    private async Task<Dictionary<string, string>> LoadAsync(CancellationToken ct)
    {
        if (cache.TryGetValue(CacheKey, out Dictionary<string, string>? cached) && cached is not null)
            return cached;

        var map = await context.AppSettings.AsNoTracking()
            .Where(s => s.IsActive)
            .ToDictionaryAsync(s => s.SettingKey, s => s.SettingValue, ct);

        cache.Set(CacheKey, map, Ttl);
        return map;
    }

    private static bool IsJson(string value)
    {
        try { JsonDocument.Parse(value); return true; }
        catch (JsonException) { return false; }
    }
}

/// <summary>
/// Writes dsr.AuditLog from the application rather than from triggers, because only the request
/// pipeline knows the acting user and their IP address. Payloads are JSON, matching the
/// CK_AuditLog_*Json constraints. Password material is never captured (risk S6).
/// </summary>
public class AuditService(DsrDbContext context, ICurrentUser currentUser, IDateTimeProvider clock) : IAuditService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = false,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    private static readonly string[] Redacted = ["password", "passwordhash", "securitystamp", "tokenhash", "refreshtoken"];

    public Task LogAsync(string entityName, int entityId, string actionType, object? oldValues, object? newValues, CancellationToken ct = default)
    {
        context.AuditLogs.Add(new AuditLog
        {
            EntityName = entityName,
            EntityId = entityId,
            ActionType = actionType,
            OldValues = Serialize(oldValues),
            NewValues = Serialize(newValues),
            ChangedByUserId = currentUser.UserId ?? 1,
            ChangedDate = clock.UtcNow,
            IpAddress = currentUser.IpAddress
        });

        // Deliberately NOT saved here: the caller's SaveChangesAsync commits the audit row in the
        // same transaction as the change it describes, so the two cannot diverge.
        return Task.CompletedTask;
    }

    private static string? Serialize(object? value)
    {
        if (value is null) return null;

        var json = JsonSerializer.Serialize(value, JsonOptions);
        var doc = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json);
        if (doc is null) return json;

        var safe = doc.Where(kv => !Redacted.Contains(kv.Key.ToLowerInvariant()))
                      .ToDictionary(kv => kv.Key, kv => kv.Value);

        return JsonSerializer.Serialize(safe, JsonOptions);
    }
}

/// <summary>
/// PBKDF2-SHA256 password hashing, 210,000 iterations (OWASP 2023 guidance), 128-bit salt,
/// 256-bit subkey. Format: {version}.{iterations}.{base64 salt}.{base64 hash} so the work factor
/// can be raised later and old hashes upgraded transparently on next successful login.
/// </summary>
public class PasswordHasher : IPasswordHasher
{
    private const int SaltSize = 16;
    private const int KeySize = 32;
    private const int Iterations = 210_000;
    private const char Delimiter = '.';
    private const string Version = "v1";

    private const string PasswordAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";

    public string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var key = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, KeySize);

        return string.Join(Delimiter, Version, Iterations, Convert.ToBase64String(salt), Convert.ToBase64String(key));
    }

    public (bool Verified, bool RehashNeeded) Verify(string hash, string password)
    {
        var parts = hash.Split(Delimiter);
        if (parts.Length != 4 || parts[0] != Version) return (false, false);
        if (!int.TryParse(parts[1], out var iterations)) return (false, false);

        byte[] salt, expected;
        try
        {
            salt = Convert.FromBase64String(parts[2]);
            expected = Convert.FromBase64String(parts[3]);
        }
        catch (FormatException) { return (false, false); }

        var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);

        // Fixed-time comparison: a naive SequenceEqual leaks information through timing.
        var verified = CryptographicOperations.FixedTimeEquals(actual, expected);
        return (verified, verified && iterations < Iterations);
    }

    public string GenerateTemporaryPassword(int length = 16)
    {
        var chars = new char[Math.Max(12, length)];
        for (var i = 0; i < chars.Length; i++)
            chars[i] = PasswordAlphabet[RandomNumberGenerator.GetInt32(PasswordAlphabet.Length)];

        // Guarantee the generated value satisfies the complexity policy in ChangePasswordRequestValidator
        chars[0] = 'A';
        chars[1] = 'a';
        chars[2] = '7';
        chars[3] = '#';
        return new string(chars);
    }
}
