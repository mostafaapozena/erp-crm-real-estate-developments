/**
 * Apply pending schema migrations, or report their status (OPS-004).
 *
 *   npm run db:migrate:status        # read-only: database version, pending, changed, unknown
 *   npm run db:migrate               # apply pending migrations (development and test)
 *   npm run db:migrate -- --confirm  # required in staging and production
 *
 * Indexes are created first (the same `ensureIndexes` the API runs at startup), then migrations run
 * in order under a lock. Nothing here deletes data, and nothing prints a connection string or secret.
 * See `docs/operations/migrations-and-upgrades.md`.
 */
import { ConfigError, assertUtcRuntime, loadApiConfig, loadDotEnvIfPresent } from '@alola/config';
import { createLogger } from '@alola/security';
import mongoose from 'mongoose';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ensureIndexes } from '../apps/api/src/platform/indexes';
import { MIGRATIONS } from '../apps/api/src/platform/migration-list';
import { MigrationError, MigrationRunner } from '../apps/api/src/platform/migrations';
import { configureMongoose } from '../apps/api/src/platform/mongo';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const statusOnly = args.has('--status');

loadDotEnvIfPresent(fileURLToPath(new URL('../', import.meta.url)));
let config: ReturnType<typeof loadApiConfig>;
try {
  config = loadApiConfig();
  assertUtcRuntime();
} catch (error) {
  if (error instanceof ConfigError) fail(error.message);
  throw error;
}
if (!config.MONGODB_URI || !config.MONGODB_DB_NAME)
  fail('MONGODB_URI and MONGODB_DB_NAME must be set.');
const live = config.APP_ENV === 'staging' || config.APP_ENV === 'production';
if (!statusOnly && live && !args.has('--confirm')) {
  fail(
    `APP_ENV=${config.APP_ENV}: re-run with --confirm after taking a backup (see the upgrade runbook).`,
  );
}

const logger = createLogger({ name: 'db-migrate', level: config.LOG_LEVEL });
configureMongoose();
const connection = mongoose.createConnection(config.MONGODB_URI, {
  dbName: config.MONGODB_DB_NAME,
});
try {
  await connection.asPromise();
  const runner = new MigrationRunner(connection, MIGRATIONS, { logger });
  if (!statusOnly) await ensureIndexes(connection, logger);
  const before = await runner.status();
  if (statusOnly) {
    console.log(JSON.stringify(before, null, 2));
    process.exitCode = before.changed.length > 0 || before.unknown.length > 0 ? 2 : 0;
  } else {
    const result = await runner.migrate(`${hostname()}:${String(process.pid)}`);
    const after = await runner.status();
    console.log(
      JSON.stringify({ applied: result.applied, databaseVersion: after.databaseVersion }, null, 2),
    );
  }
} catch (error) {
  if (error instanceof MigrationError) fail(`${error.code}: ${error.message}`);
  throw error;
} finally {
  await connection.close();
}
