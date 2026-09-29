import { z } from 'zod';
import { PAYMENT_METHODS } from './collections';
import { LEAD_SOURCES, LEAD_STAGES, OPEN_OPPORTUNITY_STAGES, OPPORTUNITY_STAGES } from './crm';
import { FINISHING_STATUSES, PROPERTY_TYPES, USAGE_TYPES } from './inventory';
import { DecimalStringSchema } from './money';
import { BusinessDateSchema, InstantSchema } from './time';

/**
 * Deployment settings, reference data and feature flags (PLAT-024, PLAT-025, PLAT-026, ADR-0027).
 *
 * Each client deployment configures its own business defaults without a source change. Three rules
 * keep that configuration from becoming a hazard:
 *
 * 1. **Only catalogued keys exist.** A setting is declared here with its schema; nothing else can be
 *    stored, so a secret, a provider token or an arbitrary blob has nowhere to go (ADR-0015).
 * 2. **No business policy is invented.** A value the stakeholders have not decided defaults to
 *    `null` — *not configured* — and names the open decision it waits for. Consumers must treat
 *    `null` as "not configured", never as a number.
 * 3. **History is never rewritten.** Every change is a new version with an append-only revision.
 *    Reference data keeps stable codes separate from its translated labels, so relabelling an item
 *    never changes what an existing record means.
 */

/* ---------------------------------------------------------------- settings */

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'TIME_OF_DAY_EXPECTED' });

/** One catalogued setting. `decision` names the open stakeholder item a `null` default waits for. */
export interface SettingDefinition {
  category: 'display' | 'finance' | 'sales' | 'collections' | 'notifications' | 'tasks' | 'feature';
  schema: z.ZodType;
  defaultValue: unknown;
  decision?: string;
  /**
   * A setting that may not be changed yet, and why — e.g. a feature whose activation is gated by an
   * ADR. Refused with `FEATURE_LOCKED`; the gate is lifted by changing this catalog in a reviewed
   * release, never by configuration.
   */
  lockedBy?: string;
}

export const SETTING_DEFINITIONS = {
  'display.dateFormat': {
    category: 'display',
    schema: z.enum(['dd/MM/yyyy', 'yyyy-MM-dd']),
    defaultValue: 'dd/MM/yyyy',
  },
  /** Decimal places a money amount is rounded to in the base currency (Master Mapping §7). */
  'finance.currencyScale': {
    category: 'finance',
    schema: z.number().int().min(0).max(4),
    defaultValue: 2,
  },
  'finance.fiscalYearStartMonth': {
    category: 'finance',
    schema: z.number().int().min(1).max(12),
    defaultValue: null,
    decision: 'SD-21',
  },
  /**
   * Win probability per open opportunity stage, as a percentage string (BD-27). Not configured, the
   * product shows no probability and no weighted pipeline: a forecast built on a guess is worse than
   * none. When configured, every open stage must have one.
   */
  'sales.opportunityStageProbabilities': {
    category: 'sales',
    schema: z
      .record(z.enum(OPEN_OPPORTUNITY_STAGES), DecimalStringSchema)
      .refine((value) => OPEN_OPPORTUNITY_STAGES.every((stage) => value[stage] !== undefined), {
        message: 'EVERY_OPEN_STAGE_REQUIRED',
      })
      .refine((value) => Object.values(value).every((rate) => isPercentage(rate)), {
        message: 'RATE_OUT_OF_RANGE',
      }),
    defaultValue: null,
    decision: 'BD-27',
  },
  /**
   * Hours a timed customer hold keeps a unit before it returns to sale (BD-29, conflict C-06). Not
   * configured, no hold can be taken: a guessed length would release units nobody expected to lose.
   */
  'sales.unitHoldHours': {
    category: 'sales',
    schema: z.number().int().min(1).max(720),
    defaultValue: null,
    decision: 'BD-29',
  },
  /** Days a reservation holds its unit (`BD-01`). Not configured, no reservation can be made. */
  'sales.reservationValidityDays': {
    category: 'sales',
    schema: z.number().int().min(1).max(365),
    defaultValue: null,
    decision: 'BD-01',
  },
  /**
   * The least deposit a reservation takes (`BD-02`): a fixed amount in a currency, or a percentage of
   * the agreed price. Not configured, no minimum is enforced. Below it needs an exception approval.
   */
  'sales.reservationMinimumDeposit': {
    category: 'sales',
    schema: z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('amount'),
        amount: DecimalStringSchema,
        currency: z.string().regex(/^[A-Z]{3}$/),
      }),
      z.strictObject({
        kind: z.literal('percentage'),
        percent: DecimalStringSchema.refine(isPercentage, { message: 'RATE_OUT_OF_RANGE' }),
      }),
    ]),
    defaultValue: null,
    decision: 'BD-02',
  },
  /**
   * The largest discount a reservation may carry without a price-override approval, as a percentage
   * of the list price (`BD-03`). Not configured, no maximum applies; any discount still asks for the
   * discount approval when a policy governs it.
   */
  'sales.maximumDiscountPercent': {
    category: 'sales',
    schema: DecimalStringSchema.refine(isPercentage, { message: 'RATE_OUT_OF_RANGE' }),
    defaultValue: null,
    decision: 'BD-03',
  },
  /**
   * Days before a due date on which an instalment reminder is prepared. The 15-day reminder is
   * mandatory in both source documents; any other window is `SD-09`.
   */
  'collections.reminderWindowsDays': {
    category: 'collections',
    schema: z
      .array(z.number().int().min(0).max(90))
      .min(1)
      .max(5)
      .refine((days) => new Set(days).size === days.length, { message: 'DUPLICATE_WINDOW' })
      .refine((days) => days.includes(15), { message: 'FIFTEEN_DAY_REMINDER_MANDATORY' }),
    defaultValue: [15],
    decision: 'SD-09',
  },
  /** Non-urgent external notifications wait until the end of quiet hours (CORE-NOTIFY-004). */
  'notifications.quietHours': {
    category: 'notifications',
    schema: z
      .strictObject({ start: HHMM, end: HHMM })
      .refine((value) => value.start !== value.end, {
        message: 'EMPTY_QUIET_HOURS',
      }),
    defaultValue: null,
    decision: 'SD-21',
  },
  /**
   * Hours after its due moment before an overdue task escalates to the assignee's manager
   * (CORE-TASK-003). `null` — not configured — escalates as soon as the task is overdue, which is the
   * registry's own rule (G-09); a grace period is a stakeholder choice (`SD-02`).
   */
  'tasks.escalationDelayHours': {
    category: 'tasks',
    schema: z.number().int().min(0).max(720),
    defaultValue: null,
    decision: 'SD-02',
  },
  'feature.notifications.externalDelivery': {
    category: 'feature',
    schema: z.boolean(),
    defaultValue: false,
  },
  'feature.imports': { category: 'feature', schema: z.boolean(), defaultValue: true },
  'feature.exports': { category: 'feature', schema: z.boolean(), defaultValue: true },
  'feature.meta.conversionsApiDelivery': {
    category: 'feature',
    schema: z.boolean(),
    defaultValue: false,
    lockedBy: 'ADR-0017',
  },
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];
export const SettingKeySchema = z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]);

