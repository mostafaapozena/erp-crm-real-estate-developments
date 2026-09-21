# ALOLA ERP — Project Memory

Last updated: 2026-09-21
Blueprint documents: `MASTER-MAPPING.md` v2.0, `PHASE-PROMPTS.md` v2.0
Repository: local Git · Branch: `main` · **No remote, nothing pushed, nothing deployed**
Commits: `7a840b3` documentation baseline → `4c988db` Phase 1 scaffolding → `4365775` Phase 1 review
decisions → `dfc0ac5` development services + integration gate → `3d6bdf1` audit and authorization core →
identity and authentication (the commits containing this file)

## Project identity

- Product: ALOLA Real Estate CRM & ERP
- Architecture: TypeScript MERN modular monolith (npm workspaces)
- Frontend: React 19, Vite 8, Material UI 9 · Backend: Node.js 24, Express 5 · Database: MongoDB (Mongoose 9)
- Jobs: BullMQ 6 + Redis (ioredis 6) · Files: private AWS S3 · Encryption: AWS KMS (adapters not yet built)
- Default language: Arabic. Supported: Arabic (RTL) and English (LTR)
- Theme: **Light Mode only**
- Fonts: Alexandria (Arabic), Inter (English), self-hosted via Fontsource

## Current phase

- Phase: **1 — Discovery, architecture, core, security, localization, Light Mode**
- Sub-stage: Build half — foundation, audit, authorization, and identity complete; verification green
- `D2`: **COMPLETE 2026-09-21.** Local Docker MongoDB (single-node replica set `rs0`) + Redis
  ([ADR-0020](decisions/adr-0020-local-docker-development-services.md)). Integration tier: **59 passed,
  0 failed, 0 skipped** (132 tests).
- Gate status: **PHASE 1 NOT APPROVED — SCOPE INCOMPLETE.** Every mandatory verification check passes, but
  **31 of 113** Phase 1 requirements are not started (`APPROVAL-*`, `INTEGRATION-001`–`005`,
  `CORE-NOTIFY`, `CORE-TASK`, `CORE-DOC`, `CORE-SEARCH`, `CORE-IMPORT`), 9 are in progress, and the gate
  also requires a stakeholder demonstration and written approval (phase-gates §1).
- Requirements `verified`: **0** — no requirement is marked `verified` before the stakeholder gate
- Requirements `implemented` (code + passing tests): **73 of 113** · `in-progress`: 9 · not started: 31

## Phase status

- [ ] Phase 1 — *in progress: scaffolding, audit, authorization, and identity/authentication done;
      approval, integration registry, notifications, tasks, documents, search, and import not started*
- [ ] Phases 2–9 — not started. **Do not start Phase 2.**

## Recently completed — 2026-09-19

### 1. Stakeholder decisions applied (commit `7a840b3`)

`SD-13` Light Mode only (closed) · `SD-14` full Master Mapping Meta scope (closed) · `SD-15` Conversions
API optional, production delivery gated (ADR-0017) · `SD-16` Atlas dev cluster + Redis adapter, no Docker
(ADR-0018) · `SD-22` nine Phase 1 namespaces (ADR-0016; REQUIREMENTS.md re-keyed, old → new table kept) ·
PDF confirmed supplementary (ADR-0013 status update) · `SD-17` logo open, non-blocking · all remaining
decisions assigned to the phase they block — none blocks Phase 1 scaffolding.

### 2. Phase 1 scaffolding (this commit)

| Workspace | Contents |
|---|---|
| `packages/contracts` | Error codes and error response; health schemas; decimal-string money with explicit rounding and exact allocation; branded `Instant` / `BusinessDate`; `{ ar, en }` labels |
| `packages/config` | Zod-validated env for API and worker; value-free errors; production-DB-name guard; UTC runtime assertion; `.env` loader |
| `packages/security` | Pino logger with central redaction; `Encryptor` interface + unconfigured + dev-only AES-GCM; `PrivateFileStore` with signed-URL TTL ≤ 300 s and safe keys; upload validation by magic bytes; malware-scan hook (`not_scanned` until a scanner exists) |
| `packages/i18n` | `ar`/`en` resources (`common`, `errors`); key-parity + plural-category checker; direction and font stacks; `Intl` formatters (org timezone, exact money strings, un-shifted business dates) |
| `packages/ui` | `tokens.ts` (only file with color values); WCAG contrast calculator + registry of every pair in use; Light-only MUI theme with all interaction states; RTL/LTR emotion caches; `StateView` (5 states); `LtrIsolate` |
| `packages/testing` | `serviceGate` — loud, explicit skips for integration tests |
| `apps/api` | Express 5: correlation IDs (AsyncLocalStorage), pino-http, Helmet, strict CORS, health (live/ready per dependency), rate limiting (Redis or memory), JSON limit, CSRF origin guard, strict validation, centralized errors, OpenAPI 3.1 from Zod, fail-safe Mongo/Redis connectors, Decimal128 conversion, module mount point |
| `apps/worker` | BullMQ bootstrap: bounded exponential retries, dead-letter queue (metadata only, no payload), deterministic idempotent job IDs, correlation envelope; exits cleanly without Redis |
| `apps/web` | Locale provider (one state drives text, `lang`, `dir`, theme); responsive shell (drawer at inline start, skip link, language switch); dev-only text logo placeholder; foundation page |
| Root | ESLint flat config + `eslint.restrictions.js`; Prettier; Vitest projects (unit) and integration config; Playwright; `scripts/bin.mjs`, `build-node-app.mjs`, `check-i18n.ts`, `scan-secrets.mjs`; `.env.example`; `.gitattributes`; `.editorconfig`; `.nvmrc`; `.github/workflows/ci.yml` |

