import { createLogger } from '@alola/security';
import { serviceGate } from '@alola/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureIndexes } from './indexes';
import {
  MAINTENANCE_RUNS_COLLECTION,
  MaintenanceScheduler,
  type SweepDefinition,
} from './maintenance';
import { configureMongoose } from './mongo';

/**
 * The maintenance scheduler against a real MongoDB replica set (OPS-007). Two schedulers stand in for
 * two API instances ticking at the same moment.
 */
const gate = serviceGate(['mongodb']);

describe.skipIf(!gate.available)(`scheduled maintenance — ${gate.reason}`, () => {
  let connection: Connection;
  let clock: Date;
  let calls: string[];
  let failNext: boolean;
  const logger = createLogger({ name: 'it-maintenance', level: 'silent' });

  const sweeps = (): SweepDefinition[] => [
    {
      name: 'tasks.sweep',
      intervalSeconds: 300,
      run: (actor) => {
        calls.push(`tasks:${actor.accountId}`);
        return Promise.resolve({ reminded: 1 });
      },
    },
    {
      name: 'approvals.escalate',
      intervalSeconds: 600,
      run: () => {
        calls.push('approvals');
        if (failNext) {
          failNext = false;
          return Promise.reject(
            Object.assign(new Error('secret detail'), { code: 'PROVIDER_DOWN' }),
          );
        }
        return Promise.resolve({ escalated: 0 });
      },
    },
  ];
  const scheduler = (holder: string) =>
    new MaintenanceScheduler(connection, sweeps(), { logger, holder, now: () => clock });
  const runs = () => connection.collection(MAINTENANCE_RUNS_COLLECTION);

  beforeAll(async () => {
    configureMongoose();
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'] as string,
    });
    await connection.asPromise();
    await ensureIndexes(connection, logger);
  });

  beforeEach(async () => {
    clock = new Date('2026-10-01T09:00:00.000Z');
    calls = [];
    failNext = false;
    await runs().deleteMany({});
  });

  afterAll(async () => {
    if (!connection) return;
    await runs().deleteMany({});
    await connection.close();
  });

  it('runs each sweep once when two instances tick together, as the system actor', async () => {
    const [a, b] = await Promise.all([scheduler('a').tick(), scheduler('b').tick()]);
    expect([...a, ...b].sort()).toEqual(['approvals.escalate', 'tasks.sweep']);
    expect(calls.sort()).toEqual(['approvals', 'tasks:system:maintenance']);
  });

  it('waits for each sweep’s interval, then runs it again', async () => {
    const one = scheduler('a');
    await one.tick();
    clock = new Date(clock.getTime() + 299_000);
    expect(await one.tick()).toEqual([]);
    clock = new Date(clock.getTime() + 2_000);
    expect(await one.tick()).toEqual(['tasks.sweep']);
    clock = new Date(clock.getTime() + 300_000);
    expect((await one.tick()).sort()).toEqual(['approvals.escalate', 'tasks.sweep']);
  });

  it('records a failure by code only, and still schedules the next run', async () => {
    failNext = true;
    const one = scheduler('a');
    await one.tick();
    const status = await one.status();
    const approvals = status.find((run) => run.sweep === 'approvals.escalate');
    expect(approvals).toMatchObject({
      lastOutcome: 'failed',
      lastErrorCode: 'PROVIDER_DOWN',
      running: false,
    });
    expect(JSON.stringify(status)).not.toContain('secret detail');
    expect(status.find((run) => run.sweep === 'tasks.sweep')).toMatchObject({
      lastOutcome: 'succeeded',
      lastResult: { reminded: 1 },
    });
    clock = new Date(clock.getTime() + 601_000);
    expect(await one.tick()).toContain('approvals.escalate');
    expect((await one.status()).find((run) => run.sweep === 'approvals.escalate')).toMatchObject({
      lastOutcome: 'succeeded',
    });
  });

  it('takes over a lease a crashed instance left behind, once it expires', async () => {
    await runs().insertOne({
      _id: 'tasks.sweep' as never,
      holder: 'crashed',
      leaseUntil: new Date(clock.getTime() + 60_000),
      nextRunAt: clock,
    });
    expect(await scheduler('a').tick()).toEqual(['approvals.escalate']);
    clock = new Date(clock.getTime() + 61_000);
    expect(await scheduler('a').tick()).toEqual(['tasks.sweep']);
  });
});
