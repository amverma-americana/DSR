import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, CircularProgress, Divider, Stack, TextField, Typography,
} from '@mui/material';
import LoginIcon from '@mui/icons-material/Login';
import { useAuth } from '../auth/AuthContext';

/**
 * Sign in. Two paths: email and password against the application database, and Microsoft Entra ID.
 *
 * The Microsoft button is the one deliberately unfinished piece of the client: the API already
 * accepts an Entra token at POST /auth/sso-login, validates it against the tenant signing keys and
 * auto-provisions the user, so the remaining work is acquiring that token with @azure/msal-browser
 * and passing it to signInWithSso(). The button stays disabled until a client id is configured so
 * it can never fail silently.
 */
export default function LoginPage() {
  const { signIn, isAuthenticated, initialising } = useAuth();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { register, handleSubmit, formState: { errors } } = useForm();

  const ssoConfigured = Boolean(import.meta.env.VITE_AZURE_CLIENT_ID);

  if (initialising) return null;
  if (isAuthenticated) return <Navigate to={location.state?.from?.pathname ?? '/dashboard'} replace />;

  const onSubmit = async ({ email, password }) => {
    setBusy(true);
    setError(null);
    try {
      const result = await signIn(email, password);
      const target = result.mustChangePassword ? '/change-password' : (location.state?.from?.pathname ?? '/dashboard');
      navigate(target, { replace: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" gutterBottom>DSR &amp; Resource Management</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Sign in to record your daily status report.
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <Stack component="form" spacing={2} onSubmit={handleSubmit(onSubmit)}>
            <TextField
              label="Email" type="email" fullWidth autoFocus autoComplete="username"
              {...register('email', { required: 'Email is required.' })}
              error={Boolean(errors.email)} helperText={errors.email?.message}
            />
            <TextField
              label="Password" type="password" fullWidth autoComplete="current-password"
              {...register('password', { required: 'Password is required.' })}
              error={Boolean(errors.password)} helperText={errors.password?.message}
            />
            <Button type="submit" variant="contained" size="large" disabled={busy}
              startIcon={busy ? <CircularProgress size={16} /> : <LoginIcon />}>
              Sign in
            </Button>
          </Stack>

          <Divider sx={{ my: 3 }}>or</Divider>

          <Button fullWidth variant="outlined" size="large" disabled={!ssoConfigured}
            onClick={() => setError('Wire @azure/msal-browser using VITE_AZURE_CLIENT_ID, then pass the acquired token to signInWithSso().')}>
            Sign in with Microsoft
          </Button>
          {!ssoConfigured && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Single sign-on is not configured for this environment.
            </Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
