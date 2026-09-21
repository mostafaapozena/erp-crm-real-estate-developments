/**
 * Create the first security account (`SEC-011`, `SEC-012`).
 *
 *   BOOTSTRAP_ADMIN_EMAIL=someone@example.com npm run bootstrap:admin
 *
 * Why a script and not an endpoint: there is **no default administrator and no hard-coded password**
 * anywhere in this repository, and no public self-registration. Someone with database access runs this
 * once, and the first human chooses the first password through the ordinary activation flow.
 *
 * What it does, deliberately in this order:
 *
 * 1. Refuses if **any** account already exists, so it cannot be used to mint a second super-user later.
 * 2. Creates an `invited` account with **no password** and prints its activation token once. The token is
 *    short-lived and single-use; it is the only secret this script emits, and it grants nothing until the
 *    holder sets a password.
 * 3. Writes the bootstrap role and grant **directly through the models**, because the guarded service
 *    would require an actor that does not exist yet. That is the one deliberate exception to
 *    "authorization is always checked", and it is available only to someone who already holds database
 *    credentials — the same trust level as the database itself. It is never reachable over HTTP.
 *
 * The account it creates holds every permission, which means `SEC-017` requires it to enrol a second
 * factor at its first sign-in.
 */
import { ConfigError, assertUtcRuntime, loadApiConfig, loadDotEnvIfPresent } from '@alola/config';
import { PERMISSIONS, normalizeLoginIdentifier } from '@alola/contracts';
import {
  DevKeyEncryptor,
  PasswordHasher,
  TokenIssuer,
  UnconfiguredEncryptor,
  createLogger,
  type Encryptor,
} from '@alola/security';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { AuditService } from '../apps/api/src/modules/audit/index';
import { IdentityService, AuthThrottle } from '../apps/api/src/modules/identity/index';
import { accountGrantModel, roleModel } from '../apps/api/src/modules/security/model';
import { ensureIndexes } from '../apps/api/src/platform/indexes';
import { configureMongoose } from '../apps/api/src/platform/mongo';

const BOOTSTRAP_ROLE_KEY = 'bootstrap-administrator';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
loadDotEnvIfPresent(repositoryRoot);

let config: ReturnType<typeof loadApiConfig>;
try {
  config = loadApiConfig();
  assertUtcRuntime();
} catch (error) {
  if (error instanceof ConfigError) fail(error.message);
  throw error;
}

const email = process.env['BOOTSTRAP_ADMIN_EMAIL']?.trim();
if (!email) {
  fail(
    'BOOTSTRAP_ADMIN_EMAIL is required.\n' +
      '  Example: BOOTSTRAP_ADMIN_EMAIL=someone@example.com npm run bootstrap:admin',
  );
}
const displayName = process.env['BOOTSTRAP_ADMIN_NAME']?.trim() ?? email;

if (!config.MONGODB_URI || !config.MONGODB_DB_NAME) {
  fail('MONGODB_URI and MONGODB_DB_NAME must be set: the account is stored in the database.');
}
if (!config.AUTH_TOKEN_SIGNING_SECRET) {
  fail('AUTH_TOKEN_SIGNING_SECRET must be set before any account can sign in.');
}

const logger = createLogger({ name: 'bootstrap', level: config.LOG_LEVEL });

function buildEncryptor(): Encryptor {
  if (!config.KMS_KEY_ID && config.DEV_ENCRYPTION_KEY) {
    return new DevKeyEncryptor(config.APP_ENV, config.DEV_ENCRYPTION_KEY);
  }
  return new UnconfiguredEncryptor();
}

configureMongoose();
const connection = mongoose.createConnection(config.MONGODB_URI, {
  dbName: config.MONGODB_DB_NAME,
  serverSelectionTimeoutMS: 10_000,
});

