# Migrations and upgrades

How a deployment moves from one build to the next (OPS-004). The runner is
`apps/api/src/platform/migrations.ts`; the list is `apps/api/src/platform/migration-list.ts`.

## What a migration is

- **Indexes** are not migrations: the API creates them at startup (`ensureIndexes`), and
  `db:migrate` creates them first too.
- **Data changes** are migrations: a backfill, a rename, a reshape. Each has a fixed identifier
  (`NNNN-kebab-name`), runs once, in order, under a lock, and is recorded in `schemaMigrations` with a
  checksum of its code.
- Migrations are **forward-only**. Undoing one is a new migration. The runner refuses:
  - an applied migration whose code changed since (`MIGRATION_CHANGED`);
  - a database that has migrations this build does not know — the database is newer than the code
    (`MIGRATION_UNKNOWN`);
  - a second run while one holds the lock (`MIGRATION_LOCKED`; the lock expires after 15 minutes).
- A failing migration stops the run; the ones before it stay recorded; a transactional one rolls back
  completely.

## Writing one

1. Append to `MIGRATIONS`, next number, never editing a released entry.
2. Make it **idempotent**: a retry after a crash must converge on the same result.
3. `transactional: true` when it fits in one transaction; long backfills work in batches without.
4. Never delete business, financial, contractual or audit records — that rule has no migration
   exception.
5. Add an integration test that runs it against data shaped like production and runs it twice.

## Upgrading a deployment

1. Read the release notes and `docs/MEMORY.md` for the target build: new environment variables, new
   migrations, anything marked as needing a decision.
2. **Take a backup** and confirm it completed ([backup, restore and retention](backup-restore-and-retention.md)).
3. `npm run db:migrate:status` with the **new** build: expect the new migrations as `pending`, nothing
   `changed`, nothing `unknown`. Exit code 2 means stop.
4. Stop the API and worker (or drain them), so no request runs half on the old schema.
5. `npm run db:migrate -- --confirm` (staging and production require the flag).
6. Start the new build. `GET /health/ready` must answer `ready`.
7. Smoke-check: sign in, open a list screen in each language, confirm the audit trail records the
   sign-in.

## Rolling back

- **Before `db:migrate` ran:** redeploy the previous build. Nothing changed.
- **After a migration ran:** the previous build refuses the database (`MIGRATION_UNKNOWN`) rather than
  running against a schema it does not understand. Either fix forward with a new migration, or
  restore the backup taken in step 2 — which loses anything written since. Choose with the client's
  data owner; record the decision.
