# ADR-0025 — Four macro delivery phases over the unchanged requirement registry

- Status: Accepted
- Date: 2026-09-22
- Deciders: Implementation team, at stakeholder direction
- Scope: Governance

## Context

The project is registered as nine engineering phases (`docs/phases/README.md`), executed strictly in
order, each closing at a gate. That numbering is sound for traceability: every requirement ID belongs to
exactly one phase, and `docs/REQUIREMENTS.md` is the register.

The stakeholder has now asked for something the nine-phase order cannot produce on its own: a **client
demonstration inside 48 hours**, showing one coherent business journey end to end —

> dashboard → lead → opportunity → unit selection → reservation → contract → installment schedule →
> collection → receipt → upcoming-installment reminder

That journey crosses Phases 2, 3, 4 and 5. Under the nine-phase rule, none of it may be touched until
Phase 1's gate is approved, and Phase 1's gate is blocked on 24 requirements that the demonstration does
not need (`INTEGRATION-001`–`005`, `CORE-NOTIFY`, `CORE-TASK`, `CORE-DOC`, `CORE-SEARCH`, `CORE-IMPORT`)
plus a stakeholder demonstration that cannot happen without something to demonstrate. That is a deadlock,
and the way out of it is a **delivery** decision, not an architectural one.

Two failure modes have to be avoided while resolving it:

1. **Losing traceability.** Renumbering or re-keying requirements to match a new plan destroys the audit
   trail that ADR-0014 and ADR-0016 exist to protect. IDs are permanent.
2. **Claiming false completion.** A demonstration slice that touches a module is not that module's
   requirement implemented. Marking `INV-*` or `SALE-*` complete because a demo screen exists would make
   the registry lie, which is the one thing it must never do.

## Decision

### 1. Four macro phases are a delivery grouping layered *over* the registry

| Macro phase | Name | Contains |
|---|---|---|
| **Macro Phase 1** | Client Demo MVP | The vertical demonstration slice: application shell, organization minimum, inventory, CRM, reservation, contract, installments, collection, receipt, reminder centre, seeded demo data |
| **Macro Phase 2** | Complete Real Estate Sales and Finance | Engineering Phases 2, 4, 5, 6 in full — inventory and pricing, quotations and contract amendments, collections and instruments, accounting and treasury |
| **Macro Phase 3** | Operations, Procurement and Human Resources | Engineering Phases 7 and 8 in full |
| **Macro Phase 4** | Marketing Integrations, Production Hardening and Launch | Engineering Phase 3's provider work and Phase 9 in full |

A macro phase is a **schedule grouping**. It is not a namespace, not a requirement, and it does not
appear in any requirement ID. `docs/REQUIREMENTS.md` remains the register of record and its IDs, statuses
and namespaces are untouched by this decision.

### 2. The nine engineering phases keep their meaning and their gates

Nothing is renumbered, renamed, merged or deleted. `docs/phases/README.md` still describes Phases 1–9,
and `docs/phases/phase-gates.md` is still the checklist each of them must pass. The crosswalk to the
client's own eleven stages stays valid.

What changes is only **when work is scheduled**, not what "done" means.

### 3. A demonstration slice never marks a requirement `implemented`

Macro Phase 1 builds working code in domains whose engineering phase has not started. That code is real —
it persists to MongoDB, enforces authorization, writes audit records and runs in transactions — but it is
a *slice*, not the requirement.

So:

- Requirements outside Phase 1 stay at their registered status. A demo slice touching future-phase scope
  is recorded in `docs/MEMORY.md` as **demo-slice scope**, named by the module it anticipates, with the
  explicit note that the module's own requirements are not started.
- No requirement anywhere becomes `verified` because of the demonstration. `verified` still means the
  phase gate verified it.
- Phase 1's own gate stays **open**, exactly as it is today. The demonstration is not the Phase 1
  stakeholder demonstration that `phase-gates.md` §1 requires, because Phase 1's scope is still
  incomplete.

### 4. The slice is built to be extended, never to be thrown away

Demo code obeys every standing constraint without exception: server-side authorization inside the query
(ADR-0006), decimal-safe money (ADR-0007), UTC storage (ADR-0008), no hard delete (ADR-0009), Arabic-first
with both locales in the same change (ADR-0003), Light Mode only (ADR-0004), module boundaries (ADR-0001),
and audit on every mutation (ADR-0021).

This is what makes the decision safe. A slice built under the same rules is the first increment of the
real module; a slice built under relaxed rules would have to be deleted, and the 48 hours would buy
nothing.

### 5. Simulated capability is labelled, never implied

Provider-dependent behaviour — Meta campaign publication, WhatsApp delivery, payment-provider settlement —
is **not** connected, and the demonstration says so on screen in both languages. That boundary has its own
decision, [ADR-0026](adr-0026-demonstration-mode-boundary.md), because the honesty rule it protects
(ADR-0011) predates this one.

## Consequences

Accepted:

- **Two planning views coexist.** A reader must understand that "Macro Phase 1" and "Phase 1" are different
  things. Mitigated by never using a bare number: macro phases are always written "Macro Phase N", and the
  engineering phases keep the plain "Phase N" they have used since the beginning.
- **Work happens out of dependency order.** The demo slice anticipates Phases 2–5, so some of it will be
  revisited when those phases run properly — pricing rules, amendment workflows, full accounting posting.
  That rework is the price of the demonstration and is accepted knowingly, not discovered later.
- **`APPROVAL-005` becomes resolvable earlier than planned.** The minimum organization structure supplies a
  reporting line, so escalation can resolve a direct manager in the seeded demonstration. The requirement
  stays `in-progress` until `CORE-ORG` is built for real in its own phase.

Rejected alternatives:

- **Finish Phase 1 first, then demonstrate.** Correct by the rule, but it delivers a demonstration with no
  business journey in it — notifications, tasks, documents and search are infrastructure a client cannot
  see. It also misses the deadline.
- **Renumber the phases into four.** Destroys traceability for no gain; the gate checklist and the
  requirement registry would both need re-keying, and ADR-0014's promise that IDs are permanent would be
  broken.
- **Build the demonstration as a throwaway prototype with mock data.** Faster, and worthless: it proves
  nothing about the system, and every hour spent on it is an hour not spent on the product. It would also
  have to be demonstrated as real, which is a form of dishonesty this project has already refused
  (ADR-0011).

## Compliance

- `docs/phases/README.md` carries the macro-phase table and states plainly that it groups, and does not
  replace, the nine engineering phases.
- `docs/REQUIREMENTS.md` gains a macro-phase section that maps groupings to engineering phases, with the
  statement that no ID or status changes because of it.
- `docs/MEMORY.md` records demo-slice scope separately from requirement status, and never reports a slice
  as an implemented requirement.
- A commit implementing demo-slice scope references the macro phase and the anticipated module, not a
  requirement ID it does not satisfy.

## References

- [ADR-0014](adr-0014-requirement-id-scheme.md) — stable requirement IDs
- [ADR-0016](adr-0016-phase-1-requirement-namespaces.md) — Phase 1 namespaces
- [ADR-0026](adr-0026-demonstration-mode-boundary.md) — demonstration mode and simulated providers
- `docs/phases/phase-gates.md` — the gate every engineering phase still passes
