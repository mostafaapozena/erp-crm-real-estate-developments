import type {
  Activity,
  Branch,
  ContractPage,
  Customer,
  CustomerFinancialSummary,
  InstallmentPage,
  Instrument,
  LeadPage,
  OwnershipChange,
  QuotationPage,
  Receipt,
  Reminder,
  ReservationPage,
  Unit,
} from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import {
  DataTable,
  Icon,
  MetricCard,
  PageHeader,
  StateView,
  type DataColumn,
  type DataTableStatus,
} from '@alola/ui';
import {
  CalendarCheck,
  Calculator,
  Coins,
  HandCoins,
  TriangleAlert,
  UserRound,
  Wallet,
} from '@alola/ui/icons';
import { useMemo, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';
import { query } from '../api/client';
import { useSession } from '../api/session';
import { useApi, type AsyncState } from '../api/useApi';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { PersonName } from '../people';
import { useBreadcrumbTail } from '../shell/breadcrumbs';
import { ActivityTimeline } from './activity';
import { IssuedDocumentsPanel } from './IssuedDocumentsPanel';
import { RecordLink, useProjectNames } from './lookups';
import { OpportunitiesPanel } from './opportunities';
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
  INSTRUMENT_TONES,
  LEAD_TONES,
  Panel,
  QUOTATION_TONES,
  RECEIPT_TONES,
  REMINDER_TONES,
  RESERVATION_TONES,
  RequirePermission,
  TableSection,
  Timeline,
  Transition,
  Verbatim,
  tableStatus,
  useTableLabels,
} from './shared';

/** How many rows each section shows. The page summarizes; the registers page through the rest. */
const SECTION_LIMIT = 10;

/**
 * The customer workspace (CRM-PERSON-004): one person or company and everything the viewer may see
 * about them — opportunities, quotations, reservations, contracts, instalments, receipts, cheques,
 * reminders, issued documents and the timeline.
 *
 * **Every section is its own scoped request under its own permission.** Nothing here widens what the
 * viewer may see: a section the viewer holds no permission for is not requested at all, and a record
 * outside the viewer's scope is simply absent from its section's answer (SEC-028). The identity is
 * shown only when the API returns it — it is field-restricted (SEC-029), and this page never asks
 * another endpoint for it. Each section shows a bounded summary; the registers page through the rest.
 */
export default function CustomerDetailPage() {
  return (
    <RequirePermission permission="crm.customer.view">
      <CustomerWorkspace />
    </RequirePermission>
  );
}

