# ADR-0001 — Modular monolith before microservices

- Status: Accepted
- Date: 2026-09-19
- Deciders: Implementation team, ratified by ALOLA blueprint revision 2.0
- Scope: Architecture

## Context

ALOLA ERP spans fifteen business domains — inventory, CRM, marketing, sales, collections, accounting,
procurement, construction, HR, handover, after-sales — that share transactional boundaries. A contract
activation must, in one consistent operation, change unit status, create an installment schedule, and
produce accounting effects. A reservation must not double-book a unit under concurrency.

A distributed architecture would place these invariants across network boundaries, requiring sagas,
compensating transactions, and eventual consistency for operations that the business treats as atomic
and auditable. The team size and the absence of any measured scaling pressure do not justify that cost.

## Decision

Build a **domain-oriented modular monolith**: one deployable API process, one worker process, one web
application, with domain modules isolated inside the codebase by explicit interfaces.

Rules that make the boundaries real rather than decorative:

1. A module exposes a published interface. Other modules import only that interface.
2. No module reaches into another module's collections, schemas, or internal helpers.
3. Cross-module workflows are composed in an application/orchestration layer, not by module-to-module
   chaining.
4. Shared concerns (authorization, audit, money, time, localization, provider adapters) live in
   `packages/`, not duplicated per module.
5. Database transactions may span modules, because they share one database — this is a deliberate
   benefit of the monolith, not a boundary violation.

Microservices, native mobile applications, and multi-region active-active deployment are out of scope
for the initial release.

## Consequences

**Accepted benefits**

- Multi-module invariants are enforced with real database transactions and optimistic concurrency.
- One deployment, one log stream, one correlation ID path; far cheaper to operate and debug.
- Refactoring module boundaries is a code change, not a migration and contract negotiation.

**Accepted costs**

- Module isolation is a discipline, not a runtime guarantee. It degrades silently unless enforced.
  Mitigation: lint-enforced import boundaries and contract tests are part of the Phase 1 foundation.
- The whole application scales as one unit. Accepted: no scaling requirement has been measured.
- A single process failure affects all domains. Mitigation: the worker is a separate process, health
  checks are per-dependency, and queue work is idempotent and retryable.

**Future option**

Because modules communicate through published interfaces, a module can later be extracted behind a
network boundary without rewriting its callers. Extraction requires a new ADR and evidence of a real
constraint — not a preference.

## Compliance

- Import-boundary lint rule must fail CI on cross-module internal imports.
- Each module ships contract tests against its published interface.
- A code review that adds a cross-module internal import must be rejected.

## References

- `docs/MASTER-MAPPING.md` §4.1, §4.2, §15
- `CLAUDE.md` — "Build a modular monolith. Keep domain modules isolated through explicit interfaces."
- [ADR-0002](adr-0002-technology-stack.md) — the stack this architecture runs on
