using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using DSR.Application.Common;
using DSR.Application.DTOs;
using DSR.Application.Interfaces;
using DSR.Domain.Common;
using DSR.Domain.Entities;
using DSR.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace DSR.Infrastructure.Services;

/// <summary>Bound from the "Jwt" section of appsettings. No secret is ever hard-coded.</summary>
public class JwtSettings
{
    public string Issuer { get; set; } = null!;
    public string Audience { get; set; } = null!;

    /// <summary>Minimum 32 bytes for HS256. Supply from a secret store in production, not appsettings.</summary>
    public string SigningKey { get; set; } = null!;

    public int AccessTokenMinutes { get; set; } = 60;
    public int RefreshTokenDays { get; set; } = 14;
}

/// <summary>Bound from the "AzureAd" section. Tenant and client ids are not secrets.</summary>
public class AzureAdSettings
{
    public bool Enabled { get; set; }
    public string TenantId { get; set; } = null!;
    public string ClientId { get; set; } = null!;
    public string Instance { get; set; } = "https://login.microsoftonline.com/";

    public string Authority => $"{Instance.TrimEnd('/')}/{TenantId}/v2.0";
    public string MetadataAddress => $"{Authority}/.well-known/openid-configuration";
}

/// <summary>Mints application JWTs and opaque refresh tokens.</summary>
public class JwtTokenService(IOptions<JwtSettings> options) : IJwtTokenService
{
    private readonly JwtSettings _settings = options.Value;

    public (string Token, DateTime ExpiresOn, string JwtId) CreateAccessToken(
        int userId, string email, string fullName, IEnumerable<string> roleCodes)
    {
        var jwtId = Guid.NewGuid().ToString("N");
        var expiresOn = DateTime.UtcNow.AddMinutes(_settings.AccessTokenMinutes);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(JwtRegisteredClaimNames.Jti, jwtId),
            new(ClaimTypes.NameIdentifier, userId.ToString()),
            new(ClaimTypes.Email, email),
            new(ClaimTypes.Name, fullName)
        };

        // Role claims drive [Authorize(Roles = ...)]. Minted from the database on every login, never
        // accepted from the client.
        claims.AddRange(roleCodes.Select(r => new Claim(ClaimTypes.Role, r)));

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_settings.SigningKey));
        var token = new JwtSecurityToken(
            issuer: _settings.Issuer,
            audience: _settings.Audience,
            claims: claims,
            notBefore: DateTime.UtcNow,
            expires: expiresOn,
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));

        return (new JwtSecurityTokenHandler().WriteToken(token), expiresOn, jwtId);
    }

    public (string Token, byte[] Hash, DateTime ExpiresOn) CreateRefreshToken()
    {
        // 256 bits of entropy, URL-safe. Only the hash is persisted.
        var raw = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');

        return (raw, HashRefreshToken(raw), DateTime.UtcNow.AddDays(_settings.RefreshTokenDays));
    }

    public byte[] HashRefreshToken(string token) => SHA256.HashData(Encoding.UTF8.GetBytes(token));

    private static class JwtRegisteredClaimNames
    {
        public const string Sub = "sub";
        public const string Jti = "jti";
    }
}

/// <summary>
/// Validates a Microsoft Entra ID token against the tenant's published signing keys. The OpenID
/// configuration is fetched and cached by ConfigurationManager, which also handles key rollover.
/// Nothing in the token is trusted before the signature, issuer, audience and lifetime all pass.
/// </summary>
public class EntraIdTokenValidator : IEntraIdTokenValidator
{
    private readonly AzureAdSettings _settings;
    private readonly ILogger<EntraIdTokenValidator> _logger;
    private readonly ConfigurationManager<OpenIdConnectConfiguration> _configManager;

    public EntraIdTokenValidator(IOptions<AzureAdSettings> options, ILogger<EntraIdTokenValidator> logger)
    {
        _settings = options.Value;
        _logger = logger;
        _configManager = new ConfigurationManager<OpenIdConnectConfiguration>(
            _settings.MetadataAddress, new OpenIdConnectConfigurationRetriever(), new HttpDocumentRetriever());
    }