function CustomerWorkspace() {
  const { customerId } = useParams<{ customerId: string }>();
  const { t, td, locale } = useLocale();
  const { can } = useSession();
  const format = useFormatters();
  const customer = useApi<Customer>(customerId ? `/api/v1/crm/customers/${customerId}` : undefined);
  const record = customer.state.kind === 'ready' ? customer.state.data : undefined;
  useBreadcrumbTail(record?.name);

  const summary = useApi<CustomerFinancialSummary>(
    record && can('sales.contract.view')
      ? `/api/v1/sales/customers/${record.customerId}/summary`
      : undefined,
  );
  const branches = useApi<{ items: Branch[] }>(
    record && can('org.view') ? '/api/v1/organization/branches' : undefined,
  );
  const activities = useApi<{ items: Activity[] }>(
    record ? `/api/v1/crm/customers/${record.customerId}/activities` : undefined,
  );
  const ownership = useApi<{ items: OwnershipChange[] }>(
    record ? `/api/v1/crm/customers/${record.customerId}/ownership` : undefined,
  );

  if (customer.state.kind === 'loading') {
    return <StateView kind="loading" title={t('states.loadingTitle')} />;
  }
  if (customer.state.kind === 'error' || !record) {
    return customer.state.kind === 'error' ? (
      <ErrorState error={customer.state.error} onRetry={customer.reload} />
    ) : null;
  }

  const branch =
    branches.state.kind === 'ready'
      ? branches.state.data.items.find((item) => item.branchId === record.branchId)
      : undefined;
  const financial = summary.state.kind === 'ready' ? summary.state.data : undefined;
  const id = record.customerId;

  return (
    <Box>
      <BackLink to="/customers" label={t('detail.backTo', { list: t('nav.customers') })} />
      <PageHeader
        eyebrow={t('customerWorkspace.eyebrow')}
        title={record.name}
        status={<EnumChip namespace="customerKind" value={record.kind} tones={{}} />}
        meta={
          <>
            {record.alternateName ? <span>{record.alternateName}</span> : null}
            <Verbatim>{record.primaryPhone}</Verbatim>
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
              {`${t('fields.owner')}:`}
              <PersonName accountId={record.ownerAccountId} compact />
            </Box>
          </>
        }
        actions={
          <>
            {can('sales.quotation.manage') ? (
              <Button
                variant="outlined"
                color="inherit"
                component={RouterLink}
                to={`/quotations/new?customerId=${id}`}
                startIcon={<Icon icon={Calculator} size={18} />}
              >
                {t('quotations.new')}
              </Button>
            ) : null}
            {can('sales.reservation.create') ? (
              <Button
                variant="contained"
                component={RouterLink}
                to={`/reservations/new?customerId=${id}`}
                startIcon={<Icon icon={CalendarCheck} size={18} />}
              >
                {t('sales.newReservation')}
              </Button>
            ) : null}
          </>
        }
      />

      <Stack spacing={3}>
        {financial ? (
          <CardGrid min={200}>
            <MetricCard
              icon={Wallet}
              label={t('customerWorkspace.contracted')}
              value={format.money(financial.totalContracted)}
              hint={t('customerWorkspace.contractsCount', {
                count: format.number(financial.contracts),
              })}
            />
            <MetricCard
              icon={HandCoins}
              label={t('sales.paidAmount')}
              value={format.money(financial.totalPaid)}
            />
            <MetricCard
              icon={Coins}
              label={t('sales.outstandingAmount')}
              value={format.money(financial.totalOutstanding)}
            />
            <MetricCard
              icon={TriangleAlert}
              label={t('collections.overdueAmount')}
              value={format.money(financial.overdueAmount)}
              hint={t('detail.overdueInstallments', {
                count: format.number(financial.overdueCount),
              })}
              tone={financial.overdueCount > 0 ? 'attention' : 'default'}
            />
          </CardGrid>
        ) : null}

        <DetailLayout
          main={
            <>
              <Panel title={t('customerWorkspace.profile')} icon={UserRound}>
                <Stack spacing={3}>
                  <FieldGroup title={t('detail.contact')}>
                    <Field label={t('fields.phone')}>
                      <Verbatim>{record.primaryPhone}</Verbatim>
                    </Field>
                    {record.secondaryPhone ? (
                      <Field label={t('fields.secondaryPhone')}>
                        <Verbatim>{record.secondaryPhone}</Verbatim>
                      </Field>
                    ) : null}
                    <Field label={t('fields.email')}>
                      {record.email ? <Verbatim>{record.email}</Verbatim> : '—'}
                    </Field>
                    <Field label={t('fields.address')}>{record.address ?? '—'}</Field>
                    <Field label={t('customerWorkspace.city')}>{record.city ?? '—'}</Field>
                    <Field label={t('customerWorkspace.preferredLanguage')}>
                      {record.preferredLanguage
                        ? td(`issued.languageName.${record.preferredLanguage}`)
                        : '—'}
                    </Field>
                    <Field label={t('customerWorkspace.preferredChannel')}>
                      {record.preferredChannel
                        ? td(`contactChannel.${record.preferredChannel}`)
                        : '—'}
                    </Field>
                  </FieldGroup>
                  <FieldGroup title={t('customerWorkspace.identity')}>
                    {record.identity ? (
                      <>
                        <Field label={t('customerWorkspace.identityType')}>
                          {td(`identityType.${record.identity.type}`)}
                        </Field>
                        <Field label={t('customerWorkspace.identityNumber')}>
                          <Verbatim>{record.identity.number}</Verbatim>
                        </Field>
                      </>
                    ) : (
                      <Box
                        sx={{ gridColumn: '1 / -1', typography: 'body2', color: 'text.secondary' }}
                      >
                        {can('crm.customer.viewIdentity')
                          ? t('customerWorkspace.identityNone')
                          : t('customerWorkspace.identityRestricted')}
                      </Box>
                    )}
                  </FieldGroup>
                  <FieldGroup title={t('detail.ownership')}>
                    <Field label={t('fields.owner')}>
                      <PersonName accountId={record.ownerAccountId} showTitle />
                    </Field>
                    <Field label={t('fields.branch')}>{branch ? branch.name[locale] : '—'}</Field>
                    <Field label={t('fields.createdAt')}>
                      <Verbatim>{format.dateTime(record.createdAt)}</Verbatim>
                    </Field>
                  </FieldGroup>
                </Stack>
              </Panel>

              {can('crm.opportunity.view') ? <OpportunitiesPanel customerId={id} /> : null}
              {can('sales.quotation.view') ? <QuotationsSection customerId={id} /> : null}
              {can('sales.reservation.view') ? <ReservationsSection customerId={id} /> : null}
              {can('sales.contract.view') ? <ContractsSection customerId={id} /> : null}
              {can('collection.installment.view') ? <InstallmentsSection customerId={id} /> : null}
              {can('collection.receipt.view') ? <ReceiptsSection customerId={id} /> : null}
              {can('collection.instrument.view') ? <InstrumentsSection customerId={id} /> : null}
              {can('collection.reminder.view') ? <RemindersSection customerId={id} /> : null}
            </>
          }
          aside={
            <>
              <IssuedDocumentsPanel
                sourceType="customer"
                sourceId={id}
                types={['customerStatement']}
                title={t('issued.statementTitle')}
                description={t('issued.statementDescription')}
              />
              {can('crm.lead.view') ? <LeadsSection customerId={id} /> : null}
              <ActivityTimeline activities={activities.state} title={t('crm.timeline')} />
              <OwnershipHistory state={ownership.state} />
            </>
          }
        />
      </Stack>
    </Box>
  );
}

