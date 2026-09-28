# Environments and Local Development

Implements [ADR-0012](../decisions/adr-0012-local-development-infrastructure.md),
[ADR-0015](../decisions/adr-0015-secrets-and-repository-hygiene.md),
[ADR-0018](../decisions/adr-0018-development-infrastructure-selection.md) (staging and production), and
[ADR-0020](../decisions/adr-0020-local-docker-development-services.md) (development).

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

Implemented variables (Phase 1 scaffolding, `packages/config/src/env.ts`):

| Group | Variables | Required |
|---|---|---|
| Runtime | `NODE_ENV`, `APP_ENV`, `LOG_LEVEL`, `TZ` (must be `UTC`) | `TZ` always |
| Organization | `ORG_TIMEZONE` (IANA; placeholder `UTC` pending `SD-21`), `DEFAULT_LOCALE` (`ar`) | `ORG_TIMEZONE` always |
| API | `PORT`, `CORS_ALLOWED_ORIGINS` (bare origins, no wildcard), `TRUST_PROXY_HOPS`, `RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_MAX_REQUESTS`, `AUTH_LOGIN_IP_MAX_ATTEMPTS` (default 120; may only be raised in development and test — the E2E API server uses 2000) | `CORS_ALLOWED_ORIGINS` for the API |
| Database | `MONGODB_URI`, `MONGODB_DB_NAME` | staging and production; name containing `prod` refused elsewhere |
| Redis | `REDIS_URL` | staging and production; always for the worker |
| Worker | `WORKER_CONCURRENCY` | — |
| Files and encryption | `S3_BUCKET`, `S3_REGION`, `KMS_KEY_ID` | staging and production |
| Development files | `FILE_STORAGE_DIR` (default `.local-storage`, ignored by Git) | development and test only; the disk store refuses to start elsewhere |

Added in the phase that needs them, never before: session secrets and token lifetimes (`SEC-014`),
provider credentials (Phase 3+), `SENTRY_DSN` (monitoring).

A configuration error lists every offending variable with the problem — **never its value** — and the
process exits with status 1. It does not crash-loop or print a stack trace.

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
| Integration | MongoDB replica set + Redis | **Skipped with an explicit message**; `test:integration:gate` fails instead |
| E2E | Full stack | Skipped |

**A skipped test is never reported as a pass.** The distinction must be visible in test output and recorded
honestly in `../MEMORY.md`. A phase gate requiring integration tests cannot pass on skipped tests. Since
2026-09-21 the local Docker services exist, so the integration tier **runs** — see §5.

## 5. Local infrastructure options

**Development (`SD-16` refined, 2026-09-21): local Docker containers** — MongoDB as a single-node replica
set plus Redis, orchestrated by `docker/compose.dev.yml` and `scripts/dev-services.mjs`
([ADR-0020](../decisions/adr-0020-local-docker-development-services.md)).

**Staging and production: managed services** — MongoDB Atlas and a managed Redis instance
([ADR-0018](../decisions/adr-0018-development-infrastructure-selection.md)). Nothing is provisioned there
yet. Never connect to production services from development.

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

### Setting up development services

Prerequisites: Docker Desktop with the WSL 2 backend. Installing them needs Administrator rights and a
restart — a one-time human step.

```sh
npm run dev:services:up       # start, initiate the replica set, write .env (values never printed)
npm run dev:services:status   # container health and replica-set state
npm run dev:services:down     # stop containers, KEEP the data volumes
```

`dev:services:up` is idempotent and does, in order:

1. Verifies the Docker daemon responds.
2. Generates development credentials once into the untracked `docker/dev.env`, reusing them on later runs
   so the data volumes stay valid.
3. Starts `mongo:8.0.32` and `redis:8.10.1-alpine` with ports published to **`127.0.0.1` only**.
4. Waits for both container health checks.
5. Initiates the `rs0` single-node replica set and waits for a PRIMARY member — transactions need it.
6. Creates `erp_dev_user` with `readWrite` on `real_estate_erp_dev` **only**.
7. Writes `MONGODB_URI`, `MONGODB_DB_NAME`, `REDIS_URL`, and `TZ` into the ignored `.env` without
   displaying them.

Properties to preserve: pinned image versions; localhost-only publishing; persistent named volumes
(`alola-dev-*`), which `down` does **not** delete; generated credentials that never reach Git, logs, or
documentation; synthetic development data only.

