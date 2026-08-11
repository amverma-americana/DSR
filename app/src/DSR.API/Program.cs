using System.Text.Json;
using System.Text.Json.Serialization;
using DSR.API.Infrastructure;
using DSR.API.Middleware;
using DSR.Application;
using DSR.Application.Common;
using DSR.Infrastructure;
using DSR.Infrastructure.Persistence;
using FluentValidation;
using FluentValidation.AspNetCore;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.OpenApi.Models;
using Serilog;
using Serilog.Events;

// Bootstrap logger: captures failures that occur before the host is built (bad configuration,
// missing connection string) which would otherwise be lost.
Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .WriteTo.Console()
    .CreateBootstrapLogger();

try
{
    var builder = WebApplication.CreateBuilder(args);

    /* ------------------------------------- LOGGING --------------------------------------- */
    builder.Host.UseSerilog((context, services, configuration) => configuration
        .ReadFrom.Configuration(context.Configuration)
        .ReadFrom.Services(services)
        .Enrich.FromLogContext()
        .Enrich.WithMachineName()
        .Enrich.WithThreadId()
        .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
        .MinimumLevel.Override("Microsoft.EntityFrameworkCore.Database.Command", LogEventLevel.Warning));

    /* ----------------------------------- APPLICATION ------------------------------------ */
    builder.Services.AddHttpContextAccessor();
    builder.Services.AddScoped<ICurrentUser, CurrentUser>();

    builder.Services.AddApplicationLayer();
    builder.Services.AddInfrastructureLayer(builder.Configuration);
    builder.Services.AddJwtAuthentication(builder.Configuration);

    /* -------------------------------------- MVC ----------------------------------------- */
    builder.Services
        .AddControllers(options => options.SuppressAsyncSuffixInActionNames = false)
        .AddJsonOptions(options =>
        {
            options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
            options.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
            options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
        });

    builder.Services.AddFluentValidationAutoValidation();

    // Replace the default ProblemDetails 400 with the application's ApiResponse envelope, so the
    // React client parses exactly one error shape regardless of where validation failed.
    builder.Services.Configure<ApiBehaviorOptions>(options =>
    {
        options.InvalidModelStateResponseFactory = context =>
        {
            var errors = context.ModelState
                .Where(kv => kv.Value?.Errors.Count > 0)
                .ToDictionary(
                    kv => JsonNamingPolicy.CamelCase.ConvertName(kv.Key),
                    kv => kv.Value!.Errors.Select(e => e.ErrorMessage).ToArray());

            return new BadRequestObjectResult(ApiResponse<object>.Fail(
                "One or more validation errors occurred.", errors, context.HttpContext.TraceIdentifier));
        };
    });

    /* -------------------------------------- CORS ---------------------------------------- */
    var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
    builder.Services.AddCors(options => options.AddPolicy("SpaClient", policy =>
    {
        if (allowedOrigins.Length == 0)
        {
            // Fail loudly in configuration rather than silently allowing any origin.
            throw new InvalidOperationException("Cors:AllowedOrigins must list the SPA origin(s).");
        }

        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .WithExposedHeaders("X-Correlation-Id", "Content-Disposition");
    }));

    /* ------------------------------------- SWAGGER -------------------------------------- */
    builder.Services.AddEndpointsApiExplorer();
    builder.Services.AddSwaggerGen(options =>
    {
        options.SwaggerDoc("v1", new OpenApiInfo
        {
            Title = "DSR & Resource Management API",
            Version = "v1",
            Description =
                "Employee Daily Status Report and resource tracking.\n\n" +
                "**DSR grain:** one entry per employee, per date, per project. To log three projects " +
                "on one date, POST /api/dsr three times. There is no header/detail payload.\n\n" +
                "**AI usage** is declared once per employee per date and is upserted by any DSR save " +
                "for that date."
        });

        options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
        {
            Name = "Authorization",
            Type = SecuritySchemeType.Http,
            Scheme = "bearer",
            BearerFormat = "JWT",
            In = ParameterLocation.Header,
            Description = "Paste the accessToken returned by /api/auth/login (no 'Bearer ' prefix needed)."
        });

        options.AddSecurityRequirement(new OpenApiSecurityRequirement
        {
            [new OpenApiSecurityScheme { Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" } }] = []
        });

        var xmlPath = Path.Combine(AppContext.BaseDirectory, $"{typeof(Program).Assembly.GetName().Name}.xml");
        if (File.Exists(xmlPath)) options.IncludeXmlComments(xmlPath, includeControllerXmlComments: true);
    });

    /* ------------------------------------- HEALTH --------------------------------------- */
    builder.Services.AddHealthChecks()
        .AddDbContextCheck<DsrDbContext>("database", tags: ["ready"]);

    // Correct client IP when hosted behind a reverse proxy or Azure App Service.
    builder.Services.Configure<ForwardedHeadersOptions>(options =>
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.KnownNetworks.Clear();
        options.KnownProxies.Clear();
    });

    var app = builder.Build();

    /* ------------------------------------ PIPELINE -------------------------------------- */
    app.UseForwardedHeaders();
    app.UseMiddleware<CorrelationIdMiddleware>();

    // Registered before everything else so no unhandled exception escapes as an HTML error page.
    app.UseMiddleware<ExceptionHandlingMiddleware>();

    app.UseSerilogRequestLogging(options =>
    {
        options.MessageTemplate = "{RequestMethod} {RequestPath} responded {StatusCode} in {Elapsed:0.0} ms";
        options.GetLevel = (httpContext, elapsed, ex) =>
            ex is not null || httpContext.Response.StatusCode >= 500 ? LogEventLevel.Error
            : httpContext.Response.StatusCode >= 400 ? LogEventLevel.Warning
            : elapsed > 2000 ? LogEventLevel.Warning        // surface slow requests
            : LogEventLevel.Information;
    });

    if (app.Environment.IsDevelopment() || app.Configuration.GetValue("Swagger:Enabled", false))
    {
        app.UseSwagger();
        app.UseSwaggerUI(options =>
        {
            options.SwaggerEndpoint("/swagger/v1/swagger.json", "DSR API v1");
            options.DocumentTitle = "DSR & Resource Management API";
            options.DisplayRequestDuration();
        });
    }

    if (!app.Environment.IsDevelopment())
    {
        app.UseHsts();
        app.UseHttpsRedirection();
    }

    // Baseline security headers. A SPA served separately does not need a CSP here, but these three
    // are cheap and close off MIME sniffing, framing and referrer leakage.
    app.Use(async (context, next) =>
    {
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
        context.Response.Headers["X-Frame-Options"] = "DENY";
        context.Response.Headers["Referrer-Policy"] = "no-referrer";
        await next();
    });

    app.UseCors("SpaClient");
    app.UseAuthentication();
    app.UseAuthorization();

    app.MapControllers();
    app.MapHealthChecks("/health/live");
    app.MapHealthChecks("/health/ready", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions
    {
        Predicate = check => check.Tags.Contains("ready")
    });

    /* --------------------------- STARTUP SCHEMA VERIFICATION ---------------------------- */
    // The database is owned by the SQL scripts, not EF migrations. Verify connectivity and that the
    // expected objects exist, so a misconfigured environment fails at startup with a clear message
    // rather than on the first user request.
    await using (var scope = app.Services.CreateAsyncScope())
    {
        var context = scope.ServiceProvider.GetRequiredService<DsrDbContext>();
        var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();

        try
        {
            if (!await context.Database.CanConnectAsync())
                throw new InvalidOperationException("The database is unreachable with the configured connection string.");

            var roleCount = await context.Roles.CountAsync();
            var toolCount = await context.AiTools.CountAsync();

            logger.LogInformation(
                "Database verified. Roles={RoleCount}, AiTools={ToolCount}. Schema is managed by the SQL scripts in /database.",
                roleCount, toolCount);
        }
        catch (Exception ex)
        {
            logger.LogCritical(ex,
                "Database verification failed. Confirm ConnectionStrings:DefaultConnection and that scripts " +
                "01-04 in /database have been executed against DSRResourceManagement.");
            throw;
        }
    }

    Log.Information("DSR API started in {Environment}", app.Environment.EnvironmentName);
    await app.RunAsync();
    return 0;
}
catch (Exception ex)
{
    Log.Fatal(ex, "The DSR API terminated unexpectedly during startup");
    return 1;
}
finally
{
    await Log.CloseAndFlushAsync();
}
