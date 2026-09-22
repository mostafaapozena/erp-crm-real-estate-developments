import { defineProject } from 'vitest/config';

/**
 * Repository scripts that carry their own tests — currently the demonstration seed's refusal guard,
 * which is the control that stops a seed reaching anything real and therefore has to be tested.
 */
export default defineProject({
  test: {
    name: 'scripts',
    environment: 'node',
    include: ['**/*.test.ts'],
    env: { TZ: 'UTC' },
  },
});
