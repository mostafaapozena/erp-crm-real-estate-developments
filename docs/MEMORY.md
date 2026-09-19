# ALOLA ERP — Project Memory

Last updated: 2026-09-19
Blueprint documents: `MASTER-MAPPING.md` v2.0, `PHASE-PROMPTS.md` v2.0
Repository: local Git · Branch: `main` · **No remote, nothing pushed, nothing deployed**
Commits: `7a840b3` documentation baseline → Phase 1 scaffolding (the commit containing this file)

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
- Sub-stage: Build half — **application scaffolding complete; stopped for Phase 1 review**
- Requirements `verified`: **0** (nothing is gate-verified before stakeholder review)
- Requirements `implemented` (code + passing tests): **43 of 111** · `in-progress`: 10 · not started: 58

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

## Verification — actual results, 2026-09-19

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | ✅ 91 files, 0 errors, 0 warnings |
| Format | `npm run format:check` | ✅ |
| Typecheck (strict) | `npm run typecheck` | ✅ root + 9 workspaces |
| i18n keys | `npm run check:i18n` | ✅ |
| Secret scan | `npm run check:secrets` | ✅ no credential patterns |
| Unit tests | `npm run test:unit` | ✅ **204 passed**, 14 files, 10 projects |
| Production build | `npm run build` | ✅ web, api, worker. Warning: web JS chunk 582 kB (> 500 kB) |
| E2E | `npm run test:e2e` | ✅ **14 passed** — desktop + mobile Chromium, Arabic RTL and English LTR |
| Integration | `npm run test:integration` | ⏭ **3 skipped, 0 run** — no Atlas/Redis (`D2`). **Not a pass.** |
| Dependency audit | `npm run check:deps` | ✅ 0 vulnerabilities |
| Built API smoke | `node apps/api/dist/main.js` | ✅ value-free config errors, exit 1; with config: live 200, ready 503 `not_configured` per dependency |
| Hosted CI | `.github/workflows/ci.yml` | ⚠ defined, **never run** — no remote |

What the tests prove, beyond compiling: all 39 token pairs in use meet their WCAG thresholds and the ratios recorded in ADR-0005 are reproduced; lint rules fire on
fixtures (colors, physical CSS, dark mode, hard-coded text, module boundaries); secrets are redacted in
real log output; config errors never echo values; unknown fields are rejected; errors never leak
messages; locale and direction switch together with no mixed-language text; Alexandria and Inter
actually load; focus ring is 3px `#1D4ED8`; Light Mode holds under a dark system preference.

## Requirement status (Phase 1, 111 IDs)

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

**Not started (58):** SEC-010–032 (identity, sessions, MFA, RBAC, scopes, field restriction) · AUDIT-001–006 ·
APPROVAL-001–006 · INTEGRATION-001–005 · CORE-NOTIFY-001–005 · CORE-TASK-001–004 · CORE-DOC-001–006 ·
CORE-SEARCH-001 · CORE-IMPORT-001–002

## Next exact task

1. **Stop for Phase 1 scaffolding review.** Do not start Phase 2.
2. On approval, continue Phase 1 with the next bounded group: `AUDIT-001`–`006` and `SEC-023`–`032`
   (audit store, permission catalog, scoped repository) — they are prerequisites for every later feature.
3. Provision `D2` (Atlas development cluster + Redis) so the integration tier and transaction-dependent
   verification can run.

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
- Requirement IDs: nine Phase 1 namespaces (ADR-0016).
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
- The `ar` locale formats with Western digits by default (`ar-EG` uses Arabic-Indic): open as `SD-23`.
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
| `D2` | Atlas dev cluster and Redis not provisioned | Integration tier; transaction verification; Phase 1 gate |
| `SD-01`–`SD-12`, `SD-17`–`SD-21`, `SD-23` | Open stakeholder decisions (18) | Their assigned phases — none blocks Phase 1 scaffolding |

## Risks and technical debt

| Item | Mitigation / next step |
|---|---|
| Hosted CI has never run (no remote) | Run `npm run verify` + E2E locally before each commit until a remote exists |
| Secret scan is pattern-based, not a dedicated scanner | Add a dedicated scanner when CI exists |
| Web bundle 582 kB in one chunk | Code-split by route when routes exist |
| Integration tier untested | Provision `D2` |
| Arabic PDF is untracked in the working tree | Intentionally not committed; decide whether to commit it or ignore it |
| `C:` free space dropped from ~21 GB to ~17 GB during the session (not caused by this project's ~0.6 GB) | Re-check before large installs |

## Handoff summary

Documentation baseline committed (`7a840b3`). Phase 1 scaffolding implemented and verified locally: lint,
format, strict typecheck, i18n keys, secret scan, 204 unit tests, production build, 14 bilingual E2E tests,
and dependency audit all pass. Integration tests are skipped pending `D2`, and that is **not** a pass.
Stopped for Phase 1 review. Nothing pushed or deployed.
