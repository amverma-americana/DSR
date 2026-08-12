import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, Grid, InputAdornment, LinearProgress, MenuItem, Snackbar,
  Tab, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, Tabs,
  TextField, Tooltip, Typography,
} from '@mui/material';
import {
  BriefcaseBusiness, CalendarX2, Clock, Download, FileSpreadsheet, ListChecks, Search, Sparkles,
  Users,
} from 'lucide-react';
import dayjs from 'dayjs';
// eslint-disable-next-line no-unused-vars -- mastersApi feeds the commented Department/Category filters
import { adminReportsApi, mastersApi, projectsApi, usersApi } from '../../api/client';
import PageHeader from '../../components/PageHeader';
import FilterPanel from '../../components/FilterPanel';
import StatCard from '../../components/StatCard';
import EmptyState from '../../components/EmptyState';
import ProjectSelect from '../../components/ProjectSelect';
import { COLORS } from '../../theme/tokens';
/*  `SectionCard` and `BarSeriesChart` were used only by the commented-out Estimated-vs-Logged
    chart. Restore these two imports alongside it:
        import SectionCard from '../../components/SectionCard';
        import { BarSeriesChart } from '../../components/Charts';                               */

// Approval workflow disabled as per current business requirement.
// All DSR entries are treated as automatically approved.
// const STATUS_COLOUR = { APPROVED: 'success', RETURNED: 'error', SUBMITTED: 'warning', DRAFT: 'default' };

const TABS = [
  { key: 'details', label: 'DSR Details' },
  { key: 'employee', label: 'Employee-wise' },
  { key: 'project', label: 'Project-wise' },
  { key: 'department', label: 'Department-wise' },
  { key: 'manager', label: 'Manager-wise' },
  { key: 'category', label: 'Work Category' },
  // Approval workflow disabled as per current business requirement.
  // All DSR entries are treated as automatically approved.
  // { key: 'approval', label: 'Approval Status' },
  { key: 'nowork', label: 'No Work Done' },
  { key: 'missing', label: 'Missing DSR' },
];

const emptyFilter = {
  fromDate: dayjs().startOf('month').format('YYYY-MM-DD'),
  toDate: dayjs().format('YYYY-MM-DD'),
  submittedFromDate: '', submittedToDate: '',
  userId: '', employeeCode: '', departmentId: '', managerUserId: '', projectId: '',
  workCategoryId: '', statusCode: '', isNoWorkDone: '', isAiUsed: '',
  minHours: '', maxHours: '', search: '',
  page: 1, pageSize: 25,
};

/** Filters that narrow the population, excluding paging and the default date range. */
const NARROWING_KEYS = [
  'submittedFromDate', 'submittedToDate', 'userId', 'employeeCode', 'departmentId',
  'managerUserId', 'projectId', 'workCategoryId', 'statusCode', 'isNoWorkDone', 'isAiUsed',
  'minHours', 'maxHours', 'search',
];

/**
 * Admin reporting workspace.
 *
 * One filter object drives every tab, and the API applies it identically to detail rows, grouped
 * roll-ups and exports -- so switching tabs re-slices the same population rather than showing a
 * differently-filtered one. Totals in the footer come from the server and cover the whole filtered
 * set, not the visible page.
 */
