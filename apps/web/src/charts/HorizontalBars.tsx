import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { CHART_SERIES_ORDER, FormattedValue, tokens } from '@alola/ui';
import type { ChartDatum } from './Charts';

/**
 * Horizontal bars for word categories (stages, sources, platforms, people), drawn with layout.
 *
 * Why not recharts here: an SVG category axis in a right-to-left page puts the labels under the bars
 * and the value labels on top of the category labels (found in the 2026-09-28 visual QA). Layout
 * mirrors correctly by construction — the label and value sit on one line at the inline start and
 * end, the bar grows from the inline start beneath them — and it needs no chart chunk at all.
 *
 * Every bar carries its label and its formatted value in text (THEME-009); the list is a `<dl>`, so
 * a screen reader hears each label with its value. The bar track is decorative. Bars are scaled to
 * the largest value, from zero.
 */
export function HorizontalBars({
  caption,
  data,
  emptyLabel,
  multicolour = false,
}: {
  caption: string;
  data: ChartDatum[];
  emptyLabel: string;
  multicolour?: boolean;
}) {
  const peak = data.reduce((highest, datum) => Math.max(highest, datum.value), 0);
  if (data.length === 0 || peak <= 0) {
    return (
      <Typography variant="body2" color="text.secondary" component="p" sx={{ paddingBlock: 3 }}>
        {emptyLabel}
      </Typography>
    );
  }
  return (
    <Box
      component="dl"
      aria-label={caption}
      data-chart={caption}
      sx={{ margin: 0, display: 'grid', gap: 1.5 }}
    >
      {data.map((datum, index) => {
        const colour = multicolour
          ? tokens[CHART_SERIES_ORDER[index % CHART_SERIES_ORDER.length] ?? 'chart1']
          : tokens.chart1;
        const share = datum.value > 0 ? Math.max((datum.value / peak) * 100, 1.5) : 0;
        return (
          <Box key={datum.key} sx={{ minWidth: 0 }}>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 1.5,
              }}
            >
              <Typography
                component="dt"
                variant="body2"
                sx={{ fontWeight: 600, minWidth: 0, overflowWrap: 'break-word' }}
              >
                {datum.label}
              </Typography>
              <Typography
                component="dd"
                variant="body2"
                sx={{ margin: 0, fontWeight: 600, color: 'text.secondary', whiteSpace: 'nowrap' }}
              >
                <FormattedValue>{datum.display}</FormattedValue>
              </Typography>
            </Box>
            <Box
              aria-hidden
              sx={{
                marginBlockStart: 0.75,
                blockSize: 10,
                borderRadius: 999,
                backgroundColor: tokens.neutralSoft,
                overflow: 'hidden',
              }}
            >
              <Box
                sx={{
                  blockSize: '100%',
                  inlineSize: `${share}%`,
                  backgroundColor: colour,
                  borderRadius: 999,
                }}
              />
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
