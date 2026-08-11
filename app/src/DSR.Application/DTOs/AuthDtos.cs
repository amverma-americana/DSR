namespace DSR.Application.DTOs;

/*  AUTHENTICATION -- two paths into one identity.
    Database login: email + password -> UserCredentials.
    SSO login: an Entra ID access token, validated then matched on the oid claim (never email).   */

public class DatabaseLoginRequest
{
    public string Email { get; set; } = null!;
    public string Password { get; set; } = null!;
}

/// <summary>
/// The client obtains an Entra ID token via MSAL, then exchanges it here for an application JWT.
/// The API validates the Entra token against the tenant's signing keys before trusting any claim.
/// </summary>
public class SsoLoginRequest
{
    public string IdToken { get; set; } = null!;
}

public class RefreshTokenRequest
{
    public string RefreshToken { get; set; } = null!;
}

public class ChangePasswordRequest
{
    public string CurrentPassword { get; set; } = null!;
    public string NewPassword { get; set; } = null!;
}

/// <summary>Admin-initiated reset. Returns a temporary password and forces a change on next login.</summary>
public class ResetPasswordRequest
{
    public int UserId { get; set; }

    /// <summary>Optional. When omitted the service generates a cryptographically random password.</summary>
    public string? NewPassword { get; set; }
}

public class AuthResultDto
{
    public string AccessToken { get; set; } = null!;
    public string RefreshToken { get; set; } = null!;
    public DateTime AccessTokenExpiresOn { get; set; }
    public DateTime RefreshTokenExpiresOn { get; set; }
    public AuthenticatedUserDto User { get; set; } = null!;

    /// <summary>When true the client must route to the change-password screen before anything else.</summary>
    public bool MustChangePassword { get; set; }
}

/// <summary>The identity payload the React app keeps in memory to drive routing and menu visibility.</summary>
public class AuthenticatedUserDto
{
    public int Id { get; set; }
    public string FullName { get; set; } = null!;
    public string Email { get; set; } = null!;
    public string? EmployeeCode { get; set; }
    public string? Designation { get; set; }
    public int? ManagerUserId { get; set; }
    public decimal StandardDailyHours { get; set; }
    public string AuthenticationType { get; set; } = null!;
    public List<string> Roles { get; set; } = [];
    public bool HasDirectReports { get; set; }
}

public class ResetPasswordResultDto
{
    public int UserId { get; set; }
    public string TemporaryPassword { get; set; } = null!;
    public bool MustChangePassword { get; set; } = true;
}
