# ADR-0006 — Authorization enforced on the server and in query scope

- Status: Accepted · amended by a status update 2026-09-21
- Date: 2026-09-19
- Deciders: Implementation team, ratified by ALOLA blueprint revision 2.0
- Scope: Security

## Context

ALOLA ERP holds salaries, bank accounts, customer identity documents, commissions, contract values, and
marketing spend. Different roles must see different records, different fields of the same record, and
different actions on the same record. A sales agent may see their own customers; a branch manager sees
the branch; marketing sees campaign aggregates but not bank details.

Hiding a button is not authorization. Any client-side check is advisory only, because the API can be
called directly. Equally, an endpoint-level permission check is insufficient: `GET /units` that checks
"may view units" but returns every project's units has leaked data even though the permission passed.

## Decision

Authorization is enforced **on the server, and inside the database query**, on every request. Three
independent layers, all mandatory:

### 1. Action permission

Does this actor may perform this verb on this entity type? Permissions are granular verbs, not
coarse roles: `view`, `create`, `edit`, `submit`, `approve`, `reject`, `publish`, `pause`, `cancel`,
`export`, `download`, `communicate`, `reassign`, `reconcile`, `post`, `reverse`.

### 2. Data scope — enforced in the query, not after it

Every list and read query is constrained by the actor's scope before the database returns rows.
Scopes: `self`, `assigned`, `team`, `department`, `branch`, `project`, `legalEntity`, `all`.

**The rule: no repository method may accept a filter without a scope. Fetch-then-filter is prohibited.**
Filtering after retrieval leaks through counts, aggregates, pagination totals, and export paths, and it
is the single most common way a correct-looking permission system leaks data.

### 3. Field-level restriction

Protected fields are removed by the server before serialization: identity documents, salary,
bank details, balances, commissions, credentials, audience definitions. A field the actor may not see
must be absent from the payload — not `null`, not masked client-side.

### Separation of duties

Maker-checker is a distinct concern from permission. An actor with both `create` and `approve` must
still not approve their own record unless an explicit, audited policy allows it. Applies to campaign
budgets, discounts, refunds, bank changes, payroll, and accounting posting.

### Audit

Every mutation writes an append-only audit record: actor, action, entity, before/after summary, reason,
timestamp, session, IP, correlation ID, and provider reference where applicable. Read access to
sensitive data and every export or download is audited too.

### Input validation

Every request is validated at the API boundary against the shared Zod schema from
`packages/contracts/` before any authorization or business logic runs. Unvalidated input never reaches
a query, a provider adapter, or a document generator.

## Consequences

**Accepted benefits**

- A UI defect cannot become a data breach.
- Scope enforcement inside the query means counts, aggregates, and exports are automatically correct.
- Field stripping on the server means a protected value never crosses the network.

**Accepted costs**

- Every repository method carries a scope parameter, which is more verbose than a bare query.
  Mitigation: a scoped-repository helper in `packages/security/` makes the scoped path the easy path and
  the unscoped path the one that requires justification.
- Three layers mean three tests per endpoint. Accepted: these are the tests that matter most.
- Field stripping complicates response typing, since the same entity has different shapes per actor.
  Mitigation: contracts model protected fields as optional.

## Compliance

Per endpoint, tests must prove:

1. The action is denied without the permission.
2. Out-of-scope records are **absent from results**, and from counts and aggregates.
3. Protected fields are absent for unauthorized actors.
4. Self-approval is rejected where separation of duties applies.
5. An audit record is written for every mutation, export, and download.
6. Privilege escalation attempts — editing one's own roles, scopes, or another actor's assignment — fail.

A phase gate does not pass without these tests.

## Status update — 2026-09-21

The first implementation of this ADR landed with `AUDIT-001`–`AUDIT-006` and `SEC-023`–`SEC-032`. Two
mechanisms chosen while implementing it are recorded separately because a later session must not reverse
them silently:

- [ADR-0021](adr-0021-audit-trail-integrity.md) — how append-only is enforced, what the guarantee does
  **not** cover (a privileged database administrator; no cryptographic tamper-proofing), and the runtime
  assertion that makes "every mutation is audited" more than a convention.
- [ADR-0022](adr-0022-authorization-resolved-per-request.md) — the actor is rebuilt from stored grants on
  every request, so there is no permission cache to invalidate and `SEC-032` holds by construction.

Nothing in the Decision above changed. Separation of duties (Layer 4 concerns) and the session rules
remain unimplemented: they belong to `APPROVAL-001`–`007` and `SEC-010`–`022`.

## References

- `docs/MASTER-MAPPING.md` §6, §13
- `CLAUDE.md` — "Apply authorization on the server and database query scope, never only in the UI";
  "Validate all external input at API boundaries."
- [../architecture/security-model.md](../architecture/security-model.md)
- [ADR-0009](adr-0009-no-hard-delete.md) — audit records are never deleted
