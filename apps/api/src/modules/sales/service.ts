import {
  ContractSchema,
  InstallmentSchema,
  ReservationSchema,
  SALES_AUDIT_ACTIONS,
  addDays,
  addMoney,
  buildInstallmentSchedule,
  canTransitionContract,
  canTransitionReservation,
  compareMoney,
  divideMoney,
  isNegativeMoney,
  money,
  multiplyMoney,
  subtractMoney,
  type ActorContext,
  type BusinessDate,
  type CancelContract,
  type Contract,
  type ContractPage,
  type ContractQuery,
  type CreateContract,
  type CreateReservation,
  type CustomerFinancialSummary,
  type Installment,
  type InstallmentPage,
  type InstallmentQuery,
  type Money,
  type PaymentPlan,
  type Reservation,
  type ReservationPage,
  type ReservationQuery,
  type ReservationState,
  type SchedulePreview,
  type ScheduleRow,
} from '@alola/contracts';
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
import {
  contractModel,
  counterModel,
  installmentModel,
  reservationModel,
  type ContractDocument,
  type InstallmentDocument,
  type ReservationDocument,
  type StoredMoney,
  type StoredPaymentPlan,
} from './model';

/**
 * Sales service — `SALE-*` demonstration slice (ADR-0025).
 *
 * Every operation that commits a unit runs in **one transaction** with the record that commits it. A
 * reservation and the hold it takes land together or neither does; a contract, its schedule, the unit
 * becoming `contracted` and the reservation becoming `converted` are one fact, not four. The failure
 * this prevents is the worst one this domain has: a unit held by a reservation that does not exist, or
 * a contract whose unit is still on sale.
 *
 * The money rule is equally blunt: **a schedule that does not reconcile is never stored.** The builder
 * asserts it, and this service asserts it again against the rows it is about to insert.
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

/**
 * What sales needs from inventory. A port, so the unit state machine stays inventory's business and
 * this module can be tested without it — and so the dependency is declared at the composition root.
 */
export interface UnitPort {
  find(
    unitId: string,
    session?: ClientSession,
  ): Promise<
    | {
        unitId: string;
        projectId: string;
        legalEntityId: string;
        branchId: string;
        code: string;
        status: string;
        currentPrice?: Money;
      }
    | undefined
  >;
  changeStatus(
    actor: ActorContext,
    change: {
      unitId: string;
      from: string;
      to: string;
      reason: string;
      sourceType?: string;
      sourceId?: string;
      reservationId?: string | null;
      contractId?: string | null;
    },
    context: RequestContext,
    session?: ClientSession,
  ): Promise<unknown>;
}

/** What sales needs from CRM: the customer behind a reservation, and the lead's pipeline stage. */
export interface CrmPort {
  findCustomer(
    customerId: string,
    session?: ClientSession,
  ): Promise<{ customerId: string; legalEntityId: string } | undefined>;
  advanceLead?(
    actor: ActorContext,
    leadId: string,
    to: 'reservation' | 'won',
    reason: string,
    context: RequestContext,
    session: ClientSession,
  ): Promise<void>;
}

/**
 * The approval engine, as a port.
 *
 * `submit` returns `undefined` when **no policy applies**, which is the normal case until `SD-02`
 * supplies one. That is deliberate: the absence of a configured control is not an approval, and it is
 * not an error either — the reservation simply proceeds as a draft that a person confirms.
 */
export interface ApprovalPort {
  submit(
    actor: ActorContext,
    input: {
      operationType: string;
      source: { type: string; id: string };
      scope: Record<string, string | undefined>;
      context: { amount?: Money; percentage?: string; isException?: boolean };
      summary: { label: { ar: string; en: string }; value: string }[];
      idempotencyKey: string;
    },
    context: RequestContext,
  ): Promise<{ requestId: string; state: string } | undefined>;
  state(requestId: string): Promise<string | undefined>;
}

export class SalesNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(readonly what: string) {
    super('NOT_FOUND');
    this.name = 'SalesNotFoundError';
  }
}

export class SalesConflictError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly what: string) {
    super('CONFLICT');
    this.name = 'SalesConflictError';
  }
}

export class SalesValidationError extends Error {
  readonly code = 'VALIDATION_FAILED';
  constructor(readonly what: string) {
    super('VALIDATION_FAILED');
    this.name = 'SalesValidationError';
  }
}

/** A replay of an idempotency key carrying different input. Never a silent no-op. */
export class IdempotencyConflictError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly key: string) {
    super('CONFLICT');
    this.name = 'IdempotencyConflictError';
  }
}

export const SALES_SCOPE_FIELDS: ScopeFieldMap = {
  owner: 'salesOwnerAccountId',
  assignee: 'salesOwnerAccountId',
  team: 'teamId',
  department: 'departmentId',
  branch: 'branchId',
  project: 'projectId',
  legalEntity: 'legalEntityId',
};

/** Installments carry no department, so a department-scoped actor resolves through the branch. */
export const INSTALLMENT_SCOPE_FIELDS: ScopeFieldMap = {
  owner: 'salesOwnerAccountId',
  assignee: 'salesOwnerAccountId',
  team: 'teamId',
  branch: 'branchId',
  project: 'projectId',
  legalEntity: 'legalEntityId',
};

const DISCOUNT_APPROVAL_OPERATION = 'sales.reservation.discount';

const iso = (date: Date) => date.toISOString();

function toMoney(stored: StoredMoney): Money {
  return { amount: fromDecimal128(stored.amount), currency: stored.currency };
}

function fromMoney(value: Money): StoredMoney {
  return { amount: toDecimal128(value.amount), currency: value.currency };
}

function toPlan(stored: StoredPaymentPlan): PaymentPlan {
  return {
    downPayment: toMoney(stored.downPayment),
    installmentCount: stored.installmentCount,
    frequency: stored.frequency,
    firstDueOn: stored.firstDueOn as BusinessDate,
    ...(stored.finalPayment ? { finalPayment: toMoney(stored.finalPayment) } : {}),
  };
}

