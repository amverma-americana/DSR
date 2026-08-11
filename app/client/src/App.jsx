import { Suspense, lazy, useState } from 'react';
import { BrowserRouter, Link as RouterLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar, Avatar, Box, Button, Chip, CssBaseline, Divider, Drawer, IconButton, LinearProgress,
  List, ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, Stack, ThemeProvider, Toolbar,
  Typography, useMediaQuery, useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PostAddIcon from '@mui/icons-material/PostAdd';
import HistoryIcon from '@mui/icons-material/History';
import AssessmentIcon from '@mui/icons-material/Assessment';
import GroupsIcon from '@mui/icons-material/Groups';
import FolderIcon from '@mui/icons-material/Folder';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import theme from './theme/theme';
import { AuthProvider, RequireAuth, ROLES, useAuth } from './auth/AuthContext';

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

const DRAWER_WIDTH = 236;

/** Navigation is filtered by role. The API enforces the same boundaries independently. */
const NAV_ITEMS = [
  { label: 'Dashboard', to: '/dashboard', icon: DashboardIcon },
  { label: 'New DSR', to: '/dsr', icon: PostAddIcon },
  { label: 'My DSR History', to: '/dsr/history', icon: HistoryIcon },
  // Reports are Admin/Manager only. Employees have no report rights at all, including export.
  { label: 'Reports', to: '/reports', icon: AssessmentIcon, roles: [ROLES.ADMIN, ROLES.MANAGER] },
  { label: 'DSR Reports', to: '/admin/dsr-reports', icon: AssessmentIcon, roles: [ROLES.ADMIN, ROLES.MANAGER] },
  { label: 'Users', to: '/admin/users', icon: GroupsIcon, roles: [ROLES.ADMIN, ROLES.MANAGER] },
  { label: 'Projects', to: '/admin/projects', icon: FolderIcon, roles: [ROLES.ADMIN] },
  { label: 'Settings', to: '/admin/settings', icon: SettingsIcon, roles: [ROLES.ADMIN] },
];

function AppShell({ children }) {
  const { user, signOut, hasRole } = useAuth();
  const muiTheme = useTheme();
  const isDesktop = useMediaQuery(muiTheme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();

  const visibleItems = NAV_ITEMS.filter((item) => !item.roles || hasRole(...item.roles));

  const drawer = (
    <Box>
      <Toolbar sx={{ px: 2 }}>
        <Typography variant="subtitle1" color="primary">DSR &amp; Resources</Typography>
      </Toolbar>
      <Divider />
      <List dense>
        {visibleItems.map(({ label, to, icon: Icon }) => (
          <ListItemButton
            key={to} component={RouterLink} to={to}
            selected={location.pathname === to || (to !== '/dashboard' && location.pathname.startsWith(to))}
            onClick={() => setMobileOpen(false)}
          >
            <ListItemIcon><Icon fontSize="small" /></ListItemIcon>
            <ListItemText primary={label} />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" color="inherit" elevation={0}
        sx={{ borderBottom: '1px solid #e0e4ea', zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar>
          {!isDesktop && (
            <IconButton edge="start" onClick={() => setMobileOpen(true)} sx={{ mr: 1 }}>
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
            Employee Daily Status Report &amp; Resource Tracking
          </Typography>

          <Stack direction="row" spacing={1} alignItems="center">
            {user?.roles?.map((role) => <Chip key={role} label={role} size="small" variant="outlined" />)}
            <IconButton onClick={(e) => setAnchorEl(e.currentTarget)}>
              <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14 }}>
                {user?.fullName?.split(' ').map((n) => n[0]).slice(0, 2).join('')}
              </Avatar>
            </IconButton>
          </Stack>

          <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
            <MenuItem disabled>
              <Stack>
                <Typography variant="body2">{user?.fullName}</Typography>
                <Typography variant="caption" color="text.secondary">{user?.email}</Typography>
              </Stack>
            </MenuItem>
            <Divider />
            <MenuItem component={RouterLink} to="/change-password" onClick={() => setAnchorEl(null)}>
              Change password
            </MenuItem>
            <MenuItem onClick={async () => { setAnchorEl(null); await signOut(); navigate('/login'); }}>
              <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon> Sign out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Drawer
        variant={isDesktop ? 'permanent' : 'temporary'}
        open={isDesktop || mobileOpen}
        onClose={() => setMobileOpen(false)}
        sx={{ width: DRAWER_WIDTH, flexShrink: 0,
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' } }}
      >
        {drawer}
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, md: 3 }, width: { md: `calc(100% - ${DRAWER_WIDTH}px)` } }}>
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
}

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<LinearProgress />}>
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
