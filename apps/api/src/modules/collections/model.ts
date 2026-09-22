import {
  INSTRUMENT_KINDS,
  INSTRUMENT_STATES,
  PAYMENT_METHODS,
  RECEIPT_STATES,
  REMINDER_CHANNELS,
  REMINDER_STATES,
} from '@alola/contracts';
import { Schema, type Connection, type Model, type Types } from 'mongoose';

/**
 * Collections storage — `COL-*` demonstration slice (ADR-0025).
 *
 * Three collections: receipts, instruments, reminders.
 *
 * A **posted receipt is immutable except for its reversal**. The schema enforces it: an update whose
 * `$set` touches anything other than the reversal fields is refused, and deletion is refused outright.
 * That is stricter than a service check, because a receipt is a document the customer holds and a
 * silent edit makes the two copies disagree (ADR-0009).
 */
export const RECEIPTS_COLLECTION = 'collectionReceipts';
export const INSTRUMENTS_COLLECTION = 'collectionInstruments';
export const REMINDERS_COLLECTION = 'collectionReminders';

export class ReceiptImmutableError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly detail: string) {
    super(
      `A posted receipt is reversed, never edited or deleted: ${detail} is refused (ADR-0009).`,
    );
    this.name = 'ReceiptImmutableError';
  }
}

export class InstrumentUndeletableError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly operation: string) {
    super(`Instruments are cancelled, never deleted: "${operation}" is refused (ADR-0009).`);
    this.name = 'InstrumentUndeletableError';
  }
}

export interface StoredMoney {
  amount: Types.Decimal128;
  currency: string;
}

export interface StoredAllocation {
  installmentId: string;
  sequence: number;
  dueOn: string;
  amount: StoredMoney;
}

