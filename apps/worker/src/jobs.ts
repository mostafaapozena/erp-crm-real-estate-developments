import { createHash } from 'node:crypto';
import type { JobsOptions } from 'bullmq';

/**
 * Job reliability foundation (PLAT-016, INTEGRATION-006).
 *
 * - Bounded retries with exponential backoff and jitter.
 * - Exhausted jobs move to a dead-letter queue, visible and replayable — never silently dropped.
 * - Deterministic job IDs: enqueueing the same logical operation twice is a no-op, so a retrying
 *   caller cannot create a second send, post, or charge.
 * - Every job carries the correlation ID of the request that caused it (PLAT-007).
 */
export const DEAD_LETTER_QUEUE = 'alola-dead-letter';
export const MAX_ATTEMPTS = 5;

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: MAX_ATTEMPTS,
  backoff: { type: 'exponential', delay: 2_000, jitter: 0.5 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  // Failed jobs are kept: they are evidence until an operator resolves them.
  removeOnFail: false,
};

export interface JobMeta {
  correlationId: string;
  enqueuedAt: string;
}

export interface JobEnvelope<T> {
  meta: JobMeta;
  payload: T;
}

export function envelope<T>(
  payload: T,
  correlationId: string,
  now: Date = new Date(),
): JobEnvelope<T> {
  return { meta: { correlationId, enqueuedAt: now.toISOString() }, payload };
}

/**
 * A stable job ID for one logical operation, e.g. `idempotentJobId('reminder', installmentId, '15d')`.
 * Hashed so IDs are fixed-length and carry no personal data; BullMQ rejects integer-like and
 * `:`-containing custom IDs, which a hex digest with a prefix never is.
 */
export function idempotentJobId(operation: string, ...keys: readonly string[]): string {
  if (!/^[a-z][a-z0-9-]*$/.test(operation) || keys.length === 0 || keys.some((k) => k === '')) {
    throw new Error('INVALID_JOB_KEY');
  }
  const digest = createHash('sha256')
    .update(JSON.stringify([operation, ...keys]))
    .digest('hex');
  return `${operation}-${digest.slice(0, 40)}`;
}

/** True once a failed job has used every attempt and must move to the dead-letter queue. */
export function isExhausted(job: { attemptsMade: number; opts: { attempts?: number } }): boolean {
  return job.attemptsMade >= (job.opts.attempts ?? 1);
}

export interface DeadLetterRecord {
  queue: string;
  jobId: string;
  jobName: string;
  attemptsMade: number;
  failedReason: string;
  correlationId: string | undefined;
  failedAt: string;
}

/**
 * What the dead-letter queue stores: identifiers and the failure, **not** the payload, which may hold
 * personal or financial data. The original job stays in its queue for replay.
 */
export function deadLetterRecord(
  queue: string,
  job: { id?: string | undefined; name: string; attemptsMade: number; data: unknown },
  failedReason: string,
  now: Date = new Date(),
): DeadLetterRecord {
  const data = job.data as Partial<JobEnvelope<unknown>> | undefined;
  return {
    queue,
    jobId: job.id ?? 'unknown',
    jobName: job.name,
    attemptsMade: job.attemptsMade,
    failedReason: failedReason.slice(0, 500),
    correlationId: data?.meta?.correlationId,
    failedAt: now.toISOString(),
  };
}
