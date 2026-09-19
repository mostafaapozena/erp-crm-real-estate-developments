import { DecimalStringSchema, type DecimalString } from '@alola/contracts';
import { Types } from 'mongoose';

/**
 * Money persistence boundary (PLAT-012, ADR-0007): decimal strings in the application, `Decimal128`
 * in MongoDB. Conversion never passes through a JavaScript number.
 */
export function toDecimal128(amount: DecimalString): Types.Decimal128 {
  return Types.Decimal128.fromString(amount);
}

export function fromDecimal128(value: Types.Decimal128): DecimalString {
  return DecimalStringSchema.parse(normalize(value.toString()));
}

/** Decimal128 may render `1.50E+3` style or trailing zeros; normalize to a plain decimal string. */
function normalize(text: string): string {
  if (!/e/i.test(text)) return text;
  const [mantissa = '0', exponentText = '0'] = text.toLowerCase().split('e');
  const exponent = Number.parseInt(exponentText, 10);
  const negative = mantissa.startsWith('-');
  const [intPart = '0', fracPart = ''] = mantissa.replace('-', '').split('.');
  const digits = intPart + fracPart;
  const point = intPart.length + exponent;
  let result: string;
  if (point <= 0) result = `0.${'0'.repeat(-point)}${digits}`;
  else if (point >= digits.length) result = digits + '0'.repeat(point - digits.length);
  else result = `${digits.slice(0, point)}.${digits.slice(point)}`;
  result = result.replace(/^0+(?=\d)/, '');
  if (result.includes('.')) result = result.replace(/\.?0+$/, '');
  return negative && result !== '0' ? `-${result}` : result;
}