Docs changed: `architecture/dependencies.md` (new), `architecture/environments.md` (variables and
commands), `architecture/overview.md`, `architecture/README.md`, `decisions/open-decisions.md` (`SD-23`),
`README.md` (getting started).

### 3. Phase 1 review decisions (the commit containing this file)

| Decision | Applied |
|---|---|
| `SEC` boundary | ADR-0019: `SEC` = accounts, auth, sessions, devices, MFA, activation/suspension, roles, permissions, field restrictions, scopes, policies, security events · `CORE-ORG` = entities, branches, departments, teams, job titles, hierarchy, placement references · `HR-EMP` = employee profiles, contracts, HR documents, attendance/payroll identity, placement. **No `SEC` ID held HR data — none restored.** `SEC-011`, `SEC-019`, `SEC-026` clarified; `SEC-021` narrowed; new `CORE-TASK-005`, `APPROVAL-007` (split from `SEC-021`); customer transfer → Phase 3 `CRM-OWNER`. Phase 1 now 113 IDs. |
| Arabic PDF | Committed at `docs/source/alola-client-business-scope-ar.pdf`, bytes unchanged, SHA-256 `89fade53871af54f69527c3a23cee7171197525b322db0ed0d301e9c53199f7b`; `docs/source/README.md` records the original name and status |
| `SD-23` | **Closed.** Western digits in Arabic and English, forced with `-u-nu-latn`; `dd/MM/yyyy` dates; ICU bidi marks stripped except a leading LRM on negatives; contracts reject Arabic-Indic digits; identifiers rendered verbatim and direction-isolated. ADR-0003 status update |
| Integration gate | New `npm run test:integration:gate` fails (not skips) without MongoDB/Redis |
| Bundle budget | `npm run check:bundle`: largest chunk ≤ 650 kB minified / ≤ 210 kB gzip; route splitting required before feature-heavy phases |
| Dependencies | Unchanged — no upgrades |

### 4. Recovery after an interrupted session (2026-09-20)

The session applying the review decisions stopped at its usage limit **after writing every file but before
committing**. Recovery verified each decision against the repository rather than against notes:

| Item | State found | Action |
|---|---|---|
| A — `SEC` boundary (ADR-0019, registry, ADR-0016, security model, ADR index) | Complete, uncommitted | Committed as-is |
| B — Arabic PDF moved to `docs/source/`, README, checksum | Complete, **untracked** | Verified checksum and single copy, then committed |
| C — `SD-23` formatter, ADR-0003 status update, localization doc | Complete, uncommitted | Kept; **added** identifier tests (phone, national ID, IBAN, unit code) that decision C also required |
| D — Integration gate script, strict `serviceGate`, gate docs | Complete, uncommitted | Committed as-is |
| E — Bundle budget script and documentation | Complete, uncommitted | Committed as-is |
| F — Dependencies unchanged | Verified: `package.json` diff is scripts only, `package-lock.json` untouched | No action |
| `docs/MEMORY.md` unit-test row | **Defective** — literal `REPLACE_UNIT_COUNT` placeholder | Replaced with the measured count |

Nothing was reset, discarded, or duplicated; no destructive Git command was run; the two existing commits
were left untouched.

### 5. Development services and Phase 1 verification (2026-09-21, the commit containing this file)

The stakeholder cancelled the managed-service route for development (no external accounts, API keys, or
hand-copied connection strings) and approved local Docker instead — [ADR-0020](decisions/adr-0020-local-docker-development-services.md).
Atlas and managed Redis remain the staging/production direction ([ADR-0018](decisions/adr-0018-development-infrastructure-selection.md)
status update). **Nothing was provisioned in any cloud: no Atlas project, cluster, user, or managed Redis
instance exists, and no payment method was ever entered.**

| Item | Result |
|---|---|
| Prerequisites | Docker Desktop 4.91.0 + Docker Engine 29.8.0 + Compose v5.5.1 on WSL 2. Installing WSL 2 needed Administrator rights and a restart — done by the stakeholder, it is not automatable from here |
| MongoDB | `mongo:8.0.32`, single-node replica set `rs0`, PRIMARY, keyfile internal auth, published to `127.0.0.1:27017` only |
| Redis | `redis:8.10.1-alpine`, password-protected, `appendonly yes`, published to `127.0.0.1:6379` only |
| Volumes | Persistent named volumes `alola-dev-mongodb-data`, `alola-dev-mongodb-config`, `alola-dev-redis-data`; `dev:services:down` keeps them |
| Least privilege | `erp_dev_user` = `readWrite` on `real_estate_erp_dev` only; `listDatabases` as that user returns `[]` |
| Credentials | Generated locally, stored only in the ignored `docker/dev.env` and `.env`; never printed, never committed. `.env` ACL restricted to the current user |
| Connectivity checks | **9/9 passed** — Mongo connect, write, read, multi-document **transaction**, delete + collection drop; Redis connect, set + get, delete, `appendonly` confirmed. All test records and keys removed |
| Added | `docker/compose.dev.yml`, `scripts/dev-services.mjs`, npm scripts `dev:services:up|status|down` |

