import { ConfigError, assertUtcRuntime, loadApiConfig, loadDotEnvIfPresent } from '@alola/config';
import { createLogger } from '@alola/security';
import { fileURLToPath } from 'node:url';
import { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import { createApp, type ApiModule } from './app';
import { AUDIT_ACTIONS } from '@alola/contracts';
import { noteAuditWrite } from './http/audit-context';
import { approvalRouter } from './modules/approval';
import { auditRouter } from './modules/audit';
import { accountAdminRouter, authRouter, cookiePolicyFor, meRouter } from './modules/identity';
import { collectionRouter } from './modules/collections';
import { documentRouter, fileRouter, templateRouter } from './modules/documents';
import { LocalDiskFileStore } from '@alola/security';
import { brandingRouter, companyRouter } from './modules/company';
import { crmRouter } from './modules/crm';
import { inventoryRouter } from './modules/inventory';
import { marketingRouter } from './modules/marketing';
import { numberingRouter } from './modules/numbering';
import { notificationRouter } from './modules/notifications';
import { taskRouter } from './modules/tasks';
import { organizationRouter } from './modules/organization';
import { salesRouter } from './modules/sales';
import { securityRouter } from './modules/security';
import { referenceDataRouter, settingsRouter } from './modules/settings';
import type { ActorResolver } from './http/actor';
import { createDomainServices } from './platform/domain-services';
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

const cookiePolicy = cookiePolicyFor(config.APP_ENV);

/**
 * Every domain service comes from one composition root, shared with the demonstration seed so that
 * seeded data is written through exactly the ports the API uses (see `platform/domain-services.ts`).
 */
const services = createDomainServices({
  config,
  logger,
  requireConnection,
  redisClient: redis.client ?? undefined,
  onAuditRecorded: noteAuditWrite,
  repositoryRoot,
});

const getAuditService = services.audit;
const getSecurityService = services.security;
const getIdentityService = services.identity;
const getApprovalService = services.approval;
const getOrganizationService = services.organization;
const getInventoryService = services.inventory;
const getCrmService = services.crm;
const getSalesService = services.sales;
const getCollectionService = services.collections;
const getMarketingService = services.marketing;
const getCompanyService = services.company;
const getSettingsService = services.settings;
const getNumberingService = services.numbering;

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

/**
 * Turn a bearer access token into an actor (`SEC-013`, `SEC-020`).
 *
 * The token's signature is not enough: `resolveSession` re-reads the session and the account on every
 * request, so a revoked session or a changed password stops working immediately. Anything wrong with the
 * token yields **no actor**, and the guard then answers 401 — never a partially trusted request.
 */
const actorResolver: ActorResolver = async (req) => {
  const header = req.get('authorization');
  if (!header || !/^Bearer /.test(header)) return undefined;
  const token = header.slice(7).trim();
  if (!token) return undefined;
  try {
    return (await getIdentityService().resolveSession(token))?.actor;
  } catch {
    return undefined;
  }
};

const identityRouterOptions = {
  getService: getIdentityService,
  cookiePolicy,
  guard,
};

const modules: ApiModule[] = [
  { basePath: '/approvals', router: approvalRouter({ getService: getApprovalService, guard }) },
  { basePath: '/audit', router: auditRouter({ getService: getAuditService, guard }) },
  {
    basePath: '/organization',
    router: organizationRouter({ getService: getOrganizationService, guard }),
  },
  { basePath: '/inventory', router: inventoryRouter({ getService: getInventoryService, guard }) },
  { basePath: '/crm', router: crmRouter({ getService: getCrmService, guard }) },
  { basePath: '/sales', router: salesRouter({ getService: getSalesService, guard }) },
  {
    basePath: '/collections',
    router: collectionRouter({ getService: getCollectionService, guard }),
  },
  { basePath: '/marketing', router: marketingRouter({ getService: getMarketingService, guard }) },
  { basePath: '/company', router: companyRouter({ getService: getCompanyService, guard }) },
  // Public and read-only: what the sign-in screen needs before anyone has signed in (PLAT-023).
  { basePath: '/branding', router: brandingRouter({ getService: getCompanyService }) },
  { basePath: '/settings', router: settingsRouter({ getService: getSettingsService, guard }) },
  { basePath: '/numbering', router: numberingRouter({ getService: getNumberingService, guard }) },
  {
    basePath: '/notifications',
    router: notificationRouter({ getService: services.notifications, guard }),
  },
  { basePath: '/tasks', router: taskRouter({ getService: services.tasks, guard }) },
  {
    basePath: '/documents',
    router: documentRouter({
      getDocuments: services.documents,
      getTemplates: services.templates,
      guard,
    }),
  },
  {
    basePath: '/templates',
    router: templateRouter({
      getDocuments: services.documents,
      getTemplates: services.templates,
      guard,
    }),
  },
  // Signed file delivery exists only for the local store; object storage serves its own links.
  ...(services.fileStore instanceof LocalDiskFileStore
    ? [{ basePath: '/files' as const, router: fileRouter({ store: services.fileStore }) }]
    : []),
  {
    basePath: '/reference-data',
    router: referenceDataRouter({ getService: getSettingsService, guard }),
  },
  { basePath: '/auth', router: authRouter(identityRouterOptions) },
  { basePath: '/me', router: meRouter(identityRouterOptions) },
  { basePath: '/security', router: securityRouter({ getService: getSecurityService, guard }) },
  // Mounted at the same base path: account administration lives beside role and grant administration.
  { basePath: '/security', router: accountAdminRouter(identityRouterOptions) },
];

const app = createApp({ config, logger, mongo, redis, rateLimiter, modules, actorResolver });

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
