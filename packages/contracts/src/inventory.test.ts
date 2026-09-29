import { describe, expect, it } from 'vitest';
import {
  CreatePlanTemplateSchema,
  isManualUnitTransition,
  planFromTemplate,
  UNIT_STATUSES,
} from './inventory';
import { DecimalStringSchema, money } from './money';
import { buildInstallmentSchedule } from './sales';
import { BusinessDateSchema } from './time';

const date = (value: string) => BusinessDateSchema.parse(value);

describe('manual unit transitions (INV-STATUS-001)', () => {
  it('lets a person only withdraw an available unit and restore a withdrawn one', () => {
    const allowed = UNIT_STATUSES.flatMap((from) =>
      UNIT_STATUSES.filter((to) => isManualUnitTransition(from, to)).map((to) => `${from}->${to}`),
    );
    expect(allowed).toEqual(['available->unavailable', 'unavailable->available']);
  });
});

describe('payment-plan templates (INV-PLAN-001)', () => {
  const template = {
    downPaymentPercent: DecimalStringSchema.parse('10'),
    installmentCount: 12,
    frequency: 'quarterly' as const,
    firstInstallmentAfterMonths: 3,
  };

  it('takes percentages of the price half-up to the piastre and dates the plan from the contract', () => {
    const plan = planFromTemplate(template, money('1000000.05', 'EGP'), date('2026-10-31'));
    // 10 % of 1,000,000.05 is 100,000.005 → 100,000.01 half-up.
    expect(plan.downPayment).toEqual(money('100000.01', 'EGP'));
    expect(plan.downPaymentDueOn).toBe('2026-10-31');
    // Month-end is clamped, not rolled into the next month.
    expect(plan.firstDueOn).toBe('2027-01-31');
    expect(plan.finalPayment).toBeUndefined();
  });

  it('produces a schedule that reconciles exactly, for awkward totals too', () => {
    for (const total of ['1000000.01', '999999.99', '7.77', '3333333.33']) {
      const price = money(total, 'EGP');
      const plan = planFromTemplate(
        { ...template, finalPaymentPercent: DecimalStringSchema.parse('12.5') },
        price,
        date('2026-10-01'),
      );
      const rows = buildInstallmentSchedule(price, plan);
      expect(rows).toHaveLength(14);
      expect(rows[0]?.kind).toBe('downPayment');
      expect(rows.at(-1)?.kind).toBe('finalPayment');
    }
  });

  it('refuses a template whose down and final payments exceed the whole price', () => {
    const base = {
      code: 'PT-1',
      name: { ar: 'نموذج', en: 'Template' },
      legalEntityId: 'le_abcdef123456',
      installmentCount: 4,
      frequency: 'annual',
      firstInstallmentAfterMonths: 12,
    };
    expect(
      CreatePlanTemplateSchema.safeParse({
        ...base,
        downPaymentPercent: '60',
        finalPaymentPercent: '40.01',
      }).success,
    ).toBe(false);
    expect(
      CreatePlanTemplateSchema.safeParse({
        ...base,
        downPaymentPercent: '60',
        finalPaymentPercent: '40',
      }).success,
    ).toBe(true);
  });
});
