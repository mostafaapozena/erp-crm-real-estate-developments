import {
  QuotationSchema,
  SALES_AUDIT_ACTIONS,
  buildInstallmentSchedule,
  compareMoney,
  divideMoney,
  multiplyMoney,
  scheduleTotal,
  subtractMoney,
  type ActorContext,
  type BusinessDate,
  type CreateQuotation,
  type Money,
  type PaymentPlan,
  type Quotation,
  type QuotationPage,
  type QuotationQuery,
  type ReviseQuotation,
  type ScheduleRow,
  type WithdrawQuotation,
} from '@alola/contracts';
import {
  assertSafeFilter,
  buildChangeSummary,
  buildScopeFilter,
  withScope,
  type ScopeFieldMap,
} from '@alola/security';
import { createHash } from 'node:crypto';
import type { ClientSession, Connection } from 'mongoose';
import { conflict, invalid, notFound, type AuditRecorder } from '../../platform/audit-port';
import { newId } from '../../platform/ids';
import { fromDecimal128, toDecimal128 } from '../../platform/money-storage';
import { withTransaction } from '../../platform/transactions';
import {
  quotationModel,
  type QuotationDocument,
  type StoredMoney,
  type StoredPaymentPlan,
  type StoredScheduleRow,
} from './model';
import type { RequestContext } from './service';

/**
 * Quotations — SALE-QUOTE-001.
 *
 * A quotation prices one unit on one plan for a customer or a lead, and **never reserves inventory**:
 * nothing here calls inventory to change a unit, so the unit stays on sale and anyone may reserve it
 * the next minute. The price is read from the unit when the quotation is made and kept; a later price
 * change does not rewrite what was offered. Revising makes a new revision and supersedes the old one;
 * nothing is edited in place and nothing is deleted.
 *
 * The validity is what the person entering it states — `BD-36` has decided no default, so none is
 * invented. A quotation past its date reads as `expired`; the stored record does not change.
 */

/** Scope fields for quotations: owned by the salesperson, placed like a reservation. */
export const QUOTATION_SCOPE_FIELDS: ScopeFieldMap = {
  owner: 'salesOwnerAccountId',
  assignee: 'salesOwnerAccountId',
  team: 'teamId',
  department: 'departmentId',
  branch: 'branchId',
  project: 'projectId',
  legalEntity: 'legalEntityId',
};

/** The unit a quotation prices, read through the actor's own scope and price visibility. */
export interface QuotationUnitPort {
  priced(
    actor: ActorContext,
    unitId: string,
  ): Promise<{
    unitId: string;
    code: string;
    projectId: string;
    legalEntityId: string;
    branchId: string;
    /** Absent when the actor may not see prices; a quotation is then refused. */
    currentPrice?: Money;
  }>;
}

/** The recipient, read through the actor's scope: a person the actor cannot see is not found. */
export interface QuotationRecipientPort {
  customerInScope(actor: ActorContext, customerId: string): Promise<boolean>;
  leadInScope(actor: ActorContext, leadId: string): Promise<boolean>;
  opportunity(
    actor: ActorContext,
    opportunityId: string,
  ): Promise<{ customerId: string } | undefined>;
}

export interface QuotationServiceOptions {
  connection: Connection;
  audit: AuditRecorder;
  units: QuotationUnitPort;
  recipients: QuotationRecipientPort;
  /** Official numbering (CORE-DOC-001); `undefined` falls back to the legacy series. */
  issueNumber?: (
    input: { issueDate: BusinessDate; projectId: string; source: { type: string; id: string } },
    session: ClientSession,
  ) => Promise<string | undefined>;
  /** The legacy series, shared with reservations and contracts. */
  legacyNumber: (prefix: string, session: ClientSession) => Promise<string>;
  today: () => BusinessDate;
}

