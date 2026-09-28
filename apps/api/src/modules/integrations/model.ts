import {
  CONNECTION_STATES,
  INTEGRATION_PROVIDERS,
  OUTBOX_STATES,
  WEBHOOK_STATES,
} from '@alola/contracts';
import type { EncryptedValue } from '@alola/security';
import { Schema, type Connection, type Model } from 'mongoose';

/**
 * Integration storage (INTEGRATION-001 … 005).
 *
 * - `integrationConnections` — one row per provider: encrypted credentials, recorded API version,
 *   scopes, health. The ciphertext is never serialized to a response.
 * - `webhookInbox` — each verified webhook once, unique by provider and provider event ID. Operational:
 *   a processed row expires after `purgeAfter`, because the business record it produced is the
 *   evidence, not the delivery.
 * - `integrationOutbox` — each outbound operation once, unique by idempotency key; the dispatcher
 *   passes that key to the provider on every attempt.
 */
export const INTEGRATION_CONNECTIONS_COLLECTION = 'integrationConnections';
export const WEBHOOK_INBOX_COLLECTION = 'webhookInbox';
export const INTEGRATION_OUTBOX_COLLECTION = 'integrationOutbox';

export interface ConnectionDocument {
  provider: (typeof INTEGRATION_PROVIDERS)[number];
  state: (typeof CONNECTION_STATES)[number];
  credentials?: EncryptedValue;
  credentialsUpdatedAt?: Date;
  recordedApiVersion?: string;
  scopes: string[];
  checkedAt?: Date;
  tokenValidUntil?: Date;
  lastSyncAt?: Date;
  lastErrorCode?: string;
  lastErrorAt?: Date;
  version: number;
  updatedAt: Date;
  updatedBy: string;
}

export interface WebhookDocument {
  eventId: string;
  provider: (typeof INTEGRATION_PROVIDERS)[number];
  providerEventId: string;
  eventType: string;
  payload: unknown;
  state: (typeof WEBHOOK_STATES)[number];
  attempts: number;
  nextAttemptAt: Date;
  leaseUntil?: Date;
  lastErrorCode?: string;
  receivedAt: Date;
  processedAt?: Date;
  purgeAfter?: Date;
}

export interface OutboxDocument {
  outboxId: string;
  provider: (typeof INTEGRATION_PROVIDERS)[number];
  operation: string;
  idempotencyKey: string;
  payload: unknown;
  state: (typeof OUTBOX_STATES)[number];
  attempts: number;
  nextAttemptAt: Date;
  leaseUntil?: Date;
  lastErrorCode?: string;
  providerReference?: string;
  createdAt: Date;
  sentAt?: Date;
}

const encrypted = new Schema(
  {
    algorithm: { type: String, required: true },
    keyRef: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    ciphertext: { type: String, required: true },
  },
  { _id: false },
);

const DELETE_OPS = [
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findOneAndReplace',
  'replaceOne',
];

class IntegrationRecordImmutableError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly operation: string) {
    super(`Integration records are not deleted by the application: "${operation}" is refused.`);
    this.name = 'IntegrationRecordImmutableError';
  }
}

function refuseDeletes<T>(schema: Schema<T>): Schema<T> {
  for (const operation of DELETE_OPS) {
    schema.pre(operation as 'deleteOne', function refuseOperation() {
      throw new IntegrationRecordImmutableError(operation);
    });
  }
  return schema;
}

function connectionSchema(): Schema<ConnectionDocument> {
  const schema = new Schema<ConnectionDocument>(
    {
      provider: { type: String, required: true, enum: INTEGRATION_PROVIDERS },
      state: { type: String, required: true, enum: CONNECTION_STATES },
      credentials: { type: encrypted },
      credentialsUpdatedAt: { type: Date },
      recordedApiVersion: { type: String },
      scopes: { type: [String], default: [] },
      checkedAt: { type: Date },
      tokenValidUntil: { type: Date },
      lastSyncAt: { type: Date },
      lastErrorCode: { type: String },
      lastErrorAt: { type: Date },
      version: { type: Number, required: true },
      updatedAt: { type: Date, required: true },
      updatedBy: { type: String, required: true },
    },
    {
      collection: INTEGRATION_CONNECTIONS_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
    },
  );
  schema.index({ provider: 1 }, { unique: true, name: 'integrationConnections_provider_unique' });
  return refuseDeletes(schema);
}

function webhookSchema(): Schema<WebhookDocument> {
  const schema = new Schema<WebhookDocument>(
    {
      eventId: { type: String, required: true },
      provider: { type: String, required: true, enum: INTEGRATION_PROVIDERS },
      providerEventId: { type: String, required: true },
      eventType: { type: String, required: true },
      payload: { type: Schema.Types.Mixed },
      state: { type: String, required: true, enum: WEBHOOK_STATES },
      attempts: { type: Number, required: true },
      nextAttemptAt: { type: Date, required: true },
      leaseUntil: { type: Date },
      lastErrorCode: { type: String },
      receivedAt: { type: Date, required: true },
      processedAt: { type: Date },
      purgeAfter: { type: Date },
    },
    { collection: WEBHOOK_INBOX_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  schema.index({ eventId: 1 }, { unique: true, name: 'webhookInbox_id_unique' });
  // INTEGRATION-005: the database, not the application, guarantees one row per provider event.
  schema.index(
    { provider: 1, providerEventId: 1 },
    { unique: true, name: 'webhookInbox_provider_event_unique' },
  );
  schema.index({ state: 1, nextAttemptAt: 1 }, { name: 'webhookInbox_due' });
  schema.index({ purgeAfter: 1 }, { expireAfterSeconds: 0, name: 'webhookInbox_purge' });
  return schema;
}

function outboxSchema(): Schema<OutboxDocument> {
  const schema = new Schema<OutboxDocument>(
    {
      outboxId: { type: String, required: true },
      provider: { type: String, required: true, enum: INTEGRATION_PROVIDERS },
      operation: { type: String, required: true },
      idempotencyKey: { type: String, required: true },
      payload: { type: Schema.Types.Mixed },
      state: { type: String, required: true, enum: OUTBOX_STATES },
      attempts: { type: Number, required: true },
      nextAttemptAt: { type: Date, required: true },
      leaseUntil: { type: Date },
      lastErrorCode: { type: String },
      providerReference: { type: String },
      createdAt: { type: Date, required: true },
      sentAt: { type: Date },
    },
    {
      collection: INTEGRATION_OUTBOX_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
    },
  );
  schema.index({ outboxId: 1 }, { unique: true, name: 'integrationOutbox_id_unique' });
  schema.index({ idempotencyKey: 1 }, { unique: true, name: 'integrationOutbox_key_unique' });
  schema.index({ state: 1, nextAttemptAt: 1 }, { name: 'integrationOutbox_due' });
  return refuseDeletes(schema);
}

function model<T>(connection: Connection, name: string, build: () => Schema<T>): Model<T> {
  return (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, build());
}

export const connectionModel = (connection: Connection) =>
  model(connection, INTEGRATION_CONNECTIONS_COLLECTION, connectionSchema);
export const webhookModel = (connection: Connection) =>
  model(connection, WEBHOOK_INBOX_COLLECTION, webhookSchema);
export const outboxModel = (connection: Connection) =>
  model(connection, INTEGRATION_OUTBOX_COLLECTION, outboxSchema);
