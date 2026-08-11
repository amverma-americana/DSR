import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Chip, Grid, LinearProgress, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { dashboardApi } from '../api/client';
import { ROLES, useAuth } from '../auth/AuthContext';

const Stat = ({ label, value, suffix, color = 'text.primary' }) => (
  <Card sx={{ height: '100%' }}>
    <CardContent>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </Typography>
      <Typography variant="h5" sx={{ color, mt: 0.5 }}>
        {value}{suffix ? <Typography component="span" variant="body2" color="text.secondary"> {suffix}</Typography> : null}
      </Typography>
    </CardContent>
  </Card>
);

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

  if (loading) return <LinearProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5">Welcome, {user?.fullName?.split(' ')[0]}</Typography>
          <Typography variant="body2" color="text.secondary">
            {scope === 'admin' ? 'Organisation overview' : scope === 'manager' ? 'Team overview' : 'Your activity'}
          </Typography>
        </Box>
        <Button component={RouterLink} to="/dsr" variant="contained">Record today&apos;s DSR</Button>
      </Stack>

      {scope === 'employee' && (
        <>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={6} md={3}><Stat label="Today" value={data.todayHours} suffix={`/ ${data.standardDailyHours} h`}
              color={data.hasSubmittedToday ? 'success.main' : 'warning.main'} /></Grid>
            <Grid item xs={6} md={3}><Stat label="This week" value={data.weekHours} suffix="h" /></Grid>
            <Grid item xs={6} md={3}><Stat label="This month" value={data.monthHours} suffix="h" /></Grid>
            <Grid item xs={6} md={3}><Stat label="Missing days" value={data.missingDaysThisMonth}
              color={data.missingDaysThisMonth > 0 ? 'error.main' : 'success.main'} /></Grid>
          </Grid>

          {!data.hasSubmittedToday && (
            <Alert severity="warning" sx={{ mb: 2 }}
              action={<Button component={RouterLink} to="/dsr" size="small">Record now</Button>}>
              You have not recorded a DSR for today.
            </Alert>
          )}

          <Grid container spacing={2}>
            <Grid item xs={12} md={7}>
              <Card><CardContent>
                <Typography variant="subtitle1" gutterBottom>Last 14 days</Typography>
                <Table size="small">
                  <TableHead><TableRow>
                    <TableCell>Date</TableCell><TableCell align="right">Entries</TableCell>
                    <TableCell align="right">Hours</TableCell><TableCell align="right">Utilisation</TableCell>
                  </TableRow></TableHead>
                  <TableBody>
                    {data.last14Days.map((d) => (
                      <TableRow key={d.workDate} hover>
                        <TableCell>{d.workDate}</TableCell>
                        <TableCell align="right">{d.entryCount}</TableCell>
                        <TableCell align="right">{d.totalHours}</TableCell>
                        <TableCell align="right">
                          <Chip size="small" label={`${d.dayUtilizationPct}%`}
                            color={d.dayUtilizationPct >= 100 ? 'success' : d.dayUtilizationPct >= 60 ? 'warning' : 'default'} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </Grid>
            <Grid item xs={12} md={5}>
              <Card><CardContent>
                <Typography variant="subtitle1" gutterBottom>Top projects this month</Typography>
                {data.topProjectsThisMonth.length === 0
                  ? <Alert severity="info" variant="outlined">No effort recorded yet this month.</Alert>
                  : (
                    <Table size="small">
                      <TableBody>
                        {data.topProjectsThisMonth.map((p) => (
                          <TableRow key={p.projectId}>
                            <TableCell>{p.projectName}</TableCell>
                            <TableCell align="right">{p.totalHours} h</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                  AI adoption this month: {data.monthAiAdoptionPct}%
                </Typography>
              </CardContent></Card>
            </Grid>
          </Grid>
        </>
      )}

      {scope === 'manager' && (
        <>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={6} md={3}><Stat label="Team size" value={data.teamSize} /></Grid>
            <Grid item xs={6} md={3}><Stat label="Team hours (month)" value={data.teamHoursThisMonth} suffix="h" /></Grid>
            <Grid item xs={6} md={3}><Stat label="Avg utilisation" value={`${data.teamAvgUtilizationPct}%`} /></Grid>
            <Grid item xs={6} md={3}><Stat label="Missing DSRs" value={data.teamMissingDsrCount}
              color={data.teamMissingDsrCount > 0 ? 'error.main' : 'success.main'} /></Grid>
          </Grid>

          <Grid container spacing={2}>
            <Grid item xs={12} md={7}>
              <Card><CardContent>
                <Typography variant="subtitle1" gutterBottom>Resource utilisation</Typography>
                <Table size="small">
                  <TableHead><TableRow>
                    <TableCell>Employee</TableCell><TableCell align="right">Logged</TableCell>
                    <TableCell align="right">Capacity</TableCell><TableCell align="right">Utilisation</TableCell>
                  </TableRow></TableHead>
                  <TableBody>
                    {data.utilization.map((r) => (
                      <TableRow key={r.userId} hover>
                        <TableCell>{r.employeeName}</TableCell>
                        <TableCell align="right">{r.loggedHours}</TableCell>
                        <TableCell align="right">{r.capacityHours}</TableCell>
                        <TableCell align="right">
                          <Chip size="small" label={`${r.utilizationPct}%`}
                            color={r.ragStatus === 'GREEN' ? 'success' : r.ragStatus === 'AMBER' ? 'warning' : 'error'} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </Grid>
            <Grid item xs={12} md={5}>
              <Card><CardContent>
                <Typography variant="subtitle1" gutterBottom>Missing DSRs</Typography>
                {data.missingDsr.length === 0
                  ? <Alert severity="success" variant="outlined">The team is fully compliant.</Alert>
                  : (
                    <Table size="small">
                      <TableBody>
                        {data.missingDsr.map((r) => (
                          <TableRow key={r.userId}>
                            <TableCell>{r.employeeName}</TableCell>
                            <TableCell align="right"><Chip size="small" color="error" label={`${r.missingDayCount} days`} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
              </CardContent></Card>
            </Grid>
          </Grid>
        </>
      )}

      {scope === 'admin' && (
        <>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={6} md={3}><Stat label="Active users" value={`${data.activeUsers} / ${data.totalUsers}`} /></Grid>
            <Grid item xs={6} md={3}><Stat label="Active projects" value={`${data.activeProjects} / ${data.totalProjects}`} /></Grid>
            <Grid item xs={6} md={3}><Stat label="Entries this month" value={data.dsrEntriesThisMonth} /></Grid>
            <Grid item xs={6} md={3}><Stat label="AI adoption" value={`${data.orgAiAdoptionPct}%`} /></Grid>
          </Grid>

          <Card><CardContent>
            <Typography variant="subtitle1" gutterBottom>Top projects by effort this month</Typography>
            <Table size="small">
              <TableHead><TableRow>
                <TableCell>Code</TableCell><TableCell>Project</TableCell>
                <TableCell align="right">Contributors</TableCell><TableCell align="right">Hours</TableCell>
                <TableCell align="right">Share</TableCell>
              </TableRow></TableHead>
              <TableBody>
                {data.topProjects.map((p) => (
                  <TableRow key={p.projectId} hover>
                    <TableCell>{p.projectCode}</TableCell>
                    <TableCell>{p.projectName}</TableCell>
                    <TableCell align="right">{p.contributorCount}</TableCell>
                    <TableCell align="right">{p.totalHours}</TableCell>
                    <TableCell align="right">{p.sharePct}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </>
      )}
    </Box>
  );
}
