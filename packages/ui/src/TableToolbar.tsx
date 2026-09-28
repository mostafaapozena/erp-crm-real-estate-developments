import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * The strip above a list: what is being searched, what is filtered, how many results, what can be
 * done. Every piece is optional; the order is fixed so every list reads the same way.
 *
 * Active filters are repeated as removable chips. A filter chosen three controls ago is easy to
 * forget, and "why is this list short?" is the question this answers before it is asked.
 */
export interface ActiveFilter {
  key: string;
  label: string;
  onRemove: () => void;
}

export interface TableToolbarProps {
  /** The search field, usually a `<form>` so Enter submits it. */
  search?: ReactNode;
  /** Select controls. */
  filters?: ReactNode;
  /** Buttons at the inline end: export, create. */
  actions?: ReactNode;
  /** "12 results", already formatted. */
  summary?: string;
  activeFilters?: ActiveFilter[];
  /** Label for the "clear all" control and the accessible label prefix of each chip's delete. */
  clearLabel?: string;
  removeLabel?: (filterLabel: string) => string;
  onClearAll?: () => void;
}

export function TableToolbar({
  search,
  filters,
  actions,
  summary,
  activeFilters = [],
  clearLabel,
  removeLabel,
  onClearAll,
}: TableToolbarProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1.5,
        }}
      >
        {search ? <Box sx={{ flex: '1 1 260px', maxWidth: { md: 380 } }}>{search}</Box> : null}
        {filters ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
            {filters}
          </Box>
        ) : null}
        <Box sx={{ flexGrow: 1 }} />
        {summary ? (
          <Typography
            variant="body2"
            color="text.secondary"
            role="status"
            aria-live="polite"
            sx={{ whiteSpace: 'nowrap' }}
          >
            {summary}
          </Typography>
        ) : null}
        {actions ? <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>{actions}</Box> : null}
      </Box>
      {activeFilters.length > 0 ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          {activeFilters.map((filter) => (
            <Chip
              key={filter.key}
              size="small"
              label={filter.label}
              onDelete={filter.onRemove}
              deleteIcon={
                <Box
                  component="span"
                  role="button"
                  aria-label={removeLabel ? removeLabel(filter.label) : filter.label}
                  sx={{ display: 'inline-flex' }}
                >
                  <Icon icon={X} size={14} />
                </Box>
              }
            />
          ))}
          {onClearAll && clearLabel ? (
            <Button size="small" variant="text" onClick={onClearAll}>
              {clearLabel}
            </Button>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