export default function DsrDetailsPage() {
  const [tab, setTab] = useState(0);
  const [filter, setFilter] = useState(emptyFilter);
  const [showFilters, setShowFilters] = useState(true);
  const [data, setData] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  // Approval workflow disabled as per current business requirement.
  // All DSR entries are treated as automatically approved.
  // Row selection existed ONLY to drive bulk approve/return, so it goes with them.
  // const [selected, setSelected] = useState([]);
  // const [returnDialog, setReturnDialog] = useState(false);
  // const [returnComment, setReturnComment] = useState('');

  /*  Lookups for the filter dropdowns.

      managers / departments / categories are RETAINED but currently unread: their filter controls
      are commented out further down (hidden by request), and deleting the state would mean
      re-adding it to restore a control. ESLint is silenced here for that specific reason rather
      than by loosening the rule, so a genuinely unused binding elsewhere is still an error.  */
  const [employees, setEmployees] = useState([]);
  const [projects, setProjects] = useState([]);
  // eslint-disable-next-line no-unused-vars -- paired with the commented Manager filter below
  const [managers, setManagers] = useState([]);
  // eslint-disable-next-line no-unused-vars -- paired with the commented Department filter below
  const [departments, setDepartments] = useState([]);
  // eslint-disable-next-line no-unused-vars -- paired with the commented Work category filter below
  const [categories, setCategories] = useState([]);

  const active = TABS[tab];

  useEffect(() => {
    usersApi.team().then(setEmployees).catch(() => {});
    projectsApi.search({ pageSize: 200 }).then((r) => setProjects(r.items)).catch(() => {});

    /*  Disabled alongside their filter controls (see the commented Department / Manager and
        Work category blocks below). Nothing reads these lists while those controls are hidden,
        so fetching them would be three wasted round trips on every page load. Re-enable the
        matching fetch when re-enabling a control. */
    // usersApi.managers().then(setManagers).catch(() => {});
    // mastersApi.departments().then(setDepartments).catch(() => {});
    // mastersApi.workCategories().then(setCategories).catch(() => {});
  }, []);

  // Strip empty strings so the API receives absent filters rather than blanks.
  const params = useMemo(
    () => Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== '' && v !== null)),
    [filter],
  );

  const appliedCount = useMemo(
    () => NARROWING_KEYS.filter((k) => filter[k] !== '' && filter[k] !== null).length,
    [filter],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // setSelected([]);   // Approval workflow disabled — no row selection to clear.

    /*  Clear the rows before fetching.

        Each tab renders a DIFFERENT row shape: the grouped tabs expect groupName/sharePct, the
        detail tabs expect employeeName/userId, and Missing DSR expects missingDayCount. Because
        `active.key` changes the instant the tab is clicked but `data` was only replaced after the
        await resolved, the new tab briefly rendered the OLD tab's rows against its own columns --
        producing blank cells and a literal "undefined%" in the share column. Dropping the rows
        first means a tab shows a spinner rather than someone else's data.                        */
    setData(null);
    setSummary(null);

    try {
      if (active.key === 'details' || active.key === 'nowork') {
        const result = active.key === 'nowork'
          ? await adminReportsApi.noWorkDone(params)
          : await adminReportsApi.dsrDetails(params);
        setData(result.rows);
        setSummary(result.summary);
      // Approval workflow disabled as per current business requirement.
      // All DSR entries are treated as automatically approved.
      // } else if (active.key === 'approval') {
      //   setData({ items: await adminReportsApi.approvalStatus(params), totalCount: 0 });
      //   setSummary(null);
      } else if (active.key === 'missing') {
        setData({ items: await adminReportsApi.missingDsr(params), totalCount: 0 });
        setSummary(null);
      } else {
        setData({ items: await adminReportsApi.grouped(active.key, params), totalCount: 0 });
        setSummary(null);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [active.key, params]);

  useEffect(() => { load(); }, [load]);

  const set = (key) => (e) => setFilter((f) => ({ ...f, [key]: e.target.value, page: 1 }));

  /*  Approval workflow disabled as per current business requirement.
      All DSR entries are treated as automatically approved.

      This was the single handler behind both the Approve and the Return buttons. Its endpoint
      (POST /api/admin-reports/review) is commented out server-side as well.  */
  /*
  const review = async (statusCode, comments) => {
    try {
      await adminReportsApi.review({ dsrEntryIds: selected, statusCode, comments });
      setToast(`${selected.length} entr${selected.length === 1 ? 'y' : 'ies'} ${statusCode.toLowerCase()}.`);
      setReturnDialog(false);
      setReturnComment('');
      await load();
    } catch (e) {
      setError(e.message);
    }
  };
  */

  /*  Memoised because `data?.items ?? []` allocates a NEW array on every render, which would make
      any derived memo re-run each time regardless of whether the data had changed. Tying it to
      `data` fixes that at source.  */
  const rows = useMemo(() => data?.items ?? [], [data]);
  const isGrouped = ['employee', 'project', 'department', 'manager', 'category'].includes(active.key);

  /*  Estimated vs Logged Hours graph commented out from the UI as per current requirement.

      This memo fed that chart -- estimated against logged for whichever dimension the current
      grouped tab uses, built purely from rows already on screen so no extra request was involved.
      Commented out with the chart to keep the module free of unused work; restore both together.

  const groupedChartData = useMemo(() => {
    if (!isGrouped) return [];
    return rows
      .filter((r) => r?.groupName !== undefined)
      .slice(0, 12)
      .map((r) => ({
        label: r.groupName,
        logged: r.totalHoursLogged ?? 0,
        estimated: r.totalEstimatedHours ?? 0,
      }));
  }, [rows, isGrouped]);                                                                        */

  return (
    <Box>
      <PageHeader
        title="DSR Reports"
        description="Complete employee work logs across every project, department and manager."
        actions={(
          <>
            <Button
              variant="outlined" startIcon={<FileSpreadsheet size={16} />}
              onClick={() => adminReportsApi.exportReport('xlsx', params).catch((e) => setError(e.message))}
            >
              Excel
            </Button>
            <Button
              variant="outlined" startIcon={<Download size={16} />}
              onClick={() => adminReportsApi.exportReport('csv', params).catch((e) => setError(e.message))}
            >
              CSV
            </Button>
          </>
        )}
      />

      {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>}

      <FilterPanel
        appliedCount={appliedCount}
        onReset={() => setFilter(emptyFilter)}
        open={showFilters}
        onToggle={() => setShowFilters((s) => !s)}
      >
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} lg={2}>
            <TextField label="DSR from" type="date" fullWidth InputLabelProps={{ shrink: true }}
              value={filter.fromDate} onChange={set('fromDate')} />
          </Grid>
          <Grid item xs={12} sm={6} lg={2}>
            <TextField label="DSR to" type="date" fullWidth InputLabelProps={{ shrink: true }}
              value={filter.toDate} onChange={set('toDate')} />
          </Grid>
          {/* ---------------------------------------------------------------------------
              HIDDEN BY REQUEST. Submitted-date range, and the min/max hours band.

              Commented out rather than deleted: the API still accepts every one of these
              parameters (submittedFromDate, submittedToDate, minHours, maxHours) and the
              filter state still carries the keys, so re-enabling a field is purely a matter
              of uncommenting the block below. Nothing server-side needs to change.
              --------------------------------------------------------------------------- */}
          {/*
          <Grid item xs={12} sm={6} lg={2}>
            <TextField label="Submitted from" type="date" fullWidth InputLabelProps={{ shrink: true }}
              value={filter.submittedFromDate} onChange={set('submittedFromDate')} />
          </Grid>
          <Grid item xs={12} sm={6} lg={2}>
            <TextField label="Submitted to" type="date" fullWidth InputLabelProps={{ shrink: true }}
              value={filter.submittedToDate} onChange={set('submittedToDate')} />
          </Grid>
          <Grid item xs={12} sm={6} lg={2}>
            <TextField label="Min hours" type="number" fullWidth
              value={filter.minHours} onChange={set('minHours')} inputProps={{ min: 0, step: 0.5 }} />
          </Grid>
          <Grid item xs={12} sm={6} lg={2}>
            <TextField label="Max hours" type="number" fullWidth
              value={filter.maxHours} onChange={set('maxHours')} inputProps={{ min: 0, step: 0.5 }} />
          </Grid>
          */}

          <Grid item xs={12} sm={6} lg={2}>
            <TextField select label="Employee" fullWidth value={filter.userId} onChange={set('userId')}>
              <MenuItem value="">All employees</MenuItem>
              {employees.map((e) => <MenuItem key={e.id} value={e.id}>{e.name}</MenuItem>)}
            </TextField>
          </Grid>
          {/* HIDDEN BY REQUEST: Employee code. Still searchable via the free-text Search box,
              which matches employee code as well as name, email, project and task. */}
          {/*
          <Grid item xs={12} sm={6} lg={2}>
            <TextField label="Employee code" fullWidth value={filter.employeeCode} onChange={set('employeeCode')} />
          </Grid>
          */}
          {/* ---------------------------------------------------------------------------
              HIDDEN BY REQUEST: Department and Manager dropdowns.

              The API still accepts departmentId and managerUserId, the filter state still
              carries both keys, and the Department-wise / Manager-wise roll-up TABS continue
              to work -- they group by those dimensions rather than filtering on them. To
              restore either control, uncomment the block below AND the matching lookup fetch
              in the useEffect above (both were disabled together to avoid two pointless API
              calls on every page load).
              --------------------------------------------------------------------------- */}
          {/*
          <Grid item xs={12} sm={6} lg={2}>
            <TextField select label="Department" fullWidth value={filter.departmentId} onChange={set('departmentId')}>
              <MenuItem value="">All departments</MenuItem>
              {departments.map((d) => <MenuItem key={d.id} value={d.id}>{d.departmentName}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} lg={2}>
            <TextField select label="Manager" fullWidth value={filter.managerUserId} onChange={set('managerUserId')}>
              <MenuItem value="">All managers</MenuItem>
              {managers.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
            </TextField>
          </Grid>
          */}
          <Grid item xs={12} sm={6} lg={3}>
            <ProjectSelect
              projects={projects}
              value={filter.projectId}
              onChange={(id) => setFilter((f) => ({ ...f, projectId: id, page: 1 }))}
              label="Project"
              allLabel="All projects"
            />
          </Grid>
          {/* ---------------------------------------------------------------------------
              HIDDEN BY REQUEST: Work category, DSR status, No work done, AI usage.

              Note the dedicated tabs still cover two of these without a filter control:
                * "No Work Done" tab  -> forces isNoWorkDone = true server-side
                * "Approval Status" tab -> breaks the population down by DSR status
              The API continues to accept workCategoryId, statusCode, isNoWorkDone and
              isAiUsed, so uncommenting restores each control with no server change.
              --------------------------------------------------------------------------- */}
          {/*
          <Grid item xs={12} sm={6} lg={2}>
            <TextField select label="Work category" fullWidth value={filter.workCategoryId} onChange={set('workCategoryId')}>
              <MenuItem value="">All categories</MenuItem>
              {categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.categoryName}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} lg={2}>
            <TextField select label="DSR status" fullWidth value={filter.statusCode} onChange={set('statusCode')}>
              <MenuItem value="">Any status</MenuItem>
              {['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED'].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} lg={2}>
            <TextField select label="No work done" fullWidth value={filter.isNoWorkDone} onChange={set('isNoWorkDone')}>
              <MenuItem value="">Any</MenuItem>
              <MenuItem value="true">Only No Work Done</MenuItem>
              <MenuItem value="false">Exclude No Work Done</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} lg={2}>
            <TextField select label="AI usage" fullWidth value={filter.isAiUsed} onChange={set('isAiUsed')}>
              <MenuItem value="">Any</MenuItem>
              <MenuItem value="true">AI used</MenuItem>
              <MenuItem value="false">No AI</MenuItem>
            </TextField>
          </Grid>
          */}
          <Grid item xs={12} lg={3}>
            <TextField
              label="Search" fullWidth
              placeholder="Employee name, code, email, project or task description"
              value={filter.search} onChange={set('search')}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search size={16} color={COLORS.textTertiary} aria-hidden="true" />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
        </Grid>
      </FilterPanel>

      {/* ------------------------------------------------------------------ summary cards */}
      {summary && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {/* ---------------------------------------------------------------------------------
              Exactly the seven cards requested. The five commented entries below are still
              returned by the API on DsrDetailReportSummaryDto, so restoring any of them is a
              one-line uncomment -- no server change needed. Seven cards across a 12-column grid
              sit comfortably on one row at lg and above.
              --------------------------------------------------------------------------------- */}
          {[
            ['Entries', summary.totalEntries, ListChecks, 'primary'],
            ['Employees', summary.employeeCount, Users, 'primary'],
            ['Projects', summary.projectCount, BriefcaseBusiness, 'primary'],
            ['Hours logged', summary.totalHoursLogged, Clock, 'success'],
            ['Estimated', summary.totalEstimatedHours, Clock, 'neutral'],
            ['AI adoption', `${summary.aiAdoptionPct}%`, Sparkles, 'success'],

            /*  "Departments" count commented out from the UI as per current requirement -- it must
                not appear anywhere in reports for now. departmentCount is still returned on
                DsrDetailReportSummaryDto, and the Department-wise roll-up TAB still works (it
                groups by department rather than counting them), so this is a one-line restore. */
            // ['Departments', summary.departmentCount, BriefcaseBusiness, 'neutral'],

            // ['Remaining', summary.totalRemainingHours],
            // ['Pending', summary.pendingApprovalCount],
            // ['Approved', summary.approvedCount],
            // ['Returned', summary.returnedCount],
            // ['No work', summary.noWorkDoneCount],
          ].map(([label, value, icon, tone]) => (
            /*  Six cards now, so each takes two of twelve columns and the row stays full width.
                Was lg={12/7} for seven cards -- restore that if Departments is re-enabled.     */
            <Grid item xs={6} sm={4} lg={2} key={label}>
              <StatCard dense label={label} value={value} icon={icon} tone={tone} />
            </Grid>
          ))}
        </Grid>
      )}

      {/* ---------------------------------------------------------------------------------------
          Estimated vs Logged Hours graph commented out from the UI as per current requirement.

          This was the chart on the grouped tabs (Employee-wise, Project-wise, Department-wise,
          Manager-wise, Work Category) comparing Estimated against Hours logged. Only the DISPLAY
          is disabled -- the numbers behind it remain in the table beneath, and both fields are
          still returned by /admin-reports/grouped/{groupBy}.

          groupedChartData below is retained and still computed for reactivation; it is derived
          from rows already on screen and issues no request of its own, so leaving it in place
          costs nothing. Reactivating needs this block plus the SectionCard and BarSeriesChart
          imports at the top of the file.
          --------------------------------------------------------------------------------------- */}
      {/*
      {isGrouped && groupedChartData.length > 0 && (
        <SectionCard
          title={`Estimated against logged — ${active.label.replace('-wise', '')}`}
          subtitle={groupedChartData.length === 12 ? 'Top 12 by the current sort' : undefined}
          sx={{ mb: 3 }}
        >
          <BarSeriesChart
            data={groupedChartData}
            xKey="label"
            series={[
              { key: 'estimated', name: 'Estimated', color: COLORS.borderStrong },
              { key: 'logged', name: 'Hours logged', color: COLORS.primary },
            ]}
            height={Math.max(240, groupedChartData.length * 32)}
            layout="vertical"
          />
        </SectionCard>
      )}
      */}

      {/* ------------------------------------------------------------------ tabs + grid */}
      <Card>
        <Tabs
          value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto"
          aria-label="Report view"
          sx={{ borderBottom: 1, borderColor: 'divider', px: 1 }}
        >
          {TABS.map((t) => <Tab key={t.key} label={t.label} />)}
        </Tabs>

        {loading && <LinearProgress aria-label="Loading report" />}

        {/* ---------------------------------------------------------------------------------
            Approval workflow disabled as per current business requirement.
            All DSR entries are treated as automatically approved.

            This was the bulk-action bar carrying the Approve and Return buttons. It only ever
            appeared once rows were selected, and row selection has been disabled with it.
            --------------------------------------------------------------------------------- */}
        {/*
        {selected.length > 0 && (
          <Stack
            direction="row" spacing={1.5} alignItems="center"
            sx={{ px: 3, py: 1.5, bgcolor: COLORS.primaryLight, borderBottom: `1px solid ${COLORS.border}` }}
          >
            <Typography variant="body2" fontWeight={600} sx={{ color: COLORS.primaryHover }}>
              {selected.length} selected
            </Typography>
            <Button size="small" variant="contained" color="success" startIcon={<CheckCircle2 size={14} />}
              onClick={() => review('APPROVED')}>Approve</Button>
            <Button size="small" variant="outlined" color="error" startIcon={<Undo2 size={14} />}
              onClick={() => setReturnDialog(true)}>Return</Button>
            <Box sx={{ flexGrow: 1 }} />
            <Button size="small" variant="text" onClick={() => setSelected([])}>Clear</Button>
          </Stack>
        )}
        */}

        <TableContainer sx={{ maxHeight: 640 }}>
          <Table size="small" stickyHeader>
            {(active.key === 'details' || active.key === 'nowork') && (
              <>
                <TableHead>
                  <TableRow>
                    {/*  Approval workflow disabled as per current business requirement.
                         All DSR entries are treated as automatically approved.
                         Select-all checkbox removed with the bulk approve/return actions.  */}
                    {/*
                    <TableCell padding="checkbox">
                      <Checkbox size="small"
                        checked={rows.length > 0 && selected.length === rows.length}
                        indeterminate={selected.length > 0 && selected.length < rows.length}
                        inputProps={{ 'aria-label': 'Select all rows on this page' }}
                        onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.dsrEntryId) : [])} />
                    </TableCell>
                    */}
                    {/* ---------------------------------------------------------------------
                        Columns hidden by request: Code, Department, Manager, Project Code,
                        Category, Remaining Hours, Status and Approved By.

                        Designation, Project Start, Project End and Project Status were never
                        rendered in this grid, so there was nothing to hide for those four --
                        they remain available on the API response and in vw_DsrDetailReport.
                        --------------------------------------------------------------------- */}
                    {/*  COLUMN ORDER matches the Excel/CSV export exactly, so what an admin reads
                         on screen and what they open in Excel line up column for column:

                             Date | Employee | Project | Task | Logged | Est. | Task Entry Date

                         "Date" is the WORK date (dsrDate) -- the day the effort belongs to -- and
                         leads the grid because it is the reporting key. "Task Entry Date" is the
                         recorded-on timestamp (taskEntryDate) and sits last as the audit trail.
                         The two differ on back-dated entries.

                         This replaces the old trailing "Submitted" column, which showed
                         submissionDate: that field is NULL on entries saved through paths that do
                         not stamp it, so it displayed "—" on rows that plainly did exist.
                         taskEntryDate is always populated.

                         Date, Project and Task Entry Date are auto-width: the Table uses the
                         default table-layout:auto, so whiteSpace:nowrap widens each to fit its
                         longest value instead of wrapping. Task keeps its maxWidth/noWrap, which
                         is what frees up the space for them to grow.                             */}
                    {[['Date', true], ['Employee', false], ['Project', true], ['Task', false],
                      /* ['Category', false], */
                      ['Logged', false], ['Est.', false],
                      ['Task Entry Date', true]].map(([h, autoWidth]) => (
                        <TableCell key={h} sx={autoWidth ? { whiteSpace: 'nowrap', width: 'auto' } : undefined}>
                          {h}
                        </TableCell>))}
                    {/* 'Code', 'Department', 'Manager', 'Rem.', 'Status', 'Approved By' */}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.dsrEntryId} hover>
                      {/*  Approval workflow disabled as per current business requirement.
                           All DSR entries are treated as automatically approved.
                           Per-row selection checkbox removed with the bulk actions.  */}
                      {/*
                      <TableCell padding="checkbox">
                        <Checkbox size="small" checked={selected.includes(r.dsrEntryId)}
                          inputProps={{ 'aria-label': `Select entry for ${r.employeeName}` }}
                          onChange={(e) => setSelected((s) => e.target.checked
                            ? [...s, r.dsrEntryId] : s.filter((id) => id !== r.dsrEntryId))} />
                      </TableCell>
                      */}
                      {/* Date = the work date, first, matching the export. */}
                      <TableCell sx={{ whiteSpace: 'nowrap', width: 'auto' }}>
                        {dayjs(r.dsrDate).format('DD MMM YY')}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={500}>{r.employeeName}</Typography>
                        <Typography variant="caption" color="text.secondary">{r.employeeEmail}</Typography>
                      </TableCell>
                      {/* Code / Department / Manager columns hidden by request */}
                      {/*
                      <TableCell>{r.employeeCode ?? '—'}</TableCell>
                      <TableCell>{r.departmentName ?? '—'}</TableCell>
                      <TableCell>{r.managerName ?? '—'}</TableCell>
                      */}
                      <TableCell sx={{ whiteSpace: 'nowrap', width: 'auto' }}>
                        {/* Project code subtitle hidden by request; project name retained. */}
                        <Typography variant="body2" noWrap>{r.projectName ?? '—'}</Typography>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 240 }}>
                        {r.isNoWorkDone
                          ? <Chip size="small" variant="outlined" label="No Work Done" />
                          : <Tooltip title={r.taskDescription ?? ''}>
                              <Typography variant="body2" noWrap>{r.taskDescription}</Typography>
                            </Tooltip>}
                      </TableCell>
                      {/* Category column hidden by request. workCategoryName is still returned by
                          the API and still drives the Work-Category grouped tab and the filters. */}
                      {/* <TableCell>{r.workCategoryName ?? '—'}</TableCell> */}
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{r.hoursLogged}</TableCell>
                      <TableCell align="right">{r.estimatedHours}</TableCell>
                      {/*  Task Entry Date = when the row was saved. Last, as the audit trail.
                           Shows the year as well as the time because a back-dated entry can be
                           recorded in a different month from the work it describes.              */}
                      <TableCell sx={{ whiteSpace: 'nowrap', width: 'auto' }}>
                        {r.taskEntryDate ? dayjs(r.taskEntryDate).format('DD MMM YY HH:mm') : '—'}
                      </TableCell>
                      {/*  Previous trailing column, replaced by Task Entry Date above:
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {r.submissionDate ? dayjs(r.submissionDate).format('DD MMM HH:mm') : '—'}
                      </TableCell>                                                                */}
                      {/* --------------------------------------------------------------------
                          Remaining Hours hidden by request.

                          Status and Approved By: approval workflow disabled as per current
                          business requirement. All DSR entries are treated as automatically
                          approved. These two cells would now show the same value on every row
                          ("Submitted", nobody), so they stay disabled with the workflow rather
                          than merely hidden by request. STATUS_COLOUR at the top of the file is
                          commented out for the same reason -- uncomment it alongside these.
                          -------------------------------------------------------------------- */}
                      {/*
                      <TableCell align="right">{r.remainingHours}</TableCell>
                      <TableCell>
                        <Chip size="small" label={r.approvalStatus} color={STATUS_COLOUR[r.statusCode] ?? 'default'} />
                        {r.reviewComments && (
                          <Tooltip title={r.reviewComments}>
                            <Typography variant="caption" display="block" color="error" noWrap sx={{ maxWidth: 140 }}>
                              {r.reviewComments}
                            </Typography>
                          </Tooltip>)}
                      </TableCell>
                      <TableCell>
                        {r.approvedBy ?? '—'}
                        {r.approvalDate && (
                          <Typography variant="caption" display="block" color="text.secondary">
                            {dayjs(r.approvalDate).format('DD MMM HH:mm')}
                          </Typography>)}
                      </TableCell>
                      */}
                    </TableRow>
                  ))}
                </TableBody>
              </>
            )}

            {isGrouped && (
              <>
                <TableHead>
                  <TableRow>
                    {/*  'Pending', 'Approved', 'Returned' removed from this header to match the
                         cells below -- approval workflow disabled as per current business
                         requirement; all DSR entries are treated as automatically approved.  */}
                    {[active.label.replace('-wise', ''), 'Entries', 'Employees', 'Projects', 'Days',
                      'Hours logged', 'Estimated', 'Avg/day', /* 'Pending', 'Approved', 'Returned', */ 'Share'].map((h, i) => (
                        <TableCell key={h} align={i === 0 ? 'left' : 'right'}>{h}</TableCell>))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {/*  Only render rows that actually carry the grouped shape. Belt-and-braces
                       alongside clearing data in load(): if a future change ever feeds this table
                       a different payload, it renders nothing rather than a row of "undefined".  */}
                  {rows.filter((r) => r?.groupName !== undefined).map((r) => (
                    <TableRow key={`${r.groupId ?? 'none'}-${r.groupName}`} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight={500}>{r.groupName}</Typography>
                        {r.groupSubtitle && <Typography variant="caption" color="text.secondary">{r.groupSubtitle}</Typography>}
                      </TableCell>
                      <TableCell align="right">{r.entryCount ?? 0}</TableCell>
                      <TableCell align="right">{r.employeeCount ?? 0}</TableCell>
                      <TableCell align="right">{r.projectCount ?? 0}</TableCell>
                      <TableCell align="right">{r.daysLogged ?? 0}</TableCell>
                      <TableCell align="right"><strong>{r.totalHoursLogged ?? 0}</strong></TableCell>
                      <TableCell align="right">{r.totalEstimatedHours ?? 0}</TableCell>
                      <TableCell align="right">{r.averageHoursPerDay ?? 0}</TableCell>
                      {/*  Approval workflow disabled as per current business requirement.
                           All DSR entries are treated as automatically approved.

                           Pending / Approved / Returned are not merely redundant now -- they are
                           WRONG to display. With no workflow every entry stays SUBMITTED, so these
                           columns would read "Pending = all, Approved = 0, Returned = 0" and imply
                           a backlog awaiting sign-off that does not exist. The DTO still carries
                           the fields, so uncommenting restores them.  */}
                      {/*
                      <TableCell align="right">{r.pendingApprovalCount ?? 0}</TableCell>
                      <TableCell align="right">{r.approvedCount ?? 0}</TableCell>
                      <TableCell align="right">{r.returnedCount ?? 0}</TableCell>
                      */}
                      <TableCell align="right"><Chip size="small" label={`${r.sharePct ?? 0}%`} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </>
            )}

            {/* ---------------------------------------------------------------------------------
                Approval workflow disabled as per current business requirement.
                All DSR entries are treated as automatically approved.

                The Approval Status tab body. Its tab entry, its API endpoint
                (GET /api/admin-reports/approval-status), its client call and its service method
                are all commented out too, so this block is unreachable as things stand.
                --------------------------------------------------------------------------------- */}
            {/*
            {active.key === 'approval' && (
              <>
                <TableHead>
                  <TableRow>
                    {['Approval status', 'Entries', 'Employees', 'Hours', 'Share', 'Oldest (days)'].map((h, i) => (
                      <TableCell key={h} align={i === 0 ? 'left' : 'right'}>{h}</TableCell>))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.statusCode} hover>
                      <TableCell><Chip size="small" label={r.approvalStatus} color={STATUS_COLOUR[r.statusCode] ?? 'default'} /></TableCell>
                      <TableCell align="right">{r.entryCount}</TableCell>
                      <TableCell align="right">{r.employeeCount}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{r.totalHours}</TableCell>
                      <TableCell align="right">{r.sharePct}%</TableCell>
                      <TableCell align="right">{r.oldestAgeDays}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </>
            )}
            */}

            {active.key === 'missing' && (
              <>
                <TableHead>
                  <TableRow>
                    {['Employee', 'Code', 'Email', 'Department', 'Manager', 'Missing days', 'Most recent', 'Dates'].map((h) => (
                      <TableCell key={h}>{h}</TableCell>))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.userId} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.employeeName}</TableCell>
                      <TableCell>{r.employeeCode ?? '—'}</TableCell>
                      <TableCell>{r.employeeEmail}</TableCell>
                      <TableCell>{r.departmentName ?? '—'}</TableCell>
                      <TableCell>{r.managerName ?? '—'}</TableCell>
                      <TableCell align="right"><Chip size="small" color="error" label={r.missingDayCount} /></TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {r.mostRecentMissingDate ? dayjs(r.mostRecentMissingDate).format('DD MMM YY') : '—'}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 260 }}>
                        <Tooltip title={r.missingDates.map((d) => dayjs(d).format('DD MMM')).join(', ')}>
                          <Typography variant="caption" noWrap sx={{ display: 'block' }}>
                            {r.missingDates.map((d) => dayjs(d).format('DD MMM')).join(', ')}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </>
            )}
          </Table>
        </TableContainer>

        {!loading && rows.length === 0 && (
          <EmptyState
            icon={active.key === 'missing' ? CalendarX2 : ListChecks}
            title="No data matches these filters"
            description="Widen the date range or clear a filter to see more."
            action={appliedCount > 0
              ? <Button variant="outlined" onClick={() => setFilter(emptyFilter)}>Reset filters</Button>
              : undefined}
          />
        )}

        {(active.key === 'details' || active.key === 'nowork') && (
          <TablePagination component="div" count={data?.totalCount ?? 0}
            page={(filter.page ?? 1) - 1} rowsPerPage={filter.pageSize}
            rowsPerPageOptions={[25, 50, 100, 200]}
            onPageChange={(_, p) => setFilter((f) => ({ ...f, page: p + 1 }))}
            onRowsPerPageChange={(e) => setFilter((f) => ({ ...f, pageSize: Number(e.target.value), page: 1 }))} />
        )}
      </Card>

      {/* ---------------------------------------------------------------------------------------
          Approval workflow disabled as per current business requirement.
          All DSR entries are treated as automatically approved.

          The Return / Send Back dialog, which collected the mandatory reason. Reactivating it
          also needs the AppDialog import restored at the top of this file.
          --------------------------------------------------------------------------------------- */}
      {/*
      <AppDialog
        open={returnDialog}
        onClose={() => setReturnDialog(false)}
        title={`Return ${selected.length} DSR entr${selected.length === 1 ? 'y' : 'ies'}`}
        subtitle="The employee sees this reason on their entry."
        actions={(
          <>
            <Button variant="text" onClick={() => setReturnDialog(false)}>Cancel</Button>
            <Button variant="contained" color="error" disabled={returnComment.trim().length < 5}
              onClick={() => review('RETURNED', returnComment.trim())}>Return</Button>
          </>
        )}
      >
        <TextField autoFocus fullWidth multiline minRows={3} label="Reason" sx={{ mt: 1 }}
          value={returnComment} onChange={(e) => setReturnComment(e.target.value)}
          helperText="At least 5 characters." />
      </AppDialog>
      */}

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} message={toast} />
    </Box>
  );
}
