/**
 * Initialize a client deployment from its file (OPS-005).
 *
 *   npm run client:init -- --file /secure/path/client.json --check   # validate only; touches nothing
 *   npm run client:init -- --file /secure/path/client.json           # create what is missing
 *
 * Idempotent: run it again and every item reads `exists`. It never overwrites and never deletes; an
 * item that differs from the file is reported, and changed through the product. It refuses a
 * database holding the demonstration data and a database with pending migrations. The first
 * administrator is created separately with `npm run bootstrap:admin`, which refuses to run twice.
 *
 * The client file holds company registration details: keep it with the deployment's records, never
 * in this repository. See `docs/operations/client-deployment-checklist.md`.
 */
import { ConfigError, assertUtcRuntime, loadApiConfig, loadDotEnvIfPresent } from '@alola/config';
import { ClientInitFileSchema } from '@alola/contracts';
import { createLogger } from '@alola/security';
import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClientInitRefused, initializeClient } from '../apps/api/src/platform/client-init';
import { createDomainServices } from '../apps/api/src/platform/domain-services';
import { ensureIndexes } from '../apps/api/src/platform/indexes';
import { MIGRATIONS } from '../apps/api/src/platform/migration-list';
import { MigrationRunner } from '../apps/api/src/platform/migrations';
import { configureMongoose } from '../apps/api/src/platform/mongo';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
const filePath = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
if (!filePath) fail('Usage: npm run client:init -- --file <client.json> [--check]');

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(resolve(filePath), 'utf8'));
} catch {
  fail('The client file could not be read as JSON.');
}
const parsed = ClientInitFileSchema.safeParse(raw);
if (!parsed.success) {
  // Paths and codes only — never the values, which are the client's registration details.
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.') || '(file)'}: ${issue.message}`);
  }
  fail('The client file is not valid; nothing was changed.');
}
if (args.includes('--check')) {
  console.log(
    `Client file valid: ${String(parsed.data.legalEntities.length)} legal entities, ` +
      `${String(parsed.data.legalEntities.reduce((sum, entity) => sum + entity.branches.length, 0))} branches.`,
  );
  process.exit(0);
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
if (!config.MONGODB_URI || !config.MONGODB_DB_NAME) {
  fail('MONGODB_URI and MONGODB_DB_NAME must be set.');
}

const logger = createLogger({ name: 'client-init', level: config.LOG_LEVEL });
configureMongoose();
const connection = mongoose.createConnection(config.MONGODB_URI, {
  dbName: config.MONGODB_DB_NAME,
});
try {
  await connection.asPromise();
  await ensureIndexes(connection, logger);
  const services = createDomainServices({
    config,
    logger,
    requireConnection: () => connection,
    repositoryRoot,
  });
  const runner = new MigrationRunner(connection, MIGRATIONS, { logger });
  const steps = await initializeClient(
    {
      connection,
      company: services.company(),
      organization: services.organization(),
      pendingMigrations: async () => (await runner.status()).pending,
    },
    parsed.data,
    {
      correlationId: `client-init-${String(Date.now())}`,
      method: 'CLI',
      route: 'scripts/client-init.ts',
    },
  );
  for (const step of steps) {
    console.log(
      `  ${step.outcome.padEnd(8)} ${step.item}${step.fields ? ` (${step.fields.join(', ')})` : ''}`,
    );
  }
  if (steps.some((step) => step.outcome === 'differs')) {
    console.log(
      '\nItems marked "differs" were left as they are. Change them in the product if intended.',
    );
  }
  console.log(
    '\nNext: npm run bootstrap:admin (once), then configure roles, numbering and reference data.',
  );
} catch (error) {
  if (error instanceof ClientInitRefused) fail(error.message);
  throw error;
} finally {
  await connection.close();
}
