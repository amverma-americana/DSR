import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Card, Chip, Grid, InputAdornment, LinearProgress, MenuItem, Snackbar,
  Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow,
  TextField, Tooltip, Typography,
} from '@mui/material';
import { Copy, KeyRound, Pencil, Search, UserPlus, Users } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { authApi, usersApi } from '../../api/client';
import { ROLES, useAuth } from '../../auth/AuthContext';
import PageHeader from '../../components/PageHeader';
import AppDialog from '../../components/AppDialog';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/EmptyState';
import { COLORS } from '../../theme/tokens';

const AUTH_TYPES = ['DATABASE', 'SSO', 'BOTH'];

const ROLE_TONE = {
  ADMIN: { bg: COLORS.dangerLight, fg: COLORS.danger },
  MANAGER: { bg: COLORS.primaryLight, fg: COLORS.primaryHover },
  EMPLOYEE: { bg: COLORS.surface, fg: COLORS.textSecondary },
};

const initials = (name) => (name ?? '')
  .split(' ').filter(Boolean).map((p) => p[0]).slice(0, 2).join('')
  .toUpperCase() || '?';

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

  /*  Password reset used to run through window.confirm followed by window.prompt. Both are now
      proper dialogs: the confirmation states exactly what will happen, and the generated password
      is shown in a copyable field rather than inside a prompt box the user must select by hand.
      The flow is otherwise identical -- confirm, call the API, reveal the temporary password.  */
  const [pendingReset, setPendingReset] = useState(null);
  const [resetResult, setResetResult] = useState(null);
  const [resetting, setResetting] = useState(false);

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

  const confirmReset = async () => {
    const user = pendingReset;
    if (!user) return;
    setResetting(true);
    try {
      const outcome = await authApi.resetPassword(user.id);
      setPendingReset(null);
      setResetResult({ user, temporaryPassword: outcome.temporaryPassword });
    } catch (e) {
      setPendingReset(null);
      setError(e.message);
    } finally {
      setResetting(false);
    }
  };

  const rows = result?.items ?? [];

  return (
    <Box>
      <PageHeader
        title={isAdmin ? 'Users' : 'My Team'}
        description={isAdmin
          ? 'Create accounts, set reporting lines and manage access.'
          : 'The people who report to you.'}
        actions={isAdmin && (
          <Button variant="contained" startIcon={<UserPlus size={16} />} onClick={() => openDialog(null)}>
            Add user
          </Button>
        )}
      />

      {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>{error}</Alert>}

      <Card sx={{ mb: 3, p: 2.5 }}>
        <TextField
          label="Search" fullWidth placeholder="Name, email or employee code"
          value={filter.search}
          onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value, page: 1 }))}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search size={16} color={COLORS.textTertiary} aria-hidden="true" />
              </InputAdornment>
            ),
          }}
        />
      </Card>

      <Card>
        {loading && <LinearProgress aria-label="Loading users" />}

        <TableContainer>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Code</TableCell>
                <TableCell>Roles</TableCell>
                <TableCell>Manager</TableCell>
                <TableCell>Auth</TableCell>
                <TableCell align="right">Std hours</TableCell>
                <TableCell align="center">Active</TableCell>
                {isAdmin && <TableCell align="right">Actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((user) => (
                <TableRow key={user.id} hover>
                  {/* Name and email are combined into one identity cell — it reads faster than two
                      columns and buys the horizontal room the action buttons need. */}
                  <TableCell>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Avatar sx={{ width: 32, height: 32, fontSize: 12, fontWeight: 600, bgcolor: COLORS.primaryLight, color: COLORS.primaryHover }}>
                        {initials(user.fullName)}
                      </Avatar>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={500} noWrap>{user.fullName}</Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>{user.email}</Typography>
                      </Box>
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{user.employeeCode ?? '—'}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {user.roles.map((r) => {
                        const tone = ROLE_TONE[r] ?? ROLE_TONE.EMPLOYEE;
                        return <Chip key={r} size="small" label={r} sx={{ bgcolor: tone.bg, color: tone.fg, fontWeight: 600 }} />;
                      })}
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{user.managerName ?? '—'}</TableCell>
                  <TableCell><Chip size="small" variant="outlined" label={user.authenticationType} /></TableCell>
                  <TableCell align="right">{user.standardDailyHours}</TableCell>
                  <TableCell align="center">
                    <Switch
                      size="small" checked={user.isActive} disabled={!isAdmin}
                      onChange={() => toggleActive(user)}
                      inputProps={{ 'aria-label': `${user.isActive ? 'Deactivate' : 'Activate'} ${user.fullName}` }}
                    />
                  </TableCell>
                  {isAdmin && (
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="Edit user">
                          <Button size="small" variant="outlined" onClick={() => openDialog(user)}
                            sx={{ minWidth: 0, px: 1.25 }} aria-label={`Edit ${user.fullName}`}>
                            <Pencil size={14} />
                          </Button>
                        </Tooltip>
                        <Tooltip title="Reset password">
                          <Button size="small" variant="outlined" onClick={() => setPendingReset(user)}
                            sx={{ minWidth: 0, px: 1.25 }} aria-label={`Reset password for ${user.fullName}`}>
                            <KeyRound size={14} />
                          </Button>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {!loading && rows.length === 0 && (
          <EmptyState icon={Users} title="No users found" description="Try a different search term." />
        )}

        <TablePagination component="div" count={result?.totalCount ?? 0}
          page={(filter.page ?? 1) - 1} rowsPerPage={filter.pageSize} rowsPerPageOptions={[10, 25, 50]}
          onPageChange={(_, p) => setFilter((f) => ({ ...f, page: p + 1 }))}
          onRowsPerPageChange={(e) => setFilter((f) => ({ ...f, pageSize: Number(e.target.value), page: 1 }))} />
      </Card>

      {/* ------------------------------------------------------------------ create / edit */}
      <AppDialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.isNew ? 'Add user' : 'Edit user'}
        subtitle={editing?.isNew
          ? 'A temporary password is generated for database accounts.'
          : editing?.fullName}
        actions={(
          <>
            <Button variant="text" onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="contained" onClick={handleSubmit(onSubmit)}>Save</Button>
          </>
        )}
      >
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={12} sm={6}>
            <TextField label="First name" fullWidth {...register('firstName', { required: 'Required' })}
              error={Boolean(errors.firstName)} helperText={errors.firstName?.message} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Last name" fullWidth {...register('lastName', { required: 'Required' })}
              error={Boolean(errors.lastName)} helperText={errors.lastName?.message} />
          </Grid>
          <Grid item xs={12} sm={8}>
            <TextField label="Email" type="email" fullWidth {...register('email', { required: 'Required' })}
              error={Boolean(errors.email)} helperText={errors.email?.message} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField label="Employee code" fullWidth {...register('employeeCode')} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField select label="Authentication" fullWidth defaultValue="DATABASE" {...register('authenticationType')}>
              {AUTH_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Entra object id" fullWidth {...register('externalObjectId')}
              helperText="Required for SSO or BOTH" />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField select label="Reports to" fullWidth defaultValue="" {...register('managerUserId')}>
              <MenuItem value="">No manager</MenuItem>
              {managers.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField label="Std hours" type="number" fullWidth
              inputProps={{ min: 0.5, max: 24, step: 0.5 }} {...register('standardDailyHours')} />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField label="Designation" fullWidth {...register('designation')} />
          </Grid>
        </Grid>
      </AppDialog>

      {/* ------------------------------------------------------------------ reset password */}
      <ConfirmDialog
        open={Boolean(pendingReset)}
        onClose={() => setPendingReset(null)}
        title="Reset password?"
        message={pendingReset
          ? `A new temporary password will be generated for ${pendingReset.fullName}, all their sessions will be revoked, and they must change it at next sign-in.`
          : ''}
        confirmLabel="Reset password"
        onConfirm={confirmReset}
        busy={resetting}
      />

      <AppDialog
        open={Boolean(resetResult)}
        onClose={() => setResetResult(null)}
        title="Temporary password"
        subtitle={resetResult ? `For ${resetResult.user.fullName}. Share it securely — it is shown once.` : ''}
        actions={<Button variant="contained" onClick={() => setResetResult(null)}>Done</Button>}
      >
        <TextField
          fullWidth
          value={resetResult?.temporaryPassword ?? ''}
          InputProps={{
            readOnly: true,
            sx: { fontFamily: 'monospace', fontSize: 15 },
            endAdornment: (
              <InputAdornment position="end">
                <Tooltip title="Copy to clipboard">
                  <Button
                    size="small"
                    onClick={() => {
                      navigator.clipboard?.writeText(resetResult?.temporaryPassword ?? '')
                        .then(() => setToast('Temporary password copied.'))
                        .catch(() => setToast('Copy failed — select the text and copy manually.'));
                    }}
                    sx={{ minWidth: 0, px: 1 }}
                    aria-label="Copy temporary password"
                  >
                    <Copy size={15} />
                  </Button>
                </Tooltip>
              </InputAdornment>
            ),
          }}
        />
        <Alert severity="warning" sx={{ mt: 2 }}>
          The user must change this password the next time they sign in.
        </Alert>
      </AppDialog>

      <Snackbar open={Boolean(toast)} autoHideDuration={5000} onClose={() => setToast(null)} message={toast} />
    </Box>
  );
}
