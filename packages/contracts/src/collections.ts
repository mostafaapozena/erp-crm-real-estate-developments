import { z } from 'zod';
import { BusinessCodeSchema, EnteredNameSchema, NoteSchema, RecordIdSchema } from './identifiers';
import { MoneySchema } from './money';
import { BusinessDateSchema, InstantSchema } from './time';

/**
 * Collections — `COL-*` demonstration slice (ADR-0025).
 *
 * Receipts, the allocation of money to installments, cheques and promissory notes, and an internal
 * reminder centre. **Not** a general ledger: there is no chart of accounts, no journal, and no
 * posting — those are Phase 6 and are blocked on `SD-08`. What exists here is the collection side of
 * a contract: money arrives, it is allocated, and a receipt records that it happened.
 *
 * The rule that shapes everything: **a posted receipt is never edited.** A mistake is corrected by
 * reversing the receipt and issuing a new one, because a receipt is a document the customer holds and
 * silently changing it makes the two copies disagree (ADR-0009).
 */

/* --------------------------------------------------------------------- receipt */

export const PAYMENT_METHODS = [
  'cash',
  'bankTransfer',
  'card',
  'cheque',
  'promissoryNote',
] as const;
export const PaymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const RECEIPT_STATES = ['posted', 'reversed'] as const;
export const ReceiptStateSchema = z.enum(RECEIPT_STATES);
export type ReceiptState = z.infer<typeof ReceiptStateSchema>;

/** One installment this receipt paid, and by how much. The parts sum exactly to the receipt amount. */
export const AllocationSchema = z.strictObject({
  installmentId: RecordIdSchema,
  sequence: z.number().int().positive(),
  dueOn: BusinessDateSchema,
  amount: MoneySchema,
});
export type Allocation = z.infer<typeof AllocationSchema>;

export const ReceiptSchema = z.strictObject({
  receiptId: RecordIdSchema,
  /** Immutable once issued, unique, and printed on the document the customer keeps. */
  receiptNumber: BusinessCodeSchema,
  customerId: RecordIdSchema,
  contractId: RecordIdSchema,
  projectId: RecordIdSchema,
  amount: MoneySchema,
  method: PaymentMethodSchema,
  /**
   * The bank account or cash box the money landed in. A **reference only**: ALOLA ERP never executes
   * a bank transfer and holds no bank credentials (MASTER-MAPPING §15). Treasury arrives in Phase 6.
   */
  depositReference: z.string().trim().max(120).optional(),
  /** The provider's or bank's own reference for the transaction, as given. Never reformatted. */
  transactionReference: z.string().trim().max(120).optional(),
  /** Set when the money arrived as a cheque or a promissory note that later cleared. */
  instrumentId: RecordIdSchema.optional(),
  allocations: z.array(AllocationSchema).min(1).max(240),
  receivedByAccountId: z.string().min(1).max(200),
  receivedOn: BusinessDateSchema,
  state: ReceiptStateSchema,
  reversedAt: InstantSchema.optional(),
  reversedByAccountId: z.string().min(1).max(200).optional(),
  reversalReason: z.string().max(500).optional(),
  legalEntityId: RecordIdSchema,
  branchId: RecordIdSchema,
  teamId: RecordIdSchema.optional(),
  notes: NoteSchema.optional(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Receipt = z.infer<typeof ReceiptSchema>;

/**
 * Record a collection.
 *
 * The caller may name the installments to pay, or leave `allocations` out and let the service settle
 * the oldest open rows first. Oldest-first is what a collections officer means by "put this against
 * his account", and it is deterministic, which matters when the customer asks why.
 */
export const RecordReceiptSchema = z.strictObject({
  contractId: RecordIdSchema,
  amount: MoneySchema,
  method: PaymentMethodSchema,
  receivedOn: BusinessDateSchema,
  depositReference: z.string().trim().max(120).optional(),
  transactionReference: z.string().trim().max(120).optional(),
  instrumentId: RecordIdSchema.optional(),
  /** Omitted means oldest open installment first. */
  allocations: z
    .array(z.strictObject({ installmentId: RecordIdSchema, amount: MoneySchema }))
    .max(240)
    .optional(),
  notes: NoteSchema.optional(),
  /** A retried submission returns the original receipt instead of collecting the money twice. */
  idempotencyKey: z.string().min(8).max(200),
});
export type RecordReceipt = z.infer<typeof RecordReceiptSchema>;

export const ReverseReceiptSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});
export type ReverseReceipt = z.infer<typeof ReverseReceiptSchema>;

export const ReceiptQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(200).optional(),
  contractId: RecordIdSchema.optional(),
  customerId: RecordIdSchema.optional(),
  projectId: RecordIdSchema.optional(),
  method: PaymentMethodSchema.optional(),
  state: ReceiptStateSchema.optional(),
});
export type ReceiptQuery = z.infer<typeof ReceiptQuerySchema>;

