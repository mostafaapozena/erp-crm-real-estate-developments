# Dependencies

Selected 2026-09-19 for Phase 1 scaffolding. Every version is **pinned exactly** in the `package.json`
files (no `^` or `~`), and `package-lock.json` is the authoritative record, as
[ADR-0002](../decisions/adr-0002-technology-stack.md) requires. Versions were checked against the npm
registry on the day, and peer-dependency ranges were verified before selection.

Runtime: **Node.js 24** (`engines: >=24`, `.nvmrc`). Verified on Node 24.14.1 / npm 11.11.0.

## Language and quality tooling

| Package | Version | Why this version |
|---|---|---|
| typescript | 6.0.3 | Latest 6.x. **TypeScript 7.0 (the native compiler) was not selected**: typescript-eslint 8.70 supports `>=4.8.4 <6.1.0` only, and type-aware linting is required for PLAT-003. Revisit when typescript-eslint supports 7.x. |
| typescript-eslint | 8.70.0 | Latest; type-aware rules, ESLint 10 support |
| eslint / @eslint/js | 10.11.0 / 10.0.1 | Latest flat-config ESLint |
| eslint-plugin-react-hooks | 7.1.1 | Latest; supports ESLint 10 |
| globals | 17.12.0 | Environment globals for ESLint |
| prettier | 3.9.8 | Latest |
| vitest | 5.0.1 | Latest; supports Vite 8 and the `projects` workspace model |
| jsdom | 29.1.1 | **Not 30.x**: jsdom 30 requires Node ≥24.15; this machine runs 24.14.1. 29.1.1 supports `>=24.0.0`. |
| @testing-library/react / dom | 16.3.3 / 10.4.2 | Latest; React 19 support |
| supertest | 7.2.2 | API tests against the Express app without a network listener |
| @playwright/test | 1.63.0 | Latest; E2E in Chromium (desktop and mobile profiles) |
| tsx | 4.23.13 | Runs TypeScript in development (`dev` scripts, i18n check) |
| esbuild | 0.28.2 | Production bundling of the API and worker (bundles internal packages, keeps third-party dependencies external) |
| @types/node | 26.6.2 | Latest Node type definitions |

## Server

| Package | Version | Why |
|---|---|---|
| express | 5.2.1 | Express 5: native async error propagation |
| helmet | 8.3.0 | Security headers (SEC-001) |
| cors | 2.8.6 | Strict origin allow-list (SEC-001) |
| pino / pino-http | 10.3.1 / 11.0.0 | Structured logs with path redaction (PLAT-006, SEC-007) |
| mongoose | 9.10.1 | Strict schemas, `Decimal128`, transactions (PLAT-014) |
| ioredis | 6.0.0 | Redis client for rate limits and BullMQ (PLAT-015) |
| bullmq | 6.3.8 | Job queues with retries and backoff (PLAT-016) |
| rate-limiter-flexible | 11.2.1 | Redis-backed limiter with in-memory insurance (SEC-003) |
| zod | 4.6.5 | Validation and contracts; `z.toJSONSchema` generates the OpenAPI schemas (PLAT-010, PLAT-011) |
| decimal.js | 10.6.0 | Decimal arithmetic for money (PLAT-012) |

## Authentication (added 2026-09-21 with `SEC-010`–`SEC-022`)

| Package | Version | Why this version |
|---|---|---|
| @node-rs/argon2 | 2.2.1 | Argon2id password hashing (SEC-013). **Not `argon2`**, although Master Mapping §4.3 names it: that package's install script is `cross-env … node-gyp-build`, and `cross-env`'s Windows `.cmd` shim breaks on the `&` in this repository's path — the same defect that makes every script run through `scripts/bin.mjs`. `@node-rs/argon2` implements the same algorithm (RFC 9106), ships prebuilt platform binaries, has no install script, and needs no native toolchain. A unit test asserts the stored value really begins with `$argon2id$`. See [ADR-0023](../decisions/adr-0023-password-hashing-and-session-tokens.md) §1 |
| jose | 6.2.12 | Signed access tokens and MFA challenges (SEC-014), per Master Mapping §4.3. Pure JavaScript, no native build |
| otpauth | 9.5.2 | TOTP (RFC 6238) for the second factor (SEC-017). Master Mapping §4.3 names no TOTP library, so one was selected: pure TypeScript, actively maintained, and no hand-rolled HMAC construction |

## Web

