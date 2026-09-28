import type { Customer } from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { DataTable, PageHeader, TableToolbar, type DataColumn } from '@alola/ui';
import { useMemo, useState } from 'react';
import { query } from '../api/client';
import { useApi } from '../api/useApi';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { ListSearch, RequirePermission, Verbatim, tableStatus, useTableLabels } from './shared';

/**
 * Customers within the actor's scope. The customer endpoint returns one bounded list (no cursor),
 * so the count shown is the length of that answer.
 */
export default function CustomersPage() {
  return (
    <RequirePermission permission="crm.customer.view">
      <CustomersScreen />
    </RequirePermission>
  );
}

function CustomersScreen() {
  const { t } = useLocale();
  const format = useFormatters();
  const labels = useTableLabels();
  const [search, setSearch] = useState('');
  const customers = useApi<{ items: Customer[] }>(`/api/v1/crm/customers${query({ search })}`);
  const rows = customers.state.kind === 'ready' ? customers.state.data.items : [];

  const columns = useMemo<DataColumn<Customer>[]>(
    () => [
      {
        key: 'name',
        header: t('fields.name'),
        render: (row) => (
          <Box component="span" sx={{ fontWeight: 600 }}>
            {row.name}
          </Box>
        ),
      },
      {
        key: 'phone',
        header: t('fields.phone'),
        render: (row) => <Verbatim>{row.primaryPhone}</Verbatim>,
      },
      {
        key: 'email',
        header: t('fields.email'),
        render: (row) => (row.email ? <Verbatim>{row.email}</Verbatim> : '—'),
        secondary: true,
      },
      {
        key: 'createdAt',
        header: t('fields.createdAt'),
        render: (row) => <Verbatim>{format.date(row.createdAt.slice(0, 10))}</Verbatim>,
        secondary: true,
      },
    ],
    [format, t],
  );

  return (
    <Box>
      <PageHeader title={t('crm.customersTitle')} subtitle={t('crm.customersSubtitle')} />
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.customerId}
        status={tableStatus(customers.state)}
        caption={t('crm.customersTitle')}
        filtered={search !== ''}
        errorAction={
          <Button variant="contained" onClick={customers.reload}>
            {t('states.retry')}
          </Button>
        }
        labels={labels}
        toolbar={
          <TableToolbar
            search={
              <ListSearch value={search} onSubmit={setSearch} label={t('crm.searchPlaceholder')} />
            }
            activeFilters={
              search
                ? [
                    {
                      key: 'search',
                      label: `${t('actions.search')}: ${search}`,
                      onRemove: () => setSearch(''),
                    },
                  ]
                : []
            }
            removeLabel={(label) => t('filters.remove', { label })}
            {...(customers.state.kind === 'ready'
              ? {
                  summary: t('pagination.showing', {
                    shown: format.number(rows.length),
                    total: format.number(rows.length),
                  }),
                }
              : {})}
          />
        }
      />
    </Box>
  );
}
