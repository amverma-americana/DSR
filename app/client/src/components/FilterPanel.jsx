import { Box, Button, Card, Chip, Collapse, Divider, Stack, Typography } from '@mui/material';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';

/**
 * The standard filter container: a card with a labelled header, a live count of applied filters,
 * an optional reset, and a responsive grid of controls supplied as children.
 *
 * The applied-count matters more than it looks. With filters collapsed — which is how a user
 * leaves the page after narrowing a report — an empty grid is indistinguishable from a filtered
 * one, and people conclude the data is wrong. The badge keeps that state visible while collapsed.
 *
 * @param title        Header label.
 * @param appliedCount Number of non-default filters currently applied.
 * @param onReset      Optional handler; the reset button only renders when supplied.
 * @param open         Controlled open state.
 * @param onToggle     Toggles open state; the collapse control only renders when supplied.
 * @param actions      Optional extra nodes in the header (e.g. export buttons).
 */
export default function FilterPanel({
  title = 'Filters', appliedCount = 0, onReset, open = true, onToggle, actions, children,
}) {
  return (
    <Card sx={{ mb: 3 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
        spacing={1.5}
        sx={{ px: 3, py: 2 }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box aria-hidden="true" sx={{ display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
            <SlidersHorizontal size={16} />
          </Box>
          <Typography variant="h6" component="h2">{title}</Typography>
          {appliedCount > 0 && (
            <Chip
              size="small"
              label={`${appliedCount} applied`}
              sx={{ bgcolor: 'primary.light', color: 'primary.dark', fontWeight: 600 }}
            />
          )}
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {actions}
          {onReset && (
            <Button
              size="small"
              variant="text"
              onClick={onReset}
              startIcon={<RotateCcw size={14} />}
              disabled={appliedCount === 0}
            >
              Reset
            </Button>
          )}
          {onToggle && (
            <Button size="small" variant="text" onClick={onToggle} aria-expanded={open} aria-controls="filter-panel-body">
              {open ? 'Hide' : 'Show'}
            </Button>
          )}
        </Stack>
      </Stack>

      <Collapse in={open} timeout={180}>
        <Divider />
        <Box id="filter-panel-body" sx={{ px: 3, py: 2.5 }}>
          {children}
        </Box>
      </Collapse>
    </Card>
  );
}
