import { CONTRACT_STATES, type ContractPage } from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { DataTable, PageHeader, TableToolbar, type DataColumn } from '@alola/ui';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { query } from '../api/client';
import { usePagedList } from '../api/usePagedList';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { PersonName } from '../people';
import {
  CONTRACT_TONES,
  EnumChip,
  FilterSelect,
  ListFooter,
  RequirePermission,
  Verbatim,
  tableStatus,
  useTableLabels,
} from './shared';

type Contract = ContractPage['items'][number];

/**
 * The contract register: every contract in the actor's scope, filterable by state, paged by the
 * server's cursor. Money is the server's decimal string, formatted — never summed here.
 */
export default function ContractsPage() {
  return (
    <RequirePermission permission="sales.contract.view">
      <ContractsScreen />
    </RequirePermission>
  );
}

function ContractsScreen() {
  const { t, td } = useLocale();
  const format = useFormatters();
  const navigate = useNavigate();
  const labels = useTableLabels();
  const [state, setState] = useState('');
  const contracts = usePagedList<Contract>(`/api/v1/sales/contracts${query({ limit: 50, state })}`);

  const columns = useMemo<DataColumn<Contract>[]>(
    () => [
      {
        key: 'number',
        header: t('sales.contractNumber'),
        render: (row) => (
          <Box component="span" sx={{ fontWeight: 600 }}>
            <Verbatim>{row.contractNumber}</Verbatim>
          </Box>
        ),
      },
      {
        key: 'date',
        header: t('sales.contractedOn'),
        render: (row) => <Verbatim>{format.date(row.contractedOn)}</Verbatim>,
      },
      {
        key: 'owner',
        header: t('sales.salesOwner'),
        render: (row) => <PersonName accountId={row.salesOwnerAccountId} />,
        secondary: true,
      },
      {
        key: 'total',
        header: t('sales.totalPrice'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.totalPrice)}</Verbatim>,
      },
      {
        key: 'paid',
        header: t('sales.paidAmount'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.paidAmount)}</Verbatim>,
      },
      {
        key: 'outstanding',
        header: t('sales.outstandingAmount'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.outstandingAmount)}</Verbatim>,
      },
      {
        key: 'state',
        header: t('fields.state'),
        render: (row) => (
          <EnumChip namespace="contractState" value={row.state} tones={CONTRACT_TONES} />
        ),
      },
    ],
    [format, t],
  );

  return (
    <Box>
      <PageHeader title={t('sales.contractsTitle')} subtitle={t('sales.contractsSubtitle')} />
      <DataTable
        columns={columns}
        rows={contracts.items}
        rowKey={(row) => row.contractId}
        rowLabel={(row) => t('list.open', { label: row.contractNumber })}
        status={tableStatus(contracts.state)}
        caption={t('sales.contractsTitle')}
        filtered={state !== ''}
        onRowClick={(row) => void navigate(`/contracts/${row.contractId}`)}
        errorAction={
          <Button variant="contained" onClick={contracts.reload}>
            {t('states.retry')}
          </Button>
        }
        labels={labels}
        toolbar={
          <TableToolbar
            filters={
              <FilterSelect
                label={t('fields.state')}
                value={state}
                onChange={setState}
                options={CONTRACT_STATES.map((value) => ({
                  value,
                  label: td(`contractState.${value}`),
                }))}
              />
            }
            activeFilters={
              state
                ? [
                    {
                      key: 'state',
                      label: `${t('fields.state')}: ${td(`contractState.${state}`)}`,
                      onRemove: () => setState(''),
                    },
                  ]
                : []
            }
            removeLabel={(label) => t('filters.remove', { label })}
          />
        }
        footer={
          <ListFooter
            shown={contracts.items.length}
            total={contracts.total}
            hasMore={contracts.hasMore}
            loadingMore={contracts.loadingMore}
            onLoadMore={contracts.loadMore}
            error={contracts.moreError}
          />
        }
      />
    </Box>
  );
}
