import type { Locale } from '@alola/contracts';
import { resources, type ResourceTree } from '@alola/i18n';

/**
 * Wording for generated documents, read from the same bilingual resources as the screens
 * (`common.pdf.*` and the enumeration labels), so a status reads identically on a page and on paper.
 * A missing key renders as the key itself and fails the i18n check first — it never falls back to the
 * other language.
 */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

export function translator(locale: Locale): Translate {
  const common = resources[locale].common as unknown as ResourceTree;
  return (key, params = {}) => {
    let node: string | ResourceTree | undefined = common;
    for (const part of key.split('.')) {
      node = typeof node === 'object' ? node[part] : undefined;
    }
    const text = typeof node === 'string' ? node : key;
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) =>
      String(params[name] ?? `{{${name}}}`),
    );
  };
}