`GET /health/ready` reports each dependency separately, including whether MongoDB supports transactions.

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

All of these pass with **no services running**:

```sh
npm run verify        # everything below except audit and E2E, in order
npm run lint          # ESLint: type-aware rules, module boundaries, color literals, physical CSS,
                      # Light-Mode-only, hard-coded text
npm run format:check  # Prettier
npm run typecheck     # tsc --noEmit, strict, every workspace
npm run check:i18n    # Arabic/English key parity, empty values, plural forms
npm run check:secrets # credential patterns in tracked and untracked files
npm run test:unit     # Vitest — no service dependency
npm run build         # production build of web, api, worker
npm run check:deps    # npm audit, high and critical
npm run test:e2e      # Playwright against the production build, Arabic RTL and English LTR
```

E2E needs a one-time browser download: `node scripts/bin.mjs playwright install chromium` (run in
`apps/web`).

Requiring the development services (`npm run dev:services:up` first):

```sh
npm run test:integration        # Atlas development cluster + Redis (ADR-0018); skips if not configured
npm run test:integration:gate   # the same tests, but FAILS if MongoDB or Redis is not configured
```

### Running the integration tier

`dev:services:up` writes these for you; the table records what they are, with placeholders only:

| Variable | Development value | Used by |
|---|---|---|
| `MONGODB_URI` | local replica set: host `127.0.0.1:27017`, `replicaSet=rs0`, `authSource=real_estate_erp_dev`, generated user info | MongoDB tests (`PLAT-014`) |
| `MONGODB_DB_NAME` | `real_estate_erp_dev` — must not contain `prod` | MongoDB tests |
| `MONGODB_INTEGRATION_DB_NAME` | `real_estate_erp_dev_int` — the integration tier's **own** database | `vitest.integration.config.ts` |
| `REDIS_URL` | local Redis: host `127.0.0.1:6379`, generated password | Redis and BullMQ tests (`PLAT-015`, `INTEGRATION-006`) |
| `TZ` | `UTC` | Set by the test configuration |

For staging and production these same variables point at Atlas (`mongodb+srv://…`) and managed Redis
(`rediss://…`); the application code is identical.

Steps, from the repository root:

```sh
npm run dev:services:up              # creates .env values; no manual editing
npm run test:integration:gate        # must report 3 passed, 0 skipped, for the Phase 1 gate
```

The integration configuration loads `.env` itself. `.env` is ignored by Git; confirm with
`git check-ignore .env` before any commit.

**The integration tier uses its own database** (`MONGODB_INTEGRATION_DB_NAME`), on the same MongoDB as
development. The two were sharing one, and that was a real problem rather than a tidiness one: the
suites assert against global state — "three units exist, and a scoped actor sees two" — so anything
else in the database is data those assertions are counting. Once `npm run seed:demo` put a whole
organization there, the tier both failed for unrelated reasons and wiped the demonstration data
through its own cleanup. `dev:services:up` grants the development user readWrite on the second
database and writes its name into `.env`; **an existing installation picks it up by re-running that
command**, with no re-provisioning and no lost volumes. With the variable absent, the tier falls back
to the development database and behaves as it did before.

### Seeding the demonstration data

```sh
npm run seed:demo                     # idempotent; writes .demo-credentials.md (ignored by Git)
npm run seed:demo:reset               # shows what would be removed, removes nothing
npm run seed:demo:reset -- --confirm  # removes exactly what the seed created
```

The seed writes through the product's own services as the seeded accounts themselves, so every record
passed the same validation, permission check, data scope, transaction and audit write that an HTTP
request would. It refuses to run unless `APP_ENV` is `development` or `test`, the database name
carries a development marker, and the connection points at the local machine. See
[the demonstration runbook](../demo/runbook.md).

Development servers: `npm run dev:api`, `npm run dev:worker`, `npm run dev:web`. The API and worker read
the untracked repository-root `.env` (copy `.env.example`).

## 8. Open dependencies

| Item | Blocks |
|---|---|
| ~~`D2` development services~~ | **Complete 2026-09-21** — local Docker MongoDB replica set + Redis; integration tier passing |
| `SD-18` | Hosting region, data residency, environments, backup, recovery, incident policy |
| `SD-21` | `ORG_TIMEZONE`, fiscal calendar, working week, quiet hours |
| `SD-20` | Provider credentials for email, SMS, and the payment gateway |

