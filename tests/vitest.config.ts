import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'tooling',
    environment: 'node',
    include: ['**/*.test.ts'],
    env: { TZ: 'UTC' },
    testTimeout: 30_000,
  },
});