## Recently completed — 2026-09-21 (audit subsystem and authorization core)

Bounded group: `AUDIT-001`–`AUDIT-006` and `SEC-023`–`SEC-032`. Nothing outside it was implemented.

### Audit subsystem

| Piece | Where | What it guarantees |
|---|---|---|
| Append-only store | `apps/api/src/modules/audit/model.ts` | `auditEvents`; every mutating query op, `bulkWrite`, and a document re-save throw; every field `immutable` under `strict: 'throw'`; 7 named indexes |
| Service | `apps/api/src/modules/audit/service.ts` | `record`, `query`, `findByEventId`, `exportEvents`, `recordAuthenticationEvent`. No update or delete path exists. A failed write is logged **and rethrown** |
| Query surface | `apps/api/src/modules/audit/router.ts` | `GET /api/v1/audit/events`, `/events/export` (NDJSON, bounded, reports truncation), `/events/{eventId}`. Each read records its own event before responding |
| Change summaries | `packages/security/src/audit/summary.ts` | `{ path, from, to }` only; sensitive keys redacted; value length, path count, and depth bounded; no request body stored |
| AUDIT-003 enforcement | `apps/api/src/http/audit-context.ts` | Per-request audit-write counter: a successful mutation that recorded nothing becomes `500` and logs `AUDIT_MISSING_FOR_MUTATION` |

Pagination is **keyset** (`occurredAt desc, eventId desc`, opaque cursor), so pages neither repeat nor skip
as events arrive. Immutability is **application-level**: the privileged-database-administrator limit and the
absence of cryptographic tamper-proofing are stated in
[ADR-0021](decisions/adr-0021-audit-trail-integrity.md) §2, and in the model's own doc comment.

### Authorization core

| Piece | Where | What it guarantees |
|---|---|---|
| Permission catalog | `packages/contracts/src/authorization.ts` | Granular verbs; `ADMINISTRATIVE_PERMISSIONS` explicit; `security.grant.assignAny` never implied |
| Policy | `packages/security/src/authorization/policy.ts` | Default deny; unknown permission denied; **deny wins** |
| Scope | `.../scope.ts` | Filter merged into the query before the database answers; an unsatisfiable scope matches **nothing** |
| Fields | `.../fields.ts` | Restricted fields deleted from responses and exports; writes to unseen fields refused |
| Escalation | `.../escalation.ts` | No self-grant, no granting unheld permissions, no widening scope |
| Filter safety | `.../sanitize.ts` | `$`-prefixed keys, dotted keys, and operator objects rejected |
| Guard | `apps/api/src/http/actor.ts` | `401`/`403` without naming the permission; denial recorded as `security.authorization.denied` |
| Admin surface | `apps/api/src/modules/security/` | `roles` and `accountGrants` collections; `GET/POST /security/roles`, `GET/PUT /security/accounts/{id}/grants` |

The actor is rebuilt from stored grants on **every** request, so `SEC-032` holds with no cache to
invalidate ([ADR-0022](decisions/adr-0022-authorization-resolved-per-request.md)).

### Defects this group's own tests found, and the fixes

| Found | Fix |
|---|---|
| Domain errors (privilege escalation, role-key conflict, unknown role) surfaced as `500`: the error handler only knew `AppError` | `ERROR_STATUS` map in contracts; the handler accepts a `code` that is in the published list, so a module can answer correctly without importing the HTTP layer. A Node code such as `ENOENT` still falls through to `INTERNAL_ERROR` |
| A refused privilege escalation left **no evidence**: the guard passed, and the service refused silently | `SecurityService.assertNoEscalation` records `security.authorization.denied` with the attempt, then rethrows |
| The `accountGrant` field restriction required the same permission as its own route guard, so it could never trigger — and the router never applied it | The denial list now requires `security.grant.assign`; `GET` applies `restrictDocument` |
| Cross-module imports in the new integration test broke the ADR-0001 boundary | Import through `../audit` only; the lint rule caught it |

### Not done, deliberately

No authentication (`SEC-010`–`SEC-022`), no approval engine, no notifications, tasks, documents, search, or
import. The **production actor resolver returns no actor**, so every protected endpoint answers `401` until
`SEC-013` lands. Integration tests inject their own resolver that reads an account id from a header and then
resolves grants from the database: a fixture for exercising authorization, **not** authentication, and not
compiled into the application.

## Recently completed — 2026-09-21 (identity and authentication)

Bounded group: `SEC-010` and `SEC-011`–`SEC-022`. Nothing outside it was implemented.

**`SEC-010` is not an identity requirement.** The registry defines it as the privilege-escalation **test
suite** (MM §13), in the general security block. It was implemented as registered — a dedicated suite — not
reinterpreted as a feature.

### What exists

