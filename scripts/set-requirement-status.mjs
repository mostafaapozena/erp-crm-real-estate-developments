// Set the status cell of enumerated requirement rows in docs/REQUIREMENTS.md.
//
// Usage: node scripts/set-requirement-status.mjs <status> <ID> [<ID> ...]
// Only rows of the BMP-1 enumerated table (whose last cell is the status) are changed; an ID that
// matches no such row is reported and the file is left untouched, so a typo cannot pass silently.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STATUSES = [
  'proposed',
  'approved',
  'in-progress',
  'implemented',
  'verified',
  'blocked',
  'withdrawn',
];
const [status, ...ids] = process.argv.slice(2);
if (!STATUSES.includes(status ?? '') || ids.length === 0) {
  console.error(`Usage: node scripts/set-requirement-status.mjs <${STATUSES.join('|')}> <ID>...`);
  process.exit(2);
}
const file = resolve(import.meta.dirname, '../docs/REQUIREMENTS.md');
const lines = readFileSync(file, 'utf8').split('\n');
const missing = [];
for (const id of ids) {
  const index = lines.findIndex(
    (line) => line.startsWith(`| ${id} |`) && /\| (BMP-1|BMP-2) \|/.test(line),
  );
  if (index === -1) {
    missing.push(id);
    continue;
  }
  const cells = lines[index].split('|');
  // A row is "| ID | text | owner | decision | status |": the status is the second-to-last cell.
  cells[cells.length - 2] = ` ${status} `;
  lines[index] = cells.join('|');
}
if (missing.length > 0) {
  console.error(`No enumerated row for: ${missing.join(', ')}`);
  process.exit(1);
}
writeFileSync(file, lines.join('\n'), 'utf8');
console.log(`${ids.length} row(s) set to ${status}`);
