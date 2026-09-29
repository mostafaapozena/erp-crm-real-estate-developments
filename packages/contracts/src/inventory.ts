import { z } from 'zod';
import { BusinessCodeSchema, RecordIdSchema } from './identifiers';
import { LocalizedLabelSchema } from './localized';
import {
  DecimalStringSchema,
  MoneySchema,
  divideMoney,
  isZeroMoney,
  multiplyMoney,
  type Money,
} from './money';
import { PaymentPlanSchema, SchedulePreviewSchema, type PaymentPlan } from './sales';
import { BusinessDateSchema, InstantSchema, addMonths, type BusinessDate } from './time';

/**
 * Real-estate inventory — `INV-*` demonstration slice (ADR-0025).
 *
 * Hierarchy: project → building → unit. A floor is a number on the unit rather than a record of its
 * own, because nothing in the demonstrated journey needs a floor to carry data; a zone or phase is
 * likewise a label on the building. Both become records if a later phase gives them behaviour.
 *
 * **Why project and building names are bilingual and a customer's name is not.** A project name
 * appears in navigation, filters, reports and printed documents, so a single-language project name
 * produces a mixed-language screen, which fails the localization gate outright. A customer name is
 * what a person typed about themselves and is stored exactly as entered, never translated (I18N-009).
 */

/* --------------------------------------------------------------------- project */