/* ------------------------------------------------------------------ sections */

function sectionStatus(state: AsyncState<unknown>): DataTableStatus {
  return tableStatus(state);
}

function Section<T>({
  title,
  path,
  columns,
  rowKey,
  onOpen,
  rowLabel,
  emptyTitle,
  pick,
  footer,
}: {
  title: string;
  path: string;
  columns: DataColumn<T>[];
  rowKey: (row: T) => string;
  onOpen?: (row: T) => void;
  rowLabel?: (row: T) => string;
  emptyTitle: string;
  pick: (data: unknown) => { items: T[]; total?: number };
  footer?: ReactNode;
}) {
  const { t } = useLocale();
  const format = useFormatters();
  const labels = useTableLabels();
  const answer = useApi<unknown>(path);
  const picked = answer.state.kind === 'ready' ? pick(answer.state.data) : { items: [] as T[] };
  const total = picked.total;
  return (
    <TableSection title={title}>
      <DataTable
        columns={columns}
        rows={picked.items}
        rowKey={rowKey}
        status={sectionStatus(answer.state)}
        caption={title}
        labels={{ ...labels, emptyTitle, emptyDescription: '' }}
        {...(onOpen ? { onRowClick: onOpen } : {})}
        {...(rowLabel ? { rowLabel } : {})}
        errorAction={
          <Button variant="outlined" onClick={answer.reload}>
            {t('states.retry')}
          </Button>
        }
        {...(total !== undefined && total > picked.items.length
          ? {
              footer: (
                <>
                  {t('pagination.showing', {
                    shown: format.number(picked.items.length),
                    total: format.number(total),
                  })}
                  {footer}
                </>
              ),
            }
          : footer
            ? { footer }
            : {})}
      />
    </TableSection>
  );
}

function UnitCode({ unitId }: { unitId: string }) {
  const { can } = useSession();
  const unit = useApi<Unit>(
    can('inventory.unit.view') ? `/api/v1/inventory/units/${unitId}` : undefined,
  );
  return unit.state.kind === 'ready' ? (
    <RecordLink to={`/units/${unitId}`}>
      <Verbatim>{unit.state.data.code}</Verbatim>
    </RecordLink>
  ) : (
    <>—</>
  );
}

