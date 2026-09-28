import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { ChevronRight } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Icon } from './Icon';
import { StateView } from './StateView';
import { visuallyHidden } from './StatusChip';
import { tokens } from './tokens';

/**
 * One table component, so every list in the product behaves the same way.
 *
 * What it does that a bare `<Table>` does not:
 *
 * - **It owns the interface states.** Loading (skeleton rows, not a spinner that makes the page jump),
 *   empty, no-results, error and forbidden are decided here from one value, so a screen cannot render
 *   a header over a spinner or an empty body with no explanation (THEME-010).
 * - **It frames the list.** An optional toolbar (search, filters, actions, result count) and footer
 *   (count, "show more") sit inside the same surface as the rows, so a list reads as one object.
 * - **It becomes cards below the medium breakpoint.** A twelve-column table on a phone is unusable,
 *   and horizontal scrolling inside an RTL layout is worse. Each row becomes a stack of
 *   label-and-value pairs, which keeps every column readable instead of hiding some of them.
 * - **A clickable row says so.** It is focusable, opens with Enter, and ends in a chevron that points
 *   in the reading direction.
 *
 * `maxHeight` gives the table its own scroll with a sticky header — for a long schedule embedded in a
 * detail page. A full-page list leaves it unset, so the page keeps a single scroll area.
 */
export interface DataColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Hidden on narrow screens in table mode; still shown in the card layout. */
  secondary?: boolean;
  align?: 'start' | 'end';
  width?: number | string;
}

export type DataTableStatus = 'loading' | 'error' | 'forbidden' | 'ready';

export interface DataTableLabels {
  loadingTitle: string;
  loadingDescription?: string;
  emptyTitle: string;
  emptyDescription?: string;
  /** Used instead of the empty labels when `filtered` is true. */
  noResultsTitle?: string;
  noResultsDescription?: string;
  errorTitle: string;
  errorDescription?: string;
  forbiddenTitle: string;
  forbiddenDescription?: string;
}

export interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  status: DataTableStatus;
  /** The accessible name of the table itself. */
  caption: string;
  labels: DataTableLabels;
  onRowClick?: (row: T) => void;
  /** An accessible name for a clickable row, e.g. "Open contract CTR-2026-00001". */
  rowLabel?: (row: T) => string;
  errorAction?: ReactNode;
  emptyAction?: ReactNode;
  /** True when filters are active: an empty result is "no results", not "nothing yet". */
  filtered?: boolean;
  /**
   * How an unfiltered empty list reads. `success` is for a work queue, where an empty list is good
   * news ("nothing needs your attention"), not a missing feature.
   */
  emptyKind?: 'empty' | 'success';
  toolbar?: ReactNode;
  footer?: ReactNode;
  maxHeight?: number | string;
}

