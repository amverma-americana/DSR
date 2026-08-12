import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, Grid, LinearProgress, Stack, Tab, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tabs, TextField, Typography,
} from '@mui/material';
import { BarChart3, Download, Sparkles } from 'lucide-react';
import dayjs from 'dayjs';
import { reportsApi } from '../api/client';
import PageHeader from '../components/PageHeader';
import FilterPanel from '../components/FilterPanel';
import SectionCard from '../components/SectionCard';
import StatCard from '../components/StatCard';
import EmptyState from '../components/EmptyState';
import { DonutChart } from '../components/Charts';

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

  const setRange = (fromDate, toDate) => setFilter((f) => ({ ...f, fromDate, toDate }));

  return (
    <Box>
      <PageHeader
        title="Reports"
        description="Effort, utilisation and compliance across the period you select."
        actions={(
          <Button
            variant="outlined"
            startIcon={<Download size={16} />}
            onClick={() => reportsApi.exportCsv(report.exportKey, params).catch((e) => setError(e.message))}
          >
            Export CSV
          </Button>
        )}
      />

      <FilterPanel
        title="Period"
        appliedCount={0}
        actions={(
          <>
            <Button
              size="small" variant="text"
              onClick={() => setRange(dayjs().startOf('month').format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD'))}
            >
              This month
            </Button>
            <Button
              size="small" variant="text"
              onClick={() => setRange(
                dayjs().subtract(1, 'month').startOf('month').format('YYYY-MM-DD'),
                dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD'),
              )}
            >
              Last month
            </Button>
          </>
        )}
      >
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} lg={3}>
            <TextField label="From" type="date" fullWidth InputLabelProps={{ shrink: true }}
              value={filter.fromDate} onChange={(e) => setFilter((f) => ({ ...f, fromDate: e.target.value }))} />
          </Grid>
          <Grid item xs={12} sm={6} lg={3}>
            <TextField label="To" type="date" fullWidth InputLabelProps={{ shrink: true }}
              value={filter.toDate} onChange={(e) => setFilter((f) => ({ ...f, toDate: e.target.value }))} />
          </Grid>
        </Grid>
      </FilterPanel>

      {/* ------------------------------------------------------------------ AI adoption */}
      {ai && (
        <Grid container spacing={2.5} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={6} lg={3}>
            <StatCard
              label="AI adoption" value={`${ai.overallAdoptionPct}%`} icon={Sparkles} tone="success"
              caption={`${ai.aiUsedDeclarations} of ${ai.totalDeclarations} declarations`}
            />
          </Grid>
          <Grid item xs={12} sm={6} lg={3}>
            <StatCard
              label="Declarations" value={ai.totalDeclarations} icon={BarChart3} tone="primary"
              caption="In the selected period"
            />
          </Grid>
          <Grid item xs={12} lg={6}>
            <SectionCard title="Tools used" subtitle="Share of AI-assisted days">
              {ai.byTool.length === 0 ? (
                <EmptyState
                  compact icon={Sparkles} title="No AI usage recorded"
                  description="Nobody declared AI assistance in this period."
                />
              ) : (
                <Grid container spacing={2} alignItems="center">
                  <Grid item xs={12} sm={6}>
                    <DonutChart
                      data={ai.byTool.map((t) => ({ name: t.toolName, value: t.usageDayCount }))}
                      height={190}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Stack spacing={1}>
                      {ai.byTool.map((t) => (
                        <Stack key={t.aiToolId ?? t.toolName} direction="row" justifyContent="space-between" spacing={1}>
                          <Typography variant="body2" noWrap>{t.toolName}</Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                            {t.usageDayCount} day(s) · {t.sharePct}%
                          </Typography>
                        </Stack>
                      ))}
                    </Stack>
                  </Grid>
                </Grid>
              )}
            </SectionCard>
          </Grid>
        </Grid>
      )}

      {/* ------------------------------------------------------------------ report */}
      <Card>
        <Tabs
          value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto"
          aria-label="Report type"
          sx={{ borderBottom: 1, borderColor: 'divider', px: 1 }}
        >
          {REPORTS.map((r) => <Tab key={r.key} label={r.label} />)}
        </Tabs>

        {loading && <LinearProgress aria-label="Loading report" />}
        {error && <Alert severity="error" sx={{ m: 3 }}>{error}</Alert>}

        <TableContainer sx={{ maxHeight: 640 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {report.columns.map(([header, , align]) => (
                  <TableCell key={header} align={align ?? 'left'}>{header}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={row.userId ?? row.projectId ?? index} hover>
                  {report.columns.map(([header, render, align]) => (
                    <TableCell key={header} align={align ?? 'left'}>{render(row)}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {!loading && rows.length === 0 && (
          <EmptyState
            icon={BarChart3}
            title="No data for the selected period"
            description="Widen the date range, or pick a different report from the tabs above."
          />
        )}
      </Card>
    </Box>
  );
}
