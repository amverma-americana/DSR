/**
 * DESIGN TOKENS — the single source of truth for the visual language.
 *
 * Every colour, radius, shadow and spacing step in the application resolves back to this file.
 * Components must never hard-code a hex value: import the token instead, so a future rebrand is a
 * change here rather than a search across forty files.
 *
 * The spacing scale is deliberately 4 / 8 / 12 / 16 / 24 / 32 only. MUI's spacing() is configured
 * to an 8px base, so sx={{ p: 2 }} === 16px and sx={{ p: 1.5 }} === 12px — every step on the scale
 * is reachable, and values off the scale look obviously wrong in review.
 */

export const COLORS = {
  primary: '#2563EB',
  primaryHover: '#1D4ED8',
  primaryLight: '#EFF6FF',
  primarySoft: '#DBEAFE',

  success: '#16A34A',
  successLight: '#F0FDF4',
  warning: '#F59E0B',
  warningLight: '#FFFBEB',
  danger: '#DC2626',
  dangerLight: '#FEF2F2',

  background: '#F8FAFC',
  card: '#FFFFFF',
  border: '#E5E7EB',
  borderStrong: '#CBD5E1',

  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',

  // Surfaces used for table headers, zebra striping and hover states. Kept a hair off pure grey so
  // rows read as separated without the heavy banding a darker stripe produces.
  surface: '#F9FAFB',
  surfaceAlt: '#FCFCFD',
  surfaceHover: '#F1F5F9',
};

/** Sidebar is its own dark surface, so it needs a small palette of its own. */
export const SIDEBAR = {
  bg: '#0F172A',
  bgHover: 'rgba(255, 255, 255, 0.06)',
  bgActive: '#2563EB',
  text: '#CBD5E1',
  textActive: '#FFFFFF',
  textMuted: '#64748B',
  border: 'rgba(255, 255, 255, 0.08)',
};

/** Type scale, exactly as specified. Sizes are px; MUI accepts them as numbers. */
export const TYPE = {
  pageTitle: 28,
  sectionTitle: 22,
  cardTitle: 16,
  gridHeader: 14,
  label: 13,
  body: 14,
  helper: 12,
};

/**
 * Shadows. Enterprise dashboards read as "premium" through restraint: a soft ambient shadow at
 * rest, a slightly lifted one on hover. Anything heavier looks like a 2014 Bootstrap panel.
 */
export const SHADOWS = {
  card: '0 1px 2px 0 rgba(16, 24, 40, 0.04), 0 1px 3px 0 rgba(16, 24, 40, 0.06)',
  cardHover: '0 4px 8px -2px rgba(16, 24, 40, 0.08), 0 2px 4px -2px rgba(16, 24, 40, 0.04)',
  dropdown: '0 12px 16px -4px rgba(16, 24, 40, 0.08), 0 4px 6px -2px rgba(16, 24, 40, 0.03)',
  modal: '0 24px 48px -12px rgba(16, 24, 40, 0.18)',
  focusRing: '0 0 0 3px rgba(37, 99, 235, 0.16)',
};

export const RADIUS = {
  control: 10,   // inputs and buttons, per the specification
  card: 12,
  pill: 999,
};

/** Control heights, per the specification. */
export const SIZES = {
  control: 48,        // text fields and dropdowns
  controlSmall: 40,   // dense contexts (table pagination, toolbars)
  button: 44,
  buttonSmall: 36,
  sidebar: 264,
  sidebarCollapsed: 76,
  header: 64,
};

/** Chart series colours — colour-blind safe ordering, primary first. */
export const CHART_COLORS = [
  '#2563EB', '#16A34A', '#F59E0B', '#8B5CF6', '#EC4899',
  '#06B6D4', '#DC2626', '#64748B',
];
