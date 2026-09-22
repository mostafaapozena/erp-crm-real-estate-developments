/**
 * Remove the demonstration data this machine's seed created.
 *
 *   npm run seed:demo:reset -- --confirm
 *
 * Three things make this safe enough to exist:
 *
 * 1. **The same three refusals as the seed** (`guard.ts`): development or test, a database name
 *    carrying a development marker, and a local host. A production database cannot be reached.
 * 2. **Explicit confirmation.** Without `--confirm` it prints what it would delete and stops.
 * 3. **It deletes only what the ledger recorded.** Every removal is by the exact identifier the seed
 *    wrote down. A record someone entered by hand while preparing for the meeting is not in the
 *    ledger and is therefore not touched — that is the whole reason the ledger exists.
 *
 * **The audit trail is not deleted.** `auditEvents` is append-only by design (ADR-0021) and there is
 * no application path that removes a row from it; this script does not invent one. After a reset the
 * audit trail still records that the demonstration data was created and removed, which is correct:
 * that history is evidence, and the records it describes were business records while they existed.
 *
 * This is a development-database teardown and nothing else. The product's own rule — that financial,
 * contractual and audit records are never hard-deleted (ADR-0009) — is unchanged; no endpoint, job or
 * service gained a delete path because this script exists.
 */
import { ConfigError, assertUtcRuntime, loadApiConfig, loadDotEnvIfPresent } from '@alola/config';
import { createLogger } from '@alola/security';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { configureMongoose } from '../../apps/api/src/platform/mongo';
import { C, DEPENDENTS } from './collections';
import { CREDENTIALS_FILE } from './credentials';
import { SeedRefusedError, assertSeedAllowed } from './guard';
import { LEDGER_COLLECTION, SeedLedger } from './ledger';

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
  fail('MONGODB_URI and MONGODB_DB_NAME must be set.');
}

try {
  assertSeedAllowed({
    appEnv: config.APP_ENV,
    databaseName: config.MONGODB_DB_NAME,
    mongoUri: config.MONGODB_URI,
  });
} catch (error) {
  if (error instanceof SeedRefusedError) fail(`Refused to reset.\n  ${error.reason}`);
  throw error;
}

const confirmed = process.argv.includes('--confirm');
const logger = createLogger({ name: 'seed-demo-reset', level: config.LOG_LEVEL });

configureMongoose();
const connection = mongoose.createConnection(config.MONGODB_URI, {
  dbName: config.MONGODB_DB_NAME,
  serverSelectionTimeoutMS: 10_000,
});

