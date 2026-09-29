import {
  INVENTORY_AUDIT_ACTIONS,
  PriceVersionSchema,
  compareMoney,
  divideMoney,
  isNegativeMoney,
  isZeroMoney,
  multiplyMoney,
  subtractMoney,
  type ActorContext,
  type BusinessDate,
  type Money,
  type PriceVersion,
  type ProposePrice,
} from '@alola/contracts';
import { assertSafeFilter, buildChangeSummary } from '@alola/security';
import type { Logger } from '@alola/security';
import { createHash } from 'node:crypto';
import type { ClientSession, Connection } from 'mongoose';
import {
  auditActor,
  conflict,
  invalid,
  isDuplicateKeyError,
  type AuditRecorder,
  type RequestContext,
} from '../../platform/audit-port';
import { newId } from '../../platform/ids';
import { fromDecimal128, toDecimal128 } from '../../platform/money-storage';
import { withTransaction } from '../../platform/transactions';
import {
  INVENTORY_APPROVAL_OPERATIONS,
  approvalPercentage,
  type InventoryApprovalPort,
} from './approval-port';
import {
  priceVersionModel,
  unitEventModel,
  unitModel,
  type PriceVersionDocument,
  type StoredMoney,
  type UnitDocument,
} from './model';
import { InventoryNotFoundError, type InventoryService } from './service';

/**
 * Unit price versions (INV-PRICE-001, INV-PRICE-003).
 *
 * A price is never edited: a change is a new version, proposed with a reason and a date, that moves
 * `pendingApproval → scheduled → effective` and is later `superseded`. Applying one updates the unit's
 * current price, its price per square metre, the unit's history and the audit trail in **one
 * transaction**, conditional on the version still being scheduled — so a sweep and an approval racing
 * to apply the same version apply it once.
 *
 * Reservations and contracts are unaffected by a price change: they carry the price agreed with the
 * customer as their own snapshot (SALE-CONTRACT-001).
 */
export interface PriceServiceOptions {
  connection: Connection;
  audit: AuditRecorder;
  logger: Logger;
  inventory: InventoryService;
  approvals?: InventoryApprovalPort;
  /** The calendar date in the organization's timezone (ADR-0008). */
  today: () => BusinessDate;
}

const iso = (date: Date) => date.toISOString();

function toMoney(stored: StoredMoney): Money {
  return { amount: fromDecimal128(stored.amount), currency: stored.currency };
}

function fromMoney(value: Money): StoredMoney {
  return { amount: toDecimal128(value.amount), currency: value.currency };
}

