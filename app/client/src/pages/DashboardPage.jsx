import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, Grid, LinearProgress, Table, TableBody, TableCell, TableHead, TableRow,
} from '@mui/material';
import {
  AlertTriangle, BriefcaseBusiness, CalendarClock, CalendarDays, CheckCircle2, FolderKanban,
  Gauge, Sparkles, SquarePen, Users,
} from 'lucide-react';
// `ListChecks` was used only by the commented-out "Entries" card; restore the import with it.
import dayjs from 'dayjs';
import { dashboardApi } from '../api/client';
import { ROLES, useAuth } from '../auth/AuthContext';
import PageHeader from '../components/PageHeader';
import SectionCard from '../components/SectionCard';
import StatCard from '../components/StatCard';
import EmptyState from '../components/EmptyState';
import { BarSeriesChart, DonutChart } from '../components/Charts';
import { COLORS } from '../theme/tokens';

const RAG_TONE = { GREEN: 'success', AMBER: 'warning', RED: 'error' };

/**
 * Renders the dashboard for the highest privilege the user holds: Admin sees the organisation view,
 * Manager the team view, everyone their own. Each variant hits a different endpoint, and each of
 * those independently enforces the role, so this is presentation only.
 */
export default function DashboardPage() {
  const { user, hasRole } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const scope = hasRole(ROLES.ADMIN) ? 'admin' : hasRole(ROLES.MANAGER) ? 'manager' : 'employee';

  useEffect(() => {
    const load = scope === 'admin' ? dashboardApi.admin()
      : scope === 'manager' ? dashboardApi.manager({})
        : dashboardApi.employee();

    load.then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [scope]);

  /*  Chronological copy of the fortnight, used by both the chart and the week-on-week comparison.
      The API's ordering is not relied upon: a descending list would otherwise draw the chart
      backwards and invert the trend arrow.  */
  const fortnight = useMemo(() => {
    if (scope !== 'employee' || !data?.last14Days) return [];
    return [...data.last14Days].sort((a, b) => a.workDate.localeCompare(b.workDate));
  }, [data, scope]);

  /*  A GENUINE measured comparison: the most recent seven days against the seven before them,
      both already present in the payload. StatCard's trend arrow is only ever fed real
      period-on-period figures like this one -- never a percentage of a target dressed up as a
      trend, which would imply a movement nobody measured.  */
  const weekTrend = useMemo(() => {
    if (fortnight.length < 14) return undefined;
    const sum = (rows) => rows.reduce((total, d) => total + (Number(d.totalHours) || 0), 0);
    const previous = sum(fortnight.slice(0, 7));
    const current = sum(fortnight.slice(7));
    if (previous === 0) return undefined;

    return {
      value: Math.round(((current - previous) / previous) * 100),
      label: `${current}h in the last 7 days vs ${previous}h the week before`,
    };
  }, [fortnight]);

  if (loading) return <LinearProgress aria-label="Loading dashboard" />;
  if (error) return <Alert severity="error">{error}</Alert>;

  const scopeLabel = scope === 'admin' ? 'Organisation overview'
    : scope === 'manager' ? 'Team overview' : 'Your activity';

  return (
    <Box>
      <PageHeader
        title={`Welcome, ${user?.fullName?.split(' ')[0] ?? ''}`}
        description={scopeLabel}
        actions={(
          <Button component={RouterLink} to="/dsr" variant="contained" startIcon={<SquarePen size={16} />}>
            Record today&apos;s DSR
          </Button>
        )}
      />

      {/* ==================================================================== EMPLOYEE */}
      {scope === 'employee' && (
        <>
          <Grid container spacing={2.5} sx={{ mb: 3 }}>
            <Grid item xs={6} lg={3}>
              <StatCard
                label="Today" value={data.todayHours} suffix={`/ ${data.standardDailyHours} h`}
                icon={data.hasSubmittedToday ? CheckCircle2 : CalendarClock}
                tone={data.hasSubmittedToday ? 'success' : 'warning'}
                caption={data.hasSubmittedToday ? 'Recorded' : 'Not recorded yet'}
              />
            </Grid>
            <Grid item xs={6} lg={3}>
              <StatCard
                label="This week" value={data.weekHours} suffix="h" icon={CalendarDays}
                tone="primary" trend={weekTrend} caption={weekTrend ? 'vs previous 7 days' : undefined}
              />
            </Grid>
            <Grid item xs={6} lg={3}>
              <StatCard label="This month" value={data.monthHours} suffix="h" icon={Gauge} tone="primary" />
            </Grid>
            <Grid item xs={6} lg={3}>
              <StatCard
                label="Missing days" value={data.missingDaysThisMonth}
                icon={data.missingDaysThisMonth > 0 ? AlertTriangle : CheckCircle2}
                tone={data.missingDaysThisMonth > 0 ? 'danger' : 'success'}
                caption={data.missingDaysThisMonth > 0 ? 'This month' : 'Fully compliant'}
              />
            </Grid>
          </Grid>

          {!data.hasSubmittedToday && (
            <Alert
              severity="warning"
              sx={{ mb: 3 }}
              action={<Button component={RouterLink} to="/dsr" size="small" variant="contained" color="warning">Record now</Button>}
            >
              You have not recorded a DSR for today.
            </Alert>
          )}

          <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
            <Grid item xs={12} lg={8}>
              <SectionCard title="Hours logged" subtitle="Last 14 days">
                <BarSeriesChart
                  data={fortnight.map((d) => ({ ...d, label: dayjs(d.workDate).format('DD MMM') }))}
                  xKey="label"
                  series={[{ key: 'totalHours', name: 'Hours logged', color: COLORS.primary }]}
                  height={248}
                />
              </SectionCard>
            </Grid>
            <Grid item xs={12} lg={4}>
              <SectionCard title="Top projects" subtitle="This month">
                <DonutChart
                  data={data.topProjectsThisMonth.map((p) => ({ name: p.projectName, value: p.totalHours }))}
                  height={248}
                  centreValue={`${data.monthAiAdoptionPct}%`}
                  centreLabel="AI adoption"
                />
              </SectionCard>
            </Grid>
          </Grid>

          <Grid container spacing={2.5}>
            <Grid item xs={12} lg={8}>
              <SectionCard title="Daily breakdown" subtitle="Last 14 days" noPadding dividing>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell align="right">Entries</TableCell>
                      <TableCell align="right">Hours</TableCell>
                      <TableCell align="right">Utilisation</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {fortnight.map((d) => (
                      <TableRow key={d.workDate} hover>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{dayjs(d.workDate).format('ddd, DD MMM')}</TableCell>
                        <TableCell align="right">{d.entryCount}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>{d.totalHours}</TableCell>
                        <TableCell align="right">
                          <Chip
                            size="small" label={`${d.dayUtilizationPct}%`}
                            color={d.dayUtilizationPct >= 100 ? 'success' : d.dayUtilizationPct >= 60 ? 'warning' : 'default'}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </SectionCard>
            </Grid>

            <Grid item xs={12} lg={4}>
              <SectionCard title="Effort by project" subtitle="This month" noPadding dividing>
                {data.topProjectsThisMonth.length === 0 ? (
                  <EmptyState
                    compact icon={FolderKanban} title="No effort recorded"
                    description="Nothing has been logged against a project this month."
                  />
                ) : (
                  <Table size="small">
                    <TableBody>
                      {data.topProjectsThisMonth.map((p) => (
                        <TableRow key={p.projectId} hover>
                          <TableCell>{p.projectName}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{p.totalHours} h</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </SectionCard>
            </Grid>
          </Grid>
        </>
      )}

      {/* ==================================================================== MANAGER */}
      {scope === 'manager' && (
        <>
          <Grid container spacing={2.5} sx={{ mb: 3 }}>
            <Grid item xs={6} lg={3}>
              <StatCard label="Team size" value={data.teamSize} icon={Users} tone="primary" />
            </Grid>
            <Grid item xs={6} lg={3}>
              <StatCard label="Team hours" value={data.teamHoursThisMonth} suffix="h" icon={CalendarDays} tone="primary" caption="This month" />
            </Grid>
            <Grid item xs={6} lg={3}>
              <StatCard
                label="Avg utilisation" value={`${data.teamAvgUtilizationPct}%`} icon={Gauge}
                tone={data.teamAvgUtilizationPct >= 80 ? 'success' : data.teamAvgUtilizationPct >= 60 ? 'warning' : 'danger'}
                caption="Logged against capacity"
              />
            </Grid>
            <Grid item xs={6} lg={3}>
              <StatCard
                label="Missing DSRs" value={data.teamMissingDsrCount}
                icon={data.teamMissingDsrCount > 0 ? AlertTriangle : CheckCircle2}
                tone={data.teamMissingDsrCount > 0 ? 'danger' : 'success'}
              />
            </Grid>
          </Grid>

          <SectionCard title="Capacity against logged effort" subtitle="Every team member, this period" sx={{ mb: 2.5 }}>
            <BarSeriesChart
              data={data.utilization.map((r) => ({ ...r, label: r.employeeName }))}
              xKey="label"
              series={[
                { key: 'capacityHours', name: 'Capacity', color: COLORS.borderStrong },
                { key: 'loggedHours', name: 'Logged', color: COLORS.primary },
              ]}
              height={Math.max(240, data.utilization.length * 34)}
              layout="vertical"
            />
          </SectionCard>

          <Grid container spacing={2.5}>
            <Grid item xs={12} lg={7}>
              <SectionCard title="Resource utilisation" noPadding dividing>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Employee</TableCell>
                      <TableCell align="right">Logged</TableCell>
                      <TableCell align="right">Capacity</TableCell>
                      <TableCell align="right">Utilisation</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.utilization.map((r) => (
                      <TableRow key={r.userId} hover>
                        <TableCell>{r.employeeName}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>{r.loggedHours}</TableCell>
                        <TableCell align="right">{r.capacityHours}</TableCell>
                        <TableCell align="right">
                          <Chip size="small" label={`${r.utilizationPct}%`} color={RAG_TONE[r.ragStatus] ?? 'default'} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </SectionCard>
            </Grid>

            <Grid item xs={12} lg={5}>
              <SectionCard title="Missing DSRs" noPadding dividing>
                {data.missingDsr.length === 0 ? (
                  <EmptyState
                    compact icon={CheckCircle2} title="Fully compliant"
                    description="Every team member has submitted for the period."
                  />
                ) : (
                  <Table size="small">
                    <TableBody>
                      {data.missingDsr.map((r) => (
                        <TableRow key={r.userId} hover>
                          <TableCell>{r.employeeName}</TableCell>
                          <TableCell align="right">
                            <Chip size="small" color="error" label={`${r.missingDayCount} days`} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </SectionCard>
            </Grid>
          </Grid>
        </>
      )}

      {/* ==================================================================== ADMIN */}
      {scope === 'admin' && (
        <>
          <Grid container spacing={2.5} sx={{ mb: 3 }}>
            {/*  Labels only: "Active users" -> "Users", "Active projects" -> "Projects".
                 The values are untouched -- still activeUsers of totalUsers and activeProjects of
                 totalProjects, so the counts and the "N / M" suffix behave exactly as before. */}
            <Grid item xs={6} lg={4}>
              <StatCard
                label="Users" value={data.activeUsers} suffix={`/ ${data.totalUsers}`}
                icon={Users} tone="primary"
              />
            </Grid>
            <Grid item xs={6} lg={4}>
              <StatCard
                label="Projects" value={data.activeProjects} suffix={`/ ${data.totalProjects}`}
                icon={BriefcaseBusiness} tone="primary"
              />
            </Grid>
            {/*  "Entries" card commented out from the UI as per current requirement.
                 dsrEntriesThisMonth is still returned by /dashboard/admin, so restoring this is a
                 one-line uncomment (revert the lg={4} widths above to lg={3} for a 4-up row). */}
            {/*
            <Grid item xs={6} lg={3}>
              <StatCard label="Entries" value={data.dsrEntriesThisMonth} icon={ListChecks} tone="primary" caption="This month" />
            </Grid>
            */}
            <Grid item xs={6} lg={4}>
              <StatCard label="AI adoption" value={`${data.orgAiAdoptionPct}%`} icon={Sparkles} tone="success" caption="Organisation-wide" />
            </Grid>
          </Grid>

          <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
            <Grid item xs={12} lg={7}>
              <SectionCard title="Effort by project" subtitle="This month">
                <BarSeriesChart
                  data={data.topProjects.map((p) => ({ ...p, label: p.projectName }))}
                  xKey="label"
                  series={[{ key: 'totalHours', name: 'Hours logged', color: COLORS.primary }]}
                  height={Math.max(240, data.topProjects.length * 34)}
                  layout="vertical"
                />
              </SectionCard>
            </Grid>
            <Grid item xs={12} lg={5}>
              <SectionCard title="Share of total effort" subtitle="This month">
                <DonutChart
                  data={data.topProjects.map((p) => ({ name: p.projectName, value: p.totalHours }))}
                  height={280}
                />
              </SectionCard>
            </Grid>
          </Grid>

          <SectionCard title="Top projects by effort" subtitle="This month" noPadding dividing>
            {data.topProjects.length === 0 ? (
              <EmptyState compact icon={FolderKanban} title="No effort recorded" description="Nothing has been logged this month." />
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Code</TableCell>
                    <TableCell>Project</TableCell>
                    <TableCell align="right">Contributors</TableCell>
                    <TableCell align="right">Hours</TableCell>
                    <TableCell align="right">Share</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.topProjects.map((p) => (
                    <TableRow key={p.projectId} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{p.projectCode}</TableCell>
                      <TableCell>{p.projectName}</TableCell>
                      <TableCell align="right">{p.contributorCount}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{p.totalHours}</TableCell>
                      <TableCell align="right"><Chip size="small" label={`${p.sharePct}%`} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </>
      )}
    </Box>
  );
}
