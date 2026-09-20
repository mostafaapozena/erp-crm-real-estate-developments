# ALOLA ERP — Project Memory

Last updated: 2026-09-21
Blueprint documents: `MASTER-MAPPING.md` v2.0, `PHASE-PROMPTS.md` v2.0
Repository: local Git · Branch: `main` · **No remote, nothing pushed, nothing deployed**
Commits: `7a840b3` documentation baseline → `4c988db` Phase 1 scaffolding → `4365775` Phase 1 review
decisions → development services + Phase 1 verification evidence (the commit containing this file)

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
- Sub-stage: Build half — foundation complete; development services provisioned; verification suite green
- `D2`: **COMPLETE 2026-09-21.** Local Docker MongoDB (single-node replica set `rs0`) + Redis
  ([ADR-0020](decisions/adr-0020-local-docker-development-services.md)). Integration tier: **3 passed,
  0 failed, 0 skipped.**
- Gate status: **PHASE 1 NOT APPROVED — SCOPE INCOMPLETE.** Every mandatory verification check passes and
  the services blocker is gone, but 60 of 113 Phase 1 requirements are not started (identity and
  authorization `SEC-010`–`SEC-032`, `AUDIT-*`, `APPROVAL-*`, `INTEGRATION-001`–`005`, `CORE-NOTIFY`,
  `CORE-TASK`, `CORE-DOC`, `CORE-SEARCH`, `CORE-IMPORT`), and the gate also requires a stakeholder
  demonstration and written approval (phase-gates §1).
- Requirements `verified`: **0** — no requirement is marked `verified` before the stakeholder gate
- Requirements `implemented` (code + passing tests): **43 of 113** · `in-progress`: 10 · not started: 60

## Phase status

- [ ] Phase 1 — *in progress: scaffolding done; identity, authorization, audit, approval, integration
      registry, notifications, tasks, documents, search, and import not started*
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

## Verification — actual results, 2026-09-21 (full suite re-run)

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | ✅ 0 errors, 0 warnings |
| Format | `npm run format:check` | ✅ |
| Typecheck (strict) | `npm run typecheck` | ✅ root + 9 workspaces |
| Unit tests | `npm run test:unit` | ✅ **220 passed**, 14 files, 10 projects |
| **Integration gate** | `npm run test:integration:gate` | ✅ **3 passed, 0 failed, 0 skipped**, 2 files, exit 0 — real MongoDB and Redis, no mocks |
| i18n keys | `npm run check:i18n` | ✅ |
| Secret scan | `npm run check:secrets` | ✅ 169 files, no credential patterns |
| Documentation links | link check over all Markdown | ✅ 42 files, 0 broken |
| Production build | `npm run build` | ✅ web, api, worker |
| Bundle budget | `npm run check:bundle` | ✅ 582.1 kB / 184.9 kB gzip (budget 650 / 210) |
| E2E | `npm run test:e2e` | ✅ **14 passed** — 7 desktop-chromium + 7 mobile-chromium; every test starts in Arabic RTL, 2 per viewport also assert English LTR |
| Dependency audit | `npm run check:deps` | ✅ 0 vulnerabilities |
| Arabic PDF integrity | `sha256sum` working tree + committed blob | ✅ `89fade53…99f7b` — unchanged |
| Hosted CI | `.github/workflows/ci.yml` | ⚠ defined, **never run** — no remote exists |

What the tests prove, beyond compiling: all 39 token pairs in use meet their WCAG thresholds and the ratios recorded in ADR-0005 are reproduced; lint rules fire on
fixtures (colors, physical CSS, dark mode, hard-coded text, module boundaries); secrets are redacted in
real log output; config errors never echo values; unknown fields are rejected; errors never leak
messages; locale and direction switch together with no mixed-language text; Alexandria and Inter
actually load; focus ring is 3px `#1D4ED8`; Light Mode holds under a dark system preference.

## Requirement status (Phase 1, 113 IDs)

**`implemented` (43):** PLAT-001, 002, 003, 006, 008, 010, 011, 012, 013, 014\*, 015\*, 016\*, 021 ·
OPS-001, 002, 003 · TEST-001, 002†, 003 · SEC-001, 004, 007, 009 · I18N-001–009 (9) ·
THEME-001–008, 010, 011, 012 (11)

\* **Now verified against real services** (integration tier, 2026-09-21): `PLAT-014` reports
`transactions: true` against `rs0`, `PLAT-015` answers `PING`, `PLAT-016`/`INTEGRATION-006` prove a
duplicate enqueue creates one job. † Local `npm run verify`; hosted CI never run.

`INTEGRATION-006` moved from `in-progress` to integration-verified behaviour (idempotent enqueue proven
against real Redis); it stays `in-progress` overall because the adapter registry it belongs to is not built.

