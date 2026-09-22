import { z } from 'zod';
import { BusinessCodeSchema, NoteSchema, RecordIdSchema } from './identifiers';
import {
  MoneySchema,
  addMoney,
  allocateMoney,
  compareMoney,
  isNegativeMoney,
  money,
  subtractMoney,
  type Money,
} from './money';
import { BusinessDateSchema, InstantSchema, addMonths, type BusinessDate } from './time';

/**
 * Sales — `SALE-*` demonstration slice (ADR-0025).
 *
 * Reservation → contract → installment schedule. Two invariants run through all of it:
 *
 * - **A unit is committed exactly once.** Every state change that touches a unit happens inside the
 *   same transaction as the record that caused it, so there is no window in which a unit is reserved
 *   by a reservation that does not exist, or free while a contract points at it.
 * - **A schedule reconciles exactly.** The down payment plus every installment plus any final payment
 *   sum to the contract total, to the last piastre, for every input — including totals that do not
 *   divide evenly. This is checked when the schedule is built and again before it is stored.
 */

/* ---------------------------------------------------------------- payment plan */

export const INSTALLMENT_FREQUENCIES = ['monthly', 'quarterly', 'semiAnnual', 'annual'] as const;
export const InstallmentFrequencySchema = z.enum(INSTALLMENT_FREQUENCIES);
export type InstallmentFrequency = z.infer<typeof InstallmentFrequencySchema>;

export const MONTHS_PER_FREQUENCY: Readonly<Record<InstallmentFrequency, number>> = {
  monthly: 1,
  quarterly: 3,
  semiAnnual: 6,
  annual: 12,
};

/** How many installments one plan may carry. A demo bound, not a business rule. */
export const MAX_INSTALLMENTS = 240;

export const PaymentPlanSchema = z.strictObject({
  /** Paid at signing. May be zero. */
  downPayment: MoneySchema,
  installmentCount: z.number().int().min(0).max(MAX_INSTALLMENTS),
  frequency: InstallmentFrequencySchema,
  /**
   * The date installment **number one** falls due — not an origin one period before it. Installment
   * *k* is due `firstDueOn + (k − 1) × frequency`, so a monthly plan starting 1 October has its first
   * installment on 1 October.
   */
  firstDueOn: BusinessDateSchema,
  /**
   * When the down payment is due. Omitted means the same day the installments start.
   *
   * Separate from `firstDueOn` because the common arrangement is a deposit at signing and the first
   * installment a period later, and collapsing the two would date the deposit a month after the
   * customer actually paid it.
   */
  downPaymentDueOn: BusinessDateSchema.optional(),
  /** A balloon payment after the last installment. May be omitted. */
  finalPayment: MoneySchema.optional(),
});
export type PaymentPlan = z.infer<typeof PaymentPlanSchema>;

export const INSTALLMENT_KINDS = ['downPayment', 'installment', 'finalPayment'] as const;
export const InstallmentKindSchema = z.enum(INSTALLMENT_KINDS);
export type InstallmentKind = z.infer<typeof InstallmentKindSchema>;

/** One row of a generated schedule, before it becomes a stored installment. */
export const ScheduleRowSchema = z.strictObject({
  sequence: z.number().int().positive(),
  kind: InstallmentKindSchema,
  dueOn: BusinessDateSchema,
  amount: MoneySchema,
});
export type ScheduleRow = z.infer<typeof ScheduleRowSchema>;

export class PaymentPlanError extends Error {
  readonly code = 'VALIDATION_FAILED';
  constructor(
    readonly issue:
      | 'CURRENCY_MISMATCH'
      | 'NEGATIVE_AMOUNT'
      | 'DOWN_PAYMENT_EXCEEDS_TOTAL'
      | 'FINAL_PAYMENT_EXCEEDS_REMAINDER'
      | 'NO_INSTALLMENTS_FOR_REMAINDER'
      | 'SCHEDULE_DOES_NOT_RECONCILE',
  ) {
    super(issue);
    this.name = 'PaymentPlanError';
  }
}

