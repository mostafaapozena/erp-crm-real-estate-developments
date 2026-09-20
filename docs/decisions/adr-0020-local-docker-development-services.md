# ADR-0020 — Local Docker services for development; managed services for staging and production

- Status: Accepted
- Date: 2026-09-21
- Deciders: ALOLA business owner (stakeholder decision), implementation team
- Scope: Environment
- Relates to: [ADR-0012](adr-0012-local-development-infrastructure.md),
  [ADR-0018](adr-0018-development-infrastructure-selection.md)

## Context

[ADR-0018](adr-0018-development-infrastructure-selection.md) selected a MongoDB Atlas development cluster
plus a managed Redis instance, and [ADR-0012](adr-0012-local-development-infrastructure.md) had recorded
that Docker must not be installed without approval. Provisioning the managed services in practice required
creating external accounts, browser authentication, API keys, and hand-copied connection strings.

The stakeholder declined that route for **development** and approved fully automated local containers
instead: no external accounts, no manually handled credentials, and no dependency on network availability
for the Phase 1 integration gate.

The technical constraint is unchanged: **MongoDB transactions require a replica set.** A standalone
`mongod` accepts connections and silently cannot run transactions, so it cannot satisfy `PLAT-014`.

## Decision

### Development

Local containers, orchestrated by `docker/compose.dev.yml` and `scripts/dev-services.mjs`:

| Aspect | Decision |
|---|---|
| MongoDB | `mongo:8.0.32`, single-node **replica set** `rs0` with keyfile internal authentication |
| Redis | `redis:8.10.1-alpine`, password-protected, `appendonly yes` persistence |
| Image versions | Pinned exactly; never `latest` |
| Network exposure | Ports published to **`127.0.0.1` only** — neither service is reachable from the network |
| Credentials | Generated locally per machine, stored only in the untracked `docker/dev.env` and `.env`, never printed, never committed |
| Application user | `erp_dev_user` with `readWrite` on `real_estate_erp_dev` only — no cluster administration, no visibility of other databases |
| Data | Persistent named volumes (`alola-dev-*`); `dev:services:down` stops containers and **keeps** the volumes |
| Health | Container health checks plus an explicit wait for a PRIMARY replica-set member before the script returns |
| Data content | Synthetic development data only. Never production data, never production credentials |

### Staging and production

**Unchanged: managed services.** MongoDB Atlas and a managed Redis instance remain the intended
staging and production topology (ADR-0018). Local Docker is a development convenience, not the
deployment architecture, and this ADR does not authorize any deployment.

### What this does not change

- The integration gate is not weakened. `npm run test:integration:gate` still fails when MongoDB or Redis
  is unconfigured; it is satisfied by **real** services, never by mocks (TEST-001).
- Transaction-dependent verification still requires a replica set, which the local topology provides.
- `docs/architecture/environments.md` remains the operational contract.

## Consequences

**Accepted benefits**

- The Phase 1 integration gate runs with no external account, no API key, and no manual credential handling.
- Deterministic and reproducible: pinned images, generated credentials, scripted replica-set initiation.
- Works offline once the images are pulled.

**Accepted costs**

- Docker Desktop and WSL 2 are now prerequisites for running the integration tier locally. Installing them
  required Administrator rights and a restart — a one-time human step, recorded here because it is not
  automatable from the repository.
- Local topology is a single-node replica set, so failover behaviour is not exercised. Accepted for
  development; staging on Atlas provides a real multi-node set.
- Two topologies to keep in mind. Mitigation: the application only ever reads `MONGODB_URI` and
  `REDIS_URL`, so no code branches on the environment.

## Compliance

- `docker/compose.dev.yml` contains no credential — only variable references.
- `.env` and `docker/dev.env` are git-ignored; verified with `git check-ignore` before each commit.
- Ports are asserted to bind `127.0.0.1` only.
- The application user's roles are asserted to be `readWrite` on the development database alone.
- Integration tests clean up the records and keys they create.

## References

- Stakeholder decision, 2026-09-21
- [ADR-0012](adr-0012-local-development-infrastructure.md), [ADR-0018](adr-0018-development-infrastructure-selection.md)
- [../architecture/environments.md](../architecture/environments.md)
- `docker/compose.dev.yml`, `scripts/dev-services.mjs`
