import { createHash } from 'node:crypto';
import { Schema, type ClientSession, type Connection, type Model } from 'mongoose';
import type { Logger } from 'pino';
import { withTransaction } from './transactions';

/**
 * Explicit, versioned schema migrations (OPS-004).
 *
 * Indexes are created at startup (`indexes.ts`); **data** changes — backfills, renames, reshaping —
 * are migrations. A migration is code with a fixed identifier, run once, in order, by an operator
 * command (`npm run db:migrate`), never implicitly by a web process. The database records which ran,
 * when, and a checksum of what ran, so:
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

export class MigrationError extends Error {
  constructor(
    readonly code:
      'MIGRATION_CHANGED' | 'MIGRATION_LOCKED' | 'MIGRATION_ORDER' | 'MIGRATION_UNKNOWN',
    message: string,
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

export interface MigrationStatus {
  /** The last applied migration's identifier, or `none`. */
  databaseVersion: string;
  /** The last migration this build knows. */
  codeVersion: string;
  applied: string[];
  pending: string[];
  /** Applied migrations whose code changed since — a deployment that must not proceed. */
  changed: string[];
  /** Applied in the database but unknown to this build — the database is newer than the code. */
  unknown: string[];
}

const MIGRATION_ID = /^\d{4}-[a-z0-9-]{1,60}$/;
const LOCK_ID = 'migrations';
const LOCK_MS = 15 * 60_000;

/** The checksum of what a migration does, so an edit after release is detected. */
export function migrationChecksum(migration: Migration): string {
  return createHash('sha256')
    .update(`${migration.id}\n${migration.description}\n${migration.up.toString()}`)
    .digest('hex');
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
    const ids = migrations.map((migration) => migration.id);
    for (const [index, id] of ids.entries()) {
      if (!MIGRATION_ID.test(id))
        throw new MigrationError('MIGRATION_ORDER', `Bad migration id: ${id}`);
      if (index > 0 && id <= (ids[index - 1] ?? '')) {
        throw new MigrationError('MIGRATION_ORDER', `Migrations out of order at ${id}`);
      }
    }
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