function QuotationsSection({ customerId }: { customerId: string }) {
  const { t } = useLocale();
  const format = useFormatters();
  const navigate = useNavigate();
  type Row = QuotationPage['items'][number];
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      {
        key: 'number',
        header: t('quotations.number'),
        render: (row) => <Verbatim>{row.quotationNumber}</Verbatim>,
      },
      {
        key: 'unit',
        header: t('fields.unit'),
        render: (row) => <Verbatim>{row.unitCode}</Verbatim>,
      },
      {
        key: 'valid',
        header: t('quotations.validUntil'),
        render: (row) => <Verbatim>{format.date(row.validUntil)}</Verbatim>,
      },
      {
        key: 'total',
        header: t('fields.total'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.total)}</Verbatim>,
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
  return (
    <Section<Row>
      title={t('quotations.title')}
      path={`/api/v1/sales/quotations${query({ customerId, limit: SECTION_LIMIT })}`}
      columns={columns}
      rowKey={(row) => row.quotationId}
      onOpen={(row) => void navigate(`/quotations/${row.quotationId}`)}
      rowLabel={(row) => t('list.open', { label: row.quotationNumber })}
      emptyTitle={t('quotations.empty')}
      pick={(data) => data as QuotationPage}
    />
  );
}

function ReservationsSection({ customerId }: { customerId: string }) {
  const { t } = useLocale();
  const format = useFormatters();
  const navigate = useNavigate();
  type Row = ReservationPage['items'][number];
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      {
        key: 'number',
        header: t('sales.reservationNumber'),
        render: (row) => <Verbatim>{row.reservationNumber}</Verbatim>,
      },
      { key: 'unit', header: t('fields.unit'), render: (row) => <UnitCode unitId={row.unitId} /> },
      {
        key: 'reserved',
        header: t('sales.reservedOn'),
        render: (row) => <Verbatim>{format.date(row.reservedOn)}</Verbatim>,
      },
      {
        key: 'price',
        header: t('sales.agreedPrice'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.agreedPrice)}</Verbatim>,
      },
      {
        key: 'state',
        header: t('fields.state'),
        render: (row) => (
          <EnumChip namespace="reservationState" value={row.state} tones={RESERVATION_TONES} />
        ),
      },
    ],
    [format, t],
  );
  return (
    <Section<Row>
      title={t('nav.reservations')}
      path={`/api/v1/sales/reservations${query({ customerId, limit: SECTION_LIMIT })}`}
      columns={columns}
      rowKey={(row) => row.reservationId}
      onOpen={(row) => void navigate(`/reservations/${row.reservationId}`)}
      rowLabel={(row) => t('list.open', { label: row.reservationNumber })}
      emptyTitle={t('customerWorkspace.noReservations')}
      pick={(data) => data as ReservationPage}
    />
  );
}

function ContractsSection({ customerId }: { customerId: string }) {
  const { t } = useLocale();
  const format = useFormatters();
  const navigate = useNavigate();
  const projectName = useProjectNames();
  type Row = ContractPage['items'][number];
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      {
        key: 'number',
        header: t('sales.contractNumber'),
        render: (row) => <Verbatim>{row.contractNumber}</Verbatim>,
      },
      {
        key: 'unit',
        header: t('fields.unit'),
        render: (row) =>
          row.unitSnapshot ? (
            <Box>
              <RecordLink to={`/units/${row.unitId}`}>
                <Verbatim>{row.unitSnapshot.code}</Verbatim>
              </RecordLink>
              <Box component="div" sx={{ typography: 'caption', color: 'text.secondary' }}>
                {projectName(row.projectId) ?? ''}
              </Box>
            </Box>
          ) : (
            <UnitCode unitId={row.unitId} />
          ),
      },
      {
        key: 'total',
        header: t('sales.totalPrice'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.totalPrice)}</Verbatim>,
      },
      {
        key: 'outstanding',
        header: t('sales.outstandingAmount'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.outstandingAmount)}</Verbatim>,
        secondary: true,
      },
      {
        key: 'state',
        header: t('fields.state'),
        render: (row) => (
          <EnumChip namespace="contractState" value={row.state} tones={CONTRACT_TONES} />
        ),
      },
    ],
    [format, projectName, t],
  );
  return (
    <Section<Row>
      title={t('nav.contracts')}
      path={`/api/v1/sales/contracts${query({ customerId, limit: SECTION_LIMIT })}`}
      columns={columns}
      rowKey={(row) => row.contractId}
      onOpen={(row) => void navigate(`/contracts/${row.contractId}`)}
      rowLabel={(row) => t('list.open', { label: row.contractNumber })}
      emptyTitle={t('customerWorkspace.noContracts')}
      pick={(data) => data as ContractPage}
    />
  );
}

