import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, CircularProgress, InputAdornment, Stack, TextField, Typography,
} from '@mui/material';
import { Check, Lock, ShieldCheck } from 'lucide-react';
import { authApi } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import PageHeader from '../components/PageHeader';
import SectionCard from '../components/SectionCard';
import { COLORS } from '../theme/tokens';

/** Client rules mirror ChangePasswordRequestValidator so the policy is stated before submitting. */
const RULES = [
  { label: 'At least 12 characters', test: (v) => (v?.length ?? 0) >= 12 },
  { label: 'An upper case letter', test: (v) => /[A-Z]/.test(v ?? '') },
  { label: 'A lower case letter', test: (v) => /[a-z]/.test(v ?? '') },
  { label: 'A digit', test: (v) => /[0-9]/.test(v ?? '') },
  { label: 'A special character', test: (v) => /[^a-zA-Z0-9]/.test(v ?? '') },
];

export default function ChangePasswordPage() {
  const { mustChangePassword, signOut } = useAuth();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { register, handleSubmit, watch, formState: { errors } } = useForm();

  const newPassword = watch('newPassword');

  const onSubmit = async ({ currentPassword, newPassword: next }) => {
    setBusy(true);
    setError(null);
    try {
      await authApi.changePassword(currentPassword, next);
      // The server rotates the security stamp and revokes every session, so re-authentication is required.
      await signOut();
      navigate('/login', { replace: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const lockIcon = (
    <InputAdornment position="start">
      <Lock size={16} color={COLORS.textTertiary} aria-hidden="true" />
    </InputAdornment>
  );

  return (
    <Box sx={{ maxWidth: 560 }}>
      <PageHeader title="Change password" description="You will be signed out and asked to sign in again." />

      {mustChangePassword && (
        <Alert severity="warning" icon={<ShieldCheck size={18} />} sx={{ mb: 3 }}>
          Your password must be changed before you can continue.
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <SectionCard>
        <Stack component="form" spacing={2.5} onSubmit={handleSubmit(onSubmit)} noValidate>
          <TextField
            label="Current password" type="password" fullWidth autoComplete="current-password"
            {...register('currentPassword', { required: 'Current password is required.' })}
            error={Boolean(errors.currentPassword)} helperText={errors.currentPassword?.message}
            InputProps={{ startAdornment: lockIcon }}
          />

          <TextField
            label="New password" type="password" fullWidth autoComplete="new-password"
            {...register('newPassword', {
              required: 'New password is required.',
              minLength: { value: 12, message: 'At least 12 characters.' },
              validate: (v) =>
                (/[A-Z]/.test(v) && /[a-z]/.test(v) && /[0-9]/.test(v) && /[^a-zA-Z0-9]/.test(v))
                || 'Must contain upper case, lower case, a digit and a special character.',
            })}
            error={Boolean(errors.newPassword)} helperText={errors.newPassword?.message}
            InputProps={{ startAdornment: lockIcon }}
          />

          {/*  The policy is shown as a live checklist rather than a single line of helper text.
               Identical rules, identical validation -- but the user can see which requirement is
               still outstanding instead of resubmitting to find out.  */}
          <Box sx={{ px: 2, py: 1.5, bgcolor: COLORS.surface, borderRadius: 2.5, border: `1px solid ${COLORS.border}` }}>
            <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>Password must contain</Typography>
            <Stack spacing={0.75}>
              {RULES.map((rule) => {
                const met = rule.test(newPassword);
                return (
                  <Stack key={rule.label} direction="row" spacing={1} alignItems="center">
                    <Box
                      aria-hidden="true"
                      sx={{
                        display: 'grid', placeItems: 'center', width: 16, height: 16, borderRadius: '50%',
                        bgcolor: met ? COLORS.successLight : 'transparent',
                        border: met ? 'none' : `1.5px solid ${COLORS.border}`,
                        color: COLORS.success,
                      }}
                    >
                      {met && <Check size={11} strokeWidth={3} />}
                    </Box>
                    <Typography variant="caption" sx={{ color: met ? 'text.primary' : 'text.secondary' }}>
                      {rule.label}
                    </Typography>
                  </Stack>
                );
              })}
            </Stack>
          </Box>

          <TextField
            label="Confirm new password" type="password" fullWidth autoComplete="new-password"
            {...register('confirmPassword', {
              validate: (v) => v === watch('newPassword') || 'The passwords do not match.',
            })}
            error={Boolean(errors.confirmPassword)} helperText={errors.confirmPassword?.message}
            InputProps={{ startAdornment: lockIcon }}
          />

          <Box>
            <Button
              type="submit" variant="contained" disabled={busy}
              startIcon={busy ? <CircularProgress size={15} color="inherit" /> : null}
            >
              {busy ? 'Changing…' : 'Change password'}
            </Button>
          </Box>
        </Stack>
      </SectionCard>
    </Box>
  );
}
