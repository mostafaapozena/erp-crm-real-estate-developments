import {
  addDays,
  type Customer,
  type Lead,
  type Opportunity,
  type Quotation,
  type SalesDefaults,
  type SchedulePreview,
  type Unit,
  type UnitPage,
} from '@alola/contracts';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { PageHeader } from '@alola/ui';
import { Calculator, CalendarClock, House, UserRound } from '@alola/ui/icons';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { apiRequest, query } from '../api/client';
import { useApi, useIdempotencyKey, useMutation } from '../api/useApi';
import { useBranding } from '../branding';
import { useErrorMessage } from '../errors';
import { useFormatters, useToday } from '../format';
import { useLocale } from '../locale';
import {
  EMPTY_PLAN,
  PaymentPlanEditor,
  SchedulePreviewTable,
  planIsComplete,
  planRequest,
  useSchedulePreview,
  type PlanDraft,
} from './plan';
import { BackLink, CardGrid, Field, Panel, RequirePermission, Verbatim } from './shared';

/**
 * A new quotation (SALE-QUOTE-001), opened from a customer, a lead, an opportunity or a unit — whichever
 * the address names is fixed, the rest is chosen here.
 *
 * What the page says plainly, because the difference matters to a customer: **a quotation reserves
 * nothing.** The unit stays on sale, no instalment exists and no contract follows from it. The price
 * starts at the unit's current price as the person may see it; the schedule is the server's; the
 * validity is proposed from `sales.quotationValidityDays` only when a deployment configured one
 * (`BD-36`), and is otherwise the person's own choice.
 */
export default function QuotationNewPage() {
  return (
    <RequirePermission permission="sales.quotation.manage">
      <QuotationForm />
    </RequirePermission>
  );
}