/**
 * Build the installment schedule for a total and a plan.
 *
 * Pure, so the preview a person approves on screen is produced by exactly the code that stores the
 * schedule — not by a second implementation that can disagree with it.
 *
 * The remainder after the down payment and any final payment is split with `allocateMoney`, which
 * gives the earliest rows the odd piastres one at a time. That is deterministic, auditable, and it is
 * why 1,000,000 over 3 installments produces 333,333.34 / 333,333.33 / 333,333.33 rather than three
 * rows that quietly lose a piastre.
 */
export function buildInstallmentSchedule(total: Money, plan: PaymentPlan): ScheduleRow[] {
  const currency = total.currency;
  if (plan.downPayment.currency !== currency) throw new PaymentPlanError('CURRENCY_MISMATCH');
  if (plan.finalPayment && plan.finalPayment.currency !== currency) {
    throw new PaymentPlanError('CURRENCY_MISMATCH');
  }
  if (isNegativeMoney(total) || isNegativeMoney(plan.downPayment)) {
    throw new PaymentPlanError('NEGATIVE_AMOUNT');
  }
  if (plan.finalPayment && isNegativeMoney(plan.finalPayment)) {
    throw new PaymentPlanError('NEGATIVE_AMOUNT');
  }
  if (compareMoney(plan.downPayment, total) > 0) {
    throw new PaymentPlanError('DOWN_PAYMENT_EXCEEDS_TOTAL');
  }

  const zero = money('0', currency);
  const afterDownPayment = subtractMoney(total, plan.downPayment);
  const finalPayment = plan.finalPayment ?? zero;
  if (compareMoney(finalPayment, afterDownPayment) > 0) {
    throw new PaymentPlanError('FINAL_PAYMENT_EXCEEDS_REMAINDER');
  }
  const installmentTotal = subtractMoney(afterDownPayment, finalPayment);

  // Money left to spread and nowhere to spread it: refuse rather than silently drop it.
  if (plan.installmentCount === 0 && compareMoney(installmentTotal, zero) !== 0) {
    throw new PaymentPlanError('NO_INSTALLMENTS_FOR_REMAINDER');
  }

  const rows: ScheduleRow[] = [];
  let sequence = 0;

  if (compareMoney(plan.downPayment, zero) !== 0) {
    sequence += 1;
    rows.push({
      sequence,
      kind: 'downPayment',
      // Due at signing when the caller says so; otherwise the day the installments start.
      dueOn: plan.downPaymentDueOn ?? plan.firstDueOn,
      amount: plan.downPayment,
    });
  }

  if (plan.installmentCount > 0) {
    const parts = allocateMoney(
      installmentTotal,
      Array.from({ length: plan.installmentCount }, () => 1),
      2,
    );
    const step = MONTHS_PER_FREQUENCY[plan.frequency];
    for (let index = 0; index < plan.installmentCount; index += 1) {
      sequence += 1;
      rows.push({
        sequence,
        kind: 'installment',
        // Installment 1 falls on firstDueOn itself. Every date is computed from that origin rather
        // than from the previous row, so a clamped month can never shift the whole tail.
        dueOn: addMonths(plan.firstDueOn, step * index),
        amount: parts[index] as Money,
      });
    }
  }

  if (compareMoney(finalPayment, zero) !== 0) {
    sequence += 1;
    const step = MONTHS_PER_FREQUENCY[plan.frequency];
    rows.push({
      sequence,
      kind: 'finalPayment',
      // One period after the last installment.
      dueOn: addMonths(plan.firstDueOn, step * plan.installmentCount),
      amount: finalPayment,
    });
  }

  // The reconciliation is asserted here, not assumed. A schedule that does not add up must never be
  // stored: the arithmetic error would surface months later as a balance nobody can explain.
  const sum = rows.reduce<Money>((running, row) => addMoney(running, row.amount), zero);
  if (compareMoney(sum, total) !== 0) throw new PaymentPlanError('SCHEDULE_DOES_NOT_RECONCILE');
  return rows;
}

