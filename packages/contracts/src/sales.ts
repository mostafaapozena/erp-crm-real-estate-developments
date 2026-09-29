import { z } from 'zod';
import { BusinessCodeSchema, NoteSchema, RecordIdSchema } from './identifiers';
import { LocalizedLabelSchema } from './localized';
import {
  CurrencyCodeSchema,
  MoneySchema,
  addMoney,
  allocateMoney,
  compareMoney,
  isNegativeMoney,
  isZeroMoney,
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

/** How many dated milestone rows one plan may carry. A bound, not a business rule. */
export const MAX_MILESTONES = 24;

/**
 * A payment tied to a date the parties agree — handover, completion of the structure — rather than to
 * the periodic cycle (COL-SCHEDULE-001). Part of the price: the periodic instalments split what is left
 * after the down payment, the final payment and every milestone.
 */
export const PlanMilestoneSchema = z.strictObject({
  dueOn: BusinessDateSchema,
  amount: MoneySchema,
  /** What the payment is tied to, in both languages (I18N-009). */
  label: LocalizedLabelSchema.optional(),
});
export type PlanMilestone = z.infer<typeof PlanMilestoneSchema>;

/**
 * Money held for the building's upkeep. It is **added to** the price, never taken from it, and
 * appears as its own row. There is no default amount: until `BD-32` decides one, a plan carries a
 * maintenance deposit only when the person entering it states one.
 */
export const MaintenanceDepositSchema = z.strictObject({
  amount: MoneySchema,
  dueOn: BusinessDateSchema,
});
export type MaintenanceDeposit = z.infer<typeof MaintenanceDepositSchema>;

/**
 * The rounding rule every schedule uses (`BD-32`, proposed): an amount that does not divide evenly
 * gives its odd piastres to the earliest instalments, one each. Stated on every preview so a person
 * approving a schedule sees the rule rather than trusting it.
 */
export const SCHEDULE_ROUNDING_RULE = 'oddPiastresToEarliestRows' as const;

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
  /** Dated rows tied to milestones, part of the price (COL-SCHEDULE-001). */
  milestones: z.array(PlanMilestoneSchema).max(MAX_MILESTONES).optional(),
  /** Added to the price as its own row (`BD-32`). */
  maintenanceDeposit: MaintenanceDepositSchema.optional(),
});
export type PaymentPlan = z.infer<typeof PaymentPlanSchema>;

export const INSTALLMENT_KINDS = [
  'downPayment',
  'installment',
  'finalPayment',
  'milestone',
  'maintenanceDeposit',
] as const;
export const InstallmentKindSchema = z.enum(INSTALLMENT_KINDS);
export type InstallmentKind = z.infer<typeof InstallmentKindSchema>;

