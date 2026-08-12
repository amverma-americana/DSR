import { createTheme } from '@mui/material/styles';
import { COLORS, RADIUS, SHADOWS, SIZES, TYPE } from './tokens';

/**
 * THE APPLICATION THEME.
 *
 * This file does the heavy lifting of the redesign. Nearly every visual rule — control heights,
 * radii, focus rings, table styling, card treatment, typography — is declared here once, so pages
 * inherit the new look without their markup changing. That matters for a redesign of a working
 * system: the fewer page-level edits, the less chance of disturbing behaviour that already works.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY size="small" IS NORMALISED RATHER THAN REMOVED FROM THE PAGES
 * ---------------------------------------------------------------------------------------------
 * The specification asks for a uniform 48px control height. The existing pages pass size="small"
 * on roughly forty inputs, which MUI renders at 40px. Stripping that prop from every page would be
 * forty chances to fumble a control's props during a purely visual change.
 *
 * Instead both sizes are pinned to 48px here, and the floating label's resting transform is
 * re-centred to match. MUI positions the outlined label with a fixed translate that assumes the
 * default height (translate(14px, 9px) for small, 16px for medium); left alone, labels on small
 * fields would sit high in a 48px box. Overriding the transform for both sizes keeps the label
 * optically centred whichever size a page happens to pass.
 *
 * Deliberately NOT stretched to 48px: multiline inputs (they must grow with content) and the
 * unstyled InputBase that MuiTablePagination uses for its rows-per-page select.
 * ---------------------------------------------------------------------------------------------
 */
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: COLORS.primary, dark: COLORS.primaryHover, light: COLORS.primarySoft, contrastText: '#FFFFFF' },
    secondary: { main: '#7C3AED' },
    success: { main: COLORS.success, light: COLORS.successLight },
    warning: { main: COLORS.warning, light: COLORS.warningLight },
    error: { main: COLORS.danger, light: COLORS.dangerLight },
    info: { main: COLORS.primary },
    background: { default: COLORS.background, paper: COLORS.card },
    text: { primary: COLORS.textPrimary, secondary: COLORS.textSecondary, disabled: COLORS.textTertiary },
    divider: COLORS.border,
    action: { hover: COLORS.surfaceHover, selected: COLORS.primaryLight },
  },

  /*  Breakpoints match the requested device targets. MUI's defaults already cover 1536/1200/900/
      600/0; only 'xl' is nudged so a 1920px monitor gets the wide layout rather than being capped
      at the 1536px default.  */
  breakpoints: { values: { xs: 0, sm: 480, md: 768, lg: 1024, xl: 1440 } },

  spacing: 8,
  shape: { borderRadius: RADIUS.card },

  typography: {
    fontFamily: ['Inter', 'Segoe UI', 'Arial', 'sans-serif'].join(','),

    // Page title — rendered as <h1> via PageHeader's component prop.
    h4: { fontSize: TYPE.pageTitle, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.25 },
    // Section title
    h5: { fontSize: TYPE.sectionTitle, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.3 },
    // Card title
    h6: { fontSize: TYPE.cardTitle, fontWeight: 600, letterSpacing: '-0.005em', lineHeight: 1.4 },

    subtitle1: { fontSize: TYPE.cardTitle, fontWeight: 600 },
    subtitle2: { fontSize: TYPE.label, fontWeight: 500 },   // labels
    body1: { fontSize: TYPE.body, fontWeight: 400, lineHeight: 1.55 },
    body2: { fontSize: TYPE.body, fontWeight: 400, lineHeight: 1.5 },
    caption: { fontSize: TYPE.helper, fontWeight: 400, lineHeight: 1.45 },
    button: { fontSize: TYPE.body, fontWeight: 600, textTransform: 'none' },
    overline: { fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' },
  },

  components: {
    /* ------------------------------------------------------------------ global */
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: COLORS.background,
          color: COLORS.textPrimary,
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        },
        /*  A visible focus ring is an accessibility requirement, but showing it on mouse clicks
            makes an app feel broken. :focus-visible is the browser's own answer to that: keyboard
            focus rings, no mouse focus rings.  */
        '*:focus-visible': {
          outline: `2px solid ${COLORS.primary}`,
          outlineOffset: 2,
          borderRadius: 4,
        },
        // Slim, unobtrusive scrollbars — a small detail that reads as "product" rather than "form".
        '*::-webkit-scrollbar': { width: 10, height: 10 },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
        '*::-webkit-scrollbar-thumb': {
          backgroundColor: '#D1D5DB', borderRadius: 8, border: '2px solid transparent',
          backgroundClip: 'content-box',
        },
        '*::-webkit-scrollbar-thumb:hover': { backgroundColor: COLORS.borderStrong },
        '@media (prefers-reduced-motion: reduce)': {
          '*': { animationDuration: '0.01ms !important', transitionDuration: '0.01ms !important' },
        },
      },
    },

    /* ------------------------------------------------------------------ surfaces */
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: `1px solid ${COLORS.border}`,
          borderRadius: RADIUS.card,
          boxShadow: SHADOWS.card,
          backgroundImage: 'none',
        },
      },
    },
    MuiPaper: { styleOverrides: { rounded: { borderRadius: RADIUS.card } } },
    MuiCardContent: {
      styleOverrides: { root: { padding: 24, '&:last-child': { paddingBottom: 24 } } },
    },

    /* ------------------------------------------------------------------ buttons */
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: RADIUS.control,
          height: SIZES.button,
          paddingInline: 20,
          fontWeight: 600,
          transition: 'background-color .15s ease, border-color .15s ease, transform .06s ease, box-shadow .15s ease',
          '&:active': { transform: 'translateY(1px)' },      // click animation
          '&.Mui-disabled': { opacity: 0.55 },
        },
        sizeSmall: { height: SIZES.buttonSmall, paddingInline: 14, fontSize: TYPE.label },
        sizeLarge: { height: 52, paddingInline: 26, fontSize: 15 },
        contained: { boxShadow: 'none', '&:hover': { boxShadow: SHADOWS.card } },
        containedPrimary: { backgroundColor: COLORS.primary, '&:hover': { backgroundColor: COLORS.primaryHover } },
        outlined: {
          borderColor: COLORS.border, color: COLORS.textPrimary, backgroundColor: COLORS.card,
          '&:hover': { borderColor: COLORS.borderStrong, backgroundColor: COLORS.surface },
        },
        outlinedError: { borderColor: '#FCA5A5', color: COLORS.danger, '&:hover': { borderColor: COLORS.danger, backgroundColor: COLORS.dangerLight } },
        text: { '&:hover': { backgroundColor: COLORS.surfaceHover } },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { borderRadius: 8, transition: 'background-color .15s ease', '&:hover': { backgroundColor: COLORS.surfaceHover } },
      },
    },

    /* ------------------------------------------------------------------ inputs */
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: RADIUS.control,
          backgroundColor: COLORS.card,
          fontSize: TYPE.body,
          transition: 'box-shadow .15s ease, border-color .15s ease',
          // Single-line controls only; multiline must be free to grow with its content.
          '&:not(.MuiInputBase-multiline)': { height: SIZES.control },
          '& .MuiOutlinedInput-notchedOutline': { borderColor: COLORS.border },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: COLORS.borderStrong },
          '&.Mui-focused': { boxShadow: SHADOWS.focusRing },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: COLORS.primary, borderWidth: 1.5 },
          '&.Mui-disabled': { backgroundColor: COLORS.surface },
          '&.Mui-error.Mui-focused': { boxShadow: '0 0 0 3px rgba(220, 38, 38, 0.14)' },
        },
        input: {
          fontSize: TYPE.body,
          '&::placeholder': { color: COLORS.textTertiary, opacity: 1 },
        },
        // Textarea: auto-resizing is handled by MUI's TextareaAutosize when a page passes `multiline`.
        multiline: { padding: '12px 14px' },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        outlined: {
          fontSize: TYPE.body,
          color: COLORS.textSecondary,
          // Re-centre the resting label inside the taller 48px control (see the file header).
          '&:not(.MuiInputLabel-shrink)': { transform: 'translate(14px, 14px) scale(1)' },
          '&.MuiInputLabel-shrink': { transform: 'translate(14px, -8px) scale(0.79)', fontWeight: 500 },
          '&.Mui-focused': { color: COLORS.primary },
        },
      },
    },
    MuiFormHelperText: {
      styleOverrides: { root: { fontSize: TYPE.helper, marginLeft: 2, marginTop: 6 } },
    },
    MuiFormLabel: { styleOverrides: { root: { fontSize: TYPE.label, fontWeight: 500 } } },
    MuiSelect: { styleOverrides: { select: { display: 'flex', alignItems: 'center' } } },
    MuiMenu: {
      styleOverrides: {
        paper: { borderRadius: RADIUS.control, boxShadow: SHADOWS.dropdown, border: `1px solid ${COLORS.border}`, marginTop: 4 },
        list: { padding: 6 },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          borderRadius: 8, fontSize: TYPE.body, minHeight: 40,
          '&.Mui-selected': { backgroundColor: COLORS.primaryLight, color: COLORS.primaryHover, fontWeight: 500 },
          '&.Mui-selected:hover': { backgroundColor: COLORS.primarySoft },
        },
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        // The Autocomplete input is a nested InputBase; without this it keeps MUI's default padding
        // and ends up visually shorter than the plain text fields beside it.
        inputRoot: { '&.MuiOutlinedInput-root': { paddingTop: 0, paddingBottom: 0 } },
        paper: { borderRadius: RADIUS.control, boxShadow: SHADOWS.dropdown, border: `1px solid ${COLORS.border}` },
        option: { borderRadius: 8, margin: '2px 6px', fontSize: TYPE.body },
      },
    },
    MuiCheckbox: { styleOverrides: { root: { borderRadius: 6, '&.Mui-checked': { color: COLORS.primary } } } },
    MuiRadio: { styleOverrides: { root: { '&.Mui-checked': { color: COLORS.primary } } } },
    MuiSwitch: { styleOverrides: { root: { '& .Mui-checked': { color: COLORS.primary } } } },

    /* ------------------------------------------------------------------ data display */
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: COLORS.border, fontSize: TYPE.body, color: COLORS.textPrimary, padding: '12px 16px' },
        head: {
          fontSize: TYPE.gridHeader, fontWeight: 600, color: COLORS.textSecondary,
          backgroundColor: COLORS.surface, whiteSpace: 'nowrap', letterSpacing: '0.01em',
          borderBottom: `1px solid ${COLORS.border}`,
        },
        sizeSmall: { padding: '10px 14px' },
        footer: { fontSize: TYPE.body },
      },
    },
    MuiTableBody: {
      styleOverrides: {
        // Zebra striping lives here rather than on MuiTableRow so it can never stripe a header row.
        root: {
          '& .MuiTableRow-root:nth-of-type(even)': { backgroundColor: COLORS.surfaceAlt },
          '& .MuiTableRow-root:hover': { backgroundColor: COLORS.surfaceHover },
          '& .MuiTableRow-root.Mui-selected, & .MuiTableRow-root.Mui-selected:hover': {
            backgroundColor: COLORS.primaryLight,
          },
          '& .MuiTableRow-root:last-child .MuiTableCell-root': { borderBottom: 'none' },
        },
      },
    },
    MuiTableContainer: { styleOverrides: { root: { borderRadius: 0 } } },
    MuiTablePagination: {
      styleOverrides: {
        root: { borderTop: `1px solid ${COLORS.border}`, fontSize: TYPE.body },
        selectLabel: { fontSize: TYPE.label, color: COLORS.textSecondary },
        displayedRows: { fontSize: TYPE.label, color: COLORS.textSecondary },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: RADIUS.pill, fontWeight: 500, fontSize: TYPE.helper, height: 24 },
        sizeSmall: { height: 22, fontSize: 11 },
        outlined: { borderColor: COLORS.border, backgroundColor: COLORS.card },
        filled: { backgroundColor: COLORS.surfaceHover, color: COLORS.textPrimary },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#111827', fontSize: TYPE.helper, fontWeight: 400,
          borderRadius: 8, padding: '8px 12px', maxWidth: 320,
        },
        arrow: { color: '#111827' },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: RADIUS.control, fontSize: TYPE.body, alignItems: 'center', border: '1px solid transparent' },
        standardError: { backgroundColor: COLORS.dangerLight, color: '#991B1B', borderColor: '#FECACA' },
        standardSuccess: { backgroundColor: COLORS.successLight, color: '#166534', borderColor: '#BBF7D0' },
        standardWarning: { backgroundColor: COLORS.warningLight, color: '#92400E', borderColor: '#FDE68A' },
        standardInfo: { backgroundColor: COLORS.primaryLight, color: '#1E40AF', borderColor: COLORS.primarySoft },
      },
    },
    MuiLinearProgress: { styleOverrides: { root: { height: 3, borderRadius: 0, backgroundColor: COLORS.primarySoft } } },

    /* ------------------------------------------------------------------ navigation */
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 48 },
        indicator: { height: 2.5, borderRadius: '3px 3px 0 0', backgroundColor: COLORS.primary },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none', fontSize: TYPE.body, fontWeight: 500, minHeight: 48,
          color: COLORS.textSecondary, padding: '12px 16px',
          '&:hover': { color: COLORS.textPrimary, backgroundColor: COLORS.surface },
          '&.Mui-selected': { color: COLORS.primary, fontWeight: 600 },
        },
      },
    },
    MuiBreadcrumbs: {
      styleOverrides: {
        root: { fontSize: TYPE.helper },
        separator: { color: COLORS.textTertiary, marginInline: 6 },
      },
    },

    /* ------------------------------------------------------------------ overlays */
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 14, boxShadow: SHADOWS.modal, border: `1px solid ${COLORS.border}` },
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: { fontSize: 18, fontWeight: 600, padding: '20px 24px 12px' },
      },
    },
    MuiDialogContent: { styleOverrides: { root: { padding: '8px 24px 16px' } } },
    MuiDialogActions: {
      styleOverrides: { root: { padding: '12px 24px 20px', gap: 8, borderTop: `1px solid ${COLORS.border}` } },
    },
    MuiSnackbarContent: {
      styleOverrides: {
        root: { borderRadius: RADIUS.control, backgroundColor: '#111827', fontSize: TYPE.body, boxShadow: SHADOWS.modal },
      },
    },
    MuiDrawer: { styleOverrides: { paper: { borderRight: 'none', backgroundImage: 'none' } } },
    MuiDivider: { styleOverrides: { root: { borderColor: COLORS.border } } },
  },
});

export default theme;
