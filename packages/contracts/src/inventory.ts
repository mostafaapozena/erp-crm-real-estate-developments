import { z } from 'zod';
import { BusinessCodeSchema, RecordIdSchema } from './identifiers';
import { LocalizedLabelSchema } from './localized';
import { DecimalStringSchema, MoneySchema } from './money';
import { InstantSchema } from './time';

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
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Project = z.infer<typeof ProjectSchema>;

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
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Building = z.infer<typeof BuildingSchema>;

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
});
export type CreateUnit = z.infer<typeof CreateUnitSchema>;

/** A direct status change, for the transitions a person makes: withdrawing or restoring a unit. */
export const ChangeUnitStatusSchema = z.strictObject({
  status: UnitStatusSchema,
  reason: z.string().trim().min(3).max(500),
  expectedVersion: z.number().int().positive().optional(),
});
export type ChangeUnitStatus = z.infer<typeof ChangeUnitStatusSchema>;

/* --------------------------------------------------------------- unit history */

/**
 * Append-only unit timeline. The audit trail already records every mutation, but it is a security
 * record scoped and field-restricted for investigators; this is the unit's **business** history, which
 * a sales person reads on the unit page. The two answer different questions.
 */
export const UnitEventSchema = z.strictObject({
  eventId: RecordIdSchema,
  unitId: RecordIdSchema,
  projectId: RecordIdSchema,
  kind: z.enum(['created', 'statusChanged', 'priceChanged']),
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

export const INVENTORY_AUDIT_ACTIONS = {
  projectCreated: 'inventory.project.created',
  projectUpdated: 'inventory.project.updated',
  buildingCreated: 'inventory.building.created',
  unitCreated: 'inventory.unit.created',
  unitStatusChanged: 'inventory.unit.statusChanged',
  unitStatusRefused: 'inventory.unit.statusRefused',
  unitPriceChanged: 'inventory.unit.priceChanged',
} as const;
