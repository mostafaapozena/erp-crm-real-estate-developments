import Decimal from 'decimal.js';
import { z } from 'zod';

/**
 * Decimal-safe money (PLAT-012, ADR-0007).
 *
 * - Transport: a decimal **string**, never a JSON number — a number is binary floating point by the
 *   time any JavaScript runtime parses it.
 * - Arithmetic: `decimal.js`, never `number`.
 * - Storage: `Decimal128`, converted at the persistence boundary (apps/api).
 * - Rounding: always explicit — the caller names the scale and the mode.
 */

/** A dedicated Decimal constructor so no other module's global Decimal settings can affect money. */
const MoneyDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

const DECIMAL_STRING = /^-?(0|[1-9]\d*)(\.\d+)?$/;

export const DecimalStringSchema = z
  .string()
  .regex(DECIMAL_STRING, { message: 'DECIMAL_STRING_EXPECTED' })
  .brand<'DecimalString'>();
export type DecimalString = z.infer<typeof DecimalStringSchema>;

/** ISO 4217 alphabetic code. Which currencies are enabled is organization configuration. */
export const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, { message: 'CURRENCY_CODE_EXPECTED' });

export const MoneySchema = z.strictObject({
  amount: DecimalStringSchema,
  currency: CurrencyCodeSchema,
});
export type Money = z.infer<typeof MoneySchema>;

export const ROUNDING_MODES = {
  halfUp: MoneyDecimal.ROUND_HALF_UP,
  halfEven: MoneyDecimal.ROUND_HALF_EVEN,
  down: MoneyDecimal.ROUND_DOWN,
  up: MoneyDecimal.ROUND_UP,
} as const;
export type RoundingMode = keyof typeof ROUNDING_MODES;

export class MoneyError extends Error {
  constructor(readonly code: 'CURRENCY_MISMATCH' | 'INVALID_AMOUNT' | 'INVALID_ALLOCATION') {
    super(code);
    this.name = 'MoneyError';
  }
}

function toDecimal(amount: string): Decimal {
  if (!DECIMAL_STRING.test(amount)) throw new MoneyError('INVALID_AMOUNT');
  return new MoneyDecimal(amount);
}

function asDecimalString(value: Decimal): DecimalString {
  // toFixed() never uses exponent notation, unlike toString() for very small or large values.
  const text = value.isZero() ? '0' : value.toFixed();
  return text as DecimalString;
}

export function money(amount: string, currency: string): Money {
  return MoneySchema.parse({ amount, currency });
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new MoneyError('CURRENCY_MISMATCH');
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return {
    amount: asDecimalString(toDecimal(a.amount).plus(toDecimal(b.amount))),
    currency: a.currency,
  };
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return {
    amount: asDecimalString(toDecimal(a.amount).minus(toDecimal(b.amount))),
    currency: a.currency,
  };
}

/** Multiply by a decimal factor (e.g. a percentage as `"0.15"`). The result is **not** rounded. */
export function multiplyMoney(a: Money, factor: string): Money {
  return {
    amount: asDecimalString(toDecimal(a.amount).times(toDecimal(factor))),
    currency: a.currency,
  };
}

export function roundMoney(a: Money, scale: number, mode: RoundingMode): Money {
  if (!Number.isInteger(scale) || scale < 0) throw new MoneyError('INVALID_AMOUNT');
  return {
    amount: asDecimalString(toDecimal(a.amount).toDecimalPlaces(scale, ROUNDING_MODES[mode])),
    currency: a.currency,
  };
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return toDecimal(a.amount).comparedTo(toDecimal(b.amount)) as -1 | 0 | 1;
}

/**
 * Split `total` by integer weights at `scale` decimal places so the parts sum **exactly** to the
 * total. Remainder units go to the earliest parts, one unit each, which is deterministic and auditable.
 */
export function allocateMoney(total: Money, weights: readonly number[], scale: number): Money[] {
  if (
    weights.length === 0 ||
    !weights.every((w) => Number.isInteger(w) && w >= 0) ||
    !weights.some((w) => w > 0) ||
    !Number.isInteger(scale) ||
    scale < 0
  ) {
    throw new MoneyError('INVALID_ALLOCATION');
  }
  const unit = new MoneyDecimal(10).pow(-scale);
  const totalDecimal = toDecimal(total.amount);
  if (!totalDecimal.toDecimalPlaces(scale).equals(totalDecimal)) {
    throw new MoneyError('INVALID_ALLOCATION');
  }
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  const parts = weights.map((w) =>
    totalDecimal.times(w).dividedBy(weightSum).toDecimalPlaces(scale, MoneyDecimal.ROUND_DOWN),
  );
  let remainder = totalDecimal.minus(parts.reduce((sum, p) => sum.plus(p), new MoneyDecimal(0)));
  const step = totalDecimal.isNegative() ? unit.negated() : unit;
  for (let i = 0; !remainder.isZero(); i = (i + 1) % parts.length) {
    if (weights[i] === 0) continue;
    parts[i] = (parts[i] ?? new MoneyDecimal(0)).plus(step);
    remainder = remainder.minus(step);
  }
  return parts.map((p) => ({ amount: asDecimalString(p), currency: total.currency }));
}
