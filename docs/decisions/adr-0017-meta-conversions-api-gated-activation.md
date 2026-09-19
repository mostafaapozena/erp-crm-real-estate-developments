# ADR-0017 — Meta Conversions API: optional integration, production delivery gated

- Status: Accepted
- Date: 2026-09-19
- Deciders: ALOLA business owner (stakeholder decision `SD-15`), implementation team
- Scope: Integration, data protection

## Context

MASTER-MAPPING §8 (`MKT-CAPI`) and §9.15 specify consented, deduplicated CRM and offline events sent to
Meta through the Conversions API. The Arabic business scope document does not request this, and it sends
hashed customer identifiers and business events to a third party. Discovery recorded this as conflict
**C-03** and escalated it as `SD-15`.

The stakeholder approved the capability as **optional and controlled**: build it, but never let it send
production data by default.

## Decision

### In scope

- The Conversions API architecture and a server-side adapter behind the integration boundary
  ([ADR-0010](adr-0010-integration-adapter-boundary.md)), built in **Phase 3** as `MKT-CAPI`.
- Event construction for the candidate events named by the Phase 3 prompt (qualified lead, visit,
  reservation, contract, payment) — subject to the approved event list below.

### Disabled by default

Production event delivery is **off** unless explicitly activated. The default must be the safe state in
code, configuration, and every environment: an unset flag means "do not send".

### Production activation preconditions

All ten must be recorded before delivery is enabled in production. Missing any one keeps it off.

1. Confirmed customer consent, or an approved legal basis
2. Privacy review completed
3. Approved event list
4. Approved data fields per event
5. Data minimization applied to every payload
6. Normalization and hashing of identifiers per Meta's specification
7. Event-ID deduplication
8. Log redaction verified against real log output
9. Meta configuration (dataset/pixel, access) completed by the authorized owner
10. Explicit written production authorization

Preconditions 5–8 are engineering controls and are verified by tests. Preconditions 1–4, 9, and 10 are
stakeholder inputs and are recorded in `docs/MEMORY.md` when they arrive.

### Not a blocker

This decision does **not** block Phase 1, and it does not block the general Phase 3 architecture. Phase 3
may proceed with the adapter built and delivery disabled.

## Consequences

**Accepted benefits**

- Attribution can be improved later without re-architecting.
- No customer data leaves the system by accident: the unsafe state requires deliberate action.

**Accepted costs**

- A built but inactive adapter must still be maintained and tested. Accepted.
- Activation has lead time: privacy review and consent language are not engineering tasks.

## Compliance

- A test asserts that, with the activation flag unset, no event is sent in any environment.
- A test asserts that identifiers are normalized and hashed before leaving the adapter, and that raw
  identifiers never appear in logs.
- A test asserts that a repeated event ID produces one delivery.
- Enabling production delivery is a recorded, audited configuration change, never a code default.

## References

- Stakeholder decision `SD-15`, 2026-09-19 — [open-decisions.md](open-decisions.md)
- `docs/MASTER-MAPPING.md` §8 `MKT-CAPI`, §9.15; `docs/PHASE-PROMPTS.md` Phase 3, capture item 6
- [ADR-0010](adr-0010-integration-adapter-boundary.md), [ADR-0011](adr-0011-meta-operating-boundary.md)
- [../discovery/arabic-scope-review.md](../discovery/arabic-scope-review.md) — C-03