try {
  await connection.asPromise();
  const ledger = new SeedLedger(connection);
  await ledger.load();
  const entries = ledger.all();

  if (entries.length === 0) {
    console.log('');
    console.log(`Nothing to remove: no seed ledger in "${config.MONGODB_DB_NAME}".`);
    console.log('');
    process.exit(0);
  }

  // Grouped by collection so the summary reads like an inventory rather than a wall of identifiers.
  const byCollection = new Map<string, { field: string; values: string[] }>();
  for (const entry of entries) {
    const bucket = byCollection.get(entry.collection) ?? { field: entry.field, values: [] };
    if (!bucket.values.includes(entry.value)) bucket.values.push(entry.value);
    byCollection.set(entry.collection, bucket);
  }

  console.log('');
  console.log(`Demonstration data recorded in "${config.MONGODB_DB_NAME}":`);
  console.log('');
  const widest = Math.max(...[...byCollection.keys()].map((key) => key.length));
  for (const [collection, bucket] of [...byCollection].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(
      `  ${collection.padEnd(widest)}  ${String(bucket.values.length).padStart(4)} record(s)`,
    );
  }
  console.log('');
  console.log('  auditEvents        retained — the audit trail is append-only (ADR-0021)');
  console.log('');

  if (!confirmed) {
    console.log('Nothing has been removed.');
    console.log('Re-run with --confirm to remove exactly the records listed above:');
    console.log('');
    console.log('  npm run seed:demo:reset -- --confirm');
    console.log('');
    process.exit(0);
  }

  let removed = 0;

  // Children first, while their parents' identifiers are still meaningful. Each one is matched by a
  // parent identifier that is in the ledger, so nothing is removed on a guess.
  for (const dependent of DEPENDENTS) {
    const parents = byCollection.get(C[dependent.parent])?.values ?? [];
    if (parents.length === 0) continue;
    const result = await connection
      .collection(dependent.collection)
      .deleteMany({ [dependent.field]: { $in: parents } });
    removed += result.deletedCount ?? 0;
  }

  // Approval requests are raised by the reservations, and every decision belongs to a request. The
  // two hops are followed explicitly rather than deleting the whole approval collection, which would
  // take out anything a reviewer had created by hand.
  const reservationIds = byCollection.get(C.reservations)?.values ?? [];
  if (reservationIds.length > 0) {
    const requests = await connection
      .collection(C.approvalRequests)
      .find({ 'source.id': { $in: reservationIds } }, { projection: { requestId: 1 } })
      .toArray();
    const requestIds = requests
      .map((row) => (row as { requestId?: string }).requestId)
      .filter((value): value is string => typeof value === 'string');
    if (requestIds.length > 0) {
      const decisions = await connection
        .collection(C.approvalDecisions)
        .deleteMany({ requestId: { $in: requestIds } });
      const removedRequests = await connection
        .collection(C.approvalRequests)
        .deleteMany({ requestId: { $in: requestIds } });
      removed += (decisions.deletedCount ?? 0) + (removedRequests.deletedCount ?? 0);
    }
  }

  for (const [collection, bucket] of byCollection) {
    const result = await connection
      .collection(collection)
      .deleteMany({ [bucket.field]: { $in: bucket.values } });
    removed += result.deletedCount ?? 0;
  }

  // Sessions and refresh tokens belong to the accounts just removed. They carry a TTL index and would
  // expire on their own, but leaving a live session pointing at a deleted account is untidy and makes
  // the next run's behaviour harder to reason about.
  const accountIds = byCollection.get(C.accounts)?.values ?? [];
  if (accountIds.length > 0) {
    for (const collection of [C.sessions, C.refreshTokens, C.accountTokens, C.grants]) {
      const result = await connection
        .collection(collection)
        .deleteMany({ accountId: { $in: accountIds } });
      removed += result.deletedCount ?? 0;
    }
  }

  /**
   * Document numbering restarts only when there is genuinely nothing left to collide with.
   *
   * A demonstration whose first contract is numbered `CTR-2026-00008` looks like leftover junk, so it
   * is worth restarting the sequence. But the counters are shared with anything else that ever
   * created a contract in this database — an integration run, a record entered by hand — and
   * restarting the sequence while one of those still exists would make the next seed collide on the
   * unique document number. So the counters go only when all three numbered collections are empty.
   */
  const numbered = [C.contracts, C.reservations, C.receipts];
  const remaining = await Promise.all(
    numbered.map((collection) => connection.collection(collection).countDocuments({})),
  );
  if (remaining.every((count) => count === 0)) {
    const counters = await connection.collection(C.counters).deleteMany({});
    removed += counters.deletedCount ?? 0;
  } else {
    console.log(
      'Document numbering was left alone: other numbered records exist in this database.',
    );
  }

  await connection
    .collection(LEDGER_COLLECTION)
    .drop()
    .catch(() => undefined);

  const credentialsPath = join(repositoryRoot, CREDENTIALS_FILE);
  if (existsSync(credentialsPath)) {
    unlinkSync(credentialsPath);
  }

  console.log(`Removed ${removed} record(s), dropped "${LEDGER_COLLECTION}",`);
  console.log(`and deleted ${CREDENTIALS_FILE}.`);
  console.log('The audit trail was left intact.');
  console.log('');
  console.log('Seed again with:  npm run seed:demo');
  console.log('');
} catch (error) {
  logger.error({ err: error }, 'reset failed');
  fail('Reset failed. Nothing further was removed.');
} finally {
  await connection.close();
}
