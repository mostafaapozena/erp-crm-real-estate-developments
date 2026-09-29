import {
  SALES_APPROVAL_OPERATIONS,
  compareMoney,
  divideMoney,
  money,
  multiplyMoney,
  type Money,
  type ReservationException,
  type SalesApprovalOperation,
} from '@alola/contracts';

/**
 * The reservation rules that are arithmetic, kept pure so they are tested without a database
 * (SALE-DISCOUNT-001, SALE-DISCOUNT-002, SALE-RESERVE-004).
 *
 * Every rule here reads a **configured** value. A value not configured (`null`) enforces nothing and
 * produces no exception — the rule has not been decided (`BD-02`, `BD-03`), so it cannot be broken.
 */

/** The deposit rule as configured (`sales.reservationMinimumDeposit`, `BD-02`). */
export type DepositRule =
  { kind: 'amount'; amount: string; currency: string } | { kind: 'percentage'; percent: string };

/**
 * The minimum deposit a rule asks of a reservation at an agreed price, or `undefined` when no rule is
 * configured. A percentage is taken of the agreed price and rounded **up** to the piastre, so rounding
 * can never let a deposit fall below the rule. An amount in another currency cannot be compared and is
 * reported as `null` — the reservation is refused rather than converted.
 */
export function minimumDepositFor(
  rule: DepositRule | null,
  agreedPrice: Money,
): Money | null | undefined {
  if (!rule) return undefined;
  if (rule.kind === 'amount') {
    return rule.currency === agreedPrice.currency ? money(rule.amount, rule.currency) : null;
  }
  return divideMoney(multiplyMoney(agreedPrice, rule.percent), '100', 2, 'up');
}

/** Compare two decimal percentage strings exactly, on their digits (ADR-0007). */
export function comparePercent(a: string, b: string): -1 | 0 | 1 {
  return compareMoney(money(a, 'PCT'), money(b, 'PCT'));
}

/** What a reservation's terms require, given the configured limits. */
export function reservationExceptions(input: {
  discountPercentage: string;
  maximumDiscountPercent: string | null;
  reservationAmount: Money;
  minimumDeposit: Money | undefined;
}): ReservationException[] {
  const found: ReservationException[] = [];
  if (
    input.maximumDiscountPercent !== null &&
    comparePercent(input.discountPercentage, input.maximumDiscountPercent) > 0
  ) {
    found.push('discountAboveMaximum');
  }
  if (input.minimumDeposit && compareMoney(input.reservationAmount, input.minimumDeposit) < 0) {
    found.push('depositBelowMinimum');
  }
  return found;
}

/**
 * The approvals a reservation must pass, in order. A discount asks for the discount approval when a
 * policy exists for it; an exception asks for its own, and must have one.
 */
export function requiredApprovals(input: {
  discountPercentage: string;
  exceptions: readonly ReservationException[];
}): { operationType: SalesApprovalOperation; exception: boolean }[] {
  const required: { operationType: SalesApprovalOperation; exception: boolean }[] = [];
  if (comparePercent(input.discountPercentage, '0') > 0) {
    required.push({ operationType: SALES_APPROVAL_OPERATIONS.discount, exception: false });
  }
  if (input.exceptions.includes('discountAboveMaximum')) {
    required.push({ operationType: SALES_APPROVAL_OPERATIONS.priceOverride, exception: true });
  }
  if (input.exceptions.includes('depositBelowMinimum')) {
    required.push({
      operationType: SALES_APPROVAL_OPERATIONS.reservationException,
      exception: true,
    });
  }
  return required;
}

/**
 * The combined outcome of several approval requests: rejected as soon as any is refused, approved only
 * when every one is, pending otherwise. A request the engine no longer knows counts as pending — it is
 * never treated as granted.
 */
export function combinedOutcome(
  states: readonly (string | undefined)[],
): 'approved' | 'rejected' | 'pending' {
  if (
    states.some((state) => state === 'rejected' || state === 'cancelled' || state === 'expired')
  ) {
    return 'rejected';
  }
  if (states.length > 0 && states.every((state) => state === 'approved')) return 'approved';
  return 'pending';
}