const toMoney = (stored: StoredMoney): Money => ({
  amount: fromDecimal128(stored.amount),
  currency: stored.currency,
});
const fromMoney = (value: Money): StoredMoney => ({
  amount: toDecimal128(value.amount),
  currency: value.currency,
});

function fromPlan(plan: PaymentPlan): StoredPaymentPlan {
  return {
    downPayment: fromMoney(plan.downPayment),
    installmentCount: plan.installmentCount,
    frequency: plan.frequency,
    firstDueOn: plan.firstDueOn,
    ...(plan.downPaymentDueOn ? { downPaymentDueOn: plan.downPaymentDueOn } : {}),
    ...(plan.finalPayment ? { finalPayment: fromMoney(plan.finalPayment) } : {}),
    ...(plan.milestones && plan.milestones.length > 0
      ? {
          milestones: plan.milestones.map((milestone) => ({
            dueOn: milestone.dueOn,
            amount: fromMoney(milestone.amount),
            ...(milestone.label ? { label: milestone.label } : {}),
          })),
        }
      : {}),
    ...(plan.maintenanceDeposit
      ? {
          maintenanceDeposit: {
            amount: fromMoney(plan.maintenanceDeposit.amount),
            dueOn: plan.maintenanceDeposit.dueOn,
          },
        }
      : {}),
  };
}

function toPlan(stored: StoredPaymentPlan): PaymentPlan {
  return {
    downPayment: toMoney(stored.downPayment),
    installmentCount: stored.installmentCount,
    frequency: stored.frequency,
    firstDueOn: stored.firstDueOn as BusinessDate,
    ...(stored.downPaymentDueOn
      ? { downPaymentDueOn: stored.downPaymentDueOn as BusinessDate }
      : {}),
    ...(stored.finalPayment ? { finalPayment: toMoney(stored.finalPayment) } : {}),
    ...(stored.milestones && stored.milestones.length > 0
      ? {
          milestones: stored.milestones.map((milestone) => ({
            dueOn: milestone.dueOn as BusinessDate,
            amount: toMoney(milestone.amount),
            ...(milestone.label
              ? { label: { ar: milestone.label.ar, en: milestone.label.en } }
              : {}),
          })),
        }
      : {}),
    ...(stored.maintenanceDeposit
      ? {
          maintenanceDeposit: {
            amount: toMoney(stored.maintenanceDeposit.amount),
            dueOn: stored.maintenanceDeposit.dueOn as BusinessDate,
          },
        }
      : {}),
  };
}

const fromRow = (row: ScheduleRow): StoredScheduleRow => ({
  sequence: row.sequence,
  kind: row.kind,
  dueOn: row.dueOn,
  amount: fromMoney(row.amount),
  ...(row.label ? { label: row.label } : {}),
});

const toRow = (row: StoredScheduleRow): ScheduleRow => ({
  sequence: row.sequence,
  kind: row.kind,
  dueOn: row.dueOn as BusinessDate,
  amount: toMoney(row.amount),
  ...(row.label ? { label: { ar: row.label.ar, en: row.label.en } } : {}),
});

