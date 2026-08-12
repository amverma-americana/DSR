import { Button, Stack, Typography } from '@mui/material';
import { AlertTriangle } from 'lucide-react';
import AppDialog from './AppDialog';
import { COLORS } from '../theme/tokens';

/**
 * Confirmation modal, replacing the browser's window.confirm on destructive actions.
 *
 * window.confirm cannot be styled, renders chrome-branded text the user cannot read in context,
 * and on some platforms appears detached from the window that raised it. This keeps the identical
 * GATE — nothing happens until the user confirms — while stating plainly what is about to change.
 *
 * @param open, onClose  Dialog control.
 * @param title          What is about to happen.
 * @param message        Consequence, stated in full.
 * @param confirmLabel   Primary button text; defaults to "Confirm".
 * @param tone           'danger' (default) or 'primary'.
 * @param onConfirm      Invoked on confirm. The caller closes the dialog.
 * @param busy           Disables the primary action while the request is in flight.
 */
export default function ConfirmDialog({
  open, onClose, title, message, confirmLabel = 'Confirm', tone = 'danger', onConfirm, busy = false,
}) {
  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={title}
      maxWidth="xs"
      actions={(
        <>
          <Button variant="text" onClick={onClose}>Cancel</Button>
          <Button
            variant="contained"
            color={tone === 'danger' ? 'error' : 'primary'}
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {confirmLabel}
          </Button>
        </>
      )}
    >
      <Stack direction="row" spacing={2} alignItems="flex-start">
        <Stack
          aria-hidden="true"
          sx={{
            flexShrink: 0, width: 38, height: 38, borderRadius: '50%',
            alignItems: 'center', justifyContent: 'center',
            bgcolor: tone === 'danger' ? COLORS.dangerLight : COLORS.primaryLight,
            color: tone === 'danger' ? COLORS.danger : COLORS.primary,
          }}
        >
          <AlertTriangle size={19} />
        </Stack>
        <Typography variant="body2" color="text.secondary">{message}</Typography>
      </Stack>
    </AppDialog>
  );
}
