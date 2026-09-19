import type { DependencyHealth } from '@alola/contracts';
import type { Logger } from '@alola/security';
import { Redis } from 'ioredis';

/**
 * Redis adapter (PLAT-015, ADR-0018). `REDIS_URL` selects a managed development instance or an
 * approved local instance — the code does not distinguish. Failures are reported once per state
 * change rather than on every reconnect attempt, so an outage does not flood the logs.
 */
export class RedisConnector {
  readonly client: Redis | undefined;
  private reportedDown = false;

  constructor(
    url: string | undefined,
    private readonly logger: Logger,
  ) {
    if (!url) {
      this.logger.warn(
        { service: 'redis', code: 'REDIS_URL_NOT_SET' },
        'Redis is not configured (REDIS_URL). Rate limiting falls back to in-memory; readiness ' +
          'reports not_configured. See docs/architecture/environments.md.',
      );
      return;
    }
    this.client = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectionName: 'alola-api',
      retryStrategy: (attempt) => Math.min(attempt * 500, 10_000),
    });
    this.client.on('ready', () => {
      this.reportedDown = false;
      this.logger.info({ service: 'redis' }, 'Redis connected');
    });
    this.client.on('error', (error: Error) => {
      if (this.reportedDown) return;
      this.reportedDown = true;
      this.logger.error(
        { service: 'redis', code: 'REDIS_UNREACHABLE', errorName: error.name },
        'Redis is unreachable. Check REDIS_URL and network access. Retrying in the background.',
      );
    });
  }

  connect(): void {
    this.client?.connect().catch(() => {
      // Reported by the 'error' listener; the retry strategy keeps trying.
    });
  }

  async health(): Promise<DependencyHealth> {
    if (!this.client) return { status: 'not_configured', code: 'REDIS_URL_NOT_SET' };
    try {
      await this.client.ping();
      return { status: 'up' };
    } catch {
      return { status: 'down', code: 'REDIS_UNREACHABLE' };
    }
  }

  async close(): Promise<void> {
    if (this.client && this.client.status !== 'end')
      await this.client.quit().catch(() => undefined);
  }
}
