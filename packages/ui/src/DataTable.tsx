import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
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
import type { ReactNode } from 'react';
import { StateView } from './StateView';

/**
 * One table component, so every list in the product behaves the same way.
 *
 * Two things it does that a bare `<Table>` does not:
 *
 * - **It owns the five interface states.** Loading, empty, error, forbidden and success are decided
 *   here from one value, so a screen cannot render a header over a spinner or an empty body with no
 *   explanation (THEME-010).
 * - **It becomes cards below the medium breakpoint.** A twelve-column table on a phone is unusable,
 *   and horizontal scrolling inside an RTL layout is worse. Each row becomes a stack of
 *   label-and-value pairs, which keeps every column readable instead of hiding some of them.
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

export interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  status: DataTableStatus;
  /** The accessible name of the table itself. */
  caption: string;
  labels: {
    loadingTitle: string;
    loadingDescription?: string;
    emptyTitle: string;
    emptyDescription?: string;
    errorTitle: string;
    errorDescription?: string;
    forbiddenTitle: string;
    forbiddenDescription?: string;
  };
  onRowClick?: (row: T) => void;
  errorAction?: ReactNode;
  emptyAction?: ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  status,
  caption,
  labels,
  onRowClick,
  errorAction,
  emptyAction,
}: DataTableProps<T>) {
  const theme = useTheme();
  const isCompact = !useMediaQuery(theme.breakpoints.up('md'));

  if (status === 'loading') {
    return (
      <StateView
        kind="loading"
        title={labels.loadingTitle}
        {...(labels.loadingDescription ? { description: labels.loadingDescription } : {})}
      />
    );
  }
  if (status === 'error') {
    return (
      <StateView
        kind="error"
        title={labels.errorTitle}
        {...(labels.errorDescription ? { description: labels.errorDescription } : {})}
        {...(errorAction ? { action: errorAction } : {})}
      />
    );
  }
  if (status === 'forbidden') {
    return (
      <StateView
        kind="forbidden"
        title={labels.forbiddenTitle}
        {...(labels.forbiddenDescription ? { description: labels.forbiddenDescription } : {})}
      />
    );
  }
  if (rows.length === 0) {
    return (
      <StateView
        kind="empty"
        title={labels.emptyTitle}
        {...(labels.emptyDescription ? { description: labels.emptyDescription } : {})}
        {...(emptyAction ? { action: emptyAction } : {})}
      />
    );
  }

  if (isCompact) {
    return (
      <Stack spacing={1.5} component="ul" sx={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((row) => (
          <Paper
            key={rowKey(row)}
            component="li"
            variant="outlined"
            {...(onRowClick
              ? {
                  onClick: () => onRowClick(row),
                  role: 'button',
                  tabIndex: 0,
                  onKeyDown: (event: React.KeyboardEvent) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onRowClick(row);
                    }
                  },
                  sx: { cursor: 'pointer' },
                }
              : {})}
            sx={{ padding: 2 }}
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
                  <Box sx={{ minWidth: 0 }}>{column.render(row)}</Box>
                </Box>
              ))}
            </Stack>
          </Paper>
        ))}
      </Stack>
    );
  }

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" aria-label={caption}>
        <TableHead>
          <TableRow>
            {columns.map((column) => (
              <TableCell
                key={column.key}
                align={column.align === 'end' ? 'right' : 'left'}
                sx={{
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  ...(column.width ? { width: column.width } : {}),
                }}
              >
                {column.header}
              </TableCell>
            ))}
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
                    onKeyDown: (event: React.KeyboardEvent) => {
                      if (event.key === 'Enter') onRowClick(row);
                    },
                    sx: { cursor: 'pointer' },
                  }
                : {})}
            >
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  align={column.align === 'end' ? 'right' : 'left'}
                  sx={{ verticalAlign: 'top' }}
                >
                  {column.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
