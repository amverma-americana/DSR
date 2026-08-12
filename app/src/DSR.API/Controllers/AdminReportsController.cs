using DSR.Application.Common;
using DSR.Application.DTOs;
using DSR.Application.Interfaces;
using DSR.Domain.Common;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DSR.API.Controllers;

/// <summary>
/// Admin reporting module: complete employee DSR detail with advanced filters, grouped roll-ups,
/// approval workflow, missing-DSR compliance and Excel/CSV export.
///
/// ADMIN and MANAGER only — Employees have no report rights. A Manager's results are additionally
/// scoped to their own direct reports inside the service, so the role check is not the only barrier.
/// </summary>
[Authorize(Roles = RoleCodes.AdminOrManager)]
[Route("api/admin-reports")]
public class AdminReportsController(IDetailReportService service) : ApiControllerBase
{
    /// <summary>
    /// Complete DSR detail: employee, department, manager, project, task, hours and approval state.
    /// Returns the requested page plus totals computed over the WHOLE filtered set.
    /// </summary>
    [HttpGet("dsr-details")]
    [ProducesResponseType(typeof(ApiResponse<DsrDetailReportDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<DsrDetailReportDto>>> DsrDetails(
        [FromQuery] DsrDetailReportFilter filter, CancellationToken ct) =>
        Success(await service.GetDetailReportAsync(filter, ct));

    /// <summary>
    /// Grouped roll-up over the same filter.
    /// groupBy: employee | project | department | manager | category.
    /// </summary>
    [HttpGet("grouped/{groupBy}")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<GroupedReportRowDto>>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<GroupedReportRowDto>>>> Grouped(
        string groupBy, [FromQuery] DsrDetailReportFilter filter, CancellationToken ct) =>
        Success(await service.GetGroupedReportAsync(groupBy, filter, ct));

    // Approval workflow disabled as per current business requirement.
    // All DSR entries are treated as automatically approved.
    //
    // This endpoint reported counts and ageing per approval state. With no workflow every row sits
    // in the same state, so it would report "everything pending, nothing approved" -- actively
    // misleading rather than merely redundant. Commented out with its UI tab.
    /*
    /// <summary>Counts, hours and ageing per approval state.</summary>
    [HttpGet("approval-status")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<ApprovalStatusReportRowDto>>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ApprovalStatusReportRowDto>>>> ApprovalStatus(
        [FromQuery] DsrDetailReportFilter filter, CancellationToken ct) =>
        Success(await service.GetApprovalStatusReportAsync(filter, ct));
    */

    /// <summary>
    /// No Work Done report. A thin wrapper over the detail report with the flag forced on, so it
    /// shares every filter and the same totals.
    /// </summary>
    [HttpGet("no-work-done")]
    [ProducesResponseType(typeof(ApiResponse<DsrDetailReportDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<DsrDetailReportDto>>> NoWorkDone(
        [FromQuery] DsrDetailReportFilter filter, CancellationToken ct)
    {
        filter.IsNoWorkDone = true;
        return Success(await service.GetDetailReportAsync(filter, ct));
    }

    /// <summary>
    /// Employees with no DSR on a working day, with manager and department.
    /// Weekends, mandatory holidays, pre-joining/post-exit dates, service accounts and future dates
    /// are all excluded. Omit the dates to default to the last 30 days; pass the same date twice
    /// for a single day such as "missed today".
    /// </summary>
    [HttpGet("missing-dsr")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<MissingDsrDetailRowDto>>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<MissingDsrDetailRowDto>>>> MissingDsr(
        [FromQuery] DsrDetailReportFilter filter, CancellationToken ct) =>
        Success(await service.GetMissingDsrDetailAsync(filter, ct));

    // ---------------------------------------------------------------------------------------------
    // Approval workflow disabled as per current business requirement.
    // All DSR entries are treated as automatically approved.
    //
    // The POST /api/admin-reports/review endpoint is the ONLY write path that ever changed a
    // StatusCode, so with it commented out no entry can move off the default 'SUBMITTED' state.
    // Nothing gates reporting or admin visibility on that column, which is why "automatically
    // approved" needs no data change: logged hours are already visible the moment they are saved.
    //
    // To reactivate: uncomment this endpoint, ReviewAsync in IDetailReportService and
    // DetailReportService, the ReviewDsrEntriesRequest DTO, and the client's adminReportsApi.review.
    // ---------------------------------------------------------------------------------------------
    /*
    /// <summary>Approve or return one or more DSR entries. Returning requires a comment.</summary>
    [HttpPost("review")]
    [ProducesResponseType(typeof(ApiResponse<int>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<ApiResponse<int>>> Review([FromBody] ReviewDsrEntriesRequest request, CancellationToken ct)
    {
        var affected = await service.ReviewAsync(request, ct);
        return Success(affected, $"{affected} DSR entr{(affected == 1 ? "y" : "ies")} updated.");
    }
    */

    /// <summary>
    /// Export the filtered detail report. format: xlsx | csv.
    /// Exports the entire filtered set (capped at 20,000 rows), not just the visible page.
    /// </summary>
    [HttpGet("export/{format}")]
    public async Task<IActionResult> Export(string format, [FromQuery] DsrDetailReportFilter filter, CancellationToken ct)
    {
        var (fileName, contentType, content) = await service.ExportDetailAsync(format, filter, ct);
        return File(content, contentType, fileName);
    }
}
