import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Chip from '@mui/material/Chip';
import SvgIcon from '@mui/material/SvgIcon';
import { tokens } from './tokens';

/**
 * The marker for a capability that is **not connected** (ADR-0026).
 *
 * It is a component rather than a comment on a screen because the boundary has to survive editing.
 * Anyone adding a control to a provider-dependent screen sees this sitting above it; a footnote in a
 * document does not travel that way, and a screenshot of a screen without one travels very well.
 *
 * All text is passed in from translation keys, so the notice cannot appear in one language only.
 */
export interface NotConnectedNoticeProps {
  title: string;
  body: string;
  /** A short badge repeated next to the individual controls, e.g. "Demo mode". */
  badgeLabel?: string;
}

export function NotConnectedNotice({ title, body }: NotConnectedNoticeProps) {
  return (
    <Alert
      severity="info"
      variant="outlined"
      icon={
        <SvgIcon aria-hidden>
          <path d="M11 7h2v6h-2zm0 8h2v2h-2zm1-13C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
        </SvgIcon>
      }
      sx={{ borderColor: tokens.info, backgroundColor: tokens.infoSoft, color: tokens.mainText }}
    >
      <AlertTitle sx={{ fontWeight: 700 }}>{title}</AlertTitle>
      {body}
    </Alert>
  );
}

/** The compact form, for placing beside a single control rather than above a section. */
export function DemoBadge({ label }: { label: string }) {
  return (
    <Chip
      size="small"
      label={label}
      variant="outlined"
      sx={{
        color: tokens.info,
        borderColor: tokens.info,
        backgroundColor: tokens.infoSoft,
        fontWeight: 600,
      }}
    />
  );
}
