/**
 * Give the demonstration roles of an **existing** demonstration database the issued-document
 * permissions of package 7 (CORE-DOC-003, CORE-DOC-005), for user-acceptance testing.
 *
 *   npm run seed:demo:documents
 *
 * A fresh `npm run seed:demo` already creates the roles with these permissions (`roles.ts`). This
 * command exists for a database seeded before them, and it changes **only** that:
 *
 * - for each demonstration role, the document permissions `roles.ts` lists for it (and, for the
 *   administrator, the read permissions of every document source, without which it cannot revoke
 *   one) are **added** to what the role holds now; nothing is removed, so a permission an administrator granted since the
 *   seed survives;
 * - a role that already holds them is left untouched, so a second run reports `unchanged` for all;
 * - every change is recorded in the audit trail as a system action, with the permissions added.
 *
 * Then it issues **one sample PDF per document type** (`SAMPLES`), through the issuance service as
 * the seeded account who would issue it, so a reviewer finds real files with working QR codes. Each
 * sample is ledgered by type, source and language: a second run issues nothing, and `seed:demo:reset`
 * removes them with the rest of the demonstration.
 *
 * It re-seeds nothing, resets no password or second factor, and changes no existing business record
 * (issuing attaches a new document to its source). It refuses exactly where the seed refuses
 * (`guard.ts`). These are demonstration roles, not `SD-02`.
 */
import {
  ISSUED_TEMPLATE_VERSIONS,
  type IssuedDocumentType,
  type Locale,
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
import { SeedRefusedError, assertSeedAllowed } from './guard';
import { C } from './collections';
import { SeedLedger } from './ledger';
import { ADMIN_DOCUMENT_SOURCES, DEMO_ROLES } from './roles';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const DOCUMENT_PERMISSION = /^document\.(view|download|generate|revoke)$/;
const ADMIN_ROLE = 'demo-system-administrator';

/**
 * One sample per document type, issued once. The ledger key names the type, source and language, so
 * a second run issues nothing — and no sample ever supersedes a version a person issued since.
 */
const SAMPLES: {
  label: string;
  type: IssuedDocumentType;
  source: string;
  account: string;
  locale: Locale;
}[] = [
  {
    label: 'contract summary (ar)',
    type: 'contractSummary',
    source: 'contract:mona',
    account: 'salesManager',
    locale: 'ar',
  },
  {
    label: 'instalment schedule (en)',
    type: 'installmentSchedule',
    source: 'contract:mona',
    account: 'salesManager',
    locale: 'en',
  },
  {
    label: 'reservation (ar)',
    type: 'reservation',
    source: 'reservation:laila',
    account: 'salesManager',
    locale: 'ar',
  },
  {
    label: 'receipt (ar)',
    type: 'receipt',
    source: 'receipt:mona-2',
    account: 'collector',
    locale: 'ar',
  },
  {
    label: 'customer statement (en)',
    type: 'customerStatement',
    source: 'customer:mona',
    account: 'collector',
    locale: 'en',
  },
];

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

const logger = createLogger({ name: 'seed-demo-documents', level: config.LOG_LEVEL });
const context = {
  correlationId: `seed-demo-documents-${randomUUID()}`,
  method: 'CLI',
  route: 'scripts/seed-demo/documents',
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
    // The document permissions, and for the administrator the read permissions of every source.
    const wanted = role.permissions.filter(
      (permission) =>
        DOCUMENT_PERMISSION.test(permission) ||
        (role.key === ADMIN_ROLE && ADMIN_DOCUMENT_SOURCES.includes(permission)),
    );
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
      reason: 'demonstration roles: issued-document permissions for package 7 UAT',
      changes: buildChangeSummary(
        { permissions: [...stored.permissions].sort() },
        { permissions: [...permissions].sort() },
      ),
      context,
    });
    report.push(`  ${role.key.padEnd(28)}: added ${missing.join(', ')}`);
  }

  // Sample issued documents, one scenario per type, issued by the person who would issue it.
  const security = services.security();
  const issuance = services.issuance();
  const samples: string[] = [];
  for (const sample of SAMPLES) {
    const sourceId = ledger.existing(sample.source);
    const accountId = ledger.existing(`account:${sample.account}`);
    if (!sourceId || !accountId) {
      samples.push(`  ${sample.label.padEnd(28)}: skipped (${sample.source} not seeded)`);
      continue;
    }
    // The layout version joins the key once it passes 1, so a layout change re-issues its sample once.
    const layout = ISSUED_TEMPLATE_VERSIONS[sample.type];
    const seedKey = `issued:${sample.type}:${sample.source}:${sample.locale}${layout > 1 ? `:t${layout}` : ''}`;
    if (ledger.existing(seedKey)) {
      samples.push(`  ${sample.label.padEnd(28)}: unchanged`);
      continue;
    }
    const actor = await security.resolveActor(accountId);
    if (!actor) fail(`account:${sample.account} resolved to no grants.`);
    const issued = await issuance.issue(
      actor,
      { type: sample.type, sourceId, locale: sample.locale },
      context,
    );
    await ledger.remember(`${seedKey}:document`, C.documents, 'documentId', issued.documentId);
    await ledger.remember(seedKey, C.issuedDocuments, 'issueId', issued.issueId);
    samples.push(
      `  ${sample.label.padEnd(28)}: issued ${issued.businessReference} v${issued.version} (${issued.pages} page(s))`,
    );
  }

  console.log('');
  console.log('Demonstration document permissions applied.');
  console.log(`  database: ${config.MONGODB_DB_NAME}`);
  for (const line of report) console.log(line);
  console.log('Sample issued documents:');
  for (const line of samples) console.log(line);
  console.log('');
} catch (error) {
  logger.error({ err: error }, 'applying the demonstration document permissions failed');
  fail('Applying the document permissions failed. Nothing was deleted; re-run once fixed.');
} finally {
  await connection.close();
}
