import { Box, Card, Stack, Tooltip, Typography } from '@mui/material';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { COLORS, SHADOWS } from '../theme/tokens';

const TONES = {
  primary: { fg: COLORS.primary, bg: COLORS.primaryLight },
  success: { fg: COLORS.success, bg: COLORS.successLight },
  warning: { fg: COLORS.warning, bg: COLORS.warningLight },
  danger: { fg: COLORS.danger, bg: COLORS.dangerLight },
  neutral: { fg: COLORS.textSecondary, bg: COLORS.surface },
};

/**
 * KPI summary card: icon, metric, description and an optional trend indicator.
 *
 * ---------------------------------------------------------------------------------------------
 * ON THE TREND INDICATOR
 * ---------------------------------------------------------------------------------------------
 * `trend` is OPTIONAL and is only ever rendered when a caller passes a real, measured comparison.
 * It is never synthesised from a single figure. A card showing "36 hours ▲ 12%" when nothing in
 * the API returns a prior-period figure would be inventing data, and an invented trend on a
 * timesheet dashboard is worse than no trend at all — someone will make a staffing call on it.
 *
 * Where the API genuinely exposes a comparison (utilisation against capacity, hours against the
 * daily standard) the caller passes it explicitly.
 * ---------------------------------------------------------------------------------------------
 *
 * @param label      Short metric name, e.g. "Hours logged".
 * @param value      The metric itself.
 * @param icon       Lucide icon component.
 * @param tone       primary | success | warning | danger | neutral — tints the icon chip only.
 * @param suffix     Optional unit rendered small and muted after the value.
 * @param caption    Optional supporting line beneath the value.
 * @param trend      Optional { value: number, label: string, direction?: 'up'|'down'|'flat' }.
 * @param dense      Compact variant for rows of seven-plus cards.
 */
export default function StatCard({
  label, value, icon: Icon, tone = 'primary', suffix, caption, trend, dense = false,
}) {
  const palette = TONES[tone] ?? TONES.primary;

  const direction = trend?.direction ?? (trend?.value > 0 ? 'up' : trend?.value < 0 ? 'down' : 'flat');
  const TrendIcon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;
  const trendColor = direction === 'up' ? COLORS.success : direction === 'down' ? COLORS.danger : COLORS.textSecondary;

  return (
    <Card
      sx={{
        height: '100%',
        p: dense ? 2 : 2.5,
        transition: 'box-shadow .18s ease, transform .18s ease, border-color .18s ease',
        '&:hover': {
          boxShadow: SHADOWS.cardHover,
          transform: 'translateY(-2px)',
          borderColor: COLORS.borderStrong,
        },
      }}
    >
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
        <Typography
          variant="caption"
          sx={{ color: 'text.secondary', fontWeight: 500, letterSpacing: '0.01em', minWidth: 0 }}
        >
          {label}
        </Typography>

        {Icon && (
          <Box
            aria-hidden="true"
            sx={{
              display: 'grid', placeItems: 'center', flexShrink: 0,
              width: dense ? 28 : 34, height: dense ? 28 : 34,
              borderRadius: 2, bgcolor: palette.bg, color: palette.fg,
            }}
          >
            <Icon size={dense ? 15 : 18} strokeWidth={2} />
          </Box>
        )}
      </Stack>

      <Typography
        sx={{
          mt: dense ? 0.5 : 1,
          fontSize: dense ? 22 : 28,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          lineHeight: 1.2,
          color: 'text.primary',
          wordBreak: 'break-word',
        }}
      >
        {value}
        {suffix && (
          <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.5, fontWeight: 400 }}>
            {suffix}
          </Typography>
        )}
      </Typography>

      {(caption || trend) && (
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: dense ? 0.25 : 0.75 }}>
          {trend && (
            <Tooltip title={trend.label ?? ''}>
              <Stack direction="row" alignItems="center" spacing={0.25} sx={{ color: trendColor }}>
                <TrendIcon size={13} strokeWidth={2.5} aria-hidden="true" />
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'inherit' }}>
                  {Math.abs(trend.value)}%
                </Typography>
              </Stack>
            </Tooltip>
          )}
          {caption && (
            <Typography variant="caption" color="text.secondary" noWrap title={caption}>
              {caption}
            </Typography>
          )}
        </Stack>
      )}
    </Card>
  );
}
