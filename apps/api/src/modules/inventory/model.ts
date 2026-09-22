import {
  FINISHING_STATUSES,
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
  basePrice: StoredMoney;
  currentPrice: StoredMoney;
  pricePerSquareMeter: StoredMoney;
  status: (typeof UNIT_STATUSES)[number];
  finishingStatus: (typeof FINISHING_STATUSES)[number];
  view?: StoredLocalizedLabel;
  paymentPlanSummary?: StoredLocalizedLabel;
  heldByReservationId?: string;
  contractId?: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UnitEventDocument {
  eventId: string;
  unitId: string;
  projectId: string;
  kind: 'created' | 'statusChanged' | 'priceChanged';
  fromStatus?: string;
  toStatus?: string;
  reason?: string;
  sourceType?: string;
  sourceId?: string;
  actorAccountId?: string;
  occurredAt: Date;
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
      basePrice: { type: money, required: true },
      currentPrice: { type: money, required: true },
      pricePerSquareMeter: { type: money, required: true },
      status: { type: String, required: true, enum: [...UNIT_STATUSES] },
      finishingStatus: { type: String, required: true, enum: [...FINISHING_STATUSES] },
      view: { type: localizedLabel },
      paymentPlanSummary: { type: localizedLabel },
      heldByReservationId: { type: String },
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
