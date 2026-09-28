import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { FormattedValue, tokens } from '@alola/ui';

/**
 * A single proportion as a labelled meter — "collected of contracted". A progress bar with its value
 * in words and in `aria-valuetext`, because one ratio does not need a chart. It has no charting
 * dependency, so it renders with the page rather than waiting for the chart chunk.
 */
export function RatioMeter({
  label,
  value,
  display,
  tone = 'primary',
}: {
  label: string;
  /** 0–1. */
  value: number;
  display: string;
  tone?: 'primary' | 'success' | 'warning';
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const colour =
    tone === 'success' ? tokens.success : tone === 'warning' ? tokens.warning : tokens.chart1;
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, marginBlockEnd: 0.75 }}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          <FormattedValue>{display}</FormattedValue>
        </Typography>
      </Box>
      <Box
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped * 100)}
        aria-valuetext={display}
        sx={{
          blockSize: 8,
          borderRadius: 999,
          backgroundColor: tokens.neutralSoft,
          overflow: 'hidden',
          border: 1,
          borderColor: tokens.borderSubtle,
        }}
      >
        <Box
          sx={{
            blockSize: '100%',
            inlineSize: `${clamped * 100}%`,
            backgroundColor: colour,
            borderRadius: 999,
          }}
        />
      </Box>
    </Box>
  );
}