/** The approved feature flags are exactly the `feature.*` settings (PLAT-026). */
export const FEATURE_FLAG_KEYS = SETTING_KEYS.filter((key) => key.startsWith('feature.'));

/** JSON the catalog can hold. Validated again against the setting's own schema on the server. */
const JsonValueSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.string().max(2000),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema).max(50),
    z.record(z.string().max(64), JsonValueSchema),
  ]),
);

export const SettingSchema = z.strictObject({
  key: SettingKeySchema,
  category: z.enum([
    'display',
    'finance',
    'sales',
    'collections',
    'notifications',
    'tasks',
    'feature',
  ]),
  /** The value in force: the configured one, or the default. `null` means not configured. */
  value: JsonValueSchema,
  defaultValue: JsonValueSchema,
  /** True when a value was set explicitly, even to the default. */
  configured: z.boolean(),
  decision: z.string().optional(),
  lockedBy: z.string().optional(),
  version: z.number().int().nonnegative(),
  updatedAt: InstantSchema.optional(),
  updatedBy: z.string().optional(),
});
export type Setting = z.infer<typeof SettingSchema>;

export const SettingListSchema = z.strictObject({ items: z.array(SettingSchema) });

export const UpdateSettingSchema = z.strictObject({
  /** `null` returns the setting to its default. */
  value: JsonValueSchema,
  /** The version the editor read; `0` for a setting never changed. */
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(3).max(500),
});
export type UpdateSetting = z.infer<typeof UpdateSettingSchema>;

export const SettingRevisionSchema = z.strictObject({
  key: SettingKeySchema,
  version: z.number().int().positive(),
  value: JsonValueSchema,
  reason: z.string(),
  changedAt: InstantSchema,
  changedBy: z.string(),
});
export const SettingRevisionListSchema = z.strictObject({ items: z.array(SettingRevisionSchema) });

/* ---------------------------------------------------------- reference data */

export const REFERENCE_LISTS = [
  'unitTypes',
  'usageTypes',
  'finishingStatuses',
  'leadSources',
  'pipelineStages',
  'opportunityStages',
  'paymentMethods',
  'lossReasons',
  'reservationReasons',
  'cancellationReasons',
  'documentTypes',
  'taxCodes',
] as const;
export const ReferenceListSchema = z.enum(REFERENCE_LISTS);
export type ReferenceList = z.infer<typeof ReferenceListSchema>;

