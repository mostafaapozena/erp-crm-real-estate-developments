import Chip from '@mui/material/Chip';
import SvgIcon from '@mui/material/SvgIcon';
import { tokens } from './tokens';

/**
 * A status, conveyed by **text and shape**, never by colour alone (WCAG 1.4.1).
 *
 * Every chip carries its label — the caller passes it from a translation key — and a small icon whose
 * outline differs per tone. Someone who cannot distinguish the greens from the ambers still reads the
 * word and sees a different mark, which is the point: on a units table the difference between
 * "available" and "reserved" decides whether a unit gets sold twice.
 */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface StatusChipProps {
  tone: StatusTone;
  label: string;
  size?: 'small' | 'medium';
  /** Rendered before the label for screen readers, e.g. "Status:". */
  srPrefix?: string;
}

/** Distinct shapes, not just distinct hues: a dot, an arrow, a tick, a bar, a cross. */
const ICON_PATHS: Record<StatusTone, string> = {
  neutral: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  info: 'M12 4 4 12l8 8 1.4-1.4L7.8 13H20v-2H7.8l5.6-5.6z',
  success: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  warning: 'M4 10h16v4H4z',
  danger:
    'M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
};

const PALETTE: Record<StatusTone, { fg: string; bg: string; border: string }> = {
  neutral: { fg: tokens.mainText, bg: tokens.pageBackground, border: tokens.borderStrong },
  info: { fg: tokens.info, bg: tokens.infoSoft, border: tokens.info },
  success: { fg: tokens.success, bg: tokens.successSoft, border: tokens.success },
  warning: { fg: tokens.warning, bg: tokens.warningSoft, border: tokens.warning },
  danger: { fg: tokens.error, bg: tokens.errorSoft, border: tokens.error },
};

export function StatusChip({ tone, label, size = 'small', srPrefix }: StatusChipProps) {
  const palette = PALETTE[tone];
  return (
    <Chip
      size={size}
      variant="outlined"
      data-tone={tone}
      icon={
        <SvgIcon aria-hidden sx={{ fontSize: 16, color: `${palette.fg} !important` }}>
          <path d={ICON_PATHS[tone]} />
        </SvgIcon>
      }
      label={srPrefix ? `${srPrefix} ${label}` : label}
      sx={{
        color: palette.fg,
        backgroundColor: palette.bg,
        borderColor: palette.border,
        fontWeight: 600,
        '& .MuiChip-label': { paddingInline: 1 },
      }}
    />
  );
}
