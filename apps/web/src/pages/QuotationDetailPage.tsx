import type { Quotation, Unit } from '@alola/contracts';
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
import { DataTable, Icon, PageHeader, StateView, type DataColumn } from '@alola/ui';
import { Calculator, CalendarCheck, CalendarClock, History, PencilLine } from '@alola/ui/icons';
import { useMemo, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import { apiRequest } from '../api/client';
import { useSession } from '../api/session';
import { useApi, useMutation } from '../api/useApi';
import { useErrorMessage } from '../errors';
import { useFormatters, useToday } from '../format';
import { useLocale } from '../locale';
import { PersonName } from '../people';
import { useBreadcrumbTail } from '../shell/breadcrumbs';
import { IssuedDocumentsPanel } from './IssuedDocumentsPanel';
import { RecordLink, useCustomerNames, useProjectNames } from './lookups';
import {
  PaymentPlanEditor,
  SchedulePreviewTable,
  planDraftFrom,
  planIsComplete,
  planRequest,
} from './plan';
import {
  BackLink,
  DetailLayout,
  EnumChip,
  ErrorState,
  Field,
  FieldGroup,
  Panel,
  QUOTATION_TONES,
  RequirePermission,
  TableSection,
  UNIT_TONES,
  Verbatim,
  useTableLabels,
} from './shared';

/**
 * One quotation and its revisions (SALE-QUOTE-001).
 *
 * The current revision is the one on top; every earlier one stays, superseded, in the history below —
 * a revision is a new record, never an edit. Withdrawing keeps the record and its reason. Nothing on
 * this page can change a unit: a quotation never reserves inventory, and "reserve on these terms" only
 * opens the reservation form pre-filled, where every reservation rule applies again.
 */
export default function QuotationDetailPage() {
  return (
    <RequirePermission permission="sales.quotation.view">
      <QuotationDetailScreen />
    </RequirePermission>
  );
}

function QuotationDetailScreen() {
  const { quotationId } = useParams<{ quotationId: string }>();
  const { t, locale } = useLocale();
  const { can } = useSession();
  const format = useFormatters();
  const labels = useTableLabels();
  const [dialog, setDialog] = useState<'revise' | 'withdraw' | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const revisions = useApi<{ items: Quotation[] }>(
    quotationId ? `/api/v1/sales/quotations/${quotationId}` : undefined,
  );
  const items = revisions.state.kind === 'ready' ? revisions.state.data.items : [];
  const current = items[0];
  const unit = useApi<Unit>(
    current && can('inventory.unit.view') ? `/api/v1/inventory/units/${current.unitId}` : undefined,
  );
  const customerName = useCustomerNames([current?.customerId]);
  const projectName = useProjectNames();
  useBreadcrumbTail(current?.quotationNumber);

  const columns = useMemo<DataColumn<Quotation>[]>(
    () => [
      {
        key: 'revision',
        header: t('quotations.revision'),
        render: (row) => <Verbatim>{format.number(row.revision)}</Verbatim>,
        width: 96,
      },
      {
        key: 'created',
        header: t('quotations.issuedOn'),
        render: (row) => <Verbatim>{format.dateTime(row.createdAt)}</Verbatim>,
      },
      {
        key: 'price',
        header: t('sales.agreedPrice'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.agreedPrice)}</Verbatim>,
      },
      {
        key: 'total',
        header: t('fields.total'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.total)}</Verbatim>,
      },
      {
        key: 'validUntil',
        header: t('quotations.validUntil'),
        render: (row) => <Verbatim>{format.date(row.validUntil)}</Verbatim>,
      },
      {
        key: 'state',
        header: t('fields.state'),
        render: (row) => (
          <EnumChip namespace="quotationState" value={row.state} tones={QUOTATION_TONES} />
        ),
      },
    ],
    [format, t],
  );

  if (revisions.state.kind === 'loading') {
    return <StateView kind="loading" title={t('states.loadingTitle')} />;
  }
  if (revisions.state.kind === 'error') {
    return <ErrorState error={revisions.state.error} onRetry={revisions.reload} />;
  }
  if (!current) {
    return <StateView kind="empty" title={t('states.emptyTitle')} />;
  }

  const live = current.state === 'active';
  const mayManage = can('sales.quotation.manage');
  const reserveHref = `/reservations/new?quotationId=${current.quotationId}`;

  return (
    <Box>
      <BackLink to="/quotations" label={t('detail.backTo', { list: t('nav.quotations') })} />
      <PageHeader
        eyebrow={t('quotations.one')}
        title={current.quotationNumber}
        status={
          <EnumChip namespace="quotationState" value={current.state} tones={QUOTATION_TONES} />
        }
        meta={
          <>
            <span>
              {t('quotations.revisionShort', { revision: format.number(current.revision) })}
            </span>
            <span>{`${t('quotations.validUntil')}: `}</span>
            <Verbatim>{format.date(current.validUntil)}</Verbatim>
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
              {`${t('sales.salesOwner')}:`}
              <PersonName accountId={current.salesOwnerAccountId} compact />
            </Box>
          </>
        }
        actions={
          <>
            {mayManage && live ? (
              <Button variant="outlined" color="error" onClick={() => setDialog('withdraw')}>
                {t('quotations.withdraw')}
              </Button>
            ) : null}
            {mayManage && live ? (
              <Button
                variant="outlined"
                color="inherit"
                onClick={() => setDialog('revise')}
                startIcon={<Icon icon={PencilLine} size={18} />}
              >
                {t('quotations.revise')}
              </Button>
            ) : null}
            {live && current.customerId && can('sales.reservation.create') ? (
              <Button
                variant="contained"
                component={RouterLink}
                to={reserveHref}
                startIcon={<Icon icon={CalendarCheck} size={18} />}
              >
                {t('quotations.reserveOnTerms')}
              </Button>
            ) : null}
          </>
        }
      />

      <DetailLayout
        main={
          <>
            {notice ? (
              <Alert severity="success" onClose={() => setNotice(undefined)}>
                {notice}
              </Alert>
            ) : null}
            {current.state === 'expired' ? (
              <Alert severity="warning">{t('quotations.expiredHint')}</Alert>
            ) : null}
            {current.state === 'withdrawn' && current.withdrawalReason ? (
              <Alert severity="info">{`${t('quotations.withdrawnBecause')}: ${current.withdrawalReason}`}</Alert>
            ) : null}
            <Panel title={t('quotations.terms')} icon={Calculator}>
              <Stack spacing={3}>
                <FieldGroup title={t('detail.record')}>
                  <Field label={t('quotations.recipient')}>
                    {current.customerId ? (
                      <RecordLink to={`/customers/${current.customerId}`}>
                        {customerName(current.customerId) ?? t('quotations.customerHidden')}
                      </RecordLink>
                    ) : current.leadId ? (
                      <RecordLink to={`/leads/${current.leadId}`}>
                        {t('quotations.leadRecipient')}
                      </RecordLink>
                    ) : (
                      '—'
                    )}
                  </Field>
                  <Field label={t('fields.unit')}>
                    <RecordLink to={`/units/${current.unitId}`}>
                      <Verbatim>{current.unitCode}</Verbatim>
                    </RecordLink>
                  </Field>
                  <Field label={t('fields.project')}>{projectName(current.projectId) ?? '—'}</Field>
                </FieldGroup>
                <FieldGroup title={t('detail.financial')}>
                  <Field label={t('quotations.listPrice')}>
                    <Verbatim>{format.money(current.listPrice)}</Verbatim>
                  </Field>
                  <Field label={t('sales.agreedPrice')}>
                    <Verbatim>{format.money(current.agreedPrice)}</Verbatim>
                  </Field>
                  <Field label={t('sales.discount')}>
                    <Verbatim>{`${format.number(current.discountPercentage, 2)}%`}</Verbatim>
                  </Field>
                  <Field label={t('fields.total')}>
                    <Verbatim>{format.money(current.total)}</Verbatim>
                  </Field>
                  <Field label={t('quotations.validUntil')}>
                    <Verbatim>{format.date(current.validUntil)}</Verbatim>
                  </Field>
                </FieldGroup>
                {current.notes ? (
                  <FieldGroup title={t('fields.notes')}>
                    <Box sx={{ gridColumn: '1 / -1', typography: 'body2', whiteSpace: 'pre-line' }}>
                      {current.notes}
                    </Box>
                  </FieldGroup>
                ) : null}
              </Stack>
            </Panel>
            <Panel title={t('sales.schedule')} icon={CalendarClock}>
              <SchedulePreviewTable
                rows={current.rows}
                price={current.agreedPrice}
                maintenanceDeposit={current.paymentPlan.maintenanceDeposit?.amount}
                total={current.total}
                caption={t('sales.schedule')}
              />
            </Panel>
            <TableSection title={t('quotations.history')}>
              <DataTable
                columns={columns}
                rows={items}
                rowKey={(row) => String(row.revision)}
                status="ready"
                caption={t('quotations.history')}
                labels={labels}
              />
            </TableSection>
          </>
        }
        aside={
          <>
            <Panel title={t('quotations.whatItIs')} icon={History}>
              <Box
                component="ul"
                sx={{ margin: 0, paddingInlineStart: 2.5, typography: 'body2' }}
                lang={locale}
              >
                <li>{t('quotations.noReservationShort')}</li>
                <li>{t('quotations.revisionsKept')}</li>
                <li>{t('quotations.expiryComputed')}</li>
              </Box>
            </Panel>
            {unit.state.kind === 'ready' ? (
              <Panel title={t('fields.unit')}>
                <Field label={t('fields.status')}>
                  <EnumChip
                    namespace="unitStatus"
                    value={unit.state.data.status}
                    tones={UNIT_TONES}
                  />
                </Field>
              </Panel>
            ) : null}
            <IssuedDocumentsPanel
              sourceType="quotation"
              sourceId={current.quotationId}
              types={['quotation']}
            />
          </>
        }
      />

      {dialog === 'revise' ? (
        <ReviseDialog
          current={current}
          onClose={() => setDialog(undefined)}
          onDone={(revised) => {
            setDialog(undefined);
            setNotice(t('quotations.revisedNotice', { revision: format.number(revised.revision) }));
            revisions.reload();
          }}
        />
      ) : null}
      {dialog === 'withdraw' ? (
        <WithdrawDialog
          current={current}
          onClose={() => setDialog(undefined)}
          onDone={() => {
            setDialog(undefined);
            setNotice(t('quotations.withdrawnNotice'));
            revisions.reload();
          }}
        />
      ) : null}
    </Box>
  );
}

