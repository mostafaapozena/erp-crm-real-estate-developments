import {
  ConfigError,
  assertUtcRuntime,
  loadDotEnvIfPresent,
  loadWorkerConfig,
} from '@alola/config';
import { createLogger } from '@alola/security';
import { Redis } from 'ioredis';
import { fileURLToPath } from 'node:url';
import { startHeartbeat } from './heartbeat';
import { startQueueWorker } from './runtime';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
loadDotEnvIfPresent(repositoryRoot);

let config: ReturnType<typeof loadWorkerConfig>;
try {
  config = loadWorkerConfig();
  assertUtcRuntime();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const logger = createLogger({
  name: 'worker',
  level: config.LOG_LEVEL,
  base: { env: config.APP_ENV },
});

if (!config.REDIS_URL) {
  // The worker has nothing to do without a queue backend. Exit once with a clear message rather than
  // looping on connection errors (ADR-0012).
  logger.error(
    { service: 'redis', code: 'REDIS_URL_NOT_SET' },
    'The worker requires Redis. Set REDIS_URL to a managed development instance or an approved ' +
      'local instance. See docs/architecture/environments.md.',
  );
  process.exit(1);
}

// BullMQ requires maxRetriesPerRequest: null on worker connections.
const connection = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  connectionName: 'alola-worker',
});
let reportedDown = false;
connection.on('ready', () => {
  reportedDown = false;
  logger.info({ service: 'redis' }, 'Redis connected');
});
connection.on('error', (error: Error) => {
  if (reportedDown) return;
  reportedDown = true;
  logger.error(
    { service: 'redis', code: 'REDIS_UNREACHABLE', errorName: error.name },
    'Redis is unreachable. Check REDIS_URL and network access. Retrying in the background.',
  );
});

// Phase 1 registers only the platform system queue. Domain queues arrive with their phases.
const system = startQueueWorker<{ kind: 'ping' }>({
  queue: 'alola-system',
  connection,
  concurrency: config.WORKER_CONCURRENCY,
  logger,
  processor: (job) => {
    logger.info(
      { jobId: job.id, correlationId: job.data.meta.correlationId },
      'System ping processed',
    );
    return Promise.resolve();
  },
});

const heartbeat = startHeartbeat(connection, logger);
logger.info({ concurrency: config.WORKER_CONCURRENCY }, 'Worker started');

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  await heartbeat.stop();
  await system.close();
  await connection.quit().catch(() => undefined);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
