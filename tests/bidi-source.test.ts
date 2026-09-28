import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * No raw bidirectional control character in interface source or translations.
 *
 * Direction is handled with markup (`<bdi dir>`, `FormattedValue`) so copied text stays clean and a
 * review can see it. An invisible control character typed into source or a translation reorders text
 * where nobody can see why — and in code it is the "Trojan Source" attack. The one sanctioned mark,
 * the formatter's left-to-right mark before a minus sign, is written as an escape (`\u200E`), which
 * this scan does not match.
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const SCANNED = ['apps/web/src', 'packages/ui/src', 'packages/i18n/src', 'packages/contracts/src'];
const CONTROL = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx|json)$/.test(name) ? [path] : [];
  });
}

describe('bidirectional control characters', () => {
  it('appear nowhere in interface source or translation files', () => {
    const offenders = SCANNED.flatMap((directory) => files(join(root, directory))).filter((path) =>
      CONTROL.test(readFileSync(path, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
