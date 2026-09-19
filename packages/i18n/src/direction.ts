import type { Locale } from '@alola/contracts';

export type Direction = 'rtl' | 'ltr';

/**
 * Direction is **derived** from the locale, never stored separately, so the two cannot disagree
 * (I18N-003). Callers apply `lang` and `dir` from one `LocaleSettings` value in the same commit.
 */
export function directionOf(locale: Locale): Direction {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

export interface LocaleSettings {
  locale: Locale;
  direction: Direction;
  /** Font stack for the locale; real fallbacks so a font load failure degrades gracefully (I18N-007). */
  fontFamily: string;
  /** Arabic script needs more vertical space than Latin at the same nominal size. */
  lineHeight: number;
}

const FONT_STACKS: Record<Locale, string> = {
  ar: "'Alexandria', 'Noto Sans Arabic', 'Segoe UI', Tahoma, sans-serif",
  en: "'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
};

export function localeSettings(locale: Locale): LocaleSettings {
  return {
    locale,
    direction: directionOf(locale),
    fontFamily: FONT_STACKS[locale],
    lineHeight: locale === 'ar' ? 1.7 : 1.5,
  };
}
