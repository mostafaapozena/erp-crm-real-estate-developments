import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { LtrIsolate } from './LtrIsolate';

/**
 * One headline figure.
 *
 * The value is rendered inside `LtrIsolate` because it is almost always a number, a money amount or a
 * count, and those read left-to-right inside Arabic text. Without isolation a figure ending in a
 * currency symbol reorders on screen and shows the wrong number to the person reading it.
 *
 * `loading` renders a skeleton of the same height rather than collapsing, so a dashboard does not
 * jump as each card resolves.
 */
export interface MetricCardProps {
  label: string;
  value?: string;
  hint?: string;
  loading?: boolean;
  icon?: ReactNode;
  /** A secondary figure under the main one, e.g. a comparison or a subtotal. */
  footnote?: string;
  tone?: 'default' | 'attention';
}

export function MetricCard({
  label,
  value,
  hint,
  loading,
  icon,
  footnote,
  tone = 'default',
}: MetricCardProps) {
  return (
    <Paper
      variant="outlined"
      sx={{
        padding: 2.5,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        // An attention card is marked by a thicker inline-start edge, which mirrors in RTL and does
        // not depend on colour alone.
        ...(tone === 'attention'
          ? { borderInlineStartWidth: 4, borderInlineStartColor: 'warning.main' }
          : {}),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {icon ? <Box sx={{ display: 'flex', color: 'text.secondary' }}>{icon}</Box> : null}
        <Typography variant="body2" color="text.secondary" component="p">
          {label}
        </Typography>
      </Box>
      {loading ? (
        <Skeleton variant="text" sx={{ fontSize: '2rem', width: '60%' }} />
      ) : (
        <Typography variant="h3" component="p" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
          <LtrIsolate>{value ?? '—'}</LtrIsolate>
        </Typography>
      )}
      {hint ? (
        <Typography variant="caption" color="text.secondary" component="p">
          {hint}
        </Typography>
      ) : null}
      {footnote ? (
        <Typography
          variant="caption"
          color="text.secondary"
          component="p"
          sx={{ marginBlockStart: 'auto' }}
        >
          <LtrIsolate>{footnote}</LtrIsolate>
        </Typography>
      ) : null}
    </Paper>
  );
}
