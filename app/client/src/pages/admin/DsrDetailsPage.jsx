import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, Collapse, Dialog, DialogActions,
  DialogContent, DialogTitle, Grid, LinearProgress, MenuItem, Snackbar, Stack, Tab, Table,
  TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, Tabs, TextField,
  Tooltip, Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import FilterListIcon from '@mui/icons-material/FilterList';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import UndoIcon from '@mui/icons-material/Undo';
import dayjs from 'dayjs';
import { adminReportsApi, mastersApi, projectsApi, usersApi } from '../../api/client';

const STATUS_COLOUR = { APPROVED: 'success', RETURNED: 'error', SUBMITTED: 'warning', DRAFT: 'default' };

const TABS = [
  { key: 'details', label: 'DSR Details' },
  { key: 'employee', label: 'Employee-wise' },
  { key: 'project', label: 'Project-wise' },
  { key: 'department', label: 'Department-wise' },
  { key: 'manager', label: 'Manager-wise' },
  { key: 'category', label: 'Work Category' },
  { key: 'approval', label: 'Approval Status' },
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
  const [selected, setSelected] = useState([]);
  const [returnDialog, setReturnDialog] = useState(false);
  const [returnComment, setReturnComment] = useState('');

  // Lookups for the filter dropdowns
  const [employees, setEmployees] = useState([]);
  const [managers, setManagers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [categories, setCategories] = useState([]);

  const active = TABS[tab];

  useEffect(() => {
    usersApi.team().then(setEmployees).catch(() => {});
    usersApi.managers().then(setManagers).catch(() => {});
    projectsApi.search({ pageSize: 200 }).then((r) => setProjects(r.items)).catch(() => {});
    mastersApi.departments().then(setDepartments).catch(() => {});
    mastersApi.workCategories().then(setCategories).catch(() => {});
  }, []);

  // Strip empty strings so the API receives absent filters rather than blanks.
  const params = useMemo(
    () => Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== '' && v !== null)),
    [filter],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelected([]);
    try {
      if (active.key === 'details' || active.key === 'nowork') {
        const result = active.key === 'nowork'
          ? await adminReportsApi.noWorkDone(params)
          : await adminReportsApi.dsrDetails(params);
        setData(result.rows);
        setSummary(result.summary);
      } else if (active.key === 'approval') {
        setData({ items: await adminReportsApi.approvalStatus(params), totalCount: 0 });
        setSummary(null);
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

  const rows = data?.items ?? [];

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5">DSR Reports</Typography>
          <Typography variant="body2" color="text.secondary">
            Complete employee work logs across every project, department and manager.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button size="small" startIcon={<FilterListIcon />} onClick={() => setShowFilters((s) => !s)}>
            {showFilters ? 'Hide filters' : 'Show filters'}
          </Button>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />}
            onClick={() => adminReportsApi.exportReport('xlsx', params).catch((e) => setError(e.message))}>
            Excel
          </Button>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />}
            onClick={() => adminReportsApi.exportReport('csv', params).catch((e) => setError(e.message))}>
            CSV
          </Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Collapse in={showFilters}>
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Grid container spacing={2}>
              <Grid item xs={6} sm={4} md={2}>
                <TextField label="DSR from" type="date" fullWidth size="small" InputLabelProps={{ shrink: true }}
                  value={filter.fromDate} onChange={set('fromDate')} />
              </Grid>
              <Grid item xs={6} sm={4} md={2}>
                <TextField label="DSR to" type="date" fullWidth size="small" InputLabelProps={{ shrink: true }}
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
              <Grid item xs={6} sm={4} md={2}>
                <TextField label="Submitted from" type="date" fullWidth size="small" InputLabelProps={{ shrink: true }}
                  value={filter.submittedFromDate} onChange={set('submittedFromDate')} />
              </Grid>
              <Grid item xs={6} sm={4} md={2}>
                <TextField label="Submitted to" type="date" fullWidth size="small" InputLabelProps={{ shrink: true }}
                  value={filter.submittedToDate} onChange={set('submittedToDate')} />
              </Grid>
              <Grid item xs={6} sm={4} md={2}>
                <TextField label="Min hours" type="number" fullWidth size="small"
                  value={filter.minHours} onChange={set('minHours')} inputProps={{ min: 0, step: 0.5 }} />
              </Grid>
              <Grid item xs={6} sm={4} md={2}>
                <TextField label="Max hours" type="number" fullWidth size="small"
                  value={filter.maxHours} onChange={set('maxHours')} inputProps={{ min: 0, step: 0.5 }} />
              </Grid>
              */}

              <Grid item xs={12} sm={6} md={2}>
                <TextField select label="Employee" fullWidth size="small" value={filter.userId} onChange={set('userId')}>
                  <MenuItem value="">All employees</MenuItem>
                  {employees.map((e) => <MenuItem key={e.id} value={e.id}>{e.name}</MenuItem>)}
                </TextField>
              </Grid>
              {/* HIDDEN BY REQUEST: Employee code. Still searchable via the free-text Search box,
                  which matches employee code as well as name, email, project and task. */}
              {/*
              <Grid item xs={12} sm={6} md={2}>
                <TextField label="Employee code" fullWidth size="small" value={filter.employeeCode} onChange={set('employeeCode')} />
              </Grid>
              */}
              <Grid item xs={12} sm={6} md={2}>
                <TextField select label="Department" fullWidth size="small" value={filter.departmentId} onChange={set('departmentId')}>
                  <MenuItem value="">All departments</MenuItem>
                  {departments.map((d) => <MenuItem key={d.id} value={d.id}>{d.departmentName}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <TextField select label="Manager" fullWidth size="small" value={filter.managerUserId} onChange={set('managerUserId')}>
                  <MenuItem value="">All managers</MenuItem>
                  {managers.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <TextField select label="Project" fullWidth size="small" value={filter.projectId} onChange={set('projectId')}>
                  <MenuItem value="">All projects</MenuItem>
                  {projects.map((p) => <MenuItem key={p.id} value={p.id}>{p.projectName}</MenuItem>)}
                </TextField>
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
              <Grid item xs={12} sm={6} md={2}>
                <TextField select label="Work category" fullWidth size="small" value={filter.workCategoryId} onChange={set('workCategoryId')}>
                  <MenuItem value="">All categories</MenuItem>
                  {categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.categoryName}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <TextField select label="DSR status" fullWidth size="small" value={filter.statusCode} onChange={set('statusCode')}>
                  <MenuItem value="">Any status</MenuItem>
                  {['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED'].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <TextField select label="No work done" fullWidth size="small" value={filter.isNoWorkDone} onChange={set('isNoWorkDone')}>
                  <MenuItem value="">Any</MenuItem>
                  <MenuItem value="true">Only No Work Done</MenuItem>
                  <MenuItem value="false">Exclude No Work Done</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <TextField select label="AI usage" fullWidth size="small" value={filter.isAiUsed} onChange={set('isAiUsed')}>
                  <MenuItem value="">Any</MenuItem>
                  <MenuItem value="true">AI used</MenuItem>
                  <MenuItem value="false">No AI</MenuItem>
                </TextField>
              </Grid>
              */}
              <Grid item xs={12} md={4}>
                <TextField label="Search" fullWidth size="small"
                  placeholder="Employee name, code, email, project or task description"
                  value={filter.search} onChange={set('search')} />
              </Grid>
              <Grid item xs={12} md={2}>
                <Button fullWidth onClick={() => setFilter(emptyFilter)}>Reset filters</Button>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      </Collapse>

      {summary && (
        <Grid container spacing={1} sx={{ mb: 2 }}>
          {[
            ['Entries', summary.totalEntries], ['Employees', summary.employeeCount],
            ['Projects', summary.projectCount], ['Departments', summary.departmentCount],
            ['Hours logged', summary.totalHoursLogged], ['Estimated', summary.totalEstimatedHours],
            ['Remaining', summary.totalRemainingHours], ['Pending', summary.pendingApprovalCount],
            ['Approved', summary.approvedCount], ['Returned', summary.returnedCount],
            ['No work', summary.noWorkDoneCount], ['AI adoption', `${summary.aiAdoptionPct}%`],
          ].map(([label, value]) => (
            <Grid item xs={6} sm={3} md={1} key={label}>
              <Card sx={{ p: 1, textAlign: 'center' }}>
                <Typography variant="h6" sx={{ lineHeight: 1.2 }}>{value}</Typography>
                <Typography variant="caption" color="text.secondary">{label}</Typography>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <Card>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto"
          sx={{ borderBottom: 1, borderColor: 'divider' }}>
          {TABS.map((t) => <Tab key={t.key} label={t.label} />)}
        </Tabs>

        {loading && <LinearProgress />}

        {selected.length > 0 && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1.5, bgcolor: 'action.hover' }}>
            <Typography variant="body2">{selected.length} selected</Typography>
            <Button size="small" variant="contained" color="success" startIcon={<CheckCircleOutlineIcon />}
              onClick={() => review('APPROVED')}>Approve</Button>
            <Button size="small" variant="outlined" color="error" startIcon={<UndoIcon />}
              onClick={() => setReturnDialog(true)}>Return</Button>
          </Stack>
        )}

        <TableContainer sx={{ maxHeight: 620 }}>
          <Table size="small" stickyHeader>
            {(active.key === 'details' || active.key === 'nowork') && (
              <>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox size="small"
                        checked={rows.length > 0 && selected.length === rows.length}
                        indeterminate={selected.length > 0 && selected.length < rows.length}
                        onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.dsrEntryId) : [])} />
                    </TableCell>
                    {['Employee', 'Code', 'Department', 'Manager', 'Project', 'Task', 'Category',
                      'Logged', 'Est.', 'Rem.', 'DSR Date', 'Submitted', 'Status', 'Approved By'].map((h) => (
                        <TableCell key={h}>{h}</TableCell>))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.dsrEntryId} hover selected={selected.includes(r.dsrEntryId)}>
                      <TableCell padding="checkbox">
                        <Checkbox size="small" checked={selected.includes(r.dsrEntryId)}
                          onChange={(e) => setSelected((s) => e.target.checked
                            ? [...s, r.dsrEntryId] : s.filter((id) => id !== r.dsrEntryId))} />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{r.employeeName}</Typography>
                        <Typography variant="caption" color="text.secondary">{r.employeeEmail}</Typography>
                      </TableCell>
                      <TableCell>{r.employeeCode ?? '—'}</TableCell>
                      <TableCell>{r.departmentName ?? '—'}</TableCell>
                      <TableCell>{r.managerName ?? '—'}</TableCell>
                      <TableCell>
                        <Typography variant="body2">{r.projectName ?? '—'}</Typography>
                        <Typography variant="caption" color="text.secondary">{r.projectCode}</Typography>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 240 }}>
                        {r.isNoWorkDone
                          ? <Chip size="small" variant="outlined" label="No Work Done" />
                          : <Tooltip title={r.taskDescription ?? ''}>
                              <Typography variant="body2" noWrap>{r.taskDescription}</Typography>
                            </Tooltip>}
                      </TableCell>
                      <TableCell>{r.workCategoryName ?? '—'}</TableCell>
                      <TableCell align="right">{r.hoursLogged}</TableCell>
                      <TableCell align="right">{r.estimatedHours}</TableCell>
                      <TableCell align="right">{r.remainingHours}</TableCell>
                      <TableCell>{dayjs(r.dsrDate).format('DD MMM YY')}</TableCell>
                      <TableCell>{r.submissionDate ? dayjs(r.submissionDate).format('DD MMM HH:mm') : '—'}</TableCell>
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
                    </TableRow>
                  ))}
                </TableBody>
              </>
            )}

            {['employee', 'project', 'department', 'manager', 'category'].includes(active.key) && (
              <>
                <TableHead>
                  <TableRow>
                    {[active.label.replace('-wise', ''), 'Entries', 'Employees', 'Projects', 'Days',
                      'Hours logged', 'Estimated', 'Avg/day', 'Pending', 'Approved', 'Returned', 'Share'].map((h) => (
                        <TableCell key={h}>{h}</TableCell>))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={`${r.groupId}-${r.groupName}`} hover>
                      <TableCell>
                        <Typography variant="body2">{r.groupName}</Typography>
                        {r.groupSubtitle && <Typography variant="caption" color="text.secondary">{r.groupSubtitle}</Typography>}
                      </TableCell>
                      <TableCell align="right">{r.entryCount}</TableCell>
                      <TableCell align="right">{r.employeeCount}</TableCell>
                      <TableCell align="right">{r.projectCount}</TableCell>
                      <TableCell align="right">{r.daysLogged}</TableCell>
                      <TableCell align="right"><strong>{r.totalHoursLogged}</strong></TableCell>
                      <TableCell align="right">{r.totalEstimatedHours}</TableCell>
                      <TableCell align="right">{r.averageHoursPerDay}</TableCell>
                      <TableCell align="right">{r.pendingApprovalCount}</TableCell>
                      <TableCell align="right">{r.approvedCount}</TableCell>
                      <TableCell align="right">{r.returnedCount}</TableCell>
                      <TableCell align="right"><Chip size="small" label={`${r.sharePct}%`} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </>
            )}

            {active.key === 'approval' && (
              <>
                <TableHead>
                  <TableRow>
                    {['Approval status', 'Entries', 'Employees', 'Hours', 'Share', 'Oldest (days)'].map((h) => (
                      <TableCell key={h}>{h}</TableCell>))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.statusCode} hover>
                      <TableCell><Chip size="small" label={r.approvalStatus} color={STATUS_COLOUR[r.statusCode] ?? 'default'} /></TableCell>
                      <TableCell align="right">{r.entryCount}</TableCell>
                      <TableCell align="right">{r.employeeCount}</TableCell>
                      <TableCell align="right">{r.totalHours}</TableCell>
                      <TableCell align="right">{r.sharePct}%</TableCell>
                      <TableCell align="right">{r.oldestAgeDays}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </>
            )}

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
                      <TableCell>{r.employeeName}</TableCell>
                      <TableCell>{r.employeeCode ?? '—'}</TableCell>
                      <TableCell>{r.employeeEmail}</TableCell>
                      <TableCell>{r.departmentName ?? '—'}</TableCell>
                      <TableCell>{r.managerName ?? '—'}</TableCell>
                      <TableCell align="right"><Chip size="small" color="error" label={r.missingDayCount} /></TableCell>
                      <TableCell>{r.mostRecentMissingDate ? dayjs(r.mostRecentMissingDate).format('DD MMM YY') : '—'}</TableCell>
                      <TableCell sx={{ maxWidth: 260 }}>
                        <Tooltip title={r.missingDates.map((d) => dayjs(d).format('DD MMM')).join(', ')}>
                          <Typography variant="caption" noWrap>
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
          <Alert severity="info" variant="outlined" sx={{ m: 2 }}>No data matches these filters.</Alert>
        )}

        {(active.key === 'details' || active.key === 'nowork') && (
          <TablePagination component="div" count={data?.totalCount ?? 0}
            page={(filter.page ?? 1) - 1} rowsPerPage={filter.pageSize}
            rowsPerPageOptions={[25, 50, 100, 200]}
            onPageChange={(_, p) => setFilter((f) => ({ ...f, page: p + 1 }))}
            onRowsPerPageChange={(e) => setFilter((f) => ({ ...f, pageSize: Number(e.target.value), page: 1 }))} />
        )}
      </Card>

      <Dialog open={returnDialog} onClose={() => setReturnDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Return {selected.length} DSR entr{selected.length === 1 ? 'y' : 'ies'}</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth multiline rows={3} label="Reason" sx={{ mt: 1 }}
            value={returnComment} onChange={(e) => setReturnComment(e.target.value)}
            helperText="At least 5 characters. The employee sees this on their entry." />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReturnDialog(false)}>Cancel</Button>
          <Button variant="contained" color="error" disabled={returnComment.trim().length < 5}
            onClick={() => review('RETURNED', returnComment.trim())}>Return</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} message={toast} />
    </Box>
  );
}
