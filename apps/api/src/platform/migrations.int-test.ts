import { createLogger } from '@alola/security';
import { serviceGate } from '@alola/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readiness } from '../health';
import { ensureIndexes } from './indexes';
import { MIGRATIONS } from './migration-list';
import {
  MIGRATION_LOCK_COLLECTION,
  MigrationRunner,
  SCHEMA_MIGRATIONS_COLLECTION,
  migrationChecksum,
  schemaHealth,
  transitionMigrationChecksum,
  type ChecksumTransition,
  type Migration,
} from './migrations';
import { configureMongoose } from './mongo';

/**
 * The migration runner against a real MongoDB replica set (OPS-004).
 *
 * Each case uses its own sandbox collection and removes the migration records it made, so the
 * integration database's own migration history is left as it was found.
 */
const gate = serviceGate(['mongodb']);
const SANDBOX = `migrationSandbox${String(Date.now())}`;

describe.skipIf(!gate.available)(`schema migrations — ${gate.reason}`, () => {
  let connection: Connection;
  let saved: Record<string, unknown>[] = [];
  const logger = createLogger({ name: 'it-migrations', level: 'silent' });
  const sandbox = () => connection.collection(SANDBOX);
  const applied = () => connection.collection(SCHEMA_MIGRATIONS_COLLECTION);

  const insert = (id: string, marker: string): Migration => ({
    id,
    revision: 1,
    fingerprint: `insert:${marker}`,
    description: `insert ${marker}`,
    transactional: true,
    up: async ({ connection: db, session }) => {
      await db.collection(SANDBOX).insertOne({ marker }, session ? { session } : {});
    },
  });

  beforeAll(async () => {
    configureMongoose();
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'] as string,
    });
    await connection.asPromise();
    await ensureIndexes(connection, logger);
    // Keep whatever history the integration database already has, and restore it afterwards.
    saved = await applied().find({}).toArray();
  });

  beforeEach(async () => {
    await applied().deleteMany({});
    await connection.collection(MIGRATION_LOCK_COLLECTION).deleteMany({});
    await connection.createCollection(SANDBOX).catch(() => undefined);
    await sandbox().deleteMany({});
  });

  afterAll(async () => {
    if (!connection) return;
    await applied().deleteMany({});
    if (saved.length > 0) await applied().insertMany(saved);
    await connection.collection(MIGRATION_LOCK_COLLECTION).deleteMany({});
    await sandbox()
      .drop()
      .catch(() => undefined);
    await connection.close();
  });

  it('applies pending migrations once, in order, and reports the database version', async () => {
    const runner = new MigrationRunner(connection, [insert('0001-a', 'a'), insert('0002-b', 'b')], {
      logger,
    });
    expect(await runner.status()).toMatchObject({
      databaseVersion: 'none',
      codeVersion: '0002-b',
      pending: ['0001-a', '0002-b'],
    });
    expect(await runner.migrate('test')).toEqual({ applied: ['0001-a', '0002-b'] });
    expect(await runner.migrate('test')).toEqual({ applied: [] });
    expect((await sandbox().find({}).toArray()).map((row) => row['marker'] as string)).toEqual([
      'a',
      'b',
    ]);
    expect(await runner.status()).toMatchObject({ databaseVersion: '0002-b', pending: [] });
  });

  it('refuses a released migration that was edited afterwards, before changing anything', async () => {
    await new MigrationRunner(connection, [insert('0001-a', 'a')]).migrate('test');
    const edited: Migration = { ...insert('0001-a', 'a'), fingerprint: 'insert:something-else' };
    const runner = new MigrationRunner(connection, [edited, insert('0002-b', 'b')]);
    expect((await runner.status()).changed).toEqual(['0001-a']);
    await expect(runner.migrate('test')).rejects.toMatchObject({ code: 'MIGRATION_CHANGED' });
    expect(await sandbox().countDocuments({ marker: 'b' })).toBe(0);
  });

  it('refuses a database that is newer than the code', async () => {
    await new MigrationRunner(connection, [insert('0001-a', 'a'), insert('0002-b', 'b')]).migrate(
      'test',
    );
    const older = new MigrationRunner(connection, [insert('0001-a', 'a')]);
    await expect(older.migrate('test')).rejects.toMatchObject({ code: 'MIGRATION_UNKNOWN' });
  });

  it('lets one run at a time, and takes over an expired lock', async () => {
    await connection
      .collection<{ _id: string; holder: string; expiresAt: Date }>(MIGRATION_LOCK_COLLECTION)
      .insertOne({
        _id: 'migrations',
        holder: 'someone-else',
        expiresAt: new Date(Date.now() + 60_000),
      });
    const runner = new MigrationRunner(connection, [insert('0001-a', 'a')]);
    await expect(runner.migrate('test')).rejects.toMatchObject({ code: 'MIGRATION_LOCKED' });
    expect(await sandbox().countDocuments()).toBe(0);

    await connection
      .collection(MIGRATION_LOCK_COLLECTION)
      .updateOne({ _id: 'migrations' as never }, { $set: { expiresAt: new Date(Date.now() - 1) } });
    expect(await runner.migrate('test')).toEqual({ applied: ['0001-a'] });
    expect(await connection.collection(MIGRATION_LOCK_COLLECTION).countDocuments()).toBe(0);
  });

  it('stops at a failing migration, rolls it back, and keeps the ones before it', async () => {
    const failing: Migration = {
      id: '0002-fails',
      revision: 1,
      fingerprint: 'insert-then-throw',
      description: 'writes then fails',
      transactional: true,
      up: async ({ connection: db, session }) => {
        await db.collection(SANDBOX).insertOne({ marker: 'partial' }, session ? { session } : {});
        throw new Error('boom');
      },
    };
    const runner = new MigrationRunner(connection, [
      insert('0001-a', 'a'),
      failing,
      insert('0003-c', 'c'),
    ]);
    await expect(runner.migrate('test')).rejects.toThrow('boom');
    expect((await sandbox().find({}).toArray()).map((row) => row['marker'] as string)).toEqual([
      'a',
    ]);
    expect(await runner.status()).toMatchObject({
      databaseVersion: '0001-a',
      pending: ['0002-fails', '0003-c'],
    });
    expect(await connection.collection(MIGRATION_LOCK_COLLECTION).countDocuments()).toBe(0);
  });

  it('refuses migrations declared out of order', () => {
    expect(
      () => new MigrationRunner(connection, [insert('0002-b', 'b'), insert('0001-a', 'a')]),
    ).toThrow(/out of order/);
    expect(() => new MigrationRunner(connection, [insert('first', 'x')])).toThrow(
      /Bad migration id/,
    );
  });

  it('ships a valid, ordered migration list', () => {
    expect(() => new MigrationRunner(connection, MIGRATIONS)).not.toThrow();
  });

  it('treats a reworded description as the same migration, and a new revision as a change', async () => {
    await new MigrationRunner(connection, [insert('0001-a', 'a')]).migrate('test');
    const reworded = { ...insert('0001-a', 'a'), description: 'Reworded for people.' };
    expect((await new MigrationRunner(connection, [reworded]).status()).changed).toEqual([]);
    const revised = { ...insert('0001-a', 'a'), revision: 2 };
    expect((await new MigrationRunner(connection, [revised]).status()).changed).toEqual(['0001-a']);
  });

  describe('readiness against the recorded schema (OPS-006)', () => {
    const mongo = { health: () => Promise.resolve({ status: 'up' as const, transactions: true }) };
    const redis = { health: () => Promise.resolve({ status: 'up' as const }) };
    const probe = (runner: MigrationRunner) => ({
      health: async () => schemaHealth(await runner.status()),
    });

    it('is ready when every applied checksum matches, and not ready when pending or edited', async () => {
      await new MigrationRunner(connection, [insert('0001-a', 'a')]).migrate('test');
      const current = await readiness(
        mongo,
        redis,
        probe(new MigrationRunner(connection, [insert('0001-a', 'a')])),
      );
      expect(current).toMatchObject({
        status: 'ready',
        checks: { migrations: { status: 'current' } },
      });

      const pending = await readiness(
        mongo,
        redis,
        probe(new MigrationRunner(connection, [insert('0001-a', 'a'), insert('0002-b', 'b')])),
      );
      expect(pending).toMatchObject({
        status: 'not_ready',
        checks: { migrations: { status: 'pending' } },
      });

      const edited = { ...insert('0001-a', 'a'), fingerprint: 'insert:changed' };
      const mismatch = await readiness(
        mongo,
        redis,
        probe(new MigrationRunner(connection, [edited])),
      );
      expect(mismatch).toMatchObject({
        status: 'not_ready',
        checks: { migrations: { status: 'mismatch' } },
      });
    });

    it('is not ready when the migration history cannot be read', async () => {
      const lost = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
        dbName: process.env['MONGODB_DB_NAME'] as string,
      });
      await lost.asPromise();
      const runner = new MigrationRunner(lost, [insert('0001-a', 'a')]);
      await lost.close();
      expect(await readiness(mongo, redis, probe(runner))).toMatchObject({
        status: 'not_ready',
        checks: { migrations: { status: 'unknown' } },
      });
    });
  });

  describe('development checksum transition', () => {
    const LEGACY = 'a'.repeat(64);
    let bodyRuns = 0;
    const tracked: Migration = {
      ...insert('0001-a', 'a'),
      up: async () => {
        bodyRuns += 1;
        await Promise.resolve();
      },
    };
    const expected = migrationChecksum(tracked);
    const request = (overrides: Partial<ChecksumTransition> = {}): ChecksumTransition => ({
      appEnv: 'development',
      migrationId: '0001-a',
      fromChecksum: LEGACY,
      toChecksum: expected,
      ...overrides,
    });
    const appliedAt = new Date('2026-09-01T00:00:00.000Z');
    const seedLegacyRow = () =>
      applied().insertOne({
        migrationId: '0001-a',
        checksum: LEGACY,
        description: 'insert a',
        appliedAt,
        durationMs: 3,
      });
    const otherCounts = async () => {
      const names = (await connection.db!.listCollections().toArray())
        .map((c) => c.name)
        .filter((name) => name !== SCHEMA_MIGRATIONS_COLLECTION)
        .sort();
      const counts: Record<string, number> = {};
      for (const name of names) counts[name] = await connection.collection(name).countDocuments();
      return counts;
    };

    beforeEach(() => {
      bodyRuns = 0;
    });

    it('moves the exact old checksum to the build checksum, on one row, without running the migration', async () => {
      await seedLegacyRow();
      const before = await applied().findOne({ migrationId: '0001-a' });
      const others = await otherCounts();
      expect((await new MigrationRunner(connection, [tracked]).status()).changed).toEqual([
        '0001-a',
      ]);

      await expect(transitionMigrationChecksum(connection, [tracked], request())).resolves.toEqual({
        migrationId: '0001-a',
        outcome: 'updated',
      });

      const after = await applied().find({}).toArray();
      expect(after).toHaveLength(1);
      expect(after[0]).toEqual({ ...before, checksum: expected });
      expect(bodyRuns).toBe(0);
      expect(await sandbox().countDocuments()).toBe(0);
      expect(await otherCounts()).toEqual(others);
      expect(await new MigrationRunner(connection, [tracked]).status()).toMatchObject({
        changed: [],
        pending: [],
        databaseVersion: '0001-a',
      });
    });

    it('is idempotent once the row carries the build checksum', async () => {
      await seedLegacyRow();
      await transitionMigrationChecksum(connection, [tracked], request());
      const once = await applied().find({}).toArray();
      await expect(transitionMigrationChecksum(connection, [tracked], request())).resolves.toEqual({
        migrationId: '0001-a',
        outcome: 'unchanged',
      });
      expect(await applied().find({}).toArray()).toEqual(once);
    });

    it('refuses an unknown current checksum, and leaves the row alone', async () => {
      await seedLegacyRow();
      const before = await applied().find({}).toArray();
      await expect(
        transitionMigrationChecksum(
          connection,
          [tracked],
          request({ fromChecksum: 'b'.repeat(64) }),
        ),
      ).rejects.toMatchObject({ code: 'MIGRATION_TRANSITION_REFUSED' });
      expect(await applied().find({}).toArray()).toEqual(before);
    });

    it('refuses staging and production before reading anything', async () => {
      await seedLegacyRow();
      const before = await applied().find({}).toArray();
      for (const appEnv of ['staging', 'production', 'test']) {
        await expect(
          transitionMigrationChecksum(connection, [tracked], request({ appEnv })),
        ).rejects.toMatchObject({ code: 'MIGRATION_TRANSITION_REFUSED' });
      }
      expect(await applied().find({}).toArray()).toEqual(before);
      expect(bodyRuns).toBe(0);
    });

    it('refuses a new checksum this build does not compute, a missing row, and an unknown migration', async () => {
      await expect(transitionMigrationChecksum(connection, [tracked], request())).rejects.toThrow(
        /No applied row/,
      );
      await seedLegacyRow();
      await expect(
        transitionMigrationChecksum(connection, [tracked], request({ toChecksum: 'c'.repeat(64) })),
      ).rejects.toThrow(/not the one this build computes/);
      await expect(
        transitionMigrationChecksum(connection, [tracked], request({ migrationId: '0009-z' })),
      ).rejects.toThrow(/no migration 0009-z/);
      expect((await applied().findOne({ migrationId: '0001-a' }))?.['checksum']).toBe(LEGACY);
    });
  });
});