/* ----------------------------------------------------------------- reservation */

export const RESERVATION_STATES = [
  'draft',
  'pendingApproval',
  'confirmed',
  'cancelled',
  'expired',
  'converted',
] as const;
export const ReservationStateSchema = z.enum(RESERVATION_STATES);
export type ReservationState = z.infer<typeof ReservationStateSchema>;

export const RESERVATION_TRANSITIONS: Readonly<
  Record<ReservationState, readonly ReservationState[]>
> = {
  draft: ['pendingApproval', 'confirmed', 'cancelled', 'expired'],
  pendingApproval: ['confirmed', 'cancelled', 'expired'],
  confirmed: ['converted', 'cancelled', 'expired'],
  cancelled: [],
  expired: [],
  converted: [],
};

export function canTransitionReservation(from: ReservationState, to: ReservationState): boolean {
  return RESERVATION_TRANSITIONS[from].includes(to);
}

export const ReservationSchema = z.strictObject({
  reservationId: RecordIdSchema,
  /** Human-facing and immutable once issued. */
  reservationNumber: BusinessCodeSchema,
  customerId: RecordIdSchema,
  leadId: RecordIdSchema.optional(),
  unitId: RecordIdSchema,
  projectId: RecordIdSchema,
  reservedOn: BusinessDateSchema,
  expiresOn: BusinessDateSchema,
  reservationAmount: MoneySchema,
  /** The price agreed with the customer; may be below the unit's current price. */
  agreedPrice: MoneySchema,
  /** Derived from the unit's current price and the agreed price, as a decimal string fraction. */
  discountPercentage: z.string(),
  paymentPlan: PaymentPlanSchema,
  salesOwnerAccountId: z.string().min(1).max(200),
  legalEntityId: RecordIdSchema,
  branchId: RecordIdSchema,
  departmentId: RecordIdSchema.optional(),
  teamId: RecordIdSchema.optional(),
  state: ReservationStateSchema,
  /** Set when the discount triggered an approval. The engine owns the outcome (ADR-0024). */
  approvalRequestId: z.string().min(1).max(200).optional(),
  contractId: RecordIdSchema.optional(),
  cancellationReason: z.string().max(500).optional(),
  notes: NoteSchema.optional(),
  version: z.number().int().positive(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Reservation = z.infer<typeof ReservationSchema>;

export const CreateReservationSchema = z.strictObject({
  customerId: RecordIdSchema,
  leadId: RecordIdSchema.optional(),
  unitId: RecordIdSchema,
  reservationAmount: MoneySchema,
  agreedPrice: MoneySchema,
  paymentPlan: PaymentPlanSchema,
  /** Days the hold lasts. Bounded here; the business value is `SD-05`. */
  holdDays: z.number().int().min(1).max(180).default(14),
  notes: NoteSchema.optional(),
  /**
   * Idempotency key. A retried submission returns the original reservation instead of taking a second
   * hold on the unit; a replay carrying different input is a conflict, not a silent no-op.
   */
  idempotencyKey: z.string().min(8).max(200),
});
export type CreateReservation = z.infer<typeof CreateReservationSchema>;

export const CancelReservationSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});
export type CancelReservation = z.infer<typeof CancelReservationSchema>;

export const ReservationQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(200).optional(),
  state: ReservationStateSchema.optional(),
  projectId: RecordIdSchema.optional(),
  customerId: RecordIdSchema.optional(),
  unitId: RecordIdSchema.optional(),
  salesOwnerAccountId: z.string().min(1).max(200).optional(),
});
export type ReservationQuery = z.infer<typeof ReservationQuerySchema>;

