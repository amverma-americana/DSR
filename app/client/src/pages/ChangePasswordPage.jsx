import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { authApi } from '../api/client';
import { useAuth } from '../auth/AuthContext';

/** Client rules mirror ChangePasswordRequestValidator so the policy is stated before submitting. */
export default function ChangePasswordPage() {
  const { mustChangePassword, signOut } = useAuth();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { register, handleSubmit, watch, formState: { errors } } = useForm();

  const onSubmit = async ({ currentPassword, newPassword }) => {
    setBusy(true);
    setError(null);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      // The server rotates the security stamp and revokes every session, so re-authentication is required.
      await signOut();
      navigate('/login', { replace: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 480 }}>
      <Typography variant="h5" gutterBottom>Change password</Typography>

      {mustChangePassword && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Your password must be changed before you can continue.
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Card>
        <CardContent>
          <Stack component="form" spacing={2} onSubmit={handleSubmit(onSubmit)}>
            <TextField label="Current password" type="password" fullWidth
              {...register('currentPassword', { required: 'Current password is required.' })}
              error={Boolean(errors.currentPassword)} helperText={errors.currentPassword?.message} />

            <TextField label="New password" type="password" fullWidth
              {...register('newPassword', {
                required: 'New password is required.',
                minLength: { value: 12, message: 'At least 12 characters.' },
                validate: (v) =>
                  (/[A-Z]/.test(v) && /[a-z]/.test(v) && /[0-9]/.test(v) && /[^a-zA-Z0-9]/.test(v))
                  || 'Must contain upper case, lower case, a digit and a special character.',
              })}
              error={Boolean(errors.newPassword)}
              helperText={errors.newPassword?.message ?? 'Minimum 12 characters, mixed case, a digit and a symbol.'} />

            <TextField label="Confirm new password" type="password" fullWidth
              {...register('confirmPassword', {
                validate: (v) => v === watch('newPassword') || 'The passwords do not match.',
              })}
              error={Boolean(errors.confirmPassword)} helperText={errors.confirmPassword?.message} />

            <Button type="submit" variant="contained" disabled={busy}>Change password</Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
