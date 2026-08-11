using System.Globalization;
using System.Text;
using ClosedXML.Excel;
using DSR.Application.Common;
using DSR.Application.DTOs;
using DSR.Application.Interfaces;
using DSR.Domain.Common;
using DSR.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace DSR.Application.Services;

/// <summary>
/// The Admin reporting module: full DSR detail, four grouped roll-ups, approval-status and
/// No-Work-Done reports, missing DSR, and Excel/CSV export.
///
/// Everything is composed from ONE queryable over dsr.vw_DsrDetailReport, so a filter behaves
/// identically no matter which report or export it is applied to. Aggregation is pushed to SQL;
/// only the current page of rows is materialised.
///
/// Scope is applied before any client filter: Admin sees everything, Manager sees their own team.
/// Employees never reach here (ReportsController requires ADMIN or MANAGER).
/// </summary>
public class DetailReportService(
    IDetailReportRepository repository,
    IUnitOfWork uow,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IAuditService audit) : IDetailReportService
{
    public async Task<DsrDetailReportDto> GetDetailReportAsync(DsrDetailReportFilter filter, CancellationToken ct = default)
    {
        var query = BuildQuery(filter);

        // Totals are computed over the ENTIRE filtered set, not the page, so the footer is honest.
        var summary = await BuildSummaryAsync(query, ct);

        var totalCount = summary.TotalEntries;
        var ordered = ApplySort(query, filter);

        var rows = await ordered
            .Skip((filter.Page - 1) * filter.PageSize)
            .Take(filter.PageSize)
            .Select(v => new DsrDetailReportRowDto
            {
                UserId = v.UserId,
                EmployeeName = v.EmployeeName,
                EmployeeCode = v.EmployeeCode,
                EmployeeEmail = v.EmployeeEmail,
                DepartmentName = v.DepartmentName,
                Designation = v.Designation,
                ManagerName = v.ManagerName,
                ProjectId = v.ProjectId,
                ProjectName = v.ProjectName,
                ProjectCode = v.ProjectCode,
                ProjectStartDate = v.ProjectStartDate,
                ProjectEndDate = v.ProjectEndDate,
                ProjectStatus = v.ProjectStatus,
                DsrEntryId = v.DsrEntryId,
                TaskDescription = v.TaskDescription,
                WorkCategoryName = v.WorkCategoryName,
                HoursLogged = v.HoursLogged,
                EstimatedHours = v.EstimatedHours,
                RemainingHours = v.RemainingHours,
                TaskEntryDate = v.TaskEntryDate,
                DsrDate = v.WorkDate,
                SubmissionDate = v.SubmittedOn,
                StatusCode = v.StatusCode,
                ApprovalStatus = v.ApprovalStatus,
                ApprovedBy = v.ApprovedByName,
                ApprovalDate = v.ApprovalDate,
                ReviewComments = v.ReviewComments,
                IsNoWorkDone = v.IsNoWorkDone,
                IsAiUsed = v.IsAiUsed,
                AiToolName = v.AiToolName
            })
            .ToListAsync(ct);

        return new DsrDetailReportDto
        {
            Rows = PagedResult<DsrDetailReportRowDto>.Create(rows, totalCount, filter.Page, filter.PageSize),
            Summary = summary
        };
    }

    /* ------------------------------ GROUPED ROLL-UPS ------------------------------ */

    public async Task<IReadOnlyList<GroupedReportRowDto>> GetGroupedReportAsync(
        string groupBy, DsrDetailReportFilter filter, CancellationToken ct = default)
    {
        var query = BuildQuery(filter);
        var grandTotal = await query.SumAsync(v => (decimal?)v.HoursLogged, ct) ?? 0m;

        // Each branch groups the SAME filtered queryable, so employee-wise and department-wise
        // views of one filter always reconcile to the same grand total.
        List<GroupedReportRowDto> rows = groupBy.ToLowerInvariant() switch
        {
            "employee" => await query
                .GroupBy(v => new { v.UserId, v.EmployeeName, v.EmployeeCode, v.DepartmentName })
                .Select(g => new GroupedReportRowDto
                {
                    GroupId = g.Key.UserId,
                    GroupName = g.Key.EmployeeName,
                    GroupSubtitle = g.Key.EmployeeCode ?? g.Key.DepartmentName,
                    EntryCount = g.Count(),
                    EmployeeCount = 1,
                    ProjectCount = g.Where(x => x.ProjectId != null).Select(x => x.ProjectId).Distinct().Count(),
                    DaysLogged = g.Select(x => x.WorkDate).Distinct().Count(),
                    TotalHoursLogged = g.Sum(x => x.HoursLogged),
                    TotalEstimatedHours = g.Sum(x => x.EstimatedHours),
                    NoWorkDoneCount = g.Count(x => x.IsNoWorkDone),
                    PendingApprovalCount = g.Count(x => x.StatusCode == "SUBMITTED"),
                    ApprovedCount = g.Count(x => x.StatusCode == "APPROVED"),
                    ReturnedCount = g.Count(x => x.StatusCode == "RETURNED")
                }).ToListAsync(ct),

            "project" => await query.Where(v => v.ProjectId != null)
                .GroupBy(v => new { v.ProjectId, v.ProjectName, v.ProjectCode, v.ProjectStatus })
                .Select(g => new GroupedReportRowDto
                {
                    GroupId = g.Key.ProjectId,
                    GroupName = g.Key.ProjectName!,
                    GroupSubtitle = g.Key.ProjectCode + " · " + g.Key.ProjectStatus,
                    EntryCount = g.Count(),
                    EmployeeCount = g.Select(x => x.UserId).Distinct().Count(),
                    ProjectCount = 1,
                    DaysLogged = g.Select(x => x.WorkDate).Distinct().Count(),
                    TotalHoursLogged = g.Sum(x => x.HoursLogged),
                    TotalEstimatedHours = g.Sum(x => x.EstimatedHours),
                    NoWorkDoneCount = g.Count(x => x.IsNoWorkDone),
                    PendingApprovalCount = g.Count(x => x.StatusCode == "SUBMITTED"),
                    ApprovedCount = g.Count(x => x.StatusCode == "APPROVED"),
                    ReturnedCount = g.Count(x => x.StatusCode == "RETURNED")
                }).ToListAsync(ct),

            "department" => await query
                .GroupBy(v => new { v.DepartmentId, v.DepartmentName })
                .Select(g => new GroupedReportRowDto
                {
                    GroupId = g.Key.DepartmentId,
                    GroupName = g.Key.DepartmentName ?? "(no department)",
                    EntryCount = g.Count(),
                    EmployeeCount = g.Select(x => x.UserId).Distinct().Count(),
                    ProjectCount = g.Where(x => x.ProjectId != null).Select(x => x.ProjectId).Distinct().Count(),
                    DaysLogged = g.Select(x => x.WorkDate).Distinct().Count(),
                    TotalHoursLogged = g.Sum(x => x.HoursLogged),
                    TotalEstimatedHours = g.Sum(x => x.EstimatedHours),
                    NoWorkDoneCount = g.Count(x => x.IsNoWorkDone),
                    PendingApprovalCount = g.Count(x => x.StatusCode == "SUBMITTED"),
                    ApprovedCount = g.Count(x => x.StatusCode == "APPROVED"),
                    ReturnedCount = g.Count(x => x.StatusCode == "RETURNED")
                }).ToListAsync(ct),

            "manager" => await query
                .GroupBy(v => new { v.ManagerUserId, v.ManagerName })
                .Select(g => new GroupedReportRowDto
                {
                    GroupId = g.Key.ManagerUserId,
                    GroupName = g.Key.ManagerName ?? "(no manager)",
                    EntryCount = g.Count(),
                    EmployeeCount = g.Select(x => x.UserId).Distinct().Count(),
                    ProjectCount = g.Where(x => x.ProjectId != null).Select(x => x.ProjectId).Distinct().Count(),
                    DaysLogged = g.Select(x => x.WorkDate).Distinct().Count(),
                    TotalHoursLogged = g.Sum(x => x.HoursLogged),
                    TotalEstimatedHours = g.Sum(x => x.EstimatedHours),
                    NoWorkDoneCount = g.Count(x => x.IsNoWorkDone),
                    PendingApprovalCount = g.Count(x => x.StatusCode == "SUBMITTED"),
                    ApprovedCount = g.Count(x => x.StatusCode == "APPROVED"),
                    ReturnedCount = g.Count(x => x.StatusCode == "RETURNED")
                }).ToListAsync(ct),

            "category" => await query
                .GroupBy(v => new { v.WorkCategoryId, v.WorkCategoryName })
                .Select(g => new GroupedReportRowDto
                {
                    GroupId = g.Key.WorkCategoryId,
                    GroupName = g.Key.WorkCategoryName ?? "(uncategorised)",
                    EntryCount = g.Count(),
                    EmployeeCount = g.Select(x => x.UserId).Distinct().Count(),
                    ProjectCount = g.Where(x => x.ProjectId != null).Select(x => x.ProjectId).Distinct().Count(),
                    DaysLogged = g.Select(x => x.WorkDate).Distinct().Count(),
                    TotalHoursLogged = g.Sum(x => x.HoursLogged),
                    TotalEstimatedHours = g.Sum(x => x.EstimatedHours),
                    NoWorkDoneCount = g.Count(x => x.IsNoWorkDone),
                    PendingApprovalCount = g.Count(x => x.StatusCode == "SUBMITTED"),
                    ApprovedCount = g.Count(x => x.StatusCode == "APPROVED"),
                    ReturnedCount = g.Count(x => x.StatusCode == "RETURNED")
                }).ToListAsync(ct),

            _ => throw new ValidationAppException(nameof(groupBy),
                "groupBy must be one of: employee, project, department, manager, category.")
        };

        foreach (var row in rows)
        {
            row.AverageHoursPerDay = row.DaysLogged == 0 ? 0 : Math.Round(row.TotalHoursLogged / row.DaysLogged, 2);
            row.SharePct = grandTotal == 0 ? 0 : Math.Round(row.TotalHoursLogged * 100m / grandTotal, 2);
        }

        return rows.OrderByDescending(r => r.TotalHoursLogged).ToList();
    }

    public async Task<IReadOnlyList<ApprovalStatusReportRowDto>> GetApprovalStatusReportAsync(
        DsrDetailReportFilter filter, CancellationToken ct = default)
    {
        var query = BuildQuery(filter);
        var total = await query.CountAsync(ct);
        var today = clock.TodayUtc;

        var rows = await query
            .GroupBy(v => new { v.StatusCode, v.ApprovalStatus })
            .Select(g => new
            {
                g.Key.StatusCode,
                g.Key.ApprovalStatus,
                EntryCount = g.Count(),
                EmployeeCount = g.Select(x => x.UserId).Distinct().Count(),
                TotalHours = g.Sum(x => x.HoursLogged),
                Oldest = g.Min(x => x.WorkDate)
            })
            .ToListAsync(ct);

        return rows.Select(r => new ApprovalStatusReportRowDto
        {
            StatusCode = r.StatusCode,
            ApprovalStatus = r.ApprovalStatus,
            EntryCount = r.EntryCount,
            EmployeeCount = r.EmployeeCount,
            TotalHours = r.TotalHours,
            SharePct = total == 0 ? 0 : Math.Round(r.EntryCount * 100m / total, 2),
            OldestAgeDays = today.DayNumber - r.Oldest.DayNumber
        })
        .OrderByDescending(r => r.EntryCount)
        .ToList();
    }

    public async Task<IReadOnlyList<MissingDsrDetailRowDto>> GetMissingDsrDetailAsync(
        DsrDetailReportFilter filter, CancellationToken ct = default)
    {
        var (from, to) = ResolvePeriod(filter);

        // A DSR cannot be "missing" for a date that has not happened yet.
        if (to > clock.TodayUtc) to = clock.TodayUtc;
        if (from > to) return [];

        int? managerScope = currentUser.IsAdmin ? filter.ManagerUserId : currentUser.RequireUserId();

        var raw = await repository.GetMissingDsrDetail(from, to, managerScope, filter.DepartmentId)
            .Where(m => filter.UserId == null || m.UserId == filter.UserId)
            .ToListAsync(ct);

        if (!string.IsNullOrWhiteSpace(filter.Search))
        {
            var term = filter.Search.Trim();
            raw = raw.Where(m =>
                m.EmployeeName.Contains(term, StringComparison.OrdinalIgnoreCase)
                || (m.EmployeeCode ?? "").Contains(term, StringComparison.OrdinalIgnoreCase)
                || m.EmployeeEmail.Contains(term, StringComparison.OrdinalIgnoreCase)).ToList();
        }

        return raw
            .GroupBy(m => new { m.UserId, m.EmployeeCode, m.EmployeeName, m.EmployeeEmail, m.Designation, m.ManagerName, m.DepartmentName })
            .Select(g => new MissingDsrDetailRowDto
            {
                UserId = g.Key.UserId,
                EmployeeName = g.Key.EmployeeName,
                EmployeeCode = g.Key.EmployeeCode,
                EmployeeEmail = g.Key.EmployeeEmail,
                Designation = g.Key.Designation,
                ManagerName = g.Key.ManagerName,
                DepartmentName = g.Key.DepartmentName,
                MissingDayCount = g.Count(),
                MissingDates = g.Select(x => x.MissingDate).OrderBy(d => d).ToList(),
                MostRecentMissingDate = g.Max(x => x.MissingDate)
            })
            .OrderByDescending(r => r.MissingDayCount)
            .ThenBy(r => r.EmployeeName)
            .ToList();
    }

    /* --------------------------------- REVIEW --------------------------------- */

    public async Task<int> ReviewAsync(ReviewDsrEntriesRequest request, CancellationToken ct = default)
    {
        if (!currentUser.IsAdmin && !currentUser.IsManager)
            throw new ForbiddenException("Only an Admin or Manager may approve or return DSR entries.");

        if (request.DsrEntryIds.Count == 0)
            throw new ValidationAppException(nameof(request.DsrEntryIds), "Select at least one DSR entry.");

        var status = request.StatusCode?.ToUpperInvariant();
        if (status is not ("APPROVED" or "RETURNED"))
            throw new ValidationAppException(nameof(request.StatusCode), "Status must be APPROVED or RETURNED.");

        // Mirrors CK_DSREntries_ReturnNeedsComment: a return without a reason is useless.
        if (status == "RETURNED" && (request.Comments is null || request.Comments.Trim().Length < 5))
            throw new ValidationAppException(nameof(request.Comments),
                "A comment of at least 5 characters is required when returning a DSR entry.");

        var entries = await uow.DsrEntries.QueryForUpdate()
            .Where(e => request.DsrEntryIds.Contains(e.Id) && e.IsActive)
            .ToListAsync(ct);

        if (entries.Count == 0) throw new NotFoundException(nameof(DsrEntry), string.Join(',', request.DsrEntryIds));

        // A Manager may only act on their own team; an Admin on anyone.
        if (!currentUser.IsAdmin)
        {
            var me = currentUser.RequireUserId();
            var ownerIds = entries.Select(e => e.UserId).Distinct().ToList();

            var outOfScope = await uow.Users.Query()
                .AnyAsync(u => ownerIds.Contains(u.Id) && u.ManagerUserId != me && u.Id != me, ct);

            if (outOfScope) throw new ForbiddenException("One or more entries belong to employees outside your team.");
        }

        var now = clock.UtcNow;
        var actorId = currentUser.RequireUserId();

        foreach (var entry in entries)
        {
            entry.StatusCode = status;
            entry.ApprovedByUserId = actorId;
            entry.ApprovalDate = now;
            entry.ReviewComments = request.Comments?.Trim();
            uow.DsrEntries.Update(entry);

            await audit.LogAsync(nameof(DsrEntry), entry.Id, AuditActions.Update,
                new { StatusCode = "SUBMITTED" }, new { entry.StatusCode, entry.ApprovedByUserId }, ct);
        }

        await uow.SaveChangesAsync(ct);
        return entries.Count;
    }

    /* --------------------------------- EXPORT --------------------------------- */

    public async Task<(string FileName, string ContentType, byte[] Content)> ExportDetailAsync(
        string format, DsrDetailReportFilter filter, CancellationToken ct = default)
    {
        // Export the whole filtered set, not just the visible page, but keep a hard ceiling so an
        // unfiltered export cannot become a full table dump.
        filter.Page = 1;
        filter.PageSize = 20000;

        var report = await GetDetailReportAsync(filter, ct);

        // Project roll-up for the same filter, so the workbook answers "which projects, and how
        // many hours" without the reader having to pivot the detail sheet themselves.
        var byProject = await GetGroupedReportAsync("project", filter, ct);

        // Name the file after the period so downloads from different date ranges do not collide.
        var stamp = filter.FromDate.HasValue && filter.ToDate.HasValue
            ? $"{filter.FromDate:yyyyMMdd}_to_{filter.ToDate:yyyyMMdd}"
            : clock.TodayUtc.ToString("yyyyMMdd");

        return format.ToLowerInvariant() switch
        {
            "xlsx" or "excel" => ($"DSR_Detail_Report_{stamp}.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                BuildWorkbook(report, byProject, filter)),

            "csv" => ($"DSR_Detail_Report_{stamp}.csv", "text/csv", BuildCsv(report)),

            _ => throw new ValidationAppException(nameof(format), "Format must be 'xlsx' or 'csv'.")
        };
    }

    /// <summary>
    /// Three sheets for the same filter: the detail rows (project, task and hours per entry),
    /// a project roll-up, and the summary totals. The applied date range is stamped on the
    /// summary sheet so a saved file always says which period it covers.
    /// </summary>
    private static byte[] BuildWorkbook(DsrDetailReportDto report, IReadOnlyList<GroupedReportRowDto> byProject, DsrDetailReportFilter filter)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add("DSR Details");

        string[] headers =
        [
            "Employee Name", "Employee Code", "Email", "Department", "Designation", "Manager",
            "Project Name", "Project Code", "Project Start", "Project End", "Project Status",
            "Task Description", "Work Category", "Hours Logged", "Estimated Hours", "Remaining Hours", "Task Entry Date",
            "DSR Date", "Submission Date", "DSR Status", "Approval Status", "Approved By", "Approval Date",
            "Review Comments", "No Work Done", "AI Used", "AI Tool"
        ];

        for (var c = 0; c < headers.Length; c++) sheet.Cell(1, c + 1).Value = headers[c];

        var header = sheet.Row(1);
        header.Style.Font.Bold = true;
        header.Style.Fill.BackgroundColor = XLColor.FromHtml("#1b4f8a");
        header.Style.Font.FontColor = XLColor.White;
        sheet.SheetView.FreezeRows(1);

        var r = 2;
        foreach (var row in report.Rows.Items)
        {
            sheet.Cell(r, 1).Value = row.EmployeeName;
            sheet.Cell(r, 2).Value = row.EmployeeCode;
            sheet.Cell(r, 3).Value = row.EmployeeEmail;
            sheet.Cell(r, 4).Value = row.DepartmentName;
            sheet.Cell(r, 5).Value = row.Designation;
            sheet.Cell(r, 6).Value = row.ManagerName;
            sheet.Cell(r, 7).Value = row.ProjectName;
            sheet.Cell(r, 8).Value = row.ProjectCode;
            sheet.Cell(r, 9).Value = row.ProjectStartDate?.ToDateTime(TimeOnly.MinValue);
            sheet.Cell(r, 10).Value = row.ProjectEndDate?.ToDateTime(TimeOnly.MinValue);
            sheet.Cell(r, 11).Value = row.ProjectStatus;
            sheet.Cell(r, 12).Value = row.TaskDescription;
            sheet.Cell(r, 13).Value = row.WorkCategoryName;
            sheet.Cell(r, 14).Value = row.HoursLogged;
            sheet.Cell(r, 15).Value = row.EstimatedHours;
            sheet.Cell(r, 16).Value = row.RemainingHours;
            sheet.Cell(r, 17).Value = row.TaskEntryDate;
            sheet.Cell(r, 18).Value = row.DsrDate.ToDateTime(TimeOnly.MinValue);
            sheet.Cell(r, 19).Value = row.SubmissionDate;
            sheet.Cell(r, 20).Value = row.StatusCode;
            sheet.Cell(r, 21).Value = row.ApprovalStatus;
            sheet.Cell(r, 22).Value = row.ApprovedBy;
            sheet.Cell(r, 23).Value = row.ApprovalDate;
            sheet.Cell(r, 24).Value = row.ReviewComments;
            sheet.Cell(r, 25).Value = row.IsNoWorkDone ? "Yes" : "No";
            sheet.Cell(r, 26).Value = row.IsAiUsed is null ? "" : (row.IsAiUsed.Value ? "Yes" : "No");
            sheet.Cell(r, 27).Value = row.AiToolName;
            r++;
        }

        foreach (var col in new[] { 9, 10, 18 }) sheet.Column(col).Style.DateFormat.Format = "dd-MMM-yyyy";
        foreach (var col in new[] { 17, 19, 23 }) sheet.Column(col).Style.DateFormat.Format = "dd-MMM-yyyy HH:mm";
        foreach (var col in new[] { 14, 15, 16 }) sheet.Column(col).Style.NumberFormat.Format = "0.00";

        if (r > 2) sheet.Range(1, 1, r - 1, headers.Length).SetAutoFilter();
        sheet.Columns().AdjustToContents(1, 40D, 55D);

        /* ---- Sheet 2: project roll-up (project, tasks logged against it, hours) ------------- */
        var proj = workbook.Worksheets.Add("By Project");
        string[] projHeaders = ["Project", "Code / Status", "Task entries", "Contributors", "Days", "Hours logged", "Estimated hours", "Avg hours/day", "Share %"];
        for (var c = 0; c < projHeaders.Length; c++) proj.Cell(1, c + 1).Value = projHeaders[c];

        proj.Row(1).Style.Font.Bold = true;
        proj.Row(1).Style.Fill.BackgroundColor = XLColor.FromHtml("#1b4f8a");
        proj.Row(1).Style.Font.FontColor = XLColor.White;
        proj.SheetView.FreezeRows(1);

        var pr = 2;
        foreach (var g in byProject)
        {
            proj.Cell(pr, 1).Value = g.GroupName;
            proj.Cell(pr, 2).Value = g.GroupSubtitle;
            proj.Cell(pr, 3).Value = g.EntryCount;
            proj.Cell(pr, 4).Value = g.EmployeeCount;
            proj.Cell(pr, 5).Value = g.DaysLogged;
            proj.Cell(pr, 6).Value = g.TotalHoursLogged;
            proj.Cell(pr, 7).Value = g.TotalEstimatedHours;
            proj.Cell(pr, 8).Value = g.AverageHoursPerDay;
            proj.Cell(pr, 9).Value = g.SharePct;
            pr++;
        }

        if (pr > 2)
        {
            // Total row, so the sheet reconciles to the detail sheet at a glance.
            proj.Cell(pr, 1).Value = "TOTAL";
            proj.Cell(pr, 3).FormulaA1 = $"SUM(C2:C{pr - 1})";
            proj.Cell(pr, 6).FormulaA1 = $"SUM(F2:F{pr - 1})";
            proj.Cell(pr, 7).FormulaA1 = $"SUM(G2:G{pr - 1})";
            proj.Row(pr).Style.Font.Bold = true;
            proj.Range(1, 1, pr - 1, projHeaders.Length).SetAutoFilter();
        }

        foreach (var col in new[] { 6, 7, 8, 9 }) proj.Column(col).Style.NumberFormat.Format = "0.00";
        proj.Columns().AdjustToContents(1, 40D, 55D);

        /* ---- Sheet 3: summary totals ------------------------------------------------------- */
        var s = workbook.Worksheets.Add("Summary");
        var summary = report.Summary;
        (string Label, object Value)[] stats =
        [
            ("Date from", filter.FromDate?.ToString("dd-MMM-yyyy") ?? "(all)"),
            ("Date to", filter.ToDate?.ToString("dd-MMM-yyyy") ?? "(all)"),
            ("Total entries", summary.TotalEntries),
            ("Employees", summary.EmployeeCount),
            ("Projects", summary.ProjectCount),
            ("Departments", summary.DepartmentCount),
            ("Distinct days", summary.DistinctDays),
            ("Total hours logged", summary.TotalHoursLogged),
            ("Total estimated hours", summary.TotalEstimatedHours),
            ("Total remaining hours", summary.TotalRemainingHours),
            ("Average hours per entry", summary.AverageHoursPerEntry),
            ("No Work Done entries", summary.NoWorkDoneCount),
            ("Pending approval", summary.PendingApprovalCount),
            ("Approved", summary.ApprovedCount),
            ("Returned", summary.ReturnedCount),
            ("AI adoption %", summary.AiAdoptionPct)
        ];

        s.Cell(1, 1).Value = "Metric";
        s.Cell(1, 2).Value = "Value";
        s.Row(1).Style.Font.Bold = true;
        s.Row(1).Style.Fill.BackgroundColor = XLColor.FromHtml("#1b4f8a");
        s.Row(1).Style.Font.FontColor = XLColor.White;

        for (var i = 0; i < stats.Length; i++)
        {
            s.Cell(i + 2, 1).Value = stats[i].Label;
            s.Cell(i + 2, 2).Value = XLCellValue.FromObject(stats[i].Value);
        }
        s.Columns().AdjustToContents();

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }

    private static byte[] BuildCsv(DsrDetailReportDto report)
    {
        var sb = new StringBuilder();
        sb.AppendLine(string.Join(',', new[]
        {
            "Employee Name", "Employee Code", "Email", "Department", "Designation", "Manager",
            "Project Name", "Project Code", "Project Start", "Project End", "Project Status",
            "Task Description", "Work Category", "Hours Logged", "Estimated Hours", "Remaining Hours",
            "Task Entry Date", "DSR Date", "Submission Date", "DSR Status", "Approval Status",
            "Approved By", "Approval Date", "Review Comments", "No Work Done", "AI Used", "AI Tool"
        }.Select(Escape)));

        foreach (var row in report.Rows.Items)
        {
            sb.AppendLine(string.Join(',', new object?[]
            {
                row.EmployeeName, row.EmployeeCode, row.EmployeeEmail, row.DepartmentName, row.Designation, row.ManagerName,
                row.ProjectName, row.ProjectCode, row.ProjectStartDate, row.ProjectEndDate, row.ProjectStatus,
                row.TaskDescription, row.WorkCategoryName, row.HoursLogged, row.EstimatedHours, row.RemainingHours,
                row.TaskEntryDate, row.DsrDate, row.SubmissionDate, row.StatusCode, row.ApprovalStatus,
                row.ApprovedBy, row.ApprovalDate, row.ReviewComments, row.IsNoWorkDone, row.IsAiUsed, row.AiToolName
            }.Select(Escape)));
        }

        // UTF-8 BOM so Excel opens non-ASCII names correctly.
        return Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
    }

    private static string Escape(object? value)
    {
        var text = value switch
        {
            null => string.Empty,
            bool b => b ? "Yes" : "No",
            DateOnly d => d.ToString("dd-MMM-yyyy"),
            DateTime dt => dt.ToString("dd-MMM-yyyy HH:mm"),
            decimal dec => dec.ToString("0.##", CultureInfo.InvariantCulture),
            _ => value.ToString() ?? string.Empty
        };

        // Guard against CSV formula injection in spreadsheet applications.
        if (text.Length > 0 && text[0] is '=' or '+' or '-' or '@') text = "'" + text;

        return text.Contains(',') || text.Contains('"') || text.Contains('\n')
            ? $"\"{text.Replace("\"", "\"\"")}\""
            : text;
    }

    /* ------------------------------ query building ------------------------------ */

    /// <summary>
    /// The single place filters are applied. Data scope goes on FIRST so a client filter can only
    /// ever narrow the set, never widen it.
    /// </summary>
    private IQueryable<DsrDetailReportView> BuildQuery(DsrDetailReportFilter filter)
    {
        var query = repository.DsrDetailReport;

        if (!currentUser.IsAdmin)
        {
            var me = currentUser.RequireUserId();
            query = currentUser.IsManager
                ? query.Where(v => v.ManagerUserId == me || v.UserId == me)
                : query.Where(v => v.UserId == me);
        }
        else if (filter.ManagerUserId.HasValue)
        {
            query = query.Where(v => v.ManagerUserId == filter.ManagerUserId);
        }

        if (filter.UserId.HasValue) query = query.Where(v => v.UserId == filter.UserId);
        if (filter.DepartmentId.HasValue) query = query.Where(v => v.DepartmentId == filter.DepartmentId);
        if (filter.ProjectId.HasValue) query = query.Where(v => v.ProjectId == filter.ProjectId);
        if (filter.WorkCategoryId.HasValue) query = query.Where(v => v.WorkCategoryId == filter.WorkCategoryId);

        if (filter.FromDate.HasValue) query = query.Where(v => v.WorkDate >= filter.FromDate);
        if (filter.ToDate.HasValue) query = query.Where(v => v.WorkDate <= filter.ToDate);

        if (filter.SubmittedFromDate.HasValue)
        {
            var from = filter.SubmittedFromDate.Value.ToDateTime(TimeOnly.MinValue);
            query = query.Where(v => v.SubmittedOn >= from);
        }
        if (filter.SubmittedToDate.HasValue)
        {
            var to = filter.SubmittedToDate.Value.ToDateTime(TimeOnly.MaxValue);
            query = query.Where(v => v.SubmittedOn <= to);
        }

        if (!string.IsNullOrWhiteSpace(filter.StatusCode))
            query = query.Where(v => v.StatusCode == filter.StatusCode.ToUpperInvariant());

        if (!string.IsNullOrWhiteSpace(filter.ApprovalStatus))
            query = query.Where(v => v.ApprovalStatus == filter.ApprovalStatus);

        if (filter.IsNoWorkDone.HasValue) query = query.Where(v => v.IsNoWorkDone == filter.IsNoWorkDone);
        if (filter.IsAiUsed.HasValue) query = query.Where(v => v.IsAiUsed == filter.IsAiUsed);

        if (filter.MinHours.HasValue) query = query.Where(v => v.HoursLogged >= filter.MinHours);
        if (filter.MaxHours.HasValue) query = query.Where(v => v.HoursLogged <= filter.MaxHours);

        if (!string.IsNullOrWhiteSpace(filter.EmployeeName))
            query = query.Where(v => v.EmployeeName.Contains(filter.EmployeeName.Trim()));

        if (!string.IsNullOrWhiteSpace(filter.EmployeeCode))
            query = query.Where(v => v.EmployeeCode != null && v.EmployeeCode.Contains(filter.EmployeeCode.Trim()));

        if (!string.IsNullOrWhiteSpace(filter.Search))
        {
            var t = filter.Search.Trim();
            query = query.Where(v =>
                v.EmployeeName.Contains(t)
                || (v.EmployeeCode != null && v.EmployeeCode.Contains(t))
                || v.EmployeeEmail.Contains(t)
                || (v.ProjectName != null && v.ProjectName.Contains(t))
                || (v.TaskDescription != null && v.TaskDescription.Contains(t)));
        }

        return query;
    }

    private static IQueryable<DsrDetailReportView> ApplySort(IQueryable<DsrDetailReportView> query, DsrDetailReportFilter filter) =>
        (filter.SortBy?.ToLowerInvariant()) switch
        {
            "employee" => filter.SortDescending ? query.OrderByDescending(v => v.EmployeeName) : query.OrderBy(v => v.EmployeeName),
            "project" => filter.SortDescending ? query.OrderByDescending(v => v.ProjectName) : query.OrderBy(v => v.ProjectName),
            "department" => filter.SortDescending ? query.OrderByDescending(v => v.DepartmentName) : query.OrderBy(v => v.DepartmentName),
            "hours" => filter.SortDescending ? query.OrderByDescending(v => v.HoursLogged) : query.OrderBy(v => v.HoursLogged),
            "status" => filter.SortDescending ? query.OrderByDescending(v => v.StatusCode) : query.OrderBy(v => v.StatusCode),
            "submitted" => filter.SortDescending ? query.OrderByDescending(v => v.SubmittedOn) : query.OrderBy(v => v.SubmittedOn),
            _ => filter.SortDescending
                ? query.OrderBy(v => v.WorkDate).ThenBy(v => v.DsrEntryId)
                : query.OrderByDescending(v => v.WorkDate).ThenByDescending(v => v.DsrEntryId)
        };

    private static async Task<DsrDetailReportSummaryDto> BuildSummaryAsync(IQueryable<DsrDetailReportView> query, CancellationToken ct)
    {
        // One round trip for every total, computed server-side over the full filtered set.
        var agg = await query
            .GroupBy(_ => 1)
            .Select(g => new
            {
                TotalEntries = g.Count(),
                EmployeeCount = g.Select(x => x.UserId).Distinct().Count(),
                ProjectCount = g.Where(x => x.ProjectId != null).Select(x => x.ProjectId).Distinct().Count(),
                DepartmentCount = g.Where(x => x.DepartmentId != null).Select(x => x.DepartmentId).Distinct().Count(),
                DistinctDays = g.Select(x => x.WorkDate).Distinct().Count(),
                TotalHoursLogged = g.Sum(x => x.HoursLogged),
                TotalEstimatedHours = g.Sum(x => x.EstimatedHours),
                TotalRemainingHours = g.Sum(x => x.RemainingHours),
                NoWorkDoneCount = g.Count(x => x.IsNoWorkDone),
                PendingApprovalCount = g.Count(x => x.StatusCode == "SUBMITTED"),
                ApprovedCount = g.Count(x => x.StatusCode == "APPROVED"),
                ReturnedCount = g.Count(x => x.StatusCode == "RETURNED"),
                AiRows = g.Count(x => x.IsAiUsed != null),
                AiUsedRows = g.Count(x => x.IsAiUsed == true)
            })
            .FirstOrDefaultAsync(ct);

        if (agg is null) return new DsrDetailReportSummaryDto();

        return new DsrDetailReportSummaryDto
        {
            TotalEntries = agg.TotalEntries,
            EmployeeCount = agg.EmployeeCount,
            ProjectCount = agg.ProjectCount,
            DepartmentCount = agg.DepartmentCount,
            DistinctDays = agg.DistinctDays,
            TotalHoursLogged = agg.TotalHoursLogged,
            TotalEstimatedHours = agg.TotalEstimatedHours,
            TotalRemainingHours = agg.TotalRemainingHours,
            AverageHoursPerEntry = agg.TotalEntries == 0 ? 0 : Math.Round(agg.TotalHoursLogged / agg.TotalEntries, 2),
            NoWorkDoneCount = agg.NoWorkDoneCount,
            PendingApprovalCount = agg.PendingApprovalCount,
            ApprovedCount = agg.ApprovedCount,
            ReturnedCount = agg.ReturnedCount,
            AiAdoptionPct = agg.AiRows == 0 ? 0 : Math.Round(agg.AiUsedRows * 100m / agg.AiRows, 2)
        };
    }

    private (DateOnly From, DateOnly To) ResolvePeriod(DsrDetailReportFilter filter)
    {
        var to = filter.ToDate ?? clock.TodayUtc;
        var from = filter.FromDate ?? to.AddDays(-30);
        return from > to ? (to, from) : (from, to);
    }
}
