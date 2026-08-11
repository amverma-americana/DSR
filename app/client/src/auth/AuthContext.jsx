import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { authApi, tokenStore } from '../api/client';

const AuthContext = createContext(null);

export const ROLES = { ADMIN: 'ADMIN', MANAGER: 'MANAGER', EMPLOYEE: 'EMPLOYEE' };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initialising, setInitialising] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const signOut = useCallback(async () => {
    const refreshToken = tokenStore.getRefreshToken();
    if (refreshToken) {
      // Best effort: a failed revoke must not trap the user in a signed-in state.
      try { await authApi.logout(refreshToken); } catch { /* ignored */ }
    }
    tokenStore.clear();
    setUser(null);
    setMustChangePassword(false);
  }, []);

  // Restore the session on reload by exchanging the persisted refresh token.
  useEffect(() => {
    tokenStore.onSessionExpired(() => { setUser(null); setMustChangePassword(false); });

    (async () => {
      if (!tokenStore.getRefreshToken()) { setInitialising(false); return; }
      try {
        setUser(await authApi.me());
      } catch {
        tokenStore.clear();
      } finally {
        setInitialising(false);
      }
    })();
  }, []);

  const applyAuthResult = (result) => {
    tokenStore.setAccessToken(result.accessToken);
    tokenStore.setRefreshToken(result.refreshToken);
    setUser(result.user);
    setMustChangePassword(Boolean(result.mustChangePassword));
    return result;
  };

  const value = useMemo(() => ({
    user,
    initialising,
    mustChangePassword,
    isAuthenticated: Boolean(user),
    hasRole: (...roles) => roles.some((r) => user?.roles?.includes(r)),
    isAdmin: Boolean(user?.roles?.includes(ROLES.ADMIN)),
    isManager: Boolean(user?.roles?.includes(ROLES.MANAGER)),
    signIn: async (email, password) => applyAuthResult(await authApi.login(email, password)),
    signInWithSso: async (idToken) => applyAuthResult(await authApi.ssoLogin(idToken)),
    signOut,
    clearMustChangePassword: () => setMustChangePassword(false),
    refreshUser: async () => setUser(await authApi.me()),
  }), [user, initialising, mustChangePassword, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider.');
  return context;
};

/**
 * Route guard. Redirects anonymous users to the sign-in page (remembering where they were headed),
 * and users lacking the required role to a not-authorised page.
 *
 * This is UX only -- every endpoint independently enforces role and row-level scope server-side,
 * so hiding a route is never the security boundary.
 */
export function RequireAuth({ roles, children }) {
  const { isAuthenticated, initialising, hasRole, mustChangePassword } = useAuth();
  const location = useLocation();

  if (initialising) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;

  // A forced password change blocks the rest of the application until completed.
  if (mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  if (roles?.length && !hasRole(...roles)) return <Navigate to="/not-authorised" replace />;

  return children;
}
