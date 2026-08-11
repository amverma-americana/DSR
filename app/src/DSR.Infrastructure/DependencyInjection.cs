using System.Text;
using DSR.Application.Common;
using DSR.Application.Interfaces;
using DSR.Infrastructure.Persistence;
using DSR.Infrastructure.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;

namespace DSR.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructureLayer(this IServiceCollection services, IConfiguration configuration)
    {
        /*  Connection string is read exclusively from configuration via IConfiguration -- there is
            no hard-coded connection string anywhere in the solution. Fail fast at startup rather
            than on the first request if it is missing.                                          */
        var connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException(
                "ConnectionStrings:DefaultConnection is not configured. Set it in appsettings.json, " +
                "an environment variable (ConnectionStrings__DefaultConnection), or a secret store.");

        services.AddDbContext<DsrDbContext>(options =>
        {
            options.UseSqlServer(connectionString, sql =>
            {
                sql.EnableRetryOnFailure(maxRetryCount: 3, maxRetryDelay: TimeSpan.FromSeconds(5), errorNumbersToAdd: null);
                sql.CommandTimeout(60);

                // The schema is owned by the hand-written SQL scripts, not by EF migrations.
                sql.MigrationsHistoryTable("__EFMigrationsHistory", DsrDbContext.Schema);
            });

            if (configuration.GetValue("Database:EnableSensitiveDataLogging", false))
                options.EnableSensitiveDataLogging().EnableDetailedErrors();
        });

        services.AddMemoryCache();

        // Options bound from configuration sections
        services.Configure<JwtSettings>(configuration.GetSection("Jwt"));
        services.Configure<AzureAdSettings>(configuration.GetSection("AzureAd"));

        // Persistence
        services.AddScoped(typeof(IRepository<>), typeof(Repository<>));
        services.AddScoped<IUnitOfWork, UnitOfWork>();
        services.AddScoped<IReportingRepository, ReportingRepository>();
        services.AddScoped<IDetailReportRepository, DetailReportRepository>();

        // Cross-cutting
        services.AddSingleton<IDateTimeProvider, DateTimeProvider>();
        services.AddSingleton<IPasswordHasher, PasswordHasher>();
        services.AddSingleton<IJwtTokenService, JwtTokenService>();
        services.AddSingleton<IEntraIdTokenValidator, EntraIdTokenValidator>();
        services.AddScoped<IAppSettingService, AppSettingService>();
        services.AddScoped<IAuditService, AuditService>();
        services.AddScoped<IAuthService, AuthService>();

        return services;
    }

    /// <summary>
    /// JWT bearer authentication for the application's own tokens. Entra ID tokens are validated
    /// separately in <see cref="EntraIdTokenValidator"/> during the SSO exchange: the client holds
    /// an application JWT afterwards, so there is one token format on the API surface.
    /// </summary>
    public static IServiceCollection AddJwtAuthentication(this IServiceCollection services, IConfiguration configuration)
    {
        var jwt = configuration.GetSection("Jwt").Get<JwtSettings>()
                  ?? throw new InvalidOperationException("The Jwt configuration section is missing.");

        if (string.IsNullOrWhiteSpace(jwt.SigningKey) || Encoding.UTF8.GetByteCount(jwt.SigningKey) < 32)
            throw new InvalidOperationException("Jwt:SigningKey must be configured and at least 32 bytes long for HS256.");

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                options.SaveToken = false;
                options.RequireHttpsMetadata = !configuration.GetValue("Jwt:AllowHttp", false);
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidIssuer = jwt.Issuer,
                    ValidateAudience = true,
                    ValidAudience = jwt.Audience,
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SigningKey)),
                    ValidateLifetime = true,
                    ClockSkew = TimeSpan.FromSeconds(30),
                    RoleClaimType = System.Security.Claims.ClaimTypes.Role,
                    NameClaimType = System.Security.Claims.ClaimTypes.Name
                };

                // Return a clean 401 body instead of the default empty response, so the React
                // interceptor can distinguish "token expired" from other failures.
                options.Events = new JwtBearerEvents
                {
                    OnChallenge = async ctx =>
                    {
                        ctx.HandleResponse();
                        if (ctx.Response.HasStarted) return;

                        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        ctx.Response.ContentType = "application/json";

                        var expired = ctx.AuthenticateFailure is SecurityTokenExpiredException;
                        await ctx.Response.WriteAsJsonAsync(ApiResponse<object>.Fail(
                            expired ? "The access token has expired." : "Authentication is required.",
                            traceId: ctx.HttpContext.TraceIdentifier));
                    }
                };
            });

        services.AddAuthorization();
        return services;
    }
}
