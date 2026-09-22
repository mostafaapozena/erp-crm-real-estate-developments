import type { ContractPage } from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { DataTable, PageHeader, type DataColumn } from '@alola/ui';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../api/useApi';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { CONTRACT_TONES, EnumChip, RequirePermission, Verbatim, tableStatus } from './shared';

type Contract = ContractPage['items'][number];

export default function ContractsPage() {
  return (
    <RequirePermission permission="sales.contract.view">
      <ContractsScreen />
    </RequirePermission>
  );
}

function ContractsScreen() {
  const { t } = useLocale();
  const format = useFormatters();
  const navigate = useNavigate();
  const contracts = useApi<ContractPage>('/api/v1/sales/contracts?limit=50');

  const columns = useMemo<DataColumn<Contract>[]>(
    () => [
      {
        key: 'number',
        header: t('sales.contractNumber'),
        render: (row) => <Verbatim>{row.contractNumber}</Verbatim>,
      },
      {
        key: 'date',
        header: t('sales.contractedOn'),
        render: (row) => <Verbatim>{format.date(row.contractedOn)}</Verbatim>,
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
        rows={contracts.state.kind === 'ready' ? contracts.state.data.items : []}
        rowKey={(row) => row.contractId}
        status={tableStatus(contracts.state)}
        caption={t('sales.contractsTitle')}
        onRowClick={(row) => void navigate(`/contracts/${row.contractId}`)}
        errorAction={
          <Button variant="contained" onClick={contracts.reload}>
            {t('states.retry')}
          </Button>
        }
        labels={{
          loadingTitle: t('states.loadingTitle'),
          loadingDescription: t('states.loadingDescription'),
          emptyTitle: t('states.emptyTitle'),
          emptyDescription: t('states.emptyDescription'),
          errorTitle: t('states.errorTitle'),
          errorDescription: t('states.errorDescription'),
          forbiddenTitle: t('states.forbiddenTitle'),
          forbiddenDescription: t('states.forbiddenDescription'),
        }}
      />
    </Box>
  );
}
