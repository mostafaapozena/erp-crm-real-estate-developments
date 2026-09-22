import { defineConfig } from 'vitest/config';

/**
 * Unit tier (TEST-001): every workspace plus repository tooling. Needs no services. Integration tests
 * use the `.int-test.ts` suffix and run only via vitest.integration.config.ts.
 */
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*', 'tests', 'scripts'],
  },
});
