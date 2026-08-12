import { Box, Dialog, DialogActions, DialogContent, IconButton, Stack, Typography } from '@mui/material';
import { X } from 'lucide-react';

/**
 * The standard modal shell: title, optional subtitle, close affordance, scrollable body and a
 * consistent action bar.
 *
 * Beyond looks, this fixes two accessibility gaps in the hand-rolled dialogs it replaces: the
 * title is now programmatically associated with the dialog (aria-labelledby), and there is a
 * visible, reachable close control rather than only the invisible backdrop click.
 *
 * @param open, onClose  Standard MUI dialog control.
 * @param title          Heading text.
 * @param subtitle       Optional supporting line.
 * @param actions        Footer nodes, usually Cancel plus a primary action.
 * @param maxWidth       MUI maxWidth token; defaults to 'sm'.
 */
export default function AppDialog({
  open, onClose, title, subtitle, actions, children, maxWidth = 'sm', fullWidth = true,
}) {
  const titleId = `dialog-title-${String(title ?? 'modal').replace(/\W+/g, '-').toLowerCase()}`;

  return (
    <Dialog open={open} onClose={onClose} maxWidth={maxWidth} fullWidth={fullWidth} aria-labelledby={titleId}>
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        spacing={2}
        sx={{ px: 3, pt: 2.5, pb: 1.5 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography id={titleId} variant="h6" component="h2">{title}</Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{subtitle}</Typography>
          )}
        </Box>

        <IconButton onClick={onClose} aria-label="Close dialog" size="small" sx={{ mt: -0.5, mr: -1 }}>
          <X size={18} />
        </IconButton>
      </Stack>

      <DialogContent sx={{ pt: 1 }}>{children}</DialogContent>

      {actions && <DialogActions>{actions}</DialogActions>}
    </Dialog>
  );
}
