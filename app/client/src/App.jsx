import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import {
  BrowserRouter, Link as RouterLink, Navigate, Route, Routes, useLocation, useNavigate,
} from 'react-router-dom';
import {
  AppBar, Avatar, Box, Chip, CssBaseline, Divider, Drawer, IconButton, LinearProgress, List,
  ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, Stack, ThemeProvider, Toolbar,
  Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import {
  ChevronsLeft, ChevronsRight, KeyRound, LogOut, Menu as MenuIcon, Timer,
} from 'lucide-react';
import theme from './theme/theme';
import { COLORS, SHADOWS, SIDEBAR, SIZES } from './theme/tokens';
import { AuthProvider, RequireAuth, ROLES, useAuth } from './auth/AuthContext';
import { NAV_SECTIONS, isActiveRoute } from './navigation';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage'));
const DsrEntryPage = lazy(() => import('./pages/DsrEntryPage'));
const DsrHistoryPage = lazy(() => import('./pages/DsrHistoryPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const UsersPage = lazy(() => import('./pages/admin/UsersPage'));
const DsrDetailsPage = lazy(() => import('./pages/admin/DsrDetailsPage'));
const ProjectsPage = lazy(() => import('./pages/admin/ProjectsPage'));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage'));
const NotAuthorisedPage = lazy(() => import('./pages/NotAuthorisedPage'));

const COLLAPSE_KEY = 'dsr.sidebar.collapsed';

const initials = (name) => (name ?? '')
  .split(' ').filter(Boolean).map((part) => part[0]).slice(0, 2).join('')
  .toUpperCase() || '?';

/* ------------------------------------------------------------------------------------------- */
/*  SIDEBAR                                                                                     */
/* ------------------------------------------------------------------------------------------- */

function SidebarContent({ collapsed, onNavigate }) {
  const { hasRole } = useAuth();
  const { pathname } = useLocation();

  const sections = NAV_SECTIONS
    .map((section) => ({ ...section, items: section.items.filter((i) => !i.roles || hasRole(...i.roles)) }))
    .filter((section) => section.items.length > 0);

  return (
    <Box
      sx={{
        height: '100%', display: 'flex', flexDirection: 'column',
        bgcolor: SIDEBAR.bg, color: SIDEBAR.text, overflowX: 'hidden',
      }}
    >
      {/* ------------------------------------------------------------------ brand */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        sx={{ height: SIZES.header, px: collapsed ? 0 : 2.5, flexShrink: 0, justifyContent: collapsed ? 'center' : 'flex-start' }}
      >
        <Box
          aria-hidden="true"
          sx={{
            display: 'grid', placeItems: 'center', width: 34, height: 34, flexShrink: 0,
            borderRadius: 2, bgcolor: COLORS.primary, color: '#FFFFFF',
          }}
        >
          <Timer size={19} strokeWidth={2.25} />
        </Box>

        {!collapsed && (
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 700, color: '#FFFFFF', lineHeight: 1.2 }} noWrap>
              DSR Workspace
            </Typography>
            <Typography sx={{ fontSize: 11, color: SIDEBAR.textMuted, lineHeight: 1.3 }} noWrap>
              Resource Tracking
            </Typography>
          </Box>
        )}
      </Stack>

      <Divider sx={{ borderColor: SIDEBAR.border }} />

      {/* ------------------------------------------------------------------ links */}
      <Box component="nav" aria-label="Main navigation" sx={{ flexGrow: 1, overflowY: 'auto', py: 1.5 }}>
        {sections.map((section) => (
          <Box key={section.heading} sx={{ mb: 1 }}>
            {!collapsed && (
              <Typography
                variant="overline"
                sx={{ display: 'block', px: 2.5, pt: 1, pb: 0.5, color: SIDEBAR.textMuted, fontSize: 10 }}
              >
                {section.heading}
              </Typography>
            )}

            <List dense disablePadding sx={{ px: collapsed ? 1 : 1.5 }}>
              {section.items.map(({ label, to, icon: Icon }) => {
                const active = isActiveRoute(pathname, to);

                return (
                  <Tooltip key={to} title={collapsed ? label : ''} placement="right" arrow>
                    <ListItemButton
                      component={RouterLink}
                      to={to}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      sx={{
                        borderRadius: 2, mb: 0.25, minHeight: 42,
                        justifyContent: collapsed ? 'center' : 'flex-start',
                        px: collapsed ? 1 : 1.5,
                        color: active ? SIDEBAR.textActive : SIDEBAR.text,
                        bgcolor: active ? SIDEBAR.bgActive : 'transparent',
                        transition: 'background-color .15s ease, color .15s ease',
                        '&:hover': { bgcolor: active ? SIDEBAR.bgActive : SIDEBAR.bgHover, color: '#FFFFFF' },
                        '&.Mui-focusVisible': { outline: '2px solid #FFFFFF', outlineOffset: -2 },
                      }}
                    >
                      <ListItemIcon
                        sx={{ minWidth: collapsed ? 0 : 34, color: 'inherit', justifyContent: 'center' }}
                      >
                        <Icon size={18} strokeWidth={active ? 2.4 : 2} />
                      </ListItemIcon>

                      {!collapsed && (
                        <ListItemText
                          primary={label}
                          primaryTypographyProps={{ fontSize: 14, fontWeight: active ? 600 : 500, noWrap: true }}
                        />
                      )}
                    </ListItemButton>
                  </Tooltip>
                );
              })}
            </List>
          </Box>
        ))}
      </Box>

      {!collapsed && (
        <Box sx={{ px: 2.5, py: 2, borderTop: `1px solid ${SIDEBAR.border}` }}>
          <Typography sx={{ fontSize: 11, color: SIDEBAR.textMuted }}>
            Daily Status Report &amp; Resource Tracking
          </Typography>
        </Box>
      )}
    </Box>
  );
}

/* ------------------------------------------------------------------------------------------- */
/*  SHELL                                                                                       */
/* ------------------------------------------------------------------------------------------- */

function AppShell({ children }) {
  const { user, signOut } = useAuth();
  const muiTheme = useTheme();
  const isDesktop = useMediaQuery(muiTheme.breakpoints.up('lg'));

  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState(null);
  // The collapsed preference persists: an admin who works collapsed should not have to re-collapse
  // on every visit.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); }, [collapsed]);

  // Close the mobile drawer on navigation, otherwise it stays over the page just navigated to.
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const width = collapsed ? SIZES.sidebarCollapsed : SIZES.sidebar;
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Keyboard users can jump the navigation entirely. Visible only when focused. */}
      <Box
        component="a"
        href="#main-content"
        sx={{
          position: 'absolute', left: 8, top: -60, zIndex: 2000, px: 2, py: 1,
          bgcolor: COLORS.primary, color: '#FFFFFF', borderRadius: 2, fontSize: 14, fontWeight: 600,
          textDecoration: 'none', transition: 'top .15s ease',
          '&:focus': { top: 8 },
        }}
      >
        Skip to main content
      </Box>

      {/* ------------------------------------------------------------------ header */}
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          width: { lg: `calc(100% - ${width}px)` },
          ml: { lg: `${width}px` },
          borderBottom: `1px solid ${COLORS.border}`,
          bgcolor: 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(8px)',
          transition: 'width .2s ease, margin .2s ease',
        }}
      >
        <Toolbar sx={{ height: SIZES.header, minHeight: SIZES.header, px: { xs: 2, md: 3 }, gap: 1 }}>
          {!isDesktop && (
            <IconButton edge="start" onClick={() => setMobileOpen(true)} aria-label="Open navigation menu">
              <MenuIcon size={20} />
            </IconButton>
          )}

          {isDesktop && (
            <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              <IconButton
                onClick={() => setCollapsed((c) => !c)}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-pressed={collapsed}
                size="small"
              >
                {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
              </IconButton>
            </Tooltip>
          )}

          <Typography
            sx={{ fontSize: 14, fontWeight: 600, color: 'text.secondary', display: { xs: 'none', md: 'block' } }}
          >
            Employee Daily Status Report
          </Typography>

          <Box sx={{ flexGrow: 1 }} />

          <Stack direction="row" spacing={1} alignItems="center">
            <Stack direction="row" spacing={0.5} sx={{ display: { xs: 'none', sm: 'flex' } }}>
              {user?.roles?.map((role) => (
                <Chip
                  key={role}
                  label={role}
                  size="small"
                  sx={{ bgcolor: COLORS.primaryLight, color: COLORS.primaryHover, fontWeight: 600 }}
                />
              ))}
            </Stack>

            <Tooltip title="Account">
              <IconButton
                onClick={(e) => setAnchorEl(e.currentTarget)}
                aria-label="Open account menu"
                aria-haspopup="menu"
                aria-expanded={Boolean(anchorEl)}
                sx={{ p: 0.5 }}
              >
                <Avatar sx={{ width: 34, height: 34, bgcolor: COLORS.primary, fontSize: 13, fontWeight: 600 }}>
                  {initials(user?.fullName)}
                </Avatar>
              </IconButton>
            </Tooltip>
          </Stack>

          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={() => setAnchorEl(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { sx: { minWidth: 236, boxShadow: SHADOWS.dropdown } } }}
          >
            <Box sx={{ px: 1.5, py: 1.25 }}>
              <Typography variant="body2" fontWeight={600} noWrap>{user?.fullName}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap>{user?.email}</Typography>
            </Box>
            <Divider sx={{ my: 0.5 }} />

            <MenuItem component={RouterLink} to="/change-password" onClick={() => setAnchorEl(null)}>
              <ListItemIcon sx={{ minWidth: 32 }}><KeyRound size={16} /></ListItemIcon>
              Change password
            </MenuItem>

            <MenuItem
              onClick={async () => { setAnchorEl(null); await signOut(); navigate('/login'); }}
              sx={{ color: 'error.main' }}
            >
              <ListItemIcon sx={{ minWidth: 32, color: 'error.main' }}><LogOut size={16} /></ListItemIcon>
              Sign out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {/* ------------------------------------------------------------------ navigation */}
      <Box component="aside" sx={{ width: { lg: width }, flexShrink: { lg: 0 } }}>
        {/* Temporary drawer on tablet and phone; permanent from lg upward. */}
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={closeMobile}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', lg: 'none' },
            '& .MuiDrawer-paper': { width: SIZES.sidebar, boxSizing: 'border-box', border: 'none' },
          }}
        >
          <SidebarContent collapsed={false} onNavigate={closeMobile} />
        </Drawer>

        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: 'none', lg: 'block' },
            '& .MuiDrawer-paper': {
              width, boxSizing: 'border-box', border: 'none',
              transition: 'width .2s ease', overflowX: 'hidden',
            },
          }}
        >
          <SidebarContent collapsed={collapsed} />
        </Drawer>
      </Box>

      {/* ------------------------------------------------------------------ content */}
      <Box
        component="main"
        id="main-content"
        sx={{
          flexGrow: 1, minWidth: 0,
          px: { xs: 2, md: 3, lg: 4 },
          pb: { xs: 3, md: 5 },
          width: { lg: `calc(100% - ${width}px)` },
          transition: 'width .2s ease',
        }}
      >
        <Toolbar sx={{ height: SIZES.header, minHeight: SIZES.header }} />
        <Box sx={{ pt: { xs: 2, md: 3 }, maxWidth: 1600, mx: 'auto' }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}

