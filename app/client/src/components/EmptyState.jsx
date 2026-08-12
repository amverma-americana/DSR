import { Box, Stack, Typography } from '@mui/material';
import { Inbox } from 'lucide-react';
import { COLORS } from '../theme/tokens';

/**
 * "Nothing here" state for tables and panels.
 *
 * Replaces the previous pattern of dropping an <Alert severity="info"> into a table cell. An alert
 * signals a condition the user should act on; an empty result set after filtering is a normal
 * outcome, and dressing it as a notice made routine screens look like they were reporting faults.
 *
 * @param title        Short statement of what is empty.
 * @param description  Optional guidance on what to do next.
 * @param icon         Lucide icon component; defaults to an inbox.
 * @param action       Optional node, e.g. a "Clear filters" button.
 * @param compact      Reduced vertical padding, for use inside a table body.
 */
export default function EmptyState({ title, description, icon: Icon = Inbox, action, compact = false }) {
  return (
    <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ py: compact ? 5 : 8, px: 3, textAlign: 'center' }}>
      <Box
        aria-hidden="true"
        sx={{
          display: 'grid', placeItems: 'center', width: 48, height: 48, borderRadius: '50%',
          bgcolor: COLORS.surface, color: COLORS.textTertiary, border: `1px solid ${COLORS.border}`,
        }}
      >
        <Icon size={22} strokeWidth={1.75} />
      </Box>

      <Box>
        <Typography variant="body1" fontWeight={600} color="text.primary">{title}</Typography>
        {description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 420 }}>
            {description}
          </Typography>
        )}
      </Box>

      {action}
    </Stack>
  );
}
