import { localeSettings, type Locale } from '@alola/i18n';
import { ThemeRoot } from '@alola/ui';
import type { TFunction, i18n } from 'i18next';
import {
  createContext,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { applyFavicon, brandName, useBranding } from './branding';

/**
 * A key assembled at runtime rather than written in the source.
 *
 * `t` is typed against the Arabic resource tree, which is what stops a typo in a literal key reaching
 * a build. That check cannot apply to a key built from a value — `leadStage.${lead.stage}` — because
 * the string does not exist until the row is rendered.
 *
 * `td` is the narrow escape hatch for exactly that case. It is a separate function rather than a cast
 * at each call site so the unchecked places are greppable, and so nobody reaches for the cast when a
 * literal key would have worked. The safety net is the i18n key check, which fails the build on any
 * key missing from either language — and the enumerations it is used with come from the contracts, so
 * a new enum value without a translation is caught there.
 */
export type TranslateDynamic = (key: string, options?: Record<string, unknown>) => string;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** The languages this deployment offers (ADR-0027). The switch is hidden when there is one. */
  supportedLocales: readonly Locale[];
  /** The next supported language after the current one, or `undefined` when there is only one. */
  otherLocale: Locale | undefined;
  t: TFunction;
  td: TranslateDynamic;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * One piece of state — the locale — drives text, direction, theme, and fonts (I18N-003). Translations
 * come from a translator fixed to that locale, and the theme is derived from it, so a render can never
 * show Arabic text with LTR layout or the reverse. `lang` and `dir` are written to the document root
 * in a layout effect, i.e. before the browser paints the new frame.
 *
 * The deployment's branding (PLAT-023) supplies the starting language, the languages offered, the
 * brand colour and the name in the browser tab. The colour is validated again by `ThemeRoot`, and
 * the name falls back to the neutral product title, so nothing here depends on branding being set.
 */
export function LocaleProvider({ i18n, children }: { i18n: i18n; children: ReactNode }) {
  const branding = useBranding();
  const supportedLocales = branding.supportedLocales;
  const [locale, setLocaleState] = useState<Locale>(branding.defaultLocale);
  // A language the deployment does not offer is never selected, whatever asks for it.
  const setLocale = useCallback(
    (next: Locale) => {
      if (supportedLocales.includes(next)) setLocaleState(next);
    },
    [supportedLocales],
  );
  const otherLocale = supportedLocales.find((candidate) => candidate !== locale);
  const t = useMemo(() => i18n.getFixedT(locale), [i18n, locale]);
  const td = useMemo<TranslateDynamic>(() => {
    const fixed = i18n.getFixedT(locale);
    return (key, options) => (fixed as unknown as TranslateDynamic)(key, options);
  }, [i18n, locale]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = localeSettings(locale).direction;
    document.title = brandName(branding, locale) ?? t('app.title');
    applyFavicon(branding);
    void i18n.changeLanguage(locale);
  }, [branding, i18n, locale, t]);

  const value = useMemo(
    () => ({ locale, setLocale, supportedLocales, otherLocale, t, td }),
    [locale, otherLocale, setLocale, supportedLocales, t, td],
  );
  return (
    <LocaleContext value={value}>
      <ThemeRoot locale={locale} brandPrimary={branding.primaryColor}>
        {children}
      </ThemeRoot>
    </LocaleContext>
  );
}

export function useLocale(): LocaleContextValue {
  const value = use(LocaleContext);
  if (!value) throw new Error('useLocale must be used inside LocaleProvider');
  return value;
}