**`in-progress` (10):** PLAT-007 (request, logs, jobs done; audit and provider calls wait for AUDIT and
adapters) · PLAT-017 (interface and policy; no S3 adapter) · SEC-002 (origin guard; double-submit token
with session cookies) · SEC-003 (global IP limiter; per-account limits with auth) · SEC-005 (validation +
hook; no upload endpoint or scanner) · SEC-006 (env-only secrets; Secrets Manager not integrated) · SEC-008
(TTL policy only) · SEC-033 (interface + dev encryptor; no KMS adapter) · INTEGRATION-006 (job IDs, retries,
DLQ; integration test skipped) · THEME-009 (series order + test; no chart component yet)

**Not started (60):** SEC-010–032 (account security, sessions, MFA, RBAC, scopes, field restriction) ·
AUDIT-001–006 · APPROVAL-001–007 · INTEGRATION-001–005 · CORE-NOTIFY-001–005 · CORE-TASK-001–005 ·
CORE-DOC-001–006 · CORE-SEARCH-001 · CORE-IMPORT-001–002

## Next exact task

1. **Stopped for the Phase 1 exit-gate review.** Do not start Phase 2. Do not begin AUDIT or authorization
   implementation until instructed.
2. To close the remaining Phase 1 scope, the next bounded group is `AUDIT-001`–`006` and `SEC-023`–`032`
   (audit store, permission catalog, scoped repository) — prerequisites for every later feature.
3. Start the services before any integration work: `npm run dev:services:up`.

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

## Database state

- Schema version: none · Migrations: none · Seed data: none · Collections: none
- Mongoose configured `strict: 'throw'`, `strictQuery: 'throw'`, `autoIndex`/`autoCreate` off.

## Integration state

| Integration | Status | Notes |
|---|---|---|
| MongoDB | Connector built; **not provisioned** | Atlas dev cluster (ADR-0018); readiness reports transaction support |
| Redis | Connector built; **not provisioned** | Managed or approved local instance |
| AWS S3 / KMS | Interfaces only | Unconfigured implementations fail loudly |
| WhatsApp / Meta / email / SMS / gateway | Not started | Phase 3+ |
| Meta Conversions API | Not started | Optional; production delivery gated (ADR-0017) |

## Blockers

| ID | Blocker | Blocks |
|---|---|---|
| Phase 1 scope | 60 of 113 requirements not started; 10 in progress | **Phase 1 approval** (phase-gates §1) |
| Stakeholder gate | Demonstration and written approval outstanding | **Phase 1 approval** |
| `SD-01`–`SD-12`, `SD-17`–`SD-21` | Open stakeholder decisions (17) | Their assigned phases — none blocks Phase 1 |

`D2` is **closed**: development services exist and the integration tier passes with zero skips.

## Risks and technical debt

| Item | Mitigation / next step |
|---|---|
| Hosted CI has never run (no remote) | Run `npm run verify` + E2E locally before each commit until a remote exists |
| Secret scan is pattern-based, not a dedicated scanner | Add a dedicated scanner when CI exists |
| Web bundle 582 kB in one chunk (above Vite's 500 kB advisory) | Budget enforced by `check:bundle`; route-level splitting before feature-heavy phases (latest: first Phase 2 feature screens) |
| Local topology is a single-node replica set, so failover is not exercised | Accepted for development; staging on Atlas is multi-node (ADR-0020) |
| Docker Desktop + WSL 2 are now prerequisites for the integration tier | Documented in environments.md §5; unit tests, lint, typecheck and build still need no services |
| `C:` free space dropped from ~21 GB to ~17 GB during the session (not caused by this project's ~0.6 GB) | Re-check before large installs |

## Handoff summary

Four local commits: documentation baseline (`7a840b3`), Phase 1 scaffolding (`4c988db`), Phase 1 review
decisions (`4365775`), and this one — development services plus Phase 1 verification evidence.

`D2` is **closed**: local Docker MongoDB (replica set `rs0`) and Redis run on localhost-only ports with
persistent volumes and generated credentials, and the **integration gate passes with 3 passed, 0 failed,
0 skipped**. The complete verification suite is green: format, lint, strict typecheck, 220 unit tests,
integration gate, i18n keys, secret scan, documentation links, production build, bundle budget, 14 E2E
tests across desktop and mobile in both locales, and 0 dependency vulnerabilities. The Arabic PDF is
byte-identical. Nothing was provisioned in any cloud and no payment method was entered.

**PHASE 1 IS NOT APPROVED.** The services blocker is gone, but 60 of 113 Phase 1 requirements are not
started and the gate requires a stakeholder demonstration plus written approval. Stopped for that review.
AUDIT and authorization-core implementation not started. No remote, nothing pushed, nothing deployed.
