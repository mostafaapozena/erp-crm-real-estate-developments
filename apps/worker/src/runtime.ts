import type { Logger } from '@alola/security';
import { Queue, Worker, type Processor } from 'bullmq';
import type { Redis } from 'ioredis';
import { DEAD_LETTER_QUEUE, deadLetterRecord, isExhausted, type JobEnvelope } from './jobs';

export interface WorkerRuntime {
  close(): Promise<void>;
}

/**
 * Starts a BullMQ worker for one queue with dead-lettering wired in. Processors receive the job
 * envelope and log with the job's correlation ID.
 */
export function startQueueWorker<T>(options: {
  queue: string;
  connection: Redis;
  concurrency: number;
  logger: Logger;
  processor: Processor<JobEnvelope<T>>;
}): WorkerRuntime {
  const { queue, connection, logger } = options;
  const deadLetters = new Queue(DEAD_LETTER_QUEUE, { connection });
  const worker = new Worker<JobEnvelope<T>>(queue, options.processor, {
    connection,
    concurrency: options.concurrency,
  });

  worker.on('failed', (job, error) => {
    if (!job) return;
    const log = logger.child({ queue, jobId: job.id, correlationId: job.data.meta?.correlationId });
    if (!isExhausted(job)) {
      log.warn(
        { attemptsMade: job.attemptsMade, errorName: error.name },
        'Job attempt failed; retrying',
      );
      return;
    }
    const record = deadLetterRecord(queue, job, error.message);
    // Dead-letter job ID derives from the source job, so a duplicate 'failed' event adds nothing.
    deadLetters
      .add('dead-letter', record, {
        jobId: `${queue}-${job.id ?? 'unknown'}`,
        removeOnComplete: false,
      })
      .then(() =>
        log.error({ attemptsMade: job.attemptsMade }, 'Job exhausted; moved to dead-letter queue'),
      )
      .catch((dlqError: unknown) =>
        log.error({ err: dlqError }, 'Failed to write dead-letter record'),
      );
  });
  worker.on('error', (error) => {
    logger.error({ queue, errorName: error.name }, 'Worker error');
  });

  return {
    async close() {
      await worker.close();
      await deadLetters.close();
    },
  };
}
