import type { Migration } from './migrations';

/**
 * Every migration this build knows, in order (OPS-004). Append only: never edit, rename, reorder or
 * remove a released entry — the runner refuses a database whose recorded checksum no longer matches.
 * The checksum covers `id`, `revision` and `fingerprint` (see `migration-registry.ts`).
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    id: '0001-foundation-baseline',
    revision: 1,
    fingerprint: 'noop:record-baseline-version',
    description:
      'Baseline of the foundation schema (F0–F10). Collections and indexes are created by ' +
      'ensureIndexes at startup; this records the version a deployment starts from.',
    transactional: true,
    up: () => Promise.resolve(),
  },
];
