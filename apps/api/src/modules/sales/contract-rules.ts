import {
  addMoney,
  buildInstallmentSchedule,
  compareMoney,
  money,
  type AmendmentPlan,
  type ContractPartyInput,
  type Money,
  type PaymentPlan,
  type ScheduleRow,
} from '@alola/contracts';

/**
 * The contract rules that are arithmetic or structural, kept pure so they are tested without a
 * database (SALE-CONTRACT-002, SALE-CHANGE-001).
 */

export type PartyIssue =
  | 'ONE_BUYER_REQUIRED'
  | 'BUYER_IS_RESERVATION_CUSTOMER'
  | 'SHARE_REQUIRED'
  | 'SHARE_NOT_ALLOWED'
  | 'SHARES_MUST_TOTAL_100'
  | 'DUPLICATE_PARTY';

/** Roles that own a share of the unit. */
const OWNING_ROLES = new Set(['buyer', 'coBuyer']);

/**
 * Validate a contract's parties. Exactly one buyer, and it is the customer the reservation was made
 * for; buyers and co-buyers carry shares that total **exactly** 100 — compared as decimals, never as
 * floating point; a guarantor or representative carries none; one person appears once.
 */
export function partyIssues(
  parties: readonly ContractPartyInput[],
  reservationCustomerId: string,
): { issue: PartyIssue; index: number } | undefined {
  const buyers = parties
    .map((party, index) => ({ party, index }))
    .filter(({ party }) => party.role === 'buyer');
  if (buyers.length !== 1) return { issue: 'ONE_BUYER_REQUIRED', index: buyers[1]?.index ?? 0 };
  const buyer = buyers[0];
  if (buyer && buyer.party.customerId !== reservationCustomerId) {
    return { issue: 'BUYER_IS_RESERVATION_CUSTOMER', index: buyer.index };
  }
  const seen = new Set<string>();
  let total = money('0', 'PCT');
  for (const [index, party] of parties.entries()) {
    if (seen.has(party.customerId)) return { issue: 'DUPLICATE_PARTY', index };
    seen.add(party.customerId);
    if (OWNING_ROLES.has(party.role)) {
      if (party.sharePercent === undefined) return { issue: 'SHARE_REQUIRED', index };
      total = addMoney(total, money(party.sharePercent, 'PCT'));
    } else if (party.sharePercent !== undefined) {
      return { issue: 'SHARE_NOT_ALLOWED', index };
    }
  }
  if (compareMoney(total, money('100', 'PCT')) !== 0) {
    return { issue: 'SHARES_MUST_TOTAL_100', index: 0 };
  }
  return undefined;
}

/**
 * Whether two plans are the same terms. Compared field by field on canonical values, so `100` and
 * `100.00` are the same amount and key order never matters.
 */
export function samePlan(a: PaymentPlan, b: PaymentPlan): boolean {
  const same = (x: Money | undefined, y: Money | undefined) =>
    x === undefined || y === undefined ? x === y : compareMoney(x, y) === 0;
  const milestonesA = a.milestones ?? [];
  const milestonesB = b.milestones ?? [];
  return (
    same(a.downPayment, b.downPayment) &&
    a.installmentCount === b.installmentCount &&
    a.frequency === b.frequency &&
    a.firstDueOn === b.firstDueOn &&
    (a.downPaymentDueOn ?? a.firstDueOn) === (b.downPaymentDueOn ?? b.firstDueOn) &&
    same(a.finalPayment, b.finalPayment) &&
    milestonesA.length === milestonesB.length &&
    milestonesA.every(
      (milestone, index) =>
        milestone.dueOn === milestonesB[index]?.dueOn &&
        same(milestone.amount, milestonesB[index]?.amount),
    ) &&
    same(a.maintenanceDeposit?.amount, b.maintenanceDeposit?.amount) &&
    a.maintenanceDeposit?.dueOn === b.maintenanceDeposit?.dueOn
  );
}

/**
 * The rows that replace what is still unpaid (SALE-CHANGE-001). They add up to **exactly** the amount
 * the replaced rows still owed — checked by the same builder every schedule uses — and are numbered
 * after the contract's last row, so no sequence is ever reused.
 */
export function amendmentRows(
  owed: Money,
  plan: AmendmentPlan,
  lastSequence: number,
): ScheduleRow[] {
  const rows = buildInstallmentSchedule(owed, {
    downPayment: money('0', owed.currency),
    installmentCount: plan.installmentCount,
    frequency: plan.frequency,
    firstDueOn: plan.firstDueOn,
    ...(plan.finalPayment ? { finalPayment: plan.finalPayment } : {}),
  });
  return rows.map((row) => ({ ...row, sequence: lastSequence + row.sequence }));
}
