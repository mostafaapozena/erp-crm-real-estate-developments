import { WORKER_HEARTBEAT_KEY, WorkerHeartbeatSchema } from '@alola/contracts';
import { createLogger } from '@alola/security';
import { serviceGate } from '@alola/testing';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { startHeartbeat } from './heartbeat';

/** OPS-006: the worker proves it is alive with an expiring key, and removes it when it stops. */
const gate = serviceGate(['redis']);

describe.skipIf(!gate.available)(`worker heartbeat — ${gate.reason}`, () => {
  const connection = new Redis(process.env['REDIS_URL'] ?? '', { maxRetriesPerRequest: null });

  afterAll(async () => {
    await connection.quit();
  });

  it('writes a valid, expiring heartbeat and removes it on stop', async () => {
    const heartbeat = startHeartbeat(
      connection,
      createLogger({ name: 'it-heartbeat', level: 'silent' }),
    );
    let raw: string | null = null;
    for (let attempt = 0; attempt < 50 && !raw; attempt += 1) {
      raw = await connection.get(WORKER_HEARTBEAT_KEY);
      if (!raw) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(raw).not.toBeNull();
    const parsed = WorkerHeartbeatSchema.parse(JSON.parse(raw ?? '{}'));
    expect(parsed.build.version).toBe('development');
    const ttl = await connection.ttl(WORKER_HEARTBEAT_KEY);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(90);
    await heartbeat.stop();
    expect(await connection.get(WORKER_HEARTBEAT_KEY)).toBeNull();
  });
});
