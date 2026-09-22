/**
 * Seed the local development database with the demonstration data set.
 *
 *   npm run dev:services:up
 *   npm run seed:demo
 *
 * It refuses to run anywhere that is not obviously a local development database (`guard.ts`), it is
 * idempotent (`ledger.ts`), and it writes the generated passwords to `.demo-credentials.md`, which
 * is ignored by Git. **No password or token is ever printed here or written to a log.**
 *
 * To remove what it created: `npm run seed:demo:reset -- --confirm`.
 */
import { ConfigError, assertUtcRuntime, loadApiConfig, loadDotEnvIfPresent } from '@alola/config';
import { createLogger } from '@alola/security';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { createDomainServices } from '../../apps/api/src/platform/domain-services';
import { ensureIndexes } from '../../apps/api/src/platform/indexes';
import { configureMongoose } from '../../apps/api/src/platform/mongo';
import { seedBusiness } from './business';
import { CREDENTIALS_FILE, writeCredentialsFile } from './credentials';
import { SeedRefusedError, assertSeedAllowed } from './guard';
import { seedFoundation } from './seed';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

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
if (!config.AUTH_TOKEN_SIGNING_SECRET) {
  fail('AUTH_TOKEN_SIGNING_SECRET must be set before any account can be created.');
}
if (!config.KMS_KEY_ID && !config.DEV_ENCRYPTION_KEY) {
  fail(
    'DEV_ENCRYPTION_KEY must be set: the administrator account enrols a second factor (SEC-017),\n' +
      'and its secret is stored encrypted. See .env.example.',
  );
}

try {
  assertSeedAllowed({
    appEnv: config.APP_ENV,
    databaseName: config.MONGODB_DB_NAME,
    mongoUri: config.MONGODB_URI,
  });
} catch (error) {
  if (error instanceof SeedRefusedError) {
    fail(`Refused to seed.\n  ${error.reason}`);
  }
  throw error;
}

const logger = createLogger({ name: 'seed-demo', level: config.LOG_LEVEL });
const correlationId = `seed-demo-${randomUUID()}`;

configureMongoose();
const connection = mongoose.createConnection(config.MONGODB_URI, {
  dbName: config.MONGODB_DB_NAME,
  serverSelectionTimeoutMS: 10_000,
});

try {
  await connection.asPromise();
  await ensureIndexes(connection, logger);

  const services = createDomainServices({
    config,
    logger,
    requireConnection: () => connection,
  });

  const started = Date.now();
  const foundation = await seedFoundation({
    connection,
    services,
    logger,
    timeZone: config.ORG_TIMEZONE,
    totpIssuer: config.AUTH_TOTP_ISSUER,
    correlationId,
  });
  const counts = await seedBusiness({ services, foundation, logger, correlationId });

  writeCredentialsFile(repositoryRoot, foundation.credentials, {
    databaseName: config.MONGODB_DB_NAME,
    generatedAt: new Date().toISOString(),
    webUrl: 'http://localhost:5173',
  });

  console.log('');
  console.log('Demonstration data ready.');
  console.log(`  database : ${config.MONGODB_DB_NAME}`);
  console.log(`  elapsed  : ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log('');
  const widest = Math.max(...Object.keys(counts).map((key) => key.length));
  for (const [kind, row] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(
      `  ${kind.padEnd(widest)}  created ${String(row.created).padStart(3)}   already present ${String(row.existing).padStart(3)}`,
    );
  }
  console.log('');
  console.log(`Credentials written to  ${CREDENTIALS_FILE}  (ignored by Git, not printed here).`);
  console.log(
    'Open it to sign in. Run this command again and it changes nothing but the passwords.',
  );
  console.log('');
  console.log('To remove the demonstration data:  npm run seed:demo:reset -- --confirm');
  console.log('');
} catch (error) {
  logger.error({ err: error }, 'seeding failed');
  fail('Seeding failed. Re-run it once the cause is fixed — it resumes rather than duplicating.');
} finally {
  await connection.close();
}
