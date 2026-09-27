/**
 * I18N-002 missing-key check, runnable on its own in the quality pipeline:
 *   npm run check:i18n
 * Exits non-zero on any missing, empty, or incomplete plural key, and on any displayed domain
 * enumeration value without a label in both languages.
 */
import { checkEnumLabels, checkResources, resources } from '@alola/i18n';

const problems = checkResources(resources);
const enumProblems = checkEnumLabels(resources);

if (problems.length > 0 || enumProblems.length > 0) {
  console.error(`i18n check failed: ${problems.length + enumProblems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p.locale}/${p.namespace}: ${p.key} — ${p.problem}`);
  for (const p of enumProblems) console.error(`  ${p.locale}/common: ${p.key} — ${p.problem}`);
  process.exit(1);
}

console.log(
  'i18n check passed: Arabic and English resources are complete, and every displayed enumeration is labelled.',
);
