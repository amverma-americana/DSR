using System.Security.Claims;
using DSR.Application.Common;

namespace DSR.API.Infrastructure;

/// <summary>
/// Resolves the caller from the validated JWT on the current HttpContext.
///
/// This is the single source of identity for the whole application. Services depend on this
/// interface rather than accepting a user id parameter, which is what prevents a client from
/// passing someone else's id and reading their DSR data (risk S4).
/// </summary>
public class CurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    private ClaimsPrincipal? Principal => accessor.HttpContext?.User;

    public int? UserId =>
        int.TryParse(Principal?.FindFirst(ClaimTypes.NameIdentifier)?.Value
                     ?? Principal?.FindFirst("sub")?.Value, out var id) ? id : null;

    public string? Email => Principal?.FindFirst(ClaimTypes.Email)?.Value;

    public IReadOnlyCollection<string> Roles =>
        Principal?.FindAll(ClaimTypes.Role).Select(c => c.Value).ToArray() ?? [];

    /// <summary>
    /// Prefers X-Forwarded-For when the app sits behind a reverse proxy or Azure App Service.
    /// Requires ForwardedHeaders middleware to be enabled, which Program.cs configures.
    /// </summary>
    public string? IpAddress
    {
        get
        {
            var context = accessor.HttpContext;
            if (context is null) return null;

            var forwarded = context.Request.Headers["X-Forwarded-For"].FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(forwarded))
                return forwarded.Split(',')[0].Trim();

            return context.Connection.RemoteIpAddress?.ToString();
        }
    }

    public bool IsAuthenticated => Principal?.Identity?.IsAuthenticated ?? false;

    public bool IsInRole(string roleCode) =>
        Roles.Any(r => string.Equals(r, roleCode, StringComparison.OrdinalIgnoreCase));

    public int RequireUserId() =>
        UserId ?? throw new UnauthorizedAppException("The request is not associated with an authenticated user.");
}
