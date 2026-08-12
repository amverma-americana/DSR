import { Box, Button, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { COLORS } from '../theme/tokens';

export default function NotAuthorisedPage() {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3, bgcolor: 'background.default' }}>
      <Stack alignItems="center" spacing={2.5} sx={{ maxWidth: 460, textAlign: 'center' }}>
        <Box
          aria-hidden="true"
          sx={{
            display: 'grid', placeItems: 'center', width: 64, height: 64, borderRadius: '50%',
            bgcolor: COLORS.warningLight, color: COLORS.warning,
          }}
        >
          <ShieldAlert size={30} strokeWidth={1.75} />
        </Box>

        <Box>
          <Typography variant="h4" component="h1" sx={{ mb: 1 }}>Not authorised</Typography>
          <Typography variant="body2" color="text.secondary">
            Your account does not have permission to view this page. If you believe this is a
            mistake, contact your administrator.
          </Typography>
        </Box>

        <Button component={RouterLink} to="/dashboard" variant="contained" startIcon={<ArrowLeft size={16} />}>
          Back to dashboard
        </Button>
      </Stack>
    </Box>
  );
}
