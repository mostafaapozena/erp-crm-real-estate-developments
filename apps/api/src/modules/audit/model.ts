import { Schema, type Connection, type Model } from 'mongoose';

/**
 * Append-only audit store (AUDIT-001, ADR-0009).
 *
 * Immutability is enforced at three levels in the application:
 *
 * 1. **No mutating service method exists.** The module's published interface offers `record`, `query`,
 *    `findByEventId`, and `exportEvents` — there is no update or delete path in code or tooling.
 * 2. **Schema middleware rejects mutation.** Every update and delete query operation throws, so even a
 *    future caller reaching for the model directly fails loudly instead of quietly editing evidence.
 * 3. **Documents are immutable field-by-field**, and re-saving an existing document is refused.
 *
 * **Honest limit:** this is application-level immutability. A privileged database administrator with
 * direct MongoDB access can still modify or drop the collection — no application can prevent that. No
 * cryptographic tamper-proofing is claimed or implemented. Protecting against a privileged operator is an
 * operational control (restricted database roles, append-only backups, off-host retention) and belongs to
 * `SD-18` / Phase 9 hardening.
 */
export const AUDIT_COLLECTION = 'auditEvents';

export class AuditImmutableError extends Error {
  constructor(readonly operation: string) {
    super(
      `Audit records are append-only: "${operation}" is not permitted (AUDIT-001, ADR-0009). ` +
        'Record a new event instead.',
    );
    this.name = 'AuditImmutableError';
  }
}

export interface AuditEventDocument {
  eventId: string;
  occurredAt: Date;
  action: string;
  outcome: 'succeeded' | 'denied' | 'failed';
  actor: {
    kind: 'account' | 'system' | 'anonymous';
    accountId?: string;
    roleKeys?: string[];
    sessionId?: string;
  };
  target: { type: string; id?: string };
  changes?: { path: string; from?: string; to?: string }[];
  reason?: string;
  context: {
    correlationId: string;
    ip?: string;
    userAgent?: string;
    method?: string;
    route?: string;
  };
  provider?: { name: string; requestId?: string };
  schemaVersion: 1;
}

/** Every write operation that must never reach an audit record. */
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

/**
 * Sub-schemas are declared explicitly with `_id: false`. Inline nested objects that also carry options
 * such as `required` are ambiguous to Mongoose, which reads the option as another path.
 */
const actorSchema = new Schema(
  {
    kind: { type: String, required: true, enum: ['account', 'system', 'anonymous'] },
    accountId: { type: String },
    roleKeys: { type: [String], default: undefined },
    sessionId: { type: String },
  },
  { _id: false },
);

const targetSchema = new Schema(
  { type: { type: String, required: true }, id: { type: String } },
  { _id: false },
);

const changeSchema = new Schema(
  { path: { type: String, required: true }, from: { type: String }, to: { type: String } },
  { _id: false },
);

const contextSchema = new Schema(
  {
    correlationId: { type: String, required: true },
    ip: { type: String },
    userAgent: { type: String },
    method: { type: String },
    route: { type: String },
  },
  { _id: false },
);

const providerSchema = new Schema(
  { name: { type: String, required: true }, requestId: { type: String } },
  { _id: false },
);

function buildSchema(): Schema<AuditEventDocument> {
  const schema = new Schema<AuditEventDocument>(
    {
      eventId: { type: String, required: true, immutable: true },
      // Stored as a UTC instant; the process runs with TZ=UTC (ADR-0008).
      occurredAt: { type: Date, required: true, immutable: true },
      action: { type: String, required: true, immutable: true },
      outcome: {
        type: String,
        required: true,
        immutable: true,
        enum: ['succeeded', 'denied', 'failed'],
      },
      actor: { type: actorSchema, required: true, immutable: true },
      target: { type: targetSchema, required: true, immutable: true },
      changes: { type: [changeSchema], default: undefined, immutable: true },
      reason: { type: String, immutable: true },
      context: { type: contextSchema, required: true, immutable: true },
      provider: { type: providerSchema, default: undefined, immutable: true },
      schemaVersion: { type: Number, required: true, immutable: true },
    },
    {
      collection: AUDIT_COLLECTION,
      // Audit records are never updated, so `updatedAt` would be meaningless; `occurredAt` is the time.
      timestamps: false,
      strict: 'throw',
      minimize: false,
      versionKey: false,
    },
  );

  // AUDIT-001: reject every mutating query operation.
  for (const operation of MUTATING_QUERY_OPS) {
    schema.pre(operation, function rejectMutation() {
      throw new AuditImmutableError(operation);
    });
  }
  schema.pre('bulkWrite', function rejectBulkWrite() {
    throw new AuditImmutableError('bulkWrite');
  });
  schema.pre('save', function rejectResave() {
    // Re-saving an existing document would be an edit; only inserts are allowed.
    if (!this.isNew) throw new AuditImmutableError('save (existing document)');
  });

  /**
   * Indexes (AUDIT-002 filters, deterministic pagination, retention scans).
   * `autoIndex` is off globally, so these are created by `ensureIndexes()` at startup.
   */
  schema.index({ eventId: 1 }, { unique: true, name: 'audit_eventId_unique' });
  // Keyset pagination and time-range/retention queries.
  schema.index({ occurredAt: -1, eventId: -1 }, { name: 'audit_occurredAt_eventId' });
  schema.index({ 'actor.accountId': 1, occurredAt: -1 }, { name: 'audit_actor_occurredAt' });
  schema.index(
    { 'target.type': 1, 'target.id': 1, occurredAt: -1 },
    { name: 'audit_target_occurredAt' },
  );
  schema.index({ action: 1, occurredAt: -1 }, { name: 'audit_action_occurredAt' });
  schema.index({ outcome: 1, occurredAt: -1 }, { name: 'audit_outcome_occurredAt' });
  schema.index({ 'context.correlationId': 1 }, { name: 'audit_correlationId' });

  return schema;
}

export function auditModel(connection: Connection): Model<AuditEventDocument> {
  return (
    (connection.models[AUDIT_COLLECTION] as Model<AuditEventDocument> | undefined) ??
    connection.model<AuditEventDocument>(AUDIT_COLLECTION, buildSchema())
  );
}