try {
  await connection.asPromise();
  await ensureIndexes(connection, logger);

  const audit = new AuditService({ connection, logger });
  const identity = new IdentityService({
    connection,
    logger,
    audit,
    hasher: new PasswordHasher({
      memoryCost: config.ARGON2_MEMORY_COST,
      timeCost: config.ARGON2_TIME_COST,
      parallelism: config.ARGON2_PARALLELISM,
    }),
    tokens: new TokenIssuer({
      secret: config.AUTH_TOKEN_SIGNING_SECRET,
      issuer: 'alola-erp-api',
      audience: 'alola-erp',
      accessTokenTtlSeconds: config.AUTH_ACCESS_TOKEN_TTL_SECONDS,
      mfaChallengeTtlSeconds: config.AUTH_MFA_CHALLENGE_TTL_SECONDS,
    }),
    encryptor: buildEncryptor(),
    throttle: new AuthThrottle(),
    // No grants exist yet, which is exactly why the role and grant below are written directly.
    resolveGrants: () => Promise.resolve(undefined),
    ttl: {
      sessionIdleSeconds: config.AUTH_SESSION_IDLE_TIMEOUT_SECONDS,
      sessionAbsoluteSeconds: config.AUTH_SESSION_ABSOLUTE_TIMEOUT_SECONDS,
      activationSeconds: config.AUTH_ACTIVATION_TOKEN_TTL_SECONDS,
      passwordResetSeconds: config.AUTH_PASSWORD_RESET_TTL_SECONDS,
    },
    totpIssuer: config.AUTH_TOTP_ISSUER,
  });

  const created = await identity.createBootstrapAccount(
    { loginIdentifier: normalizeLoginIdentifier(email), displayName },
    {
      correlationId: `bootstrap-${Date.now()}`,
      method: 'CLI',
      route: 'scripts/bootstrap-admin.ts',
    },
  );

  const now = new Date();
  await roleModel(connection).updateOne(
    { key: BOOTSTRAP_ROLE_KEY },
    {
      $set: {
        key: BOOTSTRAP_ROLE_KEY,
        name: { ar: 'مسؤول التهيئة', en: 'bootstrap administrator' },
        permissions: [...PERMISSIONS].sort(),
        isAdministrative: true,
        version: 1,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
  await accountGrantModel(connection).updateOne(
    { accountId: created.account.accountId },
    {
      $set: {
        accountId: created.account.accountId,
        roleKeys: [BOOTSTRAP_ROLE_KEY],
        deniedPermissions: [],
        scope: {
          level: 'all',
          teamIds: [],
          departmentIds: [],
          branchIds: [],
          projectIds: [],
          legalEntityIds: [],
        },
        version: 1,
        updatedAt: now,
        updatedBy: 'system:bootstrap',
      },
    },
    { upsert: true },
  );

  // The activation token is printed once, here, to the operator who ran the script. It is not logged.
  console.log('');
  console.log('First security account created.');
  console.log(`  account id      : ${created.account.accountId}`);
  console.log(`  login identifier: ${created.account.loginIdentifier}`);
  console.log(`  state           : ${created.account.state} (no password is set yet)`);
  console.log(`  role            : ${BOOTSTRAP_ROLE_KEY} (every permission, data scope "all")`);
  console.log('');
  console.log('Activation token — shown once, single use, expires');
  console.log(`  ${created.activationExpiresAt.toISOString()}:`);
  console.log('');
  console.log(`  ${created.activationToken}`);
  console.log('');
  console.log('Complete it with:');
  console.log(
    '  POST /api/v1/auth/activate  { "token": "<the token above>", "password": "<chosen>" }',
  );
  console.log('');
  console.log('This account holds administrative permissions, so its first sign-in will require');
  console.log(
    'enrolling a second factor (SEC-017). Review the bootstrap role afterwards and replace',
  );
  console.log('it with the roles approved under SD-02.');
} catch (error) {
  const code = (error as { code?: string }).code;
  if (code === 'CONFLICT') {
    fail(
      'Refused: an account already exists.\n' +
        '  The bootstrap path runs once. Create further accounts through\n' +
        '  POST /api/v1/security/accounts with the security.account.create permission.',
    );
  }
  logger.error({ err: error }, 'bootstrap failed');
  fail('Bootstrap failed. Nothing was printed above, so nothing was created.');
} finally {
  await connection.close();
}
