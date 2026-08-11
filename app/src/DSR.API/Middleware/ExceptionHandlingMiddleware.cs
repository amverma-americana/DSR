using System.Net;
using DSR.Application.Common;
using FluentValidation;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace DSR.API.Middleware;

/// <summary>
/// Single exit point for every unhandled exception. Controllers therefore contain no try/catch and
/// never set an error status code themselves.
///
/// Two things matter here for production:
///   1. Internal details (stack traces, SQL text, constraint names) are logged but NEVER returned.
///      The client receives a stable message plus the trace id to quote to support.
///   2. Database-level violations are translated into the same friendly messages the service layer
///      produces, so a rule enforced only by a trigger still reads sensibly to the user.
/// </summary>
public class ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
{
    /// <summary>Custom trigger error numbers raised by the DSR schema.</summary>
    private const int DailyHoursCapExceeded = 51001;
    private const int NoWorkDoneConflict = 51002;
    private const int ProjectWindowViolation = 51003;
    private const int AuditLogImmutable = 51010;
    private const int LoginAuditImmutable = 51011;

    private const int SqlUniqueViolation = 2627;
    private const int SqlUniqueIndexViolation = 2601;
    private const int SqlCheckViolation = 547;

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (Exception ex)
        {
            await HandleAsync(context, ex);
        }
    }

    private async Task HandleAsync(HttpContext context, Exception exception)
    {
        var traceId = context.TraceIdentifier;

        var (status, message, errors) = exception switch
        {
            ValidationAppException v => (HttpStatusCode.BadRequest, v.Message, v.Errors),

            // FluentValidation failures raised outside the model-binding filter
            ValidationException fv => (HttpStatusCode.BadRequest, "One or more validation errors occurred.",
                (IReadOnlyDictionary<string, string[]>?)fv.Errors
                    .GroupBy(e => e.PropertyName)
                    .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorMessage).ToArray())),

            AppException app => (app.StatusCode, app.Message, null),

            DbUpdateConcurrencyException => (HttpStatusCode.Conflict,
                "This record was changed by someone else while you were editing it. Reload and try again.", null),

            DbUpdateException dbe => TranslateDatabaseError(dbe),

            OperationCanceledException => (HttpStatusCode.RequestTimeout, "The request was cancelled.", null),

            _ => (HttpStatusCode.InternalServerError,
                "An unexpected error occurred. Quote the trace id when contacting support.", null)
        };

        // 5xx is a defect; 4xx is expected traffic. Log accordingly so alerting stays meaningful.
        if ((int)status >= 500)
            logger.LogError(exception, "Unhandled exception on {Method} {Path}. TraceId={TraceId}",
                context.Request.Method, context.Request.Path, traceId);
        else
            logger.LogWarning("{Status} on {Method} {Path}: {Message}. TraceId={TraceId}",
                (int)status, context.Request.Method, context.Request.Path, exception.Message, traceId);

        if (context.Response.HasStarted)
        {
            logger.LogWarning("Response already started; cannot write error body. TraceId={TraceId}", traceId);
            return;
        }

        context.Response.Clear();
        context.Response.StatusCode = (int)status;
        context.Response.ContentType = "application/json";

        await context.Response.WriteAsJsonAsync(
            ApiResponse<object>.Fail(message, errors, traceId));
    }

    /// <summary>
    /// Turns SQL Server constraint and trigger violations into the same messages a user would get
    /// from the service layer, so the database acting as the last line of defence is not visible
    /// as a raw error.
    /// </summary>
    private static (HttpStatusCode, string, IReadOnlyDictionary<string, string[]>?) TranslateDatabaseError(DbUpdateException exception)
    {
        if (exception.InnerException is not SqlException sql)
            return (HttpStatusCode.BadRequest, "The change could not be saved.", null);

        return sql.Number switch
        {
            DailyHoursCapExceeded => (HttpStatusCode.UnprocessableEntity,
                "Total hours for this date exceed the employee's standard daily hours.", null),

            NoWorkDoneConflict => (HttpStatusCode.UnprocessableEntity,
                "A 'No Work Done' declaration cannot coexist with other DSR entries on the same date.", null),

            ProjectWindowViolation => (HttpStatusCode.UnprocessableEntity,
                "The work date falls outside the project window, or the project is not open for effort logging.", null),

            AuditLogImmutable or LoginAuditImmutable => (HttpStatusCode.Forbidden,
                "Audit records are append-only and cannot be modified.", null),

            SqlUniqueViolation or SqlUniqueIndexViolation => (HttpStatusCode.Conflict,
                TranslateUniqueViolation(sql.Message), null),

            SqlCheckViolation => (HttpStatusCode.UnprocessableEntity,
                "The value supplied violates a data rule. Check hours, dates and required fields.", null),

            _ => (HttpStatusCode.BadRequest, "The change could not be saved.", null)
        };
    }

    private static string TranslateUniqueViolation(string sqlMessage) => sqlMessage switch
    {
        // Note: there is deliberately no mapping for a duplicate (user, date, project) any more.
        // Migration 06 removed that unique index; multiple entries per project per day are valid.
        var m when m.Contains("UQ_DSREntries_User_Date_NoWork", StringComparison.OrdinalIgnoreCase)
            => "A 'No Work Done' declaration already exists for this date.",
        var m when m.Contains("UQ_DailyAiUsage_User_WorkDate", StringComparison.OrdinalIgnoreCase)
            => "An AI usage declaration already exists for this date.",
        var m when m.Contains("UQ_Users_Email", StringComparison.OrdinalIgnoreCase)
            => "A user with this email address already exists.",
        var m when m.Contains("UQ_Users_EmployeeCode", StringComparison.OrdinalIgnoreCase)
            => "A user with this employee code already exists.",
        var m when m.Contains("UQ_Users_ExternalObjectId", StringComparison.OrdinalIgnoreCase)
            => "Another account is already linked to this single sign-on identity.",
        var m when m.Contains("UQ_Projects_ProjectCode", StringComparison.OrdinalIgnoreCase)
            => "This project code is already in use.",
        var m when m.Contains("UQ_Projects_ProjectName", StringComparison.OrdinalIgnoreCase)
            => "This project name is already in use.",
        _ => "A record with these details already exists."
    };
}

/// <summary>Writes a request-scoped correlation id into the response and the log context.</summary>
public class CorrelationIdMiddleware(RequestDelegate next)
{
    private const string HeaderName = "X-Correlation-Id";

    public async Task InvokeAsync(HttpContext context)
    {
        var correlationId = context.Request.Headers[HeaderName].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(correlationId)) correlationId = context.TraceIdentifier;

        context.Response.OnStarting(() =>
        {
            context.Response.Headers[HeaderName] = correlationId;
            return Task.CompletedTask;
        });

        using (Serilog.Context.LogContext.PushProperty("CorrelationId", correlationId))
        {
            await next(context);
        }
    }
}
