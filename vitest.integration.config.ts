import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/**
 * Integration tier (TEST-001): real MongoDB and Redis only (ADR-0018, ADR-0020).
 * Tests skip — visibly, and reported as skipped — when their services are not configured.
 * Never point these at production services.
 *
 * **Files run one at a time.** Every suite shares one MongoDB database, so a suite that asserts an
 * unscoped total — "three units exist and a project-scoped actor sees two" — is asserting against
 * global state that a concurrently running suite is also writing to. Namespacing every record would
 * work for the rows but not for those totals, and a gate that passes or fails depending on scheduling
 * is worse than a gate that takes longer. The alternative, a database per suite, is a bigger change
 * than the problem warrants while the suite count is small.
 */
if (existsSync('.env')) process.loadEnvFile('.env');

const integrationProject = (name: string, root: string) => ({
  test: {
    name,
    root,
    environment: 'node' as const,
    include: ['src/**/*.int-test.ts'],
    env: { TZ: 'UTC' },
    testTimeout: 30_000,
    fileParallelism: false,
  },
});

export default defineConfig({
  test: {
    fileParallelism: false,
    projects: [
      integrationProject('api-integration', './apps/api'),
      integrationProject('worker-integration', './apps/worker'),
    ],
  },
});
