import {
  FINISHING_STATUSES,
  HOLD_STATES,
  PLAN_TEMPLATE_STATES,
  PRICE_VERSION_STATES,
  PROJECT_STATUSES,
  PROPERTY_TYPES,
  UNIT_STATUSES,
  USAGE_TYPES,
} from '@alola/contracts';
import { Schema, type Connection, type Model, type Types } from 'mongoose';

/**
 * Inventory storage — `INV-*` demonstration slice (ADR-0025).
 *
 * Four collections: projects, buildings, units, and an append-only unit timeline.
 *
 * Money is `Decimal128` in storage and a decimal string in the application (ADR-0007). It never
 * passes through a JavaScript number, including here: the conversion happens at this boundary and
 * nowhere else.
 *
 * A unit is **never deleted**. Withdrawing one from sale is the `unavailable` status, because a
 * reservation, a contract and an audit record may already reference it (ADR-0009).
 */
export const PROJECTS_COLLECTION = 'inventoryProjects';
export const BUILDINGS_COLLECTION = 'inventoryBuildings';
export const UNITS_COLLECTION = 'inventoryUnits';
export const UNIT_EVENTS_COLLECTION = 'inventoryUnitEvents';
export const PRICE_VERSIONS_COLLECTION = 'inventoryPriceVersions';
export const HOLDS_COLLECTION = 'inventoryHolds';
export const PLAN_TEMPLATES_COLLECTION = 'inventoryPlanTemplates';

export class UnitUndeletableError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly operation: string) {
    super(`Inventory records are withdrawn, never deleted: "${operation}" is refused (ADR-0009).`);
    this.name = 'UnitUndeletableError';
  }
}

export class UnitHistoryImmutableError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly operation: string) {
    super(`The unit timeline is append-only: "${operation}" is refused.`);
    this.name = 'UnitHistoryImmutableError';
  }
}

export interface StoredLocalizedLabel {
  ar: string;
  en: string;
}

export interface StoredMoney {
  amount: Types.Decimal128;
  currency: string;
}

