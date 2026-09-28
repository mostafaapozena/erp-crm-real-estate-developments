# Migrations and upgrades

How a deployment moves from one build to the next (OPS-004). The runner is
`apps/api/src/platform/migrations.ts`; the list is `apps/api/src/platform/migration-list.ts`.

## What a migration is

- **Indexes** are not migrations: the API creates them at startup (`ensureIndexes`), and
  `db:migrate` creates them first too.
- **Data changes** are migrations: a backfill, a rename, a reshape. Each has a fixed identifier
  (`NNNN-kebab-name`), runs once, in order, under a lock, and is recorded in `schemaMigrations` with a
  checksum of its **declared identity**: the SHA-256 of
  `["alola-migration-checksum/v2", id, revision, fingerprint]`. The function's text is never hashed —
  it differs between `tsx` and the production bundle — and neither is the prose description.
- Migrations are **forward-only**. Undoing one is a new migration. The runner refuses:
  - an applied migration whose declared revision or fingerprint changed since (`MIGRATION_CHANGED`);
  - a database that has migrations this build does not know — the database is newer than the code
    (`MIGRATION_UNKNOWN`);
  - a second run while one holds the lock (`MIGRATION_LOCKED`; the lock expires after 15 minutes).
- A failing migration stops the run; the ones before it stay recorded; a transactional one rolls back
  completely.

## Writing one

1. Append to `MIGRATIONS`, next number, never editing a released entry. Give it `revision: 1` and a
   `fingerprint` that states the change in printable ASCII (`backfill:units.usageType`). The list is
   validated at startup: a missing or malformed revision or fingerprint, or a duplicate identifier,
   is refused (`MIGRATION_INVALID`).
2. Make it **idempotent**: a retry after a crash must converge on the same result. Changing what `up`
   does **before release** means raising `revision` (or rewriting `fingerprint`) in the same change —
   the checksum cannot see the code. After release, a correction is a new migration.
3. `transactional: true` when it fits in one transaction; long backfills work in batches without.
4. Never delete business, financial, contractual or audit records — that rule has no migration
   exception.
5. Add an integration test that runs it against data shaped like production and runs it twice.
6. After `npm run build -w @alola/api`, `npm run check:migrations:parity` applies the list from source
   to the **integration** database and requires the built API to report it `current` with readiness
   200.

## Development databases migrated before the checksum became build-stable

Until 2026-09-28 the checksum hashed the function's text, so a development database migrated then
carries a checksum no build computes any more, and `db:migrate:status` reports it as `changed`. The
one-time, development-only repair is a compare-and-set of that single row's checksum:

1. `npm run db:migrate:transition-checksum -- --show` prints each migration with the checksum this
   build computes (no database access).
2. `npm run db:migrate:transition-checksum -- --migration <id> --from <stored> --to <computed>`.

It refuses any `APP_ENV` other than `development`, a new checksum this build does not compute, a row
carrying neither checksum, and a missing row. It never runs the migration, never changes `appliedAt`
or any other field, and never deletes or recreates the row; run twice, it reports `unchanged`. No
staging or production database ever stored the old form — none existed.

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