export const ReceiptPageSchema = z.strictObject({
  items: z.array(ReceiptSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  nextCursor: z.string().optional(),
});
export type ReceiptPage = z.infer<typeof ReceiptPageSchema>;

/* ------------------------------------------------------------------ instrument */

export const INSTRUMENT_KINDS = ['cheque', 'promissoryNote'] as const;
export const InstrumentKindSchema = z.enum(INSTRUMENT_KINDS);
export type InstrumentKind = z.infer<typeof InstrumentKindSchema>;

export const INSTRUMENT_STATES = [
  'received',
  'deposited',
  'presented',
  'cleared',
  'returned',
  'replaced',
  'cancelled',
] as const;
export const InstrumentStateSchema = z.enum(INSTRUMENT_STATES);
export type InstrumentState = z.infer<typeof InstrumentStateSchema>;

/**
 * Permitted moves.
 *
 * A cheque is **deposited**; a promissory note is **presented**. Both may be returned unpaid, and a
 * returned instrument is replaced by a new one rather than edited — the original is evidence of what
 * happened. `cleared` is terminal because the money is in, and the receipt that records it is the
 * next step.
 */
export const INSTRUMENT_TRANSITIONS: Readonly<Record<InstrumentState, readonly InstrumentState[]>> =
  {
    received: ['deposited', 'presented', 'returned', 'replaced', 'cancelled'],
    deposited: ['cleared', 'returned'],
    presented: ['cleared', 'returned'],
    returned: ['replaced', 'cancelled', 'deposited', 'presented'],
    cleared: [],
    replaced: [],
    cancelled: [],
  };

export function canTransitionInstrument(from: InstrumentState, to: InstrumentState): boolean {
  return INSTRUMENT_TRANSITIONS[from].includes(to);
}

export const InstrumentSchema = z.strictObject({
  instrumentId: RecordIdSchema,
  kind: InstrumentKindSchema,
  /** The serial printed on the cheque or note, exactly as entered. Never reformatted. */
  instrumentNumber: z.string().trim().min(1).max(60),
  customerId: RecordIdSchema,
  contractId: RecordIdSchema,
  projectId: RecordIdSchema,
  /** The installment this instrument is meant to settle, when it is earmarked for one. */
  installmentId: RecordIdSchema.optional(),
  amount: MoneySchema,
  issuedOn: BusinessDateSchema,
  dueOn: BusinessDateSchema,
  /** Cheques only. Stored as entered; no bank registry is consulted. */
  bankName: z.string().trim().max(120).optional(),
  /** Who signed it. Often, but not always, the customer. */
  drawerName: EnteredNameSchema,
  state: InstrumentStateSchema,
  /** Where the physical paper is. A note, because custody of paper is a real operational problem. */
  custodyLocation: z.string().trim().max(200).optional(),
  /** The receipt issued when it cleared. */
  settlementReceiptId: RecordIdSchema.optional(),
  replacedByInstrumentId: RecordIdSchema.optional(),
  returnReason: z.string().max(500).optional(),
  legalEntityId: RecordIdSchema,
  branchId: RecordIdSchema,
  teamId: RecordIdSchema.optional(),
  version: z.number().int().positive(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Instrument = z.infer<typeof InstrumentSchema>;

export const CreateInstrumentSchema = z.strictObject({
  kind: InstrumentKindSchema,
  instrumentNumber: z.string().trim().min(1).max(60),
  contractId: RecordIdSchema,
  installmentId: RecordIdSchema.optional(),
  amount: MoneySchema,
  issuedOn: BusinessDateSchema,
  dueOn: BusinessDateSchema,
  bankName: z.string().trim().max(120).optional(),
  drawerName: EnteredNameSchema,
  custodyLocation: z.string().trim().max(200).optional(),
});
export type CreateInstrument = z.infer<typeof CreateInstrumentSchema>;

export const ChangeInstrumentStateSchema = z.strictObject({
  state: InstrumentStateSchema,
  reason: z.string().trim().max(500).optional(),
  custodyLocation: z.string().trim().max(200).optional(),
  /** Required when moving to `replaced`. */
  replacedByInstrumentId: RecordIdSchema.optional(),
  expectedVersion: z.number().int().positive().optional(),
});
export type ChangeInstrumentState = z.infer<typeof ChangeInstrumentStateSchema>;

export const InstrumentQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(200).optional(),
  kind: InstrumentKindSchema.optional(),
  state: InstrumentStateSchema.optional(),
  contractId: RecordIdSchema.optional(),
  customerId: RecordIdSchema.optional(),
  projectId: RecordIdSchema.optional(),
});
export type InstrumentQuery = z.infer<typeof InstrumentQuerySchema>;

export const InstrumentPageSchema = z.strictObject({
  items: z.array(InstrumentSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  nextCursor: z.string().optional(),
});
export type InstrumentPage = z.infer<typeof InstrumentPageSchema>;

/* -------------------------------------------------------------------- reminder */

/**
 * The reminder window. Master Mapping's collection flow asks for a reminder before an installment
 * falls due; 15 days is the demonstration's window and is a configuration value, not a business rule
 * anyone has approved (`SD-07`).
 */
export const REMINDER_WINDOW_DAYS = 15;

export const REMINDER_CHANNELS = ['whatsapp', 'sms', 'email'] as const;
export const ReminderChannelSchema = z.enum(REMINDER_CHANNELS);
export type ReminderChannel = z.infer<typeof ReminderChannelSchema>;

/**
 * Reminder lifecycle.
 *
 * `simulated` is a deliberate state, not a synonym for `sent`. Nothing is connected: no WhatsApp
 * Business account, no approved template, no provider (ADR-0026). A reminder that a simulated adapter
 * "delivered" reached nobody, and calling that `sent` would be a lie the interface then repeats.
 * `sent` exists in the vocabulary so that connecting a real provider later adds a transition rather
 * than reinterpreting an existing one.
 */
export const REMINDER_STATES = ['scheduled', 'ready', 'simulated', 'sent', 'failed'] as const;
export const ReminderStateSchema = z.enum(REMINDER_STATES);
export type ReminderState = z.infer<typeof ReminderStateSchema>;

export const REMINDER_TRANSITIONS: Readonly<Record<ReminderState, readonly ReminderState[]>> = {
  scheduled: ['ready', 'failed'],
  ready: ['simulated', 'sent', 'failed'],
  simulated: ['ready'],
  sent: [],
  failed: ['ready'],
};

export function canTransitionReminder(from: ReminderState, to: ReminderState): boolean {
  return REMINDER_TRANSITIONS[from].includes(to);
}

export const ReminderSchema = z.strictObject({
  reminderId: RecordIdSchema,
  installmentId: RecordIdSchema,
  contractId: RecordIdSchema,
  customerId: RecordIdSchema,
  projectId: RecordIdSchema,
  /** The due date this reminder is about, and the key that makes generation idempotent. */
  dueOn: BusinessDateSchema,
  amount: MoneySchema,
  channel: ReminderChannelSchema,
  state: ReminderStateSchema,
  /** Both languages, always. The message is composed here so it can be previewed before anything. */
  messageAr: z.string().max(1000),
  messageEn: z.string().max(1000),
  generatedOn: BusinessDateSchema,
  lastAttemptAt: InstantSchema.optional(),
  failureReason: z.string().max(500).optional(),
  /** True whenever the state was produced by the simulated adapter rather than a provider. */
  simulated: z.boolean(),
  legalEntityId: RecordIdSchema,
  branchId: RecordIdSchema,
  teamId: RecordIdSchema.optional(),
  salesOwnerAccountId: z.string().min(1).max(200),
  version: z.number().int().positive(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Reminder = z.infer<typeof ReminderSchema>;

export const GenerateRemindersSchema = z.strictObject({
  withinDays: z.number().int().min(1).max(90).default(REMINDER_WINDOW_DAYS),
  channel: ReminderChannelSchema.default('whatsapp'),
});
export type GenerateReminders = z.infer<typeof GenerateRemindersSchema>;

export const ReminderActionSchema = z.strictObject({
  state: z.enum(['ready', 'simulated', 'failed']),
  reason: z.string().trim().max(500).optional(),
});
export type ReminderAction = z.infer<typeof ReminderActionSchema>;

export const ReminderQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(200).optional(),
  state: ReminderStateSchema.optional(),
  contractId: RecordIdSchema.optional(),
  customerId: RecordIdSchema.optional(),
  projectId: RecordIdSchema.optional(),
});
export type ReminderQuery = z.infer<typeof ReminderQuerySchema>;

export const ReminderPageSchema = z.strictObject({
  items: z.array(ReminderSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  nextCursor: z.string().optional(),
});
export type ReminderPage = z.infer<typeof ReminderPageSchema>;

export const GenerateRemindersResultSchema = z.strictObject({
  created: z.number().int().nonnegative(),
  existing: z.number().int().nonnegative(),
  /** Stated on every response so a caller cannot mistake this for a delivery integration. */
  deliveryConnected: z.literal(false),
});
export type GenerateRemindersResult = z.infer<typeof GenerateRemindersResultSchema>;

export const COLLECTION_AUDIT_ACTIONS = {
  receiptRecorded: 'collection.receipt.recorded',
  receiptReversed: 'collection.receipt.reversed',
  receiptRefused: 'collection.receipt.refused',
  instrumentCreated: 'collection.instrument.created',
  instrumentStateChanged: 'collection.instrument.stateChanged',
  instrumentRefused: 'collection.instrument.refused',
  remindersGenerated: 'collection.reminder.generated',
  reminderStateChanged: 'collection.reminder.stateChanged',
} as const;