export interface ProjectDocument {
  projectId: string;
  legalEntityId: string;
  branchId: string;
  code: string;
  name: StoredLocalizedLabel;
  city: StoredLocalizedLabel;
  description?: StoredLocalizedLabel;
  status: (typeof PROJECT_STATUSES)[number];
  currency: string;
  /** Absent on a record from before BMP-1, which reads as version 1. */
  version?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BuildingDocument {
  buildingId: string;
  projectId: string;
  legalEntityId: string;
  branchId: string;
  code: string;
  name: StoredLocalizedLabel;
  zone?: StoredLocalizedLabel;
  floors: number;
  version?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UnitDocument {
  unitId: string;
  projectId: string;
  buildingId: string;
  legalEntityId: string;
  branchId: string;
  code: string;
  floor: number;
  propertyType: (typeof PROPERTY_TYPES)[number];
  usageType: (typeof USAGE_TYPES)[number];
  area: Types.Decimal128;
  gardenArea?: Types.Decimal128;
  roofArea?: Types.Decimal128;
  bedrooms?: number;
  bathrooms?: number;
  parkingSpaces?: number;
  storageRooms?: number;
  basePrice: StoredMoney;
  currentPrice: StoredMoney;
  pricePerSquareMeter: StoredMoney;
  status: (typeof UNIT_STATUSES)[number];
  finishingStatus: (typeof FINISHING_STATUSES)[number];
  view?: StoredLocalizedLabel;
  paymentPlanSummary?: StoredLocalizedLabel;
  heldByReservationId?: string;
  heldByHoldId?: string;
  contractId?: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UnitEventDocument {
  eventId: string;
  unitId: string;
  projectId: string;
  kind: 'created' | 'statusChanged' | 'priceChanged' | 'attributesChanged';
  fromStatus?: string;
  toStatus?: string;
  reason?: string;
  sourceType?: string;
  sourceId?: string;
  actorAccountId?: string;
  occurredAt: Date;
}

/**
 * One proposed price for one unit (INV-PRICE-001). A version is written once and then only moves
 * through its states; its price, date and reason are never edited.
 */
export interface PriceVersionDocument {
  priceVersionId: string;
  unitId: string;
  projectId: string;
  legalEntityId: string;
  branchId: string;
  sequence: number;
  price: StoredMoney;
  previousPrice: StoredMoney;
  changePercentage: string;
  effectiveFrom: string;
  state: (typeof PRICE_VERSION_STATES)[number];
  reason: string;
  approvalRequestId?: string;
  idempotencyKey: string;
  idempotencyFingerprint: string;
  proposedBy: string;
  proposedAt: Date;
  appliedAt?: Date;
  updatedAt: Date;
}

/** A timed customer hold (INV-HOLD-001). Released, expired or converted — never deleted. */
export interface HoldDocument {
  holdId: string;
  unitId: string;
  projectId: string;
  legalEntityId: string;
  branchId: string;
  customerId?: string;
  opportunityId?: string;
  holderAccountId: string;
  state: (typeof HOLD_STATES)[number];
  expiresAt: Date;
  extensions: number;
  note?: string;
  releaseReason?: string;
  reservationId?: string;
  extensionApprovalRequestId?: string;
  idempotencyKey: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A payment-plan template (INV-PLAN-001). Retired, never edited or deleted. */
export interface PlanTemplateDocument {
  templateId: string;
  code: string;
  name: StoredLocalizedLabel;
  projectIds: string[];
  legalEntityId: string;
  downPaymentPercent: string;
  installmentCount: number;
  frequency: 'monthly' | 'quarterly' | 'semiAnnual' | 'annual';
  firstInstallmentAfterMonths: number;
  finalPaymentPercent?: string;
  state: (typeof PLAN_TEMPLATE_STATES)[number];
  createdBy: string;
  createdAt: Date;
  retiredAt?: Date;
}

const MUTATING_QUERY_OPS = [
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
] as const;

const DELETE_OPS = ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const;

const localizedLabel = new Schema(
  { ar: { type: String, required: true }, en: { type: String, required: true } },
  { _id: false },
);

const money = new Schema(
  {
    amount: { type: Schema.Types.Decimal128, required: true },
    currency: { type: String, required: true },
  },
  { _id: false },
);

function projectSchema(): Schema<ProjectDocument> {
  const schema = new Schema<ProjectDocument>(
    {
      projectId: { type: String, required: true, immutable: true },
      legalEntityId: { type: String, required: true, immutable: true },
      branchId: { type: String, required: true, immutable: true },
      code: { type: String, required: true, immutable: true },
      name: { type: localizedLabel, required: true },
      city: { type: localizedLabel, required: true },
      description: { type: localizedLabel },
      status: { type: String, required: true, enum: [...PROJECT_STATUSES] },
      currency: { type: String, required: true, immutable: true },
      version: { type: Number },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: PROJECTS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  for (const operation of DELETE_OPS) {
    schema.pre(operation, function rejectDelete() {
      throw new UnitUndeletableError(operation);
    });
  }
  schema.index({ projectId: 1 }, { unique: true, name: 'inventoryProjects_id_unique' });
  schema.index({ code: 1 }, { unique: true, name: 'inventoryProjects_code_unique' });
  schema.index(
    { legalEntityId: 1, branchId: 1, status: 1 },
    { name: 'inventoryProjects_scope_status' },
  );
  return schema;
}

function buildingSchema(): Schema<BuildingDocument> {
  const schema = new Schema<BuildingDocument>(
    {
      buildingId: { type: String, required: true, immutable: true },
      projectId: { type: String, required: true, immutable: true },
      legalEntityId: { type: String, required: true, immutable: true },
      branchId: { type: String, required: true, immutable: true },
      code: { type: String, required: true, immutable: true },
      name: { type: localizedLabel, required: true },
      zone: { type: localizedLabel },
      floors: { type: Number, required: true },
      version: { type: Number },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: BUILDINGS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  for (const operation of DELETE_OPS) {
    schema.pre(operation, function rejectDelete() {
      throw new UnitUndeletableError(operation);
    });
  }
  schema.index({ buildingId: 1 }, { unique: true, name: 'inventoryBuildings_id_unique' });
  schema.index(
    { projectId: 1, code: 1 },
    { unique: true, name: 'inventoryBuildings_project_code_unique' },
  );
  schema.index({ legalEntityId: 1, branchId: 1 }, { name: 'inventoryBuildings_scope' });
  return schema;
}

function unitSchema(): Schema<UnitDocument> {
  const schema = new Schema<UnitDocument>(
    {
      unitId: { type: String, required: true, immutable: true },
      projectId: { type: String, required: true, immutable: true },
      buildingId: { type: String, required: true, immutable: true },
      legalEntityId: { type: String, required: true, immutable: true },
      branchId: { type: String, required: true, immutable: true },
      code: { type: String, required: true, immutable: true },
      floor: { type: Number, required: true },
      propertyType: { type: String, required: true, enum: [...PROPERTY_TYPES] },
      usageType: { type: String, required: true, enum: [...USAGE_TYPES] },
      area: { type: Schema.Types.Decimal128, required: true },
      gardenArea: { type: Schema.Types.Decimal128 },
      roofArea: { type: Schema.Types.Decimal128 },
      bedrooms: { type: Number },
      bathrooms: { type: Number },
      parkingSpaces: { type: Number },
      storageRooms: { type: Number },
      basePrice: { type: money, required: true },
      currentPrice: { type: money, required: true },
      pricePerSquareMeter: { type: money, required: true },
      status: { type: String, required: true, enum: [...UNIT_STATUSES] },
      finishingStatus: { type: String, required: true, enum: [...FINISHING_STATUSES] },
      view: { type: localizedLabel },
      paymentPlanSummary: { type: localizedLabel },
      heldByReservationId: { type: String },
      heldByHoldId: { type: String },
      contractId: { type: String },
      version: { type: Number, required: true },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: UNITS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  for (const operation of DELETE_OPS) {
    schema.pre(operation, function rejectDelete() {
      throw new UnitUndeletableError(operation);
    });
  }
  schema.index({ unitId: 1 }, { unique: true, name: 'inventoryUnits_id_unique' });
  // A unit code is unique inside its project — "A-1201" means nothing across two developments.
  schema.index(
    { projectId: 1, code: 1 },
    { unique: true, name: 'inventoryUnits_project_code_unique' },
  );
  /**
   * One reservation holds at most one unit. Partial and unique, so a reservation cannot be spread
   * across two units by a retry or a bug, and a terminal record never blocks a new one.
   *
   * The converse — one live reservation per unit — is not this index's job. `unitId` is already unique
   * in this collection, so a unit has exactly one `heldByReservationId` value by construction, and two
   * simultaneous reservation attempts are settled by the **conditional** status update in the service:
   * the filter names the status it read, so exactly one of the two matches a document.
   */
  schema.index(
    { heldByReservationId: 1 },
    {
      unique: true,
      name: 'inventoryUnits_liveHold_unique',
      partialFilterExpression: {
        heldByReservationId: { $type: 'string' },
        status: { $in: ['held', 'reserved'] },
      },
    },
  );
  // The units table: filtered by project and status, ordered deterministically for keyset paging.
  schema.index(
    { projectId: 1, status: 1, code: 1 },
    { name: 'inventoryUnits_project_status_code' },
  );
  schema.index({ buildingId: 1, floor: 1, code: 1 }, { name: 'inventoryUnits_building_floor' });
  schema.index(
    { legalEntityId: 1, branchId: 1, status: 1 },
    { name: 'inventoryUnits_scope_status' },
  );
  schema.index(
    { usageType: 1, propertyType: 1, status: 1 },
    { name: 'inventoryUnits_type_status' },
  );
  schema.index({ code: 1, unitId: 1 }, { name: 'inventoryUnits_code_keyset' });
  schema.index({ contractId: 1 }, { name: 'inventoryUnits_contract' });
  return schema;
}

function unitEventSchema(): Schema<UnitEventDocument> {
  const schema = new Schema<UnitEventDocument>(
    {
      eventId: { type: String, required: true, immutable: true },
      unitId: { type: String, required: true, immutable: true },
      projectId: { type: String, required: true, immutable: true },
      kind: { type: String, required: true, immutable: true },
      fromStatus: { type: String, immutable: true },
      toStatus: { type: String, immutable: true },
      reason: { type: String, immutable: true },
      sourceType: { type: String, immutable: true },
      sourceId: { type: String, immutable: true },
      actorAccountId: { type: String, immutable: true },
      occurredAt: { type: Date, required: true, immutable: true },
    },
    { collection: UNIT_EVENTS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  // Append-only, enforced the way the audit trail is (ADR-0021): no mutating path reaches it at all.
  for (const operation of MUTATING_QUERY_OPS) {
    schema.pre(operation, function rejectMutation() {
      throw new UnitHistoryImmutableError(operation);
    });
  }
  schema.pre('save', function rejectResave() {
    if (!this.isNew) throw new UnitHistoryImmutableError('save (existing document)');
  });
  schema.index({ eventId: 1 }, { unique: true, name: 'inventoryUnitEvents_id_unique' });
  schema.index({ unitId: 1, occurredAt: -1 }, { name: 'inventoryUnitEvents_unit_time' });
  schema.index({ projectId: 1, occurredAt: -1 }, { name: 'inventoryUnitEvents_project_time' });
  return schema;
}

function priceVersionSchema(): Schema<PriceVersionDocument> {
  const schema = new Schema<PriceVersionDocument>(
    {
      priceVersionId: { type: String, required: true, immutable: true },
      unitId: { type: String, required: true, immutable: true },
      projectId: { type: String, required: true, immutable: true },
      legalEntityId: { type: String, required: true, immutable: true },
      branchId: { type: String, required: true, immutable: true },
      sequence: { type: Number, required: true, immutable: true },
      // What was proposed is evidence: the price, its date and its reason never change.
      price: { type: money, required: true, immutable: true },
      previousPrice: { type: money, required: true, immutable: true },
      changePercentage: { type: String, required: true, immutable: true },
      effectiveFrom: { type: String, required: true, immutable: true },
      state: { type: String, required: true, enum: [...PRICE_VERSION_STATES] },
      reason: { type: String, required: true, immutable: true },
      approvalRequestId: { type: String },
      idempotencyKey: { type: String, required: true, immutable: true },
      idempotencyFingerprint: { type: String, required: true, immutable: true },
      proposedBy: { type: String, required: true, immutable: true },
      proposedAt: { type: Date, required: true, immutable: true },
      appliedAt: { type: Date },
      updatedAt: { type: Date, required: true },
    },
    {
      collection: PRICE_VERSIONS_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
    },
  );
  for (const operation of DELETE_OPS) {
    schema.pre(operation, function rejectDelete() {
      throw new UnitUndeletableError(operation);
    });
  }
  schema.index({ priceVersionId: 1 }, { unique: true, name: 'inventoryPriceVersions_id_unique' });
  schema.index(
    { unitId: 1, sequence: 1 },
    { unique: true, name: 'inventoryPriceVersions_unit_sequence_unique' },
  );
  schema.index(
    { idempotencyKey: 1 },
    { unique: true, name: 'inventoryPriceVersions_idempotency_unique' },
  );
  /** At most one proposal waiting per unit, so two changes cannot race to be applied. */
  schema.index(
    { unitId: 1 },
    {
      unique: true,
      name: 'inventoryPriceVersions_openPerUnit_unique',
      partialFilterExpression: { state: { $in: ['pendingApproval', 'scheduled'] } },
    },
  );
  schema.index({ state: 1, effectiveFrom: 1 }, { name: 'inventoryPriceVersions_due' });
  schema.index({ approvalRequestId: 1 }, { name: 'inventoryPriceVersions_approval' });
  return schema;
}

function holdSchema(): Schema<HoldDocument> {
  const schema = new Schema<HoldDocument>(
    {
      holdId: { type: String, required: true, immutable: true },
      unitId: { type: String, required: true, immutable: true },
      projectId: { type: String, required: true, immutable: true },
      legalEntityId: { type: String, required: true, immutable: true },
      branchId: { type: String, required: true, immutable: true },
      customerId: { type: String, immutable: true },
      opportunityId: { type: String, immutable: true },
      holderAccountId: { type: String, required: true, immutable: true },
      state: { type: String, required: true, enum: [...HOLD_STATES] },
      expiresAt: { type: Date, required: true },
      extensions: { type: Number, required: true },
      note: { type: String, immutable: true },
      releaseReason: { type: String },
      reservationId: { type: String },
      extensionApprovalRequestId: { type: String },
      idempotencyKey: { type: String, required: true, immutable: true },
      version: { type: Number, required: true },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: HOLDS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  for (const operation of DELETE_OPS) {
    schema.pre(operation, function rejectDelete() {
      throw new UnitUndeletableError(operation);
    });
  }
  schema.index({ holdId: 1 }, { unique: true, name: 'inventoryHolds_id_unique' });
  schema.index({ idempotencyKey: 1 }, { unique: true, name: 'inventoryHolds_idempotency_unique' });
  /** One active hold per unit: the database settles a race the status update already settles. */
  schema.index(
    { unitId: 1 },
    {
      unique: true,
      name: 'inventoryHolds_activePerUnit_unique',
      partialFilterExpression: { state: 'active' },
    },
  );
  schema.index({ state: 1, expiresAt: 1 }, { name: 'inventoryHolds_expiry' });
  schema.index({ holderAccountId: 1, state: 1 }, { name: 'inventoryHolds_holder_state' });
  schema.index({ legalEntityId: 1, branchId: 1, state: 1 }, { name: 'inventoryHolds_scope' });
  schema.index({ projectId: 1, state: 1 }, { name: 'inventoryHolds_project_state' });
  schema.index({ extensionApprovalRequestId: 1 }, { name: 'inventoryHolds_extension_approval' });
  return schema;
}

function planTemplateSchema(): Schema<PlanTemplateDocument> {
  const schema = new Schema<PlanTemplateDocument>(
    {
      templateId: { type: String, required: true, immutable: true },
      code: { type: String, required: true, immutable: true },
      name: { type: localizedLabel, required: true, immutable: true },
      projectIds: { type: [String], required: true, immutable: true },
      legalEntityId: { type: String, required: true, immutable: true },
      downPaymentPercent: { type: String, required: true, immutable: true },
      installmentCount: { type: Number, required: true, immutable: true },
      frequency: {
        type: String,
        required: true,
        immutable: true,
        enum: ['monthly', 'quarterly', 'semiAnnual', 'annual'],
      },
      firstInstallmentAfterMonths: { type: Number, required: true, immutable: true },
      finalPaymentPercent: { type: String, immutable: true },
      state: { type: String, required: true, enum: [...PLAN_TEMPLATE_STATES] },
      createdBy: { type: String, required: true, immutable: true },
      createdAt: { type: Date, required: true, immutable: true },
      retiredAt: { type: Date },
    },
    {
      collection: PLAN_TEMPLATES_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
    },
  );
  for (const operation of DELETE_OPS) {
    schema.pre(operation, function rejectDelete() {
      throw new UnitUndeletableError(operation);
    });
  }
  schema.index({ templateId: 1 }, { unique: true, name: 'inventoryPlanTemplates_id_unique' });
  schema.index(
    { legalEntityId: 1, code: 1 },
    { unique: true, name: 'inventoryPlanTemplates_entity_code_unique' },
  );
  schema.index({ state: 1, projectIds: 1 }, { name: 'inventoryPlanTemplates_state_project' });
  return schema;
}

function model<T>(connection: Connection, name: string, build: () => Schema<T>): Model<T> {
  return (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, build());
}

export function projectModel(connection: Connection): Model<ProjectDocument> {
  return model(connection, PROJECTS_COLLECTION, projectSchema);
}

export function buildingModel(connection: Connection): Model<BuildingDocument> {
  return model(connection, BUILDINGS_COLLECTION, buildingSchema);
}

export function unitModel(connection: Connection): Model<UnitDocument> {
  return model(connection, UNITS_COLLECTION, unitSchema);
}

export function unitEventModel(connection: Connection): Model<UnitEventDocument> {
  return model(connection, UNIT_EVENTS_COLLECTION, unitEventSchema);
}

export function priceVersionModel(connection: Connection): Model<PriceVersionDocument> {
  return model(connection, PRICE_VERSIONS_COLLECTION, priceVersionSchema);
}

export function holdModel(connection: Connection): Model<HoldDocument> {
  return model(connection, HOLDS_COLLECTION, holdSchema);
}

export function planTemplateModel(connection: Connection): Model<PlanTemplateDocument> {
  return model(connection, PLAN_TEMPLATES_COLLECTION, planTemplateSchema);
}
