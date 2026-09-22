import type { Customer } from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { DataTable, PageHeader, type DataColumn } from '@alola/ui';
import { useMemo, useState, type FormEvent } from 'react';
import { query } from '../api/client';
import { useApi } from '../api/useApi';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { RequirePermission, Verbatim, tableStatus } from './shared';

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
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const customers = useApi<{ items: Customer[] }>(
    `/api/v1/crm/customers${query({ search: submitted })}`,
  );

  const columns = useMemo<DataColumn<Customer>[]>(
    () => [
      { key: 'name', header: t('fields.name'), render: (row) => row.name },
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
      <Stack spacing={2}>
        <Stack
          direction="row"
          spacing={1}
          component="form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            setSubmitted(search.trim());
          }}
        >
          <TextField
            size="small"
            label={t('crm.searchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            sx={{ maxWidth: 360, flexGrow: 1 }}
          />
          <Button type="submit" variant="outlined">
            {t('actions.search')}
          </Button>
        </Stack>

        <DataTable
          columns={columns}
          rows={customers.state.kind === 'ready' ? customers.state.data.items : []}
          rowKey={(row) => row.customerId}
          status={tableStatus(customers.state)}
          caption={t('crm.customersTitle')}
          errorAction={
            <Button variant="contained" onClick={customers.reload}>
              {t('states.retry')}
            </Button>
          }
          labels={{
            loadingTitle: t('states.loadingTitle'),
            emptyTitle: t('states.emptyTitle'),
            emptyDescription: t('states.emptyDescription'),
            errorTitle: t('states.errorTitle'),
            errorDescription: t('states.errorDescription'),
            forbiddenTitle: t('states.forbiddenTitle'),
            forbiddenDescription: t('states.forbiddenDescription'),
          }}
        />
      </Stack>
    </Box>
  );
}
