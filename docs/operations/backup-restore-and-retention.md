# Backup, restore and retention

For the operator responsible for a client deployment's data. The product never deletes business,
financial, contractual or audit records; backups exist for disasters, not for undoing a mistake —
mistakes are reversed through the product, and the reversal is audited.

## What must be backed up

| Store | Contents | Backed up by |
|---|---|---|
| MongoDB database | Every record, the audit trail, `schemaMigrations` | The database platform (e.g. Atlas continuous backup) or `mongodump --oplog` |
| Private file store | Uploaded documents and brand images, exports (short-lived) | Object-store versioning and replication |
| Secret store | Signing secret, database and Redis credentials, KMS key reference | The platform's secret-store backup |
| Client records | The client initialization file, the deployment record | The client's document system |

Redis holds only throttle counters and job queues; losing it locks nobody out and loses no record.
Jobs are idempotent and re-derived from the database by the sweeps.

## Minimum policy (until the client decides otherwise — `SD-18`)

- Point-in-time recovery for the database, at least 7 days; daily snapshots kept 35 days; monthly
  snapshots kept 12 months.
- Backups encrypted, in a different account or project from the running system, readable by a
  restricted operator role only.
- **A restore rehearsed** before go-live and at least every quarter, into an isolated environment,
  never over the live database.

## Restoring

1. Restore into a **new** database, never over the running one.
2. Point a staging build of the **same version** at it; `npm run db:migrate:status` must show no
   `changed` or `unknown` migrations.
3. Verify: record counts per collection against the backup's report, a sample of recent records,
   the audit trail's latest events.
4. Switch the application over during a maintenance window; record the recovery point in the
   deployment record and tell the client which period must be re-entered.
5. Restored development data must never reach a client deployment: `client:init` refuses a database
   that holds the demonstration ledger.

## Retention — what the product keeps, and for how long

| Data | Kept | Mechanism |
|---|---|---|
| Business, financial, contractual records | Forever in the application | No delete path; reversal, cancellation, archival |
| Audit trail | Forever in the application (archival is `SD-18`, Phase 9) | Append-only, three layers (ADR-0021) |
| Documents and versions | Forever unless a retention date passes and no legal hold applies | `retainUntil`, `legalHold` (CORE-DOC-004) |
| Import batches, export records | Forever (evidence of who moved data in or out) | No delete path |
| Sessions, refresh tokens, account tokens | Until expiry, then removed | `purgeAfter` TTL index |
| Processed webhook deliveries | 30 days after processing | `purgeAfter` TTL index |
| Export files | Reached only through a link that expires within minutes; the stored file follows the object store's lifecycle rule (set it to 7 days) | Signed links, object-store lifecycle |
| Throttle counters | Minutes | Redis TTL |

Changing a retention period is a decision for the client's data owner and a reviewed change to this
document — never a script run against the database.
