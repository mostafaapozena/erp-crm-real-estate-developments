import {
  DEFAULT_LOCALE,
  DEFAULT_NAMESPACE,
  NAMESPACES,
  SUPPORTED_LOCALES,
  resources,
} from '@alola/i18n';
import i18next, { type i18n } from 'i18next';

/**
 * i18next instance (I18N-001). There is **no fallback language**: a key missing in Arabic must never
 * silently render English and produce a mixed-language screen. Missing keys are reported through
 * `onMissingKey` (console in development, a failing assertion in tests) — and the CI key check
 * prevents them from reaching a build (I18N-002).
 */
export function createI18n(onMissingKey: (key: string) => void): i18n {
  const instance = i18next.createInstance();
  void instance.init({
    resources,
    lng: DEFAULT_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES],
    fallbackLng: false,
    ns: [...NAMESPACES],
    defaultNS: DEFAULT_NAMESPACE,
    initAsync: false,
    returnNull: false,
    returnEmptyString: false,
    interpolation: { escapeValue: false },
    saveMissing: true,
    missingKeyHandler: (_languages, namespace, key) => {
      onMissingKey(`${namespace}:${key}`);
    },
  });
  return instance;
}
