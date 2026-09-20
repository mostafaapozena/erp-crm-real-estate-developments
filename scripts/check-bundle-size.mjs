/**
 * Web bundle-size budget (approved at the Phase 1 scaffolding review; see
 * docs/architecture/dependencies.md#bundle-size-budget).
 *
 * Fails when any JavaScript chunk in apps/web/dist exceeds the budget. Run after `npm run build`.
 * Raising a budget needs an approved decision recorded in docs/MEMORY.md — not an edit to this file alone.
 *
 * Usage: npm run check:bundle
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET = {
  /** Largest single JS chunk, minified. The Phase 1 entry chunk measured 582 kB. */
  chunkMinifiedKb: 650,
  /** Largest single JS chunk, gzip. The Phase 1 entry chunk measured ~187 kB. */
  chunkGzipKb: 210,
};

const assets = join(process.cwd(), 'apps', 'web', 'dist', 'assets');
let files;
try {
  files = readdirSync(assets).filter((name) => name.endsWith('.js'));
} catch {
  console.error('No web build found at apps/web/dist/assets. Run `npm run build` first.');
  process.exit(1);
}

let failed = false;
for (const name of files) {
  const path = join(assets, name);
  const minifiedKb = statSync(path).size / 1000;
  const gzipKb = gzipSync(readFileSync(path)).length / 1000;
  const over = minifiedKb > BUDGET.chunkMinifiedKb || gzipKb > BUDGET.chunkGzipKb;
  failed ||= over;
  console.log(
    `${over ? 'OVER BUDGET' : 'ok'}  ${name}  ${minifiedKb.toFixed(1)} kB (budget ${BUDGET.chunkMinifiedKb})` +
      `  gzip ${gzipKb.toFixed(1)} kB (budget ${BUDGET.chunkGzipKb})`,
  );
}

if (failed) {
  console.error(
    'Bundle budget exceeded. Introduce route-level code splitting (React.lazy per route) rather than ' +
      'raising the budget.',
  );
  process.exit(1);
}
console.log('Bundle budget check passed.');