export interface ReceiptDocument {
  receiptId: string;
  receiptNumber: string;
  customerId: string;
  contractId: string;
  projectId: string;
  amount: StoredMoney;
  method: (typeof PAYMENT_METHODS)[number];
  depositReference?: string;
  transactionReference?: string;
  instrumentId?: string;
  allocations: StoredAllocation[];
  receivedByAccountId: string;
  receivedOn: string;
  state: (typeof RECEIPT_STATES)[number];
  reversedAt?: Date;
  reversedByAccountId?: string;
  reversalReason?: string;
  legalEntityId: string;
  branchId: string;
  teamId?: string;
  notes?: string;
  idempotencyKey: string;
  idempotencyFingerprint: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InstrumentDocument {
  instrumentId: string;
  kind: (typeof INSTRUMENT_KINDS)[number];
  instrumentNumber: string;
  customerId: string;
  contractId: string;
  projectId: string;
  installmentId?: string;
  amount: StoredMoney;
  issuedOn: string;
  dueOn: string;
  bankName?: string;
  drawerName: string;
  state: (typeof INSTRUMENT_STATES)[number];
  custodyLocation?: string;
  settlementReceiptId?: string;
  replacedByInstrumentId?: string;
  returnReason?: string;
  legalEntityId: string;
  branchId: string;
  teamId?: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReminderDocument {
  reminderId: string;
  installmentId: string;
  contractId: string;
  customerId: string;
  projectId: string;
  dueOn: string;
  amount: StoredMoney;
  channel: (typeof REMINDER_CHANNELS)[number];
  state: (typeof REMINDER_STATES)[number];
  messageAr: string;
  messageEn: string;
  generatedOn: string;
  lastAttemptAt?: Date;
  failureReason?: string;
  simulated: boolean;
  legalEntityId: string;
  branchId: string;
  teamId?: string;
  salesOwnerAccountId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const DELETE_OPS = ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const;
const UPDATE_OPS = ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'] as const;

/** The only fields a posted receipt may gain, and only on the one reversal transition. */
const REVERSAL_FIELDS = new Set([
  'state',
  'reversedAt',
  'reversedByAccountId',
  'reversalReason',
  'updatedAt',
]);

const money = new Schema(
  {
    amount: { type: Schema.Types.Decimal128, required: true },
    currency: { type: String, required: true },
  },
  { _id: false },
);

const allocation = new Schema(
  {
    installmentId: { type: String, required: true },
    sequence: { type: Number, required: true },
    dueOn: { type: String, required: true },
    amount: { type: money, required: true },
  },
  { _id: false },
);

function receiptSchema(): Schema<ReceiptDocument> {
  const schema = new Schema<ReceiptDocument>(
    {
      receiptId: { type: String, required: true, immutable: true },
      receiptNumber: { type: String, required: true, immutable: true },
      customerId: { type: String, required: true, immutable: true },
      contractId: { type: String, required: true, immutable: true },
      projectId: { type: String, required: true, immutable: true },
      amount: { type: money, required: true, immutable: true },
      method: { type: String, required: true, immutable: true, enum: [...PAYMENT_METHODS] },
      depositReference: { type: String, immutable: true },
      transactionReference: { type: String, immutable: true },
      instrumentId: { type: String, immutable: true },
      allocations: { type: [allocation], required: true, immutable: true },
      receivedByAccountId: { type: String, required: true, immutable: true },
      receivedOn: { type: String, required: true, immutable: true },
      state: { type: String, required: true, enum: [...RECEIPT_STATES] },
      reversedAt: { type: Date },
      reversedByAccountId: { type: String },
      reversalReason: { type: String },
      legalEntityId: { type: String, required: true, immutable: true },
      branchId: { type: String, required: true, immutable: true },
      teamId: { type: String, immutable: true },
      notes: { type: String, immutable: true },
      idempotencyKey: { type: String, required: true, immutable: true },
      idempotencyFingerprint: { type: String, required: true, immutable: true },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: RECEIPTS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );

  /**
   * Reversal is the **only** permitted update. Every field above is already `immutable`, which stops
   * an edit through a loaded document; this stops one through a query update, which bypasses that.
   */
  for (const operation of UPDATE_OPS) {
    schema.pre(operation, function rejectEdit() {
      const update = this.getUpdate() as { $set?: Record<string, unknown> } | null;
      const set = update?.$set ?? {};
      const touched = Object.keys(set);
      if (touched.length === 0) throw new ReceiptImmutableError('an empty update');
      const disallowed = touched.filter((field) => !REVERSAL_FIELDS.has(field));
      if (disallowed.length > 0) {
        throw new ReceiptImmutableError(`updating ${disallowed.join(', ')}`);
      }
      const target = set['state'];
      if (target !== undefined && target !== 'reversed') {
        throw new ReceiptImmutableError(
          `moving a receipt to ${typeof target === 'string' ? target : 'a non-string state'}`,
        );
      }
    });
  }
  for (const operation of DELETE_OPS) {
    schema.pre(operation, function rejectDelete() {
      throw new ReceiptImmutableError(operation);
    });
  }
  schema.pre('bulkWrite', function rejectBulkWrite() {
    throw new ReceiptImmutableError('bulkWrite');
  });

  schema.index({ receiptId: 1 }, { unique: true, name: 'collectionReceipts_id_unique' });
  schema.index({ receiptNumber: 1 }, { unique: true, name: 'collectionReceipts_number_unique' });
  // A retried submission must never collect the money twice; the database decides, not a read-check.
  schema.index(
    { idempotencyKey: 1 },
    { unique: true, name: 'collectionReceipts_idempotency_unique' },
  );
  schema.index({ contractId: 1, receivedOn: -1 }, { name: 'collectionReceipts_contract_received' });
  schema.index({ customerId: 1, receivedOn: -1 }, { name: 'collectionReceipts_customer' });
  schema.index({ state: 1, createdAt: -1, receiptId: -1 }, { name: 'collectionReceipts_keyset' });
  schema.index({ legalEntityId: 1, branchId: 1, state: 1 }, { name: 'collectionReceipts_scope' });
  schema.index({ projectId: 1, state: 1 }, { name: 'collectionReceipts_scope_project' });
  schema.index({ teamId: 1, state: 1 }, { name: 'collectionReceipts_scope_team' });
  schema.index({ 'allocations.installmentId': 1 }, { name: 'collectionReceipts_allocations' });
  return schema;
}

function instrumentSchema(): Schema<InstrumentDocument> {
  const schema = new Schema<InstrumentDocument>(
    {
      instrumentId: { type: String, required: true, immutable: true },
      kind: { type: String, required: true, immutable: true, enum: [...INSTRUMENT_KINDS] },
      instrumentNumber: { type: String, required: true, immutable: true },
      customerId: { type: String, required: true, immutable: true },
      contractId: { type: String, required: true, immutable: true },
      projectId: { type: String, required: true, immutable: true },
      installmentId: { type: String, immutable: true },
      amount: { type: money, required: true, immutable: true },
      issuedOn: { type: String, required: true, immutable: true },
      dueOn: { type: String, required: true, immutable: true },
      bankName: { type: String, immutable: true },
      drawerName: { type: String, required: true, immutable: true },
      state: { type: String, required: true, enum: [...INSTRUMENT_STATES] },
      custodyLocation: { type: String },
      settlementReceiptId: { type: String },
      replacedByInstrumentId: { type: String },
      returnReason: { type: String },
      legalEntityId: { type: String, required: true, immutable: true },
      branchId: { type: String, required: true, immutable: true },
      teamId: { type: String },
      version: { type: Number, required: true },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: INSTRUMENTS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  for (const operation of DELETE_OPS) {
    schema.pre(operation, function rejectDelete() {
      throw new InstrumentUndeletableError(operation);
    });
  }
  schema.index({ instrumentId: 1 }, { unique: true, name: 'collectionInstruments_id_unique' });
  /**
   * A serial is unique per drawer within a legal entity while the instrument is live. Partial, so a
   * replacement cheque may legitimately reuse a number a cancelled one had, and a bank's serials do
   * not collide across customers.
   */
  schema.index(
    { legalEntityId: 1, kind: 1, instrumentNumber: 1, customerId: 1 },
    {
      unique: true,
      name: 'collectionInstruments_serial_unique',
      partialFilterExpression: {
        state: { $in: ['received', 'deposited', 'presented', 'cleared'] },
      },
    },
  );
  schema.index({ state: 1, dueOn: 1 }, { name: 'collectionInstruments_state_due' });
  schema.index({ contractId: 1, dueOn: 1 }, { name: 'collectionInstruments_contract_due' });
  schema.index({ customerId: 1, state: 1 }, { name: 'collectionInstruments_customer_state' });
  schema.index(
    { legalEntityId: 1, branchId: 1, state: 1 },
    { name: 'collectionInstruments_scope' },
  );
  schema.index({ projectId: 1, state: 1 }, { name: 'collectionInstruments_scope_project' });
  schema.index({ createdAt: -1, instrumentId: -1 }, { name: 'collectionInstruments_keyset' });
  return schema;
}

function reminderSchema(): Schema<ReminderDocument> {
  const schema = new Schema<ReminderDocument>(
    {
      reminderId: { type: String, required: true, immutable: true },
      installmentId: { type: String, required: true, immutable: true },
      contractId: { type: String, required: true, immutable: true },
      customerId: { type: String, required: true, immutable: true },
      projectId: { type: String, required: true, immutable: true },
      dueOn: { type: String, required: true, immutable: true },
      amount: { type: money, required: true },
      channel: { type: String, required: true, enum: [...REMINDER_CHANNELS] },
      state: { type: String, required: true, enum: [...REMINDER_STATES] },
      messageAr: { type: String, required: true },
      messageEn: { type: String, required: true },
      generatedOn: { type: String, required: true, immutable: true },
      lastAttemptAt: { type: Date },
      failureReason: { type: String },
      simulated: { type: Boolean, required: true },
      legalEntityId: { type: String, required: true, immutable: true },
      branchId: { type: String, required: true, immutable: true },
      teamId: { type: String },
      salesOwnerAccountId: { type: String, required: true },
      version: { type: Number, required: true },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: REMINDERS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  for (const operation of DELETE_OPS) {
    schema.pre(operation, function rejectDelete() {
      throw new InstrumentUndeletableError(operation);
    });
  }
  schema.index({ reminderId: 1 }, { unique: true, name: 'collectionReminders_id_unique' });
  /**
   * **One reminder per installment per due date and channel.** This index is what makes generation
   * idempotent: a second sweep on the same day inserts nothing rather than producing a duplicate the
   * customer would receive twice.
   */
  schema.index(
    { installmentId: 1, dueOn: 1, channel: 1 },
    { unique: true, name: 'collectionReminders_window_unique' },
  );
  schema.index({ state: 1, dueOn: 1, reminderId: 1 }, { name: 'collectionReminders_queue' });
  schema.index({ contractId: 1, dueOn: 1 }, { name: 'collectionReminders_contract' });
  schema.index({ customerId: 1, dueOn: 1 }, { name: 'collectionReminders_customer' });
  schema.index({ legalEntityId: 1, branchId: 1, state: 1 }, { name: 'collectionReminders_scope' });
  schema.index({ projectId: 1, state: 1 }, { name: 'collectionReminders_scope_project' });
  schema.index({ teamId: 1, state: 1 }, { name: 'collectionReminders_scope_team' });
  schema.index({ salesOwnerAccountId: 1, state: 1 }, { name: 'collectionReminders_owner_state' });
  return schema;
}

function model<T>(connection: Connection, name: string, build: () => Schema<T>): Model<T> {
  return (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, build());
}

export function receiptModel(connection: Connection): Model<ReceiptDocument> {
  return model(connection, RECEIPTS_COLLECTION, receiptSchema);
}

export function instrumentModel(connection: Connection): Model<InstrumentDocument> {
  return model(connection, INSTRUMENTS_COLLECTION, instrumentSchema);
}

export function reminderModel(connection: Connection): Model<ReminderDocument> {
  return model(connection, REMINDERS_COLLECTION, reminderSchema);
}
