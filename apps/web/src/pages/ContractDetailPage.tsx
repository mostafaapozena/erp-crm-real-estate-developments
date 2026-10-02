import {
  type AMENDMENT_STATES,
  CONTRACT_PARTY_ROLES,
  INSTALLMENT_FREQUENCIES,
  type ActivationReview,
  type Contract,
  type ContractHistoryEntry,
  type ContractPartyRole,
  type Customer,
  type CustomerFinancialSummary,
  type InstallmentFrequency,
  type Installment,
  type Receipt,
  type SchedulePreview,
} from '@alola/contracts';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { DataTable, Icon, MetricCard, PageHeader, StateView, type DataColumn } from '@alola/ui';
import {
  BadgeCheck,
  CalendarClock,
  Coins,
  FileSignature,
  HandCoins,
  History,
  House,
  PencilLine,
  Plus,
  Printer,
  TriangleAlert,
  UserRound,
  Users,
  Wallet,
  X,
} from '@alola/ui/icons';
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { apiRequest, query } from '../api/client';
import { useSession } from '../api/session';
import { useApi, useIdempotencyKey, useMutation, type AsyncState } from '../api/useApi';
import { useErrorMessage } from '../errors';
import { useFormatters, useToday } from '../format';
import { useLocale } from '../locale';
import { IssuedDocumentsPanel } from './IssuedDocumentsPanel';
import { PersonName } from '../people';
import { useBreadcrumbTail } from '../shell/breadcrumbs';
import { RecordLink, useCustomerNames, useProjectNames } from './lookups';
import {
  PaymentPlanEditor,
  SchedulePreviewTable,
  planDraftFrom,
  planIsComplete,
  planRequest,
  useSchedulePreview,
} from './plan';
import {
  BackLink,
  CONTRACT_TONES,
  CardGrid,
  DetailLayout,
  EnumChip,
  ErrorState,
  Field,
  FieldGroup,
  INSTALLMENT_TONES,
  Panel,
  RequirePermission,
  TableSection,
  Timeline,
  Verbatim,
  tableStatus,
  useTableLabels,
} from './shared';

const METHODS = ['cash', 'bankTransfer', 'card', 'cheque', 'promissoryNote'] as const;

const AMENDMENT_TONES = {
  pending: 'warning',
  applied: 'success',
  rejected: 'danger',
  stale: 'neutral',
} as const satisfies Record<(typeof AMENDMENT_STATES)[number], string>;

type Dialogs = 'activate' | 'parties' | 'plan' | 'sign' | 'amend' | 'cancel' | 'pay';

