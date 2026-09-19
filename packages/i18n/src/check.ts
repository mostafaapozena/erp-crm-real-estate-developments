import { SUPPORTED_LOCALES, type Locale } from '@alola/contracts';
import { NAMESPACES, type ResourceTree } from './resources';

/**
 * Missing-key check (I18N-002). Compares every namespace across both locales and reports:
 *
 * - a key present in one locale and missing in the other
 * - an empty value
 * - a pluralized key missing any plural category the locale requires — Arabic needs six (`zero`,
 *   `one`, `two`, `few`, `many`, `other`), English two. The categories come from `Intl.PluralRules`,
 *   not from a hand-written list.
 */
export interface ResourceProblem {
  locale: Locale;
  namespace: string;
  key: string;
  problem: 'missing' | 'empty' | 'missing-plural-form';
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flatten(tree: ResourceTree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

export function requiredPluralCategories(locale: Locale): string[] {
  return new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
}

export function checkResources(
  all: Record<Locale, Record<string, ResourceTree>>,
): ResourceProblem[] {
  const problems: ResourceProblem[] = [];
  const namespaces = new Set<string>(NAMESPACES);
  for (const locale of SUPPORTED_LOCALES)
    for (const ns of Object.keys(all[locale])) namespaces.add(ns);

  for (const namespace of namespaces) {
    const flat = Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [locale, flatten(all[locale][namespace] ?? {})]),
    ) as Record<Locale, Map<string, string>>;

    // Compare base keys (plural suffix removed): plural forms legitimately differ between locales.
    const baseKeys = (locale: Locale) =>
      new Set([...flat[locale].keys()].map((key) => key.replace(PLURAL_SUFFIX, '')));
    const union = new Set(SUPPORTED_LOCALES.flatMap((locale) => [...baseKeys(locale)]));

    for (const locale of SUPPORTED_LOCALES) {
      const own = baseKeys(locale);
      for (const key of union) {
        if (!own.has(key)) problems.push({ locale, namespace, key, problem: 'missing' });
      }
      for (const [key, value] of flat[locale]) {
        if (value.trim() === '') problems.push({ locale, namespace, key, problem: 'empty' });
      }
      const pluralBases = new Set(
        [...flat[locale].keys()]
          .filter((key) => PLURAL_SUFFIX.test(key))
          .map((key) => key.replace(PLURAL_SUFFIX, '')),
      );
      for (const base of pluralBases) {
        for (const category of requiredPluralCategories(locale)) {
          if (!flat[locale].has(`${base}_${category}`)) {
            problems.push({
              locale,
              namespace,
              key: `${base}_${category}`,
              problem: 'missing-plural-form',
            });
          }
        }
      }
    }
  }
  return problems;
}
