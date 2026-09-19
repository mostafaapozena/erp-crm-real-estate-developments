import { DecimalStringSchema } from '@alola/contracts';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { fromDecimal128, toDecimal128 } from './money-storage';

describe('Decimal128 money storage (PLAT-012)', () => {
  it('round-trips exactly without passing through a number', () => {
    for (const value of ['0', '0.1', '-12.345', '9007199254740993.01', '100.50']) {
      const stored = toDecimal128(DecimalStringSchema.parse(value));
      expect(stored).toBeInstanceOf(Types.Decimal128);
      expect(fromDecimal128(stored)).toBe(value);
    }
  });

  it('normalizes exponent notation from the database', () => {
    expect(fromDecimal128(Types.Decimal128.fromString('1.50E+3'))).toBe('1500');
    expect(fromDecimal128(Types.Decimal128.fromString('12E-4'))).toBe('0.0012');
    expect(fromDecimal128(Types.Decimal128.fromString('-5E+0'))).toBe('-5');
  });
});
