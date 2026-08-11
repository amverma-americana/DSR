import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Card, CardContent, Chip, FormControl, Grid, InputLabel, LinearProgress, MenuItem,
  Select, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow,
  TextField, Typography,
} from '@mui/material';
import { dsrApi, projectsApi } from '../api/client';

/**
 * DSR history with server-side paging and filtering. Row visibility is decided by the API:
 * an employee receives only their own rows, a manager their team, an admin everything.
 */
export default function DsrHistoryPage() {
  const [filter, setFilter] = useState({ page: 1, pageSize: 25, fromDate: '', toDate: '', projectId: '', isAiUsed: '', search: '' });
  const [result, setResult] = useState(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    projectsApi.search({ pageSize: 200 }).then((r) => setProjects(r.items)).catch(() => setProjects([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Strip empty strings so the API receives absent filters rather than blank values.
      const params = Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== '' && v !== null));
      setResult(await dsrApi.search(params));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const set = (key) => (event) => setFilter((f) => ({ ...f, [key]: event.target.value, page: 1 }));

  return (
    <Box>
      <Typography variant="h5" gutterBottom>DSR History</Typography>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={2.5}>
              <TextField label="From" type="date" fullWidth size="small" InputLabelProps={{ shrink: true }}
                value={filter.fromDate} onChange={set('fromDate')} />
            </Grid>
            <Grid item xs={12} sm={6} md={2.5}>
              <TextField label="To" type="date" fullWidth size="small" InputLabelProps={{ shrink: true }}
                value={filter.toDate} onChange={set('toDate')} />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel id="proj">Project</InputLabel>
                <Select labelId="proj" label="Project" value={filter.projectId} onChange={set('projectId')}>
                  <MenuItem value="">All projects</MenuItem>
                  {projects.map((p) => <MenuItem key={p.id} value={p.id}>{p.projectName}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel id="ai">AI usage</InputLabel>
                <Select labelId="ai" label="AI usage" value={filter.isAiUsed} onChange={set('isAiUsed')}>
                  <MenuItem value="">Any</MenuItem>
                  <MenuItem value="true">AI used</MenuItem>
                  <MenuItem value="false">No AI</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField label="Search" fullWidth size="small" placeholder="Description, employee, project"
                value={filter.search} onChange={set('search')} />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && <LinearProgress sx={{ mb: 1 }} />}

      <Card>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Employee</TableCell>
                <TableCell>Project</TableCell>
                <TableCell align="right">Hours</TableCell>
                <TableCell>AI</TableCell>
                <TableCell>Description</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {result?.items?.length ? result.items.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell>{row.workDate}</TableCell>
                  <TableCell>{row.employeeName}</TableCell>
                  <TableCell>
                    {row.isNoWorkDone
                      ? <Chip size="small" variant="outlined" label="No Work Done" />
                      : row.projectName}
                  </TableCell>
                  <TableCell align="right">{row.estimatedHours}</TableCell>
                  <TableCell>
                    {row.isAiUsed === null || row.isAiUsed === undefined
                      ? '—'
                      : <Chip size="small" color={row.isAiUsed ? 'success' : 'default'}
                          label={row.isAiUsed ? (row.aiToolName ?? 'Yes') : 'No'} />}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 320, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.workDescriptionPlain}
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={6}>
                  <Alert severity="info" variant="outlined">No DSR entries match these filters.</Alert>
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          component="div"
          count={result?.totalCount ?? 0}
          page={(filter.page ?? 1) - 1}
          rowsPerPage={filter.pageSize}
          rowsPerPageOptions={[10, 25, 50, 100]}
          onPageChange={(_, page) => setFilter((f) => ({ ...f, page: page + 1 }))}
          onRowsPerPageChange={(e) => setFilter((f) => ({ ...f, pageSize: Number(e.target.value), page: 1 }))}
        />
      </Card>
    </Box>
  );
}
