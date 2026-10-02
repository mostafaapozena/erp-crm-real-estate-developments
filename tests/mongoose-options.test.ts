import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * No deprecated Mongoose return option in server code.
 *
 * Mongoose 9 deprecates `new` and `returnOriginal` on `findOneAndUpdate`/`findOneAndReplace` in
 * favour of `returnDocument`, and converts them itself — `new: true` becomes exactly
 * `returnDocument: 'after'` — adding only a warning (`lib/query.js`, `convertNewToReturnDocument`).
 * Package 8 replaced all 31 uses; this keeps a new one from reintroducing the warning. The warning
 * is not silenced anywhere: the calls are written the current way instead.
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const SCANNED = ['apps/api/src', 'apps/worker/src', 'scripts'];
const DEPRECATED = /\b(?:new|returnOriginal)\s*:\s*(?:true|false)\b/;

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : files(path);
    return /\.ts$/.test(name) ? [path] : [];
  });
}

describe('Mongoose query options', () => {
  it('use returnDocument, never the deprecated new or returnOriginal', () => {
    const offenders = SCANNED.flatMap((directory) => files(join(root, directory))).filter((path) =>
      DEPRECATED.test(readFileSync(path, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