| Package | Version | Why |
|---|---|---|
| react / react-dom | 19.3.0 | Latest |
| vite / @vitejs/plugin-react | 8.3.0 / 6.1.1 | Latest; plugin 6 requires Vite 8 |
| @mui/material | 9.4.0 | Material UI per MASTER-MAPPING §4.3 |
| @emotion/react / styled / cache | 11.14.0 / 11.14.1 / 11.14.0 | MUI styling engine; per-direction caches |
| stylis / stylis-plugin-rtl | 4.4.0 / 2.1.1 | Mirrors MUI's internal styles in RTL |
| i18next | 26.4.2 | Translation runtime (I18N-001) |
| @fontsource/alexandria / inter | 5.3.0 / 5.3.0 | Self-hosted fonts bundled with the app, weights 400/600/700 only (I18N-007) |

## Deliberately not added

| Package | Reason |
|---|---|
| react-i18next | The app needs one piece of locale state that drives text, direction, and theme together (I18N-003). A small context over `i18n.getFixedT(locale)` does that without a second source of language state. Add it if `<Trans>` rich-text interpolation is needed. |
| @asteasolutions/zod-to-openapi | Zod 4's built-in `z.toJSONSchema` emits JSON Schema 2020-12, which OpenAPI 3.1 uses directly. |
| @mui/icons-material | Very large. The few Phase 1 icons are inline Material paths. |
| dotenv | Node 24's built-in `process.loadEnvFile` / `--env-file` covers it. |
| AWS SDK (S3, KMS) | Not configured in development yet. Interfaces exist (`PrivateFileStore`, `Encryptor`) with fail-loud unconfigured implementations; the SDK adapters arrive with provisioning. **`SEC-033` is not implemented**, so staging and production cannot store an MFA secret yet (ADR-0023 §6). |
| cookie-parser | One cookie is read, by name, in `modules/identity/cookies.ts`. A parser would turn every header value into request state for no benefit; `res.cookie` for writing is already built into Express 5. |
| A CSRF token library | The only cookie is `SameSite=Strict`, `HttpOnly`, and path-scoped, and the origin guard rejects cookie-bearing state changes from unlisted origins. A double-submit token would add nothing while both hold (SEC-002). |
| TanStack Query, React Hook Form | Listed in MASTER-MAPPING §4.3; added with the first screen that fetches data or has a form. |
| Sentry | Listed in MASTER-MAPPING §4.3; needs a DSN and an approved data-scrubbing configuration. |

## Approvals (2026-09-21)

**No dependency was added** for `APPROVAL-001`–`007`. Two capabilities that might have pulled one in were
written instead, each a small closed rule with its own tests:

| Capability | Why not a package |
|---|---|
| Decimal comparison of percentage thresholds | `compareMoney` already covers money with its currency. Percentages needed an ordered comparison of decimal strings — about fifteen lines, and adding a library to avoid them would have been the wrong trade (ADR-0007, ADR-0024) |
| Workflow state machine | The transition matrix is a lookup table in `packages/contracts`, validated by `assertTransition`. A workflow library would own the vocabulary of a financial control that `SD-02` has not defined yet |

## Bundle-size budget

Approved at the Phase 1 scaffolding review (2026-09-19). Enforced by `npm run check:bundle` (part of
`npm run verify`), which fails when any JavaScript chunk in the web build exceeds:

| Measure | Budget | Phase 1 measurement |
|---|---|---|
| Largest chunk, minified | 650 kB | 590 kB (2026-09-21) |
| Largest chunk, gzip | 210 kB | ~187 kB (2026-09-21) |

- **Technical debt:** the web app ships as a single 582 kB chunk, above Vite's 500 kB advisory warning. The
  warning is intentionally left visible rather than silenced.
- **Route-level code splitting** (`React.lazy` per route) must be introduced before feature-heavy phases
  add screens — at the latest with the first Phase 2 feature screens, and in any case before a build
  would exceed the budget.
- Splitting was not done in Phase 1: there is one page, so there is nothing to split yet.
- Raising the budget needs an approved decision recorded in `docs/MEMORY.md`.

## Windows path note

The repository path contains `&` (`CRM & ERP REALESTATE`). npm's generated Windows `.cmd` shims expand
their directory unquoted and break on `&`. All package scripts therefore run tools through
`scripts/bin.mjs`, which starts each tool's JavaScript entry point with the current Node executable.
This works on every platform and path; moving the repository to a path without `&` would also remove
the need.
