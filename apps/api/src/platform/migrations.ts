import { Schema, type ClientSession, type Connection, type Model } from 'mongoose';
import type { Logger } from 'pino';
import { MigrationError, migrationChecksum, validateMigrations } from './migration-registry';
import { withTransaction } from './transactions';

export { MigrationError, migrationChecksum } from './migration-registry';

/**
 * Explicit, versioned schema migrations (OPS-004).
 *
 * Indexes are created at startup (`indexes.ts`); **data** changes — backfills, renames, reshaping —
 * are migrations. A migration is code with a fixed identifier, run once, in order, by an operator
 * command (`npm run db:migrate`), never implicitly by a web process. The database records which ran,
 * when, and a checksum of its declared identity (`migration-registry.ts`), so:
 *
 * - the **database version** is the last applied migration, readable by readiness checks;
 * - a migration that was edited after it ran is detected and refused (`MIGRATION_CHANGED`) instead of
 *   silently diverging between deployments;
 * - two operators cannot run migrations at once: a lock document with an expiry serializes them;
 * - a migration that fails leaves the ones before it recorded and stops; nothing after it runs.
 *
 * Migrations are forward-only. Undoing one is a new migration, reviewed like any other change — the
 * same rule the product applies to its own records.
 */
export const SCHEMA_MIGRATIONS_COLLECTION = 'schemaMigrations';
export const MIGRATION_LOCK_COLLECTION = 'schemaMigrationLock';

export interface Migration {
  /** `NNNN-kebab-name`; the numeric prefix is the order. Never renamed once released. */
  id: string;
  /**
   * Positive integer, starting at 1. Raise it whenever what `up` does changes before release; it is
   * part of the checksum. After release the migration is immutable and a correction is a new one.
   */
  revision: number;
  /**
   * A declared statement of the change in printable ASCII, such as `noop:record-baseline` or
   * `backfill:units.usageType`. Part of the checksum; the function's text never is.
   */
  fingerprint: string;
  /** Prose for people; stored, but not part of the checksum. */
  description: string;
  /**
   * The change. It may be retried after a crash, so it must be idempotent: re-running a migration that
   * half-completed must converge on the same result. A session is given when the change fits in one
   * transaction; long backfills work in batches without one.
   */
  up(context: { connection: Connection; session?: ClientSession; logger?: Logger }): Promise<void>;
  /** True when the change can run inside a single transaction. */
  transactional: boolean;
}

interface AppliedDocument {
  migrationId: string;
  checksum: string;
  description: string;
  appliedAt: Date;
  durationMs: number;
}

interface LockDocument {
  _id: string;
  holder: string;
  expiresAt: Date;
}

export interface MigrationStatus {
  /** The last applied migration's identifier, or `none`. */
  databaseVersion: string;
  /** The last migration this build knows. */
  codeVersion: string;
  applied: string[];
  pending: string[];
  /** Applied migrations whose declared revision or fingerprint changed since — do not proceed. */
  changed: string[];
  /** Applied in the database but unknown to this build — the database is newer than the code. */
  unknown: string[];
}

const LOCK_ID = 'migrations';
const LOCK_MS = 15 * 60_000;

/**
 * The readiness answer for a schema (OPS-006): an edited or unknown migration is a mismatch, a pending
 * one keeps the instance out of service until an operator migrates, and only a matching schema is
 * current. A status that cannot be read is the caller's failure to report — readiness treats a
 * rejected probe as `unknown`, which is not ready.
 */
export function schemaHealth(status: MigrationStatus): {
  status: 'current' | 'pending' | 'mismatch';
} {
  if (status.changed.length > 0 || status.unknown.length > 0) return { status: 'mismatch' };
  return { status: status.pending.length > 0 ? 'pending' : 'current' };
}

function appliedModel(connection: Connection): Model<AppliedDocument> {
  const existing = connection.models[SCHEMA_MIGRATIONS_COLLECTION] as
    Model<AppliedDocument> | undefined;
  if (existing) return existing;
  const schema = new Schema<AppliedDocument>(
    {
      migrationId: { type: String, required: true, immutable: true },
      checksum: { type: String, required: true, immutable: true },
      description: { type: String, required: true, immutable: true },
      appliedAt: { type: Date, required: true, immutable: true },
      durationMs: { type: Number, required: true, immutable: true },
    },
    { collection: SCHEMA_MIGRATIONS_COLLECTION, strict: 'throw', versionKey: false },
  );
  schema.index({ migrationId: 1 }, { unique: true, name: 'schemaMigrations_id_unique' });
  return connection.model<AppliedDocument>(SCHEMA_MIGRATIONS_COLLECTION, schema);
}

