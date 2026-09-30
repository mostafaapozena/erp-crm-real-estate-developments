import {
  INSTALLMENT_FREQUENCIES,
  MAX_MILESTONES,
  type InstallmentFrequency,
  type PaymentPlan,
  type SchedulePreview,
} from '@alola/contracts';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { Icon } from '@alola/ui';
import { Plus, X } from '@alola/ui/icons';
import { apiRequest } from '../api/client';
import { useMutation } from '../api/useApi';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { CardGrid, Field, Verbatim } from './shared';

/**
 * The payment-plan editor and the schedule preview, shared by quotations, reservations and contract
 * drafts (COL-SCHEDULE-001).
 *
 * **No arithmetic happens here.** The editor holds what the person typed, as text, and turns it into
 * the request shape; the rows, the totals and every refusal come from the server's schedule builder —
 * the same function that stores a schedule. A total computed in the browser would be a second answer
 * that can disagree with the first, and it would pass money through binary floating point.
 */

export interface MilestoneDraft {
  dueOn: string;
  amount: string;
  labelAr: string;
  labelEn: string;
}

export interface PlanDraft {
  downPayment: string;
  downPaymentDueOn: string;
  installmentCount: string;
  frequency: InstallmentFrequency;
  firstDueOn: string;
  finalPayment: string;
  milestones: MilestoneDraft[];
  maintenanceAmount: string;
  maintenanceDueOn: string;
}

export const EMPTY_PLAN: PlanDraft = {
  downPayment: '',
  downPaymentDueOn: '',
  installmentCount: '',
  frequency: 'monthly',
  firstDueOn: '',
  finalPayment: '',
  milestones: [],
  maintenanceAmount: '',
  maintenanceDueOn: '',
};

/** A stored plan as editable text. */
export function planDraftFrom(plan: PaymentPlan | undefined): PlanDraft {
  if (!plan) return EMPTY_PLAN;
  return {
    downPayment: plan.downPayment.amount,
    downPaymentDueOn: plan.downPaymentDueOn ?? '',
    installmentCount: String(plan.installmentCount),
    frequency: plan.frequency,
    firstDueOn: plan.firstDueOn,
    finalPayment: plan.finalPayment?.amount ?? '',
    milestones: (plan.milestones ?? []).map((milestone) => ({
      dueOn: milestone.dueOn,
      amount: milestone.amount.amount,
      labelAr: milestone.label?.ar ?? '',
      labelEn: milestone.label?.en ?? '',
    })),
    maintenanceAmount: plan.maintenanceDeposit?.amount.amount ?? '',
    maintenanceDueOn: plan.maintenanceDeposit?.dueOn ?? '',
  };
}

/**
 * The request shape of a plan. Empty optional parts are left out rather than sent as zero, so the
 * server's own rules decide what an absent final payment or deposit means. A number the person could
 * not have meant (a count that is not an integer) is sent as typed and refused by the server with a
 * reason, never corrected here.
 */
export function planRequest(draft: PlanDraft, currency: string): Record<string, unknown> {
  const money = (amount: string) => ({ amount: amount.trim() || '0', currency });
  const count = draft.installmentCount.trim();
  return {
    downPayment: money(draft.downPayment),
    installmentCount: count === '' ? 0 : Number(count),
    frequency: draft.frequency,
    firstDueOn: draft.firstDueOn,
    ...(draft.downPaymentDueOn ? { downPaymentDueOn: draft.downPaymentDueOn } : {}),
    ...(draft.finalPayment.trim() ? { finalPayment: money(draft.finalPayment) } : {}),
    ...(draft.milestones.length > 0
      ? {
          milestones: draft.milestones.map((milestone) => ({
            dueOn: milestone.dueOn,
            amount: money(milestone.amount),
            ...(milestone.labelAr.trim() || milestone.labelEn.trim()
              ? { label: { ar: milestone.labelAr.trim(), en: milestone.labelEn.trim() } }
              : {}),
          })),
        }
      : {}),
    ...(draft.maintenanceAmount.trim()
      ? {
          maintenanceDeposit: {
            amount: money(draft.maintenanceAmount),
            dueOn: draft.maintenanceDueOn,
          },
        }
      : {}),
  };
}

/** Whether the parts every plan needs are filled in — the server still validates everything. */
export function planIsComplete(draft: PlanDraft): boolean {
  return (
    draft.firstDueOn !== '' &&
    draft.milestones.every((milestone) => milestone.dueOn !== '' && milestone.amount.trim() !== '') &&
    (draft.maintenanceAmount.trim() === '' || draft.maintenanceDueOn !== '')
  );
}

const moneyInput = { htmlInput: { dir: 'ltr', inputMode: 'decimal' } } as const;
const dateInput = { inputLabel: { shrink: true } } as const;