/* ------------------------------------------------------------------------------------------- */

/** Route-level loading indicator for the lazily loaded pages. */
const RouteFallback = () => <LinearProgress aria-label="Loading page" />;

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/not-authorised" element={<NotAuthorisedPage />} />

              <Route path="/change-password" element={
                <RequireAuth><AppShell><ChangePasswordPage /></AppShell></RequireAuth>} />

              <Route path="/dashboard" element={
                <RequireAuth><AppShell><DashboardPage /></AppShell></RequireAuth>} />

              <Route path="/dsr" element={
                <RequireAuth><AppShell><DsrEntryPage /></AppShell></RequireAuth>} />

              <Route path="/dsr/history" element={
                <RequireAuth><AppShell><DsrHistoryPage /></AppShell></RequireAuth>} />

              <Route path="/reports" element={
                <RequireAuth roles={[ROLES.ADMIN, ROLES.MANAGER]}><AppShell><ReportsPage /></AppShell></RequireAuth>} />

              <Route path="/admin/dsr-reports" element={
                <RequireAuth roles={[ROLES.ADMIN, ROLES.MANAGER]}><AppShell><DsrDetailsPage /></AppShell></RequireAuth>} />

              <Route path="/admin/users" element={
                <RequireAuth roles={[ROLES.ADMIN, ROLES.MANAGER]}><AppShell><UsersPage /></AppShell></RequireAuth>} />

              <Route path="/admin/projects" element={
                <RequireAuth roles={[ROLES.ADMIN]}><AppShell><ProjectsPage /></AppShell></RequireAuth>} />

              <Route path="/admin/settings" element={
                <RequireAuth roles={[ROLES.ADMIN]}><AppShell><SettingsPage /></AppShell></RequireAuth>} />

              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