/** The discount from the list price, as a percentage to four places — the reservation's own rule. */
function discountPercentage(listPrice: Money, agreedPrice: Money): string {
  if (
    compareMoney(listPrice, { amount: '0' as Money['amount'], currency: listPrice.currency }) === 0
  ) {
    return '0';
  }
  const difference = subtractMoney(listPrice, agreedPrice);
  return divideMoney(multiplyMoney(difference, '100'), listPrice.amount, 4).amount;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function encodeCursor(createdAt: Date, id: string, revision: number): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}|${revision}`, 'utf8').toString('base64url');
}

function decodeCursor(
  cursor: string,
): { createdAt: Date; id: string; revision: number } | undefined {
  try {
    const [text, id, revision] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!text || !id || !revision) return undefined;
    const createdAt = new Date(text);
    const number = Number.parseInt(revision, 10);
    return Number.isNaN(createdAt.getTime()) || !Number.isInteger(number)
      ? undefined
      : { createdAt, id, revision: number };
  } catch {
    return undefined;
  }
}

const isDuplicateKey = (error: unknown) => (error as { code?: unknown })?.code === 11000;

export class QuotationService {
  private readonly quotations;

  constructor(private readonly options: QuotationServiceOptions) {
    this.quotations = quotationModel(options.connection);
  }

  private toQuotation(d: QuotationDocument): Quotation {
    // Expiry is read, never written: the record keeps what was offered and until when.
    const state = d.state === 'active' && d.validUntil < this.options.today() ? 'expired' : d.state;
    return QuotationSchema.parse({
      quotationId: d.quotationId,
      quotationNumber: d.quotationNumber,
      revision: d.revision,
      ...(d.customerId ? { customerId: d.customerId } : {}),
      ...(d.leadId ? { leadId: d.leadId } : {}),
      ...(d.opportunityId ? { opportunityId: d.opportunityId } : {}),
      unitId: d.unitId,
      unitCode: d.unitCode,
      projectId: d.projectId,
      listPrice: toMoney(d.listPrice),
      agreedPrice: toMoney(d.agreedPrice),
      discountPercentage: d.discountPercentage,
      paymentPlan: toPlan(d.paymentPlan),
      rows: d.rows.map(toRow),
      total: toMoney(d.total),
      validUntil: d.validUntil,
      state,
      ...(d.withdrawalReason ? { withdrawalReason: d.withdrawalReason } : {}),
      ...(d.notes ? { notes: d.notes } : {}),
      salesOwnerAccountId: d.salesOwnerAccountId,
      legalEntityId: d.legalEntityId,
      branchId: d.branchId,
      ...(d.departmentId ? { departmentId: d.departmentId } : {}),
      ...(d.teamId ? { teamId: d.teamId } : {}),
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    });
  }

  /** Price the terms: a valid schedule, a validity not in the past, and a price the unit can bear. */
  private price(
    listPrice: Money,
    agreedPrice: Money,
    plan: PaymentPlan,
    validUntil: BusinessDate,
  ): { rows: ScheduleRow[]; total: Money; discount: string } {
    if (agreedPrice.currency !== listPrice.currency) {
      throw invalid('CURRENCY_MISMATCH', ['agreedPrice']);
    }
    if (validUntil < this.options.today()) throw invalid('VALIDITY_IN_PAST', ['validUntil']);
    let rows: ScheduleRow[];
    try {
      rows = buildInstallmentSchedule(agreedPrice, plan);
    } catch (error) {
      throw invalid((error as { issue?: string }).issue ?? 'SCHEDULE_INVALID', ['paymentPlan']);
    }
    return {
      rows,
      total: scheduleTotal(agreedPrice, plan),
      discount: discountPercentage(listPrice, agreedPrice),
    };
  }

  private audit(
    actor: ActorContext,
    action: string,
    quotationId: string,
    context: RequestContext,
    session: ClientSession,
    extra: { reason?: string; changes?: { path: string; from?: string; to?: string }[] } = {},
  ): Promise<unknown> {
    return this.options.audit.record(
      {
        action,
        outcome: 'succeeded',
        actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
        target: { type: 'quotation', id: quotationId },
        ...(extra.changes ? { changes: extra.changes } : {}),
        ...(extra.reason ? { reason: extra.reason } : {}),
        context,
      },
      { session },
    );
  }

  private async replay(idempotencyKey: string, print: string): Promise<Quotation | undefined> {
    const existing = await this.quotations
      .findOne({ idempotencyKey })
      .lean<QuotationDocument>()
      .exec();
    if (!existing) return undefined;
    if (existing.idempotencyFingerprint !== print) {
      throw conflict('IDEMPOTENCY_CONFLICT', ['idempotencyKey']);
    }
    return this.toQuotation(existing);
  }

  async create(
    actor: ActorContext,
    input: CreateQuotation,
    context: RequestContext,
  ): Promise<{ quotation: Quotation; replayed: boolean }> {
    const { idempotencyKey, ...terms } = input;
    const print = fingerprint(terms);
    const replay = await this.replay(idempotencyKey, print);
    if (replay) return { quotation: replay, replayed: true };

    const unit = await this.options.units.priced(actor, input.unitId);
    if (!unit.currentPrice) throw conflict('PRICE_NOT_VISIBLE', ['unitId']);
    if (
      input.customerId &&
      !(await this.options.recipients.customerInScope(actor, input.customerId))
    ) {
      throw invalid('CUSTOMER_NOT_FOUND', ['customerId']);
    }
    if (input.leadId && !(await this.options.recipients.leadInScope(actor, input.leadId))) {
      throw invalid('LEAD_NOT_FOUND', ['leadId']);
    }
    if (input.opportunityId) {
      const opportunity = await this.options.recipients.opportunity(actor, input.opportunityId);
      if (!opportunity) throw invalid('OPPORTUNITY_NOT_FOUND', ['opportunityId']);
      if (input.customerId && opportunity.customerId !== input.customerId) {
        throw invalid('OPPORTUNITY_CUSTOMER_MISMATCH', ['opportunityId']);
      }
    }
    const priced = this.price(
      unit.currentPrice,
      input.agreedPrice,
      input.paymentPlan,
      input.validUntil,
    );

    const quotationId = newId('quo');
    try {
      return await withTransaction(this.options.connection, async (session) => {
        const quotationNumber =
          (await this.options.issueNumber?.(
            {
              issueDate: this.options.today(),
              projectId: unit.projectId,
              source: { type: 'quotation', id: quotationId },
            },
            session,
          )) ?? (await this.options.legacyNumber('QUO', session));
        const now = new Date();
        const [created] = await this.quotations.create(
          [
            {
              quotationId,
              quotationNumber,
              revision: 1,
              ...(input.customerId ? { customerId: input.customerId } : {}),
              ...(input.leadId ? { leadId: input.leadId } : {}),
              ...(input.opportunityId ? { opportunityId: input.opportunityId } : {}),
              unitId: unit.unitId,
              unitCode: unit.code,
              projectId: unit.projectId,
              listPrice: fromMoney(unit.currentPrice as Money),
              agreedPrice: fromMoney(input.agreedPrice),
              discountPercentage: priced.discount,
              paymentPlan: fromPlan(input.paymentPlan),
              rows: priced.rows.map(fromRow),
              total: fromMoney(priced.total),
              validUntil: input.validUntil,
              state: 'active',
              ...(input.notes ? { notes: input.notes } : {}),
              salesOwnerAccountId: actor.accountId,
              legalEntityId: unit.legalEntityId,
              branchId: unit.branchId,
              ...(actor.scope.teamIds[0] ? { teamId: actor.scope.teamIds[0] } : {}),
              ...(actor.scope.departmentIds[0]
                ? { departmentId: actor.scope.departmentIds[0] }
                : {}),
              idempotencyKey,
              idempotencyFingerprint: print,
              createdAt: now,
              updatedAt: now,
            },
          ],
          { session },
        );
        if (!created) throw conflict('QUOTATION_NOT_CREATED');
        await this.audit(
          actor,
          SALES_AUDIT_ACTIONS.quotationCreated,
          quotationId,
          context,
          session,
          {
            changes: buildChangeSummary(undefined, {
              quotationNumber,
              unitId: unit.unitId,
              agreedPrice: `${input.agreedPrice.amount} ${input.agreedPrice.currency}`,
              validUntil: input.validUntil,
            }),
          },
        );
        return { quotation: this.toQuotation(created.toObject()), replayed: false };
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        const stored = await this.replay(idempotencyKey, print);
        if (stored) return { quotation: stored, replayed: true };
      }
      throw error;
    }
  }

  /** The active revision of a quotation in the actor's scope, or not found. */
  private async activeRevision(
    actor: ActorContext,
    quotationId: string,
  ): Promise<QuotationDocument> {
    assertSafeFilter({ quotationId });
    const filter = withScope(buildScopeFilter(actor, QUOTATION_SCOPE_FIELDS), {
      quotationId,
      state: 'active',
    });
    const document = await this.quotations.findOne(filter).lean<QuotationDocument>().exec();
    if (!document) throw notFound();
    return document;
  }

  /**
   * A new revision on new terms, priced from the unit's **current** price; the one it replaces becomes
   * `superseded`. A stale revision number is refused, so two people revising at once cannot both win.
   */
  async revise(
    actor: ActorContext,
    quotationId: string,
    input: ReviseQuotation,
    context: RequestContext,
  ): Promise<Quotation> {
    const current = await this.activeRevision(actor, quotationId);
    if (current.revision !== input.expectedRevision) {
      throw conflict('STALE_VERSION', ['expectedRevision']);
    }
    const unit = await this.options.units.priced(actor, current.unitId);
    if (!unit.currentPrice) throw conflict('PRICE_NOT_VISIBLE', ['unitId']);
    const priced = this.price(
      unit.currentPrice,
      input.agreedPrice,
      input.paymentPlan,
      input.validUntil,
    );
    try {
      return await withTransaction(this.options.connection, async (session) => {
        const now = new Date();
        const superseded = await this.quotations
          .updateOne(
            { quotationId, revision: current.revision, state: 'active' },
            { $set: { state: 'superseded', updatedAt: now } },
            { session },
          )
          .exec();
        if (superseded.modifiedCount !== 1) throw conflict('STALE_VERSION', ['expectedRevision']);
        const [created] = await this.quotations.create(
          [
            {
              quotationId,
              quotationNumber: current.quotationNumber,
              revision: current.revision + 1,
              ...(current.customerId ? { customerId: current.customerId } : {}),
              ...(current.leadId ? { leadId: current.leadId } : {}),
              ...(current.opportunityId ? { opportunityId: current.opportunityId } : {}),
              unitId: current.unitId,
              unitCode: current.unitCode,
              projectId: current.projectId,
              listPrice: fromMoney(unit.currentPrice as Money),
              agreedPrice: fromMoney(input.agreedPrice),
              discountPercentage: priced.discount,
              paymentPlan: fromPlan(input.paymentPlan),
              rows: priced.rows.map(fromRow),
              total: fromMoney(priced.total),
              validUntil: input.validUntil,
              state: 'active',
              ...(input.notes ? { notes: input.notes } : {}),
              salesOwnerAccountId: current.salesOwnerAccountId,
              legalEntityId: current.legalEntityId,
              branchId: current.branchId,
              ...(current.departmentId ? { departmentId: current.departmentId } : {}),
              ...(current.teamId ? { teamId: current.teamId } : {}),
              createdAt: now,
              updatedAt: now,
            },
          ],
          { session },
        );
        if (!created) throw conflict('QUOTATION_NOT_CREATED');
        await this.audit(
          actor,
          SALES_AUDIT_ACTIONS.quotationRevised,
          quotationId,
          context,
          session,
          {
            changes: buildChangeSummary(
              { revision: String(current.revision) },
              {
                revision: String(current.revision + 1),
                agreedPrice: `${input.agreedPrice.amount} ${input.agreedPrice.currency}`,
              },
            ),
          },
        );
        return this.toQuotation(created.toObject());
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw conflict('STALE_VERSION', ['expectedRevision']);
      throw error;
    }
  }

  async withdraw(
    actor: ActorContext,
    quotationId: string,
    input: WithdrawQuotation,
    context: RequestContext,
  ): Promise<Quotation> {
    const current = await this.activeRevision(actor, quotationId);
    if (current.revision !== input.expectedRevision) {
      throw conflict('STALE_VERSION', ['expectedRevision']);
    }
    return withTransaction(this.options.connection, async (session) => {
      const updated = await this.quotations
        .findOneAndUpdate(
          { quotationId, revision: current.revision, state: 'active' },
          { $set: { state: 'withdrawn', withdrawalReason: input.reason, updatedAt: new Date() } },
          { returnDocument: 'after', session },
        )
        .lean<QuotationDocument>()
        .exec();
      if (!updated) throw conflict('STALE_VERSION', ['expectedRevision']);
      await this.audit(
        actor,
        SALES_AUDIT_ACTIONS.quotationWithdrawn,
        quotationId,
        context,
        session,
        {
          reason: input.reason,
          changes: buildChangeSummary({ state: 'active' }, { state: 'withdrawn' }),
        },
      );
      return this.toQuotation(updated);
    });
  }

  /** The latest revision of each quotation in scope, newest first. */
  async list(actor: ActorContext, query: QuotationQuery): Promise<QuotationPage> {
    const requested: Record<string, unknown> = {};
    for (const key of ['customerId', 'leadId', 'opportunityId', 'unitId'] as const) {
      if (query[key] !== undefined) requested[key] = query[key];
    }
    assertSafeFilter(requested);
    // The latest revision is the one not superseded: active, withdrawn, or expired on read. Expiry is
    // never stored, so the state asked for becomes the stored state plus a bound on the validity date.
    const today = this.options.today();
    switch (query.state) {
      case 'active':
        requested['state'] = 'active';
        requested['validUntil'] = { $gte: today };
        break;
      case 'expired':
        requested['state'] = 'active';
        requested['validUntil'] = { $lt: today };
        break;
      case 'withdrawn':
        requested['state'] = 'withdrawn';
        break;
      default:
        requested['state'] = { $ne: 'superseded' };
    }
    if (query.search) {
      // Escaped and anchored: the text is matched literally at the start, never run as a pattern.
      const prefix = `^${query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
      requested['$or'] = [
        { quotationNumber: { $regex: prefix, $options: 'i' } },
        { unitCode: { $regex: prefix, $options: 'i' } },
      ];
    }
    const filter = withScope(buildScopeFilter(actor, QUOTATION_SCOPE_FIELDS), requested);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const paged = cursor
      ? {
          $and: [
            filter,
            {
              $or: [
                { createdAt: { $lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, quotationId: { $lt: cursor.id } },
                {
                  createdAt: cursor.createdAt,
                  quotationId: cursor.id,
                  revision: { $lt: cursor.revision },
                },
              ],
            },
          ],
        }
      : filter;
    const [documents, total] = await Promise.all([
      this.quotations
        .find(paged)
        .sort({ createdAt: -1, quotationId: -1, revision: -1 })
        .limit(query.limit + 1)
        .lean<QuotationDocument[]>()
        .exec(),
      this.quotations.countDocuments(filter).exec(),
    ]);
    const page = documents.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((document) => this.toQuotation(document)),
      total,
      limit: query.limit,
      ...(documents.length > query.limit && last
        ? { nextCursor: encodeCursor(last.createdAt, last.quotationId, last.revision) }
        : {}),
    };
  }

  /** Every revision of one quotation, latest first — out of scope is not found (SEC-030). */
  async revisions(actor: ActorContext, quotationId: string): Promise<{ items: Quotation[] }> {
    assertSafeFilter({ quotationId });
    const filter = withScope(buildScopeFilter(actor, QUOTATION_SCOPE_FIELDS), { quotationId });
    const documents = await this.quotations
      .find(filter)
      .sort({ revision: -1 })
      .limit(100)
      .lean<QuotationDocument[]>()
      .exec();
    if (documents.length === 0) {
      throw notFound();
    }
    return { items: documents.map((document) => this.toQuotation(document)) };
  }
}
