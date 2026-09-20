# ADR-0012 — Local development without mandatory Docker

- Status: Accepted · Option selected by [ADR-0018](adr-0018-development-infrastructure-selection.md) (2026-09-19) · Development topology superseded for development by [ADR-0020](adr-0020-local-docker-development-services.md) (2026-09-21)
- Date: 2026-09-19
- Deciders: ALOLA business owner (approved decision), implementation team
- Scope: Environment

## Context

The application requires MongoDB with **transactions** — which need a replica set, not a standalone
`mongod` — and Redis for locks, rate limits, and BullMQ queues.

Docker is not currently installed on the development machine, and installing Docker or any external
infrastructure requires explicit approval that has not been given. Waiting for an infrastructure
decision would block documentation and architecture work that does not depend on it.

## Decision

**Neither documentation nor application scaffolding may be blocked by the absence of local
infrastructure.** Specifically:

1. **Scaffold without live services.** The monorepo, packages, configuration, contracts, design system,
   localization, lint, typecheck, unit tests, and production build must all work with no MongoDB or Redis
   running. Unit tests never require a live database.
2. **Fail safely and legibly.** A missing or unreachable service produces a clear, actionable development
   error naming the service, the configuration variable involved, and the documented setup options. It
   must not produce an unhandled crash loop, a silent hang, or a stack trace with no diagnosis.
   Configuration is validated at startup, so a misconfiguration is reported immediately rather than at
   first use.
3. **Provide `.env.example` with no real credentials.** Every variable is listed with a safe placeholder
   and a comment. Real values live only in an untracked `.env`. See
   [ADR-0015](adr-0015-secrets-and-repository-hygiene.md).
4. **Separate service-dependent tests.** Integration tests that genuinely need MongoDB or Redis are
   tagged and skipped with an explicit message when the services are absent. A skipped integration test
   is never reported as a pass — the distinction must be visible in output and in `docs/MEMORY.md`.
5. **Do not install Docker or external infrastructure without explicit approval.**
6. **Never use production databases or production credentials for development.**

## Supported local options

Both are documented; neither is mandated. The final choice is an open stakeholder item (`SD-16`).

### Option A — Docker Desktop

MongoDB configured as a single-node replica set (required for transactions) plus Redis, via a committed
compose file. Closest to production topology; requires Docker Desktop installation approval and
noticeable local resources.

### Option B — MongoDB Atlas development cluster

A free or shared Atlas cluster provides a replica set with transactions and no local database install,
paired with either a managed Redis instance or a local Redis. Lowest local footprint; requires network
connectivity, an Atlas account, and IP allow-listing.

Full setup steps, variables, and trade-offs for both options are in
[../architecture/environments.md](../architecture/environments.md).

## Consequences

**Accepted benefits**

- Phase 1 documentation and the majority of Phase 1 scaffolding proceed today.
- Fail-safe startup and validated configuration are useful in every environment, not just locally.
- Two documented options mean the infrastructure decision can be made later without rework.

**Accepted costs**

- Integration and E2E coverage is incomplete until one option is provisioned. This must be reported
  honestly in `docs/MEMORY.md`, not glossed over — a phase gate requiring integration tests cannot pass
  on skipped tests.
- Supporting two topologies costs a little extra connection documentation. Accepted.
- Transaction-dependent logic (unit holds, reservations, contract activation, accounting posting) cannot
  be verified at all until a replica set exists. This is the real constraint, and it lands in Phase 2
  rather than Phase 1 — noted so it is not discovered late.

## Current environment note

At the time of writing, the development machine's `C:` volume has **0 bytes free**. This independently
blocks `npm install`, Docker installation, and most tooling that writes to the user profile or temp
directory, and must be resolved before application scaffolding begins. Recorded in `docs/MEMORY.md`
as a blocker.

## Compliance

- `npm run lint`, `npm run typecheck`, `npm run test:unit`, and `npm run build` must all succeed with no
  services running.
- Startup configuration validation has a test asserting a clear error for each missing required variable.
- `.env.example` is committed and contains no real credential.
- Test output distinguishes skipped service-dependent tests from passing tests.

## Status update — 2026-09-19

- **Option selected.** Stakeholder decision `SD-16` chose Option B: a MongoDB Atlas development cluster,
  with Redis through an adapter that accepts a managed development instance or an approved local
  instance. Docker is not installed. Recorded in
  [ADR-0018](adr-0018-development-infrastructure-selection.md). The Decision section above is unchanged.
- **Disk space resolved.** The "Current environment note" above is historical: `C:` had about 21 GB free
  when re-measured on 2026-09-19, and dependency installation is no longer blocked.

## Status update — 2026-09-21: Docker approved for development

Decision 5 above ("Do not install Docker or external infrastructure without explicit approval") has been
**satisfied by explicit approval**: the stakeholder authorized local Docker services for development on
2026-09-21, and Docker Desktop with WSL 2 is now installed. Option A in this ADR is therefore the active
**development** topology, in the form recorded by
[ADR-0020](adr-0020-local-docker-development-services.md): a single-node replica set plus Redis, pinned
images, localhost-only ports, generated local credentials.

Everything else in this ADR stands unchanged and is still enforced — scaffold without live services, fail
safely and legibly, `.env.example` with placeholders only, service-dependent tests separated and never
reported as passes when skipped, and no production credentials in development.

## References

- `CLAUDE.md`; user-approved decisions on the local development environment
- `docs/MASTER-MAPPING.md` §4.1
- [../architecture/environments.md](../architecture/environments.md)
- [ADR-0002](adr-0002-technology-stack.md), [ADR-0015](adr-0015-secrets-and-repository-hygiene.md)