| Piece | Where | What it guarantees |
|---|---|---|
| Accounts | `apps/api/src/modules/identity/model.ts` | `securityAccounts`: credentials, lifecycle, second factor, and an **opaque** employee reference. Unique normalized identifier; one live account per employee (partial index). No deletion |
| Lifecycle | `…/identity/service.ts` | `invited` → `active` → `suspended` → `terminated`, compare-and-set on the current state so a concurrent transition loses rather than overwrites |
| Passwords | `packages/security/src/credentials/passwords.ts` | Argon2id (m=19456, t=2, p=1), PHC format, transparent rehash when parameters rise, length-first policy, never trimmed, never logged |
| Tokens | `packages/security/src/credentials/tokens.ts` | Short-lived HS256 access token; 256-bit opaque refresh secret stored as a SHA-256 digest only |
| Sessions | `…/identity/model.ts`, `service.ts` | MongoDB rows with idle and absolute expiry and a revocation **reason**; rotation on refresh; replay revokes the whole family |
| Second factor | `packages/security/src/credentials/mfa.ts` | TOTP with the accepted step stored against replay; secret encrypted at rest; ten independently hashed single-use recovery codes |
| Throttling | `…/identity/throttle.ts` | Redis counters per address and per identifier, **every one with a TTL** |
| Cookie | `…/identity/cookies.ts` | `HttpOnly`, `SameSite=Strict`, path-scoped, `Secure` everywhere except development and test |
| Bootstrap | `scripts/bootstrap-admin.ts` | Runs once, refuses if any account exists, creates an `invited` account with **no password** |

Endpoints: 9 under `/api/v1/auth`, 6 under `/api/v1/me`, 11 under `/api/v1/security/accounts`. All 33
documented paths resolve in the generated OpenAPI document with zero broken references.

**Why revocation is immediate.** Every authenticated request re-reads the session and the account and
compares the token's credential generation with the account's, so suspension, offboarding, a password
change, and a permission change all take effect on the next request rather than at token expiry
([ADR-0023](decisions/adr-0023-password-hashing-and-session-tokens.md) §4).

### Decisions worth not reversing

- **Argon2id via `@node-rs/argon2`, not `argon2`.** The named package's install script runs `cross-env`,
  whose Windows shim breaks on the `&` in the repository path. Same algorithm, prebuilt binaries, no
  install script. A unit test asserts the stored value really begins with `$argon2id$` (ADR-0023 §1).
- **Password policy is length-first** (12–200, blocklist, no composition rules) per NIST SP 800-63B, and the
  raw password is never trimmed or normalized.
- **An access token is never trusted alone** — that is what makes `SEC-020` true.
- **Lockout is a TTL-bounded counter, never a stored state**, so no sequence of failures can make an account
  permanently unusable. `suspended` is the administrative decision.
- **The per-address sign-in budget is generous (120/15 min)** because a branch office behind one NAT shares
  an address; precision is the per-identifier rule's job.
- **No default administrator, no seeded role, no self-registration.**

### Defects this group's own tests found, and the fixes

| Found | Fix |
|---|---|
| An administrator could reset **their own** MFA or password through the administrative routes, skipping the re-authentication the self-service routes require — a way around `SEC-017` | `assertNotSelfAdministration`: suspend, offboard, password reset, and MFA reset are refused on the caller's own account and the attempt is recorded |
| A `429` from the authentication throttle carried no `Retry-After`, which invites an immediate retry loop | `AppError` gained an optional retry hint and the error pipeline sets the header |
| The per-IP sign-in budget (30/15 min) would lock out a whole office behind one NAT | Raised to 120 with the reason recorded; the per-identifier rule stays tight at 8 |
| `z.toJSONSchema` could not represent the login-identifier contract because it carried a `.transform` | Normalization moved to the service, which already did it at every entry point; the schema now only validates |
| The integration suites reached into the security module's internals to seed roles and grants (ADR-0001) | `bootstrapRole` / `bootstrapGrant` published by that module, documented as the unguarded bootstrap path used by the script and by fixtures, never by a router |

### Not done, deliberately

- **`SEC-033` (KMS) is not implemented.** Development and test encrypt MFA secrets with a configured local
  key; staging and production refuse that key and cannot store an MFA secret until the adapter exists.
- **Delivery** of invitation and reset tokens is `CORE-NOTIFY`. An administrator issues and hands over a
  reset token meanwhile; the self-service request answers identically for every identifier and returns
  nothing.
- **No authentication screens.** The registry rows for `SEC-011`–`SEC-022` describe mechanism, not UI, and
  the Phase 1 prompt names no login screen. This group is API-only.
- **Employee references are opaque** until `HR-EMP` (Phase 8); nothing validates them and nothing stores
  employee data.
- **Account administration has no organization scope**: account rows carry no branch, department, or team,
  so a team-scoped actor resolves to "no records" rather than a subset. Needs `CORE-ORG` and `SD-01`.

