import { buildInfo } from '@alola/config';
import {
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_TTL_SECONDS,
  type WorkerHeartbeat,
} from '@alola/contracts';
import type { Logger } from '@alola/security';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { DEAD_LETTER_QUEUE } from './jobs';

/**
 * The worker says it is alive (OPS-006): every third of the heartbeat's lifetime it writes its build
 * and the number of dead-lettered jobs to Redis with an expiry. The API reads the key for readiness
 * and diagnostics; a worker that stops — crashed, hung or never started — simply lets it expire.
 */
export function startHeartbeat(connection: Redis, logger: Logger): { stop(): Promise<void> } {
  const deadLetters = new Queue(DEAD_LETTER_QUEUE, { connection });
  const beat = async () => {
    try {
      const counts = await deadLetters.getJobCounts(
        'waiting',
        'delayed',
        'active',
        'completed',
        'failed',
      );
      const heartbeat: WorkerHeartbeat = {
        at: new Date().toISOString() as WorkerHeartbeat['at'],
        build: buildInfo(),
        deadLetters: Object.values(counts).reduce((sum, count) => sum + count, 0),
      };
      await connection.set(
        WORKER_HEARTBEAT_KEY,
        JSON.stringify(heartbeat),
        'EX',
        WORKER_HEARTBEAT_TTL_SECONDS,
      );
    } catch (error) {
      logger.warn({ errorName: (error as Error).name }, 'Heartbeat not written');
    }
  };
  void beat();
  const timer = setInterval(() => void beat(), (WORKER_HEARTBEAT_TTL_SECONDS / 3) * 1000);
  timer.unref();
  return {
    async stop() {
      clearInterval(timer);
      await connection.del(WORKER_HEARTBEAT_KEY).catch(() => undefined);
      await deadLetters.close();
    },
  };
}
