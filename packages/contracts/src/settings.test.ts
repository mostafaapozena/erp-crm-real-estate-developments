import { describe, expect, it } from 'vitest';
import {
  BOUND_LIST_LABEL_NAMESPACES,
  BOUND_REFERENCE_LISTS,
  FEATURE_FLAG_KEYS,
  LOCKED_REFERENCE_LISTS,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  TaxRateSchema,
  isPercentage,
  type SettingDefinition,
} from './settings';

describe('settings catalog (PLAT-024, PLAT-026)', () => {
  it('declares a default every setting accepts — or null, meaning not configured', () => {
    for (const key of SETTING_KEYS) {
      const definition: SettingDefinition = SETTING_DEFINITIONS[key];
      if (definition.defaultValue === null) {
        // An undecided value must say which open decision it waits for: a stakeholder item (SD-nn) or
        // one of its refined entries in the business decision register (BD-nn).
        expect(definition.decision, key).toMatch(/^(SD|BD)-\d{2}$/);
        continue;
      }
      expect(definition.schema.safeParse(definition.defaultValue).success, key).toBe(true);
    }
  });

  it('keeps feature flags boolean, and every gated one names its gate', () => {
    expect(FEATURE_FLAG_KEYS.length).toBeGreaterThan(0);
    for (const key of FEATURE_FLAG_KEYS) {
      const definition: SettingDefinition = SETTING_DEFINITIONS[key];
      expect(definition.schema.safeParse(true).success, key).toBe(true);
      expect(definition.schema.safeParse('true').success, key).toBe(false);
      if (definition.lockedBy) expect(definition.lockedBy).toMatch(/^ADR-\d{4}$/);
    }
  });

  it('insists on the mandatory fifteen-day reminder', () => {
    const schema = SETTING_DEFINITIONS['collections.reminderWindowsDays'].schema;
    expect(schema.safeParse([15, 7]).success).toBe(true);
    expect(schema.safeParse([7]).success).toBe(false);
  });
});

describe('reference lists (PLAT-025)', () => {
  it('labels every bound list from a translation namespace', () => {
    for (const list of Object.keys(BOUND_REFERENCE_LISTS)) {
      expect(
        BOUND_LIST_LABEL_NAMESPACES[list as keyof typeof BOUND_LIST_LABEL_NAMESPACES],
        list,
      ).toBeDefined();
    }
  });

  it('locks only bound lists', () => {
    for (const list of LOCKED_REFERENCE_LISTS) expect(BOUND_REFERENCE_LISTS[list]).toBeDefined();
  });
});

describe('tax rates never pass through floating point', () => {
  it.each([
    ['0', true],
    ['14', true],
    ['15.5', true],
    ['99.999', true],
    ['100', true],
    ['100.000', true],
    ['0100', true],
    ['100.001', false],
    ['101', false],
    ['1000', false],
    ['-1', false],
  ])('%s is a percentage: %s', (value, expected) => {
    expect(isPercentage(value)).toBe(expected);
  });

  it('refuses a rate outside 0–100 and anything that is not a decimal string', () => {
    for (const ratePercent of ['100.01', '-0.5', '1e2', 'NaN', '']) {
      expect(
        TaxRateSchema.safeParse({ ratePercent, effectiveFrom: '2026-01-01' }).success,
        ratePercent,
      ).toBe(false);
    }
    expect(
      TaxRateSchema.safeParse({ ratePercent: '14', effectiveFrom: '2026-01-01' }).success,
    ).toBe(true);
  });
});
