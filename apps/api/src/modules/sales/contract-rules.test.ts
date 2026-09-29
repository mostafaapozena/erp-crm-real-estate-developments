import { describe, expect, it } from 'vitest';
import {
  BusinessDateSchema,
  addMoney,
  buildInstallmentSchedule,
  money,
  scheduleTotal,
  type PaymentPlan,
} from '@alola/contracts';
import { amendmentRows, partyIssues, samePlan } from './contract-rules';

const date = (value: string) => BusinessDateSchema.parse(value);
const egp = (amount: string) => money(amount, 'EGP');

describe('contract parties (SALE-CONTRACT-002)', () => {
  it('accepts one buyer at 100 %', () => {
    expect(
      partyIssues([{ role: 'buyer', customerId: 'cus_a', sharePercent: '100' }], 'cus_a'),
    ).toBeUndefined();
  });

  it('accepts shares that total exactly 100 in decimals', () => {
    expect(
      partyIssues(
        [
          { role: 'buyer', customerId: 'cus_a', sharePercent: '33.3334' },
          { role: 'coBuyer', customerId: 'cus_b', sharePercent: '33.3333' },
          { role: 'coBuyer', customerId: 'cus_c', sharePercent: '33.3333' },
          { role: 'guarantor', customerId: 'cus_d' },
        ],
        'cus_a',
      ),
    ).toBeUndefined();
  });

  it('refuses shares a piece short of 100', () => {
    expect(
      partyIssues(
        [
          { role: 'buyer', customerId: 'cus_a', sharePercent: '33.3333' },
          { role: 'coBuyer', customerId: 'cus_b', sharePercent: '33.3333' },
          { role: 'coBuyer', customerId: 'cus_c', sharePercent: '33.3333' },
        ],
        'cus_a',
      )?.issue,
    ).toBe('SHARES_MUST_TOTAL_100');
  });

  it('requires exactly one buyer, and it is the reservation customer', () => {
    expect(
      partyIssues([{ role: 'coBuyer', customerId: 'cus_a', sharePercent: '100' }], 'cus_a')?.issue,
    ).toBe('ONE_BUYER_REQUIRED');
    expect(
      partyIssues([{ role: 'buyer', customerId: 'cus_b', sharePercent: '100' }], 'cus_a')?.issue,
    ).toBe('BUYER_IS_RESERVATION_CUSTOMER');
  });

  it('refuses a share on a guarantor, a missing share on a co-buyer, and a repeated person', () => {
    expect(
      partyIssues(
        [
          { role: 'buyer', customerId: 'cus_a', sharePercent: '100' },
          { role: 'guarantor', customerId: 'cus_b', sharePercent: '10' },
        ],
        'cus_a',
      )?.issue,
    ).toBe('SHARE_NOT_ALLOWED');
    expect(
      partyIssues(
        [
          { role: 'buyer', customerId: 'cus_a', sharePercent: '100' },
          { role: 'coBuyer', customerId: 'cus_b' },
        ],
        'cus_a',
      )?.issue,
    ).toBe('SHARE_REQUIRED');
    expect(
      partyIssues(
        [
          { role: 'buyer', customerId: 'cus_a', sharePercent: '100' },
          { role: 'guarantor', customerId: 'cus_a' },
        ],
        'cus_a',
      )?.issue,
    ).toBe('DUPLICATE_PARTY');
  });
});

describe('plans compared as terms, not text', () => {
  const plan: PaymentPlan = {
    downPayment: egp('100000'),
    installmentCount: 12,
    frequency: 'monthly',
    firstDueOn: date('2026-11-01'),
  };

  it('treats 100000 and 100000.00 as the same amount', () => {
    expect(samePlan(plan, { ...plan, downPayment: egp('100000.00') })).toBe(true);
  });

  it('sees a changed count, date, milestone or maintenance deposit', () => {
    expect(samePlan(plan, { ...plan, installmentCount: 13 })).toBe(false);
    expect(samePlan(plan, { ...plan, firstDueOn: date('2026-12-01') })).toBe(false);
    expect(
      samePlan(plan, { ...plan, milestones: [{ dueOn: date('2027-06-01'), amount: egp('1') }] }),
    ).toBe(false);
    expect(
      samePlan(plan, {
        ...plan,
        maintenanceDeposit: { amount: egp('5000'), dueOn: date('2027-06-01') },
      }),
    ).toBe(false);
  });
});

