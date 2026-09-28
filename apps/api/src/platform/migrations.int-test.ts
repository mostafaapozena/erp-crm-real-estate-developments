import { createLogger } from '@alola/security';
import { serviceGate } from '@alola/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureIndexes } from './indexes';
import { MIGRATIONS } from './migration-list';
import {
  MIGRATION_LOCK_COLLECTION,
  MigrationRunner,
  SCHEMA_MIGRATIONS_COLLECTION,
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
    const edited: Migration = { ...insert('0001-a', 'a'), description: 'insert something else' };
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
});
