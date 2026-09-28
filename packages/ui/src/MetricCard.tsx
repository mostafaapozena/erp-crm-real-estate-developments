import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight } from 'lucide-react';
import type { ElementType, ReactNode } from 'react';
import { Icon } from './Icon';
import { FormattedValue } from './FormattedValue';
import { tokens } from './tokens';

/**
 * One headline figure (a KPI).
 *
 * The value is rendered inside `FormattedValue` because it is almost always a number, a money amount or a
 * count, and those read left-to-right inside Arabic text. Without isolation a figure ending in a
 * currency symbol reorders on screen and shows the wrong number to the person reading it.
 *
 * `loading` renders a skeleton of the same height rather than collapsing, so a dashboard does not
 * jump as each card resolves.
 *
 * **No colour per card.** Every card shares one neutral treatment; the only tones are `attention`
 * (something is overdue or needs a decision) and `positive`, and each is carried by an inline-start
 * edge and the icon disc, never by colour alone. A dashboard where every card is a different colour
 * has no way left to say "this one matters".
 *
 * There is no trend arrow unless the caller has a real comparison to show — a trend is never invented.
 */
export interface MetricCardProps {
  label: string;
  value?: string;
  /** One line of context under the value — text, or text with a `FormattedValue` inside. */
  hint?: ReactNode;
  loading?: boolean;
  /** A glyph from `@alola/ui/icons`. */
  icon?: LucideIcon | ReactNode;
  /** A secondary figure under the main one, e.g. a comparison or a subtotal. */
  footnote?: string;
  tone?: 'default' | 'attention' | 'positive';
  /** Makes the card lead to the filtered list behind the figure. */
  link?: { component: ElementType; to: string; label: string };
}

const TONE: Record<
  NonNullable<MetricCardProps['tone']>,
  { fg: string; bg: string; edge?: string }
> = {
  default: { fg: tokens.primary, bg: tokens.primarySoft },
  attention: { fg: tokens.warning, bg: tokens.warningSoft, edge: tokens.warning },
  positive: { fg: tokens.success, bg: tokens.successSoft, edge: tokens.success },
};

function isGlyph(value: unknown): value is LucideIcon {
  return (
    typeof value === 'function' ||
    (typeof value === 'object' && value !== null && '$$typeof' in value && 'render' in value)
  );
}

export function MetricCard({
  label,
  value,
  hint,
  loading,
  icon,
  footnote,
  tone = 'default',
  link,
}: MetricCardProps) {
  const colours = TONE[tone];
  return (
    <Paper
      variant="outlined"
      data-metric={tone}
      sx={{
        padding: 2.5,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        minWidth: 0,
        ...(colours.edge
          ? { borderInlineStartWidth: 4, borderInlineStartColor: colours.edge }
          : {}),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
        <Typography
          variant="body2"
          color="text.secondary"
          component="p"
          sx={{ fontWeight: 600, flexGrow: 1, minWidth: 0 }}
        >
          {label}
        </Typography>
        {icon ? (
          <Box
            aria-hidden
            sx={{
              display: 'grid',
              placeItems: 'center',
              inlineSize: 36,
              blockSize: 36,
              borderRadius: 2,
              flexShrink: 0,
              color: colours.fg,
              backgroundColor: colours.bg,
            }}
          >
            {isGlyph(icon) ? <Icon icon={icon} size={20} /> : icon}
          </Box>
        ) : null}
      </Box>
      {loading ? (
        <Skeleton variant="text" sx={{ fontSize: '1.75rem', width: '60%' }} />
      ) : (
        <Typography
          component="p"
          sx={{
            // A long money figure ("3,965,368.96 ج.م.") steps down a size instead of breaking: a
            // figure split across lines, or a currency's final period on its own line, misreads.
            fontSize:
              // Every money figure is longer than 10 characters, so all money in a row shares one
              // size and short counts keep the large one.
              (value?.length ?? 0) > 10
                ? { xs: '1.125rem', md: '1.25rem' }
                : { xs: '1.375rem', md: '1.625rem' },
            fontWeight: 700,
            lineHeight: 1.25,
            overflowWrap: 'normal',
            // Separate currencies (" · ") may wrap between figures, never inside one.
            '& bdi': { whiteSpace: 'nowrap' },
            ...((value?.includes(' · ') ?? false) ? { '& bdi': { whiteSpace: 'normal' } } : {}),
          }}
        >
          <FormattedValue>{value ?? '—'}</FormattedValue>
        </Typography>
      )}
      {hint ? (
        <Typography variant="caption" color="text.secondary" component="p">
          {hint}
        </Typography>
      ) : null}
      {footnote ? (
        <Typography variant="caption" color="text.secondary" component="p">
          <FormattedValue>{footnote}</FormattedValue>
        </Typography>
      ) : null}
      {link ? (
        <Link
          component={link.component}
          to={link.to}
          underline="hover"
          sx={{
            marginBlockStart: 'auto',
            paddingBlockStart: 0.5,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            fontSize: '0.8125rem',
            fontWeight: 600,
            alignSelf: 'flex-start',
          }}
        >
          {link.label}
          <Icon icon={ArrowRight} size={14} mirrorInRtl />
        </Link>
      ) : null}
    </Paper>
  );
}