## Verification — actual results, 2026-09-21 (full suite re-run)

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | ✅ 0 errors, 0 warnings |
| Format | `npm run format:check` | ✅ |
| Typecheck (strict) | `npm run typecheck` | ✅ root + 9 workspaces |
| Unit tests | `npm run test:unit` | ✅ **324 passed**, 18 files |
| **Integration gate** | `npm run test:integration:gate` | ✅ **132 passed, 0 failed, 0 skipped**, 6 files, exit 0 — real MongoDB and Redis, no mocks |
| i18n keys | `npm run check:i18n` | ✅ |
| Secret scan | `npm run check:secrets` | ✅ 212 files, no credential patterns |
| Documentation links | link check over all Markdown | ✅ 44 files, 294 relative links, 0 broken |
| Production build | `npm run build` | ✅ web, api, worker |
| Bundle budget | `npm run check:bundle` | ✅ 589.9 kB / 187.1 kB gzip (budget 650 / 210) |
| E2E | `npm run test:e2e` | ✅ **14 passed** — 7 desktop-chromium + 7 mobile-chromium; every test starts in Arabic RTL, 2 per viewport also assert English LTR |
| Dependency audit | `npm run check:deps` | ✅ 0 vulnerabilities |
| Arabic PDF integrity | `sha256sum` working tree + committed blob | ✅ `89fade53…99f7b` — unchanged |
| Built API smoke | `node apps/api/dist/main.js` | ✅ starts, connects to Redis and MongoDB with transactions; 33 OpenAPI paths and 0 broken `$ref`s; `POST /auth/login` for an unknown account → 401; `GET /me` without a token → 401 |
| Hosted CI | `.github/workflows/ci.yml` | ⚠ defined, **never run** — no remote exists |

What the tests prove, beyond compiling: all 39 token pairs in use meet their WCAG thresholds and the ratios recorded in ADR-0005 are reproduced; lint rules fire on
fixtures (colors, physical CSS, dark mode, hard-coded text, module boundaries); secrets are redacted in
real log output; config errors never echo values; unknown fields are rejected; errors never leak
messages; locale and direction switch together with no mixed-language text; Alexandria and Inter
actually load; focus ring is 3px `#1D4ED8`; Light Mode holds under a dark system preference.

Added by this group, against **real MongoDB**: every mutating operation on an audit record is refused; a
mutation that records no audit event returns `500`; an out-of-scope record and an absent one produce
identical `404` bodies; a scoped total differs from the unscoped total on the same data (2 against 3); an
unsatisfiable scope returns nothing rather than everything; restricted fields are absent from list, single
read, and NDJSON export alike; keyset pages return each record exactly once; operator objects in filters and
in path parameters are rejected; self-grant, over-granting, and scope widening are refused and each refusal
is recorded; a grant written over HTTP changes the very next request's outcome, in both directions.

Added by the identity group, against **real MongoDB and Redis**: a wrong password and an unknown identifier
produce identical answers and comparable timing; an activation token works once and expires; a rotated
refresh token replays into a family-wide revocation; idle and absolute timeouts end a session while its
access token is still unexpired; suspension, offboarding, and a password change end a live session on the
next request; a TOTP code cannot be replayed and a recovery code works once; an MFA secret is stored as
ciphertext and appears in no audit record or log line; a privileged account cannot sign in without enrolling
a second factor, and a session created before the account became privileged loses its authority; every
throttle key carries a TTL and a successful sign-in clears the counter; 15 escalation attacks fail and leave
nothing changed.

## Requirement status (Phase 1, 113 IDs)

**`implemented` (59):** PLAT-001, 002, 003, 006, 008, 010, 011, 012, 013, 014\*, 015\*, 016\*, 021 ·
OPS-001, 002, 003 · TEST-001, 002†, 003 · SEC-001, 004, 007, 009 · I18N-001–009 (9) ·
THEME-001–008, 010, 011, 012 (11) · **AUDIT-001–006 (6)** · **SEC-023–032 (10)** ·
**SEC-002, 010, 011–022 (14)**

Per-ID evidence for the 16 added on 2026-09-21 is in `docs/REQUIREMENTS.md` → "Implementation evidence —
audit and authorization core". `AUDIT-005` covers permission, role, and scope changes and authorization
denials; its **authentication**-event half exists as a tested method that no flow calls yet (`SEC-013`).

\* **Now verified against real services** (integration tier, 2026-09-21): `PLAT-014` reports
`transactions: true` against `rs0`, `PLAT-015` answers `PING`, `PLAT-016`/`INTEGRATION-006` prove a
duplicate enqueue creates one job. † Local `npm run verify`; hosted CI never run.

`INTEGRATION-006` moved from `in-progress` to integration-verified behaviour (idempotent enqueue proven
against real Redis); it stays `in-progress` overall because the adapter registry it belongs to is not built.

**`in-progress` (9):** PLAT-007 (request, logs, jobs, **and audit** done; provider correlation waits for
adapters) · PLAT-017 (interface and policy; no S3 adapter) · SEC-003 (authentication endpoints now
throttled per address and per identifier; export and provider-triggering endpoints not built) · SEC-005
(validation + hook; no upload endpoint or scanner) · SEC-006 (env-only secrets; Secrets Manager not
integrated) · SEC-008 (TTL policy only) · SEC-033 (interface + **configured** dev encryptor; **no KMS
adapter**, so staging and production cannot store an MFA secret) · INTEGRATION-006 (job IDs, retries, DLQ;
proven against real Redis, adapter registry not built) · THEME-009 (series order + test; no chart component)

