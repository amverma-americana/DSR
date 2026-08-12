import {
  BarChart3, FolderKanban, History, LayoutDashboard, ListChecks, Settings, SquarePen, Users,
} from 'lucide-react';
import { ROLES } from './auth/AuthContext';

/**
 * NAVIGATION MODEL — one definition, three consumers: the sidebar, the mobile drawer and the
 * breadcrumb trail. Previously the sidebar owned this list privately, which meant a breadcrumb
 * would have had to repeat every label and drift out of step the first time one was renamed.
 *
 * Roles here only decide what is DRAWN. Every endpoint enforces the same boundary independently,
 * so hiding a link is convenience, never the security control.
 */
export const NAV_SECTIONS = [
  {
    heading: 'Workspace',
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
      { label: 'New DSR', to: '/dsr', icon: SquarePen },
      { label: 'My DSR History', to: '/dsr/history', icon: History },
    ],
  },
  {
    heading: 'Insights',
    // Reports are Admin/Manager only. Employees have no report rights at all, including export.
    items: [
      { label: 'Reports', to: '/reports', icon: BarChart3, roles: [ROLES.ADMIN, ROLES.MANAGER] },
      { label: 'DSR Reports', to: '/admin/dsr-reports', icon: ListChecks, roles: [ROLES.ADMIN, ROLES.MANAGER] },
    ],
  },
  {
    heading: 'Administration',
    items: [
      { label: 'Users', to: '/admin/users', icon: Users, roles: [ROLES.ADMIN, ROLES.MANAGER] },
      { label: 'Projects', to: '/admin/projects', icon: FolderKanban, roles: [ROLES.ADMIN] },
      { label: 'Settings', to: '/admin/settings', icon: Settings, roles: [ROLES.ADMIN] },
    ],
  },
];

/** Flat view of every navigable item, for breadcrumb and title lookups. */
export const NAV_ITEMS = NAV_SECTIONS.flatMap((section) => section.items);

/** Routes that are reachable but never appear in the sidebar. */
const EXTRA_ROUTES = [
  { label: 'Change password', to: '/change-password' },
  { label: 'Not authorised', to: '/not-authorised' },
];

const ALL_ROUTES = [...NAV_ITEMS, ...EXTRA_ROUTES];

/**
 * Breadcrumb trail for a pathname, always rooted at Home.
 *
 * Matching is longest-prefix rather than exact so that a future detail route such as
 * /admin/projects/42 still resolves to the Projects crumb instead of falling back to nothing.
 */
export function breadcrumbsFor(pathname) {
  const match = ALL_ROUTES
    .filter((r) => pathname === r.to || pathname.startsWith(`${r.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0];

  const trail = [{ label: 'Home', to: '/dashboard' }];
  if (match && match.to !== '/dashboard') trail.push({ label: match.label, to: match.to });
  return trail;
}

/**
 * True when a nav item should render as the active one for the given pathname.
 *
 * Longest-prefix, not plain startsWith. A naive prefix test lights up BOTH "New DSR" (/dsr) and
 * "My DSR History" (/dsr/history) while sitting on the history page, because the latter path
 * begins with the former. Resolving the single best match first means exactly one item is ever
 * highlighted, and nested routes still highlight their parent.
 */
export function isActiveRoute(pathname, to) {
  const best = NAV_ITEMS
    .filter((item) => pathname === item.to || pathname.startsWith(`${item.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0];

  return best?.to === to;
}
