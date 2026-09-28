import { describe, expect, it } from 'vitest';
import { readiness } from './health';

/** OPS-006: an instance is ready only when its database schema matches its build. */
describe('readiness with a migration check', () => {
  const up = { health: () => Promise.resolve({ status: 'up' as const, transactions: true }) };
  const redis = { health: () => Promise.resolve({ status: 'up' as const }) };
  const schema = (status: 'current' | 'pending' | 'mismatch') => ({
    health: () => Promise.resolve({ status }),
  });

  it('is ready with a current schema, and reports it', async () => {
    expect(await readiness(up, redis, schema('current'))).toEqual({
      status: 'ready',
      checks: {
        mongodb: { status: 'up', transactions: true },
        redis: { status: 'up' },
        migrations: { status: 'current' },
      },
    });
  });

  it('is not ready while migrations are pending or do not match the build', async () => {
    expect((await readiness(up, redis, schema('pending'))).status).toBe('not_ready');
    expect((await readiness(up, redis, schema('mismatch'))).status).toBe('not_ready');
  });

  it('reports an unreadable schema as unknown and not ready', async () => {
    const broken = { health: () => Promise.reject(new Error('no database')) };
    const report = await readiness(up, redis, broken);
    expect(report).toMatchObject({
      status: 'not_ready',
      checks: { migrations: { status: 'unknown' } },
    });
  });

  it('leaves readiness as before when no migration check is given', async () => {
    expect(await readiness(up, redis)).toEqual({
      status: 'ready',
      checks: { mongodb: { status: 'up', transactions: true }, redis: { status: 'up' } },
    });
  });
});