`SEC-002` moved to `implemented`: cookie authentication now exists, and its protection is the
`SameSite=Strict` `HttpOnly` path-scoped cookie plus the origin guard. A double-submit token would add
nothing while both hold; it becomes necessary only if a cookie ever needs `SameSite=Lax`.

**Not started (31):** APPROVAL-001–007 · INTEGRATION-001–005 · CORE-NOTIFY-001–005 · CORE-TASK-001–005 ·
CORE-DOC-001–006 · CORE-SEARCH-001 · CORE-IMPORT-001–002

## Next exact task

1. **Stopped for review of the identity and authentication group.** Do not start Phase 2, and do not begin
   the next group until instructed.
2. The remaining Phase 1 scope, in dependency order: `APPROVAL-001`–`007` (the approval engine, which
   needs the maker-checker rules `SEC-031` already has the escalation half of), then `CORE-NOTIFY` (which
   also unblocks invitation and reset **delivery** for `SEC-012` and `SEC-016`), then `CORE-TASK`,
   `CORE-DOC`, `CORE-SEARCH`, `CORE-IMPORT`, and `INTEGRATION-001`–`005`.
3. Start the services before any integration work: `npm run dev:services:up`.
4. To sign in locally, create the first account once:
   `BOOTSTRAP_ADMIN_EMAIL=… npm run bootstrap:admin`. It prints an activation token and sets no password.

## Approved decisions

- Arabic-first; Arabic and English together. Alexandria / Inter, self-hosted.
- **Light Mode only** (`SD-13` closed). Tokens per ADR-0005; `tokens.ts` is the only file with color values.
- Primary `#2563EB`; hover `#1D4ED8`; pressed `#1E40AF`; soft `#EFF6FF`; soft-strong `#DBEAFE`; on-primary
  `#FFFFFF`; focus ring `#1D4ED8`.
- Modular monolith with lint-enforced boundaries (enforced and tested as of this commit).
- Server-side authorization inside queries; decimal-safe money; UTC storage; no hard deletes.
- **Meta: full Master Mapping scope** (`SD-14`); billing honesty per ADR-0011. **CAPI** optional, production
  delivery off by default (ADR-0017).
- **Dev infrastructure:** local Docker MongoDB replica set + Redis for development (ADR-0020); Atlas +
  managed Redis remain the staging/production direction (ADR-0018). No production credentials anywhere.
- Sources of truth: `CLAUDE.md`, this file, Master Mapping, Phase Prompts, approved ADRs. Arabic PDF supplementary.
- Requirement IDs: nine Phase 1 namespaces (ADR-0016); `SEC` / `CORE-ORG` / `HR-EMP` boundary (ADR-0019).
- **Western digits (0–9) in Arabic and English** (`SD-23`, ADR-0003); display only, storage language-neutral.
- Arabic PDF committed as a supplementary reference (`docs/source/`), never edited.
- **Audit integrity** (ADR-0021): append-only enforced in three application layers; the privileged-operator
  limit documented and **no cryptographic tamper-proofing claimed**; "every mutation is audited" asserted at
  runtime; keyset pagination; summaries only.
- **Authorization resolved per request** (ADR-0022): no permission cache, so `SEC-032` holds by
  construction. Adding a cache later needs a bounded TTL, explicit invalidation, a test, and its own ADR.
- Domain errors carry a **published stable code**; `ERROR_STATUS` in contracts is the single code → status
  map. A code outside the published list never chooses its own status. A throttled answer also carries
  `Retry-After`.
- **Passwords, tokens, and the second factor** (ADR-0023): Argon2id at the OWASP minimum through
  `@node-rs/argon2` with transparent rehash; a length-first password policy and no composition rules; a
  short-lived JWT access token that is **never trusted alone**; opaque rotated refresh tokens in a
  `SameSite=Strict` `HttpOnly` cookie with family revocation on replay; TOTP with a stored accepted step
  and independently hashed single-use recovery codes; TTL-bounded throttling that can never become a
  permanent lockout; no default administrator.
- Administrative account routes are **never** applied to the caller's own account: the self-service route
  asks for the password first.
- Web bundle budget: ≤ 650 kB minified / ≤ 210 kB gzip per chunk; route splitting before feature-heavy phases.
- Git: local commits authorized. **No remote, no push, no deploy.**

## Implementation notes a later session needs

- **Path contains `&`.** npm's Windows `.cmd` shims break on it, so every script runs tools through
  `node scripts/bin.mjs <tool>`. Don't replace those with bare tool names. Moving the repository to a
  path without `&` removes the problem.
- Integration tests use the `.int-test.ts` suffix; unit tests `.test.ts`. The integration config loads `.env`.
- Start services with `npm run dev:services:up` (idempotent). It reuses `docker/dev.env` credentials, so
  deleting that file while the volumes exist orphans the MongoDB users — remove the volumes too for a clean
  start. `down` never deletes volumes.
- `scripts/dev-services.mjs` assembles connection user-info separately from the scheme so no source line
  spells `scheme://user:password@`, which keeps the secret scan strict rather than needing an exception.
- Internal packages ship TypeScript source (`exports: ./src/index.ts`); the API and worker production
  builds bundle them with esbuild and keep third-party dependencies external.
