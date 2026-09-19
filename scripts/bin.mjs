/**
 * Runs a dev tool through Node directly instead of through `node_modules/.bin` shims.
 *
 * Why: on Windows, npm's generated `.cmd` shims expand their own directory unquoted, so they break
 * when the repository path contains `&` (this repository lives under "CRM & ERP REALESTATE"). Calling
 * the tool's JavaScript entry point with the current Node executable works on every platform and path.
 *
 * Usage (from any workspace): node <path-to>/scripts/bin.mjs <tool> [args...]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const TOOLS = {
  eslint: ['eslint', 'eslint'],
  playwright: ['@playwright/test', 'playwright'],
  prettier: ['prettier', 'prettier'],
  tsc: ['typescript', 'tsc'],
  tsx: ['tsx', 'tsx'],
  vite: ['vite', 'vite'],
  vitest: ['vitest', 'vitest'],
};

const [tool, ...args] = process.argv.slice(2);
const entry = tool ? TOOLS[tool] : undefined;
if (!entry) {
  console.error(`Unknown tool "${tool ?? ''}". Known: ${Object.keys(TOOLS).join(', ')}`);
  process.exit(2);
}
const [packageName, binName] = entry;

/** Walk up from the working directory to find the installed package (handles workspace hoisting). */
function findPackageDir(name) {
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const packageDir = findPackageDir(packageName);
if (!packageDir) {
  console.error(`Package "${packageName}" is not installed. Run npm install.`);
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
const binPath = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName];
if (!binPath) {
  console.error(`Package "${packageName}" has no "${binName}" executable.`);
  process.exit(2);
}

const result = spawnSync(process.execPath, [resolve(packageDir, binPath), ...args], {
  stdio: 'inherit',
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
