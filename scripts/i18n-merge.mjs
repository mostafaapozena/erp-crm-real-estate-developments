// Merge translation keys into both locales at once, so Arabic and English change together (I18N-002).
//
// Usage: node scripts/i18n-merge.mjs <keys.json>
// The file holds { "<namespace>": { "ar": { ... }, "en": { ... } } }. Objects are merged deeply;
// an existing string is replaced only when the new value differs, and the change is reported.
// A key present for one language and not the other is refused before anything is written.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/i18n-merge.mjs <keys.json>');
  process.exit(2);
}
const additions = JSON.parse(readFileSync(resolve(input), 'utf8'));
const root = resolve(import.meta.dirname, '../packages/i18n/src/locales');

function paths(tree, prefix = '') {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? paths(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

function merge(target, source, trail, changes) {
  for (const [key, value] of Object.entries(source)) {
    const path = `${trail}${key}`;
    if (typeof value === 'object' && value !== null) {
      if (typeof target[key] !== 'object' || target[key] === null) target[key] = {};
      merge(target[key], value, `${path}.`, changes);
    } else if (target[key] !== value) {
      changes.push(target[key] === undefined ? `+ ${path}` : `~ ${path}`);
      target[key] = value;
    }
  }
}

for (const [namespace, byLocale] of Object.entries(additions)) {
  const ar = paths(byLocale.ar ?? {}).sort();
  const en = paths(byLocale.en ?? {}).sort();
  if (JSON.stringify(ar) !== JSON.stringify(en)) {
    const missing = [
      ...ar.filter((p) => !en.includes(p)).map((p) => `en missing ${p}`),
      ...en.filter((p) => !ar.includes(p)).map((p) => `ar missing ${p}`),
    ];
    console.error(`${namespace}: Arabic and English keys differ:\n${missing.join('\n')}`);
    process.exit(1);
  }
}

for (const [namespace, byLocale] of Object.entries(additions)) {
  for (const locale of ['ar', 'en']) {
    const file = resolve(root, locale, `${namespace}.json`);
    const tree = JSON.parse(readFileSync(file, 'utf8'));
    const changes = [];
    merge(tree, byLocale[locale], '', changes);
    writeFileSync(file, `${JSON.stringify(tree, null, 2)}\n`, 'utf8');
    console.log(`${locale}/${namespace}.json: ${changes.length} change(s)`);
    for (const change of changes) console.log(`  ${change}`);
  }
}
