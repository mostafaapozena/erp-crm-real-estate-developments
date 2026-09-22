import { describe, expect, it } from 'vitest';
import {
  BusinessCodeSchema,
  EnteredNameSchema,
  PhoneSchema,
  RecordIdSchema,
  normalizePhone,
} from './identifiers';

describe('RecordIdSchema', () => {
  it('accepts a prefixed identifier and rejects anything else', () => {
    expect(RecordIdSchema.safeParse('unit_3f2a9c1d4e5b6a7c8d9e0f1a2b3c4d5e').success).toBe(true);
    expect(RecordIdSchema.safeParse('le_abc123').success).toBe(true);
    // A bare MongoDB ObjectId has no prefix, so it can never be mistaken for a record identifier.
    expect(RecordIdSchema.safeParse('507f1f77bcf86cd799439011').success).toBe(false);
    expect(RecordIdSchema.safeParse('unit_').success).toBe(false);
    expect(RecordIdSchema.safeParse('_abc123').success).toBe(false);
    // No path traversal, no operator, no separator that changes meaning in a URL or a query.
    expect(RecordIdSchema.safeParse('unit_../../etc').success).toBe(false);
    expect(RecordIdSchema.safeParse('$ne').success).toBe(false);
  });
});

describe('PhoneSchema', () => {
  it('accepts the formats people actually type for one number', () => {
    for (const value of [
      '+20 100 555 0001',
      '(020) 100-555-0001',
      '0100.555.0001',
      '+201005550001',
      '01005550001',
    ]) {
      expect(PhoneSchema.safeParse(value).success, value).toBe(true);
    }
  });

  it('rejects values that are not phone numbers', () => {
    for (const value of ['', 'abc', '+', '12345', 'DROP TABLE', '+1234567890123456789']) {
      expect(PhoneSchema.safeParse(value).success, value).toBe(false);
    }
  });

  it('normalizes to digits only, so formatting differences match', () => {
    expect(normalizePhone('+20 100 555 0001')).toBe('201005550001');
    expect(normalizePhone('(020) 100-555-0001')).toBe('0201005550001');
    expect(normalizePhone('+20 100 555 0001')).toBe(normalizePhone('+201005550001'));
  });

  it('never rewrites the entered value', () => {
    const entered = '+20 100 555 0001';
    expect(PhoneSchema.parse(entered)).toBe(entered);
  });
});

describe('BusinessCodeSchema', () => {
  it('accepts an uppercase business code and rejects a lowercase or spaced one', () => {
    expect(BusinessCodeSchema.safeParse('A-1201').success).toBe(true);
    expect(BusinessCodeSchema.safeParse('TOWER/B/12').success).toBe(true);
    expect(BusinessCodeSchema.safeParse('a-1201').success).toBe(false);
    expect(BusinessCodeSchema.safeParse('A 1201').success).toBe(false);
    expect(BusinessCodeSchema.safeParse('-A1201').success).toBe(false);
  });
});

describe('EnteredNameSchema', () => {
  it('keeps Arabic text exactly as entered and trims only surrounding whitespace', () => {
    expect(EnteredNameSchema.parse('  محمود عبد الله  ')).toBe('محمود عبد الله');
  });

  it('rejects a name too short to be one', () => {
    expect(EnteredNameSchema.safeParse('م').success).toBe(false);
  });
});
