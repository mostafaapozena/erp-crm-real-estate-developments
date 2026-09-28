import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import { FlaskConical, Unplug } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
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
  /** Extra detail rendered under the body, e.g. a connection-status list. */
  children?: ReactNode;
}

export function NotConnectedNotice({ title, body, children }: NotConnectedNoticeProps) {
  return (
    <Alert
      severity="info"
      variant="outlined"
      icon={<Icon icon={Unplug} size={20} />}
      sx={{ borderColor: tokens.info, backgroundColor: tokens.infoSoft, color: tokens.mainText }}
    >
      <AlertTitle sx={{ fontWeight: 700 }}>{title}</AlertTitle>
      {body}
      {children ? <Box sx={{ marginBlockStart: 1 }}>{children}</Box> : null}
    </Alert>
  );
}

/**
 * The compact form, for placing beside a single control or value rather than above a section. It
 * says "simulated / demonstration" in words and with a flask mark, never by colour alone.
 */
export function DemoBadge({ label }: { label: string }) {
  return (
    <Box
      component="span"
      data-demo-badge=""
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        paddingInline: 1,
        paddingBlock: 0.25,
        borderRadius: 999,
        border: 1,
        borderColor: tokens.info,
        color: tokens.info,
        backgroundColor: tokens.infoSoft,
        fontSize: '0.75rem',
        fontWeight: 600,
        lineHeight: 1.5,
        whiteSpace: 'nowrap',
      }}
    >
      <Icon icon={FlaskConical} size={14} />
      {label}
    </Box>
  );
}
