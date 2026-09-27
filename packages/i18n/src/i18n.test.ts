import {
  BusinessDateSchema,
  DecimalStringSchema,
  ERROR_CODES,
  InstantSchema,
  money,
  type Locale,
} from '@alola/contracts';
import { describe, expect, it } from 'vitest';
import {
  DISPLAYED_ENUMS,
  checkEnumLabels,
  checkResources,
  createFormatters,
  formattingLocale,
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

describe('displayed domain enumerations (I18N-002, I18N-008)', () => {
  it('label every value of every displayed enumeration in both languages', () => {
    expect(checkEnumLabels(resources)).toEqual([]);
  });

  it('cover the receipt state that once reached the screen untranslated', () => {
    expect(DISPLAYED_ENUMS['receiptState']).toEqual(['posted', 'reversed']);
  });

  it('fail when a namespace is missing from both languages — which key parity cannot see', () => {
    const symmetric = {
      ar: { common: { other: 'أ' } },
      en: { common: { other: 'A' } },
    } satisfies Record<Locale, Record<string, ResourceTree>>;
    // Parity is satisfied: both locales are equally incomplete.
    expect(checkResources(symmetric)).toEqual([]);
    expect(checkEnumLabels(symmetric, { receiptState: ['posted'] })).toEqual([
      { locale: 'ar', key: 'receiptState.posted', problem: 'missing-enum-label' },
      { locale: 'en', key: 'receiptState.posted', problem: 'missing-enum-label' },
    ]);
  });

  it('fail on an empty label', () => {
    const empty = {
      ar: { common: { receiptState: { posted: ' ' } } },
      en: { common: { receiptState: { posted: 'Posted' } } },
    } satisfies Record<Locale, Record<string, ResourceTree>>;
    expect(checkEnumLabels(empty, { receiptState: ['posted'] })).toEqual([
      { locale: 'ar', key: 'receiptState.posted', problem: 'missing-enum-label' },
    ]);
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

const NBSP = ' ';
const LRM = '\u200E';
const ARABIC_INDIC = /[\u0660-\u0669\u06F0-\u06F9]/;

describe('formatting (I18N-006)', () => {
  const instant = InstantSchema.parse('2026-09-19T22:30:00.000Z');

  it('displays instants in the organization timezone, not the process timezone', () => {
    expect(createFormatters('en', { timeZone: 'UTC' }).instant(instant)).toBe('19/09/2026 22:30');
    expect(createFormatters('en', { timeZone: 'Asia/Tokyo' }).instant(instant)).toBe(
      '20/09/2026 07:30',
    );
  });

  it('never shifts a business date', () => {
    const date = BusinessDateSchema.parse('2026-03-01');
    for (const timeZone of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      expect(createFormatters('ar', { timeZone }).businessDate(date)).toBe('01/03/2026');
    }
  });

  it('formats money exactly from its decimal string with the configured precision', () => {
    const f = createFormatters('en', { timeZone: 'UTC' });
    expect(f.money(money('12345678901234567.89', 'EGP'), 2)).toBe(
      `EGP${NBSP}12,345,678,901,234,567.89`,
    );
    expect(f.money(money('5', 'EGP'), 3)).toBe(`EGP${NBSP}5.000`);
  });
});

describe('SD-23: Western digits in Arabic and English', () => {
  const ar = createFormatters('ar', { timeZone: 'UTC' });
  const en = createFormatters('en', { timeZone: 'UTC' });
  const date = BusinessDateSchema.parse('2026-09-15');
  const instant = InstantSchema.parse('2026-09-15T08:05:00.000Z');

  it.each([
    ['number', ar.number('1234.5', 2), en.number('1234.5', 2), '1,234.50', '1,234.50'],
    ['number, natural precision', ar.number('1234.5'), en.number('1234.5'), '1,234.5', '1,234.5'],
    ['large number', ar.number('250000'), en.number('250000'), '250,000', '250,000'],
    ['percentage', ar.percent('0.155'), en.percent('0.155'), '15.5%', '15.5%'],
    [
      'money, whole',
      ar.money(money('250000', 'EGP'), 0),
      en.money(money('250000', 'EGP'), 0),
      `250,000${NBSP}ج.م.`,
      `EGP${NBSP}250,000`,
    ],
    [
      'money, two decimals',
      ar.money(money('1234.5', 'EGP'), 2),
      en.money(money('1234.5', 'EGP'), 2),
      `1,234.50${NBSP}ج.م.`,
      `EGP${NBSP}1,234.50`,
    ],
    ['business date', ar.businessDate(date), en.businessDate(date), '15/09/2026', '15/09/2026'],
    ['date', ar.instant(instant, 'date'), en.instant(instant, 'date'), '15/09/2026', '15/09/2026'],
    [
      'date and time',
      ar.instant(instant),
      en.instant(instant),
      '15/09/2026 08:05',
      '15/09/2026 08:05',
    ],
  ])('%s', (_label, arabic, english, expectedArabic, expectedEnglish) => {
    expect(arabic).toBe(expectedArabic);
    expect(english).toBe(expectedEnglish);
    expect(arabic).not.toMatch(ARABIC_INDIC);
  });

  it('keeps the minus sign attached to negative numbers in RTL text', () => {
    expect(ar.number('-1234.5', 2)).toBe(`${LRM}-1,234.50`);
    expect(ar.money(money('-250000', 'EGP'), 0)).toBe(`${LRM}-250,000${NBSP}ج.م.`);
    expect(en.number('-1234.5', 2)).toBe(`${LRM}-1,234.50`);
  });

  it('emits no other invisible bidi marks', () => {
    for (const text of [
      ar.number('1234.5', 2),
      ar.percent('0.5'),
      ar.money(money('1', 'EGP'), 2),
      ar.instant(instant),
    ]) {
      expect(text).not.toMatch(/[\u200E\u200F\u061C\u2066-\u2069]/);
    }
  });

  it('forces Western digits even for locales whose default is Arabic-Indic', () => {
    expect(formattingLocale('ar')).toBe('ar-u-nu-latn');
    expect(new Intl.NumberFormat('ar-EG').format(1234)).toMatch(ARABIC_INDIC);
    expect(
      new Intl.NumberFormat(formattingLocale('ar').replace('ar', 'ar-EG')).format(1234),
    ).not.toMatch(ARABIC_INDIC);
  });

  it('keeps stored and API values language-neutral', () => {
    expect(DecimalStringSchema.safeParse('١٢٣٤٫٥').success).toBe(false);
    expect(DecimalStringSchema.safeParse('1234.5').success).toBe(true);
    expect(BusinessDateSchema.safeParse('٢٠٢٦-٠٩-١٥').success).toBe(false);
  });
});
