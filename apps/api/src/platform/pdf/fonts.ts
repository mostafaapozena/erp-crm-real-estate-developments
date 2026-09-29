import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Locale } from '@alola/contracts';

/**
 * The fonts every generated PDF embeds (CORE-DOC-003, THEME-005): Alexandria for Arabic, and for the
 * Latin text of an Arabic document; Inter for the Latin text of an English document. They come from
 * the same pinned Fontsource packages the web application self-hosts, so a document and a screen use
 * the same letterforms, and are **embedded** (subset by the PDF writer) so a PDF renders the same on a
 * machine with no fonts installed.
 *
 * Fontsource splits a family by script: the Arabic file has no Latin letters and no space, the Latin
 * file no Arabic. The layout engine chooses the file per run (`bidi.ts`).
 */

const require = createRequire(import.meta.url);

export type Weight = 400 | 700;
export type FontKey = `arabic-${Weight}` | `latin-${Weight}`;

const FILES: Record<Locale, Record<FontKey, string>> = {
  ar: {
    'arabic-400': '@fontsource/alexandria/files/alexandria-arabic-400-normal.woff',
    'arabic-700': '@fontsource/alexandria/files/alexandria-arabic-700-normal.woff',
    'latin-400': '@fontsource/alexandria/files/alexandria-latin-400-normal.woff',
    'latin-700': '@fontsource/alexandria/files/alexandria-latin-700-normal.woff',
  },
  en: {
    'arabic-400': '@fontsource/alexandria/files/alexandria-arabic-400-normal.woff',
    'arabic-700': '@fontsource/alexandria/files/alexandria-arabic-700-normal.woff',
    'latin-400': '@fontsource/inter/files/inter-latin-400-normal.woff',
    'latin-700': '@fontsource/inter/files/inter-latin-700-normal.woff',
  },
};

const cache = new Map<string, Buffer>();

/** The font bytes for a locale, read once per process. */
export function fontsFor(locale: Locale): Record<FontKey, Buffer> {
  const files = FILES[locale];
  const out = {} as Record<FontKey, Buffer>;
  for (const [key, specifier] of Object.entries(files) as [FontKey, string][]) {
    let bytes = cache.get(specifier);
    if (!bytes) {
      bytes = readFileSync(require.resolve(specifier));
      cache.set(specifier, bytes);
    }
    out[key] = bytes;
  }
  return out;
}

/** The family names a PDF's font dictionary will carry, for tests that assert embedding. */
export const EMBEDDED_FAMILIES: Record<Locale, readonly string[]> = {
  ar: ['Alexandria'],
  en: ['Alexandria', 'Inter'],
};
