import {
  BusinessDateSchema,
  ERROR_CODES,
  InstantSchema,
  money,
  type Locale,
} from '@alola/contracts';
import { describe, expect, it } from 'vitest';
import {
  checkResources,
  createFormatters,
  directionOf,
  localeSettings,
  requiredPluralCategories,
  resources,
  type ResourceTree,
} from './index';

describe('translation resources (I18N-001, I18N-002)', () => {
  it('have no missing, empty, or incomplete plural keys in either locale', () => {
    expect(checkResources(resources)).toEqual([]);
  });

  it('define a localized message for every API error code (I18N-008)', () => {
    for (const locale of ['ar', 'en'] as const) {
      const errors: Record<string, string> = resources[locale].errors;
      for (const code of ERROR_CODES) expect(errors[code], `${locale}.${code}`).toBeTruthy();
    }
  });

  it('detects a key missing from one locale', () => {
    const broken = {
      ar: { common: { a: 'أ', b: 'ب' } },
      en: { common: { a: 'A' } },
    } satisfies Record<Locale, Record<string, ResourceTree>>;
    expect(checkResources(broken)).toContainEqual({
      locale: 'en',
      namespace: 'common',
      key: 'b',
      problem: 'missing',
    });
  });

  it('detects empty values and missing Arabic plural forms', () => {
    const broken = {
      ar: { common: { n_one: 'واحد', n_other: '{{count}}', e: ' ' } },
      en: { common: { n_one: 'one', n_other: '{{count}}', e: 'E' } },
    } satisfies Record<Locale, Record<string, ResourceTree>>;
    const problems = checkResources(broken);
    expect(problems).toContainEqual({
      locale: 'ar',
      namespace: 'common',
      key: 'e',
      problem: 'empty',
    });
    for (const category of ['zero', 'two', 'few', 'many']) {
      expect(problems).toContainEqual({
        locale: 'ar',
        namespace: 'common',
        key: `n_${category}`,
        problem: 'missing-plural-form',
      });
    }
  });

  it('knows Arabic has six plural categories and English two', () => {
    expect(requiredPluralCategories('ar').sort()).toEqual(
      ['few', 'many', 'one', 'other', 'two', 'zero'].sort(),
    );
    expect(requiredPluralCategories('en').sort()).toEqual(['one', 'other']);
  });
});

describe('direction and typography (I18N-003, I18N-007)', () => {
  it('derives direction from locale', () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
  });

  it('uses Alexandria for Arabic and Inter for English, each with fallbacks', () => {
    expect(localeSettings('ar').fontFamily).toMatch(/^'Alexandria',.+sans-serif$/);
    expect(localeSettings('en').fontFamily).toMatch(/^'Inter',.+sans-serif$/);
    expect(localeSettings('ar').lineHeight).toBeGreaterThan(localeSettings('en').lineHeight);
  });
});

describe('formatting (I18N-006)', () => {
  const instant = InstantSchema.parse('2026-09-19T22:30:00.000Z');

  it('displays instants in the organization timezone, not the process timezone', () => {
    const utc = createFormatters('en', { timeZone: 'UTC' }).instant(instant, 'date');
    const tokyo = createFormatters('en', { timeZone: 'Asia/Tokyo' }).instant(instant, 'date');
    expect(utc).toContain('19');
    expect(tokyo).toContain('20');
  });

  it('never shifts a business date', () => {
    const date = BusinessDateSchema.parse('2026-03-01');
    for (const timeZone of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      expect(createFormatters('en', { timeZone }).businessDate(date)).toContain('Mar 1, 2026');
    }
  });

  it('formats money exactly from its decimal string with the configured precision', () => {
    const f = createFormatters('en', { timeZone: 'UTC' });
    expect(f.money(money('12345678901234567.89', 'EGP'), 2)).toContain('12,345,678,901,234,567.89');
    expect(f.money(money('5', 'EGP'), 3)).toContain('5.000');
  });

  it('formats dates per locale and percentages exactly', () => {
    const ar = createFormatters('ar', { timeZone: 'UTC' });
    const en = createFormatters('en', { timeZone: 'UTC' });
    expect(ar.instant(instant, 'date')).not.toBe(en.instant(instant, 'date'));
    expect(en.percent('0.155')).toBe('15.5%');
  });

  it('uses one digit shape for Arabic consistently (CLDR default for "ar")', () => {
    // Western vs Arabic-Indic digits for Arabic is an open presentation decision. Until it is made,
    // every formatter uses the same CLDR default, so digits never mix within a screen.
    const ar = createFormatters('ar', { timeZone: 'UTC' });
    const shape = (text: string) => (/[٠-٩]/.test(text) ? 'arab' : 'latn');
    expect(shape(ar.number('1234.5'))).toBe(shape(ar.money(money('1234.5', 'EGP'), 2)));
    expect(shape(ar.number('1234.5'))).toBe(shape(ar.percent('0.5')));
  });
});
