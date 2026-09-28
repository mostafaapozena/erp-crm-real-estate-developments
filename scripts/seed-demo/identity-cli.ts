/**
 * Apply the demonstration company identity to an **existing** demonstration database.
 *
 *   npm run seed:demo:identity
 *
 * `npm run seed:demo` does this on a fresh database. This command exists for a database seeded before
 * the identity existed: it changes the identity and nothing else — it does not re-seed, does not
 * reset a password or a second factor, and does not touch a business record other than the one
 * campaign headline that named the superseded company.
 *
 * What it writes, all through the product's services and audited:
 *
 * 1. the demonstration administrator role, re-bootstrapped from `roles.ts` so it holds
 *    `company.profile.view` and `company.profile.manage` (the documented bootstrap path);
 * 2. the company profile, **only if none exists**;
 * 3. the demonstration legal entity's name, **only while it still carries the superseded name**;
 * 4. the one campaign headline, **only while it still names the superseded company**.
 *
 * It refuses exactly where the seed refuses (`guard.ts`). Nothing secret is printed.
 */
import { ConfigError, assertUtcRuntime, loadApiConfig, loadDotEnvIfPresent } from '@alola/config';
import { createLogger } from '@alola/security';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { bootstrapRole } from '../../apps/api/src/modules/security';
import { createDomainServices } from '../../apps/api/src/platform/domain-services';
import { configureMongoose } from '../../apps/api/src/platform/mongo';
import { SeedRefusedError, assertSeedAllowed } from './guard';
import { applyDemoIdentity } from './identity';
import { SeedLedger } from './ledger';
import { DEMO_ROLES } from './roles';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const ADMIN_ROLE = 'demo-system-administrator';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
loadDotEnvIfPresent(repositoryRoot);

let config: ReturnType<typeof loadApiConfig>;
try {
  config = loadApiConfig();
  assertUtcRuntime();
} catch (error) {
  if (error instanceof ConfigError) fail(error.message);
  throw error;
}
if (!config.MONGODB_URI || !config.MONGODB_DB_NAME) {
  fail(
    'MONGODB_URI and MONGODB_DB_NAME must be set. Start the services with: npm run dev:services:up',
  );
}
try {
  assertSeedAllowed({
    appEnv: config.APP_ENV,
    databaseName: config.MONGODB_DB_NAME,
    mongoUri: config.MONGODB_URI,
  });
} catch (error) {
  if (error instanceof SeedRefusedError) fail(`Refused.\n  ${error.reason}`);
  throw error;
}

const logger = createLogger({ name: 'seed-demo-identity', level: config.LOG_LEVEL });
const context = {
  correlationId: `seed-demo-identity-${randomUUID()}`,
  method: 'CLI',
  route: 'scripts/seed-demo/identity',
};

configureMongoose();
const connection = mongoose.createConnection(config.MONGODB_URI, {
  dbName: config.MONGODB_DB_NAME,
  serverSelectionTimeoutMS: 10_000,
});

try {
  await connection.asPromise();
  const ledger = new SeedLedger(connection);
  await ledger.load();
  const adminAccount = ledger.existing('account:admin');
  const marketingAccount = ledger.existing('account:marketing');
  if (!adminAccount || !marketingAccount) {
    fail('This database holds no demonstration accounts. Seed it first: npm run seed:demo');
  }

  const role = DEMO_ROLES.find((candidate) => candidate.key === ADMIN_ROLE);
  if (!role) fail(`role ${ADMIN_ROLE} is missing from roles.ts`);
  await bootstrapRole(connection, {
    key: role.key,
    name: role.name,
    permissions: role.permissions,
    isAdministrative: true,
  });

  const services = createDomainServices({ config, logger, requireConnection: () => connection });
  const security = services.security();
  const admin = await security.resolveActor(adminAccount);
  const marketing = await security.resolveActor(marketingAccount);
  if (!admin || !marketing) fail('The demonstration accounts resolved to no grants.');

  const report = await applyDemoIdentity({
    services,
    admin,
    marketing,
    ledger,
    timeZone: config.ORG_TIMEZONE,
    context,
  });

  console.log('');
  console.log('Demonstration identity applied.');
  console.log(`  database          : ${config.MONGODB_DB_NAME}`);
  console.log(`  administrator role: re-bootstrapped (${ADMIN_ROLE})`);
  console.log(`  company profile   : ${report.companyProfile}`);
  console.log(`  legal entity      : ${report.legalEntity}`);
  console.log(`  campaign headline : ${report.campaignHeadline}`);
  console.log('');
} catch (error) {
  logger.error({ err: error }, 'applying the demonstration identity failed');
  fail('Applying the demonstration identity failed. Nothing was deleted; re-run once fixed.');
} finally {
  await connection.close();
}
