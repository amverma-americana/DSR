import { createTheme } from '@mui/material/styles';

/** Single MUI theme. Responsive by default via MUI breakpoints; no custom media queries needed. */
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1b4f8a' },
    secondary: { main: '#00695c' },
    background: { default: '#f4f6f9' },
    success: { main: '#2e7d32' },
    warning: { main: '#ed6c02' },
    error: { main: '#c62828' },
  },
  typography: {
    fontFamily: ['Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'].join(','),
    h5: { fontWeight: 600 },
    subtitle1: { fontWeight: 600 },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiCard: { defaultProps: { elevation: 0 }, styleOverrides: { root: { border: '1px solid #e0e4ea' } } },
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { textTransform: 'none' } } },
    MuiTableCell: { styleOverrides: { head: { fontWeight: 600, backgroundColor: '#eef2f7' } } },
  },
});

export default theme;
