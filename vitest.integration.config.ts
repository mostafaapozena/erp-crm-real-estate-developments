import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/**
 * Integration tier (TEST-001): real MongoDB (Atlas development cluster) and Redis only (ADR-0018).
 * Tests skip — visibly, and reported as skipped — when their services are not configured.
 * Never point these at production services.
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
  },
});

export default defineConfig({
  test: {
    projects: [
      integrationProject('api-integration', './apps/api'),
      integrationProject('worker-integration', './apps/worker'),
    ],
  },
});
