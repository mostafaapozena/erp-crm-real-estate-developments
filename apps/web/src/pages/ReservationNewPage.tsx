import type {
  Customer,
  Lead,
  Opportunity,
  Quotation,
  Reservation,
  SalesDefaults,
  SchedulePreview,
  Unit,
  UnitPage,
} from '@alola/contracts';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DataTable, PageHeader, type DataColumn } from '@alola/ui';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { apiRequest, query } from '../api/client';
import { useApi, useIdempotencyKey, useMutation } from '../api/useApi';
import { useBranding } from '../branding';
import { useErrorMessage } from '../errors';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import {
  EMPTY_PLAN,
  PaymentPlanEditor,
  SchedulePreviewTable,
  planDraftFrom,
  planIsComplete,
  planRequest,
  useSchedulePreview,
  type PlanDraft,
} from './plan';
import {
  CardGrid,
  EnumChip,
  Field,
  Panel,
  RequirePermission,
  UNIT_TONES,
  Verbatim,
  tableStatus,
} from './shared';

/**
 * The guided reservation: customer → unit → payment plan → review.
 *
 * It opens from a lead, a customer, an opportunity or an active quotation, and takes what that record
 * already fixes: a quotation brings its customer, unit, price and plan; an opportunity its customer.
 * Nothing it brings is trusted — the server applies every reservation rule again (validity, deposit,
 * discount, approvals) exactly as for a reservation typed from nothing.
 *
 * **The schedule preview comes from the server**, from the code that stores schedules, and the
 * idempotency key is generated once, when the wizard opens — so a double-click holds the unit once.
 */
export default function ReservationNewPage() {
  return (
    <RequirePermission permission="sales.reservation.create">
      <ReservationWizard />
    </RequirePermission>
  );
}

