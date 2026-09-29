import {
  ContractSchema,
  InstallmentSchema,
  LIVE_RESERVATION_STATES,
  ReservationSchema,
  SALES_APPROVAL_OPERATIONS,
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
  SCHEDULE_ROUNDING_RULE,
  scheduleTotal,
  type ActivateContract,
  type AmendContract,
  type CancelContract,
  type Contract,
  type ContractAmendment,
  type ContractCustomerSnapshot,
  type ContractHistoryEntry,
  type ContractPartyInput,
  type ContractUnitSnapshot,
  type ContractWarning,
  type RecordSigning,
  type SetContractParties,
  type ContractSummary,
  type ContractSummaryQuery,
  type ContractPage,
  type ContractQuery,
  type CreateContract,
  type CreateReservation,
  type ExtendReservation,
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
  can,
  restrictDocument,
  withScope,
  type Logger,
  type ScopeFieldMap,
} from '@alola/security';
import { createHash } from 'node:crypto';
import type { ClientSession, Connection, Types } from 'mongoose';
import { DomainError, conflict, invalid } from '../../platform/audit-port';
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
  type StoredAmendment,
  type StoredMoney,
  type StoredPaymentPlan,
  type StoredScheduleRow,
} from './model';
import { amendmentRows, partyIssues, samePlan } from './contract-rules';
import {
  combinedOutcome,
  minimumDepositFor,
  requiredApprovals,
  reservationExceptions,
  type DepositRule,
} from './reservation-rules';

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
        heldByHoldId?: string;
        heldByReservationId?: string;
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
      holdId?: string | null;
      /** Move the unit only if this reservation still holds it. */
      expectReservationId?: string;
    },
    context: RequestContext,
    session?: ClientSession,
  ): Promise<unknown>;
}

/**
 * The unit as a contract records it (SALE-CONTRACT-001): read once, when the draft is made, and never
 * again — a later change to the unit does not rewrite the contract.
 */
export interface UnitSnapshotPort {
  snapshot(unitId: string, session?: ClientSession): Promise<ContractUnitSnapshot | undefined>;
}

/**
 * The customers a contract names. `snapshot` reads the buyer through CRM's own scoped, field-restricted
 * read, so the identity is recorded only when the person drafting may see it (CRM never hands identity
 * to another module otherwise); without it the contract carries the `identityMissing` warning. The
 * identity is then restricted on the contract exactly as on the customer. `inScope` is how a party is
 * checked: a person the actor cannot see cannot be added to a contract.
 */
export interface ContractCustomerPort {
  snapshot(
    actor: ActorContext,
    customerId: string,
  ): Promise<ContractCustomerSnapshot | undefined>;
  inScope(actor: ActorContext, customerId: string): Promise<{ name: string } | undefined>;
}

/** A signed copy must be a document the contract owns (CORE-DOC-002). */
export interface SignedCopyPort {
  ownerOf(
    actor: ActorContext,
    documentId: string,
  ): Promise<{ type: string; id: string } | undefined>;
}

/** The contract's own trail, read from the audit record (SALE-CONTRACT-004). */
export interface HistoryPort {
  targetHistory(target: { type: string; id: string }, limit?: number): Promise<ContractHistoryEntry[]>;
}

/** Timed holds, as a reservation converts one (INV-HOLD-001). */
export interface HoldPort {
  find(
    holdId: string,
    session?: ClientSession,
  ): Promise<
    { holdId: string; unitId: string; state: string; holderAccountId: string } | undefined
  >;
  convert(
    actor: ActorContext,
    holdId: string,
    reservationId: string,
    expected: { unitId: string },
    context: RequestContext,
    session: ClientSession,
  ): Promise<void>;
}

/** Opportunities, as a reservation advances one (CRM-OPP-002). */
export interface OpportunityPort {
  /** Scoped to the actor: an opportunity they cannot see is not found. */
  find(
    actor: ActorContext,
    opportunityId: string,
  ): Promise<{ opportunityId: string; customerId: string; stage: string }>;
  advance(
    actor: ActorContext,
    opportunityId: string,
    to: 'reservation' | 'won' | 'negotiation',
    links: { reservationId?: string; contractId?: string },
    reason: string,
    context: RequestContext,
    session: ClientSession,
  ): Promise<void>;
}

/**
 * The configured commercial rules (`BD-01`, `BD-02`, `BD-03`). `null` is **not configured**: validity
 * then refuses every reservation, and the deposit and discount limits enforce nothing.
 */
export interface ReservationPolicies {
  validityDays(): Promise<number | null>;
  minimumDeposit(): Promise<DepositRule | null>;
  maximumDiscountPercent(): Promise<string | null>;
}

/**
 * Official numbering (CORE-DOC-001, SALE-RESERVE-006). Resolves to nothing when no format is active
 * for the type — the deployment has not decided one (`BD-19`) — and the legacy series continues.
 */