- `react-i18next` deliberately not used: `LocaleProvider` + `getFixedT(locale)` keeps language, direction,
  and theme in one state. i18next has no fallback language, so a missing key can never render English.
- Formatting: always through `createFormatters` (`packages/i18n`). It forces `-u-nu-latn`; `ar-EG` would
  otherwise produce Arabic-Indic digits. Dates are assembled as `dd/MM/yyyy` from timezone-resolved parts.
- Identifiers (phone, national ID, account/IBAN, unit code) are **never** reformatted: displayed verbatim
  inside `LtrIsolate`. Tested in `packages/ui/src/components.test.tsx`.
- Running `npm run format` and `npm run test:unit` in one chained command can make vitest collect a
  partial set while files are being rewritten. Run them as separate commands before trusting a count.
- The integration gate sets `ALOLA_REQUIRE_INTEGRATION_SERVICES=1` via `scripts/integration-gate.mjs`.
- MUI 9 removed `containedPrimary`-style override keys; use `styleOverrides.root.variants`.
- TypeScript is 6.0.3, not 7.x: typescript-eslint supports `<6.1`. jsdom is 29.1.1: 30.x needs Node ≥24.15.
- Playwright Chromium is installed under the user profile on `C:` (~115 MB).
- Mongoose rejects an inline nested object that also carries options such as `required`: it reads the option
  as another path ("`true` is not a valid type at path `required`"). Declare sub-schemas explicitly with
  `new Schema({...}, { _id: false })`, as the audit and security models do.
- With every field `immutable: true` **and** `strict: 'throw'`, editing a loaded audit document fails as a
  `StrictModeError` during validation, **before** the `pre('save')` hook runs. Both paths are refused;
  assert the refusal and the unchanged stored value rather than one specific error class.
- Type test helper overrides as the schema's **input** (`z.input<typeof Schema>`), not its output.
  `ScopeAssignment`'s reference arrays use `.default([])`, so the output type requires them and
  `{ level: 'all' }` will not typecheck against it.
- `req.params` values are `string | string[]` in Express 5. Validate path parameters with strict Zod
  schemas; never pass a raw param into a query.
- Tests obey the ADR-0001 module boundary too: reach another module only through its index (`../audit`),
  never `../audit/model`. The lint rule covers test files.
- The integration suites clean up with the raw driver, because the application has no delete path for audit
  records. That is the privileged path ADR-0021 documents as the residual risk, not a loophole.
- A new route that legitimately mutates nothing must call `markAuditExempt(res)`, or `assertMutationAudited`
  turns its success into a `500`. Domain mutations are never exempt.
- `argon2` (the npm package named in MM §4.3) **cannot be installed here**: its install script runs
  `cross-env`, whose Windows shim breaks on the `&` in the path. `@node-rs/argon2` is used instead, same
  algorithm, no install script (ADR-0023 §1).
- `@node-rs/argon2` exports `Algorithm` as an ambient const enum, which `verbatimModuleSyntax` cannot
  import as a value. The numeric variant is passed and a unit test asserts the `$argon2id$` prefix.
- A Zod schema with `.transform` **cannot** become a JSON Schema, and the OpenAPI document is generated
  from the contracts. Validate in the schema; normalize in the service.
- An account holding any administrative permission needs a second factor (`SEC-017`), so **every test
  fixture for an administrator must complete the enrol-or-verify flow** — a plain password sign-in returns
  `mfaRequired`, not a session. Advance the test clock by 31 seconds per code so a step is never reused.
- The integration suites send `X-Forwarded-For` with `TRUST_PROXY_HOPS: 1` so each logical client gets its
  own address; otherwise one shared loopback address spends the whole per-IP budget for the file.
- Sessions and tokens live in MongoDB with a `purgeAfter` TTL index; Redis holds only throttle counters.
  Deleting Redis data can never lock an account out.

## Database state

- Schema version: 1 (audit records carry `schemaVersion`) · Migrations: none · Seed data: **none**
- Collections: `auditEvents` (append-only), `roles`, `accountGrants`, `securityAccounts`, `authSessions`,
  `authRefreshTokens`, `accountTokens` — 7 collections, 24 named indexes, created explicitly by
  `apps/api/src/platform/indexes.ts` at startup; the full list is in `architecture/security-model.md` §9.
- Session, refresh-token, and account-token rows carry a `purgeAfter` TTL index. The audit trail is
  separate and permanent.
- No role, permission assignment, scope value, or **account** is seeded: role content is `SD-02`/`SD-01`
  stakeholder input, and there is deliberately no default administrator. A fresh database authenticates
  nobody and authorizes nobody until `npm run bootstrap:admin` is run once.
- Mongoose configured `strict: 'throw'`, `strictQuery: 'throw'`, `autoIndex`/`autoCreate` off.

## Integration state

| Integration | Status | Notes |
|---|---|---|
| MongoDB | **Running locally** (Docker `rs0`) | ADR-0020; readiness reports transaction support; audit and authorization collections in use |
| Redis | **Running locally** (Docker) | ADR-0020; rate limiting and BullMQ |
| AWS S3 / KMS | Interfaces only | Unconfigured implementations fail loudly |
| WhatsApp / Meta / email / SMS / gateway | Not started | Phase 3+ |
| Meta Conversions API | Not started | Optional; production delivery gated (ADR-0017) |

