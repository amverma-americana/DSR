using DSR.Application.Common;
using DSR.Application.DTOs;
using DSR.Application.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DSR.API.Controllers;

/// <summary>Base controller: every response is wrapped in the same envelope.</summary>
[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public abstract class ApiControllerBase : ControllerBase
{
    protected ActionResult<ApiResponse<T>> Success<T>(T data, string? message = null) =>
        Ok(ApiResponse<T>.Ok(data, message));

    protected ActionResult<ApiResponse<T>> Created<T>(T data, string? message = null) =>
        StatusCode(StatusCodes.Status201Created, ApiResponse<T>.Ok(data, message));
}

/// <summary>
/// Authentication for both paths plus token lifecycle.
/// Refresh tokens are returned in the body rather than a cookie because the SPA and the API are
/// separately deployed; the client stores the refresh token in memory and the access token in
/// memory too, re-authenticating silently on 401 (see client/src/api/client.js).
/// </summary>
[AllowAnonymous]
public class AuthController(IAuthService auth) : ApiControllerBase
{
    /// <summary>Sign in with email and password (DATABASE or BOTH accounts).</summary>
    [HttpPost("login")]
    [ProducesResponseType(typeof(ApiResponse<AuthResultDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<ApiResponse<AuthResultDto>>> Login([FromBody] DatabaseLoginRequest request, CancellationToken ct) =>
        Success(await auth.LoginWithDatabaseAsync(request, ct));

    /// <summary>
    /// Exchange a Microsoft Entra ID token for an application JWT. Auto-provisions the user on first
    /// sign-in when Sso.AutoProvisionEnabled is true, and applies Entra group to role mapping.
    /// </summary>
    [HttpPost("sso-login")]
    [ProducesResponseType(typeof(ApiResponse<AuthResultDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<ApiResponse<AuthResultDto>>> SsoLogin([FromBody] SsoLoginRequest request, CancellationToken ct) =>
        Success(await auth.LoginWithSsoAsync(request, ct));

    /// <summary>Rotate a refresh token. Replaying a rotated token revokes the whole token family.</summary>
    [HttpPost("refresh")]
    [ProducesResponseType(typeof(ApiResponse<AuthResultDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<AuthResultDto>>> Refresh([FromBody] RefreshTokenRequest request, CancellationToken ct) =>
        Success(await auth.RefreshAsync(request, ct));

    /// <summary>Revoke the supplied refresh token. Idempotent.</summary>
    [HttpPost("logout")]
    [ProducesResponseType(typeof(ApiResponse<string>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<string>>> Logout([FromBody] RefreshTokenRequest request, CancellationToken ct)
    {
        await auth.RevokeAsync(request.RefreshToken, "User signed out", ct);
        return Success("Signed out.", "Signed out successfully.");
    }

    /// <summary>The authenticated user, their roles and whether they manage anyone.</summary>
    [Authorize]
    [HttpGet("me")]
    [ProducesResponseType(typeof(ApiResponse<AuthenticatedUserDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<AuthenticatedUserDto>>> Me(CancellationToken ct) =>
        Success(await auth.GetCurrentUserAsync(ct));

    /// <summary>Change your own password. Revokes all sessions on success.</summary>
    [Authorize]
    [HttpPost("change-password")]
    [ProducesResponseType(typeof(ApiResponse<string>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<string>>> ChangePassword([FromBody] ChangePasswordRequest request, CancellationToken ct)
    {
        await auth.ChangePasswordAsync(request, ct);
        return Success("Password changed.", "Password changed successfully. Please sign in again.");
    }

    /// <summary>Admin-only password reset. Returns a temporary password and forces a change at next login.</summary>
    [Authorize(Roles = Domain.Common.RoleCodes.Admin)]
    [HttpPost("reset-password")]
    [ProducesResponseType(typeof(ApiResponse<ResetPasswordResultDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<ResetPasswordResultDto>>> ResetPassword([FromBody] ResetPasswordRequest request, CancellationToken ct) =>
        Success(await auth.ResetPasswordAsync(request, ct), "Password reset. Share the temporary password securely.");
}
