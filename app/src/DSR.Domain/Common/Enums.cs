namespace DSR.Domain.Common;

/// <summary>Role codes seeded in dsr.Roles. Used for [Authorize(Roles = ...)] and claim emission.</summary>
public static class RoleCodes
{
    public const string Admin = "ADMIN";
    public const string Manager = "MANAGER";
    public const string Employee = "EMPLOYEE";

    public const string AdminOrManager = Admin + "," + Manager;
    public const string All = Admin + "," + Manager + "," + Employee;
}

/// <summary>Mirrors CK_Projects_Status. Kept as constants, not a C# enum, because the column is NVARCHAR.</summary>
public static class ProjectStatuses
{
    public const string Planned = "PLANNED";
    public const string Active = "ACTIVE";
    public const string OnHold = "ON_HOLD";
    public const string Completed = "COMPLETED";
    public const string Cancelled = "CANCELLED";

    public static readonly string[] All = [Planned, Active, OnHold, Completed, Cancelled];

    /// <summary>Statuses that permit effort logging. Mirrors trg_DSREntries_ProjectWindow (assumption A-11).</summary>
    public static readonly string[] OpenForEffort = [Active, Completed];
}

/// <summary>Mirrors CK_Users_AuthenticationType.</summary>
public static class AuthenticationTypes
{
    public const string Sso = "SSO";
    public const string Database = "DATABASE";
    public const string Both = "BOTH";

    public static bool AllowsDatabaseLogin(string value) => value is Database or Both;
    public static bool AllowsSso(string value) => value is Sso or Both;
}

/// <summary>Mirrors CK_AuditLog_ActionType.</summary>
public static class AuditActions
{
    public const string Insert = "INSERT";
    public const string Update = "UPDATE";
    public const string Delete = "DELETE";
}

/// <summary>Keys seeded in dsr.AppSettings. Centralised so no magic strings appear in services.</summary>
public static class SettingKeys
{
    public const string MaxDailyHours = "DSR.MaxDailyHours";
    public const string BackDateWindowDays = "DSR.BackDateWindowDays";
    public const string RequireDescription = "DSR.RequireDescription";
    public const string AllowEditAfterLock = "DSR.AllowEditAfterLock";
    public const string MaxFailedAttempts = "Auth.MaxFailedAttempts";
    public const string LockoutMinutes = "Auth.LockoutMinutes";
    public const string AllowDatabaseLogin = "Auth.AllowDatabaseLogin";
    public const string AccessTokenMinutes = "Auth.AccessTokenMinutes";
    public const string RefreshTokenDays = "Auth.RefreshTokenDays";
    public const string SsoAutoProvisionEnabled = "Sso.AutoProvisionEnabled";
    public const string SsoDefaultRoleCode = "Sso.DefaultRoleCode";
    public const string UtilizationTargetPct = "Utilization.TargetPct";
    public const string ReportDefaultPeriodDays = "Report.DefaultPeriodDays";
}