## Blockers

| ID | Blocker | Blocks |
|---|---|---|
| Phase 1 scope | 44 of 113 requirements not started; 10 in progress | **Phase 1 approval** (phase-gates §1) |
| Stakeholder gate | Demonstration and written approval outstanding | **Phase 1 approval** |
| `SD-01`–`SD-12`, `SD-17`–`SD-21` | Open stakeholder decisions (17) | Their assigned phases — none blocks Phase 1 |

`D2` is **closed**: development services exist and the integration tier passes with zero skips.

## Risks and technical debt

| Item | Mitigation / next step |
|---|---|
| Hosted CI has never run (no remote) | Run `npm run verify` + E2E locally before each commit until a remote exists |
| Secret scan is pattern-based, not a dedicated scanner | Add a dedicated scanner when CI exists |
| **`SEC-033` (KMS) is not implemented**, so staging and production cannot store an MFA secret | Development and test use a configured local key, refused outside development. The KMS adapter is the blocker for enabling MFA anywhere real (ADR-0023 §6) |
| Invitation and password-reset **delivery** does not exist | `CORE-NOTIFY`. An administrator issues and hands over the token meanwhile; the self-service request reveals nothing |
| The password blocklist is a short built-in list, not a breach corpus | Replace with a checked corpus when one is available (`SD-18` operational scope); it is a data change, not a redesign |
| An account holding administrative permissions must carry an authenticator application | That is `SEC-017`. The administrative MFA reset exists as the recovery path and is itself audited and refused on the caller's own account |
| Audit retention and archival are not implemented; the collection grows without bound | Retention policy is `SD-18`/Phase 9. The existing indexes already support time-range scans |
| An operator with direct database access can still alter audit records | ADR-0021 §2 records this as an operational control — restricted database roles, append-only backups — not an application one |
| The test actor resolver could be mistaken for authentication | It exists only inside integration tests; the production default resolver returns no actor, and both are commented to say so |
| Web bundle 585 kB in one chunk (above Vite's 500 kB advisory) | Budget enforced by `check:bundle`; route-level splitting before feature-heavy phases (latest: first Phase 2 feature screens) |
| Local topology is a single-node replica set, so failover is not exercised | Accepted for development; staging on Atlas is multi-node (ADR-0020) |
| Docker Desktop + WSL 2 are now prerequisites for the integration tier | Documented in environments.md §5; unit tests, lint, typecheck and build still need no services |
| `C:` free space dropped from ~21 GB to ~17 GB during the session (not caused by this project's ~0.6 GB) | Re-check before large installs |

## Handoff summary

Local commits: documentation baseline (`7a840b3`), Phase 1 scaffolding (`4c988db`), Phase 1 review decisions
(`4365775`), development services and the integration gate (`dfc0ac5`), the audit subsystem plus
authorization core (`3d6bdf1`), and identity and authentication added on 2026-09-21.

`SEC-010` and `SEC-011`–`SEC-022` are implemented with passing tests: security accounts with an opaque
employee reference and no employee data, invitation and activation, Argon2id passwords with a length-first
policy, short-lived access tokens that are never trusted alone, rotated refresh cookies with family
revocation on replay, TOTP with replay protection and single-use recovery codes, device and session listing
with individual and bulk revocation, suspension and offboarding without deletion, immediate server-side
invalidation, personal-account uniqueness, and a 15-attack privilege-escalation suite. There is no default
administrator: `npm run bootstrap:admin` runs once and sets no password.

`AUDIT-001`–`006` and `SEC-023`–`032` are implemented with passing tests: an append-only audit store whose
immutability is enforced in three application layers and whose limits are documented rather than overstated,
a query and export surface that audits its own reads, and an authorization core that denies by default,
applies the data scope inside the query, strips restricted fields from every serialization path, answers
`404` rather than `403` for an out-of-scope record, refuses privilege escalation and records the attempt,
and takes effect on the next request with no cache to invalidate.

The full verification suite is green: format, lint, strict typecheck (root + 9 workspaces), **324 unit
tests**, **integration gate 132 passed / 0 failed / 0 skipped against real MongoDB and Redis**, i18n keys,
secret scan (212 files), documentation links, production build, bundle budget, **14 E2E tests** across
desktop and mobile in Arabic RTL and English LTR, and 0 dependency vulnerabilities. The built API starts and
answers `401` on both `/auth/login` for an unknown account and `/me` without a token. The Arabic PDF is
byte-identical (`89fade53…99f7b`). `.env` and `docker/dev.env` remain ignored and untracked.

**PHASE 1 IS NOT APPROVED.** 31 of 113 Phase 1 requirements are not started — `APPROVAL`, `INTEGRATION`,
`CORE-NOTIFY`, `CORE-TASK`, `CORE-DOC`, `CORE-SEARCH`, `CORE-IMPORT` — 9 are in progress, no requirement is
`verified`, and the gate requires a stakeholder demonstration plus written approval. `SEC-033` (KMS) remains
unimplemented, which blocks MFA in staging and production. Stopped for review of this group. Phase 2 not
started. No remote, nothing pushed, nothing deployed.
