# Environments and Local Development

Implements [ADR-0012](../decisions/adr-0012-local-development-infrastructure.md),
[ADR-0015](../decisions/adr-0015-secrets-and-repository-hygiene.md), and
[ADR-0018](../decisions/adr-0018-development-infrastructure-selection.md).

## 1. Current state

This document defines the contract that the Phase 1 scaffolding satisfies. Current verified status is in
`../MEMORY.md`.

### Disk space — resolved

The `C:` volume, previously full (0 bytes free), was re-measured on 2026-09-19 before any dependency
installation:

| Volume | Free (2026-09-19, before install) |
|---|---|
| `C:` | ~21 GB |
| `D:` | ~181 GB |

npm's cache and the Playwright browser cache live under the user profile on `C:`. Check free space again
before any large installation; if `C:` is short, stop and report rather than starting a partial install.

## 2. Environment tiers

| Tier | Purpose | Data |
|---|---|---|
| Local development | Individual developer work | Synthetic only |
| CI | Lint, typecheck, test, build | Synthetic only |
| Staging | Integration verification, UAT, migration dry runs | Anonymised or synthetic |
| Production | Live operation | Real — never copied downward |

**Production data is never used in development or CI.** Migration dry runs happen in staging
(MASTER-MAPPING Phase 9: "Never put production data in development"). Hosting region, data residency,
backup, and recovery policy are blocked on `SD-18`.

## 3. Configuration contract

Configuration is loaded and **validated at startup** by `packages/config/`, against a Zod schema. A missing
or malformed required variable fails immediately with a message naming the variable and what it is for — not
at first use, hours later, inside an unrelated stack trace.

`.env.example` is committed, lists every variable with a safe placeholder and a comment, and contains no
real value. A new required variable is added to `.env.example` in the same change that introduces it, and CI
checks `.env.example` against the configuration schema for completeness.

Expected variable groups (final list fixed during scaffolding):

| Group | Variables |
|---|---|
| Runtime | `NODE_ENV`, `PORT`, `TZ=UTC`, `LOG_LEVEL` |
| Application | `APP_BASE_URL`, `API_BASE_URL`, `DEFAULT_LOCALE=ar`, `ORG_TIMEZONE` |
| Database | `MONGODB_URI` |
| Redis | `REDIS_URL` |
| Sessions | `SESSION_SECRET`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL` |
| Storage | `S3_BUCKET`, `S3_REGION`, `AWS_*` credentials or role |
| Encryption | `KMS_KEY_ID` |
| Providers | Meta, WhatsApp, email, SMS, gateway — added per phase, never before needed |
| Observability | `SENTRY_DSN` |

`TZ=UTC` is required on every server process
([ADR-0008](../decisions/adr-0008-utc-storage-and-display-timezone.md)); CI asserts it.

## 4. Fail-safe startup

Per ADR-0012, the absence of infrastructure must not block development:

| Requirement | Behaviour |
|---|---|
| Works with no services running | Lint, typecheck, unit tests, and production build all succeed |
| Clear diagnosis | A missing or unreachable service names the service, the variable, and points to this document |
| No crash loops | No unhandled rejection, no silent hang, no bare stack trace |
| Health checks are per-dependency | `/health` reports each dependency separately, so a Redis outage is distinguishable from a database outage |
| Degraded mode is explicit | Features needing an unavailable service report unavailability rather than failing obscurely |

### Test tiers

| Tier | Needs services | Behaviour when absent |
|---|---|---|
| Unit | No | Always runs |
| Integration | MongoDB replica set + Redis | **Skipped with an explicit message** |
| E2E | Full stack | Skipped |

**A skipped test is never reported as a pass.** The distinction must be visible in test output and recorded
honestly in `../MEMORY.md`. A phase gate requiring integration tests cannot pass on skipped tests — which
means provisioning the Atlas development cluster genuinely gates Phase 2 verification, not merely its
convenience.

## 5. Local infrastructure options

**Selected (`SD-16`, 2026-09-19): Option B — MongoDB Atlas development cluster, with Redis through an
adapter that accepts a managed development instance or an approved local instance.** See
[ADR-0018](../decisions/adr-0018-development-infrastructure-selection.md). Docker is not installed and no
compose file is committed. Option A is kept below for the record only. Never connect to production
services from development.

**Transactions require a replica set.** A standalone `mongod` accepts connections and silently cannot
provide transactions, so unit holds, reservations, contract activation, and accounting posting cannot be
verified against it. Both options below therefore provide a replica set.

### Option A — Docker Desktop

MongoDB as a **single-node replica set** plus Redis, via a committed compose file.

| Aspect | Assessment |
|---|---|
| Topology fidelity | Closest to production |
| Offline work | Works fully offline |
| Prerequisites | Docker Desktop installation — **requires approval** |
| Local resources | Significant memory and disk |
| Notes | The replica set must be initiated once (`rs.initiate()`), and the connection string must include `replicaSet` and `directConnection` appropriately, or transactions fail with a confusing error |

### Option B — MongoDB Atlas development cluster

A free or shared Atlas cluster, paired with managed or local Redis.

| Aspect | Assessment |
|---|---|
| Topology fidelity | Real replica set; transactions available immediately |
| Offline work | **Requires network connectivity** |
| Prerequisites | Atlas account, IP allow-listing |
| Local resources | Minimal |
| Notes | A development cluster only. Never a production cluster, never production credentials. Redis still needed: either a managed instance or a local install |

### Setting up the approved option

1. Create an Atlas **development** cluster (never a production cluster) and a database user with access
   to a development database only.
2. Allow-list the developer's IP in Atlas.
3. Copy `.env.example` to `.env` (untracked) and set `MONGODB_URI` and `MONGODB_DB_NAME`. The database
   name must not contain `prod`; configuration validation refuses it outside production.
4. Set `REDIS_URL` to a managed development instance or an approved local instance.
5. `GET /health/ready` reports each dependency separately, including whether MongoDB supports
   transactions.

## 6. Observability

| Concern | Implementation |
|---|---|
| Logs | Pino structured JSON; redaction configured once at the instance |
| Correlation | A correlation ID per request, propagated through API, worker, provider calls, logs, and audit |
| Errors | Sentry, with PII scrubbing |
| Metrics | CloudWatch |
| Health | Per-dependency `/health` |
| Audit | Application-level, in the database, append-only — distinct from logs and never a substitute for them |

Logs are operational telemetry and may be rotated or expired. **Audit records are evidence and are never
deleted** ([ADR-0009](../decisions/adr-0009-no-hard-delete.md)). The two must not be confused: a log is not
an audit trail.

## 7. Verification commands

To be available once scaffolding exists. All four must pass with **no services running**:

```sh
npm run lint          # ESLint: boundaries, hex literals, physical CSS, money arithmetic
npm run typecheck     # tsc --noEmit, strict
npm run test:unit     # Vitest — no service dependency
npm run build         # Production build of all applications
```

Requiring infrastructure:

```sh
npm run test:integration   # MongoDB replica set + Redis
npm run test:e2e           # Playwright, both locales and directions
```

## 8. Open dependencies

| Item | Blocks |
|---|---|
| Atlas development cluster and Redis not yet provisioned (`D2`) | Integration coverage; all transaction-dependent verification |
| `SD-18` | Hosting region, data residency, environments, backup, recovery, incident policy |
| `SD-21` | `ORG_TIMEZONE`, fiscal calendar, working week, quiet hours |
| `SD-20` | Provider credentials for email, SMS, and the payment gateway |
