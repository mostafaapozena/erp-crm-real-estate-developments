import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import SvgIcon, { type SvgIconProps } from '@mui/material/SvgIcon';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

/**
 * Shared interface states (THEME-010): loading, empty, error, forbidden, success.
 *
 * Text is always passed in by the caller from translation keys — this component owns no user-facing
 * copy. Every state carries an icon **and** text, never color alone (WCAG 1.4.1).
 */
export type StateKind = 'loading' | 'empty' | 'error' | 'forbidden' | 'success';

export interface StateViewProps {
  kind: StateKind;
  title: string;
  description?: string;
  action?: ReactNode;
}

// Material Design icon paths (Apache-2.0).
const ICON_PATHS: Record<Exclude<StateKind, 'loading'>, string> = {
  empty:
    'M19 3H4.99c-1.11 0-1.98.89-1.98 2L3 19c0 1.1.88 2 1.99 2H19c1.1 0 2-.9 2-2V5c0-1.11-.9-2-2-2zm0 12h-4c0 1.66-1.35 3-3 3s-3-1.34-3-3H4.99V5H19v10z',
  error:
    'M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z',
  forbidden:
    'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z',
  success:
    'M16.59 7.58 10 14.17l-3.59-3.58L5 12l5 5 8-8zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z',
};

const ICON_COLOR: Record<Exclude<StateKind, 'loading'>, SvgIconProps['color']> = {
  empty: 'action',
  error: 'error',
  forbidden: 'warning',
  success: 'success',
};

export function StateView({ kind, title, description, action }: StateViewProps) {
  const role = kind === 'error' ? 'alert' : 'status';
  return (
    <Box
      role={role}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
      aria-busy={kind === 'loading' || undefined}
      data-state={kind}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 1,
        paddingBlock: 4,
        paddingInline: 2,
        bgcolor: 'background.paper',
        color: 'text.primary',
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
      }}
    >
      {kind === 'loading' ? (
        <CircularProgress aria-hidden size={32} />
      ) : (
        <SvgIcon aria-hidden color={ICON_COLOR[kind]} sx={{ fontSize: 40 }}>
          <path d={ICON_PATHS[kind]} />
        </SvgIcon>
      )}
      <Typography component="p" variant="subtitle1" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {description ? (
        <Typography component="p" variant="body2" color="text.secondary">
          {description}
        </Typography>
      ) : null}
      {action ? <Box sx={{ marginBlockStart: 1 }}>{action}</Box> : null}
    </Box>
  );
}
