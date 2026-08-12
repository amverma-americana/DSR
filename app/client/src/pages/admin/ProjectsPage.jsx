import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, Grid, LinearProgress, MenuItem, Snackbar, Stack, Switch, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { FolderKanban, FolderPlus, Pencil, Trash2, Users } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { projectsApi, usersApi } from '../../api/client';
import PageHeader from '../../components/PageHeader';
import AppDialog from '../../components/AppDialog';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/EmptyState';
import { COLORS } from '../../theme/tokens';

const STATUSES = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];

const STATUS_TONE = {
  ACTIVE: { bg: COLORS.successLight, fg: COLORS.success },
  PLANNED: { bg: COLORS.primaryLight, fg: COLORS.primaryHover },
  ON_HOLD: { bg: COLORS.warningLight, fg: COLORS.warning },
  COMPLETED: { bg: COLORS.surface, fg: COLORS.textSecondary },
  CANCELLED: { bg: COLORS.dangerLight, fg: COLORS.danger },
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
  const [pendingRemoval, setPendingRemoval] = useState(null);

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

  /*  Removing an allocation now passes through a confirmation step. It previously fired on a
      single click with no prompt at all, which on a utilisation-critical record is the one place
      an accidental click is expensive: the allocation is the denominator of the utilisation
      report, so deleting it silently changes everyone's reported numbers.  */
  const confirmRemoveAllocation = async () => {
    const allocation = pendingRemoval;
    setPendingRemoval(null);
    if (!allocation) return;

    try {
      await projectsApi.removeAllocation(allocation.id);
      setAllocations(await projectsApi.allocations(allocating.id));
      setToast('Allocation removed.');
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Box>
      <PageHeader
        title="Projects"
        description="Status controls which projects accept effort; allocations drive the utilisation report."
        actions={(
          <Button variant="contained" startIcon={<FolderPlus size={16} />} onClick={() => openDialog(null)}>
            Add project
          </Button>
        )}
      />

      {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>}

      <Card>
        {loading && <LinearProgress aria-label="Loading projects" />}

        <TableContainer>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Project</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Window</TableCell>
                <TableCell>Manager</TableCell>
                <TableCell align="right">Resources</TableCell>
                <TableCell align="center">Logs effort</TableCell>
                <TableCell align="center">Active</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {projects.map((p) => {
                const tone = STATUS_TONE[p.status] ?? STATUS_TONE.COMPLETED;

                return (
                  <TableRow key={p.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>{p.projectName}</Typography>
                      <Typography variant="caption" color="text.secondary">{p.projectCode}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={p.status.replace('_', ' ')} sx={{ bgcolor: tone.bg, color: tone.fg, fontWeight: 600 }} />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Typography variant="body2">{p.startDate} → {p.endDate ?? 'open'}</Typography>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{p.projectManagerName ?? '—'}</TableCell>
                    <TableCell align="right">{p.allocatedResourceCount}</TableCell>
                    <TableCell align="center">
                      <Chip
                        size="small"
                        label={p.isOpenForEffort ? 'Yes' : 'No'}
                        sx={p.isOpenForEffort
                          ? { bgcolor: COLORS.successLight, color: COLORS.success, fontWeight: 600 }
                          : { bgcolor: COLORS.surface, color: COLORS.textSecondary }}
                      />
                    </TableCell>
                    <TableCell align="center">
                      <Switch
                        size="small" checked={p.isActive}
                        inputProps={{ 'aria-label': `${p.isActive ? 'Deactivate' : 'Activate'} ${p.projectName}` }}
                        onChange={async () => {
                          try { await projectsApi.setActive(p.id, !p.isActive); await load(); }
                          catch (e) { setError(e.message); }
                        }} />
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="Edit project">
                          <Button size="small" variant="outlined" onClick={() => openDialog(p)}
                            sx={{ minWidth: 0, px: 1.25 }} aria-label={`Edit ${p.projectName}`}>
                            <Pencil size={14} />
                          </Button>
                        </Tooltip>
                        <Tooltip title="Manage allocations">
                          <Button size="small" variant="outlined" onClick={() => openAllocations(p)}
                            sx={{ minWidth: 0, px: 1.25 }} aria-label={`Allocations for ${p.projectName}`}>
                            <Users size={14} />
                          </Button>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>

        {!loading && projects.length === 0 && (
          <EmptyState
            icon={FolderKanban} title="No projects yet"
            description="Add a project to make it available for effort logging."
            action={<Button variant="contained" startIcon={<FolderPlus size={16} />} onClick={() => openDialog(null)}>Add project</Button>}
          />
        )}
      </Card>

      {/* --------------------------- project dialog --------------------------- */}
      <AppDialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.isNew ? 'Add project' : 'Edit project'}
        subtitle={editing?.isNew ? undefined : editing?.projectName}
        actions={(
          <>
            <Button variant="text" onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="contained" onClick={handleSubmit(onSubmit)}>Save</Button>
          </>
        )}
      >
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={12} sm={4}>
            <TextFieldLike label="Code" register={register('projectCode', { required: 'Required' })}
              error={errors.projectCode} />
          </Grid>
          <Grid item xs={12} sm={8}>
            <TextFieldLike label="Name" register={register('projectName', { required: 'Required' })}
              error={errors.projectName} />
          </Grid>
          <Grid item xs={12}>
            <TextFieldLike label="Description" register={register('description')} multiline minRows={2} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextFieldLike label="Start date" type="date" shrink
              register={register('startDate', { required: 'Required' })} error={errors.startDate} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextFieldLike label="End date" type="date" shrink register={register('endDate')}
              helperText="Leave blank for open-ended" />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextFieldLike label="Status" select defaultValue="PLANNED" register={register('status')}>
              {STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace('_', ' ')}</MenuItem>)}
            </TextFieldLike>
          </Grid>
          <Grid item xs={12}>
            <TextFieldLike label="Project manager" select defaultValue="" register={register('projectManagerUserId')}>
              <MenuItem value="">Unassigned</MenuItem>
              {managers.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
            </TextFieldLike>
          </Grid>
        </Grid>
      </AppDialog>

      {/* --------------------------- allocations dialog --------------------------- */}
      <AppDialog
        open={Boolean(allocating)}
        onClose={() => setAllocating(null)}
        title="Resource allocations"
        subtitle={allocating?.projectName}
        maxWidth="md"
        actions={(
          <>
            <Button variant="text" onClick={() => setAllocating(null)}>Close</Button>
            <Button variant="contained" onClick={allocForm.handleSubmit(saveAllocation)}>Add allocation</Button>
          </>
        )}
      >
        <Card sx={{ mb: 3 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Employee</TableCell>
                <TableCell>Role</TableCell>
                <TableCell align="right">Allocation</TableCell>
                <TableCell>Window</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {allocations.length ? allocations.map((a) => (
                <TableRow key={a.id} hover>
                  <TableCell>{a.employeeName}</TableCell>
                  <TableCell>{a.projectRole ?? '—'}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{a.allocationPercentage}%</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{a.allocationStartDate} → {a.allocationEndDate ?? 'open'}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Remove allocation">
                      <Button size="small" color="error" onClick={() => setPendingRemoval(a)}
                        sx={{ minWidth: 0, px: 1.25 }} aria-label={`Remove allocation for ${a.employeeName}`}>
                        <Trash2 size={14} />
                      </Button>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={5} sx={{ p: 0, borderBottom: 'none' }}>
                    <EmptyState compact icon={Users} title="No resources allocated"
                      description="Add an allocation below to include this project in utilisation." />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>

        <Typography variant="subtitle1" component="h3" sx={{ mb: 1.5 }}>Add allocation</Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={4}>
            <TextFieldLike label="Employee" select defaultValue="" register={allocForm.register('userId', { required: true })}>
              {team.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
            </TextFieldLike>
          </Grid>
          <Grid item xs={6} sm={2}>
            <TextFieldLike label="Percent" type="number" register={allocForm.register('allocationPercentage')}
              inputProps={{ min: 1, max: 100 }} />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextFieldLike label="From" type="date" shrink register={allocForm.register('allocationStartDate', { required: true })} />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextFieldLike label="To" type="date" shrink register={allocForm.register('allocationEndDate')} />
          </Grid>
        </Grid>
      </AppDialog>

      <ConfirmDialog
        open={Boolean(pendingRemoval)}
        onClose={() => setPendingRemoval(null)}
        title="Remove allocation?"
        message={pendingRemoval
          ? `${pendingRemoval.employeeName} will no longer be allocated to this project. Their capacity in the utilisation report changes as a result.`
          : ''}
        confirmLabel="Remove"
        onConfirm={confirmRemoveAllocation}
      />

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)} message={toast} />
    </Box>
  );
}

/**
 * Thin wrapper over TextField that keeps react-hook-form's register() spread and the error/helper
 * wiring in one place. Purely to stop the two dialogs above repeating the same eight props on
 * every field; it renders an ordinary MUI TextField.
 */
function TextFieldLike({
  label, register, error, helperText, type, select, defaultValue, shrink, multiline, minRows,
  inputProps, children,
}) {
  return (
    <TextField
      label={label}
      type={type}
      select={select}
      defaultValue={defaultValue}
      multiline={multiline}
      minRows={minRows}
      inputProps={inputProps}
      fullWidth
      InputLabelProps={shrink ? { shrink: true } : undefined}
      error={Boolean(error)}
      helperText={error?.message ?? helperText}
      {...register}
    >
      {children}
    </TextField>
  );
}