describe('amendment rows (SALE-CHANGE-001)', () => {
  it('reconcile exactly to what was owed and continue the numbering', () => {
    const rows = amendmentRows(
      egp('100000.01'),
      { installmentCount: 3, frequency: 'quarterly', firstDueOn: date('2027-01-15') },
      14,
    );
    expect(rows.map((row) => row.sequence)).toEqual([15, 16, 17]);
    expect(rows.map((row) => row.amount.amount)).toEqual(['33333.34', '33333.34', '33333.33']);
    expect(rows.map((row) => row.dueOn)).toEqual(['2027-01-15', '2027-04-15', '2027-07-15']);
    const sum = rows.reduce((running, row) => addMoney(running, row.amount), egp('0'));
    expect(sum.amount).toBe('100000.01');
  });

  it('carry a final payment inside the same total', () => {
    const rows = amendmentRows(
      egp('90000'),
      {
        installmentCount: 2,
        frequency: 'monthly',
        firstDueOn: date('2027-01-01'),
        finalPayment: egp('30000'),
      },
      0,
    );
    expect(rows.map((row) => [row.kind, row.amount.amount])).toEqual([
      ['installment', '30000'],
      ['installment', '30000'],
      ['finalPayment', '30000'],
    ]);
  });
});

describe('milestones and the maintenance deposit (COL-SCHEDULE-001)', () => {
  const base: PaymentPlan = {
    downPayment: egp('200000'),
    downPaymentDueOn: date('2026-10-01'),
    installmentCount: 4,
    frequency: 'quarterly',
    firstDueOn: date('2026-11-01'),
  };

  it('places a milestone in date order and splits only what is left', () => {
    const rows = buildInstallmentSchedule(egp('1000000'), {
      ...base,
      milestones: [
        {
          dueOn: date('2027-03-01'),
          amount: egp('100000'),
          label: { ar: 'استلام الهيكل', en: 'Structure complete' },
        },
      ],
    });
    expect(rows.map((row) => [row.sequence, row.kind, row.dueOn, row.amount.amount])).toEqual([
      [1, 'downPayment', '2026-10-01', '200000'],
      [2, 'installment', '2026-11-01', '175000'],
      [3, 'installment', '2027-02-01', '175000'],
      [4, 'milestone', '2027-03-01', '100000'],
      [5, 'installment', '2027-05-01', '175000'],
      [6, 'installment', '2027-08-01', '175000'],
    ]);
  });

  it('adds the maintenance deposit to the price rather than taking it from it', () => {
    const plan: PaymentPlan = {
      ...base,
      maintenanceDeposit: { amount: egp('80000'), dueOn: date('2028-01-01') },
    };
    const rows = buildInstallmentSchedule(egp('1000000'), plan);
    expect(rows.at(-1)).toMatchObject({ kind: 'maintenanceDeposit', amount: egp('80000') });
    const sum = rows.reduce((running, row) => addMoney(running, row.amount), egp('0'));
    expect(sum).toEqual(scheduleTotal(egp('1000000'), plan));
    expect(sum.amount).toBe('1080000');
  });

  it('refuses milestones beyond what the price leaves, and an empty row', () => {
    expect(() =>
      buildInstallmentSchedule(egp('1000000'), {
        ...base,
        milestones: [{ dueOn: date('2027-03-01'), amount: egp('900000') }],
      }),
    ).toThrow('MILESTONES_EXCEED_REMAINDER');
    expect(() =>
      buildInstallmentSchedule(egp('1000000'), {
        ...base,
        milestones: [{ dueOn: date('2027-03-01'), amount: egp('0') }],
      }),
    ).toThrow('EMPTY_ROW');
  });
});
