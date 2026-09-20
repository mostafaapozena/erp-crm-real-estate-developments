import { ConfigError, assertUtcRuntime, loadApiConfig, loadDotEnvIfPresent } from '@alola/config';
import { createLogger } from '@alola/security';
import { fileURLToPath } from 'node:url';
import { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import { createApp, type ApiModule } from './app';
import { AUDIT_ACTIONS } from '@alola/contracts';
import { noteAuditWrite } from './http/audit-context';
import { AuditService, auditRouter } from './modules/audit';
import { SecurityService, securityRouter } from './modules/security';
import { ensureIndexes } from './platform/indexes';
import { AppError } from './errors';
import { MongoConnector, configureMongoose } from './platform/mongo';
import { RedisConnector } from './platform/redis';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
loadDotEnvIfPresent(repositoryRoot);

let config: ReturnType<typeof loadApiConfig>;
try {
  config = loadApiConfig();
  assertUtcRuntime();
} catch (error) {
  if (error instanceof ConfigError) {
    // A clear, value-free message and a clean exit — not a stack trace or a crash loop (ADR-0012).
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const logger = createLogger({
  name: 'api',
  level: config.LOG_LEVEL,
  base: { env: config.APP_ENV },
});

configureMongoose();
const mongo = new MongoConnector(
  { uri: config.MONGODB_URI, dbName: config.MONGODB_DB_NAME },
  logger,
);
const redis = new RedisConnector(config.REDIS_URL, logger);
void mongo.connect().then(async () => {
  if (!mongo.db) return;
  try {
    // ADR-0002: indexes are declared with their collections and created explicitly (autoIndex is off).
    await ensureIndexes(mongo.db, logger);
  } catch (error) {
    logger.error(
      { err: error, code: 'INDEX_CREATION_FAILED' },
      'MongoDB indexes could not be created',
    );
  }
});
redis.connect();

const limits = {
  points: config.RATE_LIMIT_MAX_REQUESTS,
  duration: config.RATE_LIMIT_WINDOW_SECONDS,
};
const memoryLimiter = new RateLimiterMemory({ keyPrefix: 'rl-global', ...limits });
const rateLimiter = redis.client
  ? new RateLimiterRedis({
      storeClient: redis.client,
      keyPrefix: 'rl-global',
      insuranceLimiter: memoryLimiter,
      ...limits,
    })
  : memoryLimiter;

/**
 * Domain services need a live database. Until MongoDB is configured, their routes answer
 * SERVICE_NOT_CONFIGURED rather than crashing the process (ADR-0012).
 */
function requireConnection() {
  const connection = mongo.db;
  if (!connection) throw new AppError('SERVICE_NOT_CONFIGURED', 503);
  return connection;
}

let auditService: AuditService | undefined;
let securityService: SecurityService | undefined;

function getAuditService(): AuditService {
  const connection = requireConnection();
  auditService ??= new AuditService({ connection, logger, onRecorded: noteAuditWrite });
  return auditService;
}

function getSecurityService(): SecurityService {
  const connection = requireConnection();
  securityService ??= new SecurityService({ connection, audit: getAuditService() });
  return securityService;
}

/** Authorization denials are security events (AUDIT-005). A failure to record must not hide the denial. */
const guard = {
  onDenied: async (denial: {
    requiredPermission: string;
    actor?: { kind: 'account' | 'system'; accountId: string; roleKeys: string[] } | undefined;
    correlationId: string;
    method: string;
    route: string;
    ip?: string;
  }) => {
    try {
      await getAuditService().record({
        action: AUDIT_ACTIONS.authorizationDenied,
        outcome: 'denied',
        actor: denial.actor
          ? {
              kind: denial.actor.kind,
              accountId: denial.actor.accountId,
              roleKeys: denial.actor.roleKeys,
            }
          : { kind: 'anonymous' },
        target: { type: 'endpoint', id: `${denial.method} ${denial.route}` },
        reason: `missing permission: ${denial.requiredPermission}`,
        context: {
          correlationId: denial.correlationId,
          method: denial.method,
          route: denial.route,
          ...(denial.ip ? { ip: denial.ip } : {}),
        },
      });
    } catch (error) {
      logger.error(
        { err: error, code: 'AUDIT_DENIAL_NOT_RECORDED' },
        'Authorization denial could not be audited',
      );
    }
  },
};

const modules: ApiModule[] = [
  { basePath: '/audit', router: auditRouter({ getService: getAuditService, guard }) },
  { basePath: '/security', router: securityRouter({ getService: getSecurityService, guard }) },
];

const app = createApp({ config, logger, mongo, redis, rateLimiter, modules });

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.APP_ENV }, 'API listening');
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  server.close();
  await Promise.allSettled([mongo.close(), redis.close()]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});
