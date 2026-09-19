import { DEFAULT_LOCALE, localeSettings, type Locale } from '@alola/i18n';
import { ThemeRoot } from '@alola/ui';
import type { TFunction, i18n } from 'i18next';
import { createContext, use, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TFunction;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * One piece of state — the locale — drives text, direction, theme, and fonts (I18N-003). Translations
 * come from a translator fixed to that locale, and the theme is derived from it, so a render can never
 * show Arabic text with LTR layout or the reverse. `lang` and `dir` are written to the document root
 * in a layout effect, i.e. before the browser paints the new frame.
 */
export function LocaleProvider({ i18n, children }: { i18n: i18n; children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const t = useMemo(() => i18n.getFixedT(locale), [i18n, locale]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = localeSettings(locale).direction;
    document.title = t('app.title');
    void i18n.changeLanguage(locale);
  }, [i18n, locale, t]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);
  return (
    <LocaleContext value={value}>
      <ThemeRoot locale={locale}>{children}</ThemeRoot>
    </LocaleContext>
  );
}

export function useLocale(): LocaleContextValue {
  const value = use(LocaleContext);
  if (!value) throw new Error('useLocale must be used inside LocaleProvider');
  return value;
}
