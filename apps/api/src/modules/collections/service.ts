import {
  COLLECTION_AUDIT_ACTIONS,
  InstrumentSchema,
  ReceiptSchema,
  ReminderSchema,
  addDays,
  addMoney,
  canTransitionInstrument,
  canTransitionReminder,
  compareMoney,
  isNegativeMoney,
  money,
  subtractMoney,
  type ActorContext,
  type Allocation,
  type ChangeInstrumentState,
  type CreateInstrument,
  type GenerateReminders,
  type GenerateRemindersResult,
  type Instrument,
  type InstrumentPage,
  type InstrumentQuery,
  type Money,
  type Receipt,
  type ReceiptPage,
  type ReceiptQuery,
  type RecordReceipt,
  type Reminder,
  type ReminderAction,
  type ReminderPage,
  type ReminderQuery,
  type BusinessDate,
} from '@alola/contracts';
// The same formatters the interface uses, so a reminder message and the screen agree (SD-23).
import { createFormatters } from '@alola/i18n';
import {
  assertSafeFilter,
  buildChangeSummary,
  buildScopeFilter,
  withScope,
  type Logger,
  type ScopeFieldMap,
} from '@alola/security';
import { createHash } from 'node:crypto';
import type { ClientSession, Connection } from 'mongoose';
import { newId } from '../../platform/ids';
import { fromDecimal128, toDecimal128 } from '../../platform/money-storage';
import { withTransaction } from '../../platform/transactions';
import type { ReminderDeliveryAdapter } from './delivery';
import { composeReminderMessage } from './delivery';
import {
  instrumentModel,
  receiptModel,
  reminderModel,
  type InstrumentDocument,
  type ReceiptDocument,
  type ReminderDocument,
  type StoredMoney,
} from './model';

/**
 * Collections service — `COL-*` demonstration slice (ADR-0025).
 *
 * Three rules, each of which exists because the obvious implementation is wrong:
 *
 * 1. **A posted receipt is reversed, never edited.** A receipt is a document the customer holds.
 * 2. **Over-allocation is refused, never clamped.** A receipt claiming to pay more than is owed is a
 *    data-entry error; absorbing it silently hides the mistake and the money.
 * 3. **A reminder is never reported as sent unless a provider actually sent it.** Nothing is
 *    connected, so the demonstration's reminders are `simulated`, and the feature is correct with no
 *    adapter behind the port at all (ADR-0026).
 */

export interface AuditRecorder {
  record(
    input: {
      action: string;
      outcome: 'succeeded' | 'denied' | 'failed';
      actor: { kind: 'account' | 'system' | 'anonymous'; accountId?: string; roleKeys?: string[] };
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
    },
    options?: { session?: ClientSession },
  ): Promise<unknown>;
}

export interface RequestContext {
  correlationId: string;
  ip?: string;
  method?: string;
  route?: string;
}

/** What collections needs from sales. Sales owns the installment, so the arithmetic lives there. */
export interface SalesPort {
  findContract(
    contractId: string,
    session?: ClientSession,
  ): Promise<
    | {
        contractId: string;
        contractNumber: string;
        customerId: string;
        unitId: string;
        projectId: string;
        legalEntityId: string;
        branchId: string;
        teamId?: string;
        salesOwnerAccountId: string;
        state: string;
        totalPrice: Money;
      }
    | undefined
  >;
  listOpenInstallments(
    contractId: string,
    session?: ClientSession,
  ): Promise<
    {
      installmentId: string;
      sequence: number;
      dueOn: BusinessDate;
      remainingAmount: Money;
      state: string;
    }[]
  >;
  applyPaymentToInstallment(
    installmentId: string,
    amount: Money,
    session: ClientSession,
  ): Promise<unknown>;
  reversePaymentOnInstallment(
    installmentId: string,
    amount: Money,
    session: ClientSession,
  ): Promise<unknown>;
  recomputeContractTotals(contractId: string, session: ClientSession): Promise<void>;
  /** Installments falling due inside a window, for the reminder sweep. */
  listInstallmentsDueWithin(
    from: BusinessDate,
    to: BusinessDate,
  ): Promise<
    {
      installmentId: string;
      contractId: string;
      customerId: string;
      unitId: string;
      projectId: string;
      dueOn: BusinessDate;
      remainingAmount: Money;
      legalEntityId: string;
      branchId: string;
      teamId?: string;
      salesOwnerAccountId: string;
    }[]
  >;
}