function InstallmentsSection({ customerId }: { customerId: string }) {
  const { t } = useLocale();
  const format = useFormatters();
  type Row = InstallmentPage['items'][number];
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      {
        key: 'due',
        header: t('fields.dueDate'),
        render: (row) => <Verbatim>{format.date(row.dueOn)}</Verbatim>,
      },
      {
        key: 'kind',
        header: t('plan.rowKind'),
        render: (row) => <EnumChip namespace="installmentKind" value={row.kind} tones={{}} />,
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
    [format, t],
  );
  return (
    <>
      <Section<Row>
        title={t('customerWorkspace.overdueInstallments')}
        path={`/api/v1/sales/installments${query({ customerId, bucket: 'overdue', limit: SECTION_LIMIT })}`}
        columns={columns}
        rowKey={(row) => row.installmentId}
        emptyTitle={t('customerWorkspace.noOverdue')}
        pick={(data) => data as InstallmentPage}
      />
      <Section<Row>
        title={t('customerWorkspace.upcomingInstallments')}
        path={`/api/v1/sales/installments${query({ customerId, bucket: 'upcoming', withinDays: 90, limit: SECTION_LIMIT })}`}
        columns={columns}
        rowKey={(row) => row.installmentId}
        emptyTitle={t('customerWorkspace.noUpcoming')}
        pick={(data) => data as InstallmentPage}
      />
    </>
  );
}

function ReceiptsSection({ customerId }: { customerId: string }) {
  const { t } = useLocale();
  const format = useFormatters();
  const navigate = useNavigate();
  const columns = useMemo<DataColumn<Receipt>[]>(
    () => [
      {
        key: 'number',
        header: t('fields.reference'),
        render: (row) => <Verbatim>{row.receiptNumber}</Verbatim>,
      },
      {
        key: 'date',
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
        key: 'state',
        header: t('fields.state'),
        render: (row) => (
          <EnumChip namespace="receiptState" value={row.state} tones={RECEIPT_TONES} />
        ),
      },
    ],
    [format, t],
  );
  return (
    <Section<Receipt>
      title={t('nav.receipts')}
      path={`/api/v1/collections/receipts${query({ customerId, limit: SECTION_LIMIT })}`}
      columns={columns}
      rowKey={(row) => row.receiptId}
      onOpen={(row) => void navigate(`/receipts/${row.receiptId}`)}
      rowLabel={(row) => t('list.open', { label: row.receiptNumber })}
      emptyTitle={t('customerWorkspace.noReceipts')}
      pick={(data) => data as { items: Receipt[]; total?: number }}
    />
  );
}

function InstrumentsSection({ customerId }: { customerId: string }) {
  const { t } = useLocale();
  const format = useFormatters();
  const columns = useMemo<DataColumn<Instrument>[]>(
    () => [
      {
        key: 'kind',
        header: t('fields.reference'),
        render: (row) => (
          <Box>
            <Verbatim>{row.instrumentNumber}</Verbatim>
            <Box component="div" sx={{ typography: 'caption', color: 'text.secondary' }}>
              <EnumChip namespace="instrumentKind" value={row.kind} tones={{}} />
            </Box>
          </Box>
        ),
      },
      {
        key: 'due',
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
        key: 'state',
        header: t('fields.state'),
        render: (row) => (
          <EnumChip namespace="instrumentState" value={row.state} tones={INSTRUMENT_TONES} />
        ),
      },
    ],
    [format, t],
  );
  return (
    <Section<Instrument>
      title={t('nav.instruments')}
      path={`/api/v1/collections/instruments${query({ customerId, limit: SECTION_LIMIT })}`}
      columns={columns}
      rowKey={(row) => row.instrumentId}
      emptyTitle={t('customerWorkspace.noInstruments')}
      pick={(data) => data as { items: Instrument[]; total?: number }}
    />
  );
}

