import { describe, expect, it } from 'vitest';
import { addMoney, compareMoney, money, type Money } from './money';
import {
  MAX_INSTALLMENTS,
  PaymentPlanError,
  buildInstallmentSchedule,
  canTransitionContract,
  canTransitionReservation,
  lastDueDate,
  type PaymentPlan,
} from './sales';
import { BusinessDateSchema, addDays, addMonths } from './time';

const date = (value: string) => BusinessDateSchema.parse(value);
const egp = (amount: string): Money => money(amount, 'EGP');

const plan = (overrides: Partial<PaymentPlan> = {}): PaymentPlan => ({
  downPayment: egp('0'),
  installmentCount: 12,
  frequency: 'monthly',
  firstDueOn: date('2026-10-01'),
  ...overrides,
});

const sum = (rows: { amount: Money }[]): Money =>
  rows.reduce<Money>((running, row) => addMoney(running, row.amount), egp('0'));

describe('addMonths', () => {
  it('keeps the same day when the target month has it', () => {
    expect(addMonths(date('2026-01-15'), 1)).toBe('2026-02-15');
    expect(addMonths(date('2026-01-15'), 12)).toBe('2027-01-15');
  });

  it('clamps to the last day rather than overflowing into the next month', () => {
    // The classic bug: 31 January + 1 month must not become 3 March.
    expect(addMonths(date('2026-01-31'), 1)).toBe('2026-02-28');
    expect(addMonths(date('2026-03-31'), 1)).toBe('2026-04-30');
  });

  it('does not drift: every date is computed from the origin, not from the previous one', () => {
    const origin = date('2026-01-31');
    expect(addMonths(origin, 1)).toBe('2026-02-28');
    expect(addMonths(origin, 2)).toBe('2026-03-31');
    expect(addMonths(origin, 3)).toBe('2026-04-30');
  });

  it('handles a leap year and negative offsets', () => {
    expect(addMonths(date('2028-01-31'), 1)).toBe('2028-02-29');
    expect(addMonths(date('2026-03-15'), -3)).toBe('2025-12-15');
    expect(addMonths(date('2026-01-31'), -1)).toBe('2025-12-31');
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries without a timezone shifting the day', () => {
    expect(addDays(date('2026-01-31'), 1)).toBe('2026-02-01');
    expect(addDays(date('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(date('2026-03-01'), -1)).toBe('2026-02-28');
  });
});

describe('buildInstallmentSchedule', () => {
  it('produces rows that sum exactly to the total when it divides evenly', () => {
    const rows = buildInstallmentSchedule(egp('1200000'), plan({ installmentCount: 12 }));
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => row.amount.amount === '100000')).toBe(true);
    expect(compareMoney(sum(rows), egp('1200000'))).toBe(0);
  });

  it('sums exactly when the total does not divide evenly, with the odd unit on the earliest row', () => {
    const rows = buildInstallmentSchedule(egp('1000000'), plan({ installmentCount: 3 }));
    expect(rows.map((row) => row.amount.amount)).toEqual(['333333.34', '333333.33', '333333.33']);
    expect(compareMoney(sum(rows), egp('1000000'))).toBe(0);
  });

  it('reconciles across a down payment, installments, and a final payment', () => {
    const rows = buildInstallmentSchedule(
      egp('3000000'),
      plan({
        downPayment: egp('600000'),
        installmentCount: 7,
        finalPayment: egp('400001'),
      }),
    );
    expect(rows[0]?.kind).toBe('downPayment');
    expect(rows.at(-1)?.kind).toBe('finalPayment');
    expect(rows.filter((row) => row.kind === 'installment')).toHaveLength(7);
    expect(compareMoney(sum(rows), egp('3000000'))).toBe(0);
  });

  it('numbers rows consecutively from one', () => {
    const rows = buildInstallmentSchedule(
      egp('500000'),
      plan({ downPayment: egp('100000'), installmentCount: 4, finalPayment: egp('50000') }),
    );
    expect(rows.map((row) => row.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('spaces installments by the chosen frequency, measured from the first due date', () => {
    const quarterly = buildInstallmentSchedule(
      egp('400000'),
      plan({ installmentCount: 4, frequency: 'quarterly', firstDueOn: date('2026-01-31') }),
    );
    // Installment one falls on the first due date itself; the rest step from that origin.
    expect(quarterly.map((row) => row.dueOn)).toEqual([
      '2026-01-31',
      '2026-04-30',
      '2026-07-31',
      '2026-10-31',
    ]);
  });

  it('supports every frequency', () => {
    for (const [frequency, months] of [
      ['monthly', 1],
      ['quarterly', 3],
      ['semiAnnual', 6],
      ['annual', 12],
    ] as const) {
      const rows = buildInstallmentSchedule(
        egp('120000'),
        plan({ installmentCount: 2, frequency, firstDueOn: date('2026-01-15') }),
      );
      expect(rows[0]?.dueOn).toBe('2026-01-15');
      expect(rows[1]?.dueOn).toBe(addMonths(date('2026-01-15'), months));
    }
  });

  it('dates the down payment separately from the first installment when asked', () => {
    const rows = buildInstallmentSchedule(
      egp('1000000'),
      plan({
        downPayment: egp('200000'),
        installmentCount: 4,
        downPaymentDueOn: date('2026-09-22'),
        firstDueOn: date('2026-10-01'),
      }),
    );
    // A deposit at signing and the first installment a period later is the common arrangement.
    expect(rows[0]?.kind).toBe('downPayment');
    expect(rows[0]?.dueOn).toBe('2026-09-22');
    expect(rows[1]?.dueOn).toBe('2026-10-01');
  });

  it('dates the down payment with the installments when no separate date is given', () => {
    const rows = buildInstallmentSchedule(
      egp('1000000'),
      plan({ downPayment: egp('200000'), installmentCount: 4, firstDueOn: date('2026-10-01') }),
    );
    expect(rows[0]?.dueOn).toBe('2026-10-01');
    expect(rows[1]?.dueOn).toBe('2026-10-01');
  });

  it('handles a plan that is a down payment and nothing else', () => {
    const rows = buildInstallmentSchedule(
      egp('250000'),
      plan({ downPayment: egp('250000'), installmentCount: 0 }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('downPayment');
  });

  it('loses nothing when the total is smaller than the number of installments', () => {
    // One piastre across four installments: the first row carries it, the rest are exactly zero.
    const rows = buildInstallmentSchedule(egp('0.01'), plan({ installmentCount: 4 }));
    expect(rows.map((row) => row.amount.amount)).toEqual(['0.01', '0', '0', '0']);
    expect(compareMoney(sum(rows), egp('0.01'))).toBe(0);
  });

  it('splits a whole pound across four installments without rounding it away', () => {
    const rows = buildInstallmentSchedule(egp('1'), plan({ installmentCount: 4 }));
    expect(rows.map((row) => row.amount.amount)).toEqual(['0.25', '0.25', '0.25', '0.25']);
    expect(compareMoney(sum(rows), egp('1'))).toBe(0);
  });

  it('refuses a plan whose currency disagrees with the total', () => {
    expect(() =>
      buildInstallmentSchedule(egp('100000'), plan({ downPayment: money('1000', 'USD') })),
    ).toThrow(PaymentPlanError);
  });

  it('refuses a negative amount anywhere', () => {
    expect(() => buildInstallmentSchedule(egp('100000'), plan({ downPayment: egp('-1') }))).toThrow(
      PaymentPlanError,
    );
    expect(() => buildInstallmentSchedule(egp('-100000'), plan())).toThrow(PaymentPlanError);
  });

  it('refuses a down payment larger than the total', () => {
    expect(() =>
      buildInstallmentSchedule(egp('100000'), plan({ downPayment: egp('100001') })),
    ).toThrow(PaymentPlanError);
  });

  it('refuses a final payment larger than what is left after the down payment', () => {
    expect(() =>
      buildInstallmentSchedule(
        egp('100000'),
        plan({ downPayment: egp('60000'), finalPayment: egp('50000') }),
      ),
    ).toThrow(PaymentPlanError);
  });

  it('refuses to silently drop a remainder that has no installments to carry it', () => {
    expect(() =>
      buildInstallmentSchedule(
        egp('100000'),
        plan({ downPayment: egp('10000'), installmentCount: 0 }),
      ),
    ).toThrow(PaymentPlanError);
  });

  it('reconciles for a long schedule at the maximum length', () => {
    const rows = buildInstallmentSchedule(
      egp('7777777.77'),
      plan({ installmentCount: MAX_INSTALLMENTS }),
    );
    expect(rows).toHaveLength(MAX_INSTALLMENTS);
    expect(compareMoney(sum(rows), egp('7777777.77'))).toBe(0);
  });

  it('reconciles for a spread of awkward totals', () => {
    for (const total of ['0.01', '0.07', '1.11', '999999.99', '1234567.89', '3000000.005']) {
      for (const count of [1, 3, 7, 13, 36]) {
        const rows = buildInstallmentSchedule(
          money(total === '3000000.005' ? '3000000.01' : total, 'EGP'),
          plan({ installmentCount: count }),
        );
        expect(
          compareMoney(sum(rows), money(total === '3000000.005' ? '3000000.01' : total, 'EGP')),
          `${total} over ${count}`,
        ).toBe(0);
      }
    }
  });
});

describe('lastDueDate', () => {
  it('is the last installment when there is no final payment', () => {
    // Six monthly installments from 1 January: the sixth is 1 June, not 1 July.
    expect(lastDueDate(plan({ installmentCount: 6, firstDueOn: date('2026-01-01') }))).toBe(
      '2026-06-01',
    );
  });

  it('includes the final payment cycle when one exists', () => {
    expect(
      lastDueDate(
        plan({ installmentCount: 6, finalPayment: egp('1'), firstDueOn: date('2026-01-01') }),
      ),
    ).toBe('2026-07-01');
  });

  it('agrees with the last row the builder produces', () => {
    for (const options of [
      { installmentCount: 6 },
      { installmentCount: 6, finalPayment: egp('10000') },
      { installmentCount: 1 },
      { installmentCount: 12, frequency: 'quarterly' as const },
    ]) {
      const configured = plan({ ...options, firstDueOn: date('2026-01-31') });
      const rows = buildInstallmentSchedule(egp('600000'), configured);
      expect(rows.at(-1)?.dueOn, JSON.stringify(options)).toBe(lastDueDate(configured));
    }
  });
});

describe('state machines', () => {
  it('lets a reservation reach a contract only through confirmation', () => {
    expect(canTransitionReservation('draft', 'converted')).toBe(false);
    expect(canTransitionReservation('confirmed', 'converted')).toBe(true);
    expect(canTransitionReservation('cancelled', 'confirmed')).toBe(false);
    expect(canTransitionReservation('converted', 'cancelled')).toBe(false);
  });

  it('treats cancelled and completed contracts as terminal', () => {
    expect(canTransitionContract('draft', 'active')).toBe(true);
    expect(canTransitionContract('active', 'completed')).toBe(true);
    expect(canTransitionContract('cancelled', 'active')).toBe(false);
    expect(canTransitionContract('completed', 'cancelled')).toBe(false);
  });
});
