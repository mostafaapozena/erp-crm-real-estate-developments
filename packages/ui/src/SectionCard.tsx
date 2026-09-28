import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { tokens } from './tokens';

/**
 * A titled surface: the one card shape every detail section, chart and dashboard panel uses.
 *
 * The header and body are separated by a hairline, so the title reads as the label of what is below
 * it. `flush` removes the body padding for content that brings its own edges (a table, a list).
 * `headingLevel` defaults to 2 because a section sits directly under the page's `<h1>`.
 */
export interface SectionCardProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  headingLevel?: 2 | 3;
  /** Stretches to the height of its grid row, so cards side by side line up. */
  fill?: boolean;
  id?: string;
}

export function SectionCard({
  title,
  description,
  icon,
  actions,
  children,
  flush = false,
  headingLevel = 2,
  fill = false,
  id,
}: SectionCardProps) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <Paper
      variant="outlined"
      component="section"
      {...(headingId ? { 'aria-labelledby': headingId, id } : {})}
      sx={{
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        ...(fill ? { height: '100%' } : {}),
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          paddingInline: { xs: 2, sm: 2.5 },
          paddingBlock: 1.75,
          borderBlockEnd: 1,
          borderColor: tokens.borderSoft,
        }}
      >
        {icon ? (
          <Box sx={{ color: 'text.secondary', display: 'inline-flex' }}>
            <Icon icon={icon} size={18} />
          </Box>
        ) : null}
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography
            id={headingId}
            component={headingLevel === 2 ? 'h2' : 'h3'}
            sx={{ fontSize: '1rem', fontWeight: 600, lineHeight: 1.5 }}
          >
            {title}
          </Typography>
          {description ? (
            <Typography variant="caption" color="text.secondary" component="p">
              {description}
            </Typography>
          ) : null}
        </Box>
        {actions ? (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexShrink: 0 }}>{actions}</Box>
        ) : null}
      </Box>
      <Box sx={{ flexGrow: 1, minWidth: 0, ...(flush ? {} : { padding: { xs: 2, sm: 2.5 } }) }}>
        {children}
      </Box>
    </Paper>
  );
}
