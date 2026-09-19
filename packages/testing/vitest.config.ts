import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'testing',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: { TZ: 'UTC' },
  },
});
