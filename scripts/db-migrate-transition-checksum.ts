/**
 * One-time move of a development database's migration checksum to the build-stable form (OPS-004).
 *
 *   npm run db:migrate:transition-checksum -- --show
 *     # no database access: prints each migration of this build with the checksum it computes
 *   npm run db:migrate:transition-checksum -- --migration <id> --from <old> --to <new>
 *     # development only: compare-and-set of that one row's checksum
 *
 * Until the checksum became build-stable, it hashed the migration function's text, which differs
 * between `tsx` and the production bundle. A development database migrated before the change carries
 * the old value. This moves exactly that value and nothing else — see `transitionMigrationChecksum`
 * and `docs/operations/migrations-and-upgrades.md`. It refuses staging and production, never runs a
 * migration, and prints only the migration identifier and the outcome.
 */
import { ConfigError, assertUtcRuntime, loadApiConfig, loadDotEnvIfPresent } from '@alola/config';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS } from '../apps/api/src/platform/migration-list';
import {
  MigrationError,
  migrationChecksum,
  transitionMigrationChecksum,
} from '../apps/api/src/platform/migrations';
import { configureMongoose } from '../apps/api/src/platform/mongo';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const argv = process.argv.slice(2);
if (argv.includes('--show')) {
  console.log(
    JSON.stringify(
      MIGRATIONS.map((migration) => ({
        migrationId: migration.id,
        checksum: migrationChecksum(migration),
      })),
      null,
      2,
    ),
  );
  process.exit(0);
}
const option = (name: string): string => {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) fail(`Missing ${name} <value>.`);
  return value;
};
const migrationId = option('--migration');
const fromChecksum = option('--from');
const toChecksum = option('--to');

loadDotEnvIfPresent(fileURLToPath(new URL('../', import.meta.url)));
let config: ReturnType<typeof loadApiConfig>;
try {
  config = loadApiConfig();
  assertUtcRuntime();
} catch (error) {
  if (error instanceof ConfigError) fail(error.message);
  throw error;
}
if (config.APP_ENV !== 'development') {
  fail(`APP_ENV=${config.APP_ENV}: the checksum transition runs on development databases only.`);
}
if (!config.MONGODB_URI || !config.MONGODB_DB_NAME)
  fail('MONGODB_URI and MONGODB_DB_NAME must be set.');

configureMongoose();
const connection = mongoose.createConnection(config.MONGODB_URI, {
  dbName: config.MONGODB_DB_NAME,
});
try {
  await connection.asPromise();
  const result = await transitionMigrationChecksum(connection, MIGRATIONS, {
    appEnv: config.APP_ENV,
    migrationId,
    fromChecksum,
    toChecksum,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (error instanceof MigrationError) fail(`${error.code}: ${error.message}`);
  throw error;
} finally {
  await connection.close();
}
