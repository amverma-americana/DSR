import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid,
  LinearProgress, MenuItem, Snackbar, Stack, Switch, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { useForm } from 'react-hook-form';
import { projectsApi, usersApi } from '../../api/client';

const STATUSES = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];

const STATUS_COLOUR = {
  ACTIVE: 'success', COMPLETED: 'default', ON_HOLD: 'warning', CANCELLED: 'error', PLANNED: 'info',
};

/**
 * Project administration plus resource allocation.
 *
 * Only ACTIVE and COMPLETED projects accept effort, so status here directly controls what appears
 * in the DSR project dropdown. Allocation percentages are the denominator of the utilisation
 * report; the API rejects overlapping windows and any total above 100 percent per employee.
 */
export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [managers, setManagers] = useState([]);
  const [team, setTeam] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(null);
  const [allocating, setAllocating] = useState(null);

  const { register, handleSubmit, reset, formState: { errors } } = useForm();
  const allocForm = useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await projectsApi.search({ pageSize: 200, sortBy: 'name' });
      setProjects(result.items);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    usersApi.managers().then(setManagers).catch(() => setManagers([]));
    usersApi.team().then(setTeam).catch(() => setTeam([]));
  }, []);

  const openDialog = (project) => {
    setEditing(project ?? { isNew: true });
    reset(project ?? {
      projectCode: '', projectName: '', description: '', status: 'PLANNED',
      startDate: '', endDate: '', projectManagerUserId: '',
    });
  };

  const onSubmit = async (values) => {
    const payload = {
      ...values,
      endDate: values.endDate || null,
      projectManagerUserId: values.projectManagerUserId === '' ? null : Number(values.projectManagerUserId),
    };
    try {
      if (editing.isNew) await projectsApi.create(payload);
      else await projectsApi.update(editing.id, payload);
      setToast('Project saved.');
      setEditing(null);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const openAllocations = async (project) => {
    setAllocating(project);
    allocForm.reset({ userId: '', allocationPercentage: 100, allocationStartDate: '', allocationEndDate: '', projectRole: '' });
    try {
      setAllocations(await projectsApi.allocations(project.id));
    } catch (e) {
      setError(e.message);
    }
  };

  const saveAllocation = async (values) => {
    try {
      await projectsApi.saveAllocation({
        projectId: allocating.id,
        userId: Number(values.userId),
        allocationPercentage: Number(values.allocationPercentage),
        allocationStartDate: values.allocationStartDate,
        allocationEndDate: values.allocationEndDate || null,
        projectRole: values.projectRole || null,
      });
      setToast('Allocation saved.');
      setAllocations(await projectsApi.allocations(allocating.id));
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Projects</Typography>
        <Button variant="contained" onClick={() => openDialog(null)}>Add project</Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {loading && <LinearProgress sx={{ mb: 1 }} />}

      <Card>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell><TableCell>Project</TableCell><TableCell>Status</TableCell>
                <TableCell>Window</TableCell><TableCell>Manager</TableCell>
                <TableCell align="right">Resources</TableCell><TableCell align="center">Logs effort</TableCell>
                <TableCell align="center">Active</TableCell><TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p.id} hover>
                  <TableCell>{p.projectCode}</TableCell>
                  <TableCell>{p.projectName}</TableCell>
                  <TableCell><Chip size="small" label={p.status} color={STATUS_COLOUR[p.status] ?? 'default'} /></TableCell>
                  <TableCell>{p.startDate} → {p.endDate ?? 'open'}</TableCell>
                  <TableCell>{p.projectManagerName ?? '—'}</TableCell>
                  <TableCell align="right">{p.allocatedResourceCount}</TableCell>
                  <TableCell align="center">{p.isOpenForEffort ? 'Yes' : 'No'}</TableCell>
                  <TableCell align="center">
                    <Switch size="small" checked={p.isActive}
                      onChange={async () => {
                        try { await projectsApi.setActive(p.id, !p.isActive); await load(); }
                        catch (e) { setError(e.message); }
                      }} />
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => openDialog(p)}>Edit</Button>
                    <Button size="small" onClick={() => openAllocations(p)}>Allocations</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* --------------------------- project dialog --------------------------- */}
      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing?.isNew ? 'Add project' : 'Edit project'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} sm={4}>
              <TextField label="Code" fullWidth size="small" {...register('projectCode', { required: 'Required' })}
                error={Boolean(errors.projectCode)} helperText={errors.projectCode?.message} />
            </Grid>
            <Grid item xs={12} sm={8}>
              <TextField label="Name" fullWidth size="small" {...register('projectName', { required: 'Required' })}
                error={Boolean(errors.projectName)} helperText={errors.projectName?.message} />
            </Grid>
            <Grid item xs={12}>
              <TextField label="Description" fullWidth size="small" multiline rows={2} {...register('description')} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField label="Start date" type="date" fullWidth size="small" InputLabelProps={{ shrink: true }}
                {...register('startDate', { required: 'Required' })}
                error={Boolean(errors.startDate)} helperText={errors.startDate?.message} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField label="End date" type="date" fullWidth size="small" InputLabelProps={{ shrink: true }}
                {...register('endDate')} helperText="Leave blank for open-ended" />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField select label="Status" fullWidth size="small" defaultValue="PLANNED" {...register('status')}>
                {STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <TextField select label="Project manager" fullWidth size="small" defaultValue=""
                {...register('projectManagerUserId')}>
                <MenuItem value="">Unassigned</MenuItem>
                {managers.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
              </TextField>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit(onSubmit)}>Save</Button>
        </DialogActions>
      </Dialog>

      {/* --------------------------- allocations dialog --------------------------- */}
      <Dialog open={Boolean(allocating)} onClose={() => setAllocating(null)} maxWidth="md" fullWidth>
        <DialogTitle>Allocations — {allocating?.projectName}</DialogTitle>
        <DialogContent>
          <Table size="small" sx={{ mb: 2 }}>
            <TableHead>
              <TableRow>
                <TableCell>Employee</TableCell><TableCell>Role</TableCell>
                <TableCell align="right">Allocation</TableCell><TableCell>Window</TableCell><TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {allocations.length ? allocations.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.employeeName}</TableCell>
                  <TableCell>{a.projectRole ?? '—'}</TableCell>
                  <TableCell align="right">{a.allocationPercentage}%</TableCell>
                  <TableCell>{a.allocationStartDate} → {a.allocationEndDate ?? 'open'}</TableCell>
                  <TableCell align="right">
                    <Button size="small" color="error" onClick={async () => {
                      try {
                        await projectsApi.removeAllocation(a.id);
                        setAllocations(await projectsApi.allocations(allocating.id));
                      } catch (e) { setError(e.message); }
                    }}>Remove</Button>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={5}>
                  <Alert severity="info" variant="outlined">No resources allocated yet.</Alert>
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>

          <Typography variant="subtitle2" gutterBottom>Add allocation</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <TextField select label="Employee" fullWidth size="small" defaultValue=""
                {...allocForm.register('userId', { required: true })}>
                {team.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={6} sm={2}>
              <TextField label="Percent" type="number" fullWidth size="small"
                inputProps={{ min: 1, max: 100 }} {...allocForm.register('allocationPercentage')} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField label="From" type="date" fullWidth size="small" InputLabelProps={{ shrink: true }}
                {...allocForm.register('allocationStartDate', { required: true })} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField label="To" type="date" fullWidth size="small" InputLabelProps={{ shrink: true }}
                {...allocForm.register('allocationEndDate')} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAllocating(null)}>Close</Button>
          <Button variant="contained" onClick={allocForm.handleSubmit(saveAllocation)}>Add allocation</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} message={toast} />
    </Box>
  );
}