/** One row of a generated schedule, before it becomes a stored installment. */
export const ScheduleRowSchema = z.strictObject({
  sequence: z.number().int().positive(),
  kind: InstallmentKindSchema,
  dueOn: BusinessDateSchema,
  amount: MoneySchema,
  /** A milestone's wording. */
  label: LocalizedLabelSchema.optional(),
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
      | 'MILESTONES_EXCEED_REMAINDER'
      | 'EMPTY_ROW'
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
  const milestones = plan.milestones ?? [];
  const extras: Money[] = [
    plan.downPayment,
    ...(plan.finalPayment ? [plan.finalPayment] : []),
    ...milestones.map((milestone) => milestone.amount),
    ...(plan.maintenanceDeposit ? [plan.maintenanceDeposit.amount] : []),
  ];
  if (extras.some((amount) => amount.currency !== currency)) {
    throw new PaymentPlanError('CURRENCY_MISMATCH');
  }
  if (isNegativeMoney(total) || extras.some((amount) => isNegativeMoney(amount))) {
    throw new PaymentPlanError('NEGATIVE_AMOUNT');
  }
  // A milestone or maintenance row of nothing is a row nobody can pay; refuse it rather than store it.
  if (
    milestones.some((milestone) => isZeroMoney(milestone.amount)) ||
    (plan.maintenanceDeposit && isZeroMoney(plan.maintenanceDeposit.amount))
  ) {
    throw new PaymentPlanError('EMPTY_ROW');
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
  const milestoneTotal = milestones.reduce<Money>(
    (running, milestone) => addMoney(running, milestone.amount),
    zero,
  );
  const afterFinal = subtractMoney(afterDownPayment, finalPayment);
  if (compareMoney(milestoneTotal, afterFinal) > 0) {
    throw new PaymentPlanError('MILESTONES_EXCEED_REMAINDER');
  }
  const installmentTotal = subtractMoney(afterFinal, milestoneTotal);

  // Money left to spread and nowhere to spread it: refuse rather than silently drop it.
  if (plan.installmentCount === 0 && compareMoney(installmentTotal, zero) !== 0) {
    throw new PaymentPlanError('NO_INSTALLMENTS_FOR_REMAINDER');
  }

  const rows: Omit<ScheduleRow, 'sequence'>[] = [];

  if (compareMoney(plan.downPayment, zero) !== 0) {
    rows.push({
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
      rows.push({
        kind: 'installment',
        // Installment 1 falls on firstDueOn itself. Every date is computed from that origin rather
        // than from the previous row, so a clamped month can never shift the whole tail.
        dueOn: addMonths(plan.firstDueOn, step * index),
        amount: parts[index] as Money,
      });
    }
  }

  for (const milestone of milestones) {
    rows.push({
      kind: 'milestone',
      dueOn: milestone.dueOn,
      amount: milestone.amount,
      ...(milestone.label ? { label: milestone.label } : {}),
    });
  }

  if (compareMoney(finalPayment, zero) !== 0) {
    const step = MONTHS_PER_FREQUENCY[plan.frequency];
    rows.push({
      kind: 'finalPayment',
      // One period after the last installment.
      dueOn: addMonths(plan.firstDueOn, step * plan.installmentCount),
      amount: finalPayment,
    });
  }

  if (plan.maintenanceDeposit) {
    rows.push({
      kind: 'maintenanceDeposit',
      dueOn: plan.maintenanceDeposit.dueOn,
      amount: plan.maintenanceDeposit.amount,
    });
  }

  // Rows in date order, numbered from one. The sort is stable, so rows due the same day keep the
  // order above — a plan without milestones numbers exactly as it always did.
  const ordered = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) =>
      a.row.dueOn === b.row.dueOn ? a.index - b.index : a.row.dueOn < b.row.dueOn ? -1 : 1,
    )
    .map(({ row }, index): ScheduleRow => ({ sequence: index + 1, ...row }));

  // The reconciliation is asserted here, not assumed. A schedule that does not add up must never be
  // stored: the arithmetic error would surface months later as a balance nobody can explain.
  const sum = ordered.reduce<Money>((running, row) => addMoney(running, row.amount), zero);
  if (compareMoney(sum, scheduleTotal(total, plan)) !== 0) {
    throw new PaymentPlanError('SCHEDULE_DOES_NOT_RECONCILE');
  }
  return ordered;
}

/**
 * What a schedule adds up to: the price plus any maintenance deposit. This is the contract total —
 * paid plus outstanding always equals it.
 */
export function scheduleTotal(price: Money, plan: PaymentPlan): Money {
  return plan.maintenanceDeposit ? addMoney(price, plan.maintenanceDeposit.amount) : price;
}

/* ----------------------------------------------------------------- reservation */

/**
 * SALE-RESERVE-001. `approved` means every approval the reservation needed was granted and it waits
 * for a person to confirm it; `rejected` means one was refused, and the unit is back on sale. Both
 * were added in BMP-1 after the demonstration's states, so stored records keep their meaning.
 */
export const RESERVATION_STATES = [
  'draft',
  'pendingApproval',
  'confirmed',
  'cancelled',
  'expired',
  'converted',
  'approved',
  'rejected',
] as const;
export const ReservationStateSchema = z.enum(RESERVATION_STATES);
export type ReservationState = z.infer<typeof ReservationStateSchema>;

export const RESERVATION_TRANSITIONS: Readonly<
  Record<ReservationState, readonly ReservationState[]>
> = {
  draft: ['pendingApproval', 'confirmed', 'cancelled', 'expired'],
  // `confirmed` directly from `pendingApproval` remains for a record whose approval was granted
  // before the `approved` state existed; the service still requires the approval to be granted.
  pendingApproval: ['approved', 'rejected', 'confirmed', 'cancelled', 'expired'],
  approved: ['confirmed', 'cancelled', 'expired'],
  confirmed: ['converted', 'cancelled', 'expired'],
  cancelled: [],
  expired: [],
  converted: [],
  rejected: [],
};

/** A reservation that still holds its unit. */
export const LIVE_RESERVATION_STATES: readonly ReservationState[] = [
  'draft',
  'pendingApproval',
  'approved',
  'confirmed',
];

/**
 * The commercial operations sales submits to the approval engine (SALE-DISCOUNT, SALE-RESERVE,
 * SALE-CONTRACT, SALE-CHANGE). Each is governed only when a published policy names it (`BD-04`);
 * the demonstration seed publishes illustrative ones, and a client deployment publishes its own.
 */
export const SALES_APPROVAL_OPERATIONS = {
  discount: 'sales.reservation.discount',
  priceOverride: 'sales.reservation.priceOverride',
  reservationException: 'sales.reservation.exception',
  reservationExtension: 'sales.reservation.extension',
  reservationCancellation: 'sales.reservation.cancellation',
  contractException: 'sales.contract.exception',
  contractAmendment: 'sales.contract.amendment',
  contractCancellation: 'sales.contract.cancellation',
} as const;
export type SalesApprovalOperation =
  (typeof SALES_APPROVAL_OPERATIONS)[keyof typeof SALES_APPROVAL_OPERATIONS];

/**
 * Why a reservation needs an exception approval. Each is refused outright when no policy can approve
 * it — an exception is never granted by the absence of a control.
 */
export const RESERVATION_EXCEPTIONS = ['discountAboveMaximum', 'depositBelowMinimum'] as const;
export type ReservationException = (typeof RESERVATION_EXCEPTIONS)[number];

/** What the finance side (BMP-2) must do about money taken on a reservation that ended. */
export const REFUND_HANDOFF_STATES = ['notApplicable', 'pending'] as const;

export function canTransitionReservation(from: ReservationState, to: ReservationState): boolean {
  return RESERVATION_TRANSITIONS[from].includes(to);
}

export const ReservationSchema = z.strictObject({
  reservationId: RecordIdSchema,
  /** Human-facing and immutable once issued. */
  reservationNumber: BusinessCodeSchema,
  customerId: RecordIdSchema,
  leadId: RecordIdSchema.optional(),
  /** The opportunity this reservation advanced (CRM-OPP-002). */
  opportunityId: RecordIdSchema.optional(),
  /** The timed hold it was converted from (INV-HOLD-001). */
  holdId: RecordIdSchema.optional(),
  unitId: RecordIdSchema,
  projectId: RecordIdSchema,
  reservedOn: BusinessDateSchema,
  expiresOn: BusinessDateSchema,
  reservationAmount: MoneySchema,
  /** The price agreed with the customer; may be below the unit's current price. */
  agreedPrice: MoneySchema,
  /** The unit's price when the reservation was made — what the discount is measured against. */
  listPrice: MoneySchema.optional(),
  /** Derived from the unit's current price and the agreed price, as a decimal string fraction. */
  discountPercentage: z.string(),
  /** The deposit the configured rule asked for when the reservation was made (`BD-02`). */
  minimumDeposit: MoneySchema.optional(),
  exceptions: z.array(z.enum(RESERVATION_EXCEPTIONS)),
  /** Every approval request the reservation waits on, by operation. */
  approvals: z.array(
    z.strictObject({ operationType: z.string(), requestId: z.string().min(1).max(200) }),
  ),
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
  /** Set when the reservation ends with money taken on it; BMP-2 settles it. */
  refundHandoff: z.enum(REFUND_HANDOFF_STATES),
  /** An extension or a cancellation waiting for approval (SALE-RESERVE-003, 005). */
  pendingExtension: z
    .strictObject({ days: z.number().int().positive(), requestId: z.string(), reason: z.string() })
    .optional(),
  pendingCancellation: z.strictObject({ requestId: z.string(), reason: z.string() }).optional(),
  extensions: z.number().int().nonnegative(),
  notes: NoteSchema.optional(),
  version: z.number().int().positive(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Reservation = z.infer<typeof ReservationSchema>;

export const CreateReservationSchema = z.strictObject({
  customerId: RecordIdSchema,
  leadId: RecordIdSchema.optional(),
  opportunityId: RecordIdSchema.optional(),
  /** Reserve the unit the actor's timed hold already holds, instead of an available one. */
  holdId: RecordIdSchema.optional(),
  unitId: RecordIdSchema,
  reservationAmount: MoneySchema,
  agreedPrice: MoneySchema,
  paymentPlan: PaymentPlanSchema,
  /**
   * The validity is `sales.reservationValidityDays` (`BD-01`); when given, this must equal it. There
   * is no default: an unconfigured validity refuses the reservation rather than inventing one.
   */
  holdDays: z.number().int().min(1).max(365).optional(),
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

export const ExtendReservationSchema = z.strictObject({
  days: z.number().int().min(1).max(180),
  reason: z.string().trim().min(3).max(500),
  expectedVersion: z.number().int().positive(),
});
export type ExtendReservation = z.infer<typeof ExtendReservationSchema>;

export const ReservationQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(200).optional(),
  state: ReservationStateSchema.optional(),
  projectId: RecordIdSchema.optional(),
  customerId: RecordIdSchema.optional(),
  unitId: RecordIdSchema.optional(),
  opportunityId: RecordIdSchema.optional(),
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

/**
 * SALE-CONTRACT-001, 003. A contract is created as a **draft** that carries snapshots and a proposed
 * schedule; nothing is collectible and the unit is still the reservation's. Activation freezes the
 * schedule into instalments and commits the unit (`pendingApproval` while a contract exception waits
 * on its approval). Contracts made before BMP-1 were created active and keep that state.
 */
export const CONTRACT_STATES = [
  'draft',
  'pendingApproval',
  'active',
  'cancelled',
  'completed',
] as const;
export const ContractStateSchema = z.enum(CONTRACT_STATES);
export type ContractState = z.infer<typeof ContractStateSchema>;

export const CONTRACT_TRANSITIONS: Readonly<Record<ContractState, readonly ContractState[]>> = {
  draft: ['pendingApproval', 'active', 'cancelled'],
  // Back to `draft` when the exception approval is rejected; the draft can then be corrected.
  pendingApproval: ['draft', 'active', 'cancelled'],
  active: ['completed', 'cancelled'],
  cancelled: [],
  completed: [],
};

export function canTransitionContract(from: ContractState, to: ContractState): boolean {
  return CONTRACT_TRANSITIONS[from].includes(to);
}

/** SALE-CONTRACT-002. Buyers and co-buyers own shares; a guarantor or representative owns none. */
export const CONTRACT_PARTY_ROLES = ['buyer', 'coBuyer', 'guarantor', 'representative'] as const;
export const ContractPartyRoleSchema = z.enum(CONTRACT_PARTY_ROLES);
export type ContractPartyRole = z.infer<typeof ContractPartyRoleSchema>;

/** A share of ownership, in percent, to four decimal places: `50`, `33.3333`. */
export const SharePercentSchema = z
  .string()
  .regex(/^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/, { message: 'SHARE_PERCENT_EXPECTED' });

export const ContractPartyInputSchema = z.strictObject({
  role: ContractPartyRoleSchema,
  customerId: RecordIdSchema,
  /** Required for a buyer or co-buyer, refused for anyone else. */
  sharePercent: SharePercentSchema.optional(),
});
export type ContractPartyInput = z.infer<typeof ContractPartyInputSchema>;

export const ContractPartySchema = z.strictObject({
  role: ContractPartyRoleSchema,
  customerId: RecordIdSchema,
  sharePercent: SharePercentSchema.optional(),
  /** The name as it stood when the party was added — a snapshot, never re-read. */
  name: z.string().max(200).optional(),
});
export type ContractParty = z.infer<typeof ContractPartySchema>;

/** At most ten parties on one contract. */
export const MAX_CONTRACT_PARTIES = 10;

/**
 * The identity on the customer snapshot. Kept apart from the CRM schema (which imports inventory,
 * which imports this file) and restricted on the contract exactly as on the customer (SEC-029).
 */
export const ContractIdentitySnapshotSchema = z.strictObject({
  type: z.string().min(1).max(40),
  number: z.string().min(1).max(60),
  issuingCountry: z.string().max(3).optional(),
});

/** The buyer as they stood on the day the contract was drafted. Immutable (SALE-CONTRACT-001). */
export const ContractCustomerSnapshotSchema = z.strictObject({
  customerId: RecordIdSchema,
  kind: z.string().max(40),
  name: z.string().max(200),
  alternateName: z.string().max(200).optional(),
  primaryPhone: z.string().max(40),
  email: z.string().max(254).optional(),
  address: z.string().max(400).optional(),
  city: z.string().max(80).optional(),
  /** Field-restricted: absent without `crm.customer.viewIdentity`. */
  identity: ContractIdentitySnapshotSchema.optional(),
});
export type ContractCustomerSnapshot = z.infer<typeof ContractCustomerSnapshotSchema>;

/** The unit as it stood on the day the contract was drafted. Immutable. */
export const ContractUnitSnapshotSchema = z.strictObject({
  unitId: RecordIdSchema,
  code: z.string().max(80),
  projectId: RecordIdSchema,
  projectCode: z.string().max(80).optional(),
  projectName: LocalizedLabelSchema.optional(),
  buildingId: RecordIdSchema.optional(),
  buildingCode: z.string().max(80).optional(),
  floor: z.number().int().optional(),
  propertyType: z.string().max(40).optional(),
  usageType: z.string().max(40).optional(),
  finishingStatus: z.string().max(40).optional(),
  area: z.string().max(40).optional(),
  gardenArea: z.string().max(40).optional(),
  roofArea: z.string().max(40).optional(),
  bedrooms: z.number().int().optional(),
  bathrooms: z.number().int().optional(),
});
export type ContractUnitSnapshot = z.infer<typeof ContractUnitSnapshotSchema>;

/** The price as agreed. Immutable. */
export const ContractPricingSnapshotSchema = z.strictObject({
  listPrice: MoneySchema.optional(),
  agreedPrice: MoneySchema,
  discountPercentage: z.string().max(20),
  reservationAmount: MoneySchema,
  maintenanceDeposit: MoneySchema.optional(),
});
export type ContractPricingSnapshot = z.infer<typeof ContractPricingSnapshotSchema>;

/**
 * Why activation asks for a `sales.contract.exception` approval where a policy governs it. A plan
 * changed from the one the reservation was approved with is the one exception today.
 */
export const CONTRACT_EXCEPTIONS = ['planChanged'] as const;
export type ContractException = (typeof CONTRACT_EXCEPTIONS)[number];

/**
 * What the product points out but does not block — each waits on a decision (`BD-34` identity,
 * `BD-35` signed copy) before it may block anything.
 */
export const CONTRACT_WARNINGS = ['identityMissing', 'notSigned'] as const;
export type ContractWarning = (typeof CONTRACT_WARNINGS)[number];

export const SIGNING_STATES = ['unsigned', 'signed'] as const;
export const ContractSigningSchema = z.strictObject({
  state: z.enum(SIGNING_STATES),
  signedOn: BusinessDateSchema.optional(),
  /** The signed copy, a `CORE-DOC` document owned by this contract. */
  documentId: RecordIdSchema.optional(),
  recordedBy: z.string().max(200).optional(),
  recordedAt: InstantSchema.optional(),
});
export type ContractSigning = z.infer<typeof ContractSigningSchema>;

/** SALE-CHANGE-001. The new terms for what is still unpaid. */
export const AmendmentPlanSchema = z.strictObject({
  installmentCount: z.number().int().min(1).max(MAX_INSTALLMENTS),
  frequency: InstallmentFrequencySchema,
  firstDueOn: BusinessDateSchema,
  finalPayment: MoneySchema.optional(),
});
export type AmendmentPlan = z.infer<typeof AmendmentPlanSchema>;

export const AMENDMENT_STATES = ['pending', 'applied', 'rejected', 'stale'] as const;
export type AmendmentState = (typeof AMENDMENT_STATES)[number];

export const ContractAmendmentSchema = z.strictObject({
  amendmentId: RecordIdSchema,
  state: z.enum(AMENDMENT_STATES),
  reason: z.string().max(500),
  requestId: z.string().max(200).optional(),
  plan: AmendmentPlanSchema,
  /** The unpaid rows the amendment replaces; they become `rescheduled`, never deleted. */
  replacedInstallmentIds: z.array(RecordIdSchema).max(MAX_INSTALLMENTS + MAX_MILESTONES + 3),
  /** What those rows still owed — the new rows add up to exactly this. */
  amount: MoneySchema,
  rows: z.array(ScheduleRowSchema),
  requestedBy: z.string().max(200),
  requestedAt: InstantSchema,
  decidedAt: InstantSchema.optional(),
});
export type ContractAmendment = z.infer<typeof ContractAmendmentSchema>;

export const ContractSchema = z.strictObject({
  contractId: RecordIdSchema,
  /** Immutable once issued, and unique. It appears on documents people keep. */
  contractNumber: BusinessCodeSchema,
  customerId: RecordIdSchema,
  unitId: RecordIdSchema,
  projectId: RecordIdSchema,
  reservationId: RecordIdSchema,
  leadId: RecordIdSchema.optional(),
  opportunityId: RecordIdSchema.optional(),
  contractedOn: BusinessDateSchema,
  /** The schedule total: the agreed price plus any maintenance deposit. */
  totalPrice: MoneySchema,
  /** Credited against the schedule; it is money already received on the reservation. */
  reservationAmount: MoneySchema,
  paymentPlan: PaymentPlanSchema,
  /** Sum of every unpaid installment. Maintained by the collections module. */
  outstandingAmount: MoneySchema,
  paidAmount: MoneySchema,
  /** Snapshots taken when the draft was made (SALE-CONTRACT-001); absent on pre-BMP-1 contracts. */
  customerSnapshot: ContractCustomerSnapshotSchema.optional(),
  unitSnapshot: ContractUnitSnapshotSchema.optional(),
  pricing: ContractPricingSnapshotSchema.optional(),
  parties: z.array(ContractPartySchema).max(MAX_CONTRACT_PARTIES),
  signing: ContractSigningSchema,
  exceptions: z.array(z.enum(CONTRACT_EXCEPTIONS)),
  /** Computed on read; never stored. */
  warnings: z.array(z.enum(CONTRACT_WARNINGS)),
  approvals: z.array(
    z.strictObject({ operationType: z.string(), requestId: z.string().min(1).max(200) }),
  ),
  amendments: z.array(ContractAmendmentSchema),
  pendingCancellation: z.strictObject({ requestId: z.string(), reason: z.string() }).optional(),
  /** Set when the contract ends with money taken on it; BMP-2 settles it. */
  refundHandoff: z.enum(REFUND_HANDOFF_STATES),
  /** The rows a draft would freeze — computed from the plan on read, for the preview. */
  draftSchedule: z.array(ScheduleRowSchema).optional(),
  salesOwnerAccountId: z.string().min(1).max(200),
  legalEntityId: RecordIdSchema,
  branchId: RecordIdSchema,
  departmentId: RecordIdSchema.optional(),
  teamId: RecordIdSchema.optional(),
  state: ContractStateSchema,
  activatedAt: InstantSchema.optional(),
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
  /** Omitted: the reservation's customer as the only buyer, owning 100 %. */
  parties: z.array(ContractPartyInputSchema).min(1).max(MAX_CONTRACT_PARTIES).optional(),
  idempotencyKey: z.string().min(8).max(200),
});
export type CreateContract = z.infer<typeof CreateContractSchema>;

export const SetContractPartiesSchema = z.strictObject({
  parties: z.array(ContractPartyInputSchema).min(1).max(MAX_CONTRACT_PARTIES),
  expectedVersion: z.number().int().positive(),
});
export type SetContractParties = z.infer<typeof SetContractPartiesSchema>;

export const ActivateContractSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
});
export type ActivateContract = z.infer<typeof ActivateContractSchema>;

export const RecordSigningSchema = z.strictObject({
  signedOn: BusinessDateSchema,
  documentId: RecordIdSchema.optional(),
  expectedVersion: z.number().int().positive(),
});
export type RecordSigning = z.infer<typeof RecordSigningSchema>;

export const AmendContractSchema = z.strictObject({
  plan: AmendmentPlanSchema,
  reason: z.string().trim().min(3).max(500),
  expectedVersion: z.number().int().positive(),
});
export type AmendContract = z.infer<typeof AmendContractSchema>;

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

/**
 * SALE-CONTRACT-004. The contract's own trail, read from the audit record: what happened, when, by
 * whom. Change details stay behind the audit permissions; this is the summary a contract viewer sees.
 */
export const ContractHistoryEntrySchema = z.strictObject({
  action: z.string(),
  outcome: z.string(),
  occurredAt: InstantSchema,
  actorAccountId: z.string().optional(),
  actorKind: z.string(),
  reason: z.string().optional(),
});
export type ContractHistoryEntry = z.infer<typeof ContractHistoryEntrySchema>;
export const ContractHistorySchema = z.strictObject({
  items: z.array(ContractHistoryEntrySchema),
});

/* ------------------------------------------------------------------- quotation */

/**
 * SALE-QUOTE-001. A priced offer for one unit and one plan. It **never reserves inventory**: the unit
 * stays on sale and anyone may reserve it. A revision is a new record with the next revision number;
 * the one it replaces becomes `superseded`. `expired` is computed from the validity the person stated
 * (`BD-36` decides nothing yet) and never stored.
 */
export const QUOTATION_STATES = ['active', 'superseded', 'withdrawn', 'expired'] as const;
export const QuotationStateSchema = z.enum(QUOTATION_STATES);
export type QuotationState = z.infer<typeof QuotationStateSchema>;

export const QuotationSchema = z.strictObject({
  quotationId: RecordIdSchema,
  quotationNumber: BusinessCodeSchema,
  revision: z.number().int().positive(),
  customerId: RecordIdSchema.optional(),
  leadId: RecordIdSchema.optional(),
  opportunityId: RecordIdSchema.optional(),
  unitId: RecordIdSchema,
  unitCode: z.string().max(80),
  projectId: RecordIdSchema,
  /** The unit's effective price when the quotation was made. */
  listPrice: MoneySchema,
  agreedPrice: MoneySchema,
  discountPercentage: z.string().max(20),
  paymentPlan: PaymentPlanSchema,
  rows: z.array(ScheduleRowSchema),
  total: MoneySchema,
  validUntil: BusinessDateSchema,
  state: QuotationStateSchema,
  withdrawalReason: z.string().max(500).optional(),
  notes: NoteSchema.optional(),
  salesOwnerAccountId: z.string().min(1).max(200),
  legalEntityId: RecordIdSchema,
  branchId: RecordIdSchema,
  departmentId: RecordIdSchema.optional(),
  teamId: RecordIdSchema.optional(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Quotation = z.infer<typeof QuotationSchema>;

export const CreateQuotationSchema = z
  .strictObject({
    customerId: RecordIdSchema.optional(),
    leadId: RecordIdSchema.optional(),
    opportunityId: RecordIdSchema.optional(),
    unitId: RecordIdSchema,
    agreedPrice: MoneySchema,
    paymentPlan: PaymentPlanSchema,
    validUntil: BusinessDateSchema,
    notes: NoteSchema.optional(),
    idempotencyKey: z.string().min(8).max(200),
  })
  .refine((value) => value.customerId !== undefined || value.leadId !== undefined, {
    message: 'QUOTATION_NEEDS_RECIPIENT',
    path: ['customerId'],
  });
export type CreateQuotation = z.infer<typeof CreateQuotationSchema>;

export const ReviseQuotationSchema = z.strictObject({
  agreedPrice: MoneySchema,
  paymentPlan: PaymentPlanSchema,
  validUntil: BusinessDateSchema,
  notes: NoteSchema.optional(),
  /** The revision being replaced; a stale one is refused. */
  expectedRevision: z.number().int().positive(),
});
export type ReviseQuotation = z.infer<typeof ReviseQuotationSchema>;

export const WithdrawQuotationSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
  expectedRevision: z.number().int().positive(),
});
export type WithdrawQuotation = z.infer<typeof WithdrawQuotationSchema>;

export const QuotationQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(200).optional(),
  customerId: RecordIdSchema.optional(),
  leadId: RecordIdSchema.optional(),
  opportunityId: RecordIdSchema.optional(),
  unitId: RecordIdSchema.optional(),
});
export type QuotationQuery = z.infer<typeof QuotationQuerySchema>;

export const QuotationPageSchema = z.strictObject({
  items: z.array(QuotationSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  nextCursor: z.string().optional(),
});
export type QuotationPage = z.infer<typeof QuotationPageSchema>;

export const QuotationRevisionsSchema = z.strictObject({ items: z.array(QuotationSchema) });

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
  /** A milestone's wording. */
  label: LocalizedLabelSchema.optional(),
  /** The amendment that created this row (SALE-CHANGE-001). */
  amendmentId: RecordIdSchema.optional(),
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
  /** The schedule total: the price plus any maintenance deposit. */
  total: MoneySchema,
  price: MoneySchema,
  maintenanceDeposit: MoneySchema.optional(),
  /** Stated, not implied (`BD-32`). */
  roundingRule: z.literal(SCHEDULE_ROUNDING_RULE),
  /** Present so a caller can see the reconciliation rather than trust it. */
  rowsTotal: MoneySchema,
});
export type SchedulePreview = z.infer<typeof SchedulePreviewSchema>;

export const PreviewScheduleSchema = z.strictObject({
  total: MoneySchema,
  paymentPlan: PaymentPlanSchema,
});

export const InstallmentListSchema = z.strictObject({ items: z.array(InstallmentSchema) });

/**
 * The contract portfolio the actor can see, totalled on the server (SEC-028, ADR-0007).
 *
 * Totals are computed by the database over **every** contract inside the actor's scope, in
 * `Decimal128`, and grouped by currency — never by a client adding up one page of rows, which both
 * truncates at the page size and passes money through binary floating point. Two currencies are
 * never added together, so each appears as its own row.
 */
export const ContractSummaryQuerySchema = z.strictObject({
  state: ContractStateSchema.optional(),
});
export type ContractSummaryQuery = z.infer<typeof ContractSummaryQuerySchema>;

export const ContractSummarySchema = z.strictObject({
  contracts: z.number().int().nonnegative(),
  byCurrency: z.array(
    z.strictObject({
      currency: CurrencyCodeSchema,
      contracts: z.number().int().nonnegative(),
      totalContracted: MoneySchema,
      totalPaid: MoneySchema,
      totalOutstanding: MoneySchema,
    }),
  ),
});
export type ContractSummary = z.infer<typeof ContractSummarySchema>;

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
  reservationApproved: 'sales.reservation.approved',
  reservationRejected: 'sales.reservation.rejected',
  reservationExtended: 'sales.reservation.extended',
  reservationExtensionRequested: 'sales.reservation.extensionRequested',
  reservationCancellationRequested: 'sales.reservation.cancellationRequested',
  contractCreated: 'sales.contract.created',
  contractActivated: 'sales.contract.activated',
  contractActivationRequested: 'sales.contract.activationRequested',
  contractActivationRejected: 'sales.contract.activationRejected',
  contractPartiesChanged: 'sales.contract.partiesChanged',
  contractSigned: 'sales.contract.signed',
  contractAmendmentRequested: 'sales.contract.amendmentRequested',
  contractAmended: 'sales.contract.amended',
  contractAmendmentRejected: 'sales.contract.amendmentRejected',
  contractCancellationRequested: 'sales.contract.cancellationRequested',
  contractCancelled: 'sales.contract.cancelled',
  quotationCreated: 'sales.quotation.created',
  quotationRevised: 'sales.quotation.revised',
  quotationWithdrawn: 'sales.quotation.withdrawn',
  contractRefused: 'sales.contract.refused',
  scheduleGenerated: 'sales.schedule.generated',
  installmentsRefreshed: 'sales.installments.refreshed',
} as const;

/** Convenience for a caller that needs the plan's last due date, e.g. to bound a reminder sweep. */
export function lastDueDate(plan: PaymentPlan): BusinessDate {
  const step = MONTHS_PER_FREQUENCY[plan.frequency];
  const cycles = Math.max(plan.installmentCount - 1, 0) + (plan.finalPayment ? 1 : 0);
  const periodic =
    plan.installmentCount === 0 && !plan.finalPayment
      ? (plan.downPaymentDueOn ?? plan.firstDueOn)
      : addMonths(plan.firstDueOn, step * cycles);
  // Milestones and a maintenance deposit may fall after the periodic rows.
  return [
    ...(plan.milestones ?? []).map((milestone) => milestone.dueOn),
    ...(plan.maintenanceDeposit ? [plan.maintenanceDeposit.dueOn] : []),
  ].reduce<BusinessDate>((latest, date) => (date > latest ? date : latest), periodic);
}