function ReservationWizard() {
  const { t, td } = useLocale();
  const format = useFormatters();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const [params] = useSearchParams();

  const leadIdParam = params.get('leadId') ?? '';
  const unitIdParam = params.get('unitId') ?? '';
  const customerIdParam = params.get('customerId') ?? '';
  const opportunityIdParam = params.get('opportunityId') ?? '';
  const quotationIdParam = params.get('quotationId') ?? '';

  const quotation = useApi<{ items: Quotation[] }>(
    quotationIdParam ? `/api/v1/sales/quotations/${quotationIdParam}` : undefined,
  );
  const quoted =
    quotation.state.kind === 'ready' && quotation.state.data.items[0]?.state === 'active'
      ? quotation.state.data.items[0]
      : undefined;
  const opportunityId = opportunityIdParam || quoted?.opportunityId || '';
  const opportunity = useApi<Opportunity>(
    opportunityId ? `/api/v1/crm/opportunities/${opportunityId}` : undefined,
  );
  const leadId = leadIdParam || quoted?.leadId || '';
  const lead = useApi<Lead>(leadId ? `/api/v1/crm/leads/${leadId}` : undefined);

  const fixedCustomerId =
    customerIdParam ||
    quoted?.customerId ||
    (opportunity.state.kind === 'ready' ? opportunity.state.data.customerId : '');
  const fixedUnitId = unitIdParam || quoted?.unitId || '';

  const [step, setStep] = useState(0);
  const [chosenCustomerId, setChosenCustomerId] = useState('');
  const [chosenUnitId, setChosenUnitId] = useState('');
  const customerId = fixedCustomerId || chosenCustomerId;
  const unitId = chosenUnitId || fixedUnitId;
  const [reservationAmount, setReservationAmount] = useState('');
  const [agreedPrice, setAgreedPrice] = useState<string | undefined>();
  const [plan, setPlan] = useState<PlanDraft | undefined>();
  const [preview, setPreview] = useState<SchedulePreview | undefined>();

  /** Generated once per wizard, so every retry of this reservation carries the same key. */
  const idempotencyKey = useIdempotencyKey('reservation');

  const customers = useApi<{ items: Customer[] }>(
    fixedCustomerId ? undefined : `/api/v1/crm/customers${query({ limit: 100 })}`,
  );
  const fixedCustomer = useApi<Customer>(
    fixedCustomerId ? `/api/v1/crm/customers/${fixedCustomerId}` : undefined,
  );
  const availableUnits = useApi<UnitPage>(
    `/api/v1/inventory/units${query({ status: 'available', limit: 50 })}`,
  );
  const selectedUnit = useApi<Unit>(unitId ? `/api/v1/inventory/units/${unitId}` : undefined);
  const defaults = useApi<SalesDefaults>('/api/v1/sales/defaults');
  const validityDays =
    defaults.state.kind === 'ready' ? defaults.state.data.reservationValidityDays : null;

  const unit = selectedUnit.state.kind === 'ready' ? selectedUnit.state.data : undefined;
  const { baseCurrency } = useBranding();
  const currency =
    unit?.currentPrice?.currency ?? quoted?.agreedPrice.currency ?? baseCurrency ?? '';
  const quotedPrice = quoted && quoted.unitId === unitId ? quoted.agreedPrice.amount : undefined;
  const effectivePrice = agreedPrice ?? quotedPrice ?? unit?.currentPrice?.amount ?? '';
  const effectivePlan: PlanDraft =
    plan ?? (quoted && quoted.unitId === unitId ? planDraftFrom(quoted.paymentPlan) : EMPTY_PLAN);

  const previewMutation = useSchedulePreview();
  const reserve = useMutation(() =>
    apiRequest<Reservation>('/api/v1/sales/reservations', {
      method: 'POST',
      body: {
        customerId,
        ...(leadId ? { leadId } : {}),
        ...(opportunityId ? { opportunityId } : {}),
        unitId,
        reservationAmount: { amount: reservationAmount.trim() || '0', currency },
        agreedPrice: { amount: effectivePrice.trim(), currency },
        paymentPlan: planRequest(effectivePlan, currency),
        idempotencyKey: idempotencyKey(),
      },
    }),
  );

  const unitColumns = useMemo<DataColumn<UnitPage['items'][number]>[]>(
    () => [
      { key: 'code', header: t('fields.code'), render: (row) => <Verbatim>{row.code}</Verbatim> },
      {
        key: 'type',
        header: t('inventory.propertyType'),
        render: (row) => td(`propertyType.${row.propertyType}`),
      },
      {
        key: 'area',
        header: t('fields.area'),
        render: (row) => <Verbatim>{format.number(row.area, 2)}</Verbatim>,
      },
      {
        key: 'price',
        header: t('inventory.currentPrice'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.currentPrice)}</Verbatim>,
      },
      {
        key: 'status',
        header: t('fields.status'),
        render: (row) => <EnumChip namespace="unitStatus" value={row.status} tones={UNIT_TONES} />,
      },
    ],
    [format, t, td],
  );

  const steps = [
    t('sales.steps.customer'),
    t('sales.steps.unit'),
    t('sales.steps.plan'),
    t('sales.steps.review'),
  ];

  async function generatePreview() {
    try {
      setPreview(
        await previewMutation.run({
          price: { amount: effectivePrice.trim(), currency },
          plan: planRequest(effectivePlan, currency),
        }),
      );
      setStep(3);
    } catch {
      /* rendered from previewMutation.error */
    }
  }

  async function submit() {
    try {
      const created = await reserve.run(undefined);
      void navigate(`/reservations/${created.reservationId}`);
    } catch {
      /* rendered from reserve.error */
    }
  }

  const customerLabel =
    fixedCustomer.state.kind === 'ready' ? fixedCustomer.state.data.name : undefined;

  return (
    <Box>
      <PageHeader title={t('sales.newReservation')} subtitle={t('sales.reservationsSubtitle')} />

      <Stepper activeStep={step} sx={{ marginBlockEnd: 3 }} alternativeLabel>
        {steps.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      <Stack spacing={3}>
        {quoted ? (
          <Alert severity="info" variant="outlined">
            {t('reservationNew.fromQuotation', { number: quoted.quotationNumber })}
          </Alert>
        ) : null}
        {quotationIdParam && quotation.state.kind === 'ready' && !quoted ? (
          <Alert severity="warning">{t('reservationNew.quotationNotActive')}</Alert>
        ) : null}
        {lead.state.kind === 'ready' ? (
          <Alert severity="info" variant="outlined">
            {`${t('crm.leadDetails')}: ${lead.state.data.name}`}
          </Alert>
        ) : null}
        {validityDays === null && defaults.state.kind === 'ready' ? (
          <Alert severity="warning">{t('reservationNew.validityNotConfigured')}</Alert>
        ) : validityDays ? (
          <Alert severity="info" variant="outlined">
            {t('reservationNew.validity', { days: format.number(validityDays) })}
          </Alert>
        ) : null}

        {step === 0 ? (
          <Panel title={t('sales.selectCustomer')}>
            <Stack spacing={2}>
              {fixedCustomerId ? (
                <Field label={t('fields.customer')}>{customerLabel ?? '—'}</Field>
              ) : (
                <TextField
                  select
                  label={t('fields.customer')}
                  value={chosenCustomerId}
                  onChange={(event) => setChosenCustomerId(event.target.value)}
                  required
                >
                  {(customers.state.kind === 'ready' ? customers.state.data.items : []).map(
                    (customer) => (
                      <MenuItem key={customer.customerId} value={customer.customerId}>
                        {`${customer.name} — ${customer.primaryPhone}`}
                      </MenuItem>
                    ),
                  )}
                </TextField>
              )}
              <Box>
                <Button
                  variant="contained"
                  disabled={!customerId}
                  onClick={() => setStep(fixedUnitId ? 2 : 1)}
                >
                  {t('actions.next')}
                </Button>
              </Box>
            </Stack>
          </Panel>
        ) : null}

        {step === 1 ? (
          <Panel title={t('sales.selectUnitHint')}>
            <Stack spacing={2}>
              <DataTable
                columns={unitColumns}
                rows={availableUnits.state.kind === 'ready' ? availableUnits.state.data.items : []}
                rowKey={(row) => row.unitId}
                status={tableStatus(availableUnits.state)}
                caption={t('inventory.unitsTitle')}
                rowLabel={(row) => `${t('actions.selectUnit')}: ${row.code}`}
                onRowClick={(row) => {
                  setChosenUnitId(row.unitId);
                  setAgreedPrice(undefined);
                  setPlan(undefined);
                  setPreview(undefined);
                }}
                labels={{
                  loadingTitle: t('states.loadingTitle'),
                  emptyTitle: t('sales.noAvailableUnits'),
                  emptyDescription: t('states.noResultsHint'),
                  errorTitle: t('states.errorTitle'),
                  errorDescription: t('states.errorDescription'),
                  forbiddenTitle: t('states.forbiddenTitle'),
                  forbiddenDescription: t('states.forbiddenDescription'),
                }}
              />
              {unit ? (
                <Alert severity="success" variant="outlined">
                  {`${t('sales.selectedUnit')}: ${unit.code}`}
                </Alert>
              ) : null}
              <Stack direction="row" spacing={1}>
                <Button onClick={() => setStep(0)}>{t('actions.previous')}</Button>
                <Button variant="contained" disabled={!unitId} onClick={() => setStep(2)}>
                  {t('actions.next')}
                </Button>
              </Stack>
            </Stack>
          </Panel>
        ) : null}

        {step === 2 ? (
          <Panel title={t('sales.paymentPlan')}>
            <Stack spacing={3}>
              {previewMutation.error ? (
                <Alert severity="error" role="alert">
                  {errorMessage(previewMutation.error)}
                </Alert>
              ) : null}
              {unit ? (
                <Alert severity="success" variant="outlined">
                  {`${t('sales.selectedUnit')}: ${unit.code}`}
                </Alert>
              ) : null}
              <CardGrid min={220}>
                <TextField
                  label={t('sales.agreedPrice')}
                  value={effectivePrice}
                  onChange={(event) => setAgreedPrice(event.target.value)}
                  required
                  slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'decimal' } }}
                />
                <TextField
                  label={t('sales.reservationAmount')}
                  value={reservationAmount}
                  onChange={(event) => setReservationAmount(event.target.value)}
                  required
                  helperText={t('reservationNew.depositHint')}
                  slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'decimal' } }}
                />
              </CardGrid>
              <PaymentPlanEditor
                value={effectivePlan}
                onChange={(next) => {
                  setPlan(next);
                  setPreview(undefined);
                }}
              />
              <Stack direction="row" spacing={1}>
                <Button onClick={() => setStep(fixedUnitId ? 0 : 1)}>
                  {t('actions.previous')}
                </Button>
                <Button
                  variant="contained"
                  disabled={
                    !planIsComplete(effectivePlan) ||
                    !effectivePrice ||
                    !reservationAmount.trim() ||
                    previewMutation.pending
                  }
                  onClick={() => void generatePreview()}
                >
                  {t('sales.previewSchedule')}
                </Button>
              </Stack>
            </Stack>
          </Panel>
        ) : null}

        {step === 3 && preview ? (
          <Stack spacing={3}>
            <Panel title={t('sales.steps.review')}>
              <CardGrid min={200}>
                <Field label={t('fields.customer')}>
                  {customerLabel ??
                    (customers.state.kind === 'ready'
                      ? customers.state.data.items.find((row) => row.customerId === customerId)
                          ?.name
                      : undefined) ??
                    '—'}
                </Field>
                <Field label={t('fields.unit')}>
                  <Verbatim>{unit?.code ?? ''}</Verbatim>
                </Field>
                <Field label={t('sales.agreedPrice')}>
                  <Verbatim>{format.money(preview.price)}</Verbatim>
                </Field>
                <Field label={t('sales.reservationAmount')}>
                  <Verbatim>
                    {format.money({ amount: reservationAmount.trim() as never, currency })}
                  </Verbatim>
                </Field>
              </CardGrid>
              <Alert severity="success" variant="outlined" sx={{ marginBlockStart: 2 }}>
                {t('sales.scheduleReconciles')}
              </Alert>
            </Panel>

            <Panel title={t('sales.schedule')}>
              <SchedulePreviewTable
                rows={preview.rows}
                price={preview.price}
                maintenanceDeposit={preview.maintenanceDeposit}
                total={preview.total}
                caption={t('sales.schedule')}
              />
            </Panel>

            {reserve.error ? (
              <Alert severity="error" role="alert">
                {errorMessage(reserve.error)}
              </Alert>
            ) : null}

            <Stack direction="row" spacing={1}>
              <Button onClick={() => setStep(2)}>{t('actions.previous')}</Button>
              <Button variant="contained" disabled={reserve.pending} onClick={() => void submit()}>
                {t('actions.reserve')}
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {t('demo.dataNotice')}
            </Typography>
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
}