function lockModel(connection: Connection): Model<LockDocument> {
  const existing = connection.models[MIGRATION_LOCK_COLLECTION] as Model<LockDocument> | undefined;
  if (existing) return existing;
  const schema = new Schema<LockDocument>(
    {
      _id: { type: String, required: true },
      holder: { type: String, required: true },
      expiresAt: { type: Date, required: true },
    },
    { collection: MIGRATION_LOCK_COLLECTION, strict: 'throw', versionKey: false },
  );
  // Also what makes ensureIndexes create the collection: a schema with no index creates nothing.
  schema.index({ expiresAt: 1 }, { name: 'schemaMigrationLock_expires' });
  return connection.model<LockDocument>(MIGRATION_LOCK_COLLECTION, schema);
}

export function migrationModels(connection: Connection) {
  return [appliedModel(connection), lockModel(connection)];
}

export class MigrationRunner {
  private readonly applied;
  private readonly lock;

  constructor(
    private readonly connection: Connection,
    private readonly migrations: readonly Migration[],
    private readonly options: { logger?: Logger; now?: () => Date } = {},
  ) {
    validateMigrations(migrations);
    this.applied = appliedModel(connection);
    this.lock = lockModel(connection);
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  async status(): Promise<MigrationStatus> {
    const rows = await this.applied
      .find()
      .sort({ migrationId: 1 })
      .lean<AppliedDocument[]>()
      .exec();
    const known = new Map(this.migrations.map((migration) => [migration.id, migration]));
    const appliedIds = new Set(rows.map((row) => row.migrationId));
    return {
      databaseVersion: rows.at(-1)?.migrationId ?? 'none',
      codeVersion: this.migrations.at(-1)?.id ?? 'none',
      applied: rows.map((row) => row.migrationId),
      pending: this.migrations.filter((m) => !appliedIds.has(m.id)).map((m) => m.id),
      changed: rows
        .filter((row) => {
          const migration = known.get(row.migrationId);
          return migration !== undefined && migrationChecksum(migration) !== row.checksum;
        })
        .map((row) => row.migrationId),
      unknown: rows.filter((row) => !known.has(row.migrationId)).map((row) => row.migrationId),
    };
  }

  /**
   * Apply every pending migration, in order. Refuses — before changing anything — when an applied
   * migration's code changed, when the database knows migrations this build does not, or when another
   * run holds the lock.
   */
  async migrate(holder: string): Promise<{ applied: string[] }> {
    const before = await this.status();
    if (before.changed.length > 0) {
      throw new MigrationError(
        'MIGRATION_CHANGED',
        `Applied migrations were edited after release: ${before.changed.join(', ')}`,
      );
    }
    if (before.unknown.length > 0) {
      throw new MigrationError(
        'MIGRATION_UNKNOWN',
        `The database has migrations this build does not know: ${before.unknown.join(', ')}`,
      );
    }
    if (before.pending.length === 0) return { applied: [] };

    await this.acquire(holder);
    const done: string[] = [];
    try {
      for (const id of before.pending) {
        const migration = this.migrations.find((candidate) => candidate.id === id);
        if (!migration) continue;
        const started = Date.now();
        const record = async (session?: ClientSession) => {
          await this.applied.create(
            [
              {
                migrationId: migration.id,
                checksum: migrationChecksum(migration),
                description: migration.description,
                appliedAt: this.now(),
                durationMs: Date.now() - started,
              },
            ],
            session ? { session } : {},
          );
        };
        if (migration.transactional) {
          await withTransaction(this.connection, async (session) => {
            await migration.up({
              connection: this.connection,
              session,
              ...(this.options.logger ? { logger: this.options.logger } : {}),
            });
            await record(session);
          });
        } else {
          await migration.up({
            connection: this.connection,
            ...(this.options.logger ? { logger: this.options.logger } : {}),
          });
          await record();
        }
        this.options.logger?.info({ migrationId: migration.id }, 'migration applied');
        done.push(migration.id);
      }
    } finally {
      await this.lock.deleteOne({ _id: LOCK_ID, holder }).exec();
    }
    return { applied: done };
  }

  private async acquire(holder: string): Promise<void> {
    const now = this.now();
    // Take a free or expired lock; a live one held by someone else refuses.
    await this.lock.deleteOne({ _id: LOCK_ID, expiresAt: { $lte: now } }).exec();
    try {
      await this.lock.create({
        _id: LOCK_ID,
        holder,
        expiresAt: new Date(now.getTime() + LOCK_MS),
      });
    } catch (error) {
      if ((error as { code?: unknown }).code === 11000) {
        throw new MigrationError('MIGRATION_LOCKED', 'Another migration run holds the lock.');
      }
      throw error;
    }
  }
}

const HEX_SHA256 = /^[0-9a-f]{64}$/;

export interface ChecksumTransition {
  /** Refused unless `development`: no other environment ever stored a function-text checksum. */
  appEnv: string;
  migrationId: string;
  /** The exact checksum the row carries now. */
  fromChecksum: string;
  /** The exact checksum this build computes for the migration; anything else is refused. */
  toChecksum: string;
}

/**
 * One-time move of a development database's `schemaMigrations` row from a function-text checksum
 * (before the checksum became build-stable) to the declared-identity checksum of this build.
 *
 * Narrow on purpose: development only; one named migration this build knows; the exact old and new
 * checksums supplied by the operator; the new one must be what this build computes; exactly one row,
 * changed by compare-and-set on its current checksum. It never runs the migration, never touches
 * `appliedAt` or any other field, and never deletes or recreates the row. Already on the new checksum
 * is success with no change; any other checksum is refused.
 *
 * It writes through the driver, not the model: the model declares `checksum` immutable, which is
 * right for every other caller.
 */
export async function transitionMigrationChecksum(
  connection: Connection,
  migrations: readonly Migration[],
  request: ChecksumTransition,
): Promise<{ migrationId: string; outcome: 'updated' | 'unchanged' }> {
  const refuse = (message: string): never => {
    throw new MigrationError('MIGRATION_TRANSITION_REFUSED', message);
  };
  if (request.appEnv !== 'development') {
    refuse(`Checksum transition is for development databases only (APP_ENV=${request.appEnv}).`);
  }
  validateMigrations(migrations);
  const migration = migrations.find((candidate) => candidate.id === request.migrationId);
  if (!migration) return refuse(`This build has no migration ${request.migrationId}.`);
  if (!HEX_SHA256.test(request.fromChecksum) || !HEX_SHA256.test(request.toChecksum)) {
    refuse('Checksums must be 64 lower-case hexadecimal characters.');
  }
  if (request.toChecksum !== migrationChecksum(migration)) {
    refuse(`The new checksum is not the one this build computes for ${migration.id}.`);
  }
  if (request.fromChecksum === request.toChecksum) refuse('The old and new checksums are equal.');

  const applied = connection.collection<AppliedDocument>(SCHEMA_MIGRATIONS_COLLECTION);
  const rows = await applied.find({ migrationId: migration.id }).limit(2).toArray();
  if (rows.length === 0) refuse(`No applied row for ${migration.id}.`);
  if (rows.length > 1) refuse(`More than one applied row for ${migration.id}.`);
  const row = rows[0] as (typeof rows)[number];
  if (row.checksum === request.toChecksum)
    return { migrationId: migration.id, outcome: 'unchanged' };
  if (row.checksum !== request.fromChecksum) {
    refuse(`The applied row for ${migration.id} carries neither the old nor the new checksum.`);
  }
  const result = await applied.updateOne(
    { _id: row._id, migrationId: migration.id, checksum: request.fromChecksum },
    { $set: { checksum: request.toChecksum } },
  );
  if (result.matchedCount !== 1 || result.modifiedCount !== 1) {
    refuse(
      `The applied row for ${migration.id} changed during the transition; nothing was written.`,
    );
  }
  return { migrationId: migration.id, outcome: 'updated' };
}
