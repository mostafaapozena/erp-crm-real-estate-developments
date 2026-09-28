import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATES,
  NOTIFICATION_TYPES,
  SUPPORTED_LOCALES,
} from '@alola/contracts';
import { Schema, type Connection, type Model } from 'mongoose';

/**
 * Notification storage (CORE-NOTIFY-001, 003, 005).
 *
 * - `notifications` — one row per recipient per channel. For in-app it **is** the inbox. A unique
 *   dedupe key makes creation idempotent: the same event notifies the same person once.
 * - `notificationAttempts` — every delivery attempt, append-only: the evidence that a retry did not
 *   become a second message.
 * - `notificationPreferences` — a person's language and external-channel opt-ins.
 *
 * Delivered notifications are history, not clutter: nothing here is deleted by the application.
 */
export const NOTIFICATIONS_COLLECTION = 'notifications';
export const NOTIFICATION_ATTEMPTS_COLLECTION = 'notificationAttempts';
export const NOTIFICATION_PREFERENCES_COLLECTION = 'notificationPreferences';

export class NotificationRecordImmutableError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly operation: string) {
    super(`Notification history is never deleted or rewritten: "${operation}" is refused.`);
    this.name = 'NotificationRecordImmutableError';
  }
}

export interface NotificationDocument {
  notificationId: string;
  dedupeKey: string;
  type: (typeof NOTIFICATION_TYPES)[number];
  channel: (typeof NOTIFICATION_CHANNELS)[number];
  recipient: { kind: 'account' | 'customer'; id: string };
  locale: (typeof SUPPORTED_LOCALES)[number];
  params: Record<string, string>;
  /** Text composed by the caller (a reminder's bilingual message). Absent: rendered from the type. */
  text?: { ar: string; en: string };
  source?: { type: string; id: string };
  urgent: boolean;
  state: (typeof NOTIFICATION_STATES)[number];
  attempts: number;
  nextAttemptAt?: Date;
  leaseUntil?: Date;
  lastErrorCode?: string;
  providerReference?: string;
  readAt?: Date;
  correlationId?: string;
  createdAt: Date;
  updatedAt: Date;
  deliveredAt?: Date;
}

export interface NotificationAttemptDocument {
  notificationId: string;
  attempt: number;
  channel: string;
  adapter: string;
  outcome: 'delivered' | 'simulated' | 'retryable' | 'permanent' | 'notConnected';
  errorCode?: string;
  providerReference?: string;
  at: Date;
}

export interface NotificationPreferencesDocument {
  accountId: string;
  locale: (typeof SUPPORTED_LOCALES)[number];
  channels: { email: boolean; sms: boolean; whatsapp: boolean };
  updatedAt: Date;
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
      throw new NotificationRecordImmutableError(operation);
    });
  }
  return schema;
}

const pair = new Schema(
  { type: { type: String, required: true }, id: { type: String, required: true } },
  { _id: false },
);

