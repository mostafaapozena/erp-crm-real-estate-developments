# ADR-0018 — Development infrastructure: MongoDB Atlas and a Redis adapter

- Status: Accepted
- Date: 2026-09-19
- Deciders: ALOLA business owner (stakeholder decision `SD-16`), implementation team
- Scope: Environment
- Resolves the option left open by: [ADR-0012](adr-0012-local-development-infrastructure.md)

## Context

[ADR-0012](adr-0012-local-development-infrastructure.md) established that scaffolding must not depend on
live services, and documented two infrastructure options — Docker Desktop, or a MongoDB Atlas development
cluster — leaving the choice to stakeholders as `SD-16`.

## Decision

| Concern | Approved direction |
|---|---|
| MongoDB | **MongoDB Atlas development cluster.** A replica set, so transactions are available. |
| Redis | **Adapter with configuration support** for either a managed development instance or an approved local instance. The code does not care which; `REDIS_URL` selects it. |
| Docker | **Not installed.** No compose file is committed. |
| Credentials | Development credentials only, held in an untracked `.env`. **No production credentials, ever.** |
| Live services | **Not required** to complete scaffolding, lint, typecheck, unit tests, or the production build. |
| Failure mode | Service connections fail safely, with a clear development error naming the service and variable. |
| `.env.example` | Placeholder values only. |
| Production | **Never connected to from development.** |

### Production guard

Configuration validation refuses to start a non-production environment whose database name marks it as
production. This catches the most common mistake — a production connection string pasted into a
development `.env` — before any connection is attempted.

## Consequences

**Accepted benefits**

- No local database install and no Docker approval needed.
- Transactions are available as soon as the Atlas development cluster exists.

**Accepted costs**

- Integration tests need network access and IP allow-listing.
- **Until the cluster is provisioned, integration tests remain skipped** and the Phase 1 gate cannot pass
  on them. Provisioning is tracked as environment item `D2` in `docs/MEMORY.md`.

## Compliance

- `npm run lint`, `typecheck`, `test:unit`, and `build` succeed with no services configured.
- A test asserts that a production-marked database name is refused outside production.
- `.env.example` contains no real host, user, or password.

## References

- Stakeholder decision `SD-16`, 2026-09-19 — [open-decisions.md](open-decisions.md)
- [ADR-0012](adr-0012-local-development-infrastructure.md), [ADR-0015](adr-0015-secrets-and-repository-hygiene.md)
- [../architecture/environments.md](../architecture/environments.md)
