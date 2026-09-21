import { ConfigError, assertUtcRuntime, loadApiConfig, loadDotEnvIfPresent } from '@alola/config';
import {
  DevKeyEncryptor,
  PasswordHasher,
  TokenIssuer,
  UnconfiguredEncryptor,
  createLogger,
  type Encryptor,
} from '@alola/security';
import { fileURLToPath } from 'node:url';
import { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import { createApp, type ApiModule } from './app';
import { AUDIT_ACTIONS } from '@alola/contracts';
import { noteAuditWrite } from './http/audit-context';
import { ApprovalService, approvalRouter } from './modules/approval';
import { AuditService, auditRouter } from './modules/audit';
import {
  AuthThrottle,
  IdentityService,
  accountAdminRouter,
  authRouter,
  cookiePolicyFor,
  meRouter,
} from './modules/identity';
import { SecurityService, securityRouter } from './modules/security';
import type { ActorResolver } from './http/actor';
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
let identityService: IdentityService | undefined;
let approvalService: ApprovalService | undefined;

/**
 * Encryption for MFA secrets (`SEC-017`).
 *
 * `SEC-033` (a KMS adapter) is **not implemented**. When `KMS_KEY_ID` is set the unconfigured encryptor
 * fails loudly rather than pretending a managed key is in use; development and test use a configured
 * local key so that an enrolment survives a restart (ADR-0023).
 */
function buildEncryptor(): Encryptor {
  if (!config.KMS_KEY_ID && config.DEV_ENCRYPTION_KEY) {
    return new DevKeyEncryptor(config.APP_ENV, config.DEV_ENCRYPTION_KEY);
  }
  return new UnconfiguredEncryptor();
}

const passwordHasher = new PasswordHasher({
  memoryCost: config.ARGON2_MEMORY_COST,
  timeCost: config.ARGON2_TIME_COST,
  parallelism: config.ARGON2_PARALLELISM,
});
const authThrottle = new AuthThrottle(redis.client ?? undefined);
const cookiePolicy = cookiePolicyFor(config.APP_ENV);

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

/**
 * The approval engine (`APPROVAL-001` … `APPROVAL-007`).
 *
 * Two ports are deliberately left unconfigured here:
 *
 * - `resolveManager` — the reporting line belongs to `CORE-ORG` (Phase 2, `SD-01`). Until it exists,
 *   escalation reports an overdue stage as **unresolved** rather than inventing a manager (`APPROVAL-005`).
 * - `events` — `CORE-NOTIFY` and `CORE-TASK` are separate groups. The engine is correct with nothing
 *   listening, so there is no null implementation to pretend otherwise.
 */
function getApprovalService(): ApprovalService {
  const connection = requireConnection();
  approvalService ??= new ApprovalService({
    connection,
    logger,
    audit: getAuditService(),
    accountsWithPermission: (permission) => getSecurityService().accountsWithPermission(permission),
    resolveActor: (accountId) => getSecurityService().resolveActor(accountId),
  });
  return approvalService;
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

/**
 * Authentication needs a signing key. Without one the routes answer `SERVICE_NOT_CONFIGURED` exactly as
 * they do without a database, instead of falling back to a built-in key (ADR-0012, ADR-0023).
 */
function getIdentityService(): IdentityService {
  const connection = requireConnection();
  if (!config.AUTH_TOKEN_SIGNING_SECRET) {
    throw new AppError('SERVICE_NOT_CONFIGURED', 503);
  }
  identityService ??= new IdentityService({
    connection,
    logger,
    audit: getAuditService(),
    hasher: passwordHasher,
    tokens: new TokenIssuer({
      secret: config.AUTH_TOKEN_SIGNING_SECRET,
      issuer: 'alola-erp-api',
      audience: 'alola-erp',
      accessTokenTtlSeconds: config.AUTH_ACCESS_TOKEN_TTL_SECONDS,
      mfaChallengeTtlSeconds: config.AUTH_MFA_CHALLENGE_TTL_SECONDS,
    }),
    encryptor: buildEncryptor(),
    throttle: authThrottle,
    // Grants come from the SEC authorization module; identity never reads that storage itself.
    resolveGrants: (accountId) => getSecurityService().resolveActor(accountId),
    ttl: {
      sessionIdleSeconds: config.AUTH_SESSION_IDLE_TIMEOUT_SECONDS,
      sessionAbsoluteSeconds: config.AUTH_SESSION_ABSOLUTE_TIMEOUT_SECONDS,
      activationSeconds: config.AUTH_ACTIVATION_TOKEN_TTL_SECONDS,
      passwordResetSeconds: config.AUTH_PASSWORD_RESET_TTL_SECONDS,
    },
    totpIssuer: config.AUTH_TOTP_ISSUER,
  });
  return identityService;
}

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
