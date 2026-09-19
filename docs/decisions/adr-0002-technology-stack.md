# ADR-0002 — TypeScript MERN stack and monorepo layout

- Status: Accepted
- Date: 2026-09-19
- Deciders: Implementation team, ratified by ALOLA blueprint revision 2.0
- Scope: Architecture

## Context

The product requires one codebase serving an Arabic-first web application, a REST API with strict
server-side authorization, and background jobs for reminders, provider synchronization, webhooks, and
document generation. Shared types between client and server are essential: a money amount, a permission
name, or a unit status that drifts between layers becomes a financial or authorization defect.

## Decision

Use a **TypeScript monorepo** with strict mode enabled everywhere, no implicit `any`, and no
`@ts-ignore` without a written justification.

### Applications

| Path | Role |
|---|---|
| `apps/web/` | React + Vite single-page application, Material UI |
| `apps/api/` | Node.js + Express REST API, OpenAPI-documented |
| `apps/worker/` | BullMQ worker for reminders, sync, webhooks, documents |

### Shared packages

| Path | Role |
|---|---|
| `packages/contracts/` | Zod schemas and TypeScript types shared by API and web — the single definition of every request, response, and domain enum |
| `packages/i18n/` | Locale resources, direction handling, formatters |
| `packages/ui/` | Design system built on the Light Mode token set |
| `packages/config/` | Validated environment configuration loading |
| `packages/security/` | Authorization primitives, data-scope helpers, redaction |
| `packages/testing/` | Test factories, fixtures, harnesses |

### Infrastructure

| Concern | Choice |
|---|---|
| Database | MongoDB (Atlas or replica set) with Mongoose strict schemas, explicit indexes, transactions |
| Cache, locks, rate limits, queues | Redis; BullMQ for job processing |
| Files | Private AWS S3; AWS KMS for encryption keys; Secrets Manager for secrets |
| Logging | Pino structured logs with correlation IDs and field redaction |
| Monitoring | Sentry and AWS CloudWatch |
| Tests | Vitest (unit), Supertest (API), Playwright (E2E, both directions) |

Transactions require a replica set. A standalone `mongod` cannot satisfy the atomicity requirements in
`docs/MASTER-MAPPING.md` §9.3 and §9.6; see [ADR-0012](adr-0012-local-development-infrastructure.md).

### Version pinning

Exact dependency versions are resolved, pinned, and recorded during Phase 1 implementation. This ADR
deliberately names no version numbers: recording a version here that is not the one installed would
create exactly the documentation drift this foundation exists to prevent. The authoritative record is
the committed lockfile, summarised in `docs/MEMORY.md`.

## Consequences

**Accepted benefits**

- One type definition per concept, shared across client, server, and worker.
- One install, one lint configuration, one test runner, one CI pipeline.
- Runtime validation (Zod) and compile-time types derive from the same source, so an API boundary
  cannot be validated against a stale shape.

**Accepted costs**

- Monorepo tooling adds build-orchestration complexity. Accepted in exchange for type safety across
  the boundary.
- MongoDB requires explicit schema discipline; without `strict` schemas and declared indexes, document
  drift and unindexed collection scans appear silently. Mitigation: strict Mongoose schemas and an
  index review at every phase gate.
- Requiring a replica set raises the local-development floor. Addressed in ADR-0012.

## Compliance

- `tsc --noEmit` with `strict: true` must pass in CI for every application and package.
- Every API request and response shape must be defined in `packages/contracts/` and validated at the
  boundary; see [ADR-0006](adr-0006-server-side-authorization.md).
- Every new collection must declare its indexes in the same change that introduces it.

## References

- `docs/MASTER-MAPPING.md` §4.1, §4.2, §4.3
- `CLAUDE.md` — "Use TypeScript in frontend and backend with strict mode."
- [ADR-0001](adr-0001-modular-monolith.md), [ADR-0012](adr-0012-local-development-infrastructure.md)
