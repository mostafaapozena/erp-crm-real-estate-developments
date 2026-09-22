import type { ReceiptPage } from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { DataTable, PageHeader, type DataColumn } from '@alola/ui';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../api/useApi';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { EnumChip, RECEIPT_TONES, RequirePermission, Verbatim, tableStatus } from './shared';

type Receipt = ReceiptPage['items'][number];

export default function ReceiptsPage() {
  return (
    <RequirePermission permission="collection.receipt.view">
      <ReceiptsScreen />
    </RequirePermission>
  );
}

function ReceiptsScreen() {
  const { t, td } = useLocale();
  const format = useFormatters();
  const navigate = useNavigate();
  const receipts = useApi<ReceiptPage>('/api/v1/collections/receipts?limit=50');

  const columns = useMemo<DataColumn<Receipt>[]>(
    () => [
      {
        key: 'number',
        header: t('collections.receiptNumber'),
        render: (row) => <Verbatim>{row.receiptNumber}</Verbatim>,
      },
      {
        key: 'receivedOn',
        header: t('collections.receivedOn'),
        render: (row) => <Verbatim>{format.date(row.receivedOn)}</Verbatim>,
      },
      {
        key: 'amount',
        header: t('fields.amount'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.amount)}</Verbatim>,
      },
      {
        key: 'method',
        header: t('fields.method'),
        render: (row) => td(`paymentMethod.${row.method}`),
      },
      {
        key: 'allocations',
        header: t('collections.allocations'),
        render: (row) => <Verbatim>{format.number(row.allocations.length)}</Verbatim>,
        secondary: true,
      },
      {
        key: 'state',
        header: t('fields.state'),
        render: (row) => (
          <EnumChip namespace="receiptState" value={row.state} tones={RECEIPT_TONES} />
        ),
      },
    ],
    [format, t, td],
  );

  return (
    <Box>
      <PageHeader
        title={t('collections.receiptsTitle')}
        subtitle={t('collections.receiptsSubtitle')}
      />
      <DataTable
        columns={columns}
        rows={receipts.state.kind === 'ready' ? receipts.state.data.items : []}
        rowKey={(row) => row.receiptId}
        status={tableStatus(receipts.state)}
        caption={t('collections.receiptsTitle')}
        onRowClick={(row) => void navigate(`/receipts/${row.receiptId}`)}
        errorAction={
          <Button variant="contained" onClick={receipts.reload}>
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
    </Box>
  );
}
