import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, Grid, LinearProgress, Stack, Tab, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import dayjs from 'dayjs';
import { reportsApi } from '../api/client';

/**
 * All six reports plus the missing-DSR compliance view behind one shared filter bar, matching the
 * requirement that every report filters by employee, project, date range and AI usage.
 *
 * Each tab declares its columns and its fetch, so adding a report is a single entry in REPORTS.
 */
const REPORTS = [
  {
    key: 'employee', label: 'Employee', exportKey: 'employee', fetch: reportsApi.employee,
    columns: [
      ['Employee', (r) => r.employeeName], ['Manager', (r) => r.managerName ?? '—'],
      ['Entries', (r) => r.entryCount, 'right'], ['Days', (r) => r.daysLogged, 'right'],
      ['Projects', (r) => r.projectCount, 'right'], ['Hours', (r) => r.totalHours, 'right'],
      ['Avg/day', (r) => r.avgHoursPerLoggedDay, 'right'],
      ['AI adoption', (r) => <Chip size="small" label={`${r.aiAdoptionPct}%`} />, 'right'],
    ],
  },
  {
    key: 'project', label: 'Project', exportKey: 'project', fetch: reportsApi.project,
    columns: [
      ['Code', (r) => r.projectCode], ['Project', (r) => r.projectName],
      ['Status', (r) => <Chip size="small" variant="outlined" label={r.projectStatus} />],
      ['Contributors', (r) => r.contributorCount, 'right'], ['Hours', (r) => r.totalHours, 'right'],
      ['Share', (r) => `${r.sharePct}%`, 'right'],
    ],
  },
  {
    key: 'utilization', label: 'Resource Utilisation', exportKey: 'utilization', fetch: reportsApi.utilization,
    columns: [
      ['Employee', (r) => r.employeeName], ['Working days', (r) => r.workingDaysInPeriod, 'right'],
      ['Capacity', (r) => r.capacityHours, 'right'], ['Planned', (r) => r.plannedHours, 'right'],
      ['Logged', (r) => r.loggedHours, 'right'],
      ['Utilisation', (r) => (
        <Chip size="small" label={`${r.utilizationPct}%`}
          color={r.ragStatus === 'GREEN' ? 'success' : r.ragStatus === 'AMBER' ? 'warning' : 'error'} />
      ), 'right'],
    ],
  },
  {
    key: 'daily', label: 'Daily Summary', exportKey: 'daily', fetch: reportsApi.dailySummary,
    columns: [
      ['Date', (r) => r.workDate], ['Employee', (r) => r.employeeName],
      ['Entries', (r) => r.entryCount, 'right'], ['Projects', (r) => r.projectCount, 'right'],
      ['Hours', (r) => r.totalHours, 'right'], ['Day utilisation', (r) => `${r.dayUtilizationPct}%`, 'right'],
    ],
  },
  {
    key: 'monthly', label: 'Monthly Summary', exportKey: 'monthly', fetch: reportsApi.monthlySummary,
    columns: [
      ['Month', (r) => r.monthLabel], ['Employee', (r) => r.employeeName],
      ['Days logged', (r) => r.daysLogged, 'right'], ['Entries', (r) => r.entryCount, 'right'],
      ['Hours', (r) => r.totalHours, 'right'], ['Avg/day', (r) => r.avgHoursPerLoggedDay, 'right'],
    ],
  },
  {
    key: 'missing', label: 'Missing DSR', exportKey: 'missing',
    fetch: async (f) => ({ items: await reportsApi.missingDsr(f), totalCount: 0 }),
    columns: [
      ['Employee', (r) => r.employeeName],
      ['Missing days', (r) => <Chip size="small" color="error" label={r.missingDayCount} />, 'right'],
      ['Dates', (r) => r.missingDates.map((d) => dayjs(d).format('DD MMM')).join(', ')],
    ],
  },
];