function QuotationForm() {
  const { t, locale } = useLocale();
  const format = useFormatters();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const today = useToday();
  const [params] = useSearchParams();
  const opportunityId = params.get('opportunityId') ?? '';
  const leadId = params.get('leadId') ?? '';
  const fixedCustomerId = params.get('customerId') ?? '';
  const fixedUnitId = params.get('unitId') ?? '';

  const opportunity = useApi<Opportunity>(
    opportunityId ? `/api/v1/crm/opportunities/${opportunityId}` : undefined,
  );
  const lead = useApi<Lead>(leadId ? `/api/v1/crm/leads/${leadId}` : undefined);
  const opportunityCustomer =
    opportunity.state.kind === 'ready' ? opportunity.state.data.customerId : '';
  const recipientFixed = Boolean(fixedCustomerId || opportunityId || leadId);

  const [chosenCustomerId, setChosenCustomerId] = useState('');
  const customerId = fixedCustomerId || opportunityCustomer || chosenCustomerId;
  const customers = useApi<{ items: Customer[] }>(
    recipientFixed ? undefined : `/api/v1/crm/customers${query({ limit: 100 })}`,
  );
  const fixedCustomer = useApi<Customer>(
    recipientFixed && customerId ? `/api/v1/crm/customers/${customerId}` : undefined,
  );

  const [chosenUnitId, setChosenUnitId] = useState('');
  const unitId = fixedUnitId || chosenUnitId;
  const units = useApi<UnitPage>(
    fixedUnitId
      ? undefined
      : `/api/v1/inventory/units${query({ status: 'available', limit: 100 })}`,
  );
  const unit = useApi<Unit>(unitId ? `/api/v1/inventory/units/${unitId}` : undefined);
  const unitData = unit.state.kind === 'ready' ? unit.state.data : undefined;
  const { baseCurrency } = useBranding();
  const currency = unitData?.currentPrice?.currency ?? baseCurrency ?? '';

  const defaults = useApi<SalesDefaults>('/api/v1/sales/defaults');
  const validityDays =
    defaults.state.kind === 'ready' ? defaults.state.data.quotationValidityDays : null;

  const [agreedPrice, setAgreedPrice] = useState<string | undefined>();
  const price = agreedPrice ?? unitData?.currentPrice?.amount ?? '';
  const [validUntil, setValidUntil] = useState<string | undefined>();
  const validity = validUntil ?? (validityDays ? addDays(today, validityDays) : '');
  const [notes, setNotes] = useState('');
  const [plan, setPlan] = useState<PlanDraft>(EMPTY_PLAN);
  const [preview, setPreview] = useState<SchedulePreview | undefined>();

  const previewMutation = useSchedulePreview();
  const idempotencyKey = useIdempotencyKey('quotation');
  const create = useMutation(() =>
    apiRequest<Quotation>('/api/v1/sales/quotations', {
      method: 'POST',
      body: {
        ...(customerId ? { customerId } : {}),
        ...(leadId ? { leadId } : {}),
        ...(opportunityId ? { opportunityId } : {}),
        unitId,
        agreedPrice: { amount: price.trim(), currency },
        paymentPlan: planRequest(plan, currency),
        validUntil: validity,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        idempotencyKey: idempotencyKey(),
      },
    }),
  );

  const recipientName =
    fixedCustomer.state.kind === 'ready'
      ? fixedCustomer.state.data.name
      : lead.state.kind === 'ready'
        ? lead.state.data.name
        : undefined;
  const ready = Boolean(
    (customerId || leadId) && unitId && currency && price && validity && planIsComplete(plan),
  );

  async function runPreview() {
    try {
      setPreview(
        await previewMutation.run({
          price: { amount: price.trim(), currency },
          plan: planRequest(plan, currency),
        }),
      );
    } catch {
      setPreview(undefined);
    }
  }

  async function submit() {
    try {
      const created = await create.run(undefined);
      void navigate(`/quotations/${created.quotationId}`);
    } catch {
      /* shown below */
    }
  }

  const back = opportunityId || fixedCustomerId ? `/customers/${customerId}` : '/quotations';

  return (
    <Box>
      <BackLink to={back} label={t('detail.backTo', { list: t('nav.quotations') })} />
      <PageHeader title={t('quotations.new')} subtitle={t('quotations.newSubtitle')} />
      <Stack spacing={3}>
        <Alert severity="info" variant="outlined">
          {t('quotations.noReservation')}
        </Alert>

        <Panel title={t('quotations.recipient')} icon={UserRound}>
          {recipientFixed ? (
            <CardGrid min={220}>
              <Field label={leadId && !customerId ? t('detail.lead') : t('fields.customer')}>
                {recipientName ?? '—'}
              </Field>
              {opportunityId ? (
                <Field label={t('opportunities.one')}>{t('opportunities.linked')}</Field>
              ) : null}
            </CardGrid>
          ) : (
            <TextField
              select
              fullWidth
              label={t('fields.customer')}
              value={chosenCustomerId}
              onChange={(event) => setChosenCustomerId(event.target.value)}
              required
              helperText={t('quotations.customerHint')}
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
        </Panel>

        <Panel title={t('fields.unit')} icon={House}>
          <Stack spacing={2}>
            {fixedUnitId ? null : (
              <TextField
                select
                fullWidth
                label={t('quotations.chooseUnit')}
                value={chosenUnitId}
                onChange={(event) => {
                  setChosenUnitId(event.target.value);
                  setAgreedPrice(undefined);
                  setPreview(undefined);
                }}
                required
              >
                {(units.state.kind === 'ready' ? units.state.data.items : []).map((row) => (
                  <MenuItem key={row.unitId} value={row.unitId}>
                    {row.code}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {unitData ? (
              <CardGrid min={180}>
                <Field label={t('fields.code')}>
                  <Verbatim>{unitData.code}</Verbatim>
                </Field>
                <Field label={t('inventory.currentPrice')}>
                  <Verbatim>{format.money(unitData.currentPrice)}</Verbatim>
                </Field>
                <Field label={t('fields.area')}>
                  <Verbatim>{format.number(unitData.area, 2)}</Verbatim>
                </Field>
              </CardGrid>
            ) : null}
            {unitData && !unitData.currentPrice ? (
              <Alert severity="warning">{t('quotations.priceHidden')}</Alert>
            ) : null}
          </Stack>
        </Panel>

        <Panel title={t('quotations.terms')} icon={Calculator}>
          <Stack spacing={3}>
            <CardGrid min={220}>
              <TextField
                label={t('sales.agreedPrice')}
                value={price}
                onChange={(event) => {
                  setAgreedPrice(event.target.value);
                  setPreview(undefined);
                }}
                required
                slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'decimal' } }}
              />
              <TextField
                label={t('quotations.validUntil')}
                type="date"
                value={validity}
                onChange={(event) => setValidUntil(event.target.value)}
                required
                helperText={
                  validityDays
                    ? t('quotations.validityConfigured', { days: format.number(validityDays) })
                    : t('quotations.validityNotConfigured')
                }
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: today } }}
              />
            </CardGrid>
            <PaymentPlanEditor
              value={plan}
              onChange={(next) => {
                setPlan(next);
                setPreview(undefined);
              }}
            />
            <TextField
              label={t('fields.notes')}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              multiline
              minRows={2}
              slotProps={{ htmlInput: { maxLength: 2000 } }}
            />
          </Stack>
        </Panel>

        <Panel
          title={t('plan.previewTitle')}
          icon={CalendarClock}
          description={t('plan.previewHint')}
        >
          <Stack spacing={2}>
            {previewMutation.error ? (
              <Alert severity="error" role="alert">
                {errorMessage(previewMutation.error)}
              </Alert>
            ) : null}
            {preview ? (
              <SchedulePreviewTable
                rows={preview.rows}
                price={preview.price}
                maintenanceDeposit={preview.maintenanceDeposit}
                total={preview.total}
                caption={t('plan.previewTitle')}
              />
            ) : null}
            <Box>
              <Button
                variant="outlined"
                disabled={!price || !planIsComplete(plan) || previewMutation.pending}
                onClick={() => void runPreview()}
              >
                {t('sales.previewSchedule')}
              </Button>
            </Box>
          </Stack>
        </Panel>

        {create.error ? (
          <Alert severity="error" role="alert">
            {errorMessage(create.error)}
          </Alert>
        ) : null}
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button onClick={() => void navigate(back)}>{t('actions.cancel')}</Button>
          <Button
            variant="contained"
            disabled={!ready || !preview || create.pending}
            onClick={() => void submit()}
          >
            {t('quotations.create')}
          </Button>
        </Stack>
        {!preview && ready ? (
          <Box
            sx={{ textAlign: 'end', typography: 'caption', color: 'text.secondary' }}
            lang={locale}
          >
            {t('quotations.previewFirst')}
          </Box>
        ) : null}
      </Stack>
    </Box>
  );
}