/**
 * Lists whose codes the product's own logic depends on. Their codes are fixed by the contracts; a
 * deployment may relabel and reorder them, never add or recode one.
 */
export const BOUND_REFERENCE_LISTS: Partial<Record<ReferenceList, readonly string[]>> = {
  unitTypes: PROPERTY_TYPES,
  usageTypes: USAGE_TYPES,
  finishingStatuses: FINISHING_STATUSES,
  leadSources: LEAD_SOURCES,
  pipelineStages: LEAD_STAGES,
  opportunityStages: OPPORTUNITY_STAGES,
  paymentMethods: PAYMENT_METHODS,
};

/** Bound lists whose items may not even be deactivated: a state machine depends on every one. */
export const LOCKED_REFERENCE_LISTS: readonly ReferenceList[] = [
  'pipelineStages',
  'opportunityStages',
];

/** The `common` translation namespace holding a bound list's default labels (I18N-002). */
export const BOUND_LIST_LABEL_NAMESPACES: Partial<Record<ReferenceList, string>> = {
  unitTypes: 'propertyType',
  usageTypes: 'usageType',
  finishingStatuses: 'finishingStatus',
  leadSources: 'leadSource',
  pipelineStages: 'leadStage',
  opportunityStages: 'opportunityStage',
  paymentMethods: 'paymentMethod',
};

/**
 * A reference item's stable code. Wider than `BusinessCodeSchema` because a bound list's codes are the
 * product's own enumeration values (`villa`, `underConstruction`); narrower in one way — no `/` or
 * `.` — because the code is a URL path segment.
 */
export const ReferenceCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/, { message: 'REFERENCE_CODE_EXPECTED' });

const ReferenceLabelSchema = z.strictObject({
  ar: z.string().trim().min(1).max(120),
  en: z.string().trim().min(1).max(120),
});
const ReferenceDescriptionSchema = z.strictObject({
  ar: z.string().trim().min(1).max(500),
  en: z.string().trim().min(1).max(500),
});

/**
 * True for a decimal string between 0 and 100 inclusive, decided on the digits — a rate never passes
 * through binary floating point (ADR-0007).
 */
export function isPercentage(value: string): boolean {
  if (value.startsWith('-')) return false;
  const [whole = '', fraction = ''] = value.split('.');
  const integer = whole.replace(/^0+(?=\d)/, '');
  if (integer.length < 3) return true;
  return integer === '100' && /^0*$/.test(fraction);
}

/** A tax rate in force from a date. Never edited; a new rate is a new entry (FIN-TAX, `SD-08`). */
export const TaxRateSchema = z.strictObject({
  ratePercent: DecimalStringSchema.refine(isPercentage, { message: 'RATE_OUT_OF_RANGE' }),
  effectiveFrom: BusinessDateSchema,
});
export type TaxRate = z.infer<typeof TaxRateSchema>;

export const ReferenceItemSchema = z.strictObject({
  list: ReferenceListSchema,
  /** Stable, never translated, never changed. Records store this, not the label. */
  code: ReferenceCodeSchema,
  label: ReferenceLabelSchema,
  description: ReferenceDescriptionSchema.optional(),
  sortOrder: z.number().int().min(0).max(10_000),
  active: z.boolean(),
  /** The code is fixed by the product (see `BOUND_REFERENCE_LISTS`). */
  bound: z.boolean(),
  taxRates: z.array(TaxRateSchema).optional(),
  version: z.number().int().nonnegative(),
  updatedAt: InstantSchema.optional(),
});
export type ReferenceItem = z.infer<typeof ReferenceItemSchema>;

export const ReferenceItemListSchema = z.strictObject({
  list: ReferenceListSchema,
  bound: z.boolean(),
  items: z.array(ReferenceItemSchema),
});

export const CreateReferenceItemSchema = z.strictObject({
  code: ReferenceCodeSchema,
  label: ReferenceLabelSchema,
  description: ReferenceDescriptionSchema.optional(),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
});
export type CreateReferenceItem = z.infer<typeof CreateReferenceItemSchema>;

export const UpdateReferenceItemSchema = z.strictObject({
  label: ReferenceLabelSchema.optional(),
  description: ReferenceDescriptionSchema.optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  expectedVersion: z.number().int().nonnegative(),
});
export type UpdateReferenceItem = z.infer<typeof UpdateReferenceItemSchema>;

export const ReferenceLifecycleSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});

export const ReferenceListQuerySchema = z.strictObject({
  includeInactive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const SETTINGS_AUDIT_ACTIONS = {
  settingChanged: 'settings.changed',
  referenceCreated: 'referenceData.created',
  referenceUpdated: 'referenceData.updated',
  referenceDeactivated: 'referenceData.deactivated',
  referenceReactivated: 'referenceData.reactivated',
  taxRateAdded: 'referenceData.taxRateAdded',
} as const;