export default function ReportsPage() {
  const [tab, setTab] = useState(0);
  const [filter, setFilter] = useState({
    fromDate: dayjs().startOf('month').format('YYYY-MM-DD'),
    toDate: dayjs().format('YYYY-MM-DD'),
    page: 1, pageSize: 100,
  });
  const [rows, setRows] = useState([]);
  const [ai, setAi] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const report = REPORTS[tab];
  const params = useMemo(
    () => Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== '' && v !== null)),
    [filter],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, aiData] = await Promise.all([report.fetch(params), reportsApi.aiUsage(params)]);
      setRows(data.items ?? []);
      setAi(aiData);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [report, params]);

  useEffect(() => { load(); }, [load]);

  return (
    <Box>
      <Typography variant="h5" gutterBottom>Reports</Typography>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={4} md={3}>
              <TextField label="From" type="date" fullWidth size="small" InputLabelProps={{ shrink: true }}
                value={filter.fromDate} onChange={(e) => setFilter((f) => ({ ...f, fromDate: e.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={4} md={3}>
              <TextField label="To" type="date" fullWidth size="small" InputLabelProps={{ shrink: true }}
                value={filter.toDate} onChange={(e) => setFilter((f) => ({ ...f, toDate: e.target.value }))} />
            </Grid>
            <Grid item xs={12} md={6}>
              <Stack direction="row" spacing={1} justifyContent={{ md: 'flex-end' }}>
                <Button size="small" onClick={() => setFilter((f) => ({
                  ...f, fromDate: dayjs().startOf('month').format('YYYY-MM-DD'), toDate: dayjs().format('YYYY-MM-DD'),
                }))}>This month</Button>
                <Button size="small" onClick={() => setFilter((f) => ({
                  ...f,
                  fromDate: dayjs().subtract(1, 'month').startOf('month').format('YYYY-MM-DD'),
                  toDate: dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD'),
                }))}>Last month</Button>
                <Button size="small" variant="outlined" startIcon={<DownloadIcon />}
                  onClick={() => reportsApi.exportCsv(report.exportKey, params).catch((e) => setError(e.message))}>
                  Export CSV
                </Button>
              </Stack>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {ai && (
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} md={4}>
            <Card><CardContent>
              <Typography variant="caption" color="text.secondary">AI ADOPTION (PERIOD)</Typography>
              <Typography variant="h5">{ai.overallAdoptionPct}%</Typography>
              <Typography variant="caption" color="text.secondary">
                {ai.aiUsedDeclarations} of {ai.totalDeclarations} declarations
              </Typography>
            </CardContent></Card>
          </Grid>
          <Grid item xs={12} md={8}>
            <Card><CardContent>
              <Typography variant="caption" color="text.secondary">TOOLS USED</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1, gap: 1 }}>
                {ai.byTool.length === 0
                  ? <Typography variant="body2" color="text.secondary">No AI usage recorded in this period.</Typography>
                  : ai.byTool.map((t) => (
                    <Chip key={t.aiToolId ?? t.toolName} label={`${t.toolName} — ${t.usageDayCount} day(s), ${t.sharePct}%`} size="small" />
                  ))}
              </Stack>
            </CardContent></Card>
          </Grid>
        </Grid>
      )}

      <Card>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto"
          sx={{ borderBottom: 1, borderColor: 'divider' }}>
          {REPORTS.map((r) => <Tab key={r.key} label={r.label} />)}
        </Tabs>

        {loading && <LinearProgress />}
        {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {report.columns.map(([header, , align]) => (
                  <TableCell key={header} align={align ?? 'left'}>{header}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length ? rows.map((row, index) => (
                <TableRow key={row.userId ?? row.projectId ?? index} hover>
                  {report.columns.map(([header, render, align]) => (
                    <TableCell key={header} align={align ?? 'left'}>{render(row)}</TableCell>
                  ))}
                </TableRow>
              )) : !loading && (
                <TableRow>
                  <TableCell colSpan={report.columns.length}>
                    <Alert severity="info" variant="outlined">No data for the selected period.</Alert>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Box>
  );
}