/**
 * One contract, from draft to active (SALE-CONTRACT-001 … 004, SALE-CHANGE-001, SALE-CANCEL-001).
 *
 * **A draft commits nothing**, and the page says so: no instalment exists, the unit is still the
 * reservation's, and the opportunity is not won. While a draft, its parties and its payment plan can
 * be edited; the immutable snapshots — buyer, unit, agreed price — cannot. **Activation** is one
 * reviewed action: the review comes from the server (what would be frozen, whether an approval is
 * required, what blocks it), the request carries an idempotency key, and the button cannot be pressed
 * twice. Once active, the schedule changes only by an approved amendment and a cancellation is refused
 * once money beyond the deposit was collected — that refund is BMP-2's.
 *
 * Every control follows a permission the API enforces anyway (ADR-0006).
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
  const { t, td, locale } = useLocale();
  const { can } = useSession();
  const format = useFormatters();
  const navigate = useNavigate();
  const projectName = useProjectNames();
  const [dialog, setDialog] = useState<Dialogs | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const contract = useApi<Contract>(
    contractId ? `/api/v1/sales/contracts/${contractId}` : undefined,
  );
  const data = contract.state.kind === 'ready' ? contract.state.data : undefined;
  const live =
    data?.state === 'active' || data?.state === 'completed' || data?.state === 'cancelled';
  const installments = useApi<{ items: Installment[] }>(
    data && live ? `/api/v1/sales/contracts/${data.contractId}/installments` : undefined,
  );
  const history = useApi<{ items: ContractHistoryEntry[] }>(
    data ? `/api/v1/sales/contracts/${data.contractId}/history` : undefined,
  );
  const summary = useApi<CustomerFinancialSummary>(
    data && live ? `/api/v1/sales/customers/${data.customerId}/summary` : undefined,
  );
  useBreadcrumbTail(data?.contractNumber);

  if (contract.state.kind === 'loading') {
    return <StateView kind="loading" title={t('states.loadingTitle')} />;
  }
  if (contract.state.kind === 'error' || !data) {
    return contract.state.kind === 'error' ? (
      <ErrorState error={contract.state.error} onRetry={contract.reload} />
    ) : null;
  }

  const record = data;
  const isDraft = record.state === 'draft';
  const reload = () => {
    contract.reload();
    installments.reload();
    history.reload();
    summary.reload();
  };
  const done = (message: string) => {
    setDialog(undefined);
    setNotice(message);
    reload();
  };
  const summaryData = summary.state.kind === 'ready' ? summary.state.data : undefined;
  const unit = record.unitSnapshot;
  const buyer = record.customerSnapshot;

  return (
    <Box>
      <BackLink to="/contracts" label={t('detail.backTo', { list: t('nav.contracts') })} />
      <PageHeader
        eyebrow={isDraft ? t('contract.draftEyebrow') : t('detail.contract')}
        title={record.contractNumber}
        status={<EnumChip namespace="contractState" value={record.state} tones={CONTRACT_TONES} />}
        meta={
          <>
            <span>{`${t('sales.contractedOn')}: `}</span>
            <Verbatim>{format.date(record.contractedOn)}</Verbatim>
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
              {`${t('sales.salesOwner')}:`}
              <PersonName accountId={record.salesOwnerAccountId} compact />
            </Box>
          </>
        }
        {...(isDraft
          ? {
              banner: (
                <Alert severity="info" variant="outlined">
                  <Typography sx={{ fontWeight: 600 }}>{t('contract.draftBannerTitle')}</Typography>
                  {t('contract.draftBannerBody')}
                </Alert>
              ),
            }
          : record.state === 'pendingApproval'
            ? {
                banner: (
                  <Alert severity="warning" variant="outlined">
                    <Typography sx={{ fontWeight: 600 }}>{t('contract.pendingTitle')}</Typography>
                    {t('contract.pendingBody')}
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
              {t('sales.printContract')}
            </Button>
            {can('sales.contract.cancel') && (isDraft || record.state === 'pendingApproval') ? (
              <Button variant="outlined" color="error" onClick={() => setDialog('cancel')}>
                {t('contract.withdrawDraft')}
              </Button>
            ) : null}
            {can('sales.contract.cancel') &&
            record.state === 'active' &&
            !record.pendingCancellation ? (
              <Button variant="outlined" color="error" onClick={() => setDialog('cancel')}>
                {t('contract.cancel')}
              </Button>
            ) : null}
            {can('sales.contract.amend') && record.state === 'active' ? (
              <Button variant="outlined" color="inherit" onClick={() => setDialog('amend')}>
                {t('contract.amend')}
              </Button>
            ) : null}
            {can('sales.contract.sign') &&
            record.signing.state === 'unsigned' &&
            ['draft', 'pendingApproval', 'active'].includes(record.state) ? (
              <Button
                variant="outlined"
                color="inherit"
                onClick={() => setDialog('sign')}
                startIcon={<Icon icon={FileSignature} size={18} />}
              >
                {t('contract.recordSigning')}
              </Button>
            ) : null}
            {can('collection.receipt.create') && record.state === 'active' ? (
              <Button
                variant="contained"
                onClick={() => setDialog('pay')}
                startIcon={<Icon icon={HandCoins} size={18} />}
              >
                {t('actions.recordPayment')}
              </Button>
            ) : null}
            {can('sales.contract.activate') && isDraft ? (
              <Button
                variant="contained"
                onClick={() => setDialog('activate')}
                startIcon={<Icon icon={BadgeCheck} size={18} />}
              >
                {t('contract.activate')}
              </Button>
            ) : null}
          </>
        }
      />

      <Stack spacing={3}>
        {notice ? (
          <Alert severity="success" role="status" onClose={() => setNotice(undefined)}>
            {notice}
          </Alert>
        ) : null}
        {record.pendingCancellation ? (
          <Alert severity="warning">{t('contract.cancellationPending')}</Alert>
        ) : null}

        {live ? (
          <CardGrid min={200}>
            <MetricCard
              icon={Wallet}
              label={t('sales.totalPrice')}
              value={format.money(record.totalPrice)}
            />
            <MetricCard
              icon={HandCoins}
              label={t('sales.paidAmount')}
              value={format.money(record.paidAmount)}
            />
            <MetricCard
              icon={Coins}
              label={t('sales.outstandingAmount')}
              value={format.money(record.outstandingAmount)}
              tone={record.outstandingAmount.amount !== '0' ? 'attention' : 'default'}
            />
            {summaryData ? (
              <MetricCard
                icon={TriangleAlert}
                label={t('collections.overdueAmount')}
                value={format.money(summaryData.overdueAmount)}
                hint={t('detail.overdueInstallments', {
                  count: format.number(summaryData.overdueCount),
                })}
                tone={summaryData.overdueCount > 0 ? 'attention' : 'default'}
              />
            ) : null}
          </CardGrid>
        ) : null}

        <DetailLayout
          main={
            <>
              {record.warnings.length > 0 || record.exceptions.length > 0 ? (
                <Alert severity="warning" variant="outlined">
                  <Box component="ul" sx={{ margin: 0, paddingInlineStart: 2.5 }}>
                    {record.exceptions.map((exception) => (
                      <li key={exception}>{td(`contractException.${exception}`)}</li>
                    ))}
                    {record.warnings.map((warning) => (
                      <li key={warning}>{td(`contractWarning.${warning}`)}</li>
                    ))}
                  </Box>
                </Alert>
              ) : null}

              <Panel title={t('contract.recordTitle')} icon={House}>
                <Stack spacing={3}>
                  <FieldGroup title={t('detail.references')}>
                    <Field label={t('fields.reservation')}>
                      <RecordLink to={`/reservations/${record.reservationId}`}>
                        {t('contract.openReservation')}
                      </RecordLink>
                    </Field>
                    <Field label={t('fields.customer')}>
                      {can('crm.customer.view') ? (
                        <RecordLink to={`/customers/${record.customerId}`}>
                          {buyer?.name ?? t('contract.openCustomer')}
                        </RecordLink>
                      ) : (
                        (buyer?.name ?? '—')
                      )}
                    </Field>
                    <Field label={t('fields.unit')}>
                      <RecordLink to={`/units/${record.unitId}`}>
                        <Verbatim>{unit?.code ?? t('contract.openUnit')}</Verbatim>
                      </RecordLink>
                    </Field>
                    <Field label={t('fields.project')}>
                      {(unit?.projectName ? unit.projectName[locale] : undefined) ??
                        projectName(record.projectId) ??
                        '—'}
                    </Field>
                    {unit?.buildingCode ? (
                      <Field label={t('fields.building')}>
                        <Verbatim>{unit.buildingCode}</Verbatim>
                      </Field>
                    ) : null}
                    {unit?.floor !== undefined ? (
                      <Field label={t('fields.floor')}>
                        <Verbatim>{format.number(unit.floor)}</Verbatim>
                      </Field>
                    ) : null}
                  </FieldGroup>
                  <FieldGroup title={t('detail.financial')}>
                    {record.pricing?.listPrice ? (
                      <Field label={t('quotations.listPrice')}>
                        <Verbatim>{format.money(record.pricing.listPrice)}</Verbatim>
                      </Field>
                    ) : null}
                    <Field label={t('sales.agreedPrice')}>
                      <Verbatim>
                        {format.money(record.pricing?.agreedPrice ?? record.totalPrice)}
                      </Verbatim>
                    </Field>
                    {record.pricing ? (
                      <Field label={t('sales.discount')}>
                        <Verbatim>{`${format.number(record.pricing.discountPercentage, 2)}%`}</Verbatim>
                      </Field>
                    ) : null}
                    <Field label={t('sales.reservationAmount')}>
                      <Verbatim>{format.money(record.reservationAmount)}</Verbatim>
                    </Field>
                    <Field label={t('plan.maintenance')}>
                      <Verbatim>
                        {record.pricing?.maintenanceDeposit
                          ? format.money(record.pricing.maintenanceDeposit)
                          : '—'}
                      </Verbatim>
                    </Field>
                    <Field label={t('sales.totalPrice')}>
                      <Verbatim>{format.money(record.totalPrice)}</Verbatim>
                    </Field>
                  </FieldGroup>
                  {buyer ? (
                    <FieldGroup title={t('contract.buyerSnapshot')}>
                      <Field label={t('fields.name')}>{buyer.name}</Field>
                      <Field label={t('fields.phone')}>
                        <Verbatim>{buyer.primaryPhone}</Verbatim>
                      </Field>
                      <Field label={t('customerWorkspace.identity')}>
                        {buyer.identity ? (
                          <Verbatim>{`${td(`identityType.${buyer.identity.type}`)} ${buyer.identity.number}`}</Verbatim>
                        ) : record.warnings.includes('identityMissing') ? (
                          t('contract.identityMissing')
                        ) : (
                          t('customerWorkspace.identityRestricted')
                        )}
                      </Field>
                    </FieldGroup>
                  ) : (
                    <Alert severity="info">{t('contract.noSnapshot')}</Alert>
                  )}
                </Stack>
              </Panel>

              <PartiesPanel
                contract={record}
                onEdit={
                  can('sales.contract.create') && isDraft ? () => setDialog('parties') : undefined
                }
              />

              <Panel
                title={t('sales.paymentPlan')}
                icon={CalendarClock}
                {...(can('sales.contract.create') && isDraft
                  ? {
                      actions: (
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<Icon icon={PencilLine} size={16} />}
                          onClick={() => setDialog('plan')}
                        >
                          {t('contract.editPlan')}
                        </Button>
                      ),
                    }
                  : {})}
              >
                <Stack spacing={2}>
                  {record.exceptions.includes('planChanged') ? (
                    <Alert severity="info">{t('contract.planDiffers')}</Alert>
                  ) : null}
                  <FieldGroup>
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
                    {record.paymentPlan.finalPayment ? (
                      <Field label={t('sales.finalPayment')}>
                        <Verbatim>{format.money(record.paymentPlan.finalPayment)}</Verbatim>
                      </Field>
                    ) : null}
                    {record.paymentPlan.milestones?.length ? (
                      <Field label={t('plan.milestones')}>
                        <Verbatim>{format.number(record.paymentPlan.milestones.length)}</Verbatim>
                      </Field>
                    ) : null}
                  </FieldGroup>
                </Stack>
              </Panel>

              {live ? (
                <InstallmentsTable state={installments.state} />
              ) : record.draftSchedule ? (
                <Panel title={t('contract.proposedSchedule')} icon={CalendarClock}>
                  <Stack spacing={2}>
                    <Alert severity="info" variant="outlined">
                      {t('contract.proposedScheduleHint')}
                    </Alert>
                    <SchedulePreviewTable
                      rows={record.draftSchedule}
                      price={record.pricing?.agreedPrice}
                      maintenanceDeposit={record.pricing?.maintenanceDeposit}
                      total={record.totalPrice}
                      caption={t('contract.proposedSchedule')}
                    />
                  </Stack>
                </Panel>
              ) : null}

              {record.amendments.length > 0 ? (
                <Panel title={t('contract.amendments')}>
                  <Stack spacing={1.5}>
                    {record.amendments.map((amendment) => (
                      <Box
                        key={amendment.amendmentId}
                        sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}
                      >
                        <EnumChip
                          namespace="amendmentState"
                          value={amendment.state}
                          tones={AMENDMENT_TONES}
                        />
                        <Verbatim>{format.dateTime(amendment.requestedAt)}</Verbatim>
                        <Typography variant="body2">{amendment.reason}</Typography>
                      </Box>
                    ))}
                  </Stack>
                </Panel>
              ) : null}
            </>
          }
          aside={
            <>
              <Panel title={t('contract.statusTitle')} icon={BadgeCheck}>
                <Stack spacing={2}>
                  <Field label={t('contract.signing')}>
                    {td(`signingState.${record.signing.state}`)}
                    {record.signing.signedOn ? (
                      <Box component="span" sx={{ marginInlineStart: 1 }}>
                        <Verbatim>{format.date(record.signing.signedOn)}</Verbatim>
                      </Box>
                    ) : null}
                  </Field>
                  <Typography variant="caption" color="text.secondary">
                    {t('contract.signingNotRequired')}
                  </Typography>
                  {record.activatedAt ? (
                    <Field label={t('contract.activatedAt')}>
                      <Verbatim>{format.dateTime(record.activatedAt)}</Verbatim>
                    </Field>
                  ) : null}
                  {record.approvals.length > 0 ? (
                    <Field label={t('contract.approvals')}>
                      <Box component="ul" sx={{ margin: 0, paddingInlineStart: 2.5 }}>
                        {record.approvals.map((approval) => (
                          <li key={approval.requestId}>
                            {td(`approvalOperation.${approval.operationType}`)}
                          </li>
                        ))}
                      </Box>
                    </Field>
                  ) : null}
                  {record.cancellationReason ? (
                    <Field label={t('fields.reason')}>{record.cancellationReason}</Field>
                  ) : null}
                  {record.refundHandoff === 'pending' ? (
                    <Alert severity="info">{t('contract.refundHandoff')}</Alert>
                  ) : null}
                </Stack>
              </Panel>
              <IssuedDocumentsPanel
                sourceType="contract"
                sourceId={record.contractId}
                types={['contractSummary', 'installmentSchedule']}
              />
              <IssuedDocumentsPanel
                sourceType="customer"
                sourceId={record.customerId}
                types={['customerStatement']}
                title={t('issued.statementTitle')}
                description={t('issued.statementDescription')}
              />
              <HistoryPanel state={history.state} />
              <Alert severity="info" variant="outlined">
                <Typography sx={{ fontWeight: 600 }}>{t('sales.demoDocumentTitle')}</Typography>
                {t('sales.demoDocumentBody')}
              </Alert>
            </>
          }
        />
      </Stack>

      {dialog === 'activate' ? (
        <ActivationDialog
          contract={record}
          onClose={() => setDialog(undefined)}
          onDone={(result) =>
            done(
              result.state === 'active'
                ? t('contract.activatedNotice')
                : t('contract.submittedNotice'),
            )
          }
        />
      ) : null}
      {dialog === 'parties' ? (
        <PartiesDialog
          contract={record}
          onClose={() => setDialog(undefined)}
          onDone={() => done(t('contract.partiesSaved'))}
        />
      ) : null}
      {dialog === 'plan' ? (
        <PlanDialog
          contract={record}
          onClose={() => setDialog(undefined)}
          onDone={() => done(t('contract.planSaved'))}
        />
      ) : null}
      {dialog === 'sign' ? (
        <SigningDialog
          contract={record}
          onClose={() => setDialog(undefined)}
          onDone={() => done(t('contract.signedNotice'))}
        />
      ) : null}
      {dialog === 'amend' ? (
        <AmendDialog
          contract={record}
          onClose={() => setDialog(undefined)}
          onDone={() => done(t('contract.amendNotice'))}
        />
      ) : null}
      {dialog === 'cancel' ? (
        <CancelDialog
          contract={record}
          onClose={() => setDialog(undefined)}
          onDone={(next) =>
            done(
              next.pendingCancellation
                ? t('contract.cancellationSubmitted')
                : t('contract.cancelledNotice'),
            )
          }
        />
      ) : null}
      {dialog === 'pay' ? (
        <RecordPaymentDialog
          contract={record}
          onClose={() => setDialog(undefined)}
          onRecorded={(receiptId) => {
            setDialog(undefined);
            void navigate(`/receipts/${receiptId}`);
          }}
        />
      ) : null}
    </Box>
  );
}

/* --------------------------------------------------------------------- panels */

