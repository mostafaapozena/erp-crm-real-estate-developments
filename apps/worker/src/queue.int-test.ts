import { serviceGate } from '@alola/testing';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_JOB_OPTIONS, envelope, idempotentJobId } from './jobs';

/** Integration tier (TEST-001): real Redis only; skipped and reported as skipped otherwise. */
const gate = serviceGate(['redis']);

describe.skipIf(!gate.available)(
  `BullMQ idempotent enqueue (INTEGRATION-006) — ${gate.reason}`,
  () => {
    const connection = new Redis(process.env['REDIS_URL'] ?? '', { maxRetriesPerRequest: null });
    const queue = new Queue(`alola-int-${Date.now()}`, { connection });

    afterAll(async () => {
      await queue.obliterate({ force: true });
      await queue.close();
      await connection.quit();
    });

    it('enqueuing the same logical job twice creates one job', async () => {
      const jobId = idempotentJobId('int-test', 'entity-1');
      await queue.add('op', envelope({ n: 1 }, 'corr-int-0001'), { ...DEFAULT_JOB_OPTIONS, jobId });
      await queue.add('op', envelope({ n: 1 }, 'corr-int-0001'), { ...DEFAULT_JOB_OPTIONS, jobId });
      expect(await queue.getJobCountByTypes('waiting', 'delayed', 'prioritized')).toBe(1);
    });
  },
);
