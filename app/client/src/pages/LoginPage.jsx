import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, CircularProgress, Divider, InputAdornment, Stack, TextField, Typography,
} from '@mui/material';
import {
  BarChart3, CalendarCheck, Eye, EyeOff, Lock, LogIn, Mail, ShieldCheck, Timer,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { COLORS, SHADOWS, SIDEBAR } from '../theme/tokens';

/**
 * Sign in. Two paths: email and password against the application database, and Microsoft Entra ID.
 *
 * The Microsoft button is the one deliberately unfinished piece of the client: the API already
 * accepts an Entra token at POST /auth/sso-login, validates it against the tenant signing keys and
 * auto-provisions the user, so the remaining work is acquiring that token with @azure/msal-browser
 * and passing it to signInWithSso(). The button stays disabled until a client id is configured so
 * it can never fail silently.
 *
 * Layout is a two-panel split: brand and product context on the left, the form on the right. Below
 * the lg breakpoint the left panel is dropped entirely rather than stacked — on a phone it would
 * push the actual sign-in form below the fold, which is the one thing a login screen must not do.
 */
const HIGHLIGHTS = [
  { icon: CalendarCheck, title: 'Log effort in seconds', body: 'Record work against every project you contribute to, one entry at a time.' },
  { icon: BarChart3, title: 'Live utilisation', body: 'Capacity, logged hours and RAG status roll up as your team submits.' },
  { icon: ShieldCheck, title: 'Enterprise sign-in', body: 'Database credentials or Microsoft Entra ID, with role-based access throughout.' },
];

export default function LoginPage() {
  const { signIn, isAuthenticated, initialising } = useAuth();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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
    <Box sx={{ minHeight: '100vh', display: 'flex', bgcolor: 'background.default' }}>
      {/* ------------------------------------------------------------------ brand panel */}
      <Box
        sx={{
          display: { xs: 'none', lg: 'flex' },
          flexDirection: 'column', justifyContent: 'space-between',
          width: '44%', maxWidth: 620, p: 6,
          bgcolor: SIDEBAR.bg, color: '#FFFFFF',
          // Soft radial wash stops the large dark panel reading as a flat block.
          backgroundImage:
            'radial-gradient(circle at 15% 20%, rgba(37, 99, 235, 0.35) 0%, transparent 45%),'
            + 'radial-gradient(circle at 85% 80%, rgba(124, 58, 237, 0.22) 0%, transparent 40%)',
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Box
            aria-hidden="true"
            sx={{ display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: 2, bgcolor: COLORS.primary }}
          >
            <Timer size={22} strokeWidth={2.25} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 17, fontWeight: 700, lineHeight: 1.2 }}>DSR Workspace</Typography>
            <Typography sx={{ fontSize: 12, color: SIDEBAR.textMuted }}>Resource Tracking</Typography>
          </Box>
        </Stack>

        <Box>
          <Typography sx={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.2, mb: 2 }}>
            Daily status, without the busywork.
          </Typography>
          <Typography sx={{ fontSize: 15, color: SIDEBAR.text, maxWidth: 420, mb: 5 }}>
            One place for the whole organisation to record effort, track utilisation and see where
            the work actually went.
          </Typography>

          <Stack spacing={2.5}>
            {HIGHLIGHTS.map(({ icon: Icon, title, body }) => (
              <Stack key={title} direction="row" spacing={2} alignItems="flex-start">
                <Box
                  aria-hidden="true"
                  sx={{
                    display: 'grid', placeItems: 'center', flexShrink: 0, width: 36, height: 36,
                    borderRadius: 2, bgcolor: 'rgba(255, 255, 255, 0.1)', color: '#FFFFFF',
                  }}
                >
                  <Icon size={17} />
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{title}</Typography>
                  <Typography sx={{ fontSize: 13, color: SIDEBAR.text, maxWidth: 380 }}>{body}</Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </Box>

        <Typography sx={{ fontSize: 12, color: SIDEBAR.textMuted }}>
          Employee Daily Status Report &amp; Resource Tracking Management System
        </Typography>
      </Box>

      {/* ------------------------------------------------------------------ form panel */}
      <Box sx={{ flexGrow: 1, display: 'grid', placeItems: 'center', p: { xs: 2.5, sm: 4 } }}>
        <Box sx={{ width: '100%', maxWidth: 420 }}>
          {/* Compact brand lockup, shown only where the left panel is hidden. */}
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 4, display: { lg: 'none' } }}>
            <Box
              aria-hidden="true"
              sx={{
                display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: 2,
                bgcolor: COLORS.primary, color: '#FFFFFF',
              }}
            >
              <Timer size={22} strokeWidth={2.25} />
            </Box>
            <Typography sx={{ fontSize: 17, fontWeight: 700 }}>DSR Workspace</Typography>
          </Stack>

          <Typography variant="h4" component="h1" sx={{ mb: 1 }}>Welcome back</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
            Sign in to record your daily status report.
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

          <Stack component="form" spacing={2.5} onSubmit={handleSubmit(onSubmit)} noValidate>
            <TextField
              label="Email"
              type="email"
              fullWidth
              autoFocus
              autoComplete="username"
              {...register('email', { required: 'Email is required.' })}
              error={Boolean(errors.email)}
              helperText={errors.email?.message}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Mail size={17} color={COLORS.textTertiary} aria-hidden="true" />
                  </InputAdornment>
                ),
              }}
            />

            <TextField
              label="Password"
              type={showPassword ? 'text' : 'password'}
              fullWidth
              autoComplete="current-password"
              {...register('password', { required: 'Password is required.' })}
              error={Boolean(errors.password)}
              helperText={errors.password?.message}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Lock size={17} color={COLORS.textTertiary} aria-hidden="true" />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <Button
                      onClick={() => setShowPassword((s) => !s)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      sx={{ minWidth: 0, height: 32, px: 1, color: 'text.secondary' }}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </Button>
                  </InputAdornment>
                ),
              }}
            />

            <Button
              type="submit"
              variant="contained"
              size="large"
              fullWidth
              disabled={busy}
              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <LogIn size={17} />}
              sx={{ boxShadow: SHADOWS.card }}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </Stack>

          <Divider sx={{ my: 3.5, color: 'text.disabled', fontSize: 12 }}>or</Divider>

          <Button
            fullWidth
            variant="outlined"
            size="large"
            disabled={!ssoConfigured}
            onClick={() => setError('Wire @azure/msal-browser using VITE_AZURE_CLIENT_ID, then pass the acquired token to signInWithSso().')}
          >
            Sign in with Microsoft
          </Button>

          {!ssoConfigured && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5, textAlign: 'center' }}>
              Single sign-on is not configured for this environment.
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}
