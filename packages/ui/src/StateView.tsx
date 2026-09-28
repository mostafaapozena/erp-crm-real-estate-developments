import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import type { LucideIcon } from 'lucide-react';
import {
  CircleAlert,
  CircleCheck,
  FlaskConical,
  Inbox,
  Lock,
  SearchX,
  Unplug,
  WifiOff,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { tokens } from './tokens';

/**
 * Shared interface states (THEME-010).
 *
 * Text is always passed in by the caller from translation keys — this component owns no user-facing
 * copy. Every state carries an icon **and** text, never colour alone (WCAG 1.4.1).
 *
 * The kinds are deliberately distinct, because each asks something different of the person reading:
 *
 * - `empty` — nothing exists yet (first use); the action is usually "create the first one".
 * - `noResults` — records exist, but the filters exclude them; the action is "clear the filters".
 * - `error` / `offline` — the request failed; the action is "try again".
 * - `forbidden` — the person may not see this; no action, and no hint of what is behind it.
 * - `notConnected` — a provider is not configured (ADR-0026); never looks like an error.
 * - `simulated` — a demonstration operation; says so, so nobody mistakes it for a real one.
 *
 * `inline` renders without the bordered panel, for a state inside a card that already has one — so
 * a quiet section does not become a large empty box.
 */
export type StateKind =
  | 'loading'
  | 'empty'
  | 'noResults'
  | 'error'
  | 'offline'
  | 'forbidden'
  | 'success'
  | 'notConnected'
  | 'simulated';

export interface StateViewProps {
  kind: StateKind;
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: 'panel' | 'inline';
}

const ICONS: Record<Exclude<StateKind, 'loading'>, LucideIcon> = {
  empty: Inbox,
  noResults: SearchX,
  error: CircleAlert,
  offline: WifiOff,
  forbidden: Lock,
  success: CircleCheck,
  notConnected: Unplug,
  simulated: FlaskConical,
};

/** Icon colour on its soft disc. Each pair is registered in `contrast.ts` as a non-text mark. */
const DISC: Record<Exclude<StateKind, 'loading'>, { fg: string; bg: string }> = {
  empty: { fg: tokens.secondaryText, bg: tokens.neutralSoft },
  noResults: { fg: tokens.secondaryText, bg: tokens.neutralSoft },
  error: { fg: tokens.error, bg: tokens.errorSoft },
  offline: { fg: tokens.error, bg: tokens.errorSoft },
  forbidden: { fg: tokens.warning, bg: tokens.warningSoft },
  success: { fg: tokens.success, bg: tokens.successSoft },
  notConnected: { fg: tokens.info, bg: tokens.infoSoft },
  simulated: { fg: tokens.info, bg: tokens.infoSoft },
};

export function StateView({ kind, title, description, action, variant = 'panel' }: StateViewProps) {
  const alerting = kind === 'error' || kind === 'offline';
  const inline = variant === 'inline';
  return (
    <Box
      role={alerting ? 'alert' : 'status'}
      aria-live={alerting ? 'assertive' : 'polite'}
      aria-busy={kind === 'loading' || undefined}
      data-state={kind}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 1,
        paddingBlock: inline ? 3 : 5,
        paddingInline: 2,
        color: 'text.primary',
        ...(inline
          ? {}
          : {
              bgcolor: 'background.paper',
              border: 1,
              borderColor: tokens.borderSoft,
              borderRadius: 3,
            }),
      }}
    >
      {kind === 'loading' ? (
        <CircularProgress aria-hidden size={28} thickness={4.5} />
      ) : (
        <Box
          aria-hidden
          sx={{
            display: 'grid',
            placeItems: 'center',
            inlineSize: inline ? 40 : 48,
            blockSize: inline ? 40 : 48,
            borderRadius: '50%',
            color: DISC[kind].fg,
            backgroundColor: DISC[kind].bg,
            marginBlockEnd: 0.5,
          }}
        >
          <Icon icon={ICONS[kind]} size={inline ? 20 : 24} />
        </Box>
      )}
      <Typography component="p" variant="subtitle1" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {description ? (
        <Typography
          component="p"
          variant="body2"
          color="text.secondary"
          sx={{ maxInlineSize: '48ch' }}
        >
          {description}
        </Typography>
      ) : null}
      {action ? <Box sx={{ marginBlockStart: 1 }}>{action}</Box> : null}
    </Box>
  );
}
