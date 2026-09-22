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
 * Actions sit at the inline **end** so they mirror in RTL without a second layout.
 */
export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Rendered under the subtitle: a demo notice, a status chip, a warning. */
  banner?: ReactNode;
}

export function PageHeader({ title, subtitle, actions, banner }: PageHeaderProps) {
  return (
    <Stack spacing={2} sx={{ marginBlockEnd: 3 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ alignItems: { sm: 'flex-start' }, justifyContent: 'space-between' }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h1" component="h1" sx={{ fontSize: '1.75rem' }}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography color="text.secondary" sx={{ marginBlockStart: 0.5 }}>
              {subtitle}
            </Typography>
          ) : null}
        </Box>
        {actions ? (
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0, flexWrap: 'wrap', gap: 1 }}>
            {actions}
          </Stack>
        ) : null}
      </Stack>
      {banner}
    </Stack>
  );
}
