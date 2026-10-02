/**
 * Give an **existing** demonstration database what the BMP-1 commercial journey needs for
 * user-acceptance testing (BMP-1 package 8):
 *
 *   npm run seed:demo:bmp1
 *
 * A fresh `npm run seed:demo` already creates all of this. This command exists for a database seeded
 * earlier, and it changes **only** that:
 *
 * - for each demonstration role, the BMP-1 permissions `roles.ts` lists for it (`BMP1_ADDITIONS`) are
 *   **added** to what the role holds now; nothing is removed, so a permission an administrator granted
 *   since the seed survives, and a role that already holds them is reported `unchanged`;
 * - each change is audited as a system action (`security.role.permissionsAdded`) with the permissions
 *   before and after;
 * - the demonstration settings a reservation needs (`DEMO_SETTINGS`, today only
 *   `sales.reservationValidityDays`) are set **only when not configured**, through the settings
 *   service, as the system actor, with a reason that says the decision (`BD-01`) is still open. A value
 *   configured by anyone is never overwritten, and existing reservations keep their dates.
 *
 * It re-seeds nothing, resets no password or second factor and changes no business record. It refuses
 * exactly where the seed refuses (`guard.ts`). These are demonstration roles, not `SD-02`.
 */
import {
  ActorContextSchema,
  ScopeAssignmentSchema,
  type ActorContext,
  type Permission,
} from '@alola/contracts';
import { ConfigError, assertUtcRuntime, loadApiConfig, loadDotEnvIfPresent } from '@alola/config';
import { buildChangeSummary, createLogger } from '@alola/security';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { bootstrapRole } from '../../apps/api/src/modules/security';
import { createDomainServices } from '../../apps/api/src/platform/domain-services';
import { configureMongoose } from '../../apps/api/src/platform/mongo';
import { DEMO_SETTINGS } from './business';
import { SeedRefusedError, assertSeedAllowed } from './guard';
import { SeedLedger } from './ledger';
import { BMP1_ADDITIONS, DEMO_ROLES } from './roles';

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

const logger = createLogger({ name: 'seed-demo-bmp1', level: config.LOG_LEVEL });
const context = {
  correlationId: `seed-demo-bmp1-${randomUUID()}`,
  method: 'CLI',
  route: 'scripts/seed-demo/bmp1',
};
/** The script itself, as the seed's own system actor: audit records say a script did this. */
const SYSTEM: ActorContext = ActorContextSchema.parse({
  accountId: 'system:seed-demo',
  kind: 'system',
  roleKeys: ['seed'],
  permissions: ['settings.view', 'settings.manage'],
  scope: ScopeAssignmentSchema.parse({ level: 'all' }),
});

configureMongoose();
const connection = mongoose.createConnection(config.MONGODB_URI, {
  dbName: config.MONGODB_DB_NAME,
  serverSelectionTimeoutMS: 10_000,
});

try {
  await connection.asPromise();
  const ledger = new SeedLedger(connection);
  await ledger.load();
  if (!ledger.existing('account:admin')) {
    fail('This database holds no demonstration accounts. Seed it first: npm run seed:demo');
  }
  const services = createDomainServices({ config, logger, requireConnection: () => connection });
  const audit = services.audit();
  const roles = connection.collection<{
    key: string;
    name: { ar: string; en: string };
    permissions: Permission[];
    isAdministrative?: boolean;
  }>('roles');

  const report: string[] = [];
  for (const role of DEMO_ROLES) {
    const wanted = BMP1_ADDITIONS[role.key] ?? [];
    const stored = await roles.findOne({ key: role.key });
    if (!stored) {
      report.push(`  ${role.key.padEnd(28)}: absent (not created here)`);
      continue;
    }
    const missing = wanted.filter((permission) => !stored.permissions.includes(permission));
    if (missing.length === 0) {
      report.push(`  ${role.key.padEnd(28)}: unchanged`);
      continue;
    }
    const permissions = [...stored.permissions, ...missing];
    await bootstrapRole(connection, {
      key: stored.key,
      name: stored.name,
      permissions,
      isAdministrative: stored.isAdministrative ?? false,
    });
    await audit.record({
      action: 'security.role.permissionsAdded',
      outcome: 'succeeded',
      actor: { kind: 'system', accountId: 'system:seed-demo' },
      target: { type: 'role', id: stored.key },
      reason: 'demonstration roles: BMP-1 commercial permissions for package 8 UAT',
      changes: buildChangeSummary(
        { permissions: [...stored.permissions].sort() },
        { permissions: [...permissions].sort() },
      ),
      context,
    });
    report.push(`  ${role.key.padEnd(28)}: added ${missing.join(', ')}`);
  }

  const settings = services.settings();
  const settingReport: string[] = [];
  for (const entry of DEMO_SETTINGS) {
    const current = await settings.getSetting(entry.key);
    if (current.configured) {
      settingReport.push(
        `  ${entry.key.padEnd(34)}: unchanged (configured: ${JSON.stringify(current.value)})`,
      );
      continue;
    }
    await settings.updateSetting(
      SYSTEM,
      entry.key,
      {
        value: entry.value,
        expectedVersion: current.version,
        reason: `demonstration value — ${entry.decision} open, not a business decision`,
      },
      context,
    );
    settingReport.push(
      `  ${entry.key.padEnd(34)}: set to ${String(entry.value)} (${entry.decision} open)`,
    );
  }

  console.log('');
  console.log('Demonstration BMP-1 configuration applied.');
  console.log(`  database: ${config.MONGODB_DB_NAME}`);
  console.log('Roles:');
  for (const line of report) console.log(line);
  console.log('Settings:');
  for (const line of settingReport) console.log(line);
  console.log('');
} catch (error) {
  logger.error({ err: error }, 'applying the demonstration BMP-1 configuration failed');
  fail('Applying the BMP-1 configuration failed. Nothing was deleted; re-run once fixed.');
} finally {
  await connection.close();
}