const SKELETON_ROWS = 5;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  status,
  caption,
  labels,
  onRowClick,
  rowLabel,
  errorAction,
  emptyAction,
  filtered = false,
  emptyKind = 'empty',
  toolbar,
  footer,
  maxHeight,
}: DataTableProps<T>) {
  const theme = useTheme();
  const isCompact = !useMediaQuery(theme.breakpoints.up('md'));
  const isWide = useMediaQuery(theme.breakpoints.up('lg'));
  const visibleColumns = isWide ? columns : columns.filter((column) => !column.secondary);

  const openOnKey = (row: T) => (event: KeyboardEvent) => {
    if (!onRowClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowClick(row);
    }
  };

  let body: ReactNode;
  if (status === 'error') {
    body = (
      <StateView
        variant="inline"
        kind="error"
        title={labels.errorTitle}
        {...(labels.errorDescription ? { description: labels.errorDescription } : {})}
        {...(errorAction ? { action: errorAction } : {})}
      />
    );
  } else if (status === 'forbidden') {
    body = (
      <StateView
        variant="inline"
        kind="forbidden"
        title={labels.forbiddenTitle}
        {...(labels.forbiddenDescription ? { description: labels.forbiddenDescription } : {})}
      />
    );
  } else if (status === 'ready' && rows.length === 0) {
    const noResults = filtered && labels.noResultsTitle;
    const description = noResults ? labels.noResultsDescription : labels.emptyDescription;
    body = (
      <StateView
        variant="inline"
        kind={noResults ? 'noResults' : emptyKind}
        title={noResults ? (labels.noResultsTitle ?? labels.emptyTitle) : labels.emptyTitle}
        {...(description ? { description } : {})}
        {...(emptyAction ? { action: emptyAction } : {})}
      />
    );
  } else if (status === 'loading') {
    body = (
      <Box role="status" aria-busy="true" aria-live="polite" data-state="loading">
        <Box component="span" sx={visuallyHidden}>
          {labels.loadingTitle}
        </Box>
        <Stack aria-hidden spacing={0} sx={{ paddingInline: 2, paddingBlock: 1 }}>
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <Box
              key={index}
              sx={{
                display: 'flex',
                gap: 2,
                paddingBlock: 1.5,
                borderBlockEnd: index < SKELETON_ROWS - 1 ? 1 : 0,
                borderColor: tokens.borderSoft,
              }}
            >
              <Skeleton variant="text" sx={{ flex: 2 }} />
              <Skeleton variant="text" sx={{ flex: 3 }} />
              <Skeleton variant="text" sx={{ flex: 2 }} />
              <Skeleton variant="text" sx={{ flex: 1 }} />
            </Box>
          ))}
        </Stack>
      </Box>
    );
  } else if (isCompact) {
    body = (
      <Stack component="ul" aria-label={caption} sx={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((row, index) => (
          <Box
            key={rowKey(row)}
            component="li"
            {...(onRowClick
              ? {
                  onClick: () => onRowClick(row),
                  role: 'button',
                  tabIndex: 0,
                  onKeyDown: openOnKey(row),
                  ...(rowLabel ? { 'aria-label': rowLabel(row) } : {}),
                }
              : {})}
            sx={{
              padding: 2,
              borderBlockStart: index === 0 ? 0 : 1,
              borderColor: tokens.borderSoft,
              ...(onRowClick
                ? {
                    cursor: 'pointer',
                    '&:hover': { backgroundColor: tokens.neutralSoft },
                    '&:focus-visible': { outlineOffset: -3 },
                  }
                : {}),
            }}
          >
            <Stack spacing={1}>
              {columns.map((column) => (
                <Box
                  key={column.key}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(6rem, 40%) 1fr',
                    gap: 1,
                    alignItems: 'baseline',
                  }}
                >
                  <Typography variant="body2" color="text.secondary" component="span">
                    {column.header}
                  </Typography>
                  <Box sx={{ minWidth: 0, typography: 'body2' }}>{column.render(row)}</Box>
                </Box>
              ))}
            </Stack>
          </Box>
        ))}
      </Stack>
    );
  } else {
    body = (
      <TableContainer
        sx={maxHeight !== undefined ? { maxHeight, overflowY: 'auto' } : { overflowX: 'auto' }}
      >
        <Table size="small" aria-label={caption} stickyHeader={maxHeight !== undefined}>
          <TableHead>
            <TableRow>
              {visibleColumns.map((column) => (
                <TableCell
                  key={column.key}
                  align={column.align === 'end' ? 'right' : 'left'}
                  sx={column.width ? { width: column.width } : undefined}
                >
                  {column.header}
                </TableCell>
              ))}
              {onRowClick ? (
                <TableCell sx={{ width: 40 }}>
                  <Box component="span" sx={visuallyHidden}>
                    {caption}
                  </Box>
                </TableCell>
              ) : null}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={rowKey(row)}
                hover={Boolean(onRowClick)}
                {...(onRowClick
                  ? {
                      onClick: () => onRowClick(row),
                      tabIndex: 0,
                      onKeyDown: openOnKey(row),
                      ...(rowLabel ? { 'aria-label': rowLabel(row) } : {}),
                      sx: { cursor: 'pointer', '&:focus-visible': { outlineOffset: -3 } },
                    }
                  : {})}
              >
                {visibleColumns.map((column) => (
                  <TableCell key={column.key} align={column.align === 'end' ? 'right' : 'left'}>
                    {column.render(row)}
                  </TableCell>
                ))}
                {onRowClick ? (
                  <TableCell sx={{ width: 40, color: 'text.secondary' }}>
                    <Icon icon={ChevronRight} size={16} mirrorInRtl />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden', minWidth: 0 }} data-table={caption}>
      {toolbar ? (
        <Box
          sx={{
            paddingInline: 2,
            paddingBlock: 1.5,
            borderBlockEnd: 1,
            borderColor: tokens.borderSoft,
          }}
        >
          {toolbar}
        </Box>
      ) : null}
      {body}
      {footer && status === 'ready' && rows.length > 0 ? (
        <Box
          sx={{
            paddingInline: 2,
            paddingBlock: 1.25,
            borderBlockStart: 1,
            borderColor: tokens.borderSoft,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            flexWrap: 'wrap',
            color: 'text.secondary',
            typography: 'body2',
          }}
        >
          {footer}
        </Box>
      ) : null}
    </Paper>
  );
}