function notificationSchema(): Schema<NotificationDocument> {
  const schema = new Schema<NotificationDocument>(
    {
      notificationId: { type: String, required: true, immutable: true },
      dedupeKey: { type: String, required: true, immutable: true },
      type: { type: String, required: true, immutable: true, enum: [...NOTIFICATION_TYPES] },
      channel: { type: String, required: true, immutable: true, enum: [...NOTIFICATION_CHANNELS] },
      recipient: {
        type: new Schema(
          {
            kind: { type: String, required: true, enum: ['account', 'customer'] },
            id: { type: String, required: true },
          },
          { _id: false },
        ),
        required: true,
        immutable: true,
      },
      locale: { type: String, required: true, enum: [...SUPPORTED_LOCALES] },
      params: { type: Schema.Types.Mixed, required: true, immutable: true },
      text: {
        type: new Schema(
          { ar: { type: String, required: true }, en: { type: String, required: true } },
          { _id: false },
        ),
        immutable: true,
      },
      source: { type: pair, immutable: true },
      urgent: { type: Boolean, required: true, immutable: true },
      state: { type: String, required: true, enum: [...NOTIFICATION_STATES] },
      attempts: { type: Number, required: true },
      nextAttemptAt: { type: Date },
      leaseUntil: { type: Date },
      lastErrorCode: { type: String },
      providerReference: { type: String },
      readAt: { type: Date },
      correlationId: { type: String, immutable: true },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
      deliveredAt: { type: Date },
    },
    {
      collection: NOTIFICATIONS_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
      minimize: false,
    },
  );
  schema.index({ notificationId: 1 }, { unique: true, name: 'notifications_id_unique' });
  // CORE-NOTIFY-005: the same event reaches the same recipient on the same channel once.
  schema.index({ dedupeKey: 1 }, { unique: true, name: 'notifications_dedupe_unique' });
  schema.index(
    { 'recipient.kind': 1, 'recipient.id': 1, channel: 1, createdAt: -1, notificationId: -1 },
    { name: 'notifications_inbox' },
  );
  schema.index(
    { 'recipient.id': 1, channel: 1, readAt: 1 },
    { name: 'notifications_unread', partialFilterExpression: { channel: 'inApp' } },
  );
  schema.index({ state: 1, nextAttemptAt: 1 }, { name: 'notifications_due' });
  schema.index({ state: 1, leaseUntil: 1 }, { name: 'notifications_lease' });
  return refuse(schema, DELETE_OPS);
}

function attemptSchema(): Schema<NotificationAttemptDocument> {
  const schema = new Schema<NotificationAttemptDocument>(
    {
      notificationId: { type: String, required: true, immutable: true },
      attempt: { type: Number, required: true, immutable: true },
      channel: { type: String, required: true, immutable: true },
      adapter: { type: String, required: true, immutable: true },
      outcome: {
        type: String,
        required: true,
        immutable: true,
        enum: ['delivered', 'simulated', 'retryable', 'permanent', 'notConnected'],
      },
      errorCode: { type: String, immutable: true },
      providerReference: { type: String, immutable: true },
      at: { type: Date, required: true, immutable: true },
    },
    {
      collection: NOTIFICATION_ATTEMPTS_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
    },
  );
  // One row per attempt: a crashed dispatcher that retries cannot record attempt N twice.
  schema.index(
    { notificationId: 1, attempt: 1 },
    { unique: true, name: 'notificationAttempts_unique' },
  );
  return refuse(schema, [...DELETE_OPS, ...REWRITE_OPS]);
}

function preferencesSchema(): Schema<NotificationPreferencesDocument> {
  const schema = new Schema<NotificationPreferencesDocument>(
    {
      accountId: { type: String, required: true, immutable: true },
      locale: { type: String, required: true, enum: [...SUPPORTED_LOCALES] },
      channels: {
        type: new Schema(
          {
            email: { type: Boolean, required: true },
            sms: { type: Boolean, required: true },
            whatsapp: { type: Boolean, required: true },
          },
          { _id: false },
        ),
        required: true,
      },
      updatedAt: { type: Date, required: true },
    },
    {
      collection: NOTIFICATION_PREFERENCES_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
    },
  );
  schema.index({ accountId: 1 }, { unique: true, name: 'notificationPreferences_account_unique' });
  return refuse(schema, DELETE_OPS);
}

function model<T>(connection: Connection, name: string, build: () => Schema<T>): Model<T> {
  return (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, build());
}

export function notificationModel(connection: Connection): Model<NotificationDocument> {
  return model(connection, NOTIFICATIONS_COLLECTION, notificationSchema);
}

export function notificationAttemptModel(
  connection: Connection,
): Model<NotificationAttemptDocument> {
  return model(connection, NOTIFICATION_ATTEMPTS_COLLECTION, attemptSchema);
}

export function notificationPreferencesModel(
  connection: Connection,
): Model<NotificationPreferencesDocument> {
  return model(connection, NOTIFICATION_PREFERENCES_COLLECTION, preferencesSchema);
}
