import { createHash } from 'node:crypto';
import type { Migration } from './migrations';

/**
 * Migration identity and checksums (OPS-004), kept free of database imports so a bundled copy can be
 * compared with the source in a test.
 *
 * **A checksum covers declared fields only**: the identifier, the revision and the fingerprint. It
 * never covers `up.toString()`: the text of a function depends on whoever compiled it — `tsx`
 * printed `()=>Promise.resolve()` where the production bundle printed `() => Promise.resolve()` — so
 * a checksum of it made the built API report a migration applied by `npm run db:migrate` as edited.
 * The description is prose for people and is not covered either; correcting a typo in it is not a
 * schema change.
 *
 * The price is discipline: whoever changes what an unreleased migration does raises its `revision`
 * (or rewrites its `fingerprint`). Once a migration has run anywhere that matters, it is immutable —
 * a correction is a new migration.
 */
export const MIGRATION_CHECKSUM_SCHEME = 'alola-migration-checksum/v2';

export class MigrationError extends Error {
  constructor(
    readonly code:
      | 'MIGRATION_CHANGED'
      | 'MIGRATION_INVALID'
      | 'MIGRATION_LOCKED'
      | 'MIGRATION_ORDER'
      | 'MIGRATION_TRANSITION_REFUSED'
      | 'MIGRATION_UNKNOWN',
    message: string,
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

const MIGRATION_ID = /^\d{4}-[a-z0-9-]{1,60}$/;
/** Printable ASCII, no leading or trailing space: identical bytes under every encoding and locale. */
const FINGERPRINT = /^[\x21-\x7e](?:[\x20-\x7e]{0,198}[\x21-\x7e])?$/;

/** The checksum of a migration's declared identity. Deterministic across tools, builds and hosts. */
export function migrationChecksum(
  migration: Pick<Migration, 'id' | 'revision' | 'fingerprint'>,
): string {
  const canonical = JSON.stringify([
    MIGRATION_CHECKSUM_SCHEME,
    migration.id,
    migration.revision,
    migration.fingerprint,
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Refuses a list that could not produce a trustworthy checksum or order: a missing or malformed
 * field, a duplicate identifier, or identifiers out of order.
 */
export function validateMigrations(migrations: readonly Migration[]): void {
  const seen = new Set<string>();
  let previous = '';
  for (const candidate of migrations as readonly unknown[]) {
    const migration = (candidate ?? {}) as Partial<Record<keyof Migration, unknown>>;
    const id = migration.id;
    if (typeof id !== 'string' || !MIGRATION_ID.test(id)) {
      throw new MigrationError('MIGRATION_ORDER', `Bad migration id: ${String(id)}`);
    }
    if (seen.has(id))
      throw new MigrationError('MIGRATION_INVALID', `Duplicate migration id: ${id}`);
    if (id <= previous)
      throw new MigrationError('MIGRATION_ORDER', `Migrations out of order at ${id}`);
    const { revision, fingerprint } = migration;
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) {
      throw new MigrationError(
        'MIGRATION_INVALID',
        `Migration ${id} needs a positive integer revision`,
      );
    }
    if (typeof fingerprint !== 'string' || !FINGERPRINT.test(fingerprint)) {
      throw new MigrationError(
        'MIGRATION_INVALID',
        `Migration ${id} needs a fingerprint of printable ASCII (1–200 characters)`,
      );
    }
    if (typeof migration.description !== 'string' || migration.description.trim() === '') {
      throw new MigrationError('MIGRATION_INVALID', `Migration ${id} needs a description`);
    }
    if (typeof migration.up !== 'function') {
      throw new MigrationError('MIGRATION_INVALID', `Migration ${id} needs an up function`);
    }
    if (typeof migration.transactional !== 'boolean') {
      throw new MigrationError('MIGRATION_INVALID', `Migration ${id} must declare transactional`);
    }
    seen.add(id);
    previous = id;
  }
}