export const ReservationPageSchema = z.strictObject({
  items: z.array(ReservationSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  nextCursor: z.string().optional(),
});
export type ReservationPage = z.infer<typeof ReservationPageSchema>;

/* -------------------------------------------------------------------- contract */

export const CONTRACT_STATES = ['draft', 'active', 'cancelled', 'completed'] as const;
export const ContractStateSchema = z.enum(CONTRACT_STATES);
export type ContractState = z.infer<typeof ContractStateSchema>;

export const CONTRACT_TRANSITIONS: Readonly<Record<ContractState, readonly ContractState[]>> = {
  draft: ['active', 'cancelled'],
  active: ['completed', 'cancelled'],
  cancelled: [],
  completed: [],
};

export function canTransitionContract(from: ContractState, to: ContractState): boolean {
  return CONTRACT_TRANSITIONS[from].includes(to);
}

export const ContractSchema = z.strictObject({
  contractId: RecordIdSchema,
  /** Immutable once issued, and unique. It appears on documents people keep. */
  contractNumber: BusinessCodeSchema,
  customerId: RecordIdSchema,
  unitId: RecordIdSchema,
  projectId: RecordIdSchema,
  reservationId: RecordIdSchema,
  contractedOn: BusinessDateSchema,
  totalPrice: MoneySchema,
  /** Credited against the schedule; it is money already received on the reservation. */
  reservationAmount: MoneySchema,
  paymentPlan: PaymentPlanSchema,
  /** Sum of every unpaid installment. Maintained by the collections module. */
  outstandingAmount: MoneySchema,
  paidAmount: MoneySchema,
  salesOwnerAccountId: z.string().min(1).max(200),
  legalEntityId: RecordIdSchema,
  branchId: RecordIdSchema,
  departmentId: RecordIdSchema.optional(),
  teamId: RecordIdSchema.optional(),
  state: ContractStateSchema,
  cancellationReason: z.string().max(500).optional(),
  /** Placeholder for the signed document once `CORE-DOC` exists. Never a file, never a URL yet. */
  documentRef: z.string().max(200).optional(),
  version: z.number().int().positive(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Contract = z.infer<typeof ContractSchema>;

export const CreateContractSchema = z.strictObject({
  reservationId: RecordIdSchema,
  contractedOn: BusinessDateSchema,
  /** Omitted keeps the reservation's plan. Supplying one replaces it wholesale. */
  paymentPlan: PaymentPlanSchema.optional(),
  idempotencyKey: z.string().min(8).max(200),
});
export type CreateContract = z.infer<typeof CreateContractSchema>;

export const CancelContractSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
  /** Return the unit to the market. Refused when money has already been collected. */
  releaseUnit: z.boolean().default(true),
});
export type CancelContract = z.infer<typeof CancelContractSchema>;

export const ContractQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(200).optional(),
  state: ContractStateSchema.optional(),
  projectId: RecordIdSchema.optional(),
  customerId: RecordIdSchema.optional(),
  salesOwnerAccountId: z.string().min(1).max(200).optional(),
});
export type ContractQuery = z.infer<typeof ContractQuerySchema>;