function InstallmentsTable({ state }: { state: AsyncState<{ items: Installment[] }> }) {
  const { t, td } = useLocale();
  const format = useFormatters();
  const labels = useTableLabels();
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
        header: t('plan.rowKind'),
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
  const rows = state.kind === 'ready' ? state.data.items : [];
  return (
    <TableSection title={t('sales.schedule')}>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.installmentId}
        rowLabel={(row) =>
          t('contract.installmentLabel', {
            sequence: format.number(row.sequence),
            date: format.date(row.dueOn),
          })
        }
        status={tableStatus(state)}
        caption={t('sales.schedule')}
        labels={labels}
        maxHeight={520}
      />
    </TableSection>
  );
}

function PartiesPanel({
  contract,
  onEdit,
}: {
  contract: Contract;
  onEdit: (() => void) | undefined;
}) {
  const { t, td } = useLocale();
  const format = useFormatters();
  // A contract drafted before snapshots stored no party names: read them through the scoped lookup.
  const partyName = useCustomerNames(contract.parties.map((party) => party.customerId));
  return (
    <Panel
      title={t('contract.parties')}
      icon={Users}
      {...(onEdit
        ? {
            actions: (
              <Button
                size="small"
                variant="outlined"
                startIcon={<Icon icon={PencilLine} size={16} />}
                onClick={onEdit}
              >
                {t('contract.editParties')}
              </Button>
            ),
          }
        : {})}
    >
      <Box
        component="ul"
        sx={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 1.25 }}
      >
        {contract.parties.map((party, index) => (
          <Box
            component="li"
            key={`${party.role}-${party.customerId}-${index}`}
            sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}
          >
            <Icon icon={UserRound} size={16} />
            <Typography component="span" sx={{ fontWeight: 600 }}>
              {party.name ?? partyName(party.customerId) ?? t('contract.partyHidden')}
            </Typography>
            <Typography component="span" variant="body2" color="text.secondary">
              {td(`contractPartyRole.${party.role}`)}
            </Typography>
            {party.sharePercent ? (
              <Verbatim>{`${format.number(party.sharePercent)}%`}</Verbatim>
            ) : null}
          </Box>
        ))}
      </Box>
    </Panel>
  );
}