function fromPlan(plan: PaymentPlan): StoredPaymentPlan {
  return {
    downPayment: fromMoney(plan.downPayment),
    installmentCount: plan.installmentCount,
    frequency: plan.frequency,
    firstDueOn: plan.firstDueOn,
    ...(plan.finalPayment ? { finalPayment: fromMoney(plan.finalPayment) } : {}),
  };
}

function toReservation(d: ReservationDocument): Reservation {
  return ReservationSchema.parse({
    reservationId: d.reservationId,
    reservationNumber: d.reservationNumber,
    customerId: d.customerId,
    ...(d.leadId ? { leadId: d.leadId } : {}),
    unitId: d.unitId,
    projectId: d.projectId,
    reservedOn: d.reservedOn,
    expiresOn: d.expiresOn,
    reservationAmount: toMoney(d.reservationAmount),
    agreedPrice: toMoney(d.agreedPrice),
    discountPercentage: d.discountPercentage,
    paymentPlan: toPlan(d.paymentPlan),
    salesOwnerAccountId: d.salesOwnerAccountId,
    legalEntityId: d.legalEntityId,
    branchId: d.branchId,
    ...(d.departmentId ? { departmentId: d.departmentId } : {}),
    ...(d.teamId ? { teamId: d.teamId } : {}),
    state: d.state,
    ...(d.approvalRequestId ? { approvalRequestId: d.approvalRequestId } : {}),
    ...(d.contractId ? { contractId: d.contractId } : {}),
    ...(d.cancellationReason ? { cancellationReason: d.cancellationReason } : {}),
    ...(d.notes ? { notes: d.notes } : {}),
    version: d.version,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

function toContract(d: ContractDocument): Contract {
  return ContractSchema.parse({
    contractId: d.contractId,
    contractNumber: d.contractNumber,
    customerId: d.customerId,
    unitId: d.unitId,
    projectId: d.projectId,
    reservationId: d.reservationId,
    contractedOn: d.contractedOn,
    totalPrice: toMoney(d.totalPrice),
    reservationAmount: toMoney(d.reservationAmount),
    paymentPlan: toPlan(d.paymentPlan),
    outstandingAmount: toMoney(d.outstandingAmount),
    paidAmount: toMoney(d.paidAmount),
    salesOwnerAccountId: d.salesOwnerAccountId,
    legalEntityId: d.legalEntityId,
    branchId: d.branchId,
    ...(d.departmentId ? { departmentId: d.departmentId } : {}),
    ...(d.teamId ? { teamId: d.teamId } : {}),
    state: d.state,
    ...(d.cancellationReason ? { cancellationReason: d.cancellationReason } : {}),
    ...(d.documentRef ? { documentRef: d.documentRef } : {}),
    version: d.version,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

function toInstallment(d: InstallmentDocument): Installment {
  return InstallmentSchema.parse({
    installmentId: d.installmentId,
    contractId: d.contractId,
    customerId: d.customerId,
    unitId: d.unitId,
    projectId: d.projectId,
    sequence: d.sequence,
    kind: d.kind,
    dueOn: d.dueOn,
    amount: toMoney(d.amount),
    paidAmount: toMoney(d.paidAmount),
    remainingAmount: toMoney(d.remainingAmount),
    state: d.state,
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

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | undefined {
  try {
    const [text, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!text || !id) return undefined;
    const createdAt = new Date(text);
    return Number.isNaN(createdAt.getTime()) ? undefined : { createdAt, id };
  } catch {
    return undefined;
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: unknown })?.code === 11000;
}

export interface SalesServiceOptions {
  connection: Connection;
  logger: Logger;
  audit: AuditRecorder;
  units: UnitPort;
  crm: CrmPort;
  /** Absent means no approval control is configured, which is the state until `SD-02` supplies one. */
  approvals?: ApprovalPort;
  today: () => BusinessDate;
}

export class SalesService {
  private readonly connection;
  private readonly reservations;
  private readonly contracts;
  private readonly installments;
  private readonly counters;

  constructor(private readonly options: SalesServiceOptions) {
    this.connection = options.connection;
    this.reservations = reservationModel(options.connection);
    this.contracts = contractModel(options.connection);
    this.installments = installmentModel(options.connection);
    this.counters = counterModel(options.connection);
  }

  /* ------------------------------------------------------------ numbering */

  /**
   * The next number in a readable series, allocated atomically.
   *
   * `findOneAndUpdate` with `$inc` and `upsert` is a single document operation, so two concurrent
   * callers cannot receive the same number even without a transaction. Deliberately **not** derived
   * from a count: a count would reuse a number the moment anything is filtered out.
   */
  private async nextNumber(prefix: string, session?: ClientSession): Promise<string> {
    const year = new Date().getUTCFullYear();
    const key = `${prefix}-${year}`;
    const counter = await this.counters
      .findOneAndUpdate(
        { key },
        { $inc: { value: 1 }, $setOnInsert: { key } },
        { upsert: true, returnDocument: 'after', ...(session ? { session } : {}) },
      )
      .lean<{ value: number }>()
      .exec();
    const value = counter?.value ?? 1;
    return `${prefix}-${year}-${String(value).padStart(5, '0')}`;
  }

  /* ------------------------------------------------------------- preview */

  previewSchedule(total: Money, plan: PaymentPlan): SchedulePreview {
    const rows = buildInstallmentSchedule(total, plan);
    const rowsTotal = rows.reduce<Money>(
      (running, row) => addMoney(running, row.amount),
      money('0', total.currency),
    );
    return { rows, total, rowsTotal };
  }

  /* --------------------------------------------------------- reservations */

  private async replayReservation(
    idempotencyKey: string,
    print: string,
  ): Promise<Reservation | undefined> {
    const existing = await this.reservations
      .findOne({ idempotencyKey })
      .lean<ReservationDocument>()
      .exec();
    if (!existing) return undefined;
    if (existing.idempotencyFingerprint !== print)
      throw new IdempotencyConflictError(idempotencyKey);
    return toReservation(existing);
  }

  async createReservation(
    actor: ActorContext,
    input: CreateReservation,
    context: RequestContext,
  ): Promise<{ reservation: Reservation; replayed: boolean }> {
    const print = fingerprint({
      customerId: input.customerId,
      unitId: input.unitId,
      agreedPrice: input.agreedPrice,
      reservationAmount: input.reservationAmount,
      paymentPlan: input.paymentPlan,
    });
    const replay = await this.replayReservation(input.idempotencyKey, print);
    if (replay) return { reservation: replay, replayed: true };

    const unit = await this.options.units.find(input.unitId);
    if (!unit) throw new SalesNotFoundError('unit');
    const customer = await this.options.crm.findCustomer(input.customerId);
    if (!customer) throw new SalesNotFoundError('customer');
    if (customer.legalEntityId !== unit.legalEntityId) {
      // A customer of one legal entity cannot reserve another's unit: the contract would belong to
      // neither, and the money would post to the wrong books.
      throw new SalesValidationError('legalEntityMismatch');
    }
    if (unit.status !== 'available') throw new SalesConflictError('unitNotAvailable');
    if (isNegativeMoney(input.agreedPrice) || isNegativeMoney(input.reservationAmount)) {
      throw new SalesValidationError('negativeAmount');
    }
    if (compareMoney(input.reservationAmount, input.agreedPrice) > 0) {
      throw new SalesValidationError('reservationAbovePrice');
    }

    // Validate the plan **before** anything is written: a plan that cannot produce a reconciling
    // schedule must not be able to hold a unit while someone works out why.
    buildInstallmentSchedule(input.agreedPrice, input.paymentPlan);

    const listPrice = unit.currentPrice;
    if (listPrice && listPrice.currency !== input.agreedPrice.currency) {
      throw new SalesValidationError('currencyMismatch');
    }
    const discountPercentage =
      listPrice && compareMoney(listPrice, money('0', listPrice.currency)) > 0
        ? divideMoney(
            multiplyMoney(subtractMoney(listPrice, input.agreedPrice), '100'),
            listPrice.amount,
            4,
          ).amount
        : '0';

    const reservationId = newId('rsv');
    const today = this.options.today();
    const expiresOn = addDays(today, input.holdDays);

    let reservation: Reservation;
    try {
      reservation = await withTransaction(this.connection, async (session) => {
        const reservationNumber = await this.nextNumber('RSV', session);
        const now = new Date();
        const document: ReservationDocument = {
          reservationId,
          reservationNumber,
          customerId: input.customerId,
          ...(input.leadId ? { leadId: input.leadId } : {}),
          unitId: unit.unitId,
          projectId: unit.projectId,
          reservedOn: today,
          expiresOn,
          reservationAmount: fromMoney(input.reservationAmount),
          agreedPrice: fromMoney(input.agreedPrice),
          discountPercentage,
          paymentPlan: fromPlan(input.paymentPlan),
          salesOwnerAccountId: actor.accountId,
          legalEntityId: unit.legalEntityId,
          branchId: unit.branchId,
          ...(actor.scope.teamIds[0] ? { teamId: actor.scope.teamIds[0] } : {}),
          ...(actor.scope.departmentIds[0] ? { departmentId: actor.scope.departmentIds[0] } : {}),
          state: 'draft',
          idempotencyKey: input.idempotencyKey,
          idempotencyFingerprint: print,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        const [created] = await this.reservations.create([document], { session });
        if (!created) throw new SalesConflictError('reservationNotCreated');

        // The hold and the reservation commit together. This is the whole point of the transaction:
        // a hold without a reservation is a unit nobody can sell, and the reverse is a double sale.
        await this.options.units.changeStatus(
          actor,
          {
            unitId: unit.unitId,
            from: 'available',
            to: 'held',
            reason: `reservation ${reservationNumber}`,
            sourceType: 'reservation',
            sourceId: reservationId,
            reservationId,
          },
          context,
          session,
        );

        if (input.leadId && this.options.crm.advanceLead) {
          await this.options.crm.advanceLead(
            actor,
            input.leadId,
            'reservation',
            `reservation ${reservationNumber}`,
            context,
            session,
          );
        }

        await this.options.audit.record(
          {
            action: SALES_AUDIT_ACTIONS.reservationCreated,
            outcome: 'succeeded',
            actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
            target: { type: 'reservation', id: reservationId },
            changes: buildChangeSummary(undefined, {
              reservationNumber,
              unitId: unit.unitId,
              customerId: input.customerId,
              discountPercentage,
            }),
            context,
          },
          { session },
        );
        return toReservation(created.toObject());
      });
    } catch (error) {
      // A racing retry of the same key: return the original rather than reporting a failure.
      if (isDuplicateKey(error)) {
        const stored = await this.replayReservation(input.idempotencyKey, print);
        if (stored) return { reservation: stored, replayed: true };
        throw new SalesConflictError('unitAlreadyReserved');
      }
      throw error;
    }

    // Approval is requested **after** the hold commits, so a provider or policy failure cannot leave
    // a unit half-held. A reservation with no applicable policy stays a draft, which is correct: the
    // absence of a configured control is not an approval (ADR-0024).
    const approved = await this.requestDiscountApproval(actor, reservation, context);
    return { reservation: approved, replayed: false };
  }

  private async requestDiscountApproval(
    actor: ActorContext,
    reservation: Reservation,
    context: RequestContext,
  ): Promise<Reservation> {
    if (!this.options.approvals) return reservation;
    if (reservation.discountPercentage === '0') return reservation;

    const submitted = await this.options.approvals.submit(
      actor,
      {
        operationType: DISCOUNT_APPROVAL_OPERATION,
        source: { type: 'reservation', id: reservation.reservationId },
        scope: {
          branchId: reservation.branchId,
          projectId: reservation.projectId,
          legalEntityId: reservation.legalEntityId,
          ...(reservation.teamId ? { teamId: reservation.teamId } : {}),
          ...(reservation.departmentId ? { departmentId: reservation.departmentId } : {}),
        },
        context: {
          amount: reservation.agreedPrice,
          percentage: reservation.discountPercentage,
        },
        summary: [
          {
            label: { ar: 'رقم الحجز', en: 'Reservation number' },
            value: reservation.reservationNumber,
          },
          {
            label: { ar: 'نسبة الخصم', en: 'Discount percentage' },
            value: reservation.discountPercentage,
          },
        ],
        idempotencyKey: `reservation-discount-${reservation.reservationId}`,
      },
      context,
    );
    if (!submitted) return reservation;

    const updated = await this.reservations
      .findOneAndUpdate(
        { reservationId: reservation.reservationId, state: 'draft' },
        {
          $set: {
            state: 'pendingApproval',
            approvalRequestId: submitted.requestId,
            updatedAt: new Date(),
          },
          $inc: { version: 1 },
        },
        { new: true },
      )
      .lean<ReservationDocument>()
      .exec();
    if (!updated) return reservation;

    await this.options.audit.record({
      action: SALES_AUDIT_ACTIONS.reservationApprovalRequested,
      outcome: 'succeeded',
      actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
      target: { type: 'reservation', id: reservation.reservationId },
      reason: `discount ${reservation.discountPercentage}%`,
      context,
    });
    return toReservation(updated);
  }

  async confirmReservation(
    actor: ActorContext,
    reservationId: string,
    context: RequestContext,
  ): Promise<Reservation> {
    const current = await this.getReservation(actor, reservationId);

    /**
     * Maker-checker, enforced where it matters: a reservation whose discount is awaiting a decision
     * cannot be confirmed by anyone, including the person who raised it. The approval engine owns the
     * decision; this module only observes the outcome and acts (ADR-0024 §2).
     */
    if (current.state === 'pendingApproval') {
      const state = current.approvalRequestId
        ? await this.options.approvals?.state(current.approvalRequestId)
        : undefined;
      if (state !== 'approved') {
        await this.options.audit.record({
          action: SALES_AUDIT_ACTIONS.reservationRefused,
          outcome: 'denied',
          actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
          target: { type: 'reservation', id: reservationId },
          reason: `confirmation refused: approval is ${state ?? 'unresolved'}`,
          context,
        });
        throw new SalesConflictError('approvalNotGranted');
      }
    } else if (current.state !== 'draft') {
      throw new SalesConflictError('notConfirmable');
    }

    return this.moveReservation(actor, current, 'confirmed', context, {
      unitFrom: 'held',
      unitTo: 'reserved',
      reason: `reservation ${current.reservationNumber} confirmed`,
      auditAction: SALES_AUDIT_ACTIONS.reservationConfirmed,
    });
  }

  async cancelReservation(
    actor: ActorContext,
    reservationId: string,
    reason: string,
    context: RequestContext,
  ): Promise<Reservation> {
    const current = await this.getReservation(actor, reservationId);
    return this.moveReservation(actor, current, 'cancelled', context, {
      unitFrom: current.state === 'confirmed' ? 'reserved' : 'held',
      unitTo: 'available',
      reason,
      auditAction: SALES_AUDIT_ACTIONS.reservationCancelled,
      cancellationReason: reason,
    });
  }

  private async moveReservation(
    actor: ActorContext,
    current: Reservation,
    to: ReservationState,
    context: RequestContext,
    options: {
      unitFrom: string;
      unitTo: string;
      reason: string;
      auditAction: string;
      cancellationReason?: string;
    },
  ): Promise<Reservation> {
    if (!canTransitionReservation(current.state, to)) {
      await this.options.audit.record({
        action: SALES_AUDIT_ACTIONS.reservationRefused,
        outcome: 'denied',
        actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
        target: { type: 'reservation', id: current.reservationId },
        reason: `refused transition ${current.state} -> ${to}`,
        context,
      });
      throw new SalesConflictError('invalidTransition');
    }

    return withTransaction(this.connection, async (session) => {
      const updated = await this.reservations
        .findOneAndUpdate(
          { reservationId: current.reservationId, state: current.state },
          {
            $set: {
              state: to,
              updatedAt: new Date(),
              ...(options.cancellationReason
                ? { cancellationReason: options.cancellationReason }
                : {}),
            },
            $inc: { version: 1 },
          },
          { new: true, session },
        )
        .lean<ReservationDocument>()
        .exec();
      // The state is in the filter, so a concurrent move loses instead of overwriting.
      if (!updated) throw new SalesConflictError('invalidTransition');

      await this.options.units.changeStatus(
        actor,
        {
          unitId: current.unitId,
          from: options.unitFrom,
          to: options.unitTo,
          reason: options.reason,
          sourceType: 'reservation',
          sourceId: current.reservationId,
          ...(options.unitTo === 'available' ? { reservationId: null } : {}),
          ...(options.unitTo === 'reserved' ? { reservationId: current.reservationId } : {}),
        },
        context,
        session,
      );

      await this.options.audit.record(
        {
          action: options.auditAction,
          outcome: 'succeeded',
          actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
          target: { type: 'reservation', id: current.reservationId },
          changes: buildChangeSummary({ state: current.state }, { state: to }),
          reason: options.reason,
          context,
        },
        { session },
      );
      return toReservation(updated);
    });
  }

  /**
   * Release holds whose deadline has passed. Idempotent: a second run finds nothing to do, because
   * the state is part of every update filter.
   */
  async expireReservations(
    actor: ActorContext,
    context: RequestContext,
  ): Promise<{ expired: number }> {
    const today = this.options.today();
    const candidates = await this.reservations
      .find({
        state: { $in: ['draft', 'pendingApproval', 'confirmed'] },
        expiresOn: { $lt: today },
      })
      .limit(200)
      .lean<ReservationDocument[]>()
      .exec();

    let expired = 0;
    for (const document of candidates) {
      try {
        await this.moveReservation(actor, toReservation(document), 'expired', context, {
          unitFrom: document.state === 'confirmed' ? 'reserved' : 'held',
          unitTo: 'available',
          reason: `hold expired on ${document.expiresOn}`,
          auditAction: SALES_AUDIT_ACTIONS.reservationExpired,
          cancellationReason: `hold expired on ${document.expiresOn}`,
        });
        expired += 1;
      } catch (error) {
        // One reservation that will not release must not stop the rest of the sweep.
        this.options.logger.warn(
          { err: error, code: 'RESERVATION_EXPIRY_SKIPPED', reservationId: document.reservationId },
          'A reservation could not be expired; the sweep continued.',
        );
      }
    }
    return { expired };
  }

  async listReservations(actor: ActorContext, query: ReservationQuery): Promise<ReservationPage> {
    const requested: Record<string, unknown> = {};
    for (const key of [
      'state',
      'projectId',
      'customerId',
      'unitId',
      'salesOwnerAccountId',
    ] as const) {
      const value = query[key];
      if (value !== undefined) requested[key] = value;
    }
    assertSafeFilter(requested);
    const filter = withScope(buildScopeFilter(actor, SALES_SCOPE_FIELDS), requested);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const paged = cursor
      ? {
          $and: [
            filter,
            {
              $or: [
                { createdAt: { $lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, reservationId: { $lt: cursor.id } },
              ],
            },
          ],
        }
      : filter;
    const [documents, total] = await Promise.all([
      this.reservations
        .find(paged)
        .sort({ createdAt: -1, reservationId: -1 })
        .limit(query.limit + 1)
        .lean<ReservationDocument[]>()
        .exec(),
      this.reservations.countDocuments(filter).exec(),
    ]);
    const page = documents.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toReservation),
      total,
      limit: query.limit,
      ...(documents.length > query.limit && last
        ? { nextCursor: encodeCursor(last.createdAt, last.reservationId) }
        : {}),
    };
  }

  async getReservation(actor: ActorContext, reservationId: string): Promise<Reservation> {
    assertSafeFilter({ reservationId });
    const filter = withScope(buildScopeFilter(actor, SALES_SCOPE_FIELDS), { reservationId });
    const document = await this.reservations.findOne(filter).lean<ReservationDocument>().exec();
    if (!document) throw new SalesNotFoundError('reservation');
    return toReservation(document);
  }

  /* ------------------------------------------------------------ contracts */

  private async replayContract(
    idempotencyKey: string,
    print: string,
  ): Promise<Contract | undefined> {
    const existing = await this.contracts
      .findOne({ idempotencyKey })
      .lean<ContractDocument>()
      .exec();
    if (!existing) return undefined;
    if (existing.idempotencyFingerprint !== print)
      throw new IdempotencyConflictError(idempotencyKey);
    return toContract(existing);
  }

  /**
   * Turn a confirmed reservation into a contract, its schedule, and a contracted unit — in one
   * transaction.
   *
   * The reservation amount is **credited**: it is money already received, so the schedule is built
   * over the agreed price and the reservation amount is recorded as paid against the earliest rows.
   * Building the schedule over "price minus reservation" instead would make the contract total
   * disagree with the unit price on every printed document.
   */
  async createContract(
    actor: ActorContext,
    input: CreateContract,
    context: RequestContext,
  ): Promise<{ contract: Contract; installments: Installment[]; replayed: boolean }> {
    const print = fingerprint({
      reservationId: input.reservationId,
      contractedOn: input.contractedOn,
      paymentPlan: input.paymentPlan ?? null,
    });
    const replay = await this.replayContract(input.idempotencyKey, print);
    if (replay) {
      return {
        contract: replay,
        installments: await this.listContractInstallments(actor, replay.contractId),
        replayed: true,
      };
    }

    const reservation = await this.getReservation(actor, input.reservationId);
    if (reservation.state !== 'confirmed') throw new SalesConflictError('reservationNotConfirmed');

    const plan = input.paymentPlan ?? reservation.paymentPlan;
    const total = reservation.agreedPrice;
    const rows = buildInstallmentSchedule(total, plan);
    this.assertReconciles(rows, total);

    const contractId = newId('ctr');
    try {
      return await withTransaction(this.connection, async (session) => {
        const contractNumber = await this.nextNumber('CTR', session);
        const now = new Date();

        const stored = this.applyReservationCredit(rows, reservation.reservationAmount);
        const paidAmount = stored.reduce<Money>(
          (running, row) => addMoney(running, row.paidAmount),
          money('0', total.currency),
        );
        const outstanding = subtractMoney(total, paidAmount);

        const contractDocument: ContractDocument = {
          contractId,
          contractNumber,
          customerId: reservation.customerId,
          unitId: reservation.unitId,
          projectId: reservation.projectId,
          reservationId: reservation.reservationId,
          contractedOn: input.contractedOn,
          totalPrice: fromMoney(total),
          reservationAmount: fromMoney(reservation.reservationAmount),
          paymentPlan: fromPlan(plan),
          outstandingAmount: fromMoney(outstanding),
          paidAmount: fromMoney(paidAmount),
          salesOwnerAccountId: reservation.salesOwnerAccountId,
          legalEntityId: reservation.legalEntityId,
          branchId: reservation.branchId,
          ...(reservation.departmentId ? { departmentId: reservation.departmentId } : {}),
          ...(reservation.teamId ? { teamId: reservation.teamId } : {}),
          state: 'active',
          idempotencyKey: input.idempotencyKey,
          idempotencyFingerprint: print,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        const [createdContract] = await this.contracts.create([contractDocument], { session });
        if (!createdContract) throw new SalesConflictError('contractNotCreated');

        const installmentDocuments: InstallmentDocument[] = stored.map((row) => ({
          installmentId: newId('inst'),
          contractId,
          customerId: reservation.customerId,
          unitId: reservation.unitId,
          projectId: reservation.projectId,
          sequence: row.sequence,
          kind: row.kind,
          dueOn: row.dueOn,
          amount: fromMoney(row.amount),
          paidAmount: fromMoney(row.paidAmount),
          remainingAmount: fromMoney(row.remainingAmount),
          state: row.state,
          legalEntityId: reservation.legalEntityId,
          branchId: reservation.branchId,
          ...(reservation.teamId ? { teamId: reservation.teamId } : {}),
          salesOwnerAccountId: reservation.salesOwnerAccountId,
          version: 1,
          createdAt: now,
          updatedAt: now,
        }));
        // `ordered: true` is required by mongoose when creating several documents in a session, and
        // it is what we want anyway: the rows are inserted in sequence order.
        const createdInstallments = await this.installments.create(installmentDocuments, {
          session,
          ordered: true,
        });

        await this.reservations
          .updateOne(
            { reservationId: reservation.reservationId, state: 'confirmed' },
            { $set: { state: 'converted', contractId, updatedAt: now }, $inc: { version: 1 } },
            { session },
          )
          .exec();

        await this.options.units.changeStatus(
          actor,
          {
            unitId: reservation.unitId,
            from: 'reserved',
            to: 'contracted',
            reason: `contract ${contractNumber}`,
            sourceType: 'contract',
            sourceId: contractId,
            contractId,
            reservationId: null,
          },
          context,
          session,
        );

        if (reservation.leadId && this.options.crm.advanceLead) {
          await this.options.crm.advanceLead(
            actor,
            reservation.leadId,
            'won',
            `contract ${contractNumber}`,
            context,
            session,
          );
        }

        await this.options.audit.record(
          {
            action: SALES_AUDIT_ACTIONS.contractCreated,
            outcome: 'succeeded',
            actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
            target: { type: 'contract', id: contractId },
            changes: buildChangeSummary(undefined, {
              contractNumber,
              reservationId: reservation.reservationId,
              unitId: reservation.unitId,
              installments: String(stored.length),
            }),
            context,
          },
          { session },
        );
        await this.options.audit.record(
          {
            action: SALES_AUDIT_ACTIONS.scheduleGenerated,
            outcome: 'succeeded',
            actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
            target: { type: 'contract', id: contractId },
            reason: `${stored.length} rows reconciling to the contract total`,
            context,
          },
          { session },
        );

        return {
          contract: toContract(createdContract.toObject()),
          installments: createdInstallments.map((document) => toInstallment(document.toObject())),
          replayed: false,
        };
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        const stored = await this.replayContract(input.idempotencyKey, print);
        if (stored) {
          return {
            contract: stored,
            installments: await this.listContractInstallments(actor, stored.contractId),
            replayed: true,
          };
        }
        throw new SalesConflictError('contractAlreadyExists');
      }
      throw error;
    }
  }

  /** The rows a schedule produces must sum to the total. Asserted again before anything is stored. */
  private assertReconciles(rows: ScheduleRow[], total: Money): void {
    const sum = rows.reduce<Money>(
      (running, row) => addMoney(running, row.amount),
      money('0', total.currency),
    );
    if (compareMoney(sum, total) !== 0) throw new SalesValidationError('scheduleDoesNotReconcile');
    for (const row of rows) {
      if (isNegativeMoney(row.amount)) throw new SalesValidationError('negativeInstallment');
    }
  }

  /**
   * Apply money already received on the reservation to the earliest rows.
   *
   * Earliest-first because that is what a customer expects when they look at the schedule: the
   * deposit they paid should show against the deposit line, not spread as a fraction across 60 rows.
   */
  private applyReservationCredit(
    rows: ScheduleRow[],
    reservationAmount: Money,
  ): (ScheduleRow & { paidAmount: Money; remainingAmount: Money; state: Installment['state'] })[] {
    let credit = reservationAmount;
    const zero = money('0', reservationAmount.currency);
    return rows.map((row) => {
      const applied = compareMoney(credit, row.amount) >= 0 ? row.amount : credit;
      credit = subtractMoney(credit, applied);
      const remaining = subtractMoney(row.amount, applied);
      const state: Installment['state'] =
        compareMoney(remaining, zero) === 0
          ? 'paid'
          : compareMoney(applied, zero) > 0
            ? 'partiallyPaid'
            : 'upcoming';
      return { ...row, paidAmount: applied, remainingAmount: remaining, state };
    });
  }

  async listContracts(actor: ActorContext, query: ContractQuery): Promise<ContractPage> {
    const requested: Record<string, unknown> = {};
    for (const key of ['state', 'projectId', 'customerId', 'salesOwnerAccountId'] as const) {
      const value = query[key];
      if (value !== undefined) requested[key] = value;
    }
    assertSafeFilter(requested);
    const filter = withScope(buildScopeFilter(actor, SALES_SCOPE_FIELDS), requested);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const paged = cursor
      ? {
          $and: [
            filter,
            {
              $or: [
                { createdAt: { $lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, contractId: { $lt: cursor.id } },
              ],
            },
          ],
        }
      : filter;
    const [documents, total] = await Promise.all([
      this.contracts
        .find(paged)
        .sort({ createdAt: -1, contractId: -1 })
        .limit(query.limit + 1)
        .lean<ContractDocument[]>()
        .exec(),
      this.contracts.countDocuments(filter).exec(),
    ]);
    const page = documents.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toContract),
      total,
      limit: query.limit,
      ...(documents.length > query.limit && last
        ? { nextCursor: encodeCursor(last.createdAt, last.contractId) }
        : {}),
    };
  }

  async getContract(actor: ActorContext, contractId: string): Promise<Contract> {
    assertSafeFilter({ contractId });
    const filter = withScope(buildScopeFilter(actor, SALES_SCOPE_FIELDS), { contractId });
    const document = await this.contracts.findOne(filter).lean<ContractDocument>().exec();
    if (!document) throw new SalesNotFoundError('contract');
    return toContract(document);
  }

  async cancelContract(
    actor: ActorContext,
    contractId: string,
    input: CancelContract,
    context: RequestContext,
  ): Promise<Contract> {
    const current = await this.getContract(actor, contractId);
    if (!canTransitionContract(current.state, 'cancelled')) {
      await this.options.audit.record({
        action: SALES_AUDIT_ACTIONS.contractRefused,
        outcome: 'denied',
        actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
        target: { type: 'contract', id: contractId },
        reason: `refused transition ${current.state} -> cancelled`,
        context,
      });
      throw new SalesConflictError('invalidTransition');
    }

    /**
     * A contract with money against it is **not** cancelled here. Reversing collected money is a
     * refund, which is an accounting operation with its own controls, and letting a cancellation
     * silently strand receipts would put the books out by exactly that amount. Refunds arrive in
     * Phase 6 with the ledger that can record them.
     */
    if (compareMoney(current.paidAmount, money('0', current.paidAmount.currency)) > 0) {
      throw new SalesConflictError('contractHasCollections');
    }

    return withTransaction(this.connection, async (session) => {
      const now = new Date();
      const updated = await this.contracts
        .findOneAndUpdate(
          { contractId, state: current.state },
          {
            $set: { state: 'cancelled', cancellationReason: input.reason, updatedAt: now },
            $inc: { version: 1 },
          },
          { new: true, session },
        )
        .lean<ContractDocument>()
        .exec();
      if (!updated) throw new SalesConflictError('invalidTransition');

      // Installments are cancelled, never deleted: the schedule that existed is part of the history.
      await this.installments
        .updateMany(
          { contractId, state: { $nin: ['paid', 'cancelled'] } },
          { $set: { state: 'cancelled', updatedAt: now }, $inc: { version: 1 } },
          { session },
        )
        .exec();

      if (input.releaseUnit) {
        await this.options.units.changeStatus(
          actor,
          {
            unitId: current.unitId,
            from: 'contracted',
            to: 'available',
            reason: `contract ${current.contractNumber} cancelled`,
            sourceType: 'contract',
            sourceId: contractId,
            contractId: null,
          },
          context,
          session,
        );
      }

      await this.options.audit.record(
        {
          action: SALES_AUDIT_ACTIONS.contractCancelled,
          outcome: 'succeeded',
          actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
          target: { type: 'contract', id: contractId },
          changes: buildChangeSummary({ state: current.state }, { state: 'cancelled' }),
          reason: input.reason,
          context,
        },
        { session },
      );
      return toContract(updated);
    });
  }

  /* --------------------------------------------------------- installments */

  private installmentFilter(actor: ActorContext, query: InstallmentQuery): Record<string, unknown> {
    const requested: Record<string, unknown> = {};
    for (const key of ['contractId', 'customerId', 'projectId', 'state'] as const) {
      const value = query[key];
      if (value !== undefined) requested[key] = value;
    }
    assertSafeFilter(requested);
    const clauses: Record<string, unknown>[] = [
      withScope(buildScopeFilter(actor, INSTALLMENT_SCOPE_FIELDS), requested),
    ];
    if (query.bucket) {
      const today = this.options.today();
      const open = { state: { $in: ['upcoming', 'due', 'partiallyPaid', 'overdue'] } };
      if (query.bucket === 'overdue') clauses.push({ dueOn: { $lt: today }, ...open });
      else if (query.bucket === 'due') clauses.push({ dueOn: { $lte: today }, ...open });
      else {
        clauses.push({
          dueOn: { $gte: today, $lte: addDays(today, query.withinDays ?? 15) },
          ...open,
        });
      }
    }
    return clauses.length === 1 ? clauses[0]! : { $and: clauses };
  }

  async listInstallments(actor: ActorContext, query: InstallmentQuery): Promise<InstallmentPage> {
    const filter = this.installmentFilter(actor, query);
    const cursor = query.cursor
      ? Buffer.from(query.cursor, 'base64url').toString('utf8').split('|')
      : undefined;
    const paged =
      cursor && cursor[0] && cursor[1]
        ? {
            $and: [
              filter,
              {
                $or: [
                  { dueOn: { $gt: cursor[0] } },
                  { dueOn: cursor[0], installmentId: { $gt: cursor[1] } },
                ],
              },
            ],
          }
        : filter;
    const [documents, total] = await Promise.all([
      this.installments
        .find(paged)
        .sort({ dueOn: 1, installmentId: 1 })
        .limit(query.limit + 1)
        .lean<InstallmentDocument[]>()
        .exec(),
      this.installments.countDocuments(filter).exec(),
    ]);
    const page = documents.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toInstallment),
      total,
      limit: query.limit,
      ...(documents.length > query.limit && last
        ? {
            nextCursor: Buffer.from(`${last.dueOn}|${last.installmentId}`, 'utf8').toString(
              'base64url',
            ),
          }
        : {}),
    };
  }

  async listContractInstallments(actor: ActorContext, contractId: string): Promise<Installment[]> {
    // Visibility of the schedule follows visibility of the contract.
    await this.getContract(actor, contractId);
    const documents = await this.installments
      .find({ contractId })
      .sort({ sequence: 1 })
      .lean<InstallmentDocument[]>()
      .exec();
    return documents.map(toInstallment);
  }

  /**
   * Mark installments that have fallen due, and then those that are late.
   *
   * Idempotent: each state is in its own filter, so a second run on the same day changes nothing and
   * a third changes nothing again. It **is** a mutation, so a run that moved rows records an audit
   * event; a run that moved none is reported as exempt by the route rather than inventing evidence of
   * a change that did not happen (AUDIT-003).
   */
  async refreshInstallmentStates(
    actor: ActorContext,
    context: RequestContext,
  ): Promise<{ due: number; overdue: number }> {
    const today = this.options.today();
    const now = new Date();
    const due = await this.installments
      .updateMany(
        { state: 'upcoming', dueOn: { $lte: today } },
        { $set: { state: 'due', updatedAt: now }, $inc: { version: 1 } },
      )
      .exec();
    const overdue = await this.installments
      .updateMany(
        { state: { $in: ['due', 'partiallyPaid'] }, dueOn: { $lt: today } },
        { $set: { state: 'overdue', updatedAt: now }, $inc: { version: 1 } },
      )
      .exec();

    const changed = due.modifiedCount + overdue.modifiedCount;
    if (changed > 0) {
      await this.options.audit.record({
        action: SALES_AUDIT_ACTIONS.installmentsRefreshed,
        outcome: 'succeeded',
        actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
        target: { type: 'installmentSweep', id: today },
        reason: `${due.modifiedCount} became due, ${overdue.modifiedCount} became overdue`,
        context,
      });
    }
    return { due: due.modifiedCount, overdue: overdue.modifiedCount };
  }

  async customerSummary(
    actor: ActorContext,
    customerId: string,
  ): Promise<CustomerFinancialSummary> {
    assertSafeFilter({ customerId });
    const contractFilter = withScope(buildScopeFilter(actor, SALES_SCOPE_FIELDS), {
      customerId,
      state: { $in: ['active', 'completed'] },
    });
    const contracts = await this.contracts.find(contractFilter).lean<ContractDocument[]>().exec();
    const currency = contracts[0]?.totalPrice.currency ?? 'EGP';
    const zero = money('0', currency);

    const installmentFilter = withScope(buildScopeFilter(actor, INSTALLMENT_SCOPE_FIELDS), {
      customerId,
    });
    const installments = await this.installments
      .find(installmentFilter)
      .lean<InstallmentDocument[]>()
      .exec();
    const today = this.options.today();

    let overdueCount = 0;
    let overdueAmount = zero;
    for (const installment of installments) {
      const open = ['upcoming', 'due', 'partiallyPaid', 'overdue'].includes(installment.state);
      if (open && installment.dueOn < today) {
        overdueCount += 1;
        overdueAmount = addMoney(overdueAmount, toMoney(installment.remainingAmount));
      }
    }

    return {
      customerId,
      contracts: contracts.length,
      totalContracted: contracts.reduce<Money>(
        (running, c) => addMoney(running, toMoney(c.totalPrice)),
        zero,
      ),
      totalPaid: contracts.reduce<Money>(
        (running, c) => addMoney(running, toMoney(c.paidAmount)),
        zero,
      ),
      totalOutstanding: contracts.reduce<Money>(
        (running, c) => addMoney(running, toMoney(c.outstandingAmount)),
        zero,
      ),
      overdueCount,
      overdueAmount,
    };
  }

  /* ---------------------------------------- collections module entry point */

  /**
   * Apply a payment to one installment, inside the collections module's transaction.
   *
   * Sales owns the installment, so the allocation arithmetic and the over-allocation refusal live
   * here rather than being duplicated by whoever is recording the receipt.
   */
  async applyPaymentToInstallment(
    installmentId: string,
    amount: Money,
    session: ClientSession,
  ): Promise<{ applied: Money; installment: Installment }> {
    assertSafeFilter({ installmentId });
    const current = await this.installments
      .findOne({ installmentId })
      .session(session)
      .lean<InstallmentDocument>()
      .exec();
    if (!current) throw new SalesNotFoundError('installment');
    if (current.state === 'cancelled') throw new SalesConflictError('installmentCancelled');

    const remaining = toMoney(current.remainingAmount);
    if (remaining.currency !== amount.currency) throw new SalesValidationError('currencyMismatch');
    // Over-allocation is refused rather than clamped: a receipt that claims to pay more than is owed
    // is a data-entry error, and silently absorbing it hides the mistake.
    if (compareMoney(amount, remaining) > 0) throw new SalesValidationError('overAllocation');

    const newPaid = addMoney(toMoney(current.paidAmount), amount);
    const newRemaining = subtractMoney(remaining, amount);
    const zero = money('0', amount.currency);
    const state = compareMoney(newRemaining, zero) === 0 ? 'paid' : 'partiallyPaid';

    const updated = await this.installments
      .findOneAndUpdate(
        { installmentId, version: current.version },
        {
          $set: {
            paidAmount: fromMoney(newPaid),
            remainingAmount: fromMoney(newRemaining),
            state,
            updatedAt: new Date(),
          },
          $inc: { version: 1 },
        },
        { new: true, session },
      )
      .lean<InstallmentDocument>()
      .exec();
    // The version is in the filter, so two receipts allocating to one installment cannot both apply.
    if (!updated) throw new SalesConflictError('installmentChanged');

    await this.contracts
      .updateOne(
        { contractId: current.contractId },
        {
          $set: { updatedAt: new Date() },
          $inc: { version: 1 },
        },
        { session },
      )
      .exec();
    await this.recomputeContractTotals(current.contractId, session);

    return { applied: amount, installment: toInstallment(updated) };
  }

  /** Recompute a contract's paid and outstanding totals from its installments, never incrementally. */
  async recomputeContractTotals(contractId: string, session: ClientSession): Promise<void> {
    const contract = await this.contracts
      .findOne({ contractId })
      .session(session)
      .lean<ContractDocument>()
      .exec();
    if (!contract) return;
    const installments = await this.installments
      .find({ contractId, state: { $ne: 'cancelled' } })
      .session(session)
      .lean<InstallmentDocument[]>()
      .exec();
    const currency = contract.totalPrice.currency;
    const paid = installments.reduce<Money>(
      (running, row) => addMoney(running, toMoney(row.paidAmount)),
      money('0', currency),
    );
    const outstanding = subtractMoney(toMoney(contract.totalPrice), paid);
    const settled = compareMoney(outstanding, money('0', currency)) === 0;
    await this.contracts
      .updateOne(
        { contractId },
        {
          $set: {
            paidAmount: fromMoney(paid),
            outstandingAmount: fromMoney(outstanding),
            ...(settled && contract.state === 'active' ? { state: 'completed' } : {}),
            updatedAt: new Date(),
          },
        },
        { session },
      )
      .exec();
  }

  /** Read an installment without the actor's scope — for the collections module in its transaction. */
  async findInstallment(
    installmentId: string,
    session?: ClientSession,
  ): Promise<Installment | undefined> {
    assertSafeFilter({ installmentId });
    const document = await this.installments
      .findOne({ installmentId })
      .session(session ?? null)
      .lean<InstallmentDocument>()
      .exec();
    return document ? toInstallment(document) : undefined;
  }

  async findContract(contractId: string, session?: ClientSession): Promise<Contract | undefined> {
    assertSafeFilter({ contractId });
    const document = await this.contracts
      .findOne({ contractId })
      .session(session ?? null)
      .lean<ContractDocument>()
      .exec();
    return document ? toContract(document) : undefined;
  }
}
