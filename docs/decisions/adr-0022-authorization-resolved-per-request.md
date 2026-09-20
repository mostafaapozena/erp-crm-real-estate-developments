# ADR-0022 — Authorization state is resolved per request, with no permission cache

- Status: Accepted
- Date: 2026-09-21
- Deciders: Implementation team
- Scope: Security

## Context

`SEC-032` requires that a permission, role, or scope change takes effect **immediately** — not at the
user's next login. `SEC-020` requires the same for suspension and password reset.

The conventional implementation caches an actor's resolved permissions in the session, in Redis, or in
process memory, and adds an invalidation path for every event that could change them: role edited, grant
changed, role deleted, account suspended, scope widened, delegation expired. Cache invalidation is where
authorization systems fail quietly — a revoked permission that survives in a cache is indistinguishable
from a permission that was never revoked, and it fails **open**.

There is no measured performance problem to solve yet: the grant lookup is a single indexed read by
`accountId`, plus one read of the named roles.

## Decision

The actor context is rebuilt **on every request** from stored grants:

1. Read the account's grant record by its unique `accountId` index.
2. Read the roles it names.
3. Resolve effective permissions as the union of the roles' permissions, minus the account's explicit
   denials. **Deny wins.**
4. Attach the resulting actor to the request. Nothing about identity, roles, permissions, ownership, or
   scope is ever read from the request itself: a body, header, query parameter, or cookie claiming a role
   is data, not authority.

**No permission cache exists, therefore nothing needs invalidating.** `SEC-032` holds by construction.

An account with **no** grant record receives no permissions: default deny. An unknown permission is
denied. A scope that cannot be resolved — a missing field mapping, or an empty reference list — becomes a
filter that matches nothing, never an empty filter that matches everything.

Each grant carries a `version` that increments on every change, so a change is observable in audit
evidence and in tests.

### If this becomes a measured bottleneck

A cache may be introduced later, but only with: a bounded TTL measured in seconds, an explicit
invalidation on every grant and role write, a test proving a revoked permission stops working within the
TTL, and its own ADR. It is not to be added as an unreviewed optimization — which is the reason this
decision is recorded rather than left as an implementation detail.

## Consequences

**Accepted benefits**

- A revocation cannot survive anywhere. There is no stale copy to survive in.
- Suspension, offboarding, and scope narrowing need no separate invalidation mechanism.
- The failure mode of a lookup error is a denied request, not an allowed one.

**Accepted costs**

- Two indexed reads per authorized request. Accepted for now, and revisited only with measurements.
- A protected endpoint requires a database connection. This is already true of every endpoint that reads
  data, and the connection failure mode is a clean `SERVICE_NOT_CONFIGURED`/`503`, not a crash.

## Compliance

Tests must prove, against a real MongoDB instance:

1. A request with no actor is `401`; an account holding no permissions is `403`.
2. An explicit denial wins over a role that grants the same permission.
3. A grant written through the API changes the next request's outcome, with no restart and no cache flush.
4. Headers, cookies, and bodies claiming roles or permissions change nothing.
5. An unresolvable scope returns no records rather than all records.
6. Denials never disclose which permission or scope was missing.

## References

- `docs/MASTER-MAPPING.md` §6
- [ADR-0006](adr-0006-server-side-authorization.md) — authorization on the server and in query scope
- [ADR-0019](adr-0019-security-account-organization-employee-boundary.md) — the account is not the employee
- [ADR-0021](adr-0021-audit-trail-integrity.md) — authorization decisions are audited
- [../architecture/security-model.md](../architecture/security-model.md)
