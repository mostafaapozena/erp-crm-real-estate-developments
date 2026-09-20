# ALOLA ERP — Project Memory

Last updated: 2026-09-20
Blueprint documents: `MASTER-MAPPING.md` v2.0, `PHASE-PROMPTS.md` v2.0
Repository: local Git · Branch: `main` · **No remote, nothing pushed, nothing deployed**
Commits: `7a840b3` documentation baseline → `4c988db` Phase 1 scaffolding → Phase 1 review decisions
(the commit containing this file, created during recovery on 2026-09-20)

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
- Sub-stage: Build half — scaffolding complete and reviewed; review decisions applied
- Gate status: **PHASE 1 BLOCKED — DEVELOPMENT SERVICES NOT CONFIGURED** (`D2`). Phase 1 cannot be
  approved while MongoDB and Redis integration tests are skipped; `npm run test:integration:gate` fails.
- Requirements `verified`: **0** (nothing is gate-verified before stakeholder review)
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

## Verification — actual results, 2026-09-19 (re-verified 2026-09-20)

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | ✅ 0 errors, 0 warnings |
| Format | `npm run format:check` | ✅ |
| Documentation links | link check over all Markdown | ✅ 41 files, 242 relative links, 0 broken |
| Typecheck (strict) | `npm run typecheck` | ✅ root + 9 workspaces |
| i18n keys | `npm run check:i18n` | ✅ |
| Secret scan | `npm run check:secrets` | ✅ no credential patterns |
| Unit tests | `npm run test:unit` | ✅ **220 passed**, 14 files, 10 projects — stable across 3 consecutive runs (2026-09-20) |
| Production build | `npm run build` | ✅ web, api, worker. Warning: web JS chunk 582 kB (> 500 kB) |
| E2E | `npm run test:e2e` | ✅ **14 passed** — desktop + mobile Chromium, Arabic RTL and English LTR |
| Integration | `npm run test:integration` | ⏭ **3 skipped, 0 run** — no Atlas/Redis (`D2`). **Not a pass.** |
| Integration gate | `npm run test:integration:gate` | ❌ **Fails by design** — `PHASE GATE FAILED — integration services not configured` |
| Bundle budget | `npm run check:bundle` | ✅ 582.1 kB / 184.9 kB gzip (budget 650 / 210) |
| Dependency audit | `npm run check:deps` | ✅ 0 vulnerabilities |
| Built API smoke | `node apps/api/dist/main.js` | ✅ value-free config errors, exit 1; with config: live 200, ready 503 `not_configured` per dependency |
| Hosted CI | `.github/workflows/ci.yml` | ⚠ defined, **never run** — no remote |

What the tests prove, beyond compiling: all 39 token pairs in use meet their WCAG thresholds and the ratios recorded in ADR-0005 are reproduced; lint rules fire on
fixtures (colors, physical CSS, dark mode, hard-coded text, module boundaries); secrets are redacted in
real log output; config errors never echo values; unknown fields are rejected; errors never leak
messages; locale and direction switch together with no mixed-language text; Alexandria and Inter
actually load; focus ring is 3px `#1D4ED8`; Light Mode holds under a dark system preference.

## Requirement status (Phase 1, 113 IDs)

**`implemented` (43):** PLAT-001, 002, 003, 006, 008, 010, 011, 012, 013, 014\*, 015\*, 016\*, 021 ·
OPS-001, 002, 003 · TEST-001, 002†, 003 · SEC-001, 004, 007, 009 · I18N-001–009 (9) ·
THEME-001–008, 010, 011, 012 (11)

\* Connection code done; untested against real services until `D2`. † Local `npm run verify`; hosted CI never run.

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
2. Provision `D2` — development values only, in the untracked `.env`:
   `MONGODB_URI`, `MONGODB_DB_NAME` (Atlas **development** cluster), `REDIS_URL` (managed dev or approved
   local instance). Then `npm run test:integration:gate` must report 3 passed, 0 skipped.
3. When instructed: `AUDIT-001`–`006` and `SEC-023`–`032` (audit store, permission catalog, scoped
   repository).

## Approved decisions

- Arabic-first; Arabic and English together. Alexandria / Inter, self-hosted.
- **Light Mode only** (`SD-13` closed). Tokens per ADR-0005; `tokens.ts` is the only file with color values.
- Primary `#2563EB`; hover `#1D4ED8`; pressed `#1E40AF`; soft `#EFF6FF`; soft-strong `#DBEAFE`; on-primary
  `#FFFFFF`; focus ring `#1D4ED8`.
- Modular monolith with lint-enforced boundaries (enforced and tested as of this commit).
- Server-side authorization inside queries; decimal-safe money; UTC storage; no hard deletes.
- **Meta: full Master Mapping scope** (`SD-14`); billing honesty per ADR-0011. **CAPI** optional, production
  delivery off by default (ADR-0017).
- **Dev infrastructure:** Atlas dev cluster + Redis adapter; no Docker; no production credentials (ADR-0018).
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
| `D2` | Atlas dev cluster and Redis not provisioned | **Phase 1 gate** (`test:integration:gate` fails); transaction verification |
| `SD-01`–`SD-12`, `SD-17`–`SD-21` | Open stakeholder decisions (17) | Their assigned phases — none blocks Phase 1 |

## Risks and technical debt

| Item | Mitigation / next step |
|---|---|
| Hosted CI has never run (no remote) | Run `npm run verify` + E2E locally before each commit until a remote exists |
| Secret scan is pattern-based, not a dedicated scanner | Add a dedicated scanner when CI exists |
| Web bundle 582 kB in one chunk (above Vite's 500 kB advisory) | Budget enforced by `check:bundle`; route-level splitting before feature-heavy phases (latest: first Phase 2 feature screens) |
| Integration tier untested | Provision `D2` |
| `C:` free space dropped from ~21 GB to ~17 GB during the session (not caused by this project's ~0.6 GB) | Re-check before large installs |

## Handoff summary

Documentation baseline (`7a840b3`) and Phase 1 scaffolding (`4c988db`) committed. The Phase 1 review
decisions (SEC boundary, PDF, `SD-23`, integration gate, bundle budget) were written by a session that hit
its usage limit before committing; recovery on 2026-09-20 verified them against the repository, fixed one
placeholder defect, added the identifier tests decision C required, and committed them as one commit.
All local quality checks pass: format, lint, strict typecheck, i18n keys, documentation links, secret scan,
220 unit tests, bundle budget.
**PHASE 1 BLOCKED — DEVELOPMENT SERVICES NOT CONFIGURED:** integration tests are skipped pending `D2`,
which is not a pass, and `npm run test:integration:gate` fails by design. Stopped for the Phase 1
exit-gate review. AUDIT and authorization-core implementation not started. Nothing pushed or deployed.
