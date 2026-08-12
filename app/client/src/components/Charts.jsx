import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from 'recharts';
import { Box, Stack, Typography } from '@mui/material';
import { CHART_COLORS, COLORS, SHADOWS, TYPE } from '../theme/tokens';
import EmptyState from './EmptyState';

/**
 * Chart primitives shared by the dashboard and the reporting screens.
 *
 * ---------------------------------------------------------------------------------------------
 * EVERY CHART IS DRAWN FROM DATA THE PAGE ALREADY FETCHED
 * ---------------------------------------------------------------------------------------------
 * No chart here issues a request of its own. Each one is handed a slice of an existing API
 * response — the same numbers already rendered in the table beside it. That keeps the redesign
 * strictly presentational: no new endpoints, no extra load on the API, and no possibility of a
 * chart disagreeing with the table underneath it because the two fetched at different moments.
 * ---------------------------------------------------------------------------------------------
 */

const axisStyle = { fontSize: TYPE.helper, fill: COLORS.textSecondary };

const tooltipStyle = {
  contentStyle: {
    borderRadius: 10,
    border: `1px solid ${COLORS.border}`,
    boxShadow: SHADOWS.dropdown,
    fontSize: TYPE.helper,
    padding: '8px 12px',
  },
  labelStyle: { color: COLORS.textPrimary, fontWeight: 600, marginBottom: 4 },
  cursor: { fill: 'rgba(37, 99, 235, 0.06)' },
};

/** Truncates long axis labels so a project name cannot squeeze the plot area to nothing. */
const truncate = (value, max = 14) => {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/**
 * Grouped bar chart. Pass one series for a simple comparison, two for estimated-versus-actual.
 *
 * @param data     Array of plain objects.
 * @param xKey     Property holding the category label.
 * @param series   [{ key, name, color }] — one entry per bar.
 * @param height   Plot height in px.
 * @param layout   'horizontal' (default) or 'vertical' for long category names.
 */
export function BarSeriesChart({ data = [], xKey, series = [], height = 260, layout = 'horizontal' }) {
  if (!data.length) {
    return <EmptyState compact title="Nothing to chart" description="No data in the selected period." />;
  }

  const isVertical = layout === 'vertical';

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={isVertical ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 12, left: isVertical ? 8 : -18, bottom: 4 }}
        barGap={4}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={isVertical} horizontal={!isVertical} />

        {isVertical ? (
          <>
            <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} />
            <YAxis
              type="category" dataKey={xKey} tick={axisStyle} tickLine={false} axisLine={false}
              width={110} tickFormatter={(v) => truncate(v, 16)}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey={xKey} tick={axisStyle} tickLine={false} axisLine={{ stroke: COLORS.border }}
              tickFormatter={(v) => truncate(v)} interval="preserveStartEnd"
            />
            <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
          </>
        )}

        <Tooltip {...tooltipStyle} />
        {series.length > 1 && (
          <Legend
            iconType="circle" iconSize={8}
            wrapperStyle={{ fontSize: TYPE.helper, paddingTop: 8, color: COLORS.textSecondary }}
          />
        )}

        {series.map((s, index) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            fill={s.color ?? CHART_COLORS[index % CHART_COLORS.length]}
            radius={isVertical ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            maxBarSize={isVertical ? 18 : 42}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Donut chart with a centred headline figure — used for share and adoption breakdowns.
 *
 * @param data       [{ name, value }]
 * @param height     Plot height in px.
 * @param centreValue / centreLabel  Optional text rendered in the hole.
 */
export function DonutChart({ data = [], height = 260, centreValue, centreLabel }) {
  const total = data.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

  if (!data.length || total === 0) {
    return <EmptyState compact title="Nothing to chart" description="No data in the selected period." />;
  }

  return (
    <Box sx={{ position: 'relative' }}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="58%"
            outerRadius="82%"
            paddingAngle={2}
            stroke="none"
          >
            {data.map((entry, index) => (
              <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip {...tooltipStyle} cursor={false} />
          <Legend
            iconType="circle" iconSize={8}
            wrapperStyle={{ fontSize: TYPE.helper, paddingTop: 8, color: COLORS.textSecondary }}
          />
        </PieChart>
      </ResponsiveContainer>

      {centreValue !== undefined && (
        <Stack
          aria-hidden="true"
          alignItems="center"
          sx={{
            position: 'absolute', top: 0, left: 0, right: 0,
            // Offset upward by the legend's share of the box so the figure sits in the ring, not
            // in the middle of the whole component.
            height: height - 34,
            justifyContent: 'center', pointerEvents: 'none',
          }}
        >
          <Typography sx={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            {centreValue}
          </Typography>
          {centreLabel && (
            <Typography variant="caption" color="text.secondary">{centreLabel}</Typography>
          )}
        </Stack>
      )}
    </Box>
  );
}
