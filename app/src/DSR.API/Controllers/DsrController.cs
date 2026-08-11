using DSR.Application.Common;
using DSR.Application.DTOs;
using DSR.Application.Interfaces;
using DSR.Domain.Common;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DSR.API.Controllers;

/// <summary>
/// Daily Status Report entries.
///
/// The POST endpoint is called once per project: an employee working three projects on one date
/// issues three POSTs and receives three independent entries. There is no batch/header endpoint,
/// deliberately, so the API shape matches the storage grain and the UI's Save button.
///
/// Data scope is enforced inside the service from the JWT, not from route or body parameters.
/// </summary>
[Authorize]
[Route("api/dsr")]
public class DsrController(IDsrEntryService service) : ApiControllerBase
{
    /// <summary>
    /// Dropdowns, the daily hour cap and the permitted work-date range, in one call.
    /// Pass the work date currently selected on the form: the project list is filtered to those
    /// that actually accept effort on that date, so the dropdown can never offer a project the
    /// save would reject. Defaults to today when omitted.
    /// </summary>
    [HttpGet("metadata")]
    [ProducesResponseType(typeof(ApiResponse<DsrFormMetadataDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<DsrFormMetadataDto>>> GetMetadata([FromQuery] DateOnly? workDate, CancellationToken ct) =>
        Success(await service.GetFormMetadataAsync(workDate, ct));

    /// <summary>
    /// All entries for one employee on one date, with the running total and that day's single AI
    /// declaration. This is what the DSR screen loads when a work date is chosen.
    /// </summary>
    [HttpGet("day/{workDate}")]
    [ProducesResponseType(typeof(ApiResponse<DsrDayDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<DsrDayDto>>> GetDay(DateOnly workDate, [FromQuery] int? userId, CancellationToken ct) =>
        Success(await service.GetDayAsync(workDate, userId, ct));

    /// <summary>Paged DSR history. Employees see their own; managers their team; admins everything.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(ApiResponse<PagedResult<DsrEntryDto>>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<PagedResult<DsrEntryDto>>>> Search([FromQuery] DsrEntryFilter filter, CancellationToken ct) =>
        Success(await service.SearchAsync(filter, ct));

    [HttpGet("{id:int}")]
    [ProducesResponseType(typeof(ApiResponse<DsrEntryDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ApiResponse<DsrEntryDto>>> GetById(int id, CancellationToken ct) =>
        Success(await service.GetByIdAsync(id, ct));

    /// <summary>
    /// Save one DSR entry for one project. Call once per project on the same date.
    /// Returns 409 when an entry already exists for that project and date, and 422 when the day's
    /// total would exceed the configured maximum.
    /// </summary>
    [HttpPost]
    [ProducesResponseType(typeof(ApiResponse<DsrEntryDto>), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status422UnprocessableEntity)]
    public async Task<ActionResult<ApiResponse<DsrEntryDto>>> Create([FromBody] CreateDsrEntryRequest request, CancellationToken ct) =>
        Created(await service.CreateAsync(request, ct), "DSR entry saved.");

    /// <summary>Update an entry. Work date and employee are immutable; delete and re-create instead.</summary>
    [HttpPut("{id:int}")]
    [ProducesResponseType(typeof(ApiResponse<DsrEntryDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<DsrEntryDto>>> Update(int id, [FromBody] UpdateDsrEntryRequest request, CancellationToken ct) =>
        Success(await service.UpdateAsync(id, request, ct), "DSR entry updated.");

    /// <summary>Soft-delete an entry, freeing the project slot on that date for reuse.</summary>
    [HttpDelete("{id:int}")]
    [ProducesResponseType(typeof(ApiResponse<string>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<string>>> Delete(int id, CancellationToken ct)
    {
        await service.DeleteAsync(id, ct);
        return Success("Deleted.", "DSR entry removed.");
    }
}

/// <summary>Role dashboards. Each endpoint is scoped to the role that owns that view.</summary>
[Authorize]
[Route("api/dashboard")]
public class DashboardController(IReportingService reporting) : ApiControllerBase
{
    /// <summary>Employee dashboard: today, this week, this month, missing days and AI adoption.</summary>
    [HttpGet("employee")]
    [ProducesResponseType(typeof(ApiResponse<EmployeeDashboardDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<EmployeeDashboardDto>>> Employee(CancellationToken ct) =>
        Success(await reporting.GetEmployeeDashboardAsync(ct));

    /// <summary>Manager dashboard: team utilization, missing DSRs, project effort, AI adoption.</summary>
    [Authorize(Roles = RoleCodes.AdminOrManager)]
    [HttpGet("manager")]
    [ProducesResponseType(typeof(ApiResponse<ManagerDashboardDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<ManagerDashboardDto>>> Manager([FromQuery] ReportFilter filter, CancellationToken ct) =>
        Success(await reporting.GetManagerDashboardAsync(filter, ct));

    /// <summary>Organisation-wide dashboard.</summary>
    [Authorize(Roles = RoleCodes.Admin)]
    [HttpGet("admin")]
    [ProducesResponseType(typeof(ApiResponse<AdminDashboardDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<AdminDashboardDto>>> Admin(CancellationToken ct) =>
        Success(await reporting.GetAdminDashboardAsync(ct));
}

/// <summary>
/// The six BRD reports plus the missing-DSR compliance view and CSV export.
///
/// AUTHORISATION: reporting is restricted to ADMIN and MANAGER. The Employee role has NO access to
/// any report endpoint, including CSV export. This is enforced once at the controller level rather
/// than per action, so a newly added report cannot accidentally be left open to Employees.
///
/// An Employee still sees their own recorded work through GET /api/dsr (their DSR history) and the
/// employee dashboard, which are their own data-entry views rather than reports.
///
/// Row-level scope still applies on top of the role check: a Manager sees only their direct reports.
/// </summary>
[Authorize(Roles = RoleCodes.AdminOrManager)]
[Route("api/reports")]
public class ReportsController(IReportingService reporting) : ApiControllerBase
{
    [HttpGet("employee")]
    public async Task<ActionResult<ApiResponse<PagedResult<EmployeeReportRowDto>>>> Employee([FromQuery] ReportFilter filter, CancellationToken ct) =>
        Success(await reporting.GetEmployeeReportAsync(filter, ct));

    [HttpGet("project")]
    public async Task<ActionResult<ApiResponse<PagedResult<ProjectReportRowDto>>>> Project([FromQuery] ReportFilter filter, CancellationToken ct) =>
        Success(await reporting.GetProjectReportAsync(filter, ct));

    [HttpGet("resource-utilization")]
    public async Task<ActionResult<ApiResponse<PagedResult<ResourceUtilizationRowDto>>>> Utilization([FromQuery] ReportFilter filter, CancellationToken ct) =>
        Success(await reporting.GetResourceUtilizationAsync(filter, ct));

    [HttpGet("ai-usage")]
    public async Task<ActionResult<ApiResponse<AiUsageReportDto>>> AiUsage([FromQuery] ReportFilter filter, CancellationToken ct) =>
        Success(await reporting.GetAiUsageReportAsync(filter, ct));

    [HttpGet("daily-summary")]
    public async Task<ActionResult<ApiResponse<PagedResult<DailySummaryRowDto>>>> DailySummary([FromQuery] ReportFilter filter, CancellationToken ct) =>
        Success(await reporting.GetDailySummaryAsync(filter, ct));

    [HttpGet("monthly-summary")]
    public async Task<ActionResult<ApiResponse<PagedResult<MonthlySummaryRowDto>>>> MonthlySummary([FromQuery] ReportFilter filter, CancellationToken ct) =>
        Success(await reporting.GetMonthlySummaryAsync(filter, ct));

    /// <summary>
    /// Missing DSR days, excluding weekends, mandatory holidays and pre-joining dates.
    /// Inherits the controller-level ADMIN/MANAGER restriction: this previously carried
    /// RoleCodes.All, which widened it back open to Employees.
    /// </summary>
    [HttpGet("missing-dsr")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<MissingDsrRowDto>>>> MissingDsr([FromQuery] ReportFilter filter, CancellationToken ct) =>
        Success(await reporting.GetMissingDsrAsync(filter, ct));

    /// <summary>
    /// CSV export. reportKey: employee | project | utilization | daily | monthly | ai | missing.
    /// Capped at 5,000 rows so an export cannot become a full table dump.
    /// </summary>
    [HttpGet("export/{reportKey}")]
    [Produces("text/csv")]
    public async Task<IActionResult> Export(string reportKey, [FromQuery] ReportFilter filter, CancellationToken ct)
    {
        var (fileName, contentType, content) = await reporting.ExportAsync(reportKey, filter, ct);
        return File(content, contentType, fileName);
    }
}
