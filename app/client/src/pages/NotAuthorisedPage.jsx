import { Alert, Box, Button, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

export default function NotAuthorisedPage() {
  return (
    <Box sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center', p: 3 }}>
      <Box sx={{ maxWidth: 460, textAlign: 'center' }}>
        <Typography variant="h5" gutterBottom>Not authorised</Typography>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Your account does not have permission to view this page.
        </Alert>
        <Button component={RouterLink} to="/dashboard" variant="contained">Back to dashboard</Button>
      </Box>
    </Box>
  );
}
