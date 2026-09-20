/**
 * Phase-gate run of the integration tier (TEST-001, ADR-0018).
 *
 * Same tests as `npm run test:integration`, but a missing MongoDB or Redis configuration FAILS the run
 * instead of skipping, so no phase can be approved on skipped integration tests.
 *
 * Usage: npm run test:integration:gate
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('./bin.mjs', import.meta.url));
const result = spawnSync(
  process.execPath,
  [bin, 'vitest', 'run', '--config', 'vitest.integration.config.ts'],
  { stdio: 'inherit', env: { ...process.env, ALOLA_REQUIRE_INTEGRATION_SERVICES: '1' } },
);
process.exit(result.status ?? 1);
