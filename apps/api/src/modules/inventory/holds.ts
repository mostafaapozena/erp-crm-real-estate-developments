import {
  HoldSchema,
  INVENTORY_AUDIT_ACTIONS,
  type ActorContext,
  type CreateHold,
  type Hold,
  type HoldQuery,
} from '@alola/contracts';
import {
  assertSafeFilter,
  buildCatalogueScopeFilter,
  buildChangeSummary,
  can,
  withScope,
  type Logger,
} from '@alola/security';
import type { ClientSession, Connection } from 'mongoose';
import {
  DomainError,
  auditActor,
  conflict,
  isDuplicateKeyError,
  type AuditRecorder,
  type RequestContext,
} from '../../platform/audit-port';
import { newId } from '../../platform/ids';
import { withTransaction } from '../../platform/transactions';
import { INVENTORY_APPROVAL_OPERATIONS, type InventoryApprovalPort } from './approval-port';
import {
  holdModel,
  unitEventModel,
  unitModel,
  type HoldDocument,
  type UnitDocument,
} from './model';
import { INVENTORY_SCOPE_FIELDS, InventoryNotFoundError, type InventoryService } from './service';

/**
 * Timed customer holds (INV-HOLD-001, INV-HOLD-002).
 *
 * A hold takes an `available` unit to `held` for a configured number of hours (`BD-29`), in one
 * transaction with the hold record. Three things settle a race for one unit, any one of which would
 * suffice: the unit's conditional status update, the unique active-hold index, and the unit's own
 * unique `unitId`. A hold ends by release, by expiry, or by becoming a reservation — and in every case
 * the unit is moved back only if **this** hold still holds it.
 */
export interface HoldServiceOptions {
  connection: Connection;
  audit: AuditRecorder;
  logger: Logger;
  inventory: InventoryService;
  approvals?: InventoryApprovalPort;
  /** The configured hold length in hours, or `null` when not configured (`BD-29`). */
  holdHours: () => Promise<number | null>;
  now?: () => Date;
}

const iso = (date: Date) => date.toISOString();
const HOUR_MS = 3_600_000;