function HistoryPanel({ state }: { state: AsyncState<{ items: ContractHistoryEntry[] }> }) {
  const { t, td } = useLocale();
  const format = useFormatters();
  if (state.kind === 'error') return null;
  const items = state.kind === 'ready' ? state.data.items : [];
  return (
    <Panel title={t('contract.history')} icon={History}>
      {state.kind === 'loading' ? (
        <StateView variant="inline" kind="loading" title={t('states.loadingTitle')} />
      ) : (
        <Timeline
          emptyLabel={t('states.emptyDescription')}
          entries={items.map((entry, index) => {
            const key = entry.action.split('.').pop() ?? entry.action;
            const label = td(`contractHistory.${key}`);
            return {
              key: `${entry.occurredAt}-${index}`,
              title: label === `contractHistory.${key}` ? entry.action : label,
              when: format.dateTime(entry.occurredAt),
              body: (
                <>
                  {entry.actorAccountId ? (
                    <PersonName accountId={entry.actorAccountId} compact />
                  ) : (
                    t('contract.systemActor')
                  )}
                  {entry.outcome !== 'succeeded'
                    ? ` — ${td(`contract.outcome.${entry.outcome}`)}`
                    : ''}
                </>
              ),
            };
          })}
        />
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------- dialogs */

/**
 * The activation review. Everything shown comes from `/activation-review`: the rows activation would
 * freeze, whether an approval is required, and what blocks it. The person confirms they reviewed it;
 * the request carries an idempotency key generated once for the dialog, so a double click activates
 * once and a retry answers with the contract.
 */
function ActivationDialog({
  contract,
  onClose,
  onDone,
}: {
  contract: Contract;
  onClose: () => void;
  onDone: (result: Contract) => void;
}) {
  const { t, td } = useLocale();
  const format = useFormatters();
  const errorMessage = useErrorMessage();
  const partyName = useCustomerNames(contract.parties.map((party) => party.customerId));
  const review = useApi<ActivationReview>(
    `/api/v1/sales/contracts/${contract.contractId}/activation-review`,
  );
  const [reviewed, setReviewed] = useState(false);
  const key = useIdempotencyKey(`activate-${contract.contractId}`);
  const data = review.state.kind === 'ready' ? review.state.data : undefined;
  const activate = useMutation(() =>
    apiRequest<Contract>(`/api/v1/sales/contracts/${contract.contractId}/activate`, {
      method: 'POST',
      body: { expectedVersion: data?.version ?? contract.version, idempotencyKey: key() },
    }),
  );
  const blocked = (data?.blockers.length ?? 1) > 0;
  return (
    <Dialog
      open
      onClose={activate.pending ? undefined : onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="activate-title"
    >
      <DialogTitle id="activate-title">{t('contract.activateTitle')}</DialogTitle>
      <DialogContent>
        {review.state.kind === 'loading' ? (
          <StateView variant="inline" kind="loading" title={t('states.loadingTitle')} />
        ) : review.state.kind === 'error' ? (
          <Alert severity="error">{errorMessage(review.state.error)}</Alert>
        ) : data ? (
          <Stack spacing={2.5} sx={{ paddingBlockStart: 1 }}>
            <DialogContentText>{t('contract.activateIntro')}</DialogContentText>
            <Box component="ul" sx={{ margin: 0, paddingInlineStart: 2.5, typography: 'body2' }}>
              <li>
                {t('contract.consequenceSchedule', { count: format.number(data.rows.length) })}
              </li>
              <li>{t('contract.consequenceUnit')}</li>
              <li>{t('contract.consequenceWon')}</li>
              <li>{t('contract.consequenceImmutable')}</li>
            </Box>
            {data.blockers.length > 0 ? (
              <Alert severity="error">
                <Box component="ul" sx={{ margin: 0, paddingInlineStart: 2.5 }}>
                  {data.blockers.map((blocker) => (
                    <li key={blocker}>{td(`contract.blocker.${blocker}`)}</li>
                  ))}
                </Box>
              </Alert>
            ) : null}
            {data.approvalRequired ? (
              <Alert severity="warning">{t('contract.approvalRequired')}</Alert>
            ) : (
              <Alert severity="info" variant="outlined">
                {t('contract.noApprovalRequired')}
              </Alert>
            )}
            {data.warnings.length > 0 ? (
              <Alert severity="warning" variant="outlined">
                <Box component="ul" sx={{ margin: 0, paddingInlineStart: 2.5 }}>
                  {data.warnings.map((warning) => (
                    <li key={warning}>{td(`contractWarning.${warning}`)}</li>
                  ))}
                </Box>
              </Alert>
            ) : null}
            <CardGrid min={180}>
              <Field label={t('fields.unit')}>
                <Verbatim>{contract.unitSnapshot?.code ?? '—'}</Verbatim>
              </Field>
              <Field label={t('contract.parties')}>
                {contract.parties
                  .map(
                    (party) =>
                      party.name ?? partyName(party.customerId) ?? t('contract.partyHidden'),
                  )
                  .join(' · ')}
              </Field>
              <Field label={t('sales.agreedPrice')}>
                <Verbatim>
                  {format.money(contract.pricing?.agreedPrice ?? contract.totalPrice)}
                </Verbatim>
              </Field>
              <Field label={t('sales.reservationAmount')}>
                <Verbatim>{format.money(data.reservationCredit)}</Verbatim>
              </Field>
            </CardGrid>
            <SchedulePreviewTable
              rows={data.rows}
              price={contract.pricing?.agreedPrice}
              maintenanceDeposit={contract.pricing?.maintenanceDeposit}
              total={data.total}
              caption={t('contract.proposedSchedule')}
            />
            <Alert severity="info" variant="outlined">
              {t('contract.legalNote')}
            </Alert>
            <FormControlLabel
              control={
                <Checkbox
                  checked={reviewed}
                  onChange={(event) => setReviewed(event.target.checked)}
                />
              }
              label={t('contract.reviewedConfirm')}
            />
            {activate.error ? (
              <Alert severity="error" role="alert">
                {errorMessage(activate.error)}
              </Alert>
            ) : null}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={activate.pending}>
          {t('actions.cancel')}
        </Button>
        <Button
          variant="contained"
          disabled={!data || blocked || !reviewed || activate.pending}
          onClick={() => void activate.run(undefined).then(onDone, () => undefined)}
        >
          {data?.approvalRequired ? t('contract.submitForApproval') : t('contract.activate')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface PartyRow {
  role: ContractPartyRole;
  customerId: string;
  sharePercent: string;
}

function PartiesDialog({
  contract,
  onClose,
  onDone,
}: {
  contract: Contract;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, td } = useLocale();
  const errorMessage = useErrorMessage();
  const customers = useApi<{ items: Customer[] }>(`/api/v1/crm/customers${query({ limit: 100 })}`);
  const [rows, setRows] = useState<PartyRow[]>(
    contract.parties.map((party) => ({
      role: party.role,
      customerId: party.customerId,
      sharePercent: party.sharePercent ?? '',
    })),
  );
  const names = new Map(
    (customers.state.kind === 'ready' ? customers.state.data.items : []).map((customer) => [
      customer.customerId,
      customer.name,
    ]),
  );
  for (const party of contract.parties)
    if (party.name && !names.has(party.customerId)) names.set(party.customerId, party.name);
  const save = useMutation(() =>
    apiRequest<Contract>(`/api/v1/sales/contracts/${contract.contractId}/parties`, {
      method: 'PUT',
      body: {
        parties: rows.map((row) => ({
          role: row.role,
          customerId: row.customerId,
          ...((row.role === 'buyer' || row.role === 'coBuyer') && row.sharePercent.trim()
            ? { sharePercent: row.sharePercent.trim() }
            : {}),
        })),
        expectedVersion: contract.version,
      },
    }),
  );
  const set = (index: number, patch: Partial<PartyRow>) =>
    setRows(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" aria-labelledby="parties-title">
      <DialogTitle id="parties-title">{t('contract.editParties')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ paddingBlockStart: 1 }}>
          <DialogContentText>{t('contract.partiesHint')}</DialogContentText>
          {rows.map((row, index) => {
            const isBuyer = row.role === 'buyer' && row.customerId === contract.customerId;
            return (
              <Box
                key={index}
                sx={{
                  display: 'grid',
                  gap: 1.5,
                  alignItems: 'start',
                  gridTemplateColumns: {
                    xs: 'minmax(0, 1fr)',
                    md: '180px minmax(0, 1fr) 140px auto',
                  },
                }}
              >
                <TextField
                  select
                  label={t('contract.partyRole')}
                  value={row.role}
                  disabled={isBuyer}
                  onChange={(event) =>
                    set(index, { role: event.target.value as ContractPartyRole })
                  }
                >
                  {CONTRACT_PARTY_ROLES.map((role) => (
                    <MenuItem key={role} value={role} disabled={role === 'buyer' && !isBuyer}>
                      {td(`contractPartyRole.${role}`)}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label={t('fields.customer')}
                  value={row.customerId}
                  disabled={isBuyer}
                  onChange={(event) => set(index, { customerId: event.target.value })}
                >
                  {[...names.entries()].map(([id, name]) => (
                    <MenuItem key={id} value={id}>
                      {name}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label={t('contract.share')}
                  value={row.sharePercent}
                  disabled={row.role !== 'buyer' && row.role !== 'coBuyer'}
                  onChange={(event) => set(index, { sharePercent: event.target.value })}
                  slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'decimal' } }}
                />
                <Tooltip title={t('contract.removeParty')}>
                  <span>
                    <IconButton
                      aria-label={t('contract.removeParty')}
                      disabled={isBuyer}
                      onClick={() => setRows(rows.filter((_, position) => position !== index))}
                    >
                      <Icon icon={X} size={18} />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            );
          })}
          <Box>
            <Button
              variant="outlined"
              size="small"
              startIcon={<Icon icon={Plus} size={16} />}
              disabled={rows.length >= 10}
              onClick={() =>
                setRows([...rows, { role: 'coBuyer', customerId: '', sharePercent: '' }])
              }
            >
              {t('contract.addParty')}
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary">
            {t('contract.sharesHint')}
          </Typography>
          {save.error ? (
            <Alert severity="error" role="alert">
              {errorMessage(save.error)}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        <Button
          variant="contained"
          disabled={save.pending || rows.some((row) => !row.customerId)}
          onClick={() => void save.run(undefined).then(onDone, () => undefined)}
        >
          {t('actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PlanDialog({
  contract,
  onClose,
  onDone,
}: {
  contract: Contract;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const errorMessage = useErrorMessage();
  const [plan, setPlan] = useState(planDraftFrom(contract.paymentPlan));
  const currency = contract.totalPrice.currency;
  const price = contract.pricing?.agreedPrice ?? contract.totalPrice;
  const preview = useSchedulePreview();
  const [shown, setShown] = useState<SchedulePreview | undefined>();
  const save = useMutation(() =>
    apiRequest<Contract>(`/api/v1/sales/contracts/${contract.contractId}/payment-plan`, {
      method: 'PUT',
      body: { paymentPlan: planRequest(plan, currency), expectedVersion: contract.version },
    }),
  );
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" aria-labelledby="plan-title">
      <DialogTitle id="plan-title">{t('contract.editPlan')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ paddingBlockStart: 1 }}>
          <DialogContentText>{t('contract.planHint')}</DialogContentText>
          <PaymentPlanEditor
            value={plan}
            onChange={(next) => {
              setPlan(next);
              setShown(undefined);
            }}
          />
          {preview.error ? (
            <Alert severity="error" role="alert">
              {errorMessage(preview.error)}
            </Alert>
          ) : null}
          {shown ? (
            <SchedulePreviewTable
              rows={shown.rows}
              price={shown.price}
              maintenanceDeposit={shown.maintenanceDeposit}
              total={shown.total}
              caption={t('plan.previewTitle')}
            />
          ) : null}
          {save.error ? (
            <Alert severity="error" role="alert">
              {errorMessage(save.error)}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        <Button
          variant="outlined"
          disabled={!planIsComplete(plan) || preview.pending}
          onClick={() =>
            void preview
              .run({ price: { amount: price.amount, currency }, plan: planRequest(plan, currency) })
              .then(setShown, () => setShown(undefined))
          }
        >
          {t('sales.previewSchedule')}
        </Button>
        <Button
          variant="contained"
          disabled={!shown || save.pending}
          onClick={() => void save.run(undefined).then(onDone, () => undefined)}
        >
          {t('actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function SigningDialog({
  contract,
  onClose,
  onDone,
}: {
  contract: Contract;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const errorMessage = useErrorMessage();
  const today = useToday();
  const [signedOn, setSignedOn] = useState<string>(today);
  const sign = useMutation(() =>
    apiRequest<Contract>(`/api/v1/sales/contracts/${contract.contractId}/signing`, {
      method: 'POST',
      body: { signedOn, expectedVersion: contract.version },
    }),
  );
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="sign-title">
      <DialogTitle id="sign-title">{t('contract.recordSigning')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ paddingBlockStart: 1 }}>
          <DialogContentText>{t('contract.signingHint')}</DialogContentText>
          <TextField
            label={t('contract.signedOn')}
            type="date"
            value={signedOn}
            onChange={(event) => setSignedOn(event.target.value)}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }}
          />
          {sign.error ? (
            <Alert severity="error" role="alert">
              {errorMessage(sign.error)}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!signedOn || sign.pending}
          onClick={() => void sign.run(undefined).then(onDone, () => undefined)}
        >
          {t('actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function AmendDialog({
  contract,
  onClose,
  onDone,
}: {
  contract: Contract;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, td } = useLocale();
  const errorMessage = useErrorMessage();
  const [installmentCount, setInstallmentCount] = useState('');
  const [frequency, setFrequency] = useState<InstallmentFrequency>(contract.paymentPlan.frequency);
  const [firstDueOn, setFirstDueOn] = useState('');
  const [finalPayment, setFinalPayment] = useState('');
  const [reason, setReason] = useState('');
  const amend = useMutation(() =>
    apiRequest<Contract>(`/api/v1/sales/contracts/${contract.contractId}/amendments`, {
      method: 'POST',
      body: {
        plan: {
          installmentCount: Number(installmentCount),
          frequency,
          firstDueOn,
          ...(finalPayment.trim()
            ? {
                finalPayment: {
                  amount: finalPayment.trim(),
                  currency: contract.totalPrice.currency,
                },
              }
            : {}),
        },
        reason: reason.trim(),
        expectedVersion: contract.version,
      },
    }),
  );
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="amend-title">
      <DialogTitle id="amend-title">{t('contract.amend')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ paddingBlockStart: 1 }}>
          <DialogContentText>{t('contract.amendHint')}</DialogContentText>
          <TextField
            label={t('sales.installmentCount')}
            value={installmentCount}
            onChange={(event) => setInstallmentCount(event.target.value)}
            required
            slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'numeric' } }}
          />
          <TextField
            select
            label={t('sales.frequency')}
            value={frequency}
            onChange={(event) => setFrequency(event.target.value as InstallmentFrequency)}
          >
            {INSTALLMENT_FREQUENCIES.map((value) => (
              <MenuItem key={value} value={value}>
                {td(`frequency.${value}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('sales.firstDueOn')}
            type="date"
            value={firstDueOn}
            onChange={(event) => setFirstDueOn(event.target.value)}
            required
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label={t('sales.finalPayment')}
            value={finalPayment}
            onChange={(event) => setFinalPayment(event.target.value)}
            helperText={t('plan.optional')}
            slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'decimal' } }}
          />
          <TextField
            label={t('fields.reason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            multiline
            minRows={2}
            helperText={t('confirm.reasonRequired')}
          />
          {amend.error ? (
            <Alert severity="error" role="alert">
              {errorMessage(amend.error)}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!installmentCount || !firstDueOn || reason.trim().length < 3 || amend.pending}
          onClick={() => void amend.run(undefined).then(onDone, () => undefined)}
        >
          {t('contract.submitAmendment')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CancelDialog({
  contract,
  onClose,
  onDone,
}: {
  contract: Contract;
  onClose: () => void;
  onDone: (next: Contract) => void;
}) {
  const { t } = useLocale();
  const errorMessage = useErrorMessage();
  const isDraft = contract.state === 'draft' || contract.state === 'pendingApproval';
  const [reason, setReason] = useState('');
  const [releaseUnit, setReleaseUnit] = useState(true);
  const cancel = useMutation(() =>
    apiRequest<Contract>(`/api/v1/sales/contracts/${contract.contractId}/cancel`, {
      method: 'POST',
      body: { reason: reason.trim(), releaseUnit },
    }),
  );
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="cancel-title">
      <DialogTitle id="cancel-title">
        {isDraft ? t('contract.withdrawDraft') : t('contract.cancel')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ paddingBlockStart: 1 }}>
          <DialogContentText>
            {isDraft ? t('contract.withdrawHint') : t('contract.cancelHint')}
          </DialogContentText>
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
          {!isDraft ? (
            <FormControlLabel
              control={
                <Checkbox
                  checked={releaseUnit}
                  onChange={(event) => setReleaseUnit(event.target.checked)}
                />
              }
              label={t('contract.releaseUnit')}
            />
          ) : null}
          {cancel.error ? (
            <Alert severity="error" role="alert">
              {errorMessage(cancel.error)}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        <Button
          variant="contained"
          color="error"
          disabled={reason.trim().length < 3 || cancel.pending}
          onClick={() => void cancel.run(undefined).then(onDone, () => undefined)}
        >
          {t('actions.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
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
  const today = useToday();
  const [amount, setAmount] = useState<string>(contract.outstandingAmount.amount);
  const [method, setMethod] = useState<(typeof METHODS)[number]>('bankTransfer');
  const [receivedOn, setReceivedOn] = useState<string>(today);
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
