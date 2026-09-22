import type {
  Customer,
  INSTALLMENT_FREQUENCIES,
  Lead,
  Reservation,
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
import { apiRequest } from '../api/client';
import { useApi, useIdempotencyKey, useMutation } from '../api/useApi';
import { useErrorMessage } from '../errors';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
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

type Frequency = (typeof INSTALLMENT_FREQUENCIES)[number];
const FREQUENCIES: Frequency[] = ['monthly', 'quarterly', 'semiAnnual', 'annual'];

/**
 * The guided reservation: customer → unit → payment plan → review.
 *
 * Two decisions worth stating.
 *
 * **The schedule preview comes from the server.** It would be easy to compute it here and quicker to
 * render, and then the numbers a customer approves on screen would be produced by different code from
 * the numbers stored on the contract. One implementation, one answer.
 *
 * **The idempotency key is generated once, when the wizard opens** — not when Reserve is pressed. A
 * double-click, a slow network and a retry all send the same key, so the unit is held once. Generating
 * it at submit time would defeat the whole mechanism.
 */
export default function ReservationNewPage() {
  return (
    <RequirePermission permission="sales.reservation.create">
      <ReservationWizard />
    </RequirePermission>
  );
}

function ReservationWizard() {
  const { t, locale, td } = useLocale();
  const format = useFormatters();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const [params] = useSearchParams();

  const leadIdParam = params.get('leadId') ?? '';
  const unitIdParam = params.get('unitId') ?? '';

  const [step, setStep] = useState(unitIdParam ? 1 : 0);
  const [customerId, setCustomerId] = useState('');
  const [unitId, setUnitId] = useState(unitIdParam);
  const [reservationAmount, setReservationAmount] = useState('100000');
  const [agreedPrice, setAgreedPrice] = useState('');
  const [downPayment, setDownPayment] = useState('600000');
  const [installmentCount, setInstallmentCount] = useState('12');
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [firstDueOn, setFirstDueOn] = useState('');
  const [preview, setPreview] = useState<SchedulePreview | undefined>();

  /** Generated once per wizard, so every retry of this reservation carries the same key. */
  const idempotencyKey = useIdempotencyKey('reservation');

  const customers = useApi<{ items: Customer[] }>('/api/v1/crm/customers');
  const lead = useApi<Lead>(leadIdParam ? `/api/v1/crm/leads/${leadIdParam}` : undefined);
  const availableUnits = useApi<UnitPage>('/api/v1/inventory/units?status=available&limit=50');
  const selectedUnit = useApi<Unit>(unitId ? `/api/v1/inventory/units/${unitId}` : undefined);

  const unit = selectedUnit.state.kind === 'ready' ? selectedUnit.state.data : undefined;
  const currency = unit?.currentPrice?.currency ?? 'EGP';
  const effectivePrice = agreedPrice || unit?.currentPrice?.amount || '';

  const previewMutation = useMutation<void, SchedulePreview>(() =>
    apiRequest<SchedulePreview>('/api/v1/sales/schedule/preview', {
      method: 'POST',
      body: {
        total: { amount: effectivePrice, currency },
        paymentPlan: {
          downPayment: { amount: downPayment || '0', currency },
          installmentCount: Number(installmentCount || '0'),
          frequency,
          firstDueOn,
        },
      },
    }),
  );

  const reserve = useMutation<void, Reservation>(() =>
    apiRequest<Reservation>('/api/v1/sales/reservations', {
      method: 'POST',
      body: {
        customerId,
        ...(leadIdParam ? { leadId: leadIdParam } : {}),
        unitId,
        reservationAmount: { amount: reservationAmount || '0', currency },
        agreedPrice: { amount: effectivePrice, currency },
        paymentPlan: {
          downPayment: { amount: downPayment || '0', currency },
          installmentCount: Number(installmentCount || '0'),
          frequency,
          firstDueOn,
        },
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
      setPreview(await previewMutation.run());
      setStep(3);
    } catch {
      /* rendered from previewMutation.error */
    }
  }

  async function submit() {
    try {
      const created = await reserve.run();
      void navigate(`/reservations/${created.reservationId}`);
    } catch {
      /* rendered from reserve.error */
    }
  }

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
        {lead.state.kind === 'ready' ? (
          <Alert severity="info" variant="outlined">
            {`${t('crm.leadDetails')}: ${lead.state.data.name}`}
          </Alert>
        ) : null}

        {step === 0 ? (
          <Panel title={t('sales.selectCustomer')}>
            <Stack spacing={2}>
              <TextField
                select
                label={t('fields.customer')}
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
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
              <Box>
                <Button variant="contained" disabled={!customerId} onClick={() => setStep(1)}>
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
                onRowClick={(row) => {
                  setUnitId(row.unitId);
                  setAgreedPrice(row.currentPrice?.amount ?? '');
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
            <Stack spacing={2}>
              {previewMutation.error ? (
                <Alert severity="error" role="alert">
                  {errorMessage(previewMutation.error)}
                </Alert>
              ) : null}
              <CardGrid min={200}>
                <TextField
                  label={t('sales.agreedPrice')}
                  value={agreedPrice}
                  onChange={(event) => setAgreedPrice(event.target.value)}
                  required
                  slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'decimal' } }}
                />
                <TextField
                  label={t('sales.reservationAmount')}
                  value={reservationAmount}
                  onChange={(event) => setReservationAmount(event.target.value)}
                  required
                  slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'decimal' } }}
                />
                <TextField
                  label={t('sales.downPayment')}
                  value={downPayment}
                  onChange={(event) => setDownPayment(event.target.value)}
                  slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'decimal' } }}
                />
                <TextField
                  label={t('sales.installmentCount')}
                  value={installmentCount}
                  onChange={(event) => setInstallmentCount(event.target.value)}
                  slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'numeric' } }}
                />
                <TextField
                  select
                  label={t('sales.frequency')}
                  value={frequency}
                  onChange={(event) => setFrequency(event.target.value as Frequency)}
                >
                  {FREQUENCIES.map((value) => (
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
              </CardGrid>
              <Stack direction="row" spacing={1}>
                <Button onClick={() => setStep(1)}>{t('actions.previous')}</Button>
                <Button
                  variant="contained"
                  disabled={!firstDueOn || !effectivePrice || previewMutation.pending}
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
                <Field label={t('fields.unit')}>
                  <Verbatim>{unit?.code ?? ''}</Verbatim>
                </Field>
                <Field label={t('sales.agreedPrice')}>
                  <Verbatim>{format.money({ amount: effectivePrice as never, currency })}</Verbatim>
                </Field>
                <Field label={t('sales.reservationAmount')}>
                  <Verbatim>
                    {format.money({ amount: reservationAmount as never, currency })}
                  </Verbatim>
                </Field>
                <Field label={t('sales.scheduleTotal')}>
                  <Verbatim>{format.money(preview.rowsTotal)}</Verbatim>
                </Field>
              </CardGrid>
              {/* The reconciliation is shown, not assumed: the server returns both totals. */}
              <Alert severity="success" variant="outlined" sx={{ marginBlockStart: 2 }}>
                {t('sales.scheduleReconciles')}
              </Alert>
            </Panel>

            <Panel title={t('sales.schedule')}>
              <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
                <Box component="thead">
                  <Box component="tr">
                    {[
                      t('fields.sequence'),
                      t('fields.dueDate'),
                      t('installmentKind.installment'),
                      t('fields.amount'),
                    ].map((header) => (
                      <Box
                        key={header}
                        component="th"
                        sx={{
                          textAlign: 'start',
                          padding: 1,
                          borderBlockEnd: 1,
                          borderColor: 'divider',
                          fontWeight: 700,
                        }}
                      >
                        {header}
                      </Box>
                    ))}
                  </Box>
                </Box>
                <Box component="tbody">
                  {preview.rows.map((row) => (
                    <Box component="tr" key={row.sequence}>
                      <Box
                        component="td"
                        sx={{ padding: 1, borderBlockEnd: 1, borderColor: 'divider' }}
                      >
                        <Verbatim>{format.number(row.sequence)}</Verbatim>
                      </Box>
                      <Box
                        component="td"
                        sx={{ padding: 1, borderBlockEnd: 1, borderColor: 'divider' }}
                      >
                        <Verbatim>{format.date(row.dueOn)}</Verbatim>
                      </Box>
                      <Box
                        component="td"
                        sx={{ padding: 1, borderBlockEnd: 1, borderColor: 'divider' }}
                      >
                        {td(`installmentKind.${row.kind}`)}
                      </Box>
                      <Box
                        component="td"
                        sx={{ padding: 1, borderBlockEnd: 1, borderColor: 'divider' }}
                      >
                        <Verbatim>{format.money(row.amount)}</Verbatim>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>
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
              {locale === 'ar' ? t('demo.dataNotice') : t('demo.dataNotice')}
            </Typography>
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
}