function ReviseDialog({
  current,
  onClose,
  onDone,
}: {
  current: Quotation;
  onClose: () => void;
  onDone: (revised: Quotation) => void;
}) {
  const { t } = useLocale();
  const errorMessage = useErrorMessage();
  const today = useToday();
  const [price, setPrice] = useState<string>(current.agreedPrice.amount);
  const [validUntil, setValidUntil] = useState<string>(
    current.validUntil >= today ? current.validUntil : '',
  );
  const [notes, setNotes] = useState(current.notes ?? '');
  const [plan, setPlan] = useState(planDraftFrom(current.paymentPlan));
  const currency = current.agreedPrice.currency;
  const revise = useMutation(() =>
    apiRequest<Quotation>(`/api/v1/sales/quotations/${current.quotationId}/revisions`, {
      method: 'POST',
      body: {
        agreedPrice: { amount: price.trim(), currency },
        paymentPlan: planRequest(plan, currency),
        validUntil,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        expectedRevision: current.revision,
      },
    }),
  );
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" aria-labelledby="revise-title">
      <DialogTitle id="revise-title">{t('quotations.reviseTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ paddingBlockStart: 1 }}>
          <DialogContentText>{t('quotations.reviseHint')}</DialogContentText>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label={t('sales.agreedPrice')}
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              required
              fullWidth
              slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'decimal' } }}
            />
            <TextField
              label={t('quotations.validUntil')}
              type="date"
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
              required
              fullWidth
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: today } }}
            />
          </Stack>
          <PaymentPlanEditor value={plan} onChange={setPlan} />
          <TextField
            label={t('fields.notes')}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            multiline
            minRows={2}
          />
          {revise.error ? (
            <Alert severity="error" role="alert">
              {errorMessage(revise.error)}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!price || !validUntil || !planIsComplete(plan) || revise.pending}
          onClick={() => void revise.run(undefined).then(onDone, () => undefined)}
        >
          {t('quotations.saveRevision')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function WithdrawDialog({
  current,
  onClose,
  onDone,
}: {
  current: Quotation;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const errorMessage = useErrorMessage();
  const [reason, setReason] = useState('');
  const withdraw = useMutation(() =>
    apiRequest<Quotation>(`/api/v1/sales/quotations/${current.quotationId}/withdraw`, {
      method: 'POST',
      body: { reason: reason.trim(), expectedRevision: current.revision },
    }),
  );
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="withdraw-title">
      <DialogTitle id="withdraw-title">{t('quotations.withdrawTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ paddingBlockStart: 1 }}>
          <DialogContentText>{t('quotations.withdrawHint')}</DialogContentText>
          <TextField
            label={t('fields.reason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            autoFocus
            multiline
            minRows={2}
            helperText={t('confirm.reasonRequired')}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          {withdraw.error ? (
            <Alert severity="error" role="alert">
              {errorMessage(withdraw.error)}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        <Button
          variant="contained"
          color="error"
          disabled={reason.trim().length < 3 || withdraw.pending}
          onClick={() => void withdraw.run(undefined).then(onDone, () => undefined)}
        >
          {t('quotations.confirmWithdraw')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
