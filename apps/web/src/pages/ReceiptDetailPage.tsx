import type { Receipt } from '@alola/contracts';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DataTable, Icon, PageHeader, StateView, type DataColumn } from '@alola/ui';
import { Printer, Receipt as ReceiptIcon } from '@alola/ui/icons';
import MuiLink from '@mui/material/Link';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { apiRequest } from '../api/client';
import { useSession } from '../api/session';
import { useApi, useMutation } from '../api/useApi';
import { useErrorMessage } from '../errors';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { PersonName } from '../people';
import { useBreadcrumbTail } from '../shell/breadcrumbs';
import {
  BackLink,
  DetailLayout,
  FieldGroup,
  TableSection,
  useTableLabels,
  EnumChip,
  ErrorState,
  Field,
  Panel,
  RECEIPT_TONES,
  RequirePermission,
  Verbatim,
} from './shared';

type Allocation = Receipt['allocations'][number];

/**
 * One receipt, its allocation, and the only change that can ever be made to it.
 *
 * There is **no edit**. A posted receipt is a document the customer holds, so correcting it means
 * reversing it and issuing a new one; the dialog says exactly that, because "why can't I just fix
 * the amount?" is the question this screen has to answer before it is asked.
 */
export default function ReceiptDetailPage() {
  return (
    <RequirePermission permission="collection.receipt.view">
      <ReceiptDetailScreen />
    </RequirePermission>
  );
}

function ReceiptDetailScreen() {
  const { receiptId } = useParams<{ receiptId: string }>();
  const { t, td } = useLocale();
  const { can } = useSession();
  const format = useFormatters();
  const errorMessage = useErrorMessage();
  const labels = useTableLabels();
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reason, setReason] = useState('');

  const receipt = useApi<Receipt>(
    receiptId ? `/api/v1/collections/receipts/${receiptId}` : undefined,
  );

  const reverse = useMutation<void, Receipt>(() =>
    apiRequest<Receipt>(`/api/v1/collections/receipts/${receiptId}/reverse`, {
      method: 'POST',
      body: { reason: reason.trim() },
    }),
  );

  const columns = useMemo<DataColumn<Allocation>[]>(
    () => [
      {
        key: 'sequence',
        header: t('fields.sequence'),
        render: (row) => <Verbatim>{format.number(row.sequence)}</Verbatim>,
        width: 64,
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
    ],
    [format, t],
  );

  useBreadcrumbTail(receipt.state.kind === 'ready' ? receipt.state.data.receiptNumber : undefined);

  if (receipt.state.kind === 'loading') {
    return <StateView kind="loading" title={t('states.loadingTitle')} />;
  }
  if (receipt.state.kind === 'error') {
    return <ErrorState error={receipt.state.error} onRetry={receipt.reload} />;
  }
  const record = receipt.state.data;

  return (
    <Box>
      <BackLink to="/receipts" label={t('detail.backTo', { list: t('nav.receipts') })} />
      <PageHeader
        eyebrow={t('detail.receipt')}
        title={record.receiptNumber}
        status={<EnumChip namespace="receiptState" value={record.state} tones={RECEIPT_TONES} />}
        meta={
          <>
            <Verbatim>{format.money(record.amount)}</Verbatim>
            <span>{td(`paymentMethod.${record.method}`)}</span>
            <Verbatim>{format.date(record.receivedOn)}</Verbatim>
          </>
        }
        // A reversed receipt is a genuine alert: the document the customer holds is void.
        {...(record.state === 'reversed'
          ? {
              banner: (
                <Alert severity="error" variant="outlined">
                  <Typography sx={{ fontWeight: 600 }}>
                    {t('collections.reversedBanner')}
                  </Typography>
                  {record.reversalReason}
                </Alert>
              ),
            }
          : {})}
        actions={
          <>
            <Button
              variant="outlined"
              color="inherit"
              onClick={() => window.print()}
              startIcon={<Icon icon={Printer} size={18} />}
            >
              {t('actions.print')}
            </Button>
            {can('collection.receipt.cancel') && record.state === 'posted' ? (
              <Button variant="outlined" color="error" onClick={() => setReverseOpen(true)}>
                {t('actions.reverseReceipt')}
              </Button>
            ) : null}
          </>
        }
      />

      <DetailLayout
        main={
          <Panel title={t('collections.receiptDetails')} icon={ReceiptIcon}>
            <Stack spacing={3}>
              <FieldGroup title={t('detail.payment')}>
                <Field label={t('fields.amount')}>
                  <Verbatim>{format.money(record.amount)}</Verbatim>
                </Field>
                <Field label={t('fields.method')}>{td(`paymentMethod.${record.method}`)}</Field>
                <Field label={t('collections.receivedOn')}>
                  <Verbatim>{format.date(record.receivedOn)}</Verbatim>
                </Field>
                <Field label={t('fields.receivedBy')}>
                  <PersonName accountId={record.receivedByAccountId} showTitle />
                </Field>
              </FieldGroup>
              <FieldGroup title={t('detail.references')}>
                {record.depositReference ? (
                  <Field label={t('collections.depositReference')}>
                    <Verbatim>{record.depositReference}</Verbatim>
                  </Field>
                ) : null}
                {record.transactionReference ? (
                  <Field label={t('collections.transactionReference')}>
                    <Verbatim>{record.transactionReference}</Verbatim>
                  </Field>
                ) : null}
                <Field label={t('fields.contract')}>
                  <MuiLink
                    component={Link}
                    to={`/contracts/${record.contractId}`}
                    underline="hover"
                  >
                    {t('detail.openContract')}
                  </MuiLink>
                </Field>
              </FieldGroup>
            </Stack>
          </Panel>
        }
        aside={
          <>
            <TableSection title={t('collections.allocations')}>
              <DataTable
                columns={columns}
                rows={record.allocations}
                rowKey={(row) => row.installmentId}
                status="ready"
                caption={t('collections.allocations')}
                labels={labels}
              />
            </TableSection>
            <Alert severity="info" variant="outlined">
              {t('collections.reverseHint')}
            </Alert>
          </>
        }
      />

      <Dialog open={reverseOpen} onClose={() => setReverseOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t('collections.reverseTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ marginBlockEnd: 2 }}>
            {t('confirm.reverseReceipt')}
          </DialogContentText>
          {reverse.error ? (
            <Alert severity="error" role="alert" sx={{ marginBlockEnd: 2 }}>
              {errorMessage(reverse.error)}
            </Alert>
          ) : null}
          <TextField
            label={t('fields.reason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            fullWidth
            required
            autoFocus
            helperText={t('confirm.reasonRequired')}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReverseOpen(false)}>{t('actions.cancel')}</Button>
          <Button
            variant="contained"
            color="error"
            disabled={reverse.pending || reason.trim().length < 3}
            onClick={() => {
              void reverse.run().then(
                () => {
                  setReverseOpen(false);
                  receipt.reload();
                },
                () => undefined,
              );
            }}
          >
            {t('actions.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