export function PaymentPlanEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: PlanDraft;
  onChange: (next: PlanDraft) => void;
  disabled?: boolean;
}) {
  const { t, td } = useLocale();
  const set = (patch: Partial<PlanDraft>) => onChange({ ...value, ...patch });
  const setMilestone = (index: number, patch: Partial<MilestoneDraft>) =>
    set({
      milestones: value.milestones.map((milestone, position) =>
        position === index ? { ...milestone, ...patch } : milestone,
      ),
    });

  return (
    <Stack spacing={3}>
      <CardGrid min={200}>
        <TextField
          label={t('sales.downPayment')}
          value={value.downPayment}
          onChange={(event) => set({ downPayment: event.target.value })}
          disabled={disabled}
          slotProps={moneyInput}
        />
        <TextField
          label={t('sales.downPaymentDueOn')}
          type="date"
          value={value.downPaymentDueOn}
          onChange={(event) => set({ downPaymentDueOn: event.target.value })}
          disabled={disabled}
          helperText={t('plan.downPaymentDueHint')}
          slotProps={dateInput}
        />
        <TextField
          label={t('sales.installmentCount')}
          value={value.installmentCount}
          onChange={(event) => set({ installmentCount: event.target.value })}
          disabled={disabled}
          slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'numeric' } }}
        />
        <TextField
          select
          label={t('sales.frequency')}
          value={value.frequency}
          onChange={(event) => set({ frequency: event.target.value as InstallmentFrequency })}
          disabled={disabled}
        >
          {INSTALLMENT_FREQUENCIES.map((frequency) => (
            <MenuItem key={frequency} value={frequency}>
              {td(`frequency.${frequency}`)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label={t('sales.firstDueOn')}
          type="date"
          value={value.firstDueOn}
          onChange={(event) => set({ firstDueOn: event.target.value })}
          disabled={disabled}
          required
          slotProps={dateInput}
        />
        <TextField
          label={t('sales.finalPayment')}
          value={value.finalPayment}
          onChange={(event) => set({ finalPayment: event.target.value })}
          disabled={disabled}
          helperText={t('plan.optional')}
          slotProps={moneyInput}
        />
      </CardGrid>

      <Box component="fieldset" sx={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <Typography component="legend" sx={{ fontWeight: 600, marginBlockEnd: 1 }}>
          {t('plan.milestones')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ marginBlockEnd: 1.5 }}>
          {t('plan.milestonesHint')}
        </Typography>
        <Stack spacing={2}>
          {value.milestones.map((milestone, index) => (
            <Box
              key={index}
              sx={{
                display: 'grid',
                gap: 1.5,
                alignItems: 'start',
                gridTemplateColumns: {
                  xs: 'minmax(0, 1fr)',
                  md: 'repeat(4, minmax(0, 1fr)) auto',
                },
              }}
            >
              <TextField
                label={t('plan.milestoneDueOn')}
                type="date"
                value={milestone.dueOn}
                onChange={(event) => setMilestone(index, { dueOn: event.target.value })}
                disabled={disabled}
                required
                slotProps={dateInput}
              />
              <TextField
                label={t('plan.milestoneAmount')}
                value={milestone.amount}
                onChange={(event) => setMilestone(index, { amount: event.target.value })}
                disabled={disabled}
                required
                slotProps={moneyInput}
              />
              <TextField
                label={t('plan.milestoneLabelAr')}
                value={milestone.labelAr}
                onChange={(event) => setMilestone(index, { labelAr: event.target.value })}
                disabled={disabled}
                slotProps={{ htmlInput: { dir: 'rtl', lang: 'ar', maxLength: 120 } }}
              />
              <TextField
                label={t('plan.milestoneLabelEn')}
                value={milestone.labelEn}
                onChange={(event) => setMilestone(index, { labelEn: event.target.value })}
                disabled={disabled}
                slotProps={{ htmlInput: { dir: 'ltr', lang: 'en', maxLength: 120 } }}
              />
              <Tooltip title={t('plan.removeMilestone', { index: index + 1 })}>
                <span>
                  <IconButton
                    aria-label={t('plan.removeMilestone', { index: index + 1 })}
                    onClick={() =>
                      set({ milestones: value.milestones.filter((_, position) => position !== index) })
                    }
                    disabled={disabled}
                    sx={{ marginBlockStart: 0.5 }}
                  >
                    <Icon icon={X} size={18} />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          ))}
          <Box>
            <Button
              variant="outlined"
              size="small"
              startIcon={<Icon icon={Plus} size={16} />}
              disabled={disabled || value.milestones.length >= MAX_MILESTONES}
              onClick={() =>
                set({
                  milestones: [
                    ...value.milestones,
                    { dueOn: '', amount: '', labelAr: '', labelEn: '' },
                  ],
                })
              }
            >
              {t('plan.addMilestone')}
            </Button>
          </Box>
        </Stack>
      </Box>

      <Box component="fieldset" sx={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <Typography component="legend" sx={{ fontWeight: 600, marginBlockEnd: 1 }}>
          {t('plan.maintenance')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ marginBlockEnd: 1.5 }}>
          {t('plan.maintenanceHint')}
        </Typography>
        <CardGrid min={200}>
          <TextField
            label={t('plan.maintenanceAmount')}
            value={value.maintenanceAmount}
            onChange={(event) => set({ maintenanceAmount: event.target.value })}
            disabled={disabled}
            helperText={t('plan.optional')}
            slotProps={moneyInput}
          />
          <TextField
            label={t('plan.maintenanceDueOn')}
            type="date"
            value={value.maintenanceDueOn}
            onChange={(event) => set({ maintenanceDueOn: event.target.value })}
            disabled={disabled || value.maintenanceAmount.trim() === ''}
            slotProps={dateInput}
          />
        </CardGrid>
      </Box>
    </Stack>
  );
}

/** The server's schedule preview for a price and a plan. Changes nothing and records nothing. */
export function useSchedulePreview() {
  return useMutation(
    (input: { price: { amount: string; currency: string }; plan: Record<string, unknown> }) =>
      apiRequest<SchedulePreview>('/api/v1/sales/schedule/preview', {
        method: 'POST',
        body: { total: input.price, paymentPlan: input.plan },
      }),
  );
}

/**
 * A schedule as the server computed it: the sale price and the maintenance deposit apart, their total,
 * the rounding rule stated rather than implied (`BD-32`), and every row with its date and amount.
 */
export function SchedulePreviewTable({
  rows,
  price,
  maintenanceDeposit,
  total,
  caption,
}: {
  rows: SchedulePreview['rows'];
  price?: SchedulePreview['price'] | undefined;
  maintenanceDeposit?: SchedulePreview['maintenanceDeposit'] | undefined;
  total?: SchedulePreview['total'] | undefined;
  caption: string;
}) {
  const { t, td, locale } = useLocale();
  const format = useFormatters();
  const cell = { padding: 1, borderBlockEnd: 1, borderColor: 'divider', textAlign: 'start' } as const;
  return (
    <Stack spacing={2}>
      {price || total ? (
        <CardGrid min={180}>
          {price ? (
            <Field label={t('plan.salePrice')}>
              <Verbatim>{format.money(price)}</Verbatim>
            </Field>
          ) : null}
          <Field label={t('plan.maintenance')}>
            <Verbatim>{maintenanceDeposit ? format.money(maintenanceDeposit) : '—'}</Verbatim>
          </Field>
          {total ? (
            <Field label={t('sales.scheduleTotal')}>
              <Verbatim>{format.money(total)}</Verbatim>
            </Field>
          ) : null}
        </CardGrid>
      ) : null}
      <Box sx={{ overflowX: 'auto' }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
          <Box component="caption" sx={{ textAlign: 'start', captionSide: 'top', paddingBlockEnd: 1 }}>
            <Typography variant="body2" color="text.secondary" component="span">
              {caption}
            </Typography>
          </Box>
          <Box component="thead">
            <Box component="tr">
              {[
                t('fields.sequence'),
                t('fields.dueDate'),
                t('plan.rowKind'),
                t('fields.amount'),
              ].map((header, index) => (
                <Box
                  key={header}
                  component="th"
                  scope="col"
                  sx={{ ...cell, fontWeight: 700, ...(index === 3 ? { textAlign: 'end' } : {}) }}
                >
                  {header}
                </Box>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {rows.map((row) => (
              <Box component="tr" key={row.sequence}>
                <Box component="td" sx={cell}>
                  <Verbatim>{format.number(row.sequence)}</Verbatim>
                </Box>
                <Box component="td" sx={cell}>
                  <Verbatim>{format.date(row.dueOn)}</Verbatim>
                </Box>
                <Box component="td" sx={cell}>
                  {td(`installmentKind.${row.kind}`)}
                  {row.label ? (
                    <Typography component="span" variant="caption" color="text.secondary">
                      {` — ${row.label[locale]}`}
                    </Typography>
                  ) : null}
                </Box>
                <Box component="td" sx={{ ...cell, textAlign: 'end' }}>
                  <Verbatim>{format.money(row.amount)}</Verbatim>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
      <Alert severity="info" variant="outlined">
        {t('plan.roundingRule')}
      </Alert>
    </Stack>
  );
}