function toPriceVersion(d: PriceVersionDocument): PriceVersion {
  return PriceVersionSchema.parse({
    priceVersionId: d.priceVersionId,
    unitId: d.unitId,
    projectId: d.projectId,
    sequence: d.sequence,
    price: toMoney(d.price),
    previousPrice: toMoney(d.previousPrice),
    changePercentage: d.changePercentage,
    effectiveFrom: d.effectiveFrom,
    state: d.state,
    reason: d.reason,
    ...(d.approvalRequestId ? { approvalRequestId: d.approvalRequestId } : {}),
    proposedBy: d.proposedBy,
    proposedAt: iso(d.proposedAt),
    ...(d.appliedAt ? { appliedAt: iso(d.appliedAt) } : {}),
  });
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class PriceService {
  private readonly connection;
  private readonly versions;
  private readonly units;
  private readonly unitEvents;

  constructor(private readonly options: PriceServiceOptions) {
    this.connection = options.connection;
    this.versions = priceVersionModel(options.connection);
    this.units = unitModel(options.connection);
    this.unitEvents = unitEventModel(options.connection);
  }

  /** The history of a visible unit, newest first. The route requires price visibility. */
  async list(actor: ActorContext, unitId: string): Promise<PriceVersion[]> {
    await this.options.inventory.getUnit(actor, unitId);
    const rows = await this.versions
      .find({ unitId })
      .sort({ sequence: -1 })
      .limit(200)
      .lean<PriceVersionDocument[]>()
      .exec();
    return rows.map(toPriceVersion);
  }

  private async replay(key: string, print: string): Promise<PriceVersion | undefined> {
    const existing = await this.versions
      .findOne({ idempotencyKey: key })
      .lean<PriceVersionDocument>()
      .exec();
    if (!existing) return undefined;
    if (existing.idempotencyFingerprint !== print) throw conflict('IDEMPOTENCY_KEY_REUSED');
    return toPriceVersion(existing);
  }

  /**
   * INV-PRICE-001 / 003: propose a new price for a unit the actor can see. It waits for approval when
   * a policy applies to the change, and is applied at once when it is effective today and none does.
   */
  async propose(
    actor: ActorContext,
    unitId: string,
    input: ProposePrice,
    context: RequestContext,
  ): Promise<{ version: PriceVersion; replayed: boolean }> {
    const print = fingerprint({ unitId, price: input.price, effectiveFrom: input.effectiveFrom });
    const replayed = await this.replay(input.idempotencyKey, print);
    if (replayed) return { version: replayed, replayed: true };

    const unit = await this.options.inventory.getUnit(actor, unitId);
    const current = unit.currentPrice;
    // The route demands price visibility, so the price is present; absent means it was not granted.
    if (!current) throw conflict('PRICE_NOT_VISIBLE');
    if (input.price.currency !== current.currency) throw invalid('CURRENCY_MISMATCH', ['price']);
    if (isNegativeMoney(input.price) || isZeroMoney(input.price)) {
      throw invalid('PRICE_MUST_BE_POSITIVE', ['price']);
    }
    if (compareMoney(input.price, current) === 0) throw invalid('NOTHING_TO_CHANGE', ['price']);
    const today = this.options.today();
    // A past date would rewrite what a customer was quoted; history is corrected forward only.
    if (input.effectiveFrom < today) throw invalid('PRICE_DATE_IN_PAST', ['effectiveFrom']);
    const open = await this.versions
      .findOne({ unitId, state: { $in: ['pendingApproval', 'scheduled'] } })
      .lean()
      .exec();
    if (open) throw conflict('PRICE_CHANGE_PENDING');

    const last = await this.versions
      .findOne({ unitId }, { sequence: 1 })
      .sort({ sequence: -1 })
      .lean<PriceVersionDocument>()
      .exec();
    const changePercentage = divideMoney(
      multiplyMoney(subtractMoney(input.price, current), '100'),
      current.amount,
      4,
    ).amount;
    const now = new Date();
    const document: PriceVersionDocument = {
      priceVersionId: newId('prv'),
      unitId,
      projectId: unit.projectId,
      legalEntityId: unit.legalEntityId,
      branchId: unit.branchId,
      sequence: (last?.sequence ?? 0) + 1,
      price: fromMoney(input.price),
      previousPrice: fromMoney(current),
      changePercentage,
      effectiveFrom: input.effectiveFrom,
      state: 'scheduled',
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      idempotencyFingerprint: print,
      proposedBy: actor.accountId,
      proposedAt: now,
      updatedAt: now,
    };
    try {
      await withTransaction(this.connection, async (session) => {
        await this.versions.create([document], { session });
        await this.options.audit.record(
          {
            action: INVENTORY_AUDIT_ACTIONS.priceProposed,
            outcome: 'succeeded',
            actor: auditActor(actor),
            target: { type: 'unit', id: unitId },
            changes: buildChangeSummary(
              { price: current.amount },
              {
                price: input.price.amount,
                effectiveFrom: input.effectiveFrom,
                changePercentage,
              },
            ),
            reason: input.reason,
            context,
          },
          { session },
        );
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const again = await this.replay(input.idempotencyKey, print);
        if (again) return { version: again, replayed: true };
        throw conflict('PRICE_CHANGE_PENDING');
      }
      throw error;
    }

    // The approval is requested after the proposal commits, so a policy failure cannot leave a
    // half-written version; with no applicable policy the version stays scheduled.
    const submitted = await this.options.approvals?.submit(
      actor,
      {
        operationType: INVENTORY_APPROVAL_OPERATIONS.priceChange,
        source: { type: 'priceVersion', id: document.priceVersionId },
        scope: {
          projectId: unit.projectId,
          branchId: unit.branchId,
          legalEntityId: unit.legalEntityId,
        },
        context: { amount: input.price, percentage: approvalPercentage(changePercentage) },
        summary: [
          { label: { ar: 'رمز الوحدة', en: 'Unit code' }, value: unit.code },
          { label: { ar: 'نسبة التغيير', en: 'Change' }, value: `${changePercentage}%` },
          { label: { ar: 'تاريخ السريان', en: 'Effective from' }, value: input.effectiveFrom },
        ],
        idempotencyKey: `price-change-${document.priceVersionId}`,
      },
      context,
    );
    if (submitted) {
      await this.versions
        .updateOne(
          { priceVersionId: document.priceVersionId, state: 'scheduled' },
          {
            $set: {
              state: 'pendingApproval',
              approvalRequestId: submitted.requestId,
              updatedAt: new Date(),
            },
          },
        )
        .exec();
      // An engine that settled the request at once (an auto-approving policy) is honoured now.
      await this.syncApproval(actor, submitted.requestId, context);
    } else if (input.effectiveFrom <= today) {
      await this.apply(actor, document.priceVersionId, context);
    }
    const stored = await this.versions
      .findOne({ priceVersionId: document.priceVersionId })
      .lean<PriceVersionDocument>()
      .exec();
    return { version: toPriceVersion(stored as PriceVersionDocument), replayed: false };
  }

  /** Cancel a version that has not taken effect. Its record stays. */
  async cancel(
    actor: ActorContext,
    priceVersionId: string,
    reason: string,
    context: RequestContext,
  ): Promise<PriceVersion> {
    assertSafeFilter({ priceVersionId });
    const version = await this.versions
      .findOne({ priceVersionId })
      .lean<PriceVersionDocument>()
      .exec();
    if (!version) throw new InventoryNotFoundError('priceVersion');
    // Visible only through its unit.
    await this.options.inventory.getUnit(actor, version.unitId);
    const updated = await withTransaction(this.connection, async (session) => {
      const result = await this.versions
        .findOneAndUpdate(
          { priceVersionId, state: { $in: ['pendingApproval', 'scheduled'] } },
          { $set: { state: 'cancelled', updatedAt: new Date() } },
          { returnDocument: 'after', session },
        )
        .lean<PriceVersionDocument>()
        .exec();
      if (!result) throw conflict('PRICE_VERSION_CLOSED');
      await this.options.audit.record(
        {
          action: INVENTORY_AUDIT_ACTIONS.priceCancelled,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'unit', id: version.unitId },
          changes: buildChangeSummary({ state: version.state }, { state: 'cancelled' }),
          reason,
          context,
        },
        { session },
      );
      return result;
    });
    return toPriceVersion(updated);
  }

  /**
   * Make a scheduled version the unit's price, in one transaction. Conditional on the version being
   * `scheduled`: a second caller finds nothing to apply and changes nothing.
   */
  async apply(
    actor: ActorContext,
    priceVersionId: string,
    context: RequestContext,
  ): Promise<boolean> {
    return withTransaction(this.connection, async (session) => {
      const now = new Date();
      const version = await this.versions
        .findOneAndUpdate(
          { priceVersionId, state: 'scheduled' },
          { $set: { state: 'effective', appliedAt: now, updatedAt: now } },
          { returnDocument: 'after', session },
        )
        .lean<PriceVersionDocument>()
        .exec();
      if (!version) return false;
      await this.versions
        .updateMany(
          { unitId: version.unitId, state: 'effective', priceVersionId: { $ne: priceVersionId } },
          { $set: { state: 'superseded', updatedAt: now } },
          { session },
        )
        .exec();
      await this.applyToUnit(actor, version, context, session);
      return true;
    });
  }

  private async applyToUnit(
    actor: ActorContext,
    version: PriceVersionDocument,
    context: RequestContext,
    session: ClientSession,
  ): Promise<void> {
    const unit = await this.units
      .findOne({ unitId: version.unitId })
      .session(session)
      .lean<UnitDocument>()
      .exec();
    if (!unit) throw new InventoryNotFoundError('unit');
    const price = toMoney(version.price);
    const before = toMoney(unit.currentPrice);
    const perSquareMeter = divideMoney(price, fromDecimal128(unit.area), 2);
    await this.units
      .updateOne(
        { unitId: unit.unitId },
        {
          $set: {
            currentPrice: fromMoney(price),
            pricePerSquareMeter: fromMoney(perSquareMeter),
            updatedAt: new Date(),
          },
          $inc: { version: 1 },
        },
        { session },
      )
      .exec();
    await this.unitEvents.create(
      [
        {
          eventId: newId('uev'),
          unitId: unit.unitId,
          projectId: unit.projectId,
          kind: 'priceChanged',
          reason: version.reason,
          sourceType: 'priceVersion',
          sourceId: version.priceVersionId,
          actorAccountId: actor.accountId,
          occurredAt: new Date(),
        },
      ],
      { session },
    );
    await this.options.audit.record(
      {
        action: INVENTORY_AUDIT_ACTIONS.priceApplied,
        outcome: 'succeeded',
        actor: auditActor(actor),
        target: { type: 'unit', id: unit.unitId },
        changes: buildChangeSummary({ price: before.amount }, { price: price.amount }),
        reason: version.reason,
        context,
      },
      { session },
    );
  }

  /** Act on a decided approval: approve → schedule (and apply if due); refuse → rejected. */
  async syncApproval(
    actor: ActorContext,
    requestId: string,
    context: RequestContext,
  ): Promise<'applied' | 'scheduled' | 'rejected' | 'unchanged'> {
    assertSafeFilter({ requestId });
    const version = await this.versions
      .findOne({ approvalRequestId: requestId, state: 'pendingApproval' })
      .lean<PriceVersionDocument>()
      .exec();
    if (!version) return 'unchanged';
    const state = await this.options.approvals?.state(requestId);
    if (state === 'approved') {
      await this.versions
        .updateOne(
          { priceVersionId: version.priceVersionId, state: 'pendingApproval' },
          { $set: { state: 'scheduled', updatedAt: new Date() } },
        )
        .exec();
      if (version.effectiveFrom <= this.options.today()) {
        return (await this.apply(actor, version.priceVersionId, context)) ? 'applied' : 'scheduled';
      }
      return 'scheduled';
    }
    if (state === 'rejected' || state === 'cancelled' || state === 'expired') {
      await withTransaction(this.connection, async (session) => {
        const result = await this.versions
          .updateOne(
            { priceVersionId: version.priceVersionId, state: 'pendingApproval' },
            { $set: { state: 'rejected', updatedAt: new Date() } },
            { session },
          )
          .exec();
        if (result.modifiedCount === 0) return;
        await this.options.audit.record(
          {
            action: INVENTORY_AUDIT_ACTIONS.priceRejected,
            outcome: 'succeeded',
            actor: auditActor(actor),
            target: { type: 'unit', id: version.unitId },
            reason: `approval ${state}`,
            context,
          },
          { session },
        );
      });
      return 'rejected';
    }
    return 'unchanged';
  }

  /** The maintenance sweep: apply every scheduled version now due; settle decided approvals. */
  async sweep(
    actor: ActorContext,
    context: RequestContext,
  ): Promise<{ applied: number; settled: number }> {
    let settled = 0;
    const waiting = await this.versions
      .find({ state: 'pendingApproval' }, { approvalRequestId: 1 })
      .limit(200)
      .lean<PriceVersionDocument[]>()
      .exec();
    for (const row of waiting) {
      if (!row.approvalRequestId) continue;
      try {
        if ((await this.syncApproval(actor, row.approvalRequestId, context)) !== 'unchanged') {
          settled += 1;
        }
      } catch (error) {
        this.options.logger.warn(
          { err: error, code: 'PRICE_APPROVAL_SYNC_SKIPPED' },
          'A price approval could not be settled; the sweep continued.',
        );
      }
    }
    let applied = 0;
    const due = await this.versions
      .find({ state: 'scheduled', effectiveFrom: { $lte: this.options.today() } })
      .sort({ effectiveFrom: 1 })
      .limit(200)
      .lean<PriceVersionDocument[]>()
      .exec();
    for (const row of due) {
      try {
        if (await this.apply(actor, row.priceVersionId, context)) applied += 1;
      } catch (error) {
        this.options.logger.warn(
          { err: error, code: 'PRICE_APPLY_SKIPPED', priceVersionId: row.priceVersionId },
          'A due price could not be applied; the sweep continued.',
        );
      }
    }
    return { applied, settled };
  }
}
