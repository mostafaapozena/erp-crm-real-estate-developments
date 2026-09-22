import type { Contract, CustomerFinancialSummary, Installment, Receipt } from '@alola/contracts';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DataTable, MetricCard, PageHeader, StateView, type DataColumn } from '@alola/ui';
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { apiRequest } from '../api/client';
import { useSession } from '../api/session';
import { useApi, useIdempotencyKey, useMutation } from '../api/useApi';
import { useErrorMessage } from '../errors';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import {
  CONTRACT_TONES,
  CardGrid,
  EnumChip,
  ErrorState,
  Field,
  INSTALLMENT_TONES,
  Panel,
  RequirePermission,
  Verbatim,
  tableStatus,
} from './shared';

const METHODS = ['cash', 'bankTransfer', 'card', 'cheque', 'promissoryNote'] as const;

/**
 * One contract: its totals, its full schedule, and the place a collection is recorded.
 *
 * Recording a payment from here rather than from a separate screen is deliberate — the person doing
 * it is looking at the balance they are about to change, and the allocation is shown immediately
 * afterwards rather than being something they have to go and verify.
 */
export default function ContractDetailPage() {
  return (
    <RequirePermission permission="sales.contract.view">
      <ContractDetailScreen />
    </RequirePermission>
  );
}

function ContractDetailScreen() {
  const { contractId } = useParams<{ contractId: string }>();
  const { t, td } = useLocale();
  const { can } = useSession();
  const format = useFormatters();
  const navigate = useNavigate();
  const [payOpen, setPayOpen] = useState(false);

  const contract = useApi<Contract>(
    contractId ? `/api/v1/sales/contracts/${contractId}` : undefined,
  );
  const installments = useApi<{ items: Installment[] }>(
    contractId ? `/api/v1/sales/contracts/${contractId}/installments` : undefined,
  );
  const data = contract.state.kind === 'ready' ? contract.state.data : undefined;
  const summary = useApi<CustomerFinancialSummary>(
    data && can('sales.contract.view')
      ? `/api/v1/sales/customers/${data.customerId}/summary`
      : undefined,
  );

  const columns = useMemo<DataColumn<Installment>[]>(
    () => [
      {
        key: 'sequence',
        header: t('fields.sequence'),
        render: (row) => <Verbatim>{format.number(row.sequence)}</Verbatim>,
        width: 64,
      },
      {
        key: 'kind',
        header: t('installmentKind.installment'),
        render: (row) => td(`installmentKind.${row.kind}`),
      },
      {
        key: 'dueOn',
        header: t('fields.dueDate'),
        render: (row) => <Verbatim>{format.date(row.dueOn)}</Verbatim>,
      },
      {
        key: 'amount',
        header: t('fields.amount'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.amount)}</Verbatim>,
      },
      {
        key: 'paid',
        header: t('fields.paid'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.paidAmount)}</Verbatim>,
      },
      {
        key: 'remaining',
        header: t('fields.remaining'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.remainingAmount)}</Verbatim>,
      },
      {
        key: 'state',
        header: t('fields.state'),
        render: (row) => (
          <EnumChip namespace="installmentState" value={row.state} tones={INSTALLMENT_TONES} />
        ),
      },
    ],
    [format, t, td],
  );

  if (contract.state.kind === 'loading') {
    return <StateView kind="loading" title={t('states.loadingTitle')} />;
  }
  if (contract.state.kind === 'error') {
    return <ErrorState error={contract.state.error} onRetry={contract.reload} />;
  }
  const record = contract.state.data;
  const summaryData = summary.state.kind === 'ready' ? summary.state.data : undefined;

  return (
    <Box>
      <PageHeader
        title={record.contractNumber}
        subtitle={t('sales.contractsSubtitle')}
        banner={<EnumChip namespace="contractState" value={record.state} tones={CONTRACT_TONES} />}
        actions={
          <>
            {can('collection.receipt.create') && record.state === 'active' ? (
              <Button variant="contained" onClick={() => setPayOpen(true)}>
                {t('actions.recordPayment')}
              </Button>
            ) : null}
            <Button variant="outlined" onClick={() => window.print()}>
              {t('sales.printContract')}
            </Button>
          </>
        }
      />

      <Stack spacing={3}>
        <CardGrid min={200}>
          <MetricCard label={t('sales.totalPrice')} value={format.money(record.totalPrice)} />
          <MetricCard label={t('sales.paidAmount')} value={format.money(record.paidAmount)} />
          <MetricCard
            label={t('sales.outstandingAmount')}
            value={format.money(record.outstandingAmount)}
            tone={Number(record.outstandingAmount.amount) > 0 ? 'attention' : 'default'}
          />
          {summaryData ? (
            <MetricCard
              label={t('collections.overdueAmount')}
              value={format.money(summaryData.overdueAmount)}
              hint={`${format.number(summaryData.overdueCount)}`}
              tone={summaryData.overdueCount > 0 ? 'attention' : 'default'}
            />
          ) : null}
        </CardGrid>

        <Panel title={t('sales.paymentPlan')}>
          <CardGrid min={180}>
            <Field label={t('sales.contractedOn')}>
              <Verbatim>{format.date(record.contractedOn)}</Verbatim>
            </Field>
            <Field label={t('sales.downPayment')}>
              <Verbatim>{format.money(record.paymentPlan.downPayment)}</Verbatim>
            </Field>
            <Field label={t('sales.installmentCount')}>
              <Verbatim>{format.number(record.paymentPlan.installmentCount)}</Verbatim>
            </Field>
            <Field label={t('sales.frequency')}>
              {td(`frequency.${record.paymentPlan.frequency}`)}
            </Field>
            <Field label={t('sales.reservationAmount')}>
              <Verbatim>{format.money(record.reservationAmount)}</Verbatim>
            </Field>
          </CardGrid>
        </Panel>

        <Panel title={t('sales.schedule')}>
          <DataTable
            columns={columns}
            rows={installments.state.kind === 'ready' ? installments.state.data.items : []}
            rowKey={(row) => row.installmentId}
            status={tableStatus(installments.state)}
            caption={t('sales.schedule')}
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
        </Panel>

        <Alert severity="info" variant="outlined">
          <Typography sx={{ fontWeight: 600 }}>{t('sales.demoDocumentTitle')}</Typography>
          {t('sales.demoDocumentBody')}
        </Alert>
      </Stack>

      {payOpen ? (
        <RecordPaymentDialog
          contract={record}
          onClose={() => setPayOpen(false)}
          onRecorded={(receiptId) => {
            setPayOpen(false);
            void navigate(`/receipts/${receiptId}`);
          }}
        />
      ) : null}
    </Box>
  );
}

