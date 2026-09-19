import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'security',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: { TZ: 'UTC' },
  },
});