/** What collections needs from CRM: the customer's name for the reminder text. */
export interface CustomerPort {
  find(customerId: string): Promise<{ customerId: string; name: string } | undefined>;
}

/** What collections needs from inventory: the unit code shown in a reminder. */
export interface UnitLookupPort {
  find(unitId: string): Promise<{ unitId: string; code: string } | undefined>;
}

export class CollectionNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(readonly what: string) {
    super('NOT_FOUND');
    this.name = 'CollectionNotFoundError';
  }
}

export class CollectionConflictError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly what: string) {
    super('CONFLICT');
    this.name = 'CollectionConflictError';
  }
}

export class CollectionValidationError extends Error {
  readonly code = 'VALIDATION_FAILED';
  constructor(readonly what: string) {
    super('VALIDATION_FAILED');
    this.name = 'CollectionValidationError';
  }
}

export const COLLECTION_SCOPE_FIELDS: ScopeFieldMap = {
  owner: 'receivedByAccountId',
  assignee: 'receivedByAccountId',
  team: 'teamId',
  branch: 'branchId',
  project: 'projectId',
  legalEntity: 'legalEntityId',
};

const INSTRUMENT_SCOPE_FIELDS: ScopeFieldMap = {
  team: 'teamId',
  branch: 'branchId',
  project: 'projectId',
  legalEntity: 'legalEntityId',
};

const REMINDER_SCOPE_FIELDS: ScopeFieldMap = {
  owner: 'salesOwnerAccountId',
  assignee: 'salesOwnerAccountId',
  team: 'teamId',
  branch: 'branchId',
  project: 'projectId',
  legalEntity: 'legalEntityId',
};

const iso = (date: Date) => date.toISOString();

function toMoney(stored: StoredMoney): Money {
  return { amount: fromDecimal128(stored.amount), currency: stored.currency };
}

function fromMoney(value: Money): StoredMoney {
  return { amount: toDecimal128(value.amount), currency: value.currency };
}