    public async Task<EntraIdPrincipal> ValidateAsync(string idToken, CancellationToken ct = default)
    {
        if (!_settings.Enabled)
            throw new UnauthorizedAppException("Single sign-on is not enabled for this deployment.");

        OpenIdConnectConfiguration config;
        try
        {
            config = await _configManager.GetConfigurationAsync(ct);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unable to retrieve Entra ID OpenID configuration from {Metadata}", _settings.MetadataAddress);
            throw new UnauthorizedAppException("Single sign-on is temporarily unavailable.");
        }

        var parameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuers = [$"https://login.microsoftonline.com/{_settings.TenantId}/v2.0",
                            $"https://sts.windows.net/{_settings.TenantId}/"],
            ValidateAudience = true,
            ValidAudiences = [_settings.ClientId, $"api://{_settings.ClientId}"],
            ValidateIssuerSigningKey = true,
            IssuerSigningKeys = config.SigningKeys,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(2)
        };

        ClaimsPrincipal principal;
        try
        {
            principal = new JwtSecurityTokenHandler().ValidateToken(idToken, parameters, out _);
        }
        catch (SecurityTokenException ex)
        {
            _logger.LogWarning("Entra ID token rejected: {Reason}", ex.Message);
            throw new UnauthorizedAppException("The single sign-on token could not be validated.");
        }

        // 'oid' is the immutable object id. Email may change or be reassigned, so matching on email
        // would be an account-takeover vector -- this is why ObjectId is the only join key used.
        var objectId = principal.FindFirst("oid")?.Value
                       ?? principal.FindFirst("http://schemas.microsoft.com/identity/claims/objectidentifier")?.Value
                       ?? throw new UnauthorizedAppException("The single sign-on token does not contain an object identifier.");

        var email = principal.FindFirst("preferred_username")?.Value
                    ?? principal.FindFirst(ClaimTypes.Email)?.Value
                    ?? principal.FindFirst("upn")?.Value
                    ?? throw new UnauthorizedAppException("The single sign-on token does not contain an email address.");

        return new EntraIdPrincipal
        {
            ObjectId = objectId,
            TenantId = principal.FindFirst("tid")?.Value ?? _settings.TenantId,
            Email = email.Trim().ToLowerInvariant(),
            GivenName = principal.FindFirst("given_name")?.Value,
            Surname = principal.FindFirst("family_name")?.Value,
            DisplayName = principal.FindFirst("name")?.Value,
            GroupIds = principal.FindAll("groups").Select(c => c.Value).ToList()
        };
    }
}