export const PROJECT_STATUSES = ['planning', 'selling', 'onHold', 'completed'] as const;
export const ProjectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z.strictObject({
  projectId: RecordIdSchema,
  legalEntityId: RecordIdSchema,
  branchId: RecordIdSchema,
  code: BusinessCodeSchema,
  name: LocalizedLabelSchema,
  city: LocalizedLabelSchema,
  description: LocalizedLabelSchema.optional(),
  status: ProjectStatusSchema,
  /** Every price inside the project is denominated in this currency. */
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** Optimistic concurrency (INV-PROJECT-001). A record from before BMP-1 reads as version 1. */
  version: z.number().int().positive(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Project = z.infer<typeof ProjectSchema>;

/** INV-PROJECT-001: the descriptive fields. Code, branch and currency never change. */
export const UpdateProjectSchema = z.strictObject({
  name: LocalizedLabelSchema.optional(),
  city: LocalizedLabelSchema.optional(),
  description: LocalizedLabelSchema.optional(),
  status: ProjectStatusSchema.optional(),
  reason: z.string().trim().min(3).max(500),
  expectedVersion: z.number().int().positive(),
});
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;

export const CreateProjectSchema = z.strictObject({
  branchId: RecordIdSchema,
  code: BusinessCodeSchema,
  name: LocalizedLabelSchema,
  city: LocalizedLabelSchema,
  description: LocalizedLabelSchema.optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  status: ProjectStatusSchema.optional(),
});
export type CreateProject = z.infer<typeof CreateProjectSchema>;

/* -------------------------------------------------------------------- building */

export const BuildingSchema = z.strictObject({
  buildingId: RecordIdSchema,
  projectId: RecordIdSchema,
  legalEntityId: RecordIdSchema,
  branchId: RecordIdSchema,
  code: BusinessCodeSchema,
  name: LocalizedLabelSchema,
  /** Phase or zone. A label until a later phase gives it behaviour. */
  zone: LocalizedLabelSchema.optional(),
  floors: z.number().int().min(1).max(200),
  version: z.number().int().positive(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Building = z.infer<typeof BuildingSchema>;

/** A building's floor count may not fall below its highest unit (INV-PROJECT-002). */
export const UpdateBuildingSchema = z.strictObject({
  name: LocalizedLabelSchema.optional(),
  zone: LocalizedLabelSchema.optional(),
  floors: z.number().int().min(1).max(200).optional(),
  reason: z.string().trim().min(3).max(500),
  expectedVersion: z.number().int().positive(),
});
export type UpdateBuilding = z.infer<typeof UpdateBuildingSchema>;

export const CreateBuildingSchema = z.strictObject({
  projectId: RecordIdSchema,
  code: BusinessCodeSchema,
  name: LocalizedLabelSchema,
  zone: LocalizedLabelSchema.optional(),
  floors: z.number().int().min(1).max(200),
});
export type CreateBuilding = z.infer<typeof CreateBuildingSchema>;

/* ------------------------------------------------------------------------ unit */

export const PROPERTY_TYPES = [
  'apartment',
  'duplex',
  'penthouse',
  'studio',
  'villa',
  'townhouse',
  'shop',
  'office',
  'clinic',
] as const;
export const PropertyTypeSchema = z.enum(PROPERTY_TYPES);
export type PropertyType = z.infer<typeof PropertyTypeSchema>;

export const USAGE_TYPES = ['residential', 'commercial', 'administrative', 'medical'] as const;
export const UsageTypeSchema = z.enum(USAGE_TYPES);
export type UsageType = z.infer<typeof UsageTypeSchema>;

export const FINISHING_STATUSES = [
  'coreAndShell',
  'semiFinished',
  'fullyFinished',
  'fullyFinishedWithAppliances',
] as const;
export const FinishingStatusSchema = z.enum(FINISHING_STATUSES);
export type FinishingStatus = z.infer<typeof FinishingStatusSchema>;

/**
 * Unit availability.
 *
 * `held` is a **temporary** hold taken while a reservation is being prepared; it releases without a
 * business decision. `reserved` and `contracted` are commitments and release only through the
 * cancellation of the reservation or contract that produced them.
 */
export const UNIT_STATUSES = [
  'available',
  'held',
  'reserved',
  'contracted',
  'unavailable',
] as const;
export const UnitStatusSchema = z.enum(UNIT_STATUSES);
export type UnitStatus = z.infer<typeof UnitStatusSchema>;

/**
 * Permitted transitions. Everything absent here is refused, which is the point: a unit that can move
 * from `contracted` straight back to `available` without a cancellation is a unit that can be sold
 * twice.
 *
 * `contracted → available` exists only because contract cancellation must be able to return the unit
 * to the market; the sales module performs it inside the cancelling transaction, never on its own.
 */
export const UNIT_TRANSITIONS: Readonly<Record<UnitStatus, readonly UnitStatus[]>> = {
  available: ['held', 'reserved', 'unavailable'],
  held: ['available', 'reserved', 'unavailable'],
  reserved: ['available', 'contracted', 'unavailable'],
  contracted: ['available'],
  unavailable: ['available'],
};

export function canTransitionUnit(from: UnitStatus, to: UnitStatus): boolean {
  return UNIT_TRANSITIONS[from].includes(to);
}

/**
 * The only moves a **person** makes directly (INV-STATUS-001): withdraw an uncommitted unit from sale,
 * and restore it. A hold, a reservation and a contract each move the unit through their own workflow,
 * so the unit can never be freed while the record that committed it still stands.
 */
export const MANUAL_UNIT_TRANSITIONS: Readonly<Partial<Record<UnitStatus, readonly UnitStatus[]>>> =
  {
    available: ['unavailable'],
    unavailable: ['available'],
  };

export function isManualUnitTransition(from: UnitStatus, to: UnitStatus): boolean {
  return MANUAL_UNIT_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Room and parking counts (INV-UNIT-001). Bounded so a typo cannot store 3,000 bedrooms. */
const CountSchema = z.number().int().min(0).max(50);

export const UnitSchema = z.strictObject({
  unitId: RecordIdSchema,
  projectId: RecordIdSchema,
  buildingId: RecordIdSchema,
  legalEntityId: RecordIdSchema,
  branchId: RecordIdSchema,
  code: BusinessCodeSchema,
  floor: z.number().int().min(-5).max(200),
  propertyType: PropertyTypeSchema,
  usageType: UsageTypeSchema,
  /** Square metres, as a decimal string — never a binary float (ADR-0007). */
  area: DecimalStringSchema,
  /** Outdoor areas that are sold with the unit, in square metres. Absent when there is none. */
  gardenArea: DecimalStringSchema.optional(),
  roofArea: DecimalStringSchema.optional(),
  bedrooms: CountSchema.optional(),
  bathrooms: CountSchema.optional(),
  parkingSpaces: CountSchema.optional(),
  storageRooms: CountSchema.optional(),
  /** Optional because pricing is field-restricted: absent for an actor without the permission. */
  basePrice: MoneySchema.optional(),
  currentPrice: MoneySchema.optional(),
  pricePerSquareMeter: MoneySchema.optional(),
  status: UnitStatusSchema,
  finishingStatus: FinishingStatusSchema,
  view: LocalizedLabelSchema.optional(),
  /** A short human summary of the plan offered on this unit. The schedule itself is on the contract. */
  paymentPlanSummary: LocalizedLabelSchema.optional(),
  /** The live reservation or contract holding the unit, when one does. Opaque to inventory. */
  heldByReservationId: RecordIdSchema.optional(),
  /** The timed hold holding the unit before a reservation exists (INV-HOLD-001). */
  heldByHoldId: RecordIdSchema.optional(),
  contractId: RecordIdSchema.optional(),
  /** Optimistic concurrency: a status change states the version it read. */
  version: z.number().int().positive(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Unit = z.infer<typeof UnitSchema>;

export const CreateUnitSchema = z.strictObject({
  buildingId: RecordIdSchema,
  code: BusinessCodeSchema,
  floor: z.number().int().min(-5).max(200),
  propertyType: PropertyTypeSchema,
  usageType: UsageTypeSchema,
  area: DecimalStringSchema,
  basePrice: MoneySchema,
  currentPrice: MoneySchema.optional(),
  finishingStatus: FinishingStatusSchema,
  view: LocalizedLabelSchema.optional(),
  paymentPlanSummary: LocalizedLabelSchema.optional(),
  gardenArea: DecimalStringSchema.optional(),
  roofArea: DecimalStringSchema.optional(),
  bedrooms: CountSchema.optional(),
  bathrooms: CountSchema.optional(),
  parkingSpaces: CountSchema.optional(),
  storageRooms: CountSchema.optional(),
});
export type CreateUnit = z.infer<typeof CreateUnitSchema>;

/**
 * INV-UNIT-001: the non-commercial attributes. Code, floor, area and price are not edited here: the
 * area and price are what a customer signed for, and a price moves only through a price version.
 */
export const UpdateUnitSchema = z.strictObject({
  finishingStatus: FinishingStatusSchema.optional(),
  view: LocalizedLabelSchema.optional(),
  paymentPlanSummary: LocalizedLabelSchema.optional(),
  gardenArea: DecimalStringSchema.optional(),
  roofArea: DecimalStringSchema.optional(),
  bedrooms: CountSchema.optional(),
  bathrooms: CountSchema.optional(),
  parkingSpaces: CountSchema.optional(),
  storageRooms: CountSchema.optional(),
  reason: z.string().trim().min(3).max(500),
  expectedVersion: z.number().int().positive(),
});
export type UpdateUnit = z.infer<typeof UpdateUnitSchema>;

/** A direct status change, for the transitions a person makes: withdrawing or restoring a unit. */
export const ChangeUnitStatusSchema = z.strictObject({
  status: UnitStatusSchema,
  reason: z.string().trim().min(3).max(500),
  expectedVersion: z.number().int().positive().optional(),
});
export type ChangeUnitStatus = z.infer<typeof ChangeUnitStatusSchema>;

/* --------------------------------------------------------------- unit history */

/** What happened to a unit, as its timeline shows it. */
export const UNIT_EVENT_KINDS = [
  'created',
  'statusChanged',
  'priceChanged',
  'attributesChanged',
] as const;

/**
 * Append-only unit timeline. The audit trail already records every mutation, but it is a security
 * record scoped and field-restricted for investigators; this is the unit's **business** history, which
 * a sales person reads on the unit page. The two answer different questions.
 */
export const UnitEventSchema = z.strictObject({
  eventId: RecordIdSchema,
  unitId: RecordIdSchema,
  projectId: RecordIdSchema,
  kind: z.enum(UNIT_EVENT_KINDS),
  fromStatus: UnitStatusSchema.optional(),
  toStatus: UnitStatusSchema.optional(),
  reason: z.string().max(500).optional(),
  /** Opaque reference to whatever caused it — a reservation, a contract, or nothing. */
  sourceType: z.string().max(40).optional(),
  sourceId: z.string().max(200).optional(),
  actorAccountId: z.string().max(200).optional(),
  occurredAt: InstantSchema,
});
export type UnitEvent = z.infer<typeof UnitEventSchema>;

/* ------------------------------------------------------------- queries, pages */

export const UNIT_PAGE_SIZE_DEFAULT = 24;
export const UNIT_PAGE_SIZE_MAX = 100;

export const UnitQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(UNIT_PAGE_SIZE_MAX).default(UNIT_PAGE_SIZE_DEFAULT),
  cursor: z.string().min(1).max(200).optional(),
  projectId: RecordIdSchema.optional(),
  buildingId: RecordIdSchema.optional(),
  status: UnitStatusSchema.optional(),
  propertyType: PropertyTypeSchema.optional(),
  usageType: UsageTypeSchema.optional(),
  finishingStatus: FinishingStatusSchema.optional(),
  floor: z.coerce.number().int().min(-5).max(200).optional(),
  /** Matches the unit code, anchored at the start; never a free regular expression. */
  code: z.string().trim().max(40).optional(),
  /** INV-SEARCH-001: area bounds in square metres, inclusive. */
  areaMin: DecimalStringSchema.optional(),
  areaMax: DecimalStringSchema.optional(),
  /**
   * Price bounds on the current price, inclusive. Refused without `inventory.unit.viewPricing`: a
   * filter on a hidden value answers questions about it, one bisection at a time (SEC-029).
   */
  priceMin: DecimalStringSchema.optional(),
  priceMax: DecimalStringSchema.optional(),
  bedrooms: z.coerce.number().int().min(0).max(50).optional(),
});
export type UnitQuery = z.infer<typeof UnitQuerySchema>;

export const UnitPageSchema = z.strictObject({
  items: z.array(UnitSchema),
  /** Total **within the actor's data scope**, computed by the same filter as the rows (SEC-028). */
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  nextCursor: z.string().optional(),
});
export type UnitPage = z.infer<typeof UnitPageSchema>;

/** Availability counts for an inventory summary. Scoped exactly as the rows are. */
export const InventorySummarySchema = z.strictObject({
  projectId: RecordIdSchema.optional(),
  total: z.number().int().nonnegative(),
  byStatus: z.record(UnitStatusSchema, z.number().int().nonnegative()),
  byUsageType: z.record(UsageTypeSchema, z.number().int().nonnegative()),
});
export type InventorySummary = z.infer<typeof InventorySummarySchema>;

export const ProjectListSchema = z.strictObject({ items: z.array(ProjectSchema) });
export const BuildingListSchema = z.strictObject({ items: z.array(BuildingSchema) });
export const UnitEventListSchema = z.strictObject({ items: z.array(UnitEventSchema) });

/* ------------------------------------------------------------ price versions */

/**
 * INV-PRICE-001 / 003: a unit's price is a series of versions, each in force from a date. A version is
 * never edited after it takes effect; a mistake is corrected by a newer version. A change submits to
 * the approval engine (`inventory.unit.priceChange`, `BD-31`) and waits there when a policy applies.
 */
export const PRICE_VERSION_STATES = [
  'pendingApproval',
  'scheduled',
  'effective',
  'superseded',
  'rejected',
  'cancelled',
] as const;
export const PriceVersionStateSchema = z.enum(PRICE_VERSION_STATES);
export type PriceVersionState = z.infer<typeof PriceVersionStateSchema>;

export const PriceVersionSchema = z.strictObject({
  priceVersionId: RecordIdSchema,
  unitId: RecordIdSchema,
  projectId: RecordIdSchema,
  /** 1, 2, 3 … per unit, in the order versions were proposed. */
  sequence: z.number().int().positive(),
  price: MoneySchema,
  /** The price in force when this version was proposed — what the change is measured against. */
  previousPrice: MoneySchema,
  /** Signed percentage change against `previousPrice`, as a decimal string. */
  changePercentage: z.string(),
  effectiveFrom: BusinessDateSchema,
  state: PriceVersionStateSchema,
  reason: z.string().max(500),
  approvalRequestId: z.string().max(200).optional(),
  proposedBy: z.string().max(200),
  proposedAt: InstantSchema,
  appliedAt: InstantSchema.optional(),
});
export type PriceVersion = z.infer<typeof PriceVersionSchema>;

export const ProposePriceSchema = z.strictObject({
  price: MoneySchema,
  /** Today or later, in the organization's calendar. A past date would rewrite history. */
  effectiveFrom: BusinessDateSchema,
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().min(8).max(200),
});
export type ProposePrice = z.infer<typeof ProposePriceSchema>;

export const PriceVersionListSchema = z.strictObject({ items: z.array(PriceVersionSchema) });

/* --------------------------------------------------------------------- holds */

/**
 * INV-HOLD-001 / 002: a **timed customer hold** taken while a sale is being prepared. It expires by
 * itself — that is what distinguishes it from withdrawing a unit (`unavailable`), which only a person
 * reverses (conflict `C-06`). Its length is `inventory.holdHours` (`BD-29`); with no length configured
 * no hold can be taken.
 */
export const HOLD_STATES = ['active', 'released', 'expired', 'converted'] as const;
export const HoldStateSchema = z.enum(HOLD_STATES);
export type HoldState = z.infer<typeof HoldStateSchema>;

export const HoldSchema = z.strictObject({
  holdId: RecordIdSchema,
  unitId: RecordIdSchema,
  projectId: RecordIdSchema,
  legalEntityId: RecordIdSchema,
  branchId: RecordIdSchema,
  customerId: RecordIdSchema.optional(),
  opportunityId: RecordIdSchema.optional(),
  holderAccountId: z.string().min(1).max(200),
  state: HoldStateSchema,
  expiresAt: InstantSchema,
  extensions: z.number().int().nonnegative(),
  note: z.string().max(500).optional(),
  releaseReason: z.string().max(500).optional(),
  reservationId: RecordIdSchema.optional(),
  /** Set while an extension waits for approval (`inventory.hold.extension`). */
  extensionApprovalRequestId: z.string().max(200).optional(),
  version: z.number().int().positive(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Hold = z.infer<typeof HoldSchema>;

export const CreateHoldSchema = z.strictObject({
  unitId: RecordIdSchema,
  customerId: RecordIdSchema.optional(),
  opportunityId: RecordIdSchema.optional(),
  note: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(200),
});
export type CreateHold = z.infer<typeof CreateHoldSchema>;

export const ReleaseHoldSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});
export const ExtendHoldSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
  expectedVersion: z.number().int().positive(),
});

export const HoldQuerySchema = z.strictObject({
  state: HoldStateSchema.optional(),
  unitId: RecordIdSchema.optional(),
  projectId: RecordIdSchema.optional(),
  holderAccountId: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type HoldQuery = z.infer<typeof HoldQuerySchema>;
export const HoldListSchema = z.strictObject({ items: z.array(HoldSchema) });

/* ------------------------------------------------------- payment-plan templates */

/**
 * INV-PLAN-001: a template a person starts a payment plan from. Percentages, not amounts, so one
 * template serves every unit it is eligible for; the amounts are computed on the unit's price with
 * exact decimals, and the schedule itself is built by the same code as the contract's
 * (`buildInstallmentSchedule`). A template in use is never edited: it is retired and replaced.
 */
export const PLAN_TEMPLATE_STATES = ['active', 'retired'] as const;

const PercentStringSchema = DecimalStringSchema.refine(
  (value) => {
    if (value.startsWith('-')) return false;
    const [whole = ''] = value.split('.');
    return Number(whole) < 100 || /^100(\.0+)?$/.test(value);
  },
  { message: 'PERCENTAGE_EXPECTED' },
);

export const PlanTemplateSchema = z.strictObject({
  templateId: RecordIdSchema,
  code: BusinessCodeSchema,
  name: LocalizedLabelSchema,
  /** Eligible projects. Empty means every project of the legal entity. */
  projectIds: z.array(RecordIdSchema).max(200),
  legalEntityId: RecordIdSchema,
  downPaymentPercent: PercentStringSchema,
  installmentCount: z.number().int().min(0).max(240),
  frequency: z.enum(['monthly', 'quarterly', 'semiAnnual', 'annual']),
  /** Months from the contract date to the first instalment. */
  firstInstallmentAfterMonths: z.number().int().min(0).max(60),
  finalPaymentPercent: PercentStringSchema.optional(),
  state: z.enum(PLAN_TEMPLATE_STATES),
  createdAt: InstantSchema,
  retiredAt: InstantSchema.optional(),
});
export type PlanTemplate = z.infer<typeof PlanTemplateSchema>;

export const CreatePlanTemplateSchema = z
  .strictObject({
    code: BusinessCodeSchema,
    name: LocalizedLabelSchema,
    projectIds: z.array(RecordIdSchema).max(200).default([]),
    legalEntityId: RecordIdSchema,
    downPaymentPercent: PercentStringSchema,
    installmentCount: z.number().int().min(0).max(240),
    frequency: z.enum(['monthly', 'quarterly', 'semiAnnual', 'annual']),
    firstInstallmentAfterMonths: z.number().int().min(0).max(60),
    finalPaymentPercent: PercentStringSchema.optional(),
  })
  .refine(
    (value) => {
      const [dpWhole = '0', dpFraction = ''] = value.downPaymentPercent.split('.');
      const [fpWhole = '0', fpFraction = ''] = (value.finalPaymentPercent ?? '0').split('.');
      // Compare in hundredths of a percent, as integers: never a binary float (ADR-0007).
      const hundredths = (whole: string, fraction: string) =>
        Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
      return hundredths(dpWhole, dpFraction) + hundredths(fpWhole, fpFraction) <= 10_000;
    },
    { message: 'PERCENTAGES_EXCEED_WHOLE', path: ['finalPaymentPercent'] },
  );
export type CreatePlanTemplate = z.infer<typeof CreatePlanTemplateSchema>;

export const PlanTemplateListSchema = z.strictObject({ items: z.array(PlanTemplateSchema) });

/**
 * The payment plan a template gives for a price and a contract date.
 *
 * Down payment and final payment are the price × percentage, rounded **half-up to the piastre**; the
 * instalments then split what remains exactly (`buildInstallmentSchedule`, odd piastres to the
 * earliest rows — `BD-32` proposed). The down payment falls due on the contract date and the first
 * instalment the stated number of months later.
 */
export function planFromTemplate(
  template: Pick<
    PlanTemplate,
    | 'downPaymentPercent'
    | 'installmentCount'
    | 'frequency'
    | 'firstInstallmentAfterMonths'
    | 'finalPaymentPercent'
  >,
  price: Money,
  contractDate: BusinessDate,
): PaymentPlan {
  const share = (percent: string) => divideMoney(multiplyMoney(price, percent), '100', 2, 'halfUp');
  const finalPayment = template.finalPaymentPercent
    ? share(template.finalPaymentPercent)
    : undefined;
  return {
    downPayment: share(template.downPaymentPercent),
    installmentCount: template.installmentCount,
    frequency: template.frequency,
    firstDueOn: addMonths(contractDate, template.firstInstallmentAfterMonths),
    downPaymentDueOn: contractDate,
    ...(finalPayment && !isZeroMoney(finalPayment) ? { finalPayment } : {}),
  };
}

export const PlanTemplatePreviewRequestSchema = z.strictObject({
  unitId: RecordIdSchema,
  contractDate: BusinessDateSchema,
});

/** A template applied to one unit's current price: the plan and the schedule it produces. Nothing stored. */
export const PlanTemplatePreviewSchema = z.strictObject({
  templateId: RecordIdSchema,
  unitId: RecordIdSchema,
  unitPrice: MoneySchema,
  plan: PaymentPlanSchema,
  schedule: SchedulePreviewSchema,
});
export type PlanTemplatePreview = z.infer<typeof PlanTemplatePreviewSchema>;

export const RetirePlanTemplateSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});

export const PlanTemplateQuerySchema = z.strictObject({
  projectId: RecordIdSchema.optional(),
  includeRetired: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

/* ----------------------------------------------------- matrix and comparison */

/** INV-SEARCH-002: one cell of the availability matrix. Price only for those who may see it. */
export const MatrixCellSchema = z.strictObject({
  unitId: RecordIdSchema,
  code: BusinessCodeSchema,
  status: UnitStatusSchema,
  propertyType: PropertyTypeSchema,
  area: DecimalStringSchema,
  bedrooms: z.number().int().optional(),
  currentPrice: MoneySchema.optional(),
});

export const AvailabilityMatrixSchema = z.strictObject({
  projectId: RecordIdSchema,
  buildings: z.array(
    z.strictObject({
      buildingId: RecordIdSchema,
      code: BusinessCodeSchema,
      name: LocalizedLabelSchema,
      /** Highest floor first, as a building is drawn. */
      floors: z.array(
        z.strictObject({ floor: z.number().int(), units: z.array(MatrixCellSchema) }),
      ),
    }),
  ),
  counts: z.record(UnitStatusSchema, z.number().int().nonnegative()),
});
export type AvailabilityMatrix = z.infer<typeof AvailabilityMatrixSchema>;

export const UnitComparisonQuerySchema = z.strictObject({
  /** Two to four unit identifiers, comma-separated. */
  ids: z
    .string()
    .max(400)
    .transform((value) => value.split(',').map((id) => id.trim()))
    .pipe(z.array(RecordIdSchema).min(2).max(4)),
});

export const UnitComparisonSchema = z.strictObject({ items: z.array(UnitSchema) });

/** Operation types inventory submits to the approval engine; a policy names them to apply (BD-31, BD-29). */
export const INVENTORY_APPROVAL_OPERATIONS = {
  priceChange: 'inventory.unit.priceChange',
  holdExtension: 'inventory.hold.extension',
} as const;

export const INVENTORY_AUDIT_ACTIONS = {
  projectCreated: 'inventory.project.created',
  projectUpdated: 'inventory.project.updated',
  buildingCreated: 'inventory.building.created',
  buildingUpdated: 'inventory.building.updated',
  unitCreated: 'inventory.unit.created',
  unitUpdated: 'inventory.unit.updated',
  unitStatusChanged: 'inventory.unit.statusChanged',
  unitStatusRefused: 'inventory.unit.statusRefused',
  unitPriceChanged: 'inventory.unit.priceChanged',
  priceProposed: 'inventory.price.proposed',
  priceApplied: 'inventory.price.applied',
  priceRejected: 'inventory.price.rejected',
  priceCancelled: 'inventory.price.cancelled',
  holdTaken: 'inventory.hold.taken',
  holdReleased: 'inventory.hold.released',
  holdExpired: 'inventory.hold.expired',
  holdExtended: 'inventory.hold.extended',
  holdExtensionRequested: 'inventory.hold.extensionRequested',
  holdConverted: 'inventory.hold.converted',
  planTemplateCreated: 'inventory.planTemplate.created',
  planTemplateRetired: 'inventory.planTemplate.retired',
} as const;
