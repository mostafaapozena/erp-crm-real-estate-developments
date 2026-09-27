import {
  DATE_COMPONENTS,
  ISSUED_NUMBER_STATES,
  RESET_POLICIES,
  SEQUENCE_STATES,
  SEQUENCE_TYPES,
} from '@alola/contracts';
import { Schema, type Connection, type Model } from 'mongoose';

/**
 * Number sequence storage (CORE-DOC-001).
 *
 * - `numberSequences` — versioned format definitions; exactly one `active` per document type, enforced
 *   by a partial unique index.
 * - `numberCounters` — one counter per type, period and scope (branch/project). Keyed without the
 *   format version, so a format change continues the series instead of restarting it.
 * - `issuedNumbers` — the ledger. Unique on type + number and on the idempotency key. A number is
 *   immutable; voiding marks it, and nothing is ever deleted (ADR-0009).
 */
export const SEQUENCES_COLLECTION = 'numberSequences';
export const COUNTERS_COLLECTION = 'numberCounters';
export const ISSUED_NUMBERS_COLLECTION = 'issuedNumbers';

export class NumberingRecordImmutableError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly operation: string) {
    super(`Numbering records are never deleted: "${operation}" is refused (ADR-0009).`);
    this.name = 'NumberingRecordImmutableError';
  }
}

export interface SequenceDocument {
  type: (typeof SEQUENCE_TYPES)[number];
  version: number;
  prefix: string;
  suffix?: string;
  separator: '-' | '/' | '';
  dateComponent: (typeof DATE_COMPONENTS)[number];
  /** Absent on formats created before the entity component existed; read as `false`. */
  entityComponent?: boolean;
  branchComponent: boolean;
  projectComponent: boolean;
  padding: number;
  resetPolicy: (typeof RESET_POLICIES)[number];
  startAt: number;
  effectiveFrom: string;
  state: (typeof SEQUENCE_STATES)[number];
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
  activatedAt?: Date;
  retiredAt?: Date;
}

export interface CounterDocument {
  counterKey: string;
  type: string;
  periodKey: string;
  scopeKey: string;
  /** How many numbers the series has issued. The next value is `startAt + issued`. */
  issued: number;
  updatedAt: Date;
}

export interface IssuedNumberDocument {
  number: string;
  type: (typeof SEQUENCE_TYPES)[number];
  sequenceVersion: number;
  periodKey: string;
  scopeKey: string;
  counterValue: number;
  issueDate: string;
  idempotencyKey: string;
  /** A hash of what was asked for, so a replay with different input is a conflict. */
  fingerprint: string;
  source: { type: string; id: string };
  state: (typeof ISSUED_NUMBER_STATES)[number];
  voidReason?: string;
  issuedAt: Date;
  issuedBy: string;
  voidedAt?: Date;
  voidedBy?: string;
}

const DELETE_OPS = ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const;

function refuseDeletion<T>(schema: Schema<T>): Schema<T> {
  for (const operation of DELETE_OPS) {
    schema.pre(operation, function refuse() {
      throw new NumberingRecordImmutableError(operation);
    });
  }
  return schema;
}

function sequenceSchema(): Schema<SequenceDocument> {
  const schema = new Schema<SequenceDocument>(
    {
      type: { type: String, required: true, immutable: true, enum: [...SEQUENCE_TYPES] },
      version: { type: Number, required: true, immutable: true },
      prefix: { type: String, required: true },
      suffix: { type: String },
      separator: { type: String, enum: ['-', '/', ''], default: '-' },
      dateComponent: { type: String, required: true, enum: [...DATE_COMPONENTS] },
      entityComponent: { type: Boolean, default: false },
      branchComponent: { type: Boolean, required: true },
      projectComponent: { type: Boolean, required: true },
      padding: { type: Number, required: true },
      resetPolicy: { type: String, required: true, enum: [...RESET_POLICIES] },
      startAt: { type: Number, required: true },
      effectiveFrom: { type: String, required: true },
      state: { type: String, required: true, enum: [...SEQUENCE_STATES] },
      createdAt: { type: Date, required: true, immutable: true },
      createdBy: { type: String, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
      updatedBy: { type: String, required: true },
      activatedAt: { type: Date },
      retiredAt: { type: Date },
    },
    { collection: SEQUENCES_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  schema.index(
    { type: 1, version: 1 },
    { unique: true, name: 'numberSequences_type_version_unique' },
  );
  // Exactly one active format per document type: the database decides a concurrent activation.
  schema.index(
    { type: 1 },
    {
      unique: true,
      name: 'numberSequences_type_active_unique',
      partialFilterExpression: { state: 'active' },
    },
  );
  return refuseDeletion(schema);
}

function counterSchema(): Schema<CounterDocument> {
  const schema = new Schema<CounterDocument>(
    {
      counterKey: { type: String, required: true, immutable: true },
      type: { type: String, required: true, immutable: true },
      periodKey: { type: String, required: true, immutable: true },
      scopeKey: { type: String, required: true, immutable: true },
      issued: { type: Number, required: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: COUNTERS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  schema.index({ counterKey: 1 }, { unique: true, name: 'numberCounters_key_unique' });
  return refuseDeletion(schema);
}

function issuedNumberSchema(): Schema<IssuedNumberDocument> {
  const schema = new Schema<IssuedNumberDocument>(
    {
      number: { type: String, required: true, immutable: true },
      type: { type: String, required: true, immutable: true, enum: [...SEQUENCE_TYPES] },
      sequenceVersion: { type: Number, required: true, immutable: true },
      periodKey: { type: String, required: true, immutable: true },
      scopeKey: { type: String, required: true, immutable: true },
      counterValue: { type: Number, required: true, immutable: true },
      issueDate: { type: String, required: true, immutable: true },
      idempotencyKey: { type: String, required: true, immutable: true },
      fingerprint: { type: String, required: true, immutable: true },
      source: {
        type: new Schema(
          { type: { type: String, required: true }, id: { type: String, required: true } },
          { _id: false },
        ),
        required: true,
        immutable: true,
      },
      state: { type: String, required: true, enum: [...ISSUED_NUMBER_STATES] },
      voidReason: { type: String },
      issuedAt: { type: Date, required: true, immutable: true },
      issuedBy: { type: String, required: true, immutable: true },
      voidedAt: { type: Date },
      voidedBy: { type: String },
    },
    {
      collection: ISSUED_NUMBERS_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
    },
  );
  // No number is ever issued twice for a type — whatever a format change might produce.
  schema.index({ type: 1, number: 1 }, { unique: true, name: 'issuedNumbers_type_number_unique' });
  schema.index({ idempotencyKey: 1 }, { unique: true, name: 'issuedNumbers_idempotency_unique' });
  schema.index({ type: 1, issuedAt: -1, number: -1 }, { name: 'issuedNumbers_type_keyset' });
  schema.index({ 'source.type': 1, 'source.id': 1 }, { name: 'issuedNumbers_source' });
  return refuseDeletion(schema);
}

function model<T>(connection: Connection, name: string, build: () => Schema<T>): Model<T> {
  return (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, build());
}

export function sequenceModel(connection: Connection): Model<SequenceDocument> {
  return model(connection, SEQUENCES_COLLECTION, sequenceSchema);
}

export function counterModel(connection: Connection): Model<CounterDocument> {
  return model(connection, COUNTERS_COLLECTION, counterSchema);
}

export function issuedNumberModel(connection: Connection): Model<IssuedNumberDocument> {
  return model(connection, ISSUED_NUMBERS_COLLECTION, issuedNumberSchema);
}
