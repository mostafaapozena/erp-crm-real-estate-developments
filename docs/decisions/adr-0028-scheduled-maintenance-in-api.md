# ADR-0028 — Scheduled maintenance runs in the API process under a database lease

- Status: Accepted
- Date: 2026-09-28
- Deciders: Implementation team
- Scope: Architecture, Operations

## Context

Several states in the product change with time rather than with a request: a notification becomes
due, a task becomes overdue and must escalate, an approval stage passes its deadline, an instalment
becomes due and then overdue, a received webhook waits to be processed. Each owning module already
has an idempotent sweep for this (F6, F7, F10, the approval engine, sales), but until now every sweep
was triggered by an administrator over HTTP — so in a real deployment nothing would happen on time
(OPS-007).

The obvious home is the BullMQ worker (`apps/worker`). But the worker holds no domain service graph:
the composition root (`platform/domain-services.ts`) needs the API's configuration — the database,
the signing secret, the encryptor, the file store — and duplicating it in the worker would create a
second copy of the wiring that drifts, the very thing the composition root exists to prevent.

## Decision

1. **The sweeps run in the API process**, on a timer (`platform/maintenance.ts`), using the same
   services requests use, as the system actor `system:maintenance`, so every change they make is
   validated and audited like any other.
2. **Single-runner by lease.** Each sweep has a row in `maintenanceRuns`; running it means taking the
   row's lease with one conditional update. Two API instances ticking at once: one runs the sweep,
   the other skips. A crashed runner's lease expires after ten minutes.
3. **Idempotence stays in the modules.** Each sweep is already safe to run twice (conditional updates,
   dedupe keys). The lease saves work; it is not what prevents double effects.
4. **On by default only in staging and production** (`MAINTENANCE_ENABLED`), so a developer's database
   is not changed behind their back and the end-to-end suite sees stable data.
5. **Observable.** Each run records its start, finish, outcome, stable error code and reported counts;
   `GET /api/v1/operations/diagnostics` shows them.
6. **The worker keeps its role** for queued jobs and reports its own health through a Redis heartbeat
   with the dead-letter count (OPS-006).

## Consequences

- Scheduling needs no second deployment unit and no second copy of the wiring.
- A deployment must run at least one API instance for time-driven state to advance — which it must
  anyway to serve requests.
- A long sweep occupies an API instance's event loop in bursts. Sweeps are bounded (batches of at most
  a few hundred rows); if a sweep ever needs more, it moves to a queued job that the worker processes,
  and this ADR is revisited.

## References

- OPS-006, OPS-007 (`docs/REQUIREMENTS.md`)
- [ADR-0010](adr-0010-integration-adapter-boundary.md) — idempotent jobs and sweeps
- [ADR-0024](adr-0024-approval-engine.md) — escalation through a port
