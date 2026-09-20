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
| AWS SDK (S3, KMS) | Not configured in development yet. Interfaces exist (`PrivateFileStore`, `Encryptor`) with fail-loud unconfigured implementations; the SDK adapters arrive with provisioning. |
| TanStack Query, React Hook Form | Listed in MASTER-MAPPING §4.3; added with the first screen that fetches data or has a form. |
| Sentry | Listed in MASTER-MAPPING §4.3; needs a DSN and an approved data-scrubbing configuration. |

## Bundle-size budget

Approved at the Phase 1 scaffolding review (2026-09-19). Enforced by `npm run check:bundle` (part of
`npm run verify`), which fails when any JavaScript chunk in the web build exceeds:

| Measure | Budget | Phase 1 measurement |
|---|---|---|
| Largest chunk, minified | 650 kB | 582 kB |
| Largest chunk, gzip | 210 kB | ~185 kB |

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