function toReceipt(d: ReceiptDocument): Receipt {
  return ReceiptSchema.parse({
    receiptId: d.receiptId,
    receiptNumber: d.receiptNumber,
    customerId: d.customerId,
    contractId: d.contractId,
    projectId: d.projectId,
    amount: toMoney(d.amount),
    method: d.method,
    ...(d.depositReference ? { depositReference: d.depositReference } : {}),
    ...(d.transactionReference ? { transactionReference: d.transactionReference } : {}),
    ...(d.instrumentId ? { instrumentId: d.instrumentId } : {}),
    allocations: d.allocations.map((a) => ({
      installmentId: a.installmentId,
      sequence: a.sequence,
      dueOn: a.dueOn,
      amount: toMoney(a.amount),
    })),
    receivedByAccountId: d.receivedByAccountId,
    receivedOn: d.receivedOn,
    state: d.state,
    ...(d.reversedAt ? { reversedAt: iso(d.reversedAt) } : {}),
    ...(d.reversedByAccountId ? { reversedByAccountId: d.reversedByAccountId } : {}),
    ...(d.reversalReason ? { reversalReason: d.reversalReason } : {}),
    legalEntityId: d.legalEntityId,
    branchId: d.branchId,
    ...(d.teamId ? { teamId: d.teamId } : {}),
    ...(d.notes ? { notes: d.notes } : {}),
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

function toInstrument(d: InstrumentDocument): Instrument {
  return InstrumentSchema.parse({
    instrumentId: d.instrumentId,
    kind: d.kind,
    instrumentNumber: d.instrumentNumber,
    customerId: d.customerId,
    contractId: d.contractId,
    projectId: d.projectId,
    ...(d.installmentId ? { installmentId: d.installmentId } : {}),
    amount: toMoney(d.amount),
    issuedOn: d.issuedOn,
    dueOn: d.dueOn,
    ...(d.bankName ? { bankName: d.bankName } : {}),
    drawerName: d.drawerName,
    state: d.state,
    ...(d.custodyLocation ? { custodyLocation: d.custodyLocation } : {}),
    ...(d.settlementReceiptId ? { settlementReceiptId: d.settlementReceiptId } : {}),
    ...(d.replacedByInstrumentId ? { replacedByInstrumentId: d.replacedByInstrumentId } : {}),
    ...(d.returnReason ? { returnReason: d.returnReason } : {}),
    legalEntityId: d.legalEntityId,
    branchId: d.branchId,
    ...(d.teamId ? { teamId: d.teamId } : {}),
    version: d.version,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

function toReminder(d: ReminderDocument): Reminder {
  return ReminderSchema.parse({
    reminderId: d.reminderId,
    installmentId: d.installmentId,
    contractId: d.contractId,
    customerId: d.customerId,
    projectId: d.projectId,
    dueOn: d.dueOn,
    amount: toMoney(d.amount),
    channel: d.channel,
    state: d.state,
    messageAr: d.messageAr,
    messageEn: d.messageEn,
    generatedOn: d.generatedOn,
    ...(d.lastAttemptAt ? { lastAttemptAt: iso(d.lastAttemptAt) } : {}),
    ...(d.failureReason ? { failureReason: d.failureReason } : {}),
    simulated: d.simulated,
    legalEntityId: d.legalEntityId,
    branchId: d.branchId,
    ...(d.teamId ? { teamId: d.teamId } : {}),
    salesOwnerAccountId: d.salesOwnerAccountId,
    version: d.version,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function encodeCursor(date: Date, id: string): string {
  return Buffer.from(`${date.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { date: Date; id: string } | undefined {
  try {
    const [text, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!text || !id) return undefined;
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? undefined : { date, id };
  } catch {
    return undefined;
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: unknown })?.code === 11000;
}

export interface CollectionServiceOptions {
  connection: Connection;
  logger: Logger;
  audit: AuditRecorder;
  sales: SalesPort;
  customers: CustomerPort;
  units: UnitLookupPort;
  /** Absent means no delivery at all, which the reminder centre must remain correct without. */
  delivery?: ReminderDeliveryAdapter;
  today: () => BusinessDate;
  /** Organization timezone, for formatting the amounts and dates inside a reminder message. */
  timeZone: string;
  /** Allocates the next receipt number; shares the sales counter so numbering is one mechanism. */
  /**
   * The next receipt number, inside the receipt's transaction: CORE-DOC-001 when a `receipt` format
   * is active, otherwise the legacy `RCT` series.
   */
  nextReceiptNumber: (
    session: ClientSession,
    source?: { receiptId: string; projectId: string },
  ) => Promise<string>;
}

export class CollectionService {
  private readonly connection;
  private readonly receipts;
  private readonly instruments;
  private readonly reminders;

  constructor(private readonly options: CollectionServiceOptions) {
    this.connection = options.connection;
    this.receipts = receiptModel(options.connection);
    this.instruments = instrumentModel(options.connection);
    this.reminders = reminderModel(options.connection);
  }

  /* ---------------------------------------------------------------- receipts */

  private async replayReceipt(idempotencyKey: string, print: string): Promise<Receipt | undefined> {
    const existing = await this.receipts.findOne({ idempotencyKey }).lean<ReceiptDocument>().exec();
    if (!existing) return undefined;
    if (existing.idempotencyFingerprint !== print) {
      throw new CollectionConflictError('idempotencyMismatch');
    }
    return toReceipt(existing);
  }

  /**
   * Plan how a payment is spread across installments.
   *
   * Explicit allocations are honoured; otherwise the oldest open installment is settled first, which
   * is what a collections officer means by "put this against his account" and is deterministic, which
   * matters when the customer asks why.
   */
  private planAllocations(
    amount: Money,
    open: {
      installmentId: string;
      sequence: number;
      dueOn: BusinessDate;
      remainingAmount: Money;
    }[],
    requested?: { installmentId: string; amount: Money }[],
  ): Allocation[] {
    const zero = money('0', amount.currency);
    if (isNegativeMoney(amount) || compareMoney(amount, zero) === 0) {
      throw new CollectionValidationError('nonPositiveAmount');
    }
    const byId = new Map(open.map((row) => [row.installmentId, row]));

    if (requested && requested.length > 0) {
      const allocations: Allocation[] = [];
      let planned = zero;
      for (const entry of requested) {
        const row = byId.get(entry.installmentId);
        if (!row) throw new CollectionNotFoundError('installment');
        if (entry.amount.currency !== amount.currency) {
          throw new CollectionValidationError('currencyMismatch');
        }
        if (isNegativeMoney(entry.amount)) {
          throw new CollectionValidationError('negativeAllocation');
        }
        // Over-allocation against one row is refused here, before anything is written.
        if (compareMoney(entry.amount, row.remainingAmount) > 0) {
          throw new CollectionValidationError('overAllocation');
        }
        planned = addMoney(planned, entry.amount);
        allocations.push({
          installmentId: row.installmentId,
          sequence: row.sequence,
          dueOn: row.dueOn,
          amount: entry.amount,
        });
      }
      // The parts must sum to the receipt, exactly. A receipt that does not equal what it allocated
      // is money that exists on paper and nowhere in the schedule.
      if (compareMoney(planned, amount) !== 0) {
        throw new CollectionValidationError('allocationsDoNotSum');
      }
      return allocations;
    }

    const allocations: Allocation[] = [];
    let left = amount;
    for (const row of [...open].sort((a, b) => a.sequence - b.sequence)) {
      if (compareMoney(left, zero) === 0) break;
      if (compareMoney(row.remainingAmount, zero) === 0) continue;
      const applied = compareMoney(left, row.remainingAmount) >= 0 ? row.remainingAmount : left;
      left = subtractMoney(left, applied);
      allocations.push({
        installmentId: row.installmentId,
        sequence: row.sequence,
        dueOn: row.dueOn,
        amount: applied,
      });
    }
    // More money than the contract still owes: refused, never absorbed.
    if (compareMoney(left, zero) !== 0) throw new CollectionValidationError('overAllocation');
    if (allocations.length === 0) throw new CollectionValidationError('nothingOutstanding');
    return allocations;
  }

  async recordReceipt(
    actor: ActorContext,
    input: RecordReceipt,
    context: RequestContext,
  ): Promise<{ receipt: Receipt; replayed: boolean }> {
    const print = fingerprint({
      contractId: input.contractId,
      amount: input.amount,
      method: input.method,
      receivedOn: input.receivedOn,
      allocations: input.allocations ?? null,
    });
    const replay = await this.replayReceipt(input.idempotencyKey, print);
    if (replay) return { receipt: replay, replayed: true };

    const contract = await this.options.sales.findContract(input.contractId);
    if (!contract) throw new CollectionNotFoundError('contract');
    if (contract.state !== 'active') throw new CollectionConflictError('contractNotActive');
    if (input.amount.currency !== contract.totalPrice.currency) {
      throw new CollectionValidationError('currencyMismatch');
    }

    try {
      const receipt = await withTransaction(this.connection, async (session) => {
        const open = await this.options.sales.listOpenInstallments(input.contractId, session);
        const allocations = this.planAllocations(input.amount, open, input.allocations);

        for (const allocation of allocations) {
          await this.options.sales.applyPaymentToInstallment(
            allocation.installmentId,
            allocation.amount,
            session,
          );
        }
        await this.options.sales.recomputeContractTotals(input.contractId, session);

        const receiptId = newId('rct');
        const receiptNumber = await this.options.nextReceiptNumber(session, {
          receiptId,
          projectId: contract.projectId,
        });
        const now = new Date();
        const document: ReceiptDocument = {
          receiptId,
          receiptNumber,
          customerId: contract.customerId,
          contractId: contract.contractId,
          projectId: contract.projectId,
          amount: fromMoney(input.amount),
          method: input.method,
          ...(input.depositReference ? { depositReference: input.depositReference } : {}),
          ...(input.transactionReference
            ? { transactionReference: input.transactionReference }
            : {}),
          ...(input.instrumentId ? { instrumentId: input.instrumentId } : {}),
          allocations: allocations.map((a) => ({
            installmentId: a.installmentId,
            sequence: a.sequence,
            dueOn: a.dueOn,
            amount: fromMoney(a.amount),
          })),
          receivedByAccountId: actor.accountId,
          receivedOn: input.receivedOn,
          state: 'posted',
          legalEntityId: contract.legalEntityId,
          branchId: contract.branchId,
          ...(contract.teamId ? { teamId: contract.teamId } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
          idempotencyKey: input.idempotencyKey,
          idempotencyFingerprint: print,
          createdAt: now,
          updatedAt: now,
        };
        const [created] = await this.receipts.create([document], { session, ordered: true });
        if (!created) throw new CollectionConflictError('receiptNotCreated');

        await this.options.audit.record(
          {
            action: COLLECTION_AUDIT_ACTIONS.receiptRecorded,
            outcome: 'succeeded',
            actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
            target: { type: 'receipt', id: document.receiptId },
            changes: buildChangeSummary(undefined, {
              receiptNumber,
              contractId: contract.contractId,
              method: input.method,
              allocations: String(allocations.length),
            }),
            context,
          },
          { session },
        );
        return toReceipt(created.toObject());
      });
      return { receipt, replayed: false };
    } catch (error) {
      if (isDuplicateKey(error)) {
        const stored = await this.replayReceipt(input.idempotencyKey, print);
        if (stored) return { receipt: stored, replayed: true };
      }
      throw error;
    }
  }

  /**
   * Reverse a posted receipt.
   *
   * The allocations are put back on their installments in the same transaction, so the contract's
   * balance and the receipt's state can never disagree. The original receipt stays, marked `reversed`
   * with its reason: the customer's copy still exists, and the record has to explain itself.
   */
  async reverseReceipt(
    actor: ActorContext,
    receiptId: string,
    reason: string,
    context: RequestContext,
  ): Promise<Receipt> {
    const current = await this.getReceipt(actor, receiptId);
    if (current.state !== 'posted') {
      await this.options.audit.record({
        action: COLLECTION_AUDIT_ACTIONS.receiptRefused,
        outcome: 'denied',
        actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
        target: { type: 'receipt', id: receiptId },
        reason: `reversal refused: receipt is ${current.state}`,
        context,
      });
      throw new CollectionConflictError('receiptNotPosted');
    }

    return withTransaction(this.connection, async (session) => {
      for (const allocation of current.allocations) {
        await this.options.sales.reversePaymentOnInstallment(
          allocation.installmentId,
          allocation.amount,
          session,
        );
      }
      await this.options.sales.recomputeContractTotals(current.contractId, session);

      const now = new Date();
      const updated = await this.receipts
        .findOneAndUpdate(
          { receiptId, state: 'posted' },
          {
            $set: {
              state: 'reversed',
              reversedAt: now,
              reversedByAccountId: actor.accountId,
              reversalReason: reason,
              updatedAt: now,
            },
          },
          { returnDocument: 'after', session },
        )
        .lean<ReceiptDocument>()
        .exec();
      if (!updated) throw new CollectionConflictError('receiptNotPosted');

      await this.options.audit.record(
        {
          action: COLLECTION_AUDIT_ACTIONS.receiptReversed,
          outcome: 'succeeded',
          actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
          target: { type: 'receipt', id: receiptId },
          changes: buildChangeSummary({ state: 'posted' }, { state: 'reversed' }),
          reason,
          context,
        },
        { session },
      );
      return toReceipt(updated);
    });
  }

  async listReceipts(actor: ActorContext, query: ReceiptQuery): Promise<ReceiptPage> {
    const requested: Record<string, unknown> = {};
    for (const key of ['contractId', 'customerId', 'projectId', 'method', 'state'] as const) {
      const value = query[key];
      if (value !== undefined) requested[key] = value;
    }
    assertSafeFilter(requested);
    const filter = withScope(buildScopeFilter(actor, COLLECTION_SCOPE_FIELDS), requested);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const paged = cursor
      ? {
          $and: [
            filter,
            {
              $or: [
                { createdAt: { $lt: cursor.date } },
                { createdAt: cursor.date, receiptId: { $lt: cursor.id } },
              ],
            },
          ],
        }
      : filter;
    const [documents, total] = await Promise.all([
      this.receipts
        .find(paged)
        .sort({ createdAt: -1, receiptId: -1 })
        .limit(query.limit + 1)
        .lean<ReceiptDocument[]>()
        .exec(),
      this.receipts.countDocuments(filter).exec(),
    ]);
    const page = documents.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toReceipt),
      total,
      limit: query.limit,
      ...(documents.length > query.limit && last
        ? { nextCursor: encodeCursor(last.createdAt, last.receiptId) }
        : {}),
    };
  }

  /** Receipts by number prefix, inside the actor's scope (CORE-SEARCH-001). */
  async searchReceipts(
    actor: ActorContext,
    term: string,
    limit: number,
  ): Promise<{ id: string; label: string; status: string }[]> {
    const filter = withScope(buildScopeFilter(actor, COLLECTION_SCOPE_FIELDS), {
      receiptNumber: { $regex: `^${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' },
    });
    const rows = await this.receipts
      .find(filter, { receiptId: 1, receiptNumber: 1, state: 1 })
      .sort({ receiptNumber: 1 })
      .limit(limit)
      .lean<ReceiptDocument[]>()
      .exec();
    return rows.map((row) => ({ id: row.receiptId, label: row.receiptNumber, status: row.state }));
  }

  async getReceipt(actor: ActorContext, receiptId: string): Promise<Receipt> {
    assertSafeFilter({ receiptId });
    const filter = withScope(buildScopeFilter(actor, COLLECTION_SCOPE_FIELDS), { receiptId });
    const document = await this.receipts.findOne(filter).lean<ReceiptDocument>().exec();
    if (!document) throw new CollectionNotFoundError('receipt');
    return toReceipt(document);
  }

  /* -------------------------------------------------------------- instruments */

  async createInstrument(
    actor: ActorContext,
    input: CreateInstrument,
    context: RequestContext,
  ): Promise<Instrument> {
    const contract = await this.options.sales.findContract(input.contractId);
    if (!contract) throw new CollectionNotFoundError('contract');
    if (isNegativeMoney(input.amount)) throw new CollectionValidationError('negativeAmount');
    if (input.amount.currency !== contract.totalPrice.currency) {
      throw new CollectionValidationError('currencyMismatch');
    }
    if (input.dueOn < input.issuedOn) throw new CollectionValidationError('dueBeforeIssued');
    // A bank name is what distinguishes a cheque from a promissory note in practice.
    if (input.kind === 'cheque' && !input.bankName) {
      throw new CollectionValidationError('bankNameRequiredForCheque');
    }

    const now = new Date();
    const document: InstrumentDocument = {
      instrumentId: newId('instr'),
      kind: input.kind,
      instrumentNumber: input.instrumentNumber,
      customerId: contract.customerId,
      contractId: contract.contractId,
      projectId: contract.projectId,
      ...(input.installmentId ? { installmentId: input.installmentId } : {}),
      amount: fromMoney(input.amount),
      issuedOn: input.issuedOn,
      dueOn: input.dueOn,
      ...(input.bankName ? { bankName: input.bankName } : {}),
      drawerName: input.drawerName,
      state: 'received',
      ...(input.custodyLocation ? { custodyLocation: input.custodyLocation } : {}),
      legalEntityId: contract.legalEntityId,
      branchId: contract.branchId,
      ...(contract.teamId ? { teamId: contract.teamId } : {}),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    let created;
    try {
      created = await this.instruments.create(document);
    } catch (error) {
      if (isDuplicateKey(error)) throw new CollectionConflictError('duplicateInstrumentNumber');
      throw error;
    }
    const instrument = toInstrument(created.toObject());
    await this.options.audit.record({
      action: COLLECTION_AUDIT_ACTIONS.instrumentCreated,
      outcome: 'succeeded',
      actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
      target: { type: 'instrument', id: instrument.instrumentId },
      changes: buildChangeSummary(undefined, {
        kind: instrument.kind,
        contractId: instrument.contractId,
        state: instrument.state,
      }),
      context,
    });
    return instrument;
  }

  async changeInstrumentState(
    actor: ActorContext,
    instrumentId: string,
    input: ChangeInstrumentState,
    context: RequestContext,
  ): Promise<Instrument> {
    const current = await this.getInstrument(actor, instrumentId);
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      throw new CollectionConflictError('staleVersion');
    }
    if (!canTransitionInstrument(current.state, input.state)) {
      await this.options.audit.record({
        action: COLLECTION_AUDIT_ACTIONS.instrumentRefused,
        outcome: 'denied',
        actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
        target: { type: 'instrument', id: instrumentId },
        reason: `refused transition ${current.state} -> ${input.state}`,
        context,
      });
      throw new CollectionConflictError('invalidTransition');
    }
    if (input.state === 'returned' && !input.reason?.trim()) {
      // A returned cheque with no reason is a support call waiting to happen.
      throw new CollectionValidationError('returnReasonRequired');
    }
    if (input.state === 'replaced' && !input.replacedByInstrumentId) {
      throw new CollectionValidationError('replacementRequired');
    }

    const set: Record<string, unknown> = { state: input.state, updatedAt: new Date() };
    if (input.custodyLocation !== undefined) set['custodyLocation'] = input.custodyLocation;
    if (input.state === 'returned') set['returnReason'] = input.reason;
    if (input.replacedByInstrumentId) set['replacedByInstrumentId'] = input.replacedByInstrumentId;

    const updated = await this.instruments
      .findOneAndUpdate(
        { instrumentId, state: current.state },
        { $set: set, $inc: { version: 1 } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean<InstrumentDocument>()
      .exec();
    if (!updated) throw new CollectionConflictError('invalidTransition');

    await this.options.audit.record({
      action: COLLECTION_AUDIT_ACTIONS.instrumentStateChanged,
      outcome: 'succeeded',
      actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
      target: { type: 'instrument', id: instrumentId },
      changes: buildChangeSummary({ state: current.state }, { state: input.state }),
      ...(input.reason ? { reason: input.reason } : {}),
      context,
    });
    return toInstrument(updated);
  }

  async listInstruments(actor: ActorContext, query: InstrumentQuery): Promise<InstrumentPage> {
    const requested: Record<string, unknown> = {};
    for (const key of ['kind', 'state', 'contractId', 'customerId', 'projectId'] as const) {
      const value = query[key];
      if (value !== undefined) requested[key] = value;
    }
    assertSafeFilter(requested);
    const filter = withScope(buildScopeFilter(actor, INSTRUMENT_SCOPE_FIELDS), requested);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const paged = cursor
      ? {
          $and: [
            filter,
            {
              $or: [
                { createdAt: { $lt: cursor.date } },
                { createdAt: cursor.date, instrumentId: { $lt: cursor.id } },
              ],
            },
          ],
        }
      : filter;
    const [documents, total] = await Promise.all([
      this.instruments
        .find(paged)
        .sort({ createdAt: -1, instrumentId: -1 })
        .limit(query.limit + 1)
        .lean<InstrumentDocument[]>()
        .exec(),
      this.instruments.countDocuments(filter).exec(),
    ]);
    const page = documents.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toInstrument),
      total,
      limit: query.limit,
      ...(documents.length > query.limit && last
        ? { nextCursor: encodeCursor(last.createdAt, last.instrumentId) }
        : {}),
    };
  }

  async getInstrument(actor: ActorContext, instrumentId: string): Promise<Instrument> {
    assertSafeFilter({ instrumentId });
    const filter = withScope(buildScopeFilter(actor, INSTRUMENT_SCOPE_FIELDS), { instrumentId });
    const document = await this.instruments.findOne(filter).lean<InstrumentDocument>().exec();
    if (!document) throw new CollectionNotFoundError('instrument');
    return toInstrument(document);
  }

  /* ---------------------------------------------------------------- reminders */

  /**
   * Generate reminders for installments falling due inside the window.
   *
   * **Idempotent by index**, not by a read-then-write check: a unique index on
   * (installment, due date, channel) means a second sweep on the same day inserts nothing. That is
   * what stops a customer receiving the same reminder twice when someone runs the sweep again.
   *
   * Nothing is delivered here, and the result says `deliveryConnected: false` on every response so a
   * caller cannot mistake this for an integration (ADR-0026).
   */
  async generateReminders(
    actor: ActorContext,
    input: GenerateReminders,
    context: RequestContext,
  ): Promise<GenerateRemindersResult> {
    const today = this.options.today();
    const until = addDays(today, input.withinDays);
    const due = await this.options.sales.listInstallmentsDueWithin(today, until);
    const formatters = createFormatters('ar', { timeZone: this.options.timeZone });
    const englishFormatters = createFormatters('en', { timeZone: this.options.timeZone });

    let created = 0;
    let existing = 0;
    for (const installment of due) {
      const [customer, contract, unit] = await Promise.all([
        this.options.customers.find(installment.customerId),
        this.options.sales.findContract(installment.contractId),
        this.options.units.find(installment.unitId),
      ]);
      if (!customer || !contract || !unit) continue;

      const message = composeReminderMessage({
        customerName: customer.name,
        unitCode: unit.code,
        amountText: formatters.money(installment.remainingAmount, 2),
        dueDateText: formatters.businessDate(installment.dueOn),
        contractNumber: contract.contractNumber,
      });
      const english = composeReminderMessage({
        customerName: customer.name,
        unitCode: unit.code,
        amountText: englishFormatters.money(installment.remainingAmount, 2),
        dueDateText: englishFormatters.businessDate(installment.dueOn),
        contractNumber: contract.contractNumber,
      });

      const now = new Date();
      try {
        await this.reminders.create({
          reminderId: newId('rem'),
          installmentId: installment.installmentId,
          contractId: installment.contractId,
          customerId: installment.customerId,
          projectId: installment.projectId,
          dueOn: installment.dueOn,
          amount: fromMoney(installment.remainingAmount),
          channel: input.channel,
          state: 'ready',
          messageAr: message.messageAr,
          messageEn: english.messageEn,
          generatedOn: today,
          simulated: false,
          legalEntityId: installment.legalEntityId,
          branchId: installment.branchId,
          ...(installment.teamId ? { teamId: installment.teamId } : {}),
          salesOwnerAccountId: installment.salesOwnerAccountId,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
        created += 1;
      } catch (error) {
        if (isDuplicateKey(error)) {
          existing += 1;
          continue;
        }
        throw error;
      }
    }

    if (created > 0) {
      await this.options.audit.record({
        action: COLLECTION_AUDIT_ACTIONS.remindersGenerated,
        outcome: 'succeeded',
        actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
        target: { type: 'reminderSweep', id: today },
        reason: `${created} created, ${existing} already existed, within ${input.withinDays} days`,
        context,
      });
    }
    return { created, existing, deliveryConnected: false };
  }

  /**
   * Move a reminder along.
   *
   * Asking for `simulated` when no adapter is configured is refused rather than faked: with nothing
   * behind the port there is no simulation either, and a state that claims otherwise would be the
   * exact dishonesty ADR-0026 exists to prevent.
   */
  async actOnReminder(
    actor: ActorContext,
    reminderId: string,
    input: ReminderAction,
    context: RequestContext,
  ): Promise<Reminder> {
    const current = await this.getReminder(actor, reminderId);
    if (!canTransitionReminder(current.state, input.state)) {
      throw new CollectionConflictError('invalidTransition');
    }

    let simulated = current.simulated;
    /**
     * Only a real rejection produces a failure.
     *
     * The caller's `reason` is a note for the audit trail, not evidence that anything went wrong: a
     * person marking a reminder as failed says why, and a person simulating one may still want to
     * record why they did it. Treating any supplied reason as a failure meant an explanatory note on
     * a successful simulation silently stored the reminder as `failed` — the collections screen then
     * showed a red row for something that had worked.
     */
    let failureReason = input.state === 'failed' ? input.reason : undefined;
    let rejected = false;
    if (input.state === 'simulated') {
      const adapter = this.options.delivery;
      if (!adapter) throw new CollectionConflictError('noDeliveryAdapterConfigured');
      const result = await adapter.deliver(current);
      simulated = !adapter.connected;
      if (!result.accepted) {
        rejected = true;
        failureReason = result.reason ?? 'the adapter did not accept the message';
      }
    }

    const now = new Date();
    const set: Record<string, unknown> = {
      state: rejected ? 'failed' : input.state,
      simulated,
      lastAttemptAt: now,
      updatedAt: now,
    };
    if (failureReason) set['failureReason'] = failureReason;

    const updated = await this.reminders
      .findOneAndUpdate(
        { reminderId, state: current.state },
        { $set: set, $inc: { version: 1 } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean<ReminderDocument>()
      .exec();
    if (!updated) throw new CollectionConflictError('invalidTransition');

    await this.options.audit.record({
      action: COLLECTION_AUDIT_ACTIONS.reminderStateChanged,
      outcome: 'succeeded',
      actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
      target: { type: 'reminder', id: reminderId },
      changes: buildChangeSummary({ state: current.state }, { state: updated.state }),
      ...(input.reason ? { reason: input.reason } : {}),
      context,
    });
    return toReminder(updated);
  }

  async listReminders(actor: ActorContext, query: ReminderQuery): Promise<ReminderPage> {
    const requested: Record<string, unknown> = {};
    for (const key of ['state', 'contractId', 'customerId', 'projectId'] as const) {
      const value = query[key];
      if (value !== undefined) requested[key] = value;
    }
    assertSafeFilter(requested);
    const filter = withScope(buildScopeFilter(actor, REMINDER_SCOPE_FIELDS), requested);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const paged = cursor
      ? {
          $and: [
            filter,
            {
              $or: [
                { createdAt: { $lt: cursor.date } },
                { createdAt: cursor.date, reminderId: { $lt: cursor.id } },
              ],
            },
          ],
        }
      : filter;
    const [documents, total] = await Promise.all([
      this.reminders
        .find(paged)
        .sort({ createdAt: -1, reminderId: -1 })
        .limit(query.limit + 1)
        .lean<ReminderDocument[]>()
        .exec(),
      this.reminders.countDocuments(filter).exec(),
    ]);
    const page = documents.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toReminder),
      total,
      limit: query.limit,
      ...(documents.length > query.limit && last
        ? { nextCursor: encodeCursor(last.createdAt, last.reminderId) }
        : {}),
    };
  }

  async getReminder(actor: ActorContext, reminderId: string): Promise<Reminder> {
    assertSafeFilter({ reminderId });
    const filter = withScope(buildScopeFilter(actor, REMINDER_SCOPE_FIELDS), { reminderId });
    const document = await this.reminders.findOne(filter).lean<ReminderDocument>().exec();
    if (!document) throw new CollectionNotFoundError('reminder');
    return toReminder(document);
  }

  /** Whether a real provider is behind the port. Reported on every reminder response (ADR-0026). */
  deliveryConnected(): boolean {
    return this.options.delivery?.connected ?? false;
  }
}
