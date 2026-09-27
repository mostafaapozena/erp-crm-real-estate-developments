import { REFERENCE_LISTS } from '@alola/contracts';
import { Schema, type Connection, type Model, type Types } from 'mongoose';

/**
 * Settings and reference data storage (PLAT-024, PLAT-025, PLAT-026).
 *
 * - `settingValues` — one document per **catalogued** key that has ever been set. A key missing
 *   here is at its default.
 * - `settingRevisions` — every value a setting has ever had, append-only.
 * - `referenceItems` — the deployment's reference data. For a list bound to a product enumeration a
 *   row exists only once the deployment has overridden an item; the codes themselves come from the
 *   contracts. Codes are immutable; items are deactivated, never deleted.
 *
 * Nothing here can be deleted through the model (ADR-0009).
 */
export const SETTING_VALUES_COLLECTION = 'settingValues';
export const SETTING_REVISIONS_COLLECTION = 'settingRevisions';
export const REFERENCE_ITEMS_COLLECTION = 'referenceItems';

export class SettingsRecordImmutableError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly operation: string) {
    super(`Settings history is never deleted or rewritten: "${operation}" is refused (ADR-0009).`);
    this.name = 'SettingsRecordImmutableError';
  }
}

export interface SettingValueDocument {
  key: string;
  value: unknown;
  version: number;
  updatedAt: Date;
  updatedBy: string;
}

export interface SettingRevisionDocument {
  revisionId: string;
  key: string;
  version: number;
  value: unknown;
  reason: string;
  changedAt: Date;
  changedBy: string;
}

export interface StoredTaxRate {
  ratePercent: Types.Decimal128;
  effectiveFrom: string;
}

export interface ReferenceItemDocument {
  list: (typeof REFERENCE_LISTS)[number];
  code: string;
  label?: { ar: string; en: string };
  description?: { ar: string; en: string };
  sortOrder?: number;
  active: boolean;
  taxRates?: StoredTaxRate[];
  version: number;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

const DELETE_OPS = ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const;
const REWRITE_OPS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
] as const;

function refuse<T>(schema: Schema<T>, operations: readonly string[]): Schema<T> {
  for (const operation of operations) {
    schema.pre(operation as 'deleteOne', function refuseOperation() {
      throw new SettingsRecordImmutableError(operation);
    });
  }
  return schema;
}

const localized = (max: number) =>
  new Schema(
    {
      ar: { type: String, required: true, maxlength: max },
      en: { type: String, required: true, maxlength: max },
    },
    { _id: false },
  );

function settingValueSchema(): Schema<SettingValueDocument> {
  const schema = new Schema<SettingValueDocument>(
    {
      key: { type: String, required: true, immutable: true },
      value: { type: Schema.Types.Mixed },
      version: { type: Number, required: true },
      updatedAt: { type: Date, required: true },
      updatedBy: { type: String, required: true },
    },
    {
      collection: SETTING_VALUES_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
      minimize: false,
    },
  );
  schema.index({ key: 1 }, { unique: true, name: 'settingValues_key_unique' });
  return refuse(schema, DELETE_OPS);
}

function settingRevisionSchema(): Schema<SettingRevisionDocument> {
  const schema = new Schema<SettingRevisionDocument>(
    {
      revisionId: { type: String, required: true, immutable: true },
      key: { type: String, required: true, immutable: true },
      version: { type: Number, required: true, immutable: true },
      value: { type: Schema.Types.Mixed, immutable: true },
      reason: { type: String, required: true, immutable: true },
      changedAt: { type: Date, required: true, immutable: true },
      changedBy: { type: String, required: true, immutable: true },
    },
    {
      collection: SETTING_REVISIONS_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
      minimize: false,
    },
  );
  schema.index({ revisionId: 1 }, { unique: true, name: 'settingRevisions_id_unique' });
  // One revision per version of a key: two concurrent edits can never both record version N.
  schema.index(
    { key: 1, version: 1 },
    { unique: true, name: 'settingRevisions_key_version_unique' },
  );
  return refuse(schema, [...DELETE_OPS, ...REWRITE_OPS]);
}

const taxRate = new Schema<StoredTaxRate>(
  {
    ratePercent: { type: Schema.Types.Decimal128, required: true },
    effectiveFrom: { type: String, required: true },
  },
  { _id: false },
);

function referenceItemSchema(): Schema<ReferenceItemDocument> {
  const schema = new Schema<ReferenceItemDocument>(
    {
      list: { type: String, required: true, immutable: true, enum: [...REFERENCE_LISTS] },
      code: { type: String, required: true, immutable: true },
      label: { type: localized(120) },
      description: { type: localized(500) },
      sortOrder: { type: Number },
      active: { type: Boolean, required: true },
      taxRates: { type: [taxRate], default: undefined },
      version: { type: Number, required: true },
      createdAt: { type: Date, required: true, immutable: true },
      createdBy: { type: String, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
      updatedBy: { type: String, required: true },
    },
    {
      collection: REFERENCE_ITEMS_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
    },
  );
  // A code is unique within its list and never changes: records store the code, not the label.
  schema.index({ list: 1, code: 1 }, { unique: true, name: 'referenceItems_list_code_unique' });
  schema.index({ list: 1, active: 1, sortOrder: 1 }, { name: 'referenceItems_list_active_order' });
  return refuse(schema, DELETE_OPS);
}

function model<T>(connection: Connection, name: string, build: () => Schema<T>): Model<T> {
  return (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, build());
}

export function settingValueModel(connection: Connection): Model<SettingValueDocument> {
  return model(connection, SETTING_VALUES_COLLECTION, settingValueSchema);
}

export function settingRevisionModel(connection: Connection): Model<SettingRevisionDocument> {
  return model(connection, SETTING_REVISIONS_COLLECTION, settingRevisionSchema);
}

export function referenceItemModel(connection: Connection): Model<ReferenceItemDocument> {
  return model(connection, REFERENCE_ITEMS_COLLECTION, referenceItemSchema);
}
