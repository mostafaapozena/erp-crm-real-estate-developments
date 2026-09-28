#!/usr/bin/env node
/**
 * Fail when Git ignores a source file.
 *
 * `.gitignore` carries broad safety rules — `documents/`, `uploads/`, `private/` — so that a real
 * customer's papers can never be committed by accident. The same rules once matched a *code* module,
 * `apps/api/src/modules/documents/`, and a whole package was committed without it: the tree on the
 * developer's disk built, the commit did not. This check makes that impossible to repeat silently.
 *
 * Every file Git ignores under the source roots is reported, except build output, dependencies and
 * test artefacts, which are meant to be ignored.
 */
import { execFileSync } from 'node:child_process';

const SOURCE_ROOTS = ['apps/', 'packages/', 'scripts/', 'docs/', 'docker/', 'e2e/'];
const EXPECTED = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)test-results\//,
  /(^|\/)playwright-report\//,
  /(^|\/)blob-report\//,
  /(^|\/)coverage\//,
  /\.tsbuildinfo$/,
  /(^|\/)\.vite\//,
  /(^|\/)\.env(\..+)?$/,
  /^docker\/dev\.env$/,
];

const output = execFileSync(
  'git',
  ['ls-files', '--others', '--ignored', '--exclude-standard', '--', ...SOURCE_ROOTS],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
const offenders = output
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((path) => !EXPECTED.some((pattern) => pattern.test(path)));

if (offenders.length > 0) {
  console.error('Git ignores these source files, so a commit would silently leave them out:');
  for (const path of offenders) console.error(`  ${path}`);
  console.error('Narrow the matching .gitignore rule, or re-include the path with a "!" rule.');
  process.exit(1);
}
console.log('Ignored-source check passed: no source file is hidden from Git.');