## Authentication settings (added 2026-09-21)

Declared in `packages/config/src/env.ts` and listed in `.env.example`. Every one has a defensible default
except the signing secret, which has none: a default signing key is a shared key.

| Variable | Default | Notes |
|---|---|---|
| `AUTH_TOKEN_SIGNING_SECRET` | none | HS256 key for access tokens and MFA challenges. At least 32 characters of random material, generated per environment. **Required when `APP_ENV` is `staging` or `production`.** Without it the authentication routes answer `SERVICE_NOT_CONFIGURED`, exactly as they do without a database |
| `AUTH_ACCESS_TOKEN_TTL_SECONDS` | 600 | Short by design; revocation does not wait for expiry |
| `AUTH_SESSION_IDLE_TIMEOUT_SECONDS` | 1800 | Inactivity ends a session |
| `AUTH_SESSION_ABSOLUTE_TIMEOUT_SECONDS` | 43200 | A session ends at this deadline however active it is |
| `AUTH_ACTIVATION_TOKEN_TTL_SECONDS` | 259200 | Invitation links |
| `AUTH_PASSWORD_RESET_TTL_SECONDS` | 1800 | Reset links |
| `AUTH_MFA_CHALLENGE_TTL_SECONDS` | 300 | How long a second-factor challenge stays valid |
| `AUTH_TOTP_ISSUER` | `Real Estate ERP` | Shown in the authenticator application **only until a company profile exists**; the profile's short English name is used after that (ADR-0027) |
| `ARGON2_MEMORY_COST` | 19456 | KiB. The schema refuses anything **below** the default, so configuration can only harden it |
| `ARGON2_TIME_COST` | 2 | Iterations |
| `ARGON2_PARALLELISM` | 1 | Lanes |
| `DEV_ENCRYPTION_KEY` | none | **Development and test only.** 32-byte base64 key that encrypts MFA secrets so an enrolment survives a restart. Configuration **refuses** it when `APP_ENV` is `staging` or `production`, which require `KMS_KEY_ID` (`SEC-033`, not implemented) |

### Local development versus staging and production

| | Development and test | Staging and production |
|---|---|---|
| Cookie `Secure` | off (plain HTTP on localhost) | **on** — never relaxed to make local HTTP convenient |
| MFA secret encryption | `DevKeyEncryptor` with `DEV_ENCRYPTION_KEY` | KMS. **Unavailable until `SEC-033` lands**; the unconfigured encryptor fails loudly rather than storing plaintext |
| Signing secret | generated locally into the ignored `.env` | required, from the environment or a secrets manager |
| Throttle store | Redis, with an in-memory insurance limiter | same |

### Scheduled maintenance and diagnostics (OPS-006, OPS-007)

`MAINTENANCE_ENABLED` (`true`/`false`; unset means on in staging and production, off otherwise) and
`MAINTENANCE_TICK_SECONDS` (default 30) control the sweeps the API runs on a timer
([ADR-0028](../decisions/adr-0028-scheduled-maintenance-in-api.md)). `GET /health/ready` includes the
schema check; `GET /api/v1/operations/diagnostics` (administrative) shows build, schema, sweeps, the
worker heartbeat and integration states, with configuration reduced to set or not set.

### Migrations and client initialization (OPS-004, OPS-005)

```
npm run db:migrate:status                              # read-only; exit 2 on a changed or unknown migration
npm run db:migrate                                     # staging and production need -- --confirm
npm run client:init -- --file <client.json> --check    # validate a client file; touches nothing
npm run client:init -- --file <client.json>            # create what is missing; never overwrites
```

See [migrations and upgrades](../operations/migrations-and-upgrades.md) and the
[client deployment checklist](../operations/client-deployment-checklist.md). `client:init` refuses a
database holding the demonstration data and a database with pending migrations.

### Creating the first account

```
BOOTSTRAP_ADMIN_EMAIL=someone@example.com npm run bootstrap:admin
```

Runs once, refuses if any account already exists, creates an `invited` account with **no password**, and
prints an activation token for the operator to use. There is no default administrator, no hard-coded
password, and no public self-registration. The account it creates holds every permission, so `SEC-017`
requires it to enrol a second factor at its first sign-in.
