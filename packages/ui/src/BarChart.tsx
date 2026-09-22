import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LtrIsolate } from './LtrIsolate';
import { CHART_SERIES_ORDER, tokens } from './tokens';

/**
 * A horizontal bar chart, drawn with layout rather than SVG.
 *
 * Horizontal because the labels are words — stage names, sources, platforms — and a vertical chart
 * turns them into rotated text that nobody reads. Layout rather than SVG because the bars then mirror
 * correctly in RTL for free, whereas an SVG needs its own transform and a separate text direction.
 *
 * **Every bar carries its label and its value** (THEME-009): the series are distinguishable without
 * seeing colour at all, which is the requirement. The palette only helps someone who can.
 *
 * There is no charting dependency. A stacked or time-series chart would justify one; a labelled bar
 * does not, and the bundle budget is real.
 */
export interface BarChartDatum {
  key: string;
  label: string;
  value: number;
  /** Shown beside the label, already formatted by the caller (money, percentage, count). */
  displayValue: string;
}

export interface BarChartProps {
  data: BarChartDatum[];
  /** Accessible name for the whole chart. */
  caption: string;
  emptyLabel: string;
  maxBars?: number;
}

export function BarChart({ data, caption, emptyLabel, maxBars = 10 }: BarChartProps) {
  const rows = data.slice(0, maxBars);
  const peak = rows.reduce((highest, row) => Math.max(highest, row.value), 0);

  if (rows.length === 0 || peak === 0) {
    return (
      <Typography variant="body2" color="text.secondary" component="p">
        {emptyLabel}
      </Typography>
    );
  }

  return (
    <Box component="dl" aria-label={caption} sx={{ margin: 0, display: 'grid', gap: 1.5 }}>
      {rows.map((row, index) => {
        const colour = tokens[CHART_SERIES_ORDER[index % CHART_SERIES_ORDER.length] as 'chart1'];
        const share = Math.max((row.value / peak) * 100, row.value > 0 ? 2 : 0);
        return (
          <Box key={row.key}>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 1,
                alignItems: 'baseline',
              }}
            >
              <Typography component="dt" variant="body2" sx={{ fontWeight: 600 }}>
                {row.label}
              </Typography>
              <Typography component="dd" variant="body2" color="text.secondary" sx={{ margin: 0 }}>
                <LtrIsolate>{row.displayValue}</LtrIsolate>
              </Typography>
            </Box>
            <Box
              aria-hidden
              sx={{
                marginBlockStart: 0.5,
                height: 8,
                borderRadius: 1,
                backgroundColor: tokens.primarySoft,
                overflow: 'hidden',
              }}
            >
              <Box
                sx={{
                  height: '100%',
                  width: `${share}%`,
                  backgroundColor: colour,
                  borderRadius: 1,
                }}
              />
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
