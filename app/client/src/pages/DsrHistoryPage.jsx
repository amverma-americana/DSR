import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Card, Chip, FormControl, Grid, InputAdornment, InputLabel, LinearProgress, MenuItem,
  Select, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow,
  TextField, Tooltip, Typography,
} from '@mui/material';
import { History, Search, Sparkles } from 'lucide-react';
import dayjs from 'dayjs';
import { dsrApi, projectsApi } from '../api/client';
import PageHeader from '../components/PageHeader';
import FilterPanel from '../components/FilterPanel';
import EmptyState from '../components/EmptyState';
import ProjectSelect from '../components/ProjectSelect';
import { COLORS } from '../theme/tokens';

const emptyFilter = { page: 1, pageSize: 25, fromDate: '', toDate: '', projectId: '', isAiUsed: '', search: '' };

/**
 * DSR history with server-side paging and filtering. Row visibility is decided by the API:
 * an employee receives only their own rows, a manager their team, an admin everything.
 */
export default function DsrHistoryPage() {
  const [filter, setFilter] = useState(emptyFilter);
  const [result, setResult] = useState(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showFilters, setShowFilters] = useState(true);

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

  /** Count of narrowing filters, excluding paging — drives the badge on the collapsed panel. */
  const appliedCount = useMemo(
    () => ['fromDate', 'toDate', 'projectId', 'isAiUsed', 'search'].filter((k) => filter[k] !== '').length,
    [filter],
  );

  const rows = result?.items ?? [];

  return (
    <Box>
      <PageHeader title="DSR History" description="Every entry you are permitted to see, newest filters applied first." />

      <FilterPanel
        appliedCount={appliedCount}
        onReset={() => setFilter(emptyFilter)}
        open={showFilters}
        onToggle={() => setShowFilters((s) => !s)}
      >
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} lg={2}>
            <TextField label="From" type="date" fullWidth InputLabelProps={{ shrink: true }}
              value={filter.fromDate} onChange={set('fromDate')} />
          </Grid>
          <Grid item xs={12} sm={6} lg={2}>
            <TextField label="To" type="date" fullWidth InputLabelProps={{ shrink: true }}
              value={filter.toDate} onChange={set('toDate')} />
          </Grid>
          <Grid item xs={12} sm={6} lg={3}>
            <ProjectSelect
              projects={projects}
              value={filter.projectId}
              onChange={(id) => setFilter((f) => ({ ...f, projectId: id, page: 1 }))}
              label="Project"
              allLabel="All projects"
            />
          </Grid>
          <Grid item xs={12} sm={6} lg={2}>
            <FormControl fullWidth>
              <InputLabel id="ai">AI usage</InputLabel>
              <Select labelId="ai" label="AI usage" value={filter.isAiUsed} onChange={set('isAiUsed')}>
                <MenuItem value="">Any</MenuItem>
                <MenuItem value="true">AI used</MenuItem>
                <MenuItem value="false">No AI</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} lg={3}>
            <TextField
              label="Search" fullWidth placeholder="Description, employee, project"
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

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Card>
        {loading && <LinearProgress aria-label="Loading entries" />}

        <TableContainer>
          <Table size="small" stickyHeader>
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
              {rows.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{dayjs(row.workDate).format('DD MMM YYYY')}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.employeeName}</TableCell>
                  <TableCell>
                    {row.isNoWorkDone
                      ? <Chip size="small" variant="outlined" label="No Work Done" />
                      : row.projectName}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{row.estimatedHours}</TableCell>
                  <TableCell>
                    {row.isAiUsed === null || row.isAiUsed === undefined
                      ? <Typography variant="body2" color="text.disabled">—</Typography>
                      : row.isAiUsed
                        ? (
                          <Chip
                            size="small" icon={<Sparkles size={11} />} label={row.aiToolName ?? 'Yes'}
                            sx={{ bgcolor: COLORS.successLight, color: COLORS.success, fontWeight: 600, '& .MuiChip-icon': { color: COLORS.success } }}
                          />
                        )
                        : <Chip size="small" label="No" variant="outlined" />}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 320 }}>
                    <Tooltip title={row.workDescriptionPlain ?? ''}>
                      <Typography variant="body2" noWrap>{row.workDescriptionPlain}</Typography>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {!loading && rows.length === 0 && (
          <EmptyState
            icon={History}
            title="No entries match these filters"
            description="Try widening the date range, or clear the filters to see everything available to you."
          />
        )}

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