export interface NumberPort {
  issue(
    input: {
      type: 'reservation' | 'contract' | 'quotation';
      issueDate: BusinessDate;
      projectId: string;
      source: { type: string; id: string };
    },
    session: ClientSession,
  ): Promise<string | undefined>;
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
  /** Whether a published policy would govern the operation — asked before anything is written. */
  applies?(
    actor: ActorContext,
    input: {
      operationType: string;
      scope: Record<string, string | undefined>;
      context: { amount?: Money; percentage?: string; isException?: boolean };
    },
  ): Promise<boolean>;
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

const iso = (date: Date) => date.toISOString();

/** The buyer's identity snapshot is absent for an actor who may not see identities (SEC-029). */
function restrictContract(actor: ActorContext, contract: Contract): Contract {
  return restrictDocument('contract', actor, contract) as Contract;
}

/** Rows that owe their whole amount — what an amendment may replace (SALE-CHANGE-001). */
const UNPAID_STATES: InstallmentDocument['state'][] = ['upcoming', 'due', 'overdue'];

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
    ...(stored.downPaymentDueOn
      ? { downPaymentDueOn: stored.downPaymentDueOn as BusinessDate }
      : {}),
    ...(stored.finalPayment ? { finalPayment: toMoney(stored.finalPayment) } : {}),
    ...(stored.milestones && stored.milestones.length > 0
      ? {
          milestones: stored.milestones.map((milestone) => ({
            dueOn: milestone.dueOn as BusinessDate,
            amount: toMoney(milestone.amount),
            ...(milestone.label ? { label: { ar: milestone.label.ar, en: milestone.label.en } } : {}),
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

function toRow(stored: StoredScheduleRow): ScheduleRow {
  return {
    sequence: stored.sequence,
    kind: stored.kind,
    dueOn: stored.dueOn as BusinessDate,
    amount: toMoney(stored.amount),
    ...(stored.label ? { label: { ar: stored.label.ar, en: stored.label.en } } : {}),
  };
}

function fromRow(row: ScheduleRow): StoredScheduleRow {
  return {
    sequence: row.sequence,
    kind: row.kind,
    dueOn: row.dueOn,
    amount: fromMoney(row.amount),
    ...(row.label ? { label: row.label } : {}),
  };
}

function toReservation(d: ReservationDocument): Reservation {
  return ReservationSchema.parse({
    reservationId: d.reservationId,
    reservationNumber: d.reservationNumber,
    customerId: d.customerId,
    ...(d.leadId ? { leadId: d.leadId } : {}),
    ...(d.opportunityId ? { opportunityId: d.opportunityId } : {}),
    ...(d.holdId ? { holdId: d.holdId } : {}),
    unitId: d.unitId,
    projectId: d.projectId,
    reservedOn: d.reservedOn,
    expiresOn: d.expiresOn,
    reservationAmount: toMoney(d.reservationAmount),
    agreedPrice: toMoney(d.agreedPrice),
    ...(d.listPrice ? { listPrice: toMoney(d.listPrice) } : {}),
    discountPercentage: d.discountPercentage,
    ...(d.minimumDeposit ? { minimumDeposit: toMoney(d.minimumDeposit) } : {}),
    exceptions: d.exceptions ?? [],
    approvals: approvalsOf(d),
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
    refundHandoff: d.refundHandoff ?? 'notApplicable',
    ...(d.pendingExtension ? { pendingExtension: d.pendingExtension } : {}),
    ...(d.pendingCancellation ? { pendingCancellation: d.pendingCancellation } : {}),
    extensions: d.extensions ?? 0,
    ...(d.notes ? { notes: d.notes } : {}),
    version: d.version,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

/**
 * The approvals a reservation waits on. A record from before BMP-1 carries only `approvalRequestId`,
 * which was always the discount approval.
 */
function approvalsOf(d: ReservationDocument): { operationType: string; requestId: string }[] {
  if (d.approvals && d.approvals.length > 0) return d.approvals;
  return d.approvalRequestId
    ? [{ operationType: SALES_APPROVAL_OPERATIONS.discount, requestId: d.approvalRequestId }]
    : [];
}

/** The price the schedule is built on: the snapshot's agreed price, or — before BMP-1 — the total. */
function contractPrice(d: ContractDocument): Money {
  return d.pricing ? toMoney(d.pricing.agreedPrice) : toMoney(d.totalPrice);
}

function contractWarnings(d: ContractDocument): ContractWarning[] {
  const warnings: ContractWarning[] = [];
  // Only a contract drafted with a snapshot can say its buyer had no identity (BD-34).
  if (d.customerSnapshot && !d.customerSnapshot['identity']) warnings.push('identityMissing');
  const live = d.state === 'draft' || d.state === 'pendingApproval' || d.state === 'active';
  if (live && (d.signing?.state ?? 'unsigned') === 'unsigned') warnings.push('notSigned');
  return warnings;
}

function draftScheduleOf(d: ContractDocument): ScheduleRow[] | undefined {
  if (d.state !== 'draft' && d.state !== 'pendingApproval') return undefined;
  try {
    return buildInstallmentSchedule(contractPrice(d), toPlan(d.paymentPlan));
  } catch {
    // A stored plan was valid when it was stored; a preview is never worth failing a read over.
    return undefined;
  }
}

function toAmendment(a: StoredAmendment): ContractAmendment {
  return {
    amendmentId: a.amendmentId,
    state: a.state,
    reason: a.reason,
    ...(a.requestId ? { requestId: a.requestId } : {}),
    plan: {
      installmentCount: a.plan.installmentCount,
      frequency: a.plan.frequency,
      firstDueOn: a.plan.firstDueOn as BusinessDate,
      ...(a.plan.finalPayment ? { finalPayment: toMoney(a.plan.finalPayment) } : {}),
    },
    replacedInstallmentIds: a.replacedInstallmentIds,
    amount: toMoney(a.amount),
    rows: a.rows.map(toRow),
    requestedBy: a.requestedBy,
    requestedAt: iso(a.requestedAt),
    ...(a.decidedAt ? { decidedAt: iso(a.decidedAt) } : {}),
  } as ContractAmendment;
}

function toContract(d: ContractDocument): Contract {
  const draftSchedule = draftScheduleOf(d);
  return ContractSchema.parse({
    contractId: d.contractId,
    contractNumber: d.contractNumber,
    customerId: d.customerId,
    unitId: d.unitId,
    projectId: d.projectId,
    reservationId: d.reservationId,
    ...(d.leadId ? { leadId: d.leadId } : {}),
    ...(d.opportunityId ? { opportunityId: d.opportunityId } : {}),
    contractedOn: d.contractedOn,
    totalPrice: toMoney(d.totalPrice),
    reservationAmount: toMoney(d.reservationAmount),
    paymentPlan: toPlan(d.paymentPlan),
    outstandingAmount: toMoney(d.outstandingAmount),
    paidAmount: toMoney(d.paidAmount),
    ...(d.customerSnapshot ? { customerSnapshot: d.customerSnapshot } : {}),
    ...(d.unitSnapshot ? { unitSnapshot: d.unitSnapshot } : {}),
    ...(d.pricing
      ? {
          pricing: {
            ...(d.pricing.listPrice ? { listPrice: toMoney(d.pricing.listPrice) } : {}),
            agreedPrice: toMoney(d.pricing.agreedPrice),
            discountPercentage: d.pricing.discountPercentage,
            reservationAmount: toMoney(d.pricing.reservationAmount),
            ...(d.pricing.maintenanceDeposit
              ? { maintenanceDeposit: toMoney(d.pricing.maintenanceDeposit) }
              : {}),
          },
        }
      : {}),
    // A contract from before BMP-1 had one party: its customer, owning the whole unit.
    parties: d.parties ?? [{ role: 'buyer', customerId: d.customerId, sharePercent: '100' }],
    signing: d.signing
      ? {
          state: d.signing.state,
          ...(d.signing.signedOn ? { signedOn: d.signing.signedOn } : {}),
          ...(d.signing.documentId ? { documentId: d.signing.documentId } : {}),
          ...(d.signing.recordedBy ? { recordedBy: d.signing.recordedBy } : {}),
          ...(d.signing.recordedAt ? { recordedAt: iso(d.signing.recordedAt) } : {}),
        }
      : { state: 'unsigned' },
    exceptions: d.exceptions ?? [],
    warnings: contractWarnings(d),
    approvals: d.approvals ?? [],
    amendments: (d.amendments ?? []).map(toAmendment),
    ...(d.pendingCancellation ? { pendingCancellation: d.pendingCancellation } : {}),
    refundHandoff: d.refundHandoff ?? 'notApplicable',
    ...(draftSchedule ? { draftSchedule } : {}),
    salesOwnerAccountId: d.salesOwnerAccountId,
    legalEntityId: d.legalEntityId,
    branchId: d.branchId,
    ...(d.departmentId ? { departmentId: d.departmentId } : {}),
    ...(d.teamId ? { teamId: d.teamId } : {}),
    state: d.state,
    ...(d.activatedAt ? { activatedAt: iso(d.activatedAt) } : {}),
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
    ...(d.label ? { label: { ar: d.label.ar, en: d.label.en } } : {}),
    ...(d.amendmentId ? { amendmentId: d.amendmentId } : {}),
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
  holds?: HoldPort;
  opportunities?: OpportunityPort;
  /** Absent means every rule is not configured — and so no reservation can be made (`BD-01`). */
  policies?: ReservationPolicies;
  /** Absent means the legacy series numbers every document. */
  numbers?: NumberPort;
  /** Contract drafting (SALE-CONTRACT-001 … 004). Absent: drafts carry no snapshots. */
  unitSnapshots?: UnitSnapshotPort;
  customers?: ContractCustomerPort;
  signedCopies?: SignedCopyPort;
  history?: HistoryPort;
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
    // The year of the organization's calendar, not the server's UTC clock: a reservation made on the
    // evening of 31 December in Cairo belongs to that year (ADR-0008).
    const year = this.options.today().slice(0, 4);
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

  /**
   * The official number of a reservation or contract: from the deployment's active format through
   * CORE-DOC-001, or — while none is active (`BD-19`) — the next number of the legacy series, which the
   * demonstration records already use.
   */
  private async documentNumber(
    type: 'reservation' | 'contract',
    source: { id: string; projectId: string },
    session: ClientSession,
  ): Promise<string> {
    const official = await this.options.numbers?.issue(
      {
        type,
        issueDate: this.options.today(),
        projectId: source.projectId,
        source: { type, id: source.id },
      },
      session,
    );
    return official ?? this.nextNumber(type === 'reservation' ? 'RSV' : 'CTR', session);
  }

  /* ------------------------------------------------------------- preview */

  previewSchedule(total: Money, plan: PaymentPlan): SchedulePreview {
    const rows = buildInstallmentSchedule(total, plan);
    const rowsTotal = rows.reduce<Money>(
      (running, row) => addMoney(running, row.amount),
      money('0', total.currency),
    );
    return {
      rows,
      total: scheduleTotal(total, plan),
      price: total,
      ...(plan.maintenanceDeposit ? { maintenanceDeposit: plan.maintenanceDeposit.amount } : {}),
      roundingRule: SCHEDULE_ROUNDING_RULE,
      rowsTotal,
    };
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

  private audit(
    actor: ActorContext,
    entry: {
      action: string;
      outcome?: 'succeeded' | 'denied';
      reservationId: string;
      reason?: string;
      changes?: { path: string; from?: string; to?: string }[];
    },
    context: RequestContext,
    session?: ClientSession,
  ): Promise<unknown> {
    return this.options.audit.record(
      {
        action: entry.action,
        outcome: entry.outcome ?? 'succeeded',
        actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
        target: { type: 'reservation', id: entry.reservationId },
        ...(entry.changes ? { changes: entry.changes } : {}),
        ...(entry.reason ? { reason: entry.reason } : {}),
        context,
      },
      session ? { session } : {},
    );
  }

  private approvalScope(r: {
    branchId: string;
    projectId: string;
    legalEntityId: string;
    teamId?: string | undefined;
    departmentId?: string | undefined;
  }): Record<string, string | undefined> {
    return {
      branchId: r.branchId,
      projectId: r.projectId,
      legalEntityId: r.legalEntityId,
      ...(r.teamId ? { teamId: r.teamId } : {}),
      ...(r.departmentId ? { departmentId: r.departmentId } : {}),
    };
  }

  /**
   * SALE-RESERVE-001 … 006, SALE-DISCOUNT-001 / 002.
   *
   * Everything a reservation needs is checked **before** anything is written: validity must be
   * configured (`BD-01`), the deposit and discount limits are applied when configured (`BD-02`,
   * `BD-03`), and an exception is refused outright when no policy can approve it. Then the
   * reservation, its number, the unit's hold (or the conversion of the actor's timed hold), the
   * lead's and the opportunity's stages and the audit record commit in **one transaction**. The
   * approvals it needs are requested after the commit, so no approval ever points at a reservation that
   * does not exist.
   */
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
      opportunityId: input.opportunityId ?? null,
      holdId: input.holdId ?? null,
    });
    const replay = await this.replayReservation(input.idempotencyKey, print);
    if (replay) return { reservation: replay, replayed: true };

    const policies = this.options.policies;
    const validity = (await policies?.validityDays()) ?? null;
    // No validity decided means no reservation: an invented period would release units nobody
    // expected to lose, or hold them longer than the business allows.
    if (validity === null) throw conflict('RESERVATION_VALIDITY_NOT_CONFIGURED');
    if (input.holdDays !== undefined && input.holdDays !== validity) {
      throw invalid('VALIDITY_SET_BY_POLICY', ['holdDays']);
    }

    const unit = await this.options.units.find(input.unitId);
    if (!unit) throw new SalesNotFoundError('unit');
    const customer = await this.options.crm.findCustomer(input.customerId);
    if (!customer) throw new SalesNotFoundError('customer');
    if (customer.legalEntityId !== unit.legalEntityId) {
      // A customer of one legal entity cannot reserve another's unit: the contract would belong to
      // neither, and the money would post to the wrong books.
      throw new SalesValidationError('legalEntityMismatch');
    }

    if (input.holdId) {
      const hold = await this.options.holds?.find(input.holdId);
      if (!hold || hold.unitId !== unit.unitId || hold.state !== 'active') {
        throw conflict('HOLD_NOT_ACTIVE', ['holdId']);
      }
      if (hold.holderAccountId !== actor.accountId && !can(actor, 'inventory.hold.manage')) {
        throw new DomainError('FORBIDDEN', [{ path: ['holdId'], code: 'NOT_HOLDER' }]);
      }
      if (unit.status !== 'held' || unit.heldByHoldId !== input.holdId) {
        throw conflict('HOLD_NOT_ACTIVE', ['holdId']);
      }
    } else if (unit.status !== 'available') {
      throw conflict('UNIT_NOT_AVAILABLE', ['unitId']);
    }

    if (input.opportunityId) {
      const opportunity = await this.options.opportunities?.find(actor, input.opportunityId);
      if (!opportunity) throw new SalesNotFoundError('opportunity');
      if (opportunity.customerId !== input.customerId) {
        throw invalid('OPPORTUNITY_CUSTOMER_MISMATCH', ['opportunityId']);
      }
      if (['reservation', 'won', 'lost'].includes(opportunity.stage)) {
        throw conflict('OPPORTUNITY_NOT_OPEN', ['opportunityId']);
      }
    }

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
    // A price above the list is not a discount; the percentage never goes negative for a rule.
    const discountForRules = discountPercentage.startsWith('-') ? '0' : discountPercentage;

    const minimumDeposit = minimumDepositFor(
      (await policies?.minimumDeposit()) ?? null,
      input.agreedPrice,
    );
    if (minimumDeposit === null) throw invalid('CURRENCY_MISMATCH', ['reservationAmount']);
    const exceptions = reservationExceptions({
      discountPercentage: discountForRules,
      maximumDiscountPercent: (await policies?.maximumDiscountPercent()) ?? null,
      reservationAmount: input.reservationAmount,
      minimumDeposit,
    });
    const required = requiredApprovals({ discountPercentage: discountForRules, exceptions });
    const placement = {
      branchId: unit.branchId,
      projectId: unit.projectId,
      legalEntityId: unit.legalEntityId,
      ...(actor.scope.teamIds[0] ? { teamId: actor.scope.teamIds[0] } : {}),
      ...(actor.scope.departmentIds[0] ? { departmentId: actor.scope.departmentIds[0] } : {}),
    };
    const approvalContext = (exception: boolean) => ({
      amount: input.agreedPrice,
      percentage: discountForRules,
      ...(exception ? { isException: true } : {}),
    });
    // An exception is granted only by an approval, never by the absence of a control.
    for (const need of required.filter((entry) => entry.exception)) {
      const applies =
        (await this.options.approvals?.applies?.(actor, {
          operationType: need.operationType,
          scope: this.approvalScope(placement),
          context: approvalContext(true),
        })) ?? false;
      if (!applies) {
        const issue =
          need.operationType === SALES_APPROVAL_OPERATIONS.priceOverride
            ? 'DISCOUNT_ABOVE_MAXIMUM'
            : 'DEPOSIT_BELOW_MINIMUM';
        await this.audit(
          actor,
          {
            action: SALES_AUDIT_ACTIONS.reservationRefused,
            outcome: 'denied',
            reservationId: 'not-created',
            reason: `refused: ${issue}, no approval policy applies`,
          },
          context,
        );
        throw conflict(issue, [
          issue === 'DISCOUNT_ABOVE_MAXIMUM' ? 'agreedPrice' : 'reservationAmount',
        ]);
      }
    }

    const reservationId = newId('rsv');
    const today = this.options.today();
    const expiresOn = addDays(today, validity);

    let reservation: Reservation;
    try {
      reservation = await withTransaction(this.connection, async (session) => {
        const reservationNumber = await this.documentNumber(
          'reservation',
          { id: reservationId, projectId: unit.projectId },
          session,
        );
        const now = new Date();
        const document: ReservationDocument = {
          reservationId,
          reservationNumber,
          customerId: input.customerId,
          ...(input.leadId ? { leadId: input.leadId } : {}),
          ...(input.opportunityId ? { opportunityId: input.opportunityId } : {}),
          ...(input.holdId ? { holdId: input.holdId } : {}),
          unitId: unit.unitId,
          projectId: unit.projectId,
          reservedOn: today,
          expiresOn,
          reservationAmount: fromMoney(input.reservationAmount),
          agreedPrice: fromMoney(input.agreedPrice),
          ...(listPrice ? { listPrice: fromMoney(listPrice) } : {}),
          discountPercentage,
          ...(minimumDeposit ? { minimumDeposit: fromMoney(minimumDeposit) } : {}),
          exceptions,
          approvals: [],
          paymentPlan: fromPlan(input.paymentPlan),
          salesOwnerAccountId: actor.accountId,
          legalEntityId: unit.legalEntityId,
          branchId: unit.branchId,
          ...(placement.teamId ? { teamId: placement.teamId } : {}),
          ...(placement.departmentId ? { departmentId: placement.departmentId } : {}),
          state: 'draft',
          refundHandoff: 'notApplicable',
          extensions: 0,
          ...(input.notes ? { notes: input.notes } : {}),
          idempotencyKey: input.idempotencyKey,
          idempotencyFingerprint: print,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        const [created] = await this.reservations.create([document], { session });
        if (!created) throw new SalesConflictError('reservationNotCreated');

        // The unit and the reservation commit together: a hold without a reservation is a unit
        // nobody can sell, and the reverse is a double sale.
        if (input.holdId) {
          await this.options.holds?.convert(
            actor,
            input.holdId,
            reservationId,
            { unitId: unit.unitId },
            context,
            session,
          );
        } else {
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
        }
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
        if (input.opportunityId) {
          await this.options.opportunities?.advance(
            actor,
            input.opportunityId,
            'reservation',
            { reservationId },
            `reservation ${reservationNumber}`,
            context,
            session,
          );
        }
        await this.audit(
          actor,
          {
            action: SALES_AUDIT_ACTIONS.reservationCreated,
            reservationId,
            changes: buildChangeSummary(undefined, {
              reservationNumber,
              unitId: unit.unitId,
              customerId: input.customerId,
              discountPercentage,
              exceptions: exceptions.join(',') || 'none',
            }),
          },
          context,
          session,
        );
        return toReservation(created.toObject());
      });
    } catch (error) {
      // A racing retry of the same key returns the original; anyone else lost the unit.
      if (isDuplicateKey(error)) {
        const stored = await this.replayReservation(input.idempotencyKey, print);
        if (stored) return { reservation: stored, replayed: true };
        throw conflict('UNIT_NOT_AVAILABLE', ['unitId']);
      }
      if ((error as { name?: string }).name === 'UnitTransitionError') {
        throw conflict('UNIT_NOT_AVAILABLE', ['unitId']);
      }
      throw error;
    }

    const submitted = await this.requestApprovals(actor, reservation, required, context);
    return { reservation: submitted, replayed: false };
  }

  /**
   * Ask for each approval the reservation needs. With none submitted it stays a draft a person
   * confirms — for a discount, the absence of a configured control is not an approval and not an error
   * either (ADR-0024). An exception whose policy vanished between the check and the request can no
   * longer be approved, so the reservation is cancelled and its unit released.
   */
  private async requestApprovals(
    actor: ActorContext,
    reservation: Reservation,
    required: { operationType: string; exception: boolean }[],
    context: RequestContext,
  ): Promise<Reservation> {
    if (required.length === 0 || !this.options.approvals) return reservation;
    const approvals: { operationType: string; requestId: string }[] = [];
    let exceptionUnavailable = false;
    for (const need of required) {
      const submitted = await this.options.approvals.submit(
        actor,
        {
          operationType: need.operationType,
          source: { type: 'reservation', id: reservation.reservationId },
          scope: this.approvalScope(reservation),
          context: {
            amount: reservation.agreedPrice,
            percentage: reservation.discountPercentage.startsWith('-')
              ? '0'
              : reservation.discountPercentage,
            ...(need.exception ? { isException: true } : {}),
          },
          summary: [
            {
              label: { ar: 'رقم الحجز', en: 'Reservation number' },
              value: reservation.reservationNumber,
            },
            {
              label: { ar: 'نسبة الخصم', en: 'Discount percentage' },
              value: `${reservation.discountPercentage}%`,
            },
            {
              label: { ar: 'مبلغ الحجز', en: 'Reservation amount' },
              value: `${reservation.reservationAmount.amount} ${reservation.reservationAmount.currency}`,
            },
          ],
          idempotencyKey: `reservation-${need.operationType}-${reservation.reservationId}`,
        },
        context,
      );
      if (submitted)
        approvals.push({ operationType: need.operationType, requestId: submitted.requestId });
      else if (need.exception) exceptionUnavailable = true;
    }
    if (exceptionUnavailable) {
      return this.endReservation(
        actor,
        reservation,
        'cancelled',
        'exception approval unavailable',
        SALES_AUDIT_ACTIONS.reservationCancelled,
        context,
      );
    }
    if (approvals.length === 0) return reservation;

    const updated = await withTransaction(this.connection, async (session) => {
      const result = await this.reservations
        .findOneAndUpdate(
          { reservationId: reservation.reservationId, state: 'draft' },
          {
            $set: {
              state: 'pendingApproval',
              approvals,
              approvalRequestId: approvals[0]?.requestId,
              updatedAt: new Date(),
            },
            $inc: { version: 1 },
          },
          { returnDocument: 'after', session },
        )
        .lean<ReservationDocument>()
        .exec();
      if (!result) return undefined;
      await this.audit(
        actor,
        {
          action: SALES_AUDIT_ACTIONS.reservationApprovalRequested,
          reservationId: reservation.reservationId,
          reason: approvals.map((entry) => entry.operationType).join(', '),
        },
        context,
        session,
      );
      return result;
    });
    if (!updated) return reservation;
    // A policy that settles at once (an automatic approval) is honoured straight away.
    await this.syncApproval(actor, approvals[0]?.requestId ?? '', context);
    return this.findReservationOrThrow(reservation.reservationId);
  }

  private async findReservationOrThrow(reservationId: string): Promise<Reservation> {
    const document = await this.reservations
      .findOne({ reservationId })
      .lean<ReservationDocument>()
      .exec();
    if (!document) throw new SalesNotFoundError('reservation');
    return toReservation(document);
  }

  /**
   * Act on a decided approval (ADR-0024 §2: the engine records, the owning module acts). Settles a
   * reservation's own approvals, a pending extension, or a pending cancellation. Idempotent: every
   * move is conditional on the state it read.
   */
  async syncApproval(
    actor: ActorContext,
    requestId: string,
    context: RequestContext,
  ): Promise<'approved' | 'rejected' | 'extended' | 'cancelled' | 'refused' | 'unchanged'> {
    if (!requestId || !this.options.approvals) return 'unchanged';
    assertSafeFilter({ requestId });
    const document = await this.reservations
      .findOne({
        $or: [
          { 'approvals.requestId': requestId },
          { approvalRequestId: requestId },
          { 'pendingExtension.requestId': requestId },
          { 'pendingCancellation.requestId': requestId },
        ],
      })
      .lean<ReservationDocument>()
      .exec();
    if (!document) {
      const outcome = await this.syncContractApproval(actor, requestId, context);
      if (outcome === 'activated' || outcome === 'amended') return 'approved';
      if (outcome === 'stale') return 'refused';
      return outcome;
    }
    const current = toReservation(document);
    const approvals = this.options.approvals;

    if (current.pendingExtension?.requestId === requestId) {
      const state = await approvals.state(requestId);
      if (state === 'approved') {
        await this.applyExtension(
          actor,
          current,
          current.pendingExtension.days,
          current.pendingExtension.reason,
          context,
        );
        return 'extended';
      }
      if (state === 'rejected' || state === 'cancelled' || state === 'expired') {
        await this.reservations
          .updateOne(
            { reservationId: current.reservationId, 'pendingExtension.requestId': requestId },
            {
              $unset: { pendingExtension: '' },
              $set: { updatedAt: new Date() },
              $inc: { version: 1 },
            },
          )
          .exec();
        return 'refused';
      }
      return 'unchanged';
    }

    if (current.pendingCancellation?.requestId === requestId) {
      const state = await approvals.state(requestId);
      if (state === 'approved' && LIVE_RESERVATION_STATES.includes(current.state)) {
        await this.endReservation(
          actor,
          current,
          'cancelled',
          current.pendingCancellation.reason,
          SALES_AUDIT_ACTIONS.reservationCancelled,
          context,
        );
        return 'cancelled';
      }
      if (state === 'rejected' || state === 'cancelled' || state === 'expired') {
        await this.reservations
          .updateOne(
            { reservationId: current.reservationId, 'pendingCancellation.requestId': requestId },
            {
              $unset: { pendingCancellation: '' },
              $set: { updatedAt: new Date() },
              $inc: { version: 1 },
            },
          )
          .exec();
        return 'refused';
      }
      return 'unchanged';
    }

    if (current.state !== 'pendingApproval') return 'unchanged';
    const states = await Promise.all(
      current.approvals.map((entry) => approvals.state(entry.requestId)),
    );
    const outcome = combinedOutcome(states);
    if (outcome === 'approved') {
      await this.transition(
        actor,
        current,
        'approved',
        SALES_AUDIT_ACTIONS.reservationApproved,
        'all approvals granted',
        context,
      );
      return 'approved';
    }
    if (outcome === 'rejected') {
      await this.endReservation(
        actor,
        current,
        'rejected',
        'an approval was refused',
        SALES_AUDIT_ACTIONS.reservationRejected,
        context,
      );
      return 'rejected';
    }
    return 'unchanged';
  }

  /** A state change that leaves the unit where it is. Conditional on the state and version read. */
  private async transition(
    actor: ActorContext,
    current: Reservation,
    to: ReservationState,
    auditAction: string,
    reason: string,
    context: RequestContext,
  ): Promise<Reservation> {
    if (!canTransitionReservation(current.state, to)) throw conflict('INVALID_TRANSITION');
    return withTransaction(this.connection, async (session) => {
      const updated = await this.reservations
        .findOneAndUpdate(
          { reservationId: current.reservationId, state: current.state, version: current.version },
          { $set: { state: to, updatedAt: new Date() }, $inc: { version: 1 } },
          { returnDocument: 'after', session },
        )
        .lean<ReservationDocument>()
        .exec();
      if (!updated) throw conflict('STALE_VERSION');
      await this.audit(
        actor,
        {
          action: auditAction,
          reservationId: current.reservationId,
          reason,
          changes: buildChangeSummary({ state: current.state }, { state: to }),
        },
        context,
        session,
      );
      return toReservation(updated);
    });
  }

  /**
   * End a live reservation — cancelled, expired or rejected — and return everything it held: the unit
   * to sale (only if this reservation still holds it), the opportunity to negotiation. Money agreed on
   * the reservation becomes a refund hand-off for BMP-2; whether any was collected is not this
   * module's to say.
   */
  private async endReservation(
    actor: ActorContext,
    current: Reservation,
    to: 'cancelled' | 'expired' | 'rejected',
    reason: string,
    auditAction: string,
    context: RequestContext,
  ): Promise<Reservation> {
    if (!canTransitionReservation(current.state, to)) {
      await this.audit(
        actor,
        {
          action: SALES_AUDIT_ACTIONS.reservationRefused,
          outcome: 'denied',
          reservationId: current.reservationId,
          reason: `refused transition ${current.state} -> ${to}`,
        },
        context,
      );
      throw new SalesConflictError('invalidTransition');
    }
    const refund =
      compareMoney(current.reservationAmount, money('0', current.reservationAmount.currency)) > 0
        ? 'pending'
        : 'notApplicable';
    return withTransaction(this.connection, async (session) => {
      const updated = await this.reservations
        .findOneAndUpdate(
          { reservationId: current.reservationId, state: current.state },
          {
            $set: {
              state: to,
              cancellationReason: reason,
              refundHandoff: refund,
              updatedAt: new Date(),
            },
            $unset: { pendingExtension: '', pendingCancellation: '' },
            $inc: { version: 1 },
          },
          { returnDocument: 'after', session },
        )
        .lean<ReservationDocument>()
        .exec();
      // The state is in the filter, so a concurrent move loses instead of overwriting.
      if (!updated) throw new SalesConflictError('invalidTransition');

      await this.options.units.changeStatus(
        actor,
        {
          unitId: current.unitId,
          from: current.state === 'confirmed' ? 'reserved' : 'held',
          to: 'available',
          reason,
          sourceType: 'reservation',
          sourceId: current.reservationId,
          reservationId: null,
          expectReservationId: current.reservationId,
        },
        context,
        session,
      );
      if (current.opportunityId) {
        await this.options.opportunities?.advance(
          actor,
          current.opportunityId,
          'negotiation',
          {},
          `reservation ${current.reservationNumber} ${to}`,
          context,
          session,
        );
      }
      await this.audit(
        actor,
        {
          action: auditAction,
          reservationId: current.reservationId,
          reason,
          changes: buildChangeSummary(
            { state: current.state },
            { state: to, refundHandoff: refund },
          ),
        },
        context,
        session,
      );
      return toReservation(updated);
    });
  }

  /**
   * Confirm a reservation: the unit moves from `held` to `reserved`. A reservation waiting for an
   * approval cannot be confirmed by anyone, including the person who raised it; one that needed no
   * approval is confirmed from `draft`, and one whose approvals were all granted from `approved`.
   */
  async confirmReservation(
    actor: ActorContext,
    reservationId: string,
    context: RequestContext,
  ): Promise<Reservation> {
    let current = await this.getReservation(actor, reservationId);
    if (current.state === 'pendingApproval') {
      // Settle first: an approval decided while nobody was listening is honoured here.
      await this.syncApproval(actor, current.approvals[0]?.requestId ?? '', context);
      current = await this.getReservation(actor, reservationId);
    }
    if (current.state === 'pendingApproval') {
      await this.audit(
        actor,
        {
          action: SALES_AUDIT_ACTIONS.reservationRefused,
          outcome: 'denied',
          reservationId,
          reason: 'confirmation refused: approval not granted',
        },
        context,
      );
      throw new SalesConflictError('approvalNotGranted');
    }
    if (current.state !== 'draft' && current.state !== 'approved') {
      throw new SalesConflictError('notConfirmable');
    }
    if (current.state === 'draft' && current.approvals.length > 0) {
      throw new SalesConflictError('approvalNotGranted');
    }

    return withTransaction(this.connection, async (session) => {
      const updated = await this.reservations
        .findOneAndUpdate(
          { reservationId, state: current.state },
          { $set: { state: 'confirmed', updatedAt: new Date() }, $inc: { version: 1 } },
          { returnDocument: 'after', session },
        )
        .lean<ReservationDocument>()
        .exec();
      if (!updated) throw new SalesConflictError('invalidTransition');
      await this.options.units.changeStatus(
        actor,
        {
          unitId: current.unitId,
          from: 'held',
          to: 'reserved',
          reason: `reservation ${current.reservationNumber} confirmed`,
          sourceType: 'reservation',
          sourceId: reservationId,
          reservationId,
          expectReservationId: reservationId,
        },
        context,
        session,
      );
      await this.audit(
        actor,
        {
          action: SALES_AUDIT_ACTIONS.reservationConfirmed,
          reservationId,
          changes: buildChangeSummary({ state: current.state }, { state: 'confirmed' }),
        },
        context,
        session,
      );
      return toReservation(updated);
    });
  }

  /**
   * SALE-RESERVE-005: cancel a live reservation. Through the approval engine when a policy governs
   * cancellation (`BD-05`) — the reservation then waits with its request — and at once otherwise.
   */
  async cancelReservation(
    actor: ActorContext,
    reservationId: string,
    reason: string,
    context: RequestContext,
  ): Promise<Reservation> {
    const current = await this.getReservation(actor, reservationId);
    // The draft is withdrawn first, through the contract; the reservation cannot vanish under it.
    if (current.contractId && current.state === 'confirmed') {
      throw conflict('CONTRACT_IN_PROGRESS', ['reservationId']);
    }
    if (!LIVE_RESERVATION_STATES.includes(current.state)) {
      return this.endReservation(
        actor,
        current,
        'cancelled',
        reason,
        SALES_AUDIT_ACTIONS.reservationCancelled,
        context,
      );
    }
    if (current.pendingCancellation) throw conflict('CANCELLATION_PENDING');
    const submitted = await this.options.approvals?.submit(
      actor,
      {
        operationType: SALES_APPROVAL_OPERATIONS.reservationCancellation,
        source: { type: 'reservation', id: reservationId },
        scope: this.approvalScope(current),
        context: { amount: current.agreedPrice },
        summary: [
          {
            label: { ar: 'رقم الحجز', en: 'Reservation number' },
            value: current.reservationNumber,
          },
          { label: { ar: 'سبب الإلغاء', en: 'Reason' }, value: reason.slice(0, 200) },
        ],
        idempotencyKey: `reservation-cancel-${reservationId}-${String(current.version)}`,
      },
      context,
    );
    if (!submitted) {
      return this.endReservation(
        actor,
        current,
        'cancelled',
        reason,
        SALES_AUDIT_ACTIONS.reservationCancelled,
        context,
      );
    }
    await withTransaction(this.connection, async (session) => {
      const result = await this.reservations
        .updateOne(
          { reservationId, version: current.version, pendingCancellation: { $exists: false } },
          {
            $set: {
              pendingCancellation: { requestId: submitted.requestId, reason },
              updatedAt: new Date(),
            },
            $inc: { version: 1 },
          },
          { session },
        )
        .exec();
      if (result.modifiedCount === 0) throw conflict('STALE_VERSION');
      await this.audit(
        actor,
        { action: SALES_AUDIT_ACTIONS.reservationCancellationRequested, reservationId, reason },
        context,
        session,
      );
    });
    await this.syncApproval(actor, submitted.requestId, context);
    return this.findReservationOrThrow(reservationId);
  }

  /**
   * SALE-RESERVE-003: extend a live reservation. Through `sales.reservation.extension` approval when a
   * policy applies; at once otherwise, for a holder of `sales.reservation.extend`.
   */
  async extendReservation(
    actor: ActorContext,
    reservationId: string,
    input: ExtendReservation,
    context: RequestContext,
  ): Promise<Reservation> {
    const current = await this.getReservation(actor, reservationId);
    if (!LIVE_RESERVATION_STATES.includes(current.state)) throw conflict('RESERVATION_NOT_LIVE');
    if (current.version !== input.expectedVersion) throw conflict('STALE_VERSION');
    if (current.pendingExtension) throw conflict('EXTENSION_PENDING');
    const submitted = await this.options.approvals?.submit(
      actor,
      {
        operationType: SALES_APPROVAL_OPERATIONS.reservationExtension,
        source: { type: 'reservation', id: reservationId },
        scope: this.approvalScope(current),
        context: { isException: true },
        summary: [
          {
            label: { ar: 'رقم الحجز', en: 'Reservation number' },
            value: current.reservationNumber,
          },
          { label: { ar: 'أيام التمديد', en: 'Days' }, value: String(input.days) },
        ],
        idempotencyKey: `reservation-extend-${reservationId}-${String(current.extensions + 1)}`,
      },
      context,
    );
    if (!submitted) return this.applyExtension(actor, current, input.days, input.reason, context);
    await withTransaction(this.connection, async (session) => {
      const result = await this.reservations
        .updateOne(
          { reservationId, version: current.version, pendingExtension: { $exists: false } },
          {
            $set: {
              pendingExtension: {
                days: input.days,
                requestId: submitted.requestId,
                reason: input.reason,
              },
              updatedAt: new Date(),
            },
            $inc: { version: 1 },
          },
          { session },
        )
        .exec();
      if (result.modifiedCount === 0) throw conflict('STALE_VERSION');
      await this.audit(
        actor,
        {
          action: SALES_AUDIT_ACTIONS.reservationExtensionRequested,
          reservationId,
          reason: `${String(input.days)} days: ${input.reason}`,
        },
        context,
        session,
      );
    });
    await this.syncApproval(actor, submitted.requestId, context);
    return this.findReservationOrThrow(reservationId);
  }

  private async applyExtension(
    actor: ActorContext,
    current: Reservation,
    days: number,
    reason: string,
    context: RequestContext,
  ): Promise<Reservation> {
    const today = this.options.today();
    // From whichever is later, so an extension never shortens a reservation.
    const from = current.expiresOn > today ? current.expiresOn : today;
    const expiresOn = addDays(from, days);
    return withTransaction(this.connection, async (session) => {
      const updated = await this.reservations
        .findOneAndUpdate(
          { reservationId: current.reservationId, state: { $in: [...LIVE_RESERVATION_STATES] } },
          {
            $set: { expiresOn, updatedAt: new Date() },
            $unset: { pendingExtension: '' },
            $inc: { version: 1, extensions: 1 },
          },
          { returnDocument: 'after', session },
        )
        .lean<ReservationDocument>()
        .exec();
      if (!updated) throw conflict('RESERVATION_NOT_LIVE');
      await this.audit(
        actor,
        {
          action: SALES_AUDIT_ACTIONS.reservationExtended,
          reservationId: current.reservationId,
          reason,
          changes: buildChangeSummary({ expiresOn: current.expiresOn }, { expiresOn }),
        },
        context,
        session,
      );
      return toReservation(updated);
    });
  }

  /**
   * Release reservations whose deadline has passed. Idempotent: the state is part of every update
   * filter. A reservation with an extension awaiting a decision keeps its unit until it is decided.
   */
  async expireReservations(
    actor: ActorContext,
    context: RequestContext,
  ): Promise<{ expired: number }> {
    const today = this.options.today();
    const candidates = await this.reservations
      .find({
        state: { $in: [...LIVE_RESERVATION_STATES] },
        expiresOn: { $lt: today },
        pendingExtension: { $exists: false },
        // A confirmed reservation with a contract draft is the contract's now; it does not expire.
        contractId: { $exists: false },
      })
      .limit(200)
      .lean<ReservationDocument[]>()
      .exec();

    let expired = 0;
    for (const document of candidates) {
      try {
        await this.endReservation(
          actor,
          toReservation(document),
          'expired',
          `hold expired on ${document.expiresOn}`,
          SALES_AUDIT_ACTIONS.reservationExpired,
          context,
        );
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

  /** The maintenance sweep: expire overdue reservations and settle decided approvals. */
  async sweep(
    actor: ActorContext,
    context: RequestContext,
  ): Promise<{ expired: number; settled: number }> {
    let settled = 0;
    const waiting = await this.reservations
      .find({
        $or: [
          { state: 'pendingApproval' },
          { pendingExtension: { $exists: true } },
          { pendingCancellation: { $exists: true } },
        ],
      })
      .limit(200)
      .lean<ReservationDocument[]>()
      .exec();
    for (const document of waiting) {
      const requestIds = [
        ...approvalsOf(document)
          .map((entry) => entry.requestId)
          .slice(0, 1),
        ...(document.pendingExtension ? [document.pendingExtension.requestId] : []),
        ...(document.pendingCancellation ? [document.pendingCancellation.requestId] : []),
      ];
      for (const requestId of requestIds) {
        try {
          if ((await this.syncApproval(actor, requestId, context)) !== 'unchanged') settled += 1;
        } catch (error) {
          this.options.logger.warn(
            {
              err: error,
              code: 'RESERVATION_APPROVAL_SYNC_SKIPPED',
              reservationId: document.reservationId,
            },
            'A reservation approval could not be settled; the sweep continued.',
          );
        }
      }
    }
    settled += await this.sweepContracts(actor, context);
    const { expired } = await this.expireReservations(actor, context);
    return { expired, settled };
  }

  async listReservations(actor: ActorContext, query: ReservationQuery): Promise<ReservationPage> {
    const requested: Record<string, unknown> = {};
    for (const key of [
      'state',
      'projectId',
      'customerId',
      'unitId',
      'opportunityId',
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

  /** Reservations and contracts by document-number prefix, inside the actor's scope (CORE-SEARCH-001). */
  async searchReservations(
    actor: ActorContext,
    term: string,
    limit: number,
  ): Promise<{ id: string; label: string; status: string }[]> {
    const filter = withScope(buildScopeFilter(actor, SALES_SCOPE_FIELDS), {
      reservationNumber: {
        $regex: `^${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        $options: 'i',
      },
    });
    const rows = await this.reservations
      .find(filter, { reservationId: 1, reservationNumber: 1, state: 1 })
      .sort({ reservationNumber: 1 })
      .limit(limit)
      .lean<ReservationDocument[]>()
      .exec();
    return rows.map((row) => ({
      id: row.reservationId,
      label: row.reservationNumber,
      status: row.state,
    }));
  }

  async searchContracts(
    actor: ActorContext,
    term: string,
    limit: number,
  ): Promise<{ id: string; label: string; status: string }[]> {
    const filter = withScope(buildScopeFilter(actor, SALES_SCOPE_FIELDS), {
      contractNumber: { $regex: `^${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' },
    });
    const rows = await this.contracts
      .find(filter, { contractId: 1, contractNumber: 1, state: 1 })
      .sort({ contractNumber: 1 })
      .limit(limit)
      .lean<ContractDocument[]>()
      .exec();
    return rows.map((row) => ({
      id: row.contractId,
      label: row.contractNumber,
      status: row.state,
    }));
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
   * SALE-CONTRACT-001. Draft a contract from a confirmed reservation.
   *
   * The draft carries **snapshots** — the buyer, the unit and the agreed price as they stand today —
   * its parties, its number and a proposed schedule, and nothing else moves: the unit stays the
   * reservation's, no instalment exists and nothing is collectible. Activation (below) is what commits
   * the unit and freezes the schedule. The reservation records the draft, so it can neither expire nor
   * be cancelled underneath it.
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
      parties: input.parties ?? null,
    });
    const replay = await this.replayContract(input.idempotencyKey, print);
    if (replay) {
      return {
        contract: restrictContract(actor, replay),
        installments: await this.listContractInstallments(actor, replay.contractId),
        replayed: true,
      };
    }

    const reservation = await this.getReservation(actor, input.reservationId);
    if (reservation.state !== 'confirmed') throw new SalesConflictError('reservationNotConfirmed');
    if (reservation.contractId) throw conflict('CONTRACT_IN_PROGRESS', ['reservationId']);

    const plan = input.paymentPlan ?? reservation.paymentPlan;
    const price = reservation.agreedPrice;
    const rows = buildInstallmentSchedule(price, plan);
    const total = scheduleTotal(price, plan);
    this.assertReconciles(rows, total);
    // Money already taken can never exceed what the contract is worth: it would have nowhere to go.
    if (compareMoney(reservation.reservationAmount, total) > 0) {
      throw invalid('RESERVATION_EXCEEDS_TOTAL', ['paymentPlan']);
    }

    const parties = await this.resolveParties(
      actor,
      input.parties ?? [
        { role: 'buyer', customerId: reservation.customerId, sharePercent: '100' },
      ],
      reservation.customerId,
    );
    const customerSnapshot = await this.options.customers?.snapshot(actor, reservation.customerId);
    const unitSnapshot = await this.options.unitSnapshots?.snapshot(reservation.unitId);
    const exceptions: Contract['exceptions'] =
      input.paymentPlan && !samePlan(input.paymentPlan, reservation.paymentPlan)
        ? ['planChanged']
        : [];

    const contractId = newId('ctr');
    try {
      return await withTransaction(this.connection, async (session) => {
        const contractNumber = await this.documentNumber(
          'contract',
          { id: contractId, projectId: reservation.projectId },
          session,
        );
        const now = new Date();
        const zero = money('0', total.currency);

        const contractDocument: ContractDocument = {
          contractId,
          contractNumber,
          customerId: reservation.customerId,
          unitId: reservation.unitId,
          projectId: reservation.projectId,
          reservationId: reservation.reservationId,
          ...(reservation.leadId ? { leadId: reservation.leadId } : {}),
          ...(reservation.opportunityId ? { opportunityId: reservation.opportunityId } : {}),
          contractedOn: input.contractedOn,
          totalPrice: fromMoney(total),
          reservationAmount: fromMoney(reservation.reservationAmount),
          paymentPlan: fromPlan(plan),
          // Nothing is owed on a draft; activation writes the real figures with the schedule.
          outstandingAmount: fromMoney(total),
          paidAmount: fromMoney(zero),
          ...(customerSnapshot ? { customerSnapshot: { ...customerSnapshot } } : {}),
          ...(unitSnapshot ? { unitSnapshot: { ...unitSnapshot } } : {}),
          pricing: {
            ...(reservation.listPrice ? { listPrice: fromMoney(reservation.listPrice) } : {}),
            agreedPrice: fromMoney(price),
            discountPercentage: reservation.discountPercentage,
            reservationAmount: fromMoney(reservation.reservationAmount),
            ...(plan.maintenanceDeposit
              ? { maintenanceDeposit: fromMoney(plan.maintenanceDeposit.amount) }
              : {}),
          },
          parties,
          signing: { state: 'unsigned' },
          exceptions,
          approvals: [],
          amendments: [],
          refundHandoff: 'notApplicable',
          salesOwnerAccountId: reservation.salesOwnerAccountId,
          legalEntityId: reservation.legalEntityId,
          branchId: reservation.branchId,
          ...(reservation.departmentId ? { departmentId: reservation.departmentId } : {}),
          ...(reservation.teamId ? { teamId: reservation.teamId } : {}),
          state: 'draft',
          idempotencyKey: input.idempotencyKey,
          idempotencyFingerprint: print,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        const [createdContract] = await this.contracts.create([contractDocument], { session });
        if (!createdContract) throw new SalesConflictError('contractNotCreated');

        // The reservation now points at its draft; the condition makes two drafts for one sale lose.
        const claimed = await this.reservations
          .updateOne(
            {
              reservationId: reservation.reservationId,
              state: 'confirmed',
              contractId: { $exists: false },
            },
            { $set: { contractId, updatedAt: now }, $inc: { version: 1 } },
            { session },
          )
          .exec();
        if (claimed.modifiedCount !== 1) throw conflict('CONTRACT_IN_PROGRESS', ['reservationId']);

        await this.contractAudit(
          actor,
          {
            action: SALES_AUDIT_ACTIONS.contractCreated,
            contractId,
            changes: buildChangeSummary(undefined, {
              contractNumber,
              reservationId: reservation.reservationId,
              unitId: reservation.unitId,
              state: 'draft',
              parties: String(parties.length),
              ...(exceptions.length > 0 ? { exceptions: exceptions.join(',') } : {}),
            }),
          },
          context,
          session,
        );
        return {
          contract: restrictContract(actor, toContract(createdContract.toObject())),
          installments: [],
          replayed: false,
        };
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        const stored = await this.replayContract(input.idempotencyKey, print);
        if (stored) {
          return {
            contract: restrictContract(actor, stored),
            installments: await this.listContractInstallments(actor, stored.contractId),
            replayed: true,
          };
        }
        throw new SalesConflictError('contractAlreadyExists');
      }
      throw error;
    }
  }

  /**
   * Validate parties (SALE-CONTRACT-002) and snapshot each name. Every person must be a customer the
   * actor can see; the buyer is the reservation's customer.
   */
  private async resolveParties(
    actor: ActorContext,
    parties: readonly ContractPartyInput[],
    reservationCustomerId: string,
  ): Promise<NonNullable<ContractDocument['parties']>> {
    const problem = partyIssues(parties, reservationCustomerId);
    if (problem) throw invalid(problem.issue, ['parties', problem.index]);
    const resolved: NonNullable<ContractDocument['parties']> = [];
    for (const [index, party] of parties.entries()) {
      let name: string | undefined;
      if (this.options.customers) {
        const found = await this.options.customers.inScope(actor, party.customerId);
        if (!found) throw invalid('PARTY_NOT_FOUND', ['parties', index, 'customerId']);
        name = found.name;
      }
      resolved.push({
        role: party.role,
        customerId: party.customerId,
        ...(party.sharePercent !== undefined ? { sharePercent: party.sharePercent } : {}),
        ...(name ? { name } : {}),
      });
    }
    return resolved;
  }

  private contractAudit(
    actor: ActorContext,
    entry: {
      action: string;
      outcome?: 'succeeded' | 'denied';
      contractId: string;
      reason?: string;
      changes?: { path: string; from?: string; to?: string }[];
    },
    context: RequestContext,
    session?: ClientSession,
  ): Promise<unknown> {
    return this.options.audit.record(
      {
        action: entry.action,
        outcome: entry.outcome ?? 'succeeded',
        actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
        target: { type: 'contract', id: entry.contractId },
        ...(entry.changes ? { changes: entry.changes } : {}),
        ...(entry.reason ? { reason: entry.reason } : {}),
        context,
      },
      session ? { session } : {},
    );
  }

  private async findContractOrThrow(contractId: string): Promise<ContractDocument> {
    assertSafeFilter({ contractId });
    const document = await this.contracts.findOne({ contractId }).lean<ContractDocument>().exec();
    if (!document) throw new SalesNotFoundError('contract');
    return document;
  }

  /** Read a contract in scope and check the version the caller edited. */
  private async editableContract(
    actor: ActorContext,
    contractId: string,
    expectedVersion: number,
  ): Promise<ContractDocument> {
    await this.getContract(actor, contractId);
    const document = await this.findContractOrThrow(contractId);
    if (document.version !== expectedVersion) throw conflict('STALE_VERSION', ['expectedVersion']);
    return document;
  }

  /** SALE-CONTRACT-002. Parties change only while the contract is a draft. */
  async setParties(
    actor: ActorContext,
    contractId: string,
    input: SetContractParties,
    context: RequestContext,
  ): Promise<Contract> {
    const current = await this.editableContract(actor, contractId, input.expectedVersion);
    if (current.state !== 'draft') throw conflict('CONTRACT_NOT_DRAFT', ['parties']);
    const parties = await this.resolveParties(actor, input.parties, current.customerId);
    return withTransaction(this.connection, async (session) => {
      const updated = await this.contracts
        .findOneAndUpdate(
          { contractId, state: 'draft', version: current.version },
          { $set: { parties, updatedAt: new Date() }, $inc: { version: 1 } },
          { returnDocument: 'after', session },
        )
        .lean<ContractDocument>()
        .exec();
      if (!updated) throw conflict('STALE_VERSION', ['expectedVersion']);
      await this.contractAudit(
        actor,
        {
          action: SALES_AUDIT_ACTIONS.contractPartiesChanged,
          contractId,
          changes: buildChangeSummary(
            { parties: (current.parties ?? []).map((p) => `${p.role}:${p.customerId}`).join(',') },
            { parties: parties.map((p) => `${p.role}:${p.customerId}`).join(',') },
          ),
        },
        context,
        session,
      );
      return restrictContract(actor, toContract(updated));
    });
  }

  /**
   * SALE-CONTRACT-003. Record the signing date and, optionally, the signed copy — a document this
   * contract owns. Signing is a fact, recorded once. It is **not** required for activation until
   * `BD-35` decides it; a contract without it carries the `notSigned` warning.
   */
  async recordSigning(
    actor: ActorContext,
    contractId: string,
    input: RecordSigning,
    context: RequestContext,
  ): Promise<Contract> {
    const current = await this.editableContract(actor, contractId, input.expectedVersion);
    if (!['draft', 'pendingApproval', 'active'].includes(current.state)) {
      throw conflict('INVALID_TRANSITION', ['state']);
    }
    if (current.signing?.state === 'signed') throw conflict('ALREADY_SIGNED', ['signedOn']);
    if (input.signedOn > this.options.today()) throw invalid('SIGNED_IN_FUTURE', ['signedOn']);
    if (input.documentId) {
      const owner = await this.options.signedCopies?.ownerOf(actor, input.documentId);
      if (!owner || owner.type !== 'contract' || owner.id !== contractId) {
        throw invalid('DOCUMENT_NOT_OWNED_BY_CONTRACT', ['documentId']);
      }
    }
    return withTransaction(this.connection, async (session) => {
      const now = new Date();
      const updated = await this.contracts
        .findOneAndUpdate(
          { contractId, version: current.version },
          {
            $set: {
              signing: {
                state: 'signed',
                signedOn: input.signedOn,
                ...(input.documentId ? { documentId: input.documentId } : {}),
                recordedBy: actor.accountId,
                recordedAt: now,
              },
              updatedAt: now,
            },
            $inc: { version: 1 },
          },
          { returnDocument: 'after', session },
        )
        .lean<ContractDocument>()
        .exec();
      if (!updated) throw conflict('STALE_VERSION', ['expectedVersion']);
      await this.contractAudit(
        actor,
        {
          action: SALES_AUDIT_ACTIONS.contractSigned,
          contractId,
          changes: buildChangeSummary(
            { signing: 'unsigned' },
            { signing: 'signed', signedOn: input.signedOn },
          ),
        },
        context,
        session,
      );
      return restrictContract(actor, toContract(updated));
    });
  }

  /**
   * SALE-CONTRACT-003. Activate a draft. Where the draft carries an exception (a plan changed from the
   * one the reservation was approved with) and a published policy governs `sales.contract.exception`,
   * the contract waits in `pendingApproval` and is activated when the approval is granted. Otherwise the
   * permission alone activates it: the absence of a configured control is not an error (ADR-0024).
   */
  async activateContract(
    actor: ActorContext,
    contractId: string,
    input: ActivateContract,
    context: RequestContext,
  ): Promise<Contract> {
    let current = await this.editableContract(actor, contractId, input.expectedVersion);
    if (current.state === 'pendingApproval') {
      await this.syncContractApproval(actor, current.approvals?.at(-1)?.requestId ?? '', context);
      current = await this.findContractOrThrow(contractId);
    }
    if (current.state === 'pendingApproval') throw conflict('APPROVAL_PENDING', ['state']);
    if (current.state !== 'draft') throw conflict('INVALID_TRANSITION', ['state']);

    const exceptions = current.exceptions ?? [];
    if (exceptions.length > 0 && this.options.approvals) {
      const scope = this.approvalScope(current);
      const price = contractPrice(current);
      const governed =
        (await this.options.approvals.applies?.(actor, {
          operationType: SALES_APPROVAL_OPERATIONS.contractException,
          scope,
          context: { amount: price, isException: true },
        })) ?? true;
      if (governed) {
        const submitted = await this.options.approvals.submit(
          actor,
          {
            operationType: SALES_APPROVAL_OPERATIONS.contractException,
            source: { type: 'contract', id: contractId },
            scope,
            context: { amount: price, isException: true },
            summary: [
              { label: { ar: 'رقم العقد', en: 'Contract number' }, value: current.contractNumber },
              { label: { ar: 'الاستثناء', en: 'Exception' }, value: exceptions.join(', ') },
            ],
            idempotencyKey: `contract-exception-${contractId}-v${current.version}`,
          },
          context,
        );
        if (submitted) {
          await withTransaction(this.connection, async (session) => {
            const updated = await this.contracts
              .findOneAndUpdate(
                { contractId, state: 'draft', version: current.version },
                {
                  $set: { state: 'pendingApproval', updatedAt: new Date() },
                  $push: {
                    approvals: {
                      operationType: SALES_APPROVAL_OPERATIONS.contractException,
                      requestId: submitted.requestId,
                    },
                  },
                  $inc: { version: 1 },
                },
                { returnDocument: 'after', session },
              )
              .lean<ContractDocument>()
              .exec();
            if (!updated) throw conflict('STALE_VERSION', ['expectedVersion']);
            await this.contractAudit(
              actor,
              {
                action: SALES_AUDIT_ACTIONS.contractActivationRequested,
                contractId,
                reason: exceptions.join(', '),
              },
              context,
              session,
            );
          });
          // A policy that settles at once (an automatic approval) is honoured straight away.
          await this.syncContractApproval(actor, submitted.requestId, context);
          return restrictContract(actor, toContract(await this.findContractOrThrow(contractId)));
        }
      }
    }
    const activated = await this.applyActivation(actor, current, context);
    return restrictContract(actor, activated);
  }

  /**
   * Freeze the schedule and commit the unit, in one transaction: the contract becomes `active`, its
   * rows become instalments (the reservation's money credited earliest-first), the reservation becomes
   * `converted`, the unit `contracted`, and the lead and the opportunity `won`.
   */
  private async applyActivation(
    actor: ActorContext,
    current: ContractDocument,
    context: RequestContext,
  ): Promise<Contract> {
    const plan = toPlan(current.paymentPlan);
    const price = contractPrice(current);
    const total = toMoney(current.totalPrice);
    const rows = buildInstallmentSchedule(price, plan);
    this.assertReconciles(rows, total);
    const reservationAmount = toMoney(current.reservationAmount);
    const stored = this.applyReservationCredit(rows, reservationAmount);
    const paidAmount = stored.reduce<Money>(
      (running, row) => addMoney(running, row.paidAmount),
      money('0', total.currency),
    );
    const outstanding = subtractMoney(total, paidAmount);
    const reservation = await this.reservations
      .findOne({ reservationId: current.reservationId })
      .lean<ReservationDocument>()
      .exec();
    if (!reservation) throw new SalesNotFoundError('reservation');

    return withTransaction(this.connection, async (session) => {
      const now = new Date();
      const updated = await this.contracts
        .findOneAndUpdate(
          { contractId: current.contractId, state: current.state, version: current.version },
          {
            $set: {
              state: 'active',
              activatedAt: now,
              paidAmount: fromMoney(paidAmount),
              outstandingAmount: fromMoney(outstanding),
              updatedAt: now,
            },
            $inc: { version: 1 },
          },
          { returnDocument: 'after', session },
        )
        .lean<ContractDocument>()
        .exec();
      if (!updated) throw conflict('STALE_VERSION', ['expectedVersion']);

      const installmentDocuments: InstallmentDocument[] = stored.map((row) => ({
        installmentId: newId('inst'),
        contractId: current.contractId,
        customerId: current.customerId,
        unitId: current.unitId,
        projectId: current.projectId,
        sequence: row.sequence,
        kind: row.kind,
        dueOn: row.dueOn,
        amount: fromMoney(row.amount),
        paidAmount: fromMoney(row.paidAmount),
        remainingAmount: fromMoney(row.remainingAmount),
        state: row.state,
        ...(row.label ? { label: row.label } : {}),
        legalEntityId: current.legalEntityId,
        branchId: current.branchId,
        ...(current.teamId ? { teamId: current.teamId } : {}),
        salesOwnerAccountId: current.salesOwnerAccountId,
        version: 1,
        createdAt: now,
        updatedAt: now,
      }));
      // `ordered: true` is required by mongoose when creating several documents in a session, and
      // it is what we want anyway: the rows are inserted in sequence order.
      await this.installments.create(installmentDocuments, { session, ordered: true });

      const converted = await this.reservations
        .updateOne(
          {
            reservationId: current.reservationId,
            state: 'confirmed',
            contractId: current.contractId,
          },
          { $set: { state: 'converted', updatedAt: now }, $inc: { version: 1 } },
          { session },
        )
        .exec();
      if (converted.modifiedCount !== 1) throw new SalesConflictError('reservationNotConfirmed');

      await this.options.units.changeStatus(
        actor,
        {
          unitId: current.unitId,
          from: 'reserved',
          to: 'contracted',
          reason: `contract ${current.contractNumber}`,
          sourceType: 'contract',
          sourceId: current.contractId,
          contractId: current.contractId,
          reservationId: null,
          expectReservationId: current.reservationId,
        },
        context,
        session,
      );

      if (reservation.leadId && this.options.crm.advanceLead) {
        await this.options.crm.advanceLead(
          actor,
          reservation.leadId,
          'won',
          `contract ${current.contractNumber}`,
          context,
          session,
        );
      }
      if (reservation.opportunityId) {
        await this.options.opportunities?.advance(
          actor,
          reservation.opportunityId,
          'won',
          { contractId: current.contractId },
          `contract ${current.contractNumber}`,
          context,
          session,
        );
      }

      await this.contractAudit(
        actor,
        {
          action: SALES_AUDIT_ACTIONS.contractActivated,
          contractId: current.contractId,
          changes: buildChangeSummary(
            { state: current.state },
            { state: 'active', installments: String(stored.length) },
          ),
        },
        context,
        session,
      );
      await this.contractAudit(
        actor,
        {
          action: SALES_AUDIT_ACTIONS.scheduleGenerated,
          contractId: current.contractId,
          reason: `${stored.length} rows reconciling to the contract total`,
        },
        context,
        session,
      );
      return toContract(updated);
    });
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
      items: page.map((document) => restrictContract(actor, toContract(document))),
      total,
      limit: query.limit,
      ...(documents.length > query.limit && last
        ? { nextCursor: encodeCursor(last.createdAt, last.contractId) }
        : {}),
    };
  }

  /**
   * The actor's whole contract portfolio, totalled by the database inside the scope.
   *
   * `$sum` over `Decimal128` is exact decimal arithmetic in MongoDB, so no amount passes through a
   * JavaScript number, and the scope filter is part of the `$match` rather than applied afterwards
   * (SEC-028). One row per currency: amounts in different currencies are never added.
   */
  async contractSummary(
    actor: ActorContext,
    query: ContractSummaryQuery,
  ): Promise<ContractSummary> {
    const requested: Record<string, unknown> = {};
    if (query.state !== undefined) requested['state'] = query.state;
    assertSafeFilter(requested);
    // A draft commits nothing, so the portfolio leaves drafts out unless they are asked for.
    if (query.state === undefined) requested['state'] = { $nin: ['draft', 'pendingApproval'] };
    const filter = withScope(buildScopeFilter(actor, SALES_SCOPE_FIELDS), requested);
    const rows = await this.contracts
      .aggregate<{
        _id: string;
        contracts: number;
        totalContracted: Types.Decimal128;
        totalPaid: Types.Decimal128;
        totalOutstanding: Types.Decimal128;
      }>([
        { $match: filter },
        {
          $group: {
            _id: '$totalPrice.currency',
            contracts: { $sum: 1 },
            totalContracted: { $sum: '$totalPrice.amount' },
            totalPaid: { $sum: '$paidAmount.amount' },
            totalOutstanding: { $sum: '$outstandingAmount.amount' },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .exec();
    const byCurrency = rows.map((row) => ({
      currency: row._id,
      contracts: row.contracts,
      totalContracted: money(fromDecimal128(row.totalContracted), row._id),
      totalPaid: money(fromDecimal128(row.totalPaid), row._id),
      totalOutstanding: money(fromDecimal128(row.totalOutstanding), row._id),
    }));
    return {
      contracts: byCurrency.reduce((sum, row) => sum + row.contracts, 0),
      byCurrency,
    };
  }

  async getContract(actor: ActorContext, contractId: string): Promise<Contract> {
    assertSafeFilter({ contractId });
    const filter = withScope(buildScopeFilter(actor, SALES_SCOPE_FIELDS), { contractId });
    const document = await this.contracts.findOne(filter).lean<ContractDocument>().exec();
    if (!document) throw new SalesNotFoundError('contract');
    return restrictContract(actor, toContract(document));
  }

  /**
   * SALE-CANCEL-001. Cancel a contract **before any collection**.
   *
   * A draft (or one waiting on its activation approval) is simply withdrawn: nothing was committed,
   * the reservation stays confirmed and can be drafted again. An active contract is cancelled only
   * while the money on it is no more than the reservation's own — any receipt beyond that is a refund
   * with penalties and accounting (SALE-CANCEL-002, BMP-2) and is refused here. Where a published
   * policy governs `sales.contract.cancellation`, the cancellation waits for its approval.
   */
  async cancelContract(
    actor: ActorContext,
    contractId: string,
    input: CancelContract,
    context: RequestContext,
  ): Promise<Contract> {
    await this.getContract(actor, contractId);
    const current = await this.findContractOrThrow(contractId);
    if (!canTransitionContract(current.state, 'cancelled')) {
      await this.contractAudit(actor, {
        action: SALES_AUDIT_ACTIONS.contractRefused,
        outcome: 'denied',
        contractId,
        reason: `refused transition ${current.state} -> cancelled`,
      }, context);
      throw new SalesConflictError('invalidTransition');
    }

    if (current.state === 'draft' || current.state === 'pendingApproval') {
      return restrictContract(
        actor,
        await this.withdrawDraft(actor, current, input.reason, context),
      );
    }

    if (current.pendingCancellation) throw conflict('CANCELLATION_PENDING', ['reason']);
    this.assertNoCollections(current);

    if (this.options.approvals) {
      const scope = this.approvalScope(current);
      const submitted = await this.options.approvals.submit(
        actor,
        {
          operationType: SALES_APPROVAL_OPERATIONS.contractCancellation,
          source: { type: 'contract', id: contractId },
          scope,
          context: { amount: toMoney(current.totalPrice) },
          summary: [
            { label: { ar: 'رقم العقد', en: 'Contract number' }, value: current.contractNumber },
            { label: { ar: 'سبب الإلغاء', en: 'Cancellation reason' }, value: input.reason },
          ],
          idempotencyKey: `contract-cancellation-${contractId}-v${current.version}`,
        },
        context,
      );
      if (submitted) {
        await withTransaction(this.connection, async (session) => {
          const updated = await this.contracts
            .updateOne(
              { contractId, state: 'active', pendingCancellation: { $exists: false } },
              {
                $set: {
                  pendingCancellation: { requestId: submitted.requestId, reason: input.reason },
                  updatedAt: new Date(),
                },
                $push: {
                  approvals: {
                    operationType: SALES_APPROVAL_OPERATIONS.contractCancellation,
                    requestId: submitted.requestId,
                  },
                },
                $inc: { version: 1 },
              },
              { session },
            )
            .exec();
          if (updated.modifiedCount !== 1) throw conflict('CANCELLATION_PENDING', ['reason']);
          await this.contractAudit(
            actor,
            {
              action: SALES_AUDIT_ACTIONS.contractCancellationRequested,
              contractId,
              reason: input.reason,
            },
            context,
            session,
          );
        });
        await this.syncContractApproval(actor, submitted.requestId, context);
        return restrictContract(actor, toContract(await this.findContractOrThrow(contractId)));
      }
    }
    return restrictContract(
      actor,
      await this.applyCancellation(actor, current, input.reason, input.releaseUnit, context),
    );
  }

  /**
   * Money beyond the reservation's own means a receipt was taken on the contract; cancelling it is a
   * refund, which BMP-2 owns (SALE-CANCEL-002). Stranding receipts here would put the books out by
   * exactly that amount.
   */
  private assertNoCollections(current: ContractDocument): void {
    if (compareMoney(toMoney(current.paidAmount), toMoney(current.reservationAmount)) > 0) {
      throw new SalesConflictError('contractHasCollections');
    }
  }

  private async withdrawDraft(
    actor: ActorContext,
    current: ContractDocument,
    reason: string,
    context: RequestContext,
  ): Promise<Contract> {
    return withTransaction(this.connection, async (session) => {
      const now = new Date();
      const updated = await this.contracts
        .findOneAndUpdate(
          { contractId: current.contractId, state: current.state },
          {
            $set: { state: 'cancelled', cancellationReason: reason, updatedAt: now },
            $inc: { version: 1 },
          },
          { returnDocument: 'after', session },
        )
        .lean<ContractDocument>()
        .exec();
      if (!updated) throw new SalesConflictError('invalidTransition');
      // The reservation is confirmed and free to be drafted again.
      await this.reservations
        .updateOne(
          { reservationId: current.reservationId, contractId: current.contractId },
          { $unset: { contractId: '' }, $set: { updatedAt: now }, $inc: { version: 1 } },
          { session },
        )
        .exec();
      await this.contractAudit(
        actor,
        {
          action: SALES_AUDIT_ACTIONS.contractCancelled,
          contractId: current.contractId,
          reason,
          changes: buildChangeSummary({ state: current.state }, { state: 'cancelled' }),
        },
        context,
        session,
      );
      return toContract(updated);
    });
  }

  private async applyCancellation(
    actor: ActorContext,
    current: ContractDocument,
    reason: string,
    releaseUnit: boolean,
    context: RequestContext,
  ): Promise<Contract> {
    this.assertNoCollections(current);
    const refund =
      compareMoney(toMoney(current.paidAmount), money('0', current.paidAmount.currency)) > 0
        ? 'pending'
        : 'notApplicable';
    return withTransaction(this.connection, async (session) => {
      const now = new Date();
      const updated = await this.contracts
        .findOneAndUpdate(
          { contractId: current.contractId, state: 'active' },
          {
            $set: {
              state: 'cancelled',
              cancellationReason: reason,
              refundHandoff: refund,
              updatedAt: now,
            },
            $unset: { pendingCancellation: '' },
            $inc: { version: 1 },
          },
          { returnDocument: 'after', session },
        )
        .lean<ContractDocument>()
        .exec();
      if (!updated) throw new SalesConflictError('invalidTransition');

      // Instalments are cancelled, never deleted: the schedule that existed is part of the history.
      // Paid and rescheduled rows keep their state — each is a fact about money or a past amendment.
      await this.installments
        .updateMany(
          {
            contractId: current.contractId,
            state: { $nin: ['paid', 'cancelled', 'rescheduled'] },
          },
          { $set: { state: 'cancelled', updatedAt: now }, $inc: { version: 1 } },
          { session },
        )
        .exec();

      if (releaseUnit) {
        await this.options.units.changeStatus(
          actor,
          {
            unitId: current.unitId,
            from: 'contracted',
            to: 'available',
            reason: `contract ${current.contractNumber} cancelled`,
            sourceType: 'contract',
            sourceId: current.contractId,
            contractId: null,
          },
          context,
          session,
        );
      }

      await this.contractAudit(
        actor,
        {
          action: SALES_AUDIT_ACTIONS.contractCancelled,
          contractId: current.contractId,
          reason,
          changes: buildChangeSummary(
            { state: current.state },
            { state: 'cancelled', refundHandoff: refund },
          ),
        },
        context,
        session,
      );
      return toContract(updated);
    });
  }

  /**
   * SALE-CHANGE-001, COL-SCHEDULE-002. Ask to replace every **unpaid** row of an active contract with
   * a new plan for exactly what those rows still owe. A confirmed schedule changes only by an approved
   * amendment, so this is refused outright where no published policy governs
   * `sales.contract.amendment` (`BD-09`). Partly paid rows and the maintenance deposit are kept.
   */
  async requestAmendment(
    actor: ActorContext,
    contractId: string,
    input: AmendContract,
    context: RequestContext,
  ): Promise<Contract> {
    const current = await this.editableContract(actor, contractId, input.expectedVersion);
    if (current.state !== 'active') throw conflict('CONTRACT_NOT_ACTIVE', ['state']);
    if ((current.amendments ?? []).some((entry) => entry.state === 'pending')) {
      throw conflict('AMENDMENT_PENDING', ['plan']);
    }
    if (current.pendingCancellation) throw conflict('CANCELLATION_PENDING', ['plan']);
    if (input.plan.firstDueOn < this.options.today()) {
      throw invalid('FIRST_DUE_IN_PAST', ['plan', 'firstDueOn']);
    }

    const scope = this.approvalScope(current);
    const governed =
      this.options.approvals !== undefined &&
      ((await this.options.approvals.applies?.(actor, {
        operationType: SALES_APPROVAL_OPERATIONS.contractAmendment,
        scope,
        context: { amount: toMoney(current.totalPrice) },
      })) ??
        true);
    if (!governed) {
      await this.contractAudit(
        actor,
        {
          action: SALES_AUDIT_ACTIONS.contractRefused,
          outcome: 'denied',
          contractId,
          reason: 'amendment refused: no approval policy governs it',
        },
        context,
      );
      throw conflict('AMENDMENT_NEEDS_POLICY', ['plan']);
    }

    const rows = await this.installments
      .find({ contractId })
      .sort({ sequence: 1 })
      .lean<InstallmentDocument[]>()
      .exec();
    const zero = money('0', current.totalPrice.currency);
    const replaced = rows.filter(
      (row) =>
        UNPAID_STATES.includes(row.state) &&
        row.kind !== 'maintenanceDeposit' &&
        compareMoney(toMoney(row.paidAmount), zero) === 0,
    );
    if (replaced.length === 0) throw conflict('NOTHING_TO_AMEND', ['plan']);
    const owed = replaced.reduce<Money>((sum, row) => addMoney(sum, toMoney(row.amount)), zero);
    const lastSequence = rows.reduce((max, row) => Math.max(max, row.sequence), 0);
    let newRows: ScheduleRow[];
    try {
      newRows = amendmentRows(owed, input.plan, lastSequence);
    } catch (error) {
      throw invalid((error as { issue?: string }).issue ?? 'SCHEDULE_INVALID', ['plan']);
    }

    const amendmentId = newId('amd');
    const now = new Date();
    const amendment: StoredAmendment = {
      amendmentId,
      state: 'pending',
      reason: input.reason,
      plan: {
        installmentCount: input.plan.installmentCount,
        frequency: input.plan.frequency,
        firstDueOn: input.plan.firstDueOn,
        ...(input.plan.finalPayment ? { finalPayment: fromMoney(input.plan.finalPayment) } : {}),
      },
      replacedInstallmentIds: replaced.map((row) => row.installmentId),
      amount: fromMoney(owed),
      rows: newRows.map(fromRow),
      requestedBy: actor.accountId,
      requestedAt: now,
    };
    await withTransaction(this.connection, async (session) => {
      const updated = await this.contracts
        .updateOne(
          { contractId, state: 'active', version: current.version },
          {
            $push: { amendments: amendment },
            $set: { updatedAt: now },
            $inc: { version: 1 },
          },
          { session },
        )
        .exec();
      if (updated.modifiedCount !== 1) throw conflict('STALE_VERSION', ['expectedVersion']);
      await this.contractAudit(
        actor,
        {
          action: SALES_AUDIT_ACTIONS.contractAmendmentRequested,
          contractId,
          reason: input.reason,
          changes: buildChangeSummary(undefined, {
            amendmentId,
            replacedRows: String(replaced.length),
            newRows: String(newRows.length),
            owed: `${owed.amount} ${owed.currency}`,
          }),
        },
        context,
        session,
      );
    });

    // Submitted after the commit, so no approval ever points at an amendment that does not exist.
    const submitted = await this.options.approvals?.submit(
      actor,
      {
        operationType: SALES_APPROVAL_OPERATIONS.contractAmendment,
        source: { type: 'contract', id: contractId },
        scope,
        context: { amount: owed },
        summary: [
          { label: { ar: 'رقم العقد', en: 'Contract number' }, value: current.contractNumber },
          { label: { ar: 'المبلغ المعاد جدولته', en: 'Amount rescheduled' }, value: `${owed.amount} ${owed.currency}` },
          { label: { ar: 'عدد الأقساط الجديدة', en: 'New instalments' }, value: String(newRows.length) },
        ],
        idempotencyKey: `contract-amendment-${amendmentId}`,
      },
      context,
    );
    if (!submitted) {
      // The policy went away between the check and the submission: the amendment cannot be approved.
      await this.settleAmendment(actor, contractId, amendmentId, 'rejected', context);
    } else {
      await this.contracts
        .updateOne(
          { contractId, 'amendments.amendmentId': amendmentId },
          {
            $set: { 'amendments.$.requestId': submitted.requestId },
            $push: {
              approvals: {
                operationType: SALES_APPROVAL_OPERATIONS.contractAmendment,
                requestId: submitted.requestId,
              },
            },
          },
        )
        .exec();
      await this.syncContractApproval(actor, submitted.requestId, context);
    }
    return restrictContract(actor, toContract(await this.findContractOrThrow(contractId)));
  }

  /** Mark a pending amendment rejected or stale; the schedule is untouched. */
  private async settleAmendment(
    actor: ActorContext,
    contractId: string,
    amendmentId: string,
    to: 'rejected' | 'stale',
    context: RequestContext,
  ): Promise<void> {
    await withTransaction(this.connection, async (session) => {
      const now = new Date();
      const updated = await this.contracts
        .updateOne(
          {
            contractId,
            amendments: { $elemMatch: { amendmentId, state: 'pending' } },
          },
          {
            $set: {
              'amendments.$.state': to,
              'amendments.$.decidedAt': now,
              updatedAt: now,
            },
            $inc: { version: 1 },
          },
          { session },
        )
        .exec();
      if (updated.modifiedCount !== 1) return;
      await this.contractAudit(
        actor,
        {
          action: SALES_AUDIT_ACTIONS.contractAmendmentRejected,
          contractId,
          reason: to === 'stale' ? 'the rows it replaced were paid meanwhile' : 'approval refused',
          changes: buildChangeSummary({ amendment: 'pending' }, { amendment: to }),
        },
        context,
        session,
      );
    });
  }

  /**
   * Apply an approved amendment in one transaction: the replaced rows become `rescheduled` (never
   * deleted), the new rows are inserted, and the totals are recomputed — they cannot change, because
   * the new rows add up to exactly what the old ones owed. If any replaced row took money after the
   * request, the amendment is **stale** and nothing changes.
   */
  private async applyAmendment(
    actor: ActorContext,
    contract: ContractDocument,
    amendment: StoredAmendment,
    context: RequestContext,
  ): Promise<'amended' | 'stale'> {
    const outcome = await withTransaction(this.connection, async (session) => {
      const now = new Date();
      const zero = money('0', contract.totalPrice.currency);
      const current = await this.installments
        .find({ installmentId: { $in: amendment.replacedInstallmentIds } })
        .session(session)
        .lean<InstallmentDocument[]>()
        .exec();
      const stillUnpaid =
        current.length === amendment.replacedInstallmentIds.length &&
        current.every(
          (row) =>
            UNPAID_STATES.includes(row.state) &&
            compareMoney(toMoney(row.paidAmount), zero) === 0,
        );
      if (!stillUnpaid) return 'stale' as const;

      const moved = await this.installments
        .updateMany(
          {
            installmentId: { $in: amendment.replacedInstallmentIds },
            state: { $in: [...UNPAID_STATES] },
          },
          { $set: { state: 'rescheduled', updatedAt: now }, $inc: { version: 1 } },
          { session },
        )
        .exec();
      if (moved.modifiedCount !== amendment.replacedInstallmentIds.length) {
        throw conflict('STALE_VERSION', ['amendment']);
      }
      const today = this.options.today();
      await this.installments.create(
        amendment.rows.map((row) => ({
          installmentId: newId('inst'),
          contractId: contract.contractId,
          customerId: contract.customerId,
          unitId: contract.unitId,
          projectId: contract.projectId,
          sequence: row.sequence,
          kind: row.kind,
          dueOn: row.dueOn,
          amount: row.amount,
          paidAmount: fromMoney(zero),
          remainingAmount: row.amount,
          state: row.dueOn <= today ? 'due' : 'upcoming',
          amendmentId: amendment.amendmentId,
          legalEntityId: contract.legalEntityId,
          branchId: contract.branchId,
          ...(contract.teamId ? { teamId: contract.teamId } : {}),
          salesOwnerAccountId: contract.salesOwnerAccountId,
          version: 1,
          createdAt: now,
          updatedAt: now,
        })),
        { session, ordered: true },
      );
      const marked = await this.contracts
        .updateOne(
          {
            contractId: contract.contractId,
            amendments: { $elemMatch: { amendmentId: amendment.amendmentId, state: 'pending' } },
          },
          {
            $set: {
              'amendments.$.state': 'applied',
              'amendments.$.decidedAt': now,
              updatedAt: now,
            },
            $inc: { version: 1 },
          },
          { session },
        )
        .exec();
      if (marked.modifiedCount !== 1) throw conflict('STALE_VERSION', ['amendment']);
      await this.recomputeContractTotals(contract.contractId, session);
      await this.contractAudit(
        actor,
        {
          action: SALES_AUDIT_ACTIONS.contractAmended,
          contractId: contract.contractId,
          reason: amendment.reason,
          changes: buildChangeSummary(
            { rows: String(amendment.replacedInstallmentIds.length) },
            { rows: String(amendment.rows.length), amendmentId: amendment.amendmentId },
          ),
        },
        context,
        session,
      );
      return 'amended' as const;
    });
    if (outcome === 'stale') {
      await this.settleAmendment(actor, contract.contractId, amendment.amendmentId, 'stale', context);
    }
    return outcome;
  }

  /**
   * Act on a decided approval for a contract (ADR-0024 §2): its activation exception, an amendment, or
   * a cancellation. Idempotent — every move is conditional on the state it read.
   */
  async syncContractApproval(
    actor: ActorContext,
    requestId: string,
    context: RequestContext,
  ): Promise<'activated' | 'amended' | 'stale' | 'cancelled' | 'rejected' | 'refused' | 'unchanged'> {
    if (!requestId || !this.options.approvals) return 'unchanged';
    assertSafeFilter({ requestId });
    const document = await this.contracts
      .findOne({
        $or: [
          { 'approvals.requestId': requestId },
          { 'amendments.requestId': requestId },
          { 'pendingCancellation.requestId': requestId },
        ],
      })
      .lean<ContractDocument>()
      .exec();
    if (!document) return 'unchanged';
    const state = await this.options.approvals.state(requestId);
    const refused = state === 'rejected' || state === 'cancelled' || state === 'expired';

    const amendment = (document.amendments ?? []).find(
      (entry) => entry.requestId === requestId && entry.state === 'pending',
    );
    if (amendment) {
      if (state === 'approved') return this.applyAmendment(actor, document, amendment, context);
      if (refused) {
        await this.settleAmendment(actor, document.contractId, amendment.amendmentId, 'rejected', context);
        return 'rejected';
      }
      return 'unchanged';
    }

    if (document.pendingCancellation?.requestId === requestId) {
      if (state === 'approved' && document.state === 'active') {
        await this.applyCancellation(actor, document, document.pendingCancellation.reason, true, context);
        return 'cancelled';
      }
      if (refused) {
        await this.contracts
          .updateOne(
            { contractId: document.contractId, 'pendingCancellation.requestId': requestId },
            { $unset: { pendingCancellation: '' }, $set: { updatedAt: new Date() }, $inc: { version: 1 } },
          )
          .exec();
        return 'refused';
      }
      return 'unchanged';
    }

    const latest = document.approvals?.at(-1);
    if (
      document.state === 'pendingApproval' &&
      latest?.requestId === requestId &&
      latest.operationType === SALES_APPROVAL_OPERATIONS.contractException
    ) {
      if (state === 'approved') {
        await this.applyActivation(actor, document, context);
        return 'activated';
      }
      if (refused) {
        await withTransaction(this.connection, async (session) => {
          const updated = await this.contracts
            .updateOne(
              { contractId: document.contractId, state: 'pendingApproval', version: document.version },
              { $set: { state: 'draft', updatedAt: new Date() }, $inc: { version: 1 } },
              { session },
            )
            .exec();
          if (updated.modifiedCount !== 1) return;
          await this.contractAudit(
            actor,
            {
              action: SALES_AUDIT_ACTIONS.contractActivationRejected,
              contractId: document.contractId,
              reason: 'the exception approval was refused; the contract is a draft again',
              changes: buildChangeSummary({ state: 'pendingApproval' }, { state: 'draft' }),
            },
            context,
            session,
          );
        });
        return 'rejected';
      }
    }
    return 'unchanged';
  }

  /** SALE-CONTRACT-004. The contract's trail — only for a contract the actor can read. */
  async contractHistory(
    actor: ActorContext,
    contractId: string,
  ): Promise<{ items: ContractHistoryEntry[] }> {
    await this.getContract(actor, contractId);
    return { items: (await this.options.history?.targetHistory({ type: 'contract', id: contractId })) ?? [] };
  }

  /** Settle every contract approval the engine decided while nobody was listening. */
  private async sweepContracts(actor: ActorContext, context: RequestContext): Promise<number> {
    let settled = 0;
    const waiting = await this.contracts
      .find({
        $or: [
          { state: 'pendingApproval' },
          { pendingCancellation: { $exists: true } },
          { amendments: { $elemMatch: { state: 'pending' } } },
        ],
      })
      .limit(200)
      .lean<ContractDocument[]>()
      .exec();
    for (const document of waiting) {
      const requestIds = [
        ...(document.state === 'pendingApproval' && document.approvals?.at(-1)
          ? [document.approvals.at(-1)?.requestId ?? '']
          : []),
        ...(document.pendingCancellation ? [document.pendingCancellation.requestId] : []),
        ...(document.amendments ?? [])
          .filter((entry) => entry.state === 'pending' && entry.requestId)
          .map((entry) => entry.requestId ?? ''),
      ];
      for (const requestId of requestIds) {
        try {
          if ((await this.syncContractApproval(actor, requestId, context)) !== 'unchanged') {
            settled += 1;
          }
        } catch (error) {
          this.options.logger.warn(
            { err: error, code: 'CONTRACT_APPROVAL_SYNC_SKIPPED', contractId: document.contractId },
            'A contract approval could not be settled; the sweep continued.',
          );
        }
      }
    }
    return settled;
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

  /**
   * Put a reversed payment back on an installment, inside the reversing transaction.
   *
   * The mirror of `applyPaymentToInstallment`, and it refuses to take back more than was paid — a
   * negative `paidAmount` is not a state the schedule can be in, and reaching it would corrupt every
   * balance computed from it afterwards.
   */
  async reversePaymentOnInstallment(
    installmentId: string,
    amount: Money,
    session: ClientSession,
  ): Promise<{ installment: Installment }> {
    assertSafeFilter({ installmentId });
    const current = await this.installments
      .findOne({ installmentId })
      .session(session)
      .lean<InstallmentDocument>()
      .exec();
    if (!current) throw new SalesNotFoundError('installment');

    const paid = toMoney(current.paidAmount);
    if (paid.currency !== amount.currency) throw new SalesValidationError('currencyMismatch');
    if (compareMoney(amount, paid) > 0) throw new SalesValidationError('reversalExceedsPaid');

    const newPaid = subtractMoney(paid, amount);
    const newRemaining = addMoney(toMoney(current.remainingAmount), amount);
    const zero = money('0', amount.currency);
    /**
     * The row goes back to being open. Whether it is `due`, `overdue` or `upcoming` is a function of
     * the calendar, not of this reversal, so it is set to `upcoming` and the refresh sweep — which is
     * the single place that decides — puts it right.
     */
    const state: Installment['state'] =
      compareMoney(newPaid, zero) === 0 ? 'upcoming' : 'partiallyPaid';

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
    if (!updated) throw new SalesConflictError('installmentChanged');
    return { installment: toInstallment(updated) };
  }

  /** Open installments of a contract, oldest first — what a receipt allocates against. */
  async listOpenInstallments(
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
  > {
    assertSafeFilter({ contractId });
    const documents = await this.installments
      .find({ contractId, state: { $in: ['upcoming', 'due', 'partiallyPaid', 'overdue'] } })
      .sort({ sequence: 1 })
      .session(session ?? null)
      .lean<InstallmentDocument[]>()
      .exec();
    return documents.map((row) => ({
      installmentId: row.installmentId,
      sequence: row.sequence,
      dueOn: row.dueOn as BusinessDate,
      remainingAmount: toMoney(row.remainingAmount),
      state: row.state,
    }));
  }

  /**
   * Installments falling due inside a window, for the reminder sweep.
   *
   * Unscoped, because the sweep runs for the organization rather than for a person; the reminders it
   * produces carry the installment's own placement, so **reading** them is scoped normally.
   */
  async listInstallmentsDueWithin(
    from: BusinessDate,
    to: BusinessDate,
    limit = 500,
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
  > {
    const documents = await this.installments
      .find({
        dueOn: { $gte: from, $lte: to },
        state: { $in: ['upcoming', 'due', 'partiallyPaid', 'overdue'] },
      })
      .sort({ dueOn: 1, installmentId: 1 })
      .limit(limit)
      .lean<InstallmentDocument[]>()
      .exec();
    return documents.map((row) => ({
      installmentId: row.installmentId,
      contractId: row.contractId,
      customerId: row.customerId,
      unitId: row.unitId,
      projectId: row.projectId,
      dueOn: row.dueOn as BusinessDate,
      remainingAmount: toMoney(row.remainingAmount),
      legalEntityId: row.legalEntityId,
      branchId: row.branchId,
      ...(row.teamId ? { teamId: row.teamId } : {}),
      salesOwnerAccountId: row.salesOwnerAccountId,
    }));
  }

  /** Allocate the next number in a series. Shared with collections so numbering is one mechanism. */
  async allocateNumber(prefix: string, session: ClientSession): Promise<string> {
    return this.nextNumber(prefix, session);
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
