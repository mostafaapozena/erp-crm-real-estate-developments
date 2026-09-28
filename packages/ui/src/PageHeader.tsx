import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

/**
 * The title block every screen opens with.
 *
 * It exists so that the `<h1>` is in exactly one place. A product where each screen writes its own
 * heading ends up with two `<h1>`s on some pages and none on others, and a screen reader user then
 * cannot tell where they are.
 *
 * Layout, for a list and for a record alike:
 *
 *     [eyebrow — a reference number, a record type]
 *     Title  [status]                                   [secondary actions] [primary action]
 *     Subtitle
 *     [meta — who, when, where, as a quiet line]
 *     [banner — only for something that genuinely needs full-width attention]
 *
 * Actions sit at the inline **end** so they mirror in RTL without a second layout. A record's status
 * sits **beside** its title as a compact chip rather than in a full-width bar: it is a property of the
 * record, not an alert.
 */
export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** A small line above the title: a human-readable reference, or the kind of record. */
  eyebrow?: ReactNode;
  /** A compact status chip rendered beside the title. */
  status?: ReactNode;
  /** Contextual metadata under the subtitle. */
  meta?: ReactNode;
  /** Rendered under everything: a genuine alert, a demonstration notice. */
  banner?: ReactNode;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
  status,
  meta,
  banner,
}: PageHeaderProps) {
  return (
    <Stack spacing={2} sx={{ marginBlockEnd: 3 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{ alignItems: { md: 'flex-start' }, justifyContent: 'space-between' }}
      >
        <Box sx={{ minWidth: 0 }}>
          {eyebrow ? (
            <Typography
              component="div"
              variant="caption"
              color="text.secondary"
              sx={{ fontWeight: 600, marginBlockEnd: 0.5, display: 'block' }}
            >
              {eyebrow}
            </Typography>
          ) : null}
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1.5 }}>
            <Typography
              variant="h1"
              component="h1"
              sx={{ fontSize: { xs: '1.375rem', md: '1.625rem' }, overflowWrap: 'anywhere' }}
            >
              {title}
            </Typography>
            {status ? <Box sx={{ display: 'inline-flex' }}>{status}</Box> : null}
          </Box>
          {subtitle ? (
            <Typography color="text.secondary" variant="body2" sx={{ marginBlockStart: 0.5 }}>
              {subtitle}
            </Typography>
          ) : null}
          {meta ? (
            <Box
              sx={{
                marginBlockStart: 1,
                display: 'flex',
                flexWrap: 'wrap',
                columnGap: 2,
                rowGap: 0.5,
                color: 'text.secondary',
                typography: 'body2',
              }}
            >
              {meta}
            </Box>
          ) : null}
        </Box>
        {actions ? (
          <Stack
            direction="row"
            sx={{ flexShrink: 0, flexWrap: 'wrap', gap: 1, alignItems: 'flex-start' }}
          >
            {actions}
          </Stack>
        ) : null}
      </Stack>
      {banner}
    </Stack>
  );
}