/// <summary>
/// Both authentication paths, refresh-token rotation with reuse detection, and password lifecycle.
///
/// Every attempt -- success or failure -- writes a dsr.UserLoginAudit row, including attempts on
/// email addresses that do not exist, because that is exactly the signal a credential-stuffing
/// attack produces.
/// </summary>
public class AuthService(
    DsrDbContext context,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IPasswordHasher hasher,
    IJwtTokenService tokens,
    IEntraIdTokenValidator entra,
    IAppSettingService settings,
    ILogger<AuthService> logger) : IAuthService
{
    public async Task<AuthResultDto> LoginWithDatabaseAsync(DatabaseLoginRequest request, CancellationToken ct = default)
    {
        var email = request.Email.Trim().ToLowerInvariant();

        if (!await settings.GetBoolAsync(SettingKeys.AllowDatabaseLogin, true, ct))
            throw new UnauthorizedAppException("Password sign-in is disabled. Please use single sign-on.");

        var user = await context.Users
            .Include(u => u.Credential)
            .Include(u => u.UserRoles).ThenInclude(r => r.Role)
            .FirstOrDefaultAsync(u => u.Email == email, ct);

        if (user is null)
        {
            await AuditLoginAsync(null, email, AuthenticationTypes.Database, false, "User not found", ct);
            // Same message for unknown email and wrong password: never confirm which accounts exist.
            throw new UnauthorizedAppException("Invalid email address or password.");
        }

        if (!user.IsActive)
        {
            await AuditLoginAsync(user.Id, email, AuthenticationTypes.Database, false, "Account inactive", ct);
            throw new UnauthorizedAppException("This account has been deactivated.");
        }

        if (!AuthenticationTypes.AllowsDatabaseLogin(user.AuthenticationType) || user.Credential is null)
        {
            await AuditLoginAsync(user.Id, email, AuthenticationTypes.Database, false, "Password login not permitted", ct);
            throw new UnauthorizedAppException("This account must sign in with single sign-on.");
        }

        var credential = user.Credential;

        if (credential.IsLockedOut(clock.UtcNow))
        {
            await AuditLoginAsync(user.Id, email, AuthenticationTypes.Database, false, "Account locked out", ct);
            throw new UnauthorizedAppException($"This account is locked until {credential.LockoutEndDate:HH:mm} UTC.");
        }

        var (verified, rehashNeeded) = hasher.Verify(credential.PasswordHash, request.Password);

        if (!verified)
        {
            var maxAttempts = await settings.GetIntAsync(SettingKeys.MaxFailedAttempts, 5, ct);
            var lockoutMinutes = await settings.GetIntAsync(SettingKeys.LockoutMinutes, 15, ct);

            credential.FailedLoginAttempts++;
            if (credential.FailedLoginAttempts >= maxAttempts)
            {
                credential.LockoutEndDate = clock.UtcNow.AddMinutes(lockoutMinutes);
                credential.FailedLoginAttempts = 0;
                logger.LogWarning("Account {UserId} locked after repeated failed sign-in attempts", user.Id);
            }

            await AuditLoginAsync(user.Id, email, AuthenticationTypes.Database, false, "Invalid password", ct);
            throw new UnauthorizedAppException("Invalid email address or password.");
        }

        credential.FailedLoginAttempts = 0;
        credential.LockoutEndDate = null;

        // Transparent work-factor upgrade when the stored hash used fewer iterations.
        if (rehashNeeded) credential.PasswordHash = hasher.Hash(request.Password);

        var result = await IssueTokensAsync(user, AuthenticationTypes.Database, ct);
        result.MustChangePassword = credential.MustChangePassword;
        return result;
    }

    public async Task<AuthResultDto> LoginWithSsoAsync(SsoLoginRequest request, CancellationToken ct = default)
    {
        var principal = await entra.ValidateAsync(request.IdToken, ct);

        // Match on the immutable object id only (risk S1).
        var user = await context.Users
            .Include(u => u.UserRoles).ThenInclude(r => r.Role)
            .FirstOrDefaultAsync(u => u.ExternalObjectId == principal.ObjectId, ct);

        if (user is null)
        {
            // A pre-created DATABASE-only account with the same email is linked rather than
            // duplicated, but only when it has no object id yet -- never overwrite an existing link.
            user = await context.Users
                .Include(u => u.UserRoles).ThenInclude(r => r.Role)
                .FirstOrDefaultAsync(u => u.Email == principal.Email && u.ExternalObjectId == null, ct);

            if (user is not null)
            {
                user.ExternalObjectId = principal.ObjectId;
                user.ExternalTenantId = principal.TenantId;
                user.AuthenticationType = AuthenticationTypes.Both;
                logger.LogInformation("Linked Entra identity {ObjectId} to existing user {UserId}", principal.ObjectId, user.Id);
            }
            else
            {
                user = await AutoProvisionAsync(principal, ct);
            }
        }

        if (!user.IsActive)
        {
            await AuditLoginAsync(user.Id, principal.Email, AuthenticationTypes.Sso, false, "Account inactive", ct);
            throw new UnauthorizedAppException("This account has been deactivated.");
        }

        await ApplySsoRoleMappingAsync(user, principal.GroupIds, ct);
        return await IssueTokensAsync(user, AuthenticationTypes.Sso, ct);
    }

    public async Task<AuthResultDto> RefreshAsync(RefreshTokenRequest request, CancellationToken ct = default)
    {
        var hash = tokens.HashRefreshToken(request.RefreshToken);

        var stored = await context.RefreshTokens
            .Include(t => t.User).ThenInclude(u => u.UserRoles).ThenInclude(r => r.Role)
            .FirstOrDefaultAsync(t => t.TokenHash == hash, ct)
            ?? throw new UnauthorizedAppException("The refresh token is not recognised.");

        // REUSE DETECTION: a revoked token that already has a successor means someone replayed an
        // old token. The safe response is to revoke the entire family, forcing a fresh sign-in.
        if (stored.IsRevoked && stored.ReplacedByTokenId is not null)
        {
            logger.LogWarning("Refresh token reuse detected for user {UserId}; revoking all tokens", stored.UserId);
            await RevokeAllForUserAsync(stored.UserId, "Refresh token reuse detected", ct);
            throw new UnauthorizedAppException("This session is no longer valid. Please sign in again.");
        }

        if (!stored.IsUsable(clock.UtcNow))
            throw new UnauthorizedAppException("The refresh token has expired or been revoked.");

        if (!stored.User.IsActive)
            throw new UnauthorizedAppException("This account has been deactivated.");

        var result = await IssueTokensAsync(stored.User, stored.User.AuthenticationType, ct, auditLogin: false);

        stored.RevokedOn = clock.UtcNow;
        stored.RevokedByIp = currentUser.IpAddress;
        stored.RevokedReason = "Rotated";

        var successor = await context.RefreshTokens
            .Where(t => t.UserId == stored.UserId && t.RevokedOn == null)
            .OrderByDescending(t => t.Id)
            .FirstOrDefaultAsync(ct);

        stored.ReplacedByTokenId = successor?.Id;
        await context.SaveChangesAsync(ct);

        return result;
    }

    public async Task RevokeAsync(string refreshToken, string reason, CancellationToken ct = default)
    {
        var hash = tokens.HashRefreshToken(refreshToken);
        var stored = await context.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash, ct);
        if (stored is null || stored.IsRevoked) return;   // idempotent: logging out twice is not an error

        stored.RevokedOn = clock.UtcNow;
        stored.RevokedByIp = currentUser.IpAddress;
        stored.RevokedReason = reason;
        await context.SaveChangesAsync(ct);
    }

    public async Task RevokeAllForUserAsync(int userId, string reason, CancellationToken ct = default)
    {
        var live = await context.RefreshTokens.Where(t => t.UserId == userId && t.RevokedOn == null).ToListAsync(ct);

        foreach (var token in live)
        {
            token.RevokedOn = clock.UtcNow;
            token.RevokedByIp = currentUser.IpAddress;
            token.RevokedReason = reason;
        }

        if (live.Count > 0) await context.SaveChangesAsync(ct);
    }

    public async Task ChangePasswordAsync(ChangePasswordRequest request, CancellationToken ct = default)
    {
        var userId = currentUser.RequireUserId();

        var credential = await context.UserCredentials.FirstOrDefaultAsync(c => c.UserId == userId, ct)
                         ?? throw new BusinessRuleException("This account does not use password sign-in.");

        var (verified, _) = hasher.Verify(credential.PasswordHash, request.CurrentPassword);
        if (!verified) throw new ValidationAppException(nameof(request.CurrentPassword), "The current password is incorrect.");

        credential.PasswordHash = hasher.Hash(request.NewPassword);
        credential.PasswordChangedDate = clock.UtcNow;
        credential.MustChangePassword = false;
        credential.FailedLoginAttempts = 0;
        credential.LockoutEndDate = null;

        // Rotating the stamp is what makes existing sessions invalid after a password change.
        credential.SecurityStamp = Guid.NewGuid();
        await context.SaveChangesAsync(ct);

        await RevokeAllForUserAsync(userId, "Password changed", ct);
        logger.LogInformation("User {UserId} changed their password", userId);
    }

    public async Task<ResetPasswordResultDto> ResetPasswordAsync(ResetPasswordRequest request, CancellationToken ct = default)
    {
        if (!currentUser.IsAdmin) throw new ForbiddenException("Only an Admin may reset another user's password.");

        var user = await context.Users.Include(u => u.Credential).FirstOrDefaultAsync(u => u.Id == request.UserId, ct)
                   ?? throw new NotFoundException(nameof(User), request.UserId);

        var password = string.IsNullOrWhiteSpace(request.NewPassword)
            ? hasher.GenerateTemporaryPassword()
            : request.NewPassword;

        if (user.Credential is null)
        {
            context.UserCredentials.Add(new UserCredential
            {
                UserId = user.Id,
                PasswordHash = hasher.Hash(password),
                SecurityStamp = Guid.NewGuid(),
                MustChangePassword = true,
                PasswordChangedDate = clock.UtcNow
            });

            if (user.AuthenticationType == AuthenticationTypes.Sso)
                user.AuthenticationType = AuthenticationTypes.Both;
        }
        else
        {
            user.Credential.PasswordHash = hasher.Hash(password);
            user.Credential.MustChangePassword = true;
            user.Credential.PasswordChangedDate = clock.UtcNow;
            user.Credential.FailedLoginAttempts = 0;
            user.Credential.LockoutEndDate = null;
            user.Credential.SecurityStamp = Guid.NewGuid();
        }

        await context.SaveChangesAsync(ct);
        await RevokeAllForUserAsync(user.Id, "Password reset by administrator", ct);

        logger.LogInformation("Password for user {UserId} reset by admin {AdminId}", user.Id, currentUser.UserId);
        return new ResetPasswordResultDto { UserId = user.Id, TemporaryPassword = password };
    }

    public async Task<AuthenticatedUserDto> GetCurrentUserAsync(CancellationToken ct = default)
    {
        var userId = currentUser.RequireUserId();

        var user = await context.Users
            .Include(u => u.UserRoles).ThenInclude(r => r.Role)
            .FirstOrDefaultAsync(u => u.Id == userId, ct)
            ?? throw new NotFoundException(nameof(User), userId);

        return await ToDtoAsync(user, ct);
    }

    /* ------------------------------- private helpers ------------------------------- */

    private async Task<AuthResultDto> IssueTokensAsync(User user, string authType, CancellationToken ct, bool auditLogin = true)
    {
        var roles = user.UserRoles.Where(r => r.IsActive).Select(r => r.Role.RoleCode).Distinct().ToList();
        if (roles.Count == 0) roles.Add(RoleCodes.Employee);

        var (accessToken, accessExpiry, jwtId) = tokens.CreateAccessToken(user.Id, user.Email, user.FullName, roles);
        var (refreshToken, refreshHash, refreshExpiry) = tokens.CreateRefreshToken();

        context.RefreshTokens.Add(new RefreshToken
        {
            UserId = user.Id,
            TokenHash = refreshHash,
            JwtId = jwtId,
            ExpiresOn = refreshExpiry,
            CreatedByIp = currentUser.IpAddress
        });

        user.LastLoginDate = clock.UtcNow;

        if (auditLogin) await AuditLoginAsync(user.Id, user.Email, authType, true, null, ct, save: false);
        await context.SaveChangesAsync(ct);

        return new AuthResultDto
        {
            AccessToken = accessToken,
            RefreshToken = refreshToken,
            AccessTokenExpiresOn = accessExpiry,
            RefreshTokenExpiresOn = refreshExpiry,
            User = await ToDtoAsync(user, ct)
        };
    }

    private async Task<User> AutoProvisionAsync(EntraIdPrincipal principal, CancellationToken ct)
    {
        if (!await settings.GetBoolAsync(SettingKeys.SsoAutoProvisionEnabled, true, ct))
            throw new UnauthorizedAppException("No account exists for this identity. Please contact an administrator.");

        var defaultRoleCode = await settings.GetStringAsync(SettingKeys.SsoDefaultRoleCode, ct) ?? RoleCodes.Employee;
        var role = await context.Roles.FirstOrDefaultAsync(r => r.RoleCode == defaultRoleCode && r.IsActive, ct)
                   ?? await context.Roles.FirstAsync(r => r.RoleCode == RoleCodes.Employee, ct);

        var names = SplitName(principal);

        var user = new User
        {
            FirstName = names.First,
            LastName = names.Last,
            Email = principal.Email,
            AuthenticationType = AuthenticationTypes.Sso,
            ExternalObjectId = principal.ObjectId,
            ExternalTenantId = principal.TenantId,
            DateOfJoining = clock.TodayUtc
        };

        context.Users.Add(user);
        await context.SaveChangesAsync(ct);

        context.UserRoles.Add(new UserRole { UserId = user.Id, RoleId = role.Id, AssignedDate = clock.UtcNow });
        await context.SaveChangesAsync(ct);

        // Reload with roles so the token can be minted from the persisted state.
        await context.Entry(user).Collection(u => u.UserRoles).Query().Include(r => r.Role).LoadAsync(ct);

        logger.LogInformation("Auto-provisioned SSO user {UserId} ({Email}) with role {Role}", user.Id, user.Email, role.RoleCode);
        return user;
    }

    /// <summary>
    /// Reconciles application roles from Entra group membership on every sign-in, so removing a user
    /// from a group takes effect at their next login. Runs only when mappings are configured --
    /// otherwise manually assigned roles would be wiped on first SSO login.
    /// </summary>
    private async Task ApplySsoRoleMappingAsync(User user, IReadOnlyCollection<string> groupIds, CancellationToken ct)
    {
        if (groupIds.Count == 0) return;

        var mappings = await context.SsoRoleMappings
            .Where(m => m.IsActive && groupIds.Contains(m.ExternalGroupId))
            .OrderByDescending(m => m.Priority)
            .Select(m => m.RoleId)
            .Distinct()
            .ToListAsync(ct);

        if (mappings.Count == 0) return;

        var existing = await context.UserRoles.Where(ur => ur.UserId == user.Id).ToListAsync(ct);

        foreach (var roleId in mappings)
        {
            var match = existing.FirstOrDefault(e => e.RoleId == roleId);
            if (match is null)
                context.UserRoles.Add(new UserRole { UserId = user.Id, RoleId = roleId, AssignedDate = clock.UtcNow });
            else if (!match.IsActive)
                match.IsActive = true;
        }

        foreach (var stale in existing.Where(e => e.IsActive && !mappings.Contains(e.RoleId)))
            stale.IsActive = false;

        await context.SaveChangesAsync(ct);
        await context.Entry(user).Collection(u => u.UserRoles).Query().Include(r => r.Role).LoadAsync(ct);
    }

    private async Task<AuthenticatedUserDto> ToDtoAsync(User user, CancellationToken ct) => new()
    {
        Id = user.Id,
        FullName = user.FullName,
        Email = user.Email,
        EmployeeCode = user.EmployeeCode,
        Designation = user.Designation,
        ManagerUserId = user.ManagerUserId,
        StandardDailyHours = user.StandardDailyHours,
        AuthenticationType = user.AuthenticationType,
        Roles = user.UserRoles.Where(r => r.IsActive).Select(r => r.Role.RoleCode).Distinct().ToList(),
        HasDirectReports = await context.Users.AnyAsync(u => u.ManagerUserId == user.Id && u.IsActive, ct)
    };

    private async Task AuditLoginAsync(int? userId, string email, string authType, bool success, string? reason,
        CancellationToken ct, bool save = true)
    {
        context.UserLoginAudits.Add(new UserLoginAudit
        {
            UserId = userId,
            AttemptedEmail = email,
            AuthenticationType = authType,
            IsSuccessful = success,
            FailureReason = reason,
            IpAddress = currentUser.IpAddress,
            AttemptDate = clock.UtcNow
        });

        if (save) await context.SaveChangesAsync(ct);
    }

    private static (string First, string Last) SplitName(EntraIdPrincipal principal)
    {
        if (!string.IsNullOrWhiteSpace(principal.GivenName))
            return (principal.GivenName, string.IsNullOrWhiteSpace(principal.Surname) ? "-" : principal.Surname);

        var display = principal.DisplayName?.Trim();
        if (string.IsNullOrWhiteSpace(display))
            return (principal.Email.Split('@')[0], "-");

        var parts = display.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length == 1 ? (parts[0], "-") : (parts[0], string.Join(' ', parts.Skip(1)));
    }
}
