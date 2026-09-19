import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load the untracked repository-root `.env` if it exists. Uses Node's built-in loader, which never
 * overrides variables already set in the real environment. Absence is normal (CI, production).
 */
export function loadDotEnvIfPresent(rootDir: string): boolean {
  const file = resolve(rootDir, '.env');
  if (!existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}