function RemindersSection({ customerId }: { customerId: string }) {
  const { t } = useLocale();
  const format = useFormatters();
  const columns = useMemo<DataColumn<Reminder>[]>(
    () => [
      {
        key: 'due',
        header: t('fields.dueDate'),
        render: (row) => <Verbatim>{format.date(row.dueOn)}</Verbatim>,
      },
      {
        key: 'channel',
        header: t('customerWorkspace.channel'),
        render: (row) => <EnumChip namespace="reminderChannel" value={row.channel} tones={{}} />,
      },
      {
        key: 'amount',
        header: t('fields.amount'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.amount)}</Verbatim>,
      },
      {
        key: 'state',
        header: t('fields.state'),
        render: (row) => (
          <EnumChip namespace="reminderState" value={row.state} tones={REMINDER_TONES} />
        ),
      },
    ],
    [format, t],
  );
  return (
    <Section<Reminder>
      title={t('nav.reminders')}
      path={`/api/v1/collections/reminders${query({ customerId, limit: SECTION_LIMIT })}`}
      columns={columns}
      rowKey={(row) => row.reminderId}
      emptyTitle={t('customerWorkspace.noReminders')}
      pick={(data) => data as { items: Reminder[]; total?: number }}
    />
  );
}

function LeadsSection({ customerId }: { customerId: string }) {
  const { t } = useLocale();
  const format = useFormatters();
  const navigate = useNavigate();
  type Row = LeadPage['items'][number];
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      {
        key: 'created',
        header: t('fields.createdAt'),
        render: (row) => <Verbatim>{format.date(row.createdAt.slice(0, 10))}</Verbatim>,
      },
      {
        key: 'source',
        header: t('crm.source'),
        render: (row) => <EnumChip namespace="leadSource" value={row.source} tones={{}} />,
      },
      {
        key: 'stage',
        header: t('crm.stage'),
        render: (row) => <EnumChip namespace="leadStage" value={row.stage} tones={LEAD_TONES} />,
      },
    ],
    [format, t],
  );
  return (
    <Section<Row>
      title={t('customerWorkspace.leads')}
      path={`/api/v1/crm/leads${query({ customerId, limit: SECTION_LIMIT })}`}
      columns={columns}
      rowKey={(row) => row.leadId}
      onOpen={(row) => void navigate(`/leads/${row.leadId}`)}
      rowLabel={(row) => t('list.open', { label: row.name })}
      emptyTitle={t('customerWorkspace.noLeads')}
      pick={(data) => data as LeadPage}
    />
  );
}

function OwnershipHistory({ state }: { state: AsyncState<{ items: OwnershipChange[] }> }) {
  const { t } = useLocale();
  const format = useFormatters();
  if (state.kind === 'error') return null;
  return (
    <Panel title={t('customerWorkspace.ownershipHistory')}>
      {state.kind === 'loading' ? (
        <StateView variant="inline" kind="loading" title={t('states.loadingTitle')} />
      ) : (
        <Timeline
          emptyLabel={t('customerWorkspace.noOwnershipChanges')}
          entries={state.data.items.map((change) => ({
            key: change.changeId,
            title: change.fromAccountId ? (
              <Transition
                from={<PersonName accountId={change.fromAccountId} compact />}
                to={<PersonName accountId={change.toAccountId} compact />}
              />
            ) : (
              <PersonName accountId={change.toAccountId} compact />
            ),
            when: format.dateTime(change.occurredAt),
            body: change.reason,
          }))}
        />
      )}
    </Panel>
  );
}
