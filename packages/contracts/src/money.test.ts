import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  MoneySchema,
  addMoney,
  allocateMoney,
  compareMoney,
  money,
  multiplyMoney,
  roundMoney,
  subtractMoney,
  type Money,
} from './money';

const sum = (parts: { amount: string }[]) =>
  parts.reduce<Money>((total, p) => addMoney(total, money(p.amount, 'EGP')), money('0', 'EGP'))
    .amount;

describe('money (PLAT-012)', () => {
  it('adds without binary floating-point error', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in binary floating point.
    expect(addMoney(money('0.1', 'EGP'), money('0.2', 'EGP')).amount).toBe('0.3');
  });

  it('keeps large values exact', () => {
    expect(addMoney(money('9007199254740993.01', 'EGP'), money('1', 'EGP')).amount).toBe(
      '9007199254740994.01',
    );
  });

  it('subtracts and compares', () => {
    const a = money('100.50', 'EGP');
    const b = money('0.75', 'EGP');
    expect(subtractMoney(a, b).amount).toBe('99.75');
    expect(compareMoney(a, b)).toBe(1);
    expect(compareMoney(b, a)).toBe(-1);
    expect(compareMoney(a, money('100.5', 'EGP'))).toBe(0);
  });

  it('refuses to combine different currencies', () => {
    expect(() => addMoney(money('1', 'EGP'), money('1', 'USD'))).toThrow(MoneyError);
  });

  it('does not round implicitly; rounding is explicit in scale and mode', () => {
    const product = multiplyMoney(money('10.05', 'EGP'), '0.5');
    expect(product.amount).toBe('5.025');
    expect(roundMoney(product, 2, 'halfUp').amount).toBe('5.03');
    expect(roundMoney(product, 2, 'halfEven').amount).toBe('5.02');
    expect(roundMoney(product, 2, 'down').amount).toBe('5.02');
  });

  it('rejects numbers and malformed strings at the transport boundary', () => {
    expect(MoneySchema.safeParse({ amount: 10.5, currency: 'EGP' }).success).toBe(false);
    expect(MoneySchema.safeParse({ amount: '1e3', currency: 'EGP' }).success).toBe(false);
    expect(MoneySchema.safeParse({ amount: '01.5', currency: 'EGP' }).success).toBe(false);
    expect(MoneySchema.safeParse({ amount: '10.50', currency: 'egp' }).success).toBe(false);
    expect(MoneySchema.safeParse({ amount: '10.50', currency: 'EGP', extra: true }).success).toBe(
      false,
    );
  });

  describe('allocation', () => {
    it('splits a total that does not divide evenly so the parts sum exactly', () => {
      const parts = allocateMoney(money('100.00', 'EGP'), [1, 1, 1], 2);
      expect(parts.map((p) => p.amount)).toEqual(['33.34', '33.33', '33.33']);
      expect(sum(parts)).toBe('100');
    });

    it('respects weights and skips zero weights for the remainder', () => {
      const parts = allocateMoney(money('10.01', 'EGP'), [0, 1, 2], 2);
      expect(parts[0]?.amount).toBe('0');
      expect(sum(parts)).toBe('10.01');
    });

    it('handles negative totals (reversals)', () => {
      const parts = allocateMoney(money('-100.00', 'EGP'), [1, 1, 1], 2);
      expect(sum(parts)).toBe('-100');
    });

    it('rejects a total with more precision than the allocation scale', () => {
      expect(() => allocateMoney(money('1.005', 'EGP'), [1, 1], 2)).toThrow(MoneyError);
    });

    it('rejects invalid weights', () => {
      expect(() => allocateMoney(money('1', 'EGP'), [], 2)).toThrow(MoneyError);
      expect(() => allocateMoney(money('1', 'EGP'), [0, 0], 2)).toThrow(MoneyError);
      expect(() => allocateMoney(money('1', 'EGP'), [1.5], 2)).toThrow(MoneyError);
    });
  });
});
