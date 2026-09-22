import type { Contract, Installment, Reservation, Unit } from '@alola/contracts';
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
import { PageHeader, StateView } from '@alola/ui';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { apiRequest } from '../api/client';
import { useSession } from '../api/session';
import { useApi, useIdempotencyKey, useMutation } from '../api/useApi';
import { useErrorMessage } from '../errors';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import {
  CardGrid,
  EnumChip,
  ErrorState,
  Field,
  Panel,
  RESERVATION_TONES,
  RequirePermission,
  Verbatim,
} from './shared';

/**
 * One reservation, and the two decisions that follow it: confirm, or cancel.
 *
 * A reservation awaiting a discount approval shows why it cannot be confirmed **and** says plainly
 * that the person who raised it cannot approve it themselves. That is the maker-checker rule, and a
 * disabled button with no explanation is how people conclude the system is broken.
 */
export default function ReservationDetailPage() {
  return (
    <RequirePermission permission="sales.reservation.view">
      <ReservationDetailScreen />
    </RequirePermission>
  );
}

function ReservationDetailScreen() {
  const { reservationId } = useParams<{ reservationId: string }>();
  const { t, td } = useLocale();
  const { can } = useSession();
  const format = useFormatters();
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');

  const reservation = useApi<Reservation>(
    reservationId ? `/api/v1/sales/reservations/${reservationId}` : undefined,
  );
  const data = reservation.state.kind === 'ready' ? reservation.state.data : undefined;
  const unit = useApi<Unit>(data ? `/api/v1/inventory/units/${data.unitId}` : undefined);

  /** Generated once, so a double-click on "create contract" cannot produce two contracts. */
  const contractKey = useIdempotencyKey(`contract-${reservationId ?? 'none'}`);

  const confirm = useMutation<void, Reservation>(() =>
    apiRequest<Reservation>(`/api/v1/sales/reservations/${reservationId}/confirm`, {
      method: 'POST',
    }),
  );
  const cancel = useMutation<void, Reservation>(() =>
    apiRequest<Reservation>(`/api/v1/sales/reservations/${reservationId}/cancel`, {
      method: 'POST',
      body: { reason: reason.trim() },
    }),
  );
  const createContract = useMutation<void, { contract: Contract; installments: Installment[] }>(
    () =>
      apiRequest<{ contract: Contract; installments: Installment[] }>('/api/v1/sales/contracts', {
        method: 'POST',
        body: {
          reservationId,
          contractedOn: new Date().toISOString().slice(0, 10),
          idempotencyKey: contractKey(),
        },
      }),
  );

  if (reservation.state.kind === 'loading') {
    return <StateView kind="loading" title={t('states.loadingTitle')} />;
  }
  if (reservation.state.kind === 'error') {
    return <ErrorState error={reservation.state.error} onRetry={reservation.reload} />;
  }
  const record = reservation.state.data;
  const awaitingApproval = record.state === 'pendingApproval';

  return (
    <Box>
      <PageHeader
        title={record.reservationNumber}
        subtitle={t('sales.reservationDetails')}
        banner={
          <Stack spacing={1}>
            <Box>
              <EnumChip
                namespace="reservationState"
                value={record.state}
                tones={RESERVATION_TONES}
              />
            </Box>
            {awaitingApproval ? (
              <Alert severity="warning" variant="outlined">
                <Typography sx={{ fontWeight: 600 }}>{t('sales.approvalPending')}</Typography>
                {t('sales.approvalPendingHint')}
              </Alert>
            ) : null}
          </Stack>
        }
        actions={
          <>
            {can('sales.reservation.confirm') &&
            (record.state === 'draft' || record.state === 'pendingApproval') ? (
              <Button
                variant="contained"
                disabled={confirm.pending}
                onClick={() => {
                  void confirm.run().then(reservation.reload, () => undefined);
                }}
              >
                {t('actions.confirmReservation')}
              </Button>
            ) : null}
            {can('sales.contract.create') && record.state === 'confirmed' ? (
              <Button
                variant="contained"
                disabled={createContract.pending}
                onClick={() => {
                  void createContract.run().then(
                    (result) => void navigate(`/contracts/${result.contract.contractId}`),
                    () => undefined,
                  );
                }}
              >
                {t('actions.createContract')}
              </Button>
            ) : null}
            {can('sales.reservation.cancel') &&
            ['draft', 'pendingApproval', 'confirmed'].includes(record.state) ? (
              <Button variant="outlined" color="error" onClick={() => setCancelOpen(true)}>
                {t('actions.cancelReservation')}
              </Button>
            ) : null}
            <Button variant="outlined" onClick={() => window.print()}>
              {t('sales.printSummary')}
            </Button>
          </>
        }
      />

      <Stack spacing={3}>
        {confirm.error ? (
          <Alert severity="error" role="alert">
            {errorMessage(confirm.error)}
          </Alert>
        ) : null}
        {createContract.error ? (
          <Alert severity="error" role="alert">
            {errorMessage(createContract.error)}
          </Alert>
        ) : null}

        <Panel title={t('sales.reservationDetails')}>
          <CardGrid min={200}>
            <Field label={t('fields.unit')}>
              <Verbatim>
                {unit.state.kind === 'ready' ? unit.state.data.code : record.unitId}
              </Verbatim>
            </Field>
            <Field label={t('sales.reservedOn')}>
              <Verbatim>{format.date(record.reservedOn)}</Verbatim>
            </Field>
            <Field label={t('sales.expiresOn')}>
              <Verbatim>{format.date(record.expiresOn)}</Verbatim>
            </Field>
            <Field label={t('sales.agreedPrice')}>
              <Verbatim>{format.money(record.agreedPrice)}</Verbatim>
            </Field>
            <Field label={t('sales.reservationAmount')}>
              <Verbatim>{format.money(record.reservationAmount)}</Verbatim>
            </Field>
            <Field label={t('sales.discount')}>
              <Verbatim>{`${format.number(record.discountPercentage, 2)}%`}</Verbatim>
            </Field>
            <Field label={t('sales.salesOwner')}>
              <Verbatim>{record.salesOwnerAccountId}</Verbatim>
            </Field>
            {record.cancellationReason ? (
              <Field label={t('fields.reason')}>{record.cancellationReason}</Field>
            ) : null}
          </CardGrid>
        </Panel>

        <Panel title={t('sales.paymentPlan')}>
          <CardGrid min={180}>
            <Field label={t('sales.downPayment')}>
              <Verbatim>{format.money(record.paymentPlan.downPayment)}</Verbatim>
            </Field>
            <Field label={t('sales.installmentCount')}>
              <Verbatim>{format.number(record.paymentPlan.installmentCount)}</Verbatim>
            </Field>
            <Field label={t('sales.frequency')}>
              {td(`frequency.${record.paymentPlan.frequency}`)}
            </Field>
            <Field label={t('sales.firstDueOn')}>
              <Verbatim>{format.date(record.paymentPlan.firstDueOn)}</Verbatim>
            </Field>
          </CardGrid>
        </Panel>

        {/* A printed summary is a demonstration document and says so (ADR-0026). */}
        <Alert severity="info" variant="outlined">
          <Typography sx={{ fontWeight: 600 }}>{t('sales.demoDocumentTitle')}</Typography>
          {t('sales.demoDocumentBody')}
        </Alert>
      </Stack>

      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t('confirm.title')}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ marginBlockEnd: 2 }}>
            {t('confirm.cancelReservation')}
          </DialogContentText>
          {cancel.error ? (
            <Alert severity="error" role="alert" sx={{ marginBlockEnd: 2 }}>
              {errorMessage(cancel.error)}
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
          <Button onClick={() => setCancelOpen(false)}>{t('actions.cancel')}</Button>
          <Button
            variant="contained"
            color="error"
            disabled={cancel.pending || reason.trim().length < 3}
            onClick={() => {
              void cancel.run().then(
                () => {
                  setCancelOpen(false);
                  reservation.reload();
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
