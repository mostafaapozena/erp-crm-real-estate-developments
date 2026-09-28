/**
 * Source and production build agree on migration state (OPS-004, OPS-006).
 *
 *   npm run build -w @alola/api && npm run check:migrations:parity
 *
 * Against the **integration** database only (never the development or demonstration one):
 *
 * 1. `db:migrate` from source (tsx) applies any pending migration and records its checksum;
 * 2. `db:migrate:status` from source must report nothing pending, changed or unknown;
 * 3. the **built** API (`apps/api/dist/main.js`) is started against the same database, and
 *    `/health/ready` must answer 200 with `migrations: current` — so the bundle computes the checksum
 *    the source recorded.
 *
 * The built API is stopped and its port checked free before the script exits. Nothing is deleted,
 * and no connection string or secret is printed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bin = fileURLToPath(new URL('./bin.mjs', import.meta.url));
const builtApi = fileURLToPath(new URL('../apps/api/dist/main.js', import.meta.url));
const port = 4322;

function fail(message) {
  console.error(`migration parity: ${message}`);
  process.exit(1);
}

if (existsSync(`${root}.env`)) process.loadEnvFile(`${root}.env`);
const appEnv = process.env['APP_ENV'];
if (appEnv !== 'development' && appEnv !== 'test') fail(`refused for APP_ENV=${String(appEnv)}`);
const database = process.env['MONGODB_INTEGRATION_DB_NAME'];
if (!database) fail('MONGODB_INTEGRATION_DB_NAME is not set (run npm run dev:services:up)');
if (database === process.env['MONGODB_DB_NAME']) {
  fail('the integration database is the development database; refusing');
}
if (!existsSync(builtApi))
  fail('apps/api/dist/main.js is missing; run npm run build -w @alola/api');

const env = { ...process.env, MONGODB_DB_NAME: database, LOG_LEVEL: 'silent' };
const source = (args) => {
  const result = spawnSync(process.execPath, [bin, 'tsx', 'scripts/db-migrate.ts', ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  if (result.status !== 0)
    fail(`source db-migrate ${args.join(' ')} exited ${String(result.status)}`);
  return JSON.parse(result.stdout);
};

source([]);
const status = source(['--status']);
if (status.pending.length || status.changed.length || status.unknown.length) {
  fail(`source status is not current: ${JSON.stringify(status)}`);
}

const portFree = () =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
if (!(await portFree())) fail(`port ${String(port)} is in use`);

const child = spawn(process.execPath, [builtApi], {
  cwd: root,
  env: { ...env, PORT: String(port), MAINTENANCE_ENABLED: 'false', LOG_LEVEL: 'silent' },
  stdio: 'ignore',
});
const exited = new Promise((resolve) => child.once('exit', resolve));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ready;
try {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/health/ready`);
      ready = { status: response.status, body: await response.json() };
      if (ready.body.checks?.migrations) break;
    } catch {
      // not listening yet
    }
    await wait(500);
  }
} finally {
  child.kill();
  await Promise.race([exited, wait(10_000)]);
}
if (!(await portFree())) fail(`port ${String(port)} was not released`);

const verdict = {
  database: 'integration',
  sourceStatus: { databaseVersion: status.databaseVersion, pending: 0, changed: 0, unknown: 0 },
  builtReadiness: ready
    ? { status: ready.status, migrations: ready.body.checks?.migrations }
    : null,
};
console.log(JSON.stringify(verdict, null, 2));
if (ready?.status !== 200 || ready.body.checks?.migrations?.status !== 'current') {
  fail('the built API does not see the schema the source recorded as current');
}
console.log('migration parity: source and built API agree.');