export const ContractPageSchema = z.strictObject({
  items: z.array(ContractSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  nextCursor: z.string().optional(),
});
export type ContractPage = z.infer<typeof ContractPageSchema>;

/* ----------------------------------------------------------------- installment */

export const INSTALLMENT_STATES = [
  'upcoming',
  'due',
  'partiallyPaid',
  'paid',
  'overdue',
  'rescheduled',
  'cancelled',
] as const;
export const InstallmentStateSchema = z.enum(INSTALLMENT_STATES);
export type InstallmentState = z.infer<typeof InstallmentStateSchema>;

export const InstallmentSchema = z.strictObject({
  installmentId: RecordIdSchema,
  contractId: RecordIdSchema,
  customerId: RecordIdSchema,
  unitId: RecordIdSchema,
  projectId: RecordIdSchema,
  sequence: z.number().int().positive(),
  kind: InstallmentKindSchema,
  dueOn: BusinessDateSchema,
  amount: MoneySchema,
  paidAmount: MoneySchema,
  remainingAmount: MoneySchema,
  state: InstallmentStateSchema,
  legalEntityId: RecordIdSchema,
  branchId: RecordIdSchema,
  teamId: RecordIdSchema.optional(),
  salesOwnerAccountId: z.string().min(1).max(200),
  version: z.number().int().positive(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Installment = z.infer<typeof InstallmentSchema>;

export const InstallmentQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(200).optional(),
  contractId: RecordIdSchema.optional(),
  customerId: RecordIdSchema.optional(),
  projectId: RecordIdSchema.optional(),
  state: InstallmentStateSchema.optional(),
  /** `due` is on or before today; `overdue` is strictly before; `upcoming` is a forward window. */
  bucket: z.enum(['due', 'overdue', 'upcoming']).optional(),
  /** Days ahead for the `upcoming` bucket. The reminder window is 15 days. */
  withinDays: z.coerce.number().int().min(1).max(365).optional(),
});
export type InstallmentQuery = z.infer<typeof InstallmentQuerySchema>;

export const InstallmentPageSchema = z.strictObject({
  items: z.array(InstallmentSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  nextCursor: z.string().optional(),
});
export type InstallmentPage = z.infer<typeof InstallmentPageSchema>;

/** What a schedule preview returns, before anything is stored. */
export const SchedulePreviewSchema = z.strictObject({
  rows: z.array(ScheduleRowSchema),
  total: MoneySchema,
  /** Present so a caller can see the reconciliation rather than trust it. */
  rowsTotal: MoneySchema,
});
export type SchedulePreview = z.infer<typeof SchedulePreviewSchema>;

export const PreviewScheduleSchema = z.strictObject({
  total: MoneySchema,
  paymentPlan: PaymentPlanSchema,
});

export const InstallmentListSchema = z.strictObject({ items: z.array(InstallmentSchema) });

/** A customer's financial position across all their contracts, within the actor's scope. */
export const CustomerFinancialSummarySchema = z.strictObject({
  customerId: RecordIdSchema,
  contracts: z.number().int().nonnegative(),
  totalContracted: MoneySchema,
  totalPaid: MoneySchema,
  totalOutstanding: MoneySchema,
  overdueCount: z.number().int().nonnegative(),
  overdueAmount: MoneySchema,
});
export type CustomerFinancialSummary = z.infer<typeof CustomerFinancialSummarySchema>;

export const SALES_AUDIT_ACTIONS = {
  reservationCreated: 'sales.reservation.created',
  reservationConfirmed: 'sales.reservation.confirmed',
  reservationCancelled: 'sales.reservation.cancelled',
  reservationExpired: 'sales.reservation.expired',
  reservationRefused: 'sales.reservation.refused',
  reservationApprovalRequested: 'sales.reservation.approvalRequested',
  contractCreated: 'sales.contract.created',
  contractActivated: 'sales.contract.activated',
  contractCancelled: 'sales.contract.cancelled',
  contractRefused: 'sales.contract.refused',
  scheduleGenerated: 'sales.schedule.generated',
  installmentsRefreshed: 'sales.installments.refreshed',
} as const;

/** Convenience for a caller that needs the plan's last due date, e.g. to bound a reminder sweep. */
export function lastDueDate(plan: PaymentPlan): BusinessDate {
  const step = MONTHS_PER_FREQUENCY[plan.frequency];
  const cycles = Math.max(plan.installmentCount - 1, 0) + (plan.finalPayment ? 1 : 0);
  return plan.installmentCount === 0 && !plan.finalPayment
    ? (plan.downPaymentDueOn ?? plan.firstDueOn)
    : addMonths(plan.firstDueOn, step * cycles);
}
