import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid,
  LinearProgress, MenuItem, Snackbar, Stack, Switch, Table, TableBody, TableCell, TableContainer,
  TableHead, TablePagination, TableRow, TextField, Typography,
} from '@mui/material';
import { useForm } from 'react-hook-form';
import { authApi, usersApi } from '../../api/client';
import { ROLES, useAuth } from '../../auth/AuthContext';

const AUTH_TYPES = ['DATABASE', 'SSO', 'BOTH'];

/**
 * User administration. Managers get a read-only view of their own team (the API scopes the list);
 * only Admins see the create, edit, activate and reset-password controls.
 */
export default function UsersPage() {
  const { isAdmin } = useAuth();
  const [filter, setFilter] = useState({ page: 1, pageSize: 25, search: '' });
  const [result, setResult] = useState(null);
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(null);

  const { register, handleSubmit, reset, formState: { errors } } = useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== ''));
      setResult(await usersApi.search(params));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { usersApi.managers().then(setManagers).catch(() => setManagers([])); }, []);

  const openDialog = (user) => {
    setEditing(user ?? { isNew: true });
    reset(user ?? {
      firstName: '', lastName: '', email: '', employeeCode: '', designation: '',
      authenticationType: 'DATABASE', externalObjectId: '', standardDailyHours: 8, managerUserId: '',
    });
  };

  const onSubmit = async (values) => {
    const payload = {
      ...values,
      standardDailyHours: Number(values.standardDailyHours),
      managerUserId: values.managerUserId === '' ? null : Number(values.managerUserId),
      externalObjectId: values.externalObjectId || null,
      roleCodes: values.roleCodes ?? [ROLES.EMPLOYEE],
    };

    try {
      if (editing.isNew) {
        const created = await usersApi.create(payload);
        setToast(`User created${created.hasDatabaseCredential ? '. A temporary password was generated; use Reset password to reveal it.' : '.'}`);
      } else {
        await usersApi.update(editing.id, { ...payload, roleCodes: editing.roles });
        setToast('User updated.');
      }
      setEditing(null);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const toggleActive = async (user) => {
    try {
      await usersApi.setActive(user.id, !user.isActive);
      setToast(user.isActive ? 'User deactivated and all sessions revoked.' : 'User activated.');
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const resetPassword = async (user) => {
    if (!window.confirm(`Reset the password for ${user.fullName}? All their sessions will be revoked.`)) return;
    try {
      const result = await authApi.resetPassword(user.id);
      window.prompt('Temporary password — share this securely. The user must change it at next sign-in:', result.temporaryPassword);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">{isAdmin ? 'Users' : 'My Team'}</Typography>
        {isAdmin && <Button variant="contained" onClick={() => openDialog(null)}>Add user</Button>}
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Card sx={{ mb: 2, p: 2 }}>
        <TextField label="Search" size="small" fullWidth placeholder="Name, email or employee code"
          value={filter.search} onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value, page: 1 }))} />
      </Card>

      {loading && <LinearProgress sx={{ mb: 1 }} />}

      <Card>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell><TableCell>Name</TableCell><TableCell>Email</TableCell>
                <TableCell>Roles</TableCell><TableCell>Manager</TableCell><TableCell>Auth</TableCell>
                <TableCell align="right">Std hours</TableCell><TableCell align="center">Active</TableCell>
                {isAdmin && <TableCell align="right">Actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {result?.items?.map((user) => (
                <TableRow key={user.id} hover>
                  <TableCell>{user.employeeCode ?? '—'}</TableCell>
                  <TableCell>{user.fullName}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      {user.roles.map((r) => <Chip key={r} size="small" label={r} variant="outlined" />)}
                    </Stack>
                  </TableCell>
                  <TableCell>{user.managerName ?? '—'}</TableCell>
                  <TableCell><Chip size="small" label={user.authenticationType} /></TableCell>
                  <TableCell align="right">{user.standardDailyHours}</TableCell>
                  <TableCell align="center">
                    <Switch size="small" checked={user.isActive} disabled={!isAdmin} onChange={() => toggleActive(user)} />
                  </TableCell>
                  {isAdmin && (
                    <TableCell align="right">
                      <Button size="small" onClick={() => openDialog(user)}>Edit</Button>
                      <Button size="small" onClick={() => resetPassword(user)}>Reset password</Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination component="div" count={result?.totalCount ?? 0}
          page={(filter.page ?? 1) - 1} rowsPerPage={filter.pageSize} rowsPerPageOptions={[10, 25, 50]}
          onPageChange={(_, p) => setFilter((f) => ({ ...f, page: p + 1 }))}
          onRowsPerPageChange={(e) => setFilter((f) => ({ ...f, pageSize: Number(e.target.value), page: 1 }))} />
      </Card>

      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing?.isNew ? 'Add user' : 'Edit user'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12} sm={6}>
              <TextField label="First name" fullWidth size="small" {...register('firstName', { required: 'Required' })}
                error={Boolean(errors.firstName)} helperText={errors.firstName?.message} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Last name" fullWidth size="small" {...register('lastName', { required: 'Required' })}
                error={Boolean(errors.lastName)} helperText={errors.lastName?.message} />
            </Grid>
            <Grid item xs={12} sm={8}>
              <TextField label="Email" type="email" fullWidth size="small" {...register('email', { required: 'Required' })}
                error={Boolean(errors.email)} helperText={errors.email?.message} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField label="Employee code" fullWidth size="small" {...register('employeeCode')} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField select label="Authentication" fullWidth size="small" defaultValue="DATABASE"
                {...register('authenticationType')}>
                {AUTH_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Entra object id" fullWidth size="small" {...register('externalObjectId')}
                helperText="Required for SSO or BOTH" />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField select label="Reports to" fullWidth size="small" defaultValue=""
                {...register('managerUserId')}>
                <MenuItem value="">No manager</MenuItem>
                {managers.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField label="Std hours" type="number" fullWidth size="small"
                inputProps={{ min: 0.5, max: 24, step: 0.5 }} {...register('standardDailyHours')} />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField label="Designation" fullWidth size="small" {...register('designation')} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit(onSubmit)}>Save</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(toast)} autoHideDuration={5000} onClose={() => setToast(null)} message={toast} />
    </Box>
  );
}