function RecordPaymentDialog({
  contract,
  onClose,
  onRecorded,
}: {
  contract: Contract;
  onClose: () => void;
  onRecorded: (receiptId: string) => void;
}) {
  const { t, td } = useLocale();
  const errorMessage = useErrorMessage();
  const [amount, setAmount] = useState<string>(contract.outstandingAmount.amount);
  const [method, setMethod] = useState<(typeof METHODS)[number]>('bankTransfer');
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10));
  const [depositReference, setDepositReference] = useState('');

  /** One key per dialog, so a double submission records one receipt rather than two. */
  const idempotencyKey = useIdempotencyKey(`receipt-${contract.contractId}`);

  const record = useMutation<void, Receipt>(() =>
    apiRequest<Receipt>('/api/v1/collections/receipts', {
      method: 'POST',
      body: {
        contractId: contract.contractId,
        amount: { amount, currency: contract.totalPrice.currency },
        method,
        receivedOn,
        ...(depositReference.trim() ? { depositReference: depositReference.trim() } : {}),
        idempotencyKey: idempotencyKey(),
      },
    }),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const receipt = await record.run();
      onRecorded(receipt.receiptId);
    } catch {
      /* rendered from record.error */
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={(event) => void submit(event)} noValidate>
        <DialogTitle>{t('collections.recordPaymentTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ marginBlockStart: 1 }}>
            {record.error ? (
              <Alert severity="error" role="alert">
                {errorMessage(record.error)}
              </Alert>
            ) : null}
            <Alert severity="info" variant="outlined">
              {t('collections.allocateAutomatically')}
            </Alert>
            <TextField
              label={t('collections.paymentAmount')}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
              autoFocus
              helperText={t('collections.overAllocationHint')}
              slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'decimal' } }}
            />
            <TextField
              select
              label={t('collections.paymentMethod')}
              value={method}
              onChange={(event) => setMethod(event.target.value as (typeof METHODS)[number])}
            >
              {METHODS.map((value) => (
                <MenuItem key={value} value={value}>
                  {td(`paymentMethod.${value}`)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label={t('collections.receivedOn')}
              type="date"
              value={receivedOn}
              onChange={(event) => setReceivedOn(event.target.value)}
              required
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label={t('collections.depositReference')}
              value={depositReference}
              onChange={(event) => setDepositReference(event.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('actions.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={record.pending}>
            {t('actions.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