function toHold(d: HoldDocument): Hold {
  return HoldSchema.parse({
    holdId: d.holdId,
    unitId: d.unitId,
    projectId: d.projectId,
    legalEntityId: d.legalEntityId,
    branchId: d.branchId,
    ...(d.customerId ? { customerId: d.customerId } : {}),
    ...(d.opportunityId ? { opportunityId: d.opportunityId } : {}),
    holderAccountId: d.holderAccountId,
    state: d.state,
    expiresAt: iso(d.expiresAt),
    extensions: d.extensions,
    ...(d.note ? { note: d.note } : {}),
    ...(d.releaseReason ? { releaseReason: d.releaseReason } : {}),
    ...(d.reservationId ? { reservationId: d.reservationId } : {}),
    ...(d.extensionApprovalRequestId
      ? { extensionApprovalRequestId: d.extensionApprovalRequestId }
      : {}),
    version: d.version,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

export class HoldService {
  private readonly connection;
  private readonly holds;
  private readonly units;
  private readonly unitEvents;
  private readonly now: () => Date;

  constructor(private readonly options: HoldServiceOptions) {
    this.connection = options.connection;
    this.holds = holdModel(options.connection);
    this.units = unitModel(options.connection);
    this.unitEvents = unitEventModel(options.connection);
    this.now = options.now ?? (() => new Date());
  }

  private async hours(): Promise<number> {
    const hours = await this.options.holdHours();
    // No length decided means no hold: a guessed length would release units nobody expected to lose.
    if (hours === null || hours <= 0) throw conflict('HOLD_DURATION_NOT_CONFIGURED');
    return hours;
  }

  private async scoped(actor: ActorContext, holdId: string): Promise<HoldDocument> {
    assertSafeFilter({ holdId });
    const document = await this.holds
      .findOne(withScope(buildCatalogueScopeFilter(actor, INVENTORY_SCOPE_FIELDS), { holdId }))
      .lean<HoldDocument>()
      .exec();
    if (!document) throw new InventoryNotFoundError('hold');
    return document;
  }

  async get(actor: ActorContext, holdId: string): Promise<Hold> {
    return toHold(await this.scoped(actor, holdId));
  }

  async list(actor: ActorContext, query: HoldQuery): Promise<Hold[]> {
    const requested: Record<string, unknown> = {};
    for (const key of ['state', 'unitId', 'projectId', 'holderAccountId'] as const) {
      const value = query[key];
      if (value !== undefined) requested[key] = value;
    }
    assertSafeFilter(requested);
    const rows = await this.holds
      .find(withScope(buildCatalogueScopeFilter(actor, INVENTORY_SCOPE_FIELDS), requested))
      .sort({ createdAt: -1, holdId: -1 })
      .limit(query.limit)
      .lean<HoldDocument[]>()
      .exec();
    return rows.map(toHold);
  }

  /** INV-HOLD-001: hold an available unit the actor can see. Idempotent by key. */
  async create(
    actor: ActorContext,
    input: CreateHold,
    context: RequestContext,
  ): Promise<{ hold: Hold; replayed: boolean }> {
    const replay = await this.holds
      .findOne({ idempotencyKey: input.idempotencyKey })
      .lean<HoldDocument>()
      .exec();
    if (replay) {
      if (replay.unitId !== input.unitId) throw conflict('IDEMPOTENCY_KEY_REUSED');
      return { hold: toHold(replay), replayed: true };
    }
    const hours = await this.hours();
    const unit = await this.options.inventory.getUnit(actor, input.unitId);
    if (unit.status !== 'available') throw conflict('UNIT_NOT_AVAILABLE', ['unitId']);
    const now = this.now();
    const document: HoldDocument = {
      holdId: newId('hold'),
      unitId: unit.unitId,
      projectId: unit.projectId,
      legalEntityId: unit.legalEntityId,
      branchId: unit.branchId,
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.opportunityId ? { opportunityId: input.opportunityId } : {}),
      holderAccountId: actor.accountId,
      state: 'active',
      expiresAt: new Date(now.getTime() + hours * HOUR_MS),
      extensions: 0,
      ...(input.note ? { note: input.note } : {}),
      idempotencyKey: input.idempotencyKey,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await withTransaction(this.connection, async (session) => {
        await this.holds.create([document], { session });
        // The hold and the unit move together: a hold without its unit, or the reverse, never exists.
        await this.options.inventory.applyStatusChange(
          actor,
          {
            unitId: unit.unitId,
            from: 'available',
            to: 'held',
            reason: 'customer hold',
            sourceType: 'hold',
            sourceId: document.holdId,
            holdId: document.holdId,
          },
          context,
          session,
        );
        await this.options.audit.record(
          {
            action: INVENTORY_AUDIT_ACTIONS.holdTaken,
            outcome: 'succeeded',
            actor: auditActor(actor),
            target: { type: 'unit', id: unit.unitId },
            changes: buildChangeSummary(undefined, {
              holdId: document.holdId,
              expiresAt: iso(document.expiresAt),
            }),
            context,
          },
          { session },
        );
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const again = await this.holds
          .findOne({ idempotencyKey: input.idempotencyKey })
          .lean<HoldDocument>()
          .exec();
        if (again) return { hold: toHold(again), replayed: true };
        throw conflict('UNIT_NOT_AVAILABLE', ['unitId']);
      }
      // The unit moved between the read and the update: someone else took it.
      if ((error as { name?: string }).name === 'UnitTransitionError') {
        throw conflict('UNIT_NOT_AVAILABLE', ['unitId']);
      }
      throw error;
    }
    return { hold: toHold(document), replayed: false };
  }

  /** The holder, or anyone with `inventory.hold.manage`, may act on a hold. */
  private assertMayAct(actor: ActorContext, hold: HoldDocument): void {
    if (hold.holderAccountId !== actor.accountId && !can(actor, 'inventory.hold.manage')) {
      throw new DomainError('FORBIDDEN', [{ path: ['holdId'], code: 'NOT_HOLDER' }]);
    }
  }

  /** End an active hold and return the unit — only if this hold still holds it. */
  private async end(
    actor: ActorContext,
    hold: HoldDocument,
    to: 'released' | 'expired',
    reason: string,
    context: RequestContext,
  ): Promise<HoldDocument> {
    return withTransaction(this.connection, async (session) => {
      const now = this.now();
      const updated = await this.holds
        .findOneAndUpdate(
          { holdId: hold.holdId, state: 'active', version: hold.version },
          {
            $set: { state: to, releaseReason: reason, updatedAt: now },
            $unset: { extensionApprovalRequestId: '' },
            $inc: { version: 1 },
          },
          { returnDocument: 'after', session },
        )
        .lean<HoldDocument>()
        .exec();
      if (!updated) throw conflict('HOLD_NOT_ACTIVE');
      await this.options.inventory.applyStatusChange(
        actor,
        {
          unitId: hold.unitId,
          from: 'held',
          to: 'available',
          reason,
          sourceType: 'hold',
          sourceId: hold.holdId,
          holdId: null,
          expectHoldId: hold.holdId,
        },
        context,
        session,
      );
      await this.options.audit.record(
        {
          action:
            to === 'expired'
              ? INVENTORY_AUDIT_ACTIONS.holdExpired
              : INVENTORY_AUDIT_ACTIONS.holdReleased,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'unit', id: hold.unitId },
          changes: buildChangeSummary({ holdState: 'active' }, { holdState: to }),
          reason,
          context,
        },
        { session },
      );
      return updated;
    });
  }

  async release(
    actor: ActorContext,
    holdId: string,
    reason: string,
    context: RequestContext,
  ): Promise<Hold> {
    const hold = await this.scoped(actor, holdId);
    this.assertMayAct(actor, hold);
    return toHold(await this.end(actor, hold, 'released', reason, context));
  }

  /**
   * INV-HOLD-002: extend by the configured length. Through the approval engine when a policy applies
   * (`inventory.hold.extension`); otherwise at once, for the holder or a manager.
   */
  async extend(
    actor: ActorContext,
    holdId: string,
    input: { reason: string; expectedVersion: number },
    context: RequestContext,
  ): Promise<Hold> {
    const hold = await this.scoped(actor, holdId);
    this.assertMayAct(actor, hold);
    if (hold.state !== 'active') throw conflict('HOLD_NOT_ACTIVE');
    if (hold.version !== input.expectedVersion) throw conflict('STALE_VERSION');
    if (hold.extensionApprovalRequestId) throw conflict('EXTENSION_PENDING');
    await this.hours();

    const submitted = await this.options.approvals?.submit(
      actor,
      {
        operationType: INVENTORY_APPROVAL_OPERATIONS.holdExtension,
        source: { type: 'hold', id: holdId },
        scope: {
          projectId: hold.projectId,
          branchId: hold.branchId,
          legalEntityId: hold.legalEntityId,
        },
        context: { isException: true },
        summary: [{ label: { ar: 'تمديد حجز مؤقت', en: 'Hold extension' }, value: input.reason }],
        idempotencyKey: `hold-extension-${holdId}-${String(hold.extensions + 1)}`,
      },
      context,
    );
    if (submitted) {
      const updated = await withTransaction(this.connection, async (session) => {
        const result = await this.holds
          .findOneAndUpdate(
            { holdId, state: 'active', version: hold.version },
            {
              $set: { extensionApprovalRequestId: submitted.requestId, updatedAt: this.now() },
              $inc: { version: 1 },
            },
            { returnDocument: 'after', session },
          )
          .lean<HoldDocument>()
          .exec();
        if (!result) throw conflict('STALE_VERSION');
        await this.options.audit.record(
          {
            action: INVENTORY_AUDIT_ACTIONS.holdExtensionRequested,
            outcome: 'succeeded',
            actor: auditActor(actor),
            target: { type: 'unit', id: hold.unitId },
            reason: input.reason,
            context,
          },
          { session },
        );
        return result;
      });
      await this.syncApproval(actor, submitted.requestId, context);
      return toHold((await this.holds.findOne({ holdId }).lean<HoldDocument>().exec()) ?? updated);
    }
    return toHold(await this.applyExtension(actor, hold, input.reason, context));
  }

  private async applyExtension(
    actor: ActorContext,
    hold: HoldDocument,
    reason: string,
    context: RequestContext,
    session?: ClientSession,
  ): Promise<HoldDocument> {
    const hours = await this.hours();
    const work = async (tx: ClientSession) => {
      const now = this.now();
      // Extended from whichever is later, so an extension never shortens a hold.
      const from = hold.expiresAt.getTime() > now.getTime() ? hold.expiresAt : now;
      const result = await this.holds
        .findOneAndUpdate(
          { holdId: hold.holdId, state: 'active' },
          {
            $set: { expiresAt: new Date(from.getTime() + hours * HOUR_MS), updatedAt: now },
            $unset: { extensionApprovalRequestId: '' },
            $inc: { version: 1, extensions: 1 },
          },
          { returnDocument: 'after', session: tx },
        )
        .lean<HoldDocument>()
        .exec();
      if (!result) throw conflict('HOLD_NOT_ACTIVE');
      await this.options.audit.record(
        {
          action: INVENTORY_AUDIT_ACTIONS.holdExtended,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'unit', id: hold.unitId },
          changes: buildChangeSummary(
            { expiresAt: iso(hold.expiresAt) },
            { expiresAt: iso(result.expiresAt) },
          ),
          reason,
          context,
        },
        { session: tx },
      );
      return result;
    };
    return session ? work(session) : withTransaction(this.connection, work);
  }

  /** Act on a decided extension request. */
  async syncApproval(
    actor: ActorContext,
    requestId: string,
    context: RequestContext,
  ): Promise<'extended' | 'refused' | 'unchanged'> {
    assertSafeFilter({ requestId });
    const hold = await this.holds
      .findOne({ extensionApprovalRequestId: requestId, state: 'active' })
      .lean<HoldDocument>()
      .exec();
    if (!hold) return 'unchanged';
    const state = await this.options.approvals?.state(requestId);
    if (state === 'approved') {
      await this.applyExtension(actor, hold, 'extension approved', context);
      return 'extended';
    }
    if (state === 'rejected' || state === 'cancelled' || state === 'expired') {
      await this.holds
        .updateOne(
          { holdId: hold.holdId, extensionApprovalRequestId: requestId },
          { $unset: { extensionApprovalRequestId: '' }, $set: { updatedAt: this.now() } },
        )
        .exec();
      return 'refused';
    }
    return 'unchanged';
  }

  /**
   * Hand a hold's unit to a reservation, inside the reservation's transaction (INV-HOLD-001 →
   * SALE-RESERVE). The unit stays `held`; only who holds it changes, and only if this hold still does.
   */
  async convert(
    actor: ActorContext,
    holdId: string,
    reservationId: string,
    expected: { unitId: string },
    context: RequestContext,
    session: ClientSession,
  ): Promise<void> {
    assertSafeFilter({ holdId });
    const hold = await this.holds
      .findOneAndUpdate(
        { holdId, state: 'active', unitId: expected.unitId },
        {
          $set: { state: 'converted', reservationId, updatedAt: this.now() },
          $unset: { extensionApprovalRequestId: '' },
          $inc: { version: 1 },
        },
        { returnDocument: 'after', session },
      )
      .lean<HoldDocument>()
      .exec();
    if (!hold) throw conflict('HOLD_NOT_ACTIVE', ['holdId']);
    const unit = await this.units
      .findOneAndUpdate(
        { unitId: hold.unitId, status: 'held', heldByHoldId: holdId },
        {
          $set: { heldByReservationId: reservationId, updatedAt: this.now() },
          $unset: { heldByHoldId: '' },
          $inc: { version: 1 },
        },
        { returnDocument: 'after', session },
      )
      .lean<UnitDocument>()
      .exec();
    if (!unit) throw conflict('HOLD_NOT_ACTIVE', ['holdId']);
    await this.unitEvents.create(
      [
        {
          eventId: newId('uev'),
          unitId: unit.unitId,
          projectId: unit.projectId,
          kind: 'statusChanged',
          fromStatus: 'held',
          toStatus: 'held',
          reason: 'hold converted into a reservation',
          sourceType: 'reservation',
          sourceId: reservationId,
          actorAccountId: actor.accountId,
          occurredAt: this.now(),
        },
      ],
      { session },
    );
    await this.options.audit.record(
      {
        action: INVENTORY_AUDIT_ACTIONS.holdConverted,
        outcome: 'succeeded',
        actor: auditActor(actor),
        target: { type: 'unit', id: unit.unitId },
        changes: buildChangeSummary({ holdId }, { reservationId }),
        context,
      },
      { session },
    );
  }

  /** The unscoped fact, for sales inside its own transaction. */
  async findUnscoped(holdId: string, session?: ClientSession): Promise<Hold | undefined> {
    assertSafeFilter({ holdId });
    const document = await this.holds
      .findOne({ holdId })
      .session(session ?? null)
      .lean<HoldDocument>()
      .exec();
    return document ? toHold(document) : undefined;
  }

  /** The maintenance sweep: expire overdue holds, settle decided extension requests. */
  async sweep(
    actor: ActorContext,
    context: RequestContext,
  ): Promise<{ expired: number; extended: number }> {
    let extended = 0;
    const waiting = await this.holds
      .find({ state: 'active', extensionApprovalRequestId: { $exists: true } })
      .limit(200)
      .lean<HoldDocument[]>()
      .exec();
    for (const hold of waiting) {
      try {
        if (
          hold.extensionApprovalRequestId &&
          (await this.syncApproval(actor, hold.extensionApprovalRequestId, context)) === 'extended'
        ) {
          extended += 1;
        }
      } catch (error) {
        this.options.logger.warn(
          { err: error, code: 'HOLD_APPROVAL_SYNC_SKIPPED', holdId: hold.holdId },
          'A hold extension could not be settled; the sweep continued.',
        );
      }
    }
    let expired = 0;
    const overdue = await this.holds
      .find({ state: 'active', expiresAt: { $lt: this.now() } })
      .sort({ expiresAt: 1 })
      .limit(200)
      .lean<HoldDocument[]>()
      .exec();
    for (const hold of overdue) {
      // An extension waiting for a decision keeps the unit until it is decided.
      if (hold.extensionApprovalRequestId) continue;
      try {
        await this.end(actor, hold, 'expired', `hold expired at ${iso(hold.expiresAt)}`, context);
        expired += 1;
      } catch (error) {
        this.options.logger.warn(
          { err: error, code: 'HOLD_EXPIRY_SKIPPED', holdId: hold.holdId },
          'A hold could not be expired; the sweep continued.',
        );
      }
    }
    return { expired, extended };
  }
}
