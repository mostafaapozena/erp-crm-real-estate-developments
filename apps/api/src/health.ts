import type { DependencyHealth, MongoHealth, ReadinessResponse } from '@alola/contracts';

export interface HealthProbe<T> {
  health(): Promise<T>;
}

/**
 * Per-dependency readiness (OPS-003). Ready only when every required dependency is up. Each dependency
 * is reported separately with a stable code, so operators can tell a Redis outage from a database one.
 */
const PROBE_TIMEOUT_MS = 3000;

function withTimeout<T>(probe: Promise<T>, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), PROBE_TIMEOUT_MS);
  });
  return Promise.race([probe.catch(() => fallback), timeout]).finally(() => clearTimeout(timer));
}

export type MigrationHealth = NonNullable<ReadinessResponse['checks']['migrations']>;

export async function readiness(
  mongo: HealthProbe<MongoHealth>,
  redis: HealthProbe<DependencyHealth>,
  migrations?: HealthProbe<MigrationHealth>,
): Promise<ReadinessResponse> {
  const [mongodb, redisHealth, schema] = await Promise.all([
    withTimeout<MongoHealth>(mongo.health(), { status: 'down', code: 'HEALTH_CHECK_TIMEOUT' }),
    withTimeout<DependencyHealth>(redis.health(), { status: 'down', code: 'HEALTH_CHECK_TIMEOUT' }),
    migrations
      ? withTimeout<MigrationHealth>(migrations.health(), { status: 'unknown' })
      : Promise.resolve(undefined),
  ]);
  const ready =
    mongodb.status === 'up' &&
    redisHealth.status === 'up' &&
    (schema === undefined || schema.status === 'current');
  return {
    status: ready ? 'ready' : 'not_ready',
    checks: { mongodb, redis: redisHealth, ...(schema ? { migrations: schema } : {}) },
  };
}
