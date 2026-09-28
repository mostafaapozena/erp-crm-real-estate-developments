import Box from '@mui/material/Box';
import type { LucideIcon } from 'lucide-react';
import { CircleCheck, CircleDot, CircleX, Info, TriangleAlert } from 'lucide-react';
import { Icon } from './Icon';
import { tokens } from './tokens';

/**
 * A status, conveyed by **text and shape**, never by colour alone (WCAG 1.4.1).
 *
 * Every chip carries its label — the caller passes it from a translation key — and a small icon whose
 * outline differs per tone. Someone who cannot distinguish the greens from the ambers still reads the
 * word and sees a different mark, which is the point: on a units table the difference between
 * "available" and "reserved" decides whether a unit gets sold twice.
 *
 * Compact by design: a soft fill with the status colour as text, sized to sit inside a table row or
 * beside a heading. A status is a property of a record, not an alarm, so it is never a full-width bar.
 */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface StatusChipProps {
  tone: StatusTone;
  label: string;
  size?: 'small' | 'medium';
  /** Rendered before the label for screen readers, e.g. "Status:". */
  srPrefix?: string;
}

/** Distinct shapes, not just distinct hues: a dot, an "i", a tick, a triangle, a cross. */
export const STATUS_ICONS: Record<StatusTone, LucideIcon> = {
  neutral: CircleDot,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
};

/** Every pair here is in the contrast registry (`contrast.ts`) at text strength. */
export const STATUS_PALETTE: Record<StatusTone, { fg: string; bg: string }> = {
  neutral: { fg: tokens.mainText, bg: tokens.neutralSoft },
  info: { fg: tokens.info, bg: tokens.infoSoft },
  success: { fg: tokens.success, bg: tokens.successSoft },
  warning: { fg: tokens.warning, bg: tokens.warningSoft },
  danger: { fg: tokens.error, bg: tokens.errorSoft },
};

export function StatusChip({ tone, label, size = 'small', srPrefix }: StatusChipProps) {
  const palette = STATUS_PALETTE[tone];
  const small = size === 'small';
  return (
    <Box
      component="span"
      data-tone={tone}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        maxWidth: '100%',
        paddingInline: small ? 1 : 1.25,
        paddingBlock: small ? 0.25 : 0.5,
        borderRadius: 999,
        color: palette.fg,
        backgroundColor: palette.bg,
        fontSize: small ? '0.75rem' : '0.8125rem',
        fontWeight: 600,
        lineHeight: 1.5,
        whiteSpace: 'nowrap',
        verticalAlign: 'middle',
      }}
    >
      <Icon icon={STATUS_ICONS[tone]} size={small ? 14 : 16} />
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {srPrefix ? (
          <Box component="span" sx={visuallyHidden}>
            {`${srPrefix} `}
          </Box>
        ) : null}
        {label}
      </Box>
    </Box>
  );
}

/** Present to assistive technology, absent from the screen. */
export const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;
