import { Box, Card, Divider, Stack, Typography } from '@mui/material';

/**
 * A titled card: header row (title, optional subtitle, optional right-hand action) over content.
 *
 * Pages previously hand-rolled `<Card><CardContent><Typography variant="subtitle1">` for every
 * panel, so heading sizes and paddings drifted apart screen by screen. Routing them all through
 * one component is what keeps the spacing rhythm identical everywhere.
 *
 * @param title      Card title (16px / 600).
 * @param subtitle   Optional supporting line.
 * @param action     Optional node aligned right in the header.
 * @param noPadding  Content sits flush — used when the body is a full-bleed table.
 * @param dividing   Draws a rule between header and content.
 */
export default function SectionCard({
  title, subtitle, action, children, noPadding = false, dividing = false, sx,
}) {
  const hasHeader = Boolean(title || action);

  return (
    <Card sx={{ display: 'flex', flexDirection: 'column', height: '100%', ...sx }}>
      {hasHeader && (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={2}
          sx={{ px: 3, pt: 2.5, pb: subtitle ? 1.5 : 2 }}
        >
          <Box sx={{ minWidth: 0 }}>
            {title && <Typography variant="h6" component="h2">{title}</Typography>}
            {subtitle && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
        </Stack>
      )}

      {hasHeader && dividing && <Divider />}

      <Box sx={{ flexGrow: 1, ...(noPadding ? {} : { px: 3, pb: 3, pt: hasHeader ? 0 : 3 }) }}>
        {children}
      </Box>
    </Card>
  );
}
