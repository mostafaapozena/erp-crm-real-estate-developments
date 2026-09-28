# ADR-0029 — Five business master prompts group the remaining engineering phases

- Status: Accepted — **sequence superseded 2026-09-29 by [ADR-0032](adr-0032-three-business-master-prompts.md)**;
  rules 2–4 remain in force
- Date: 2026-09-28
- Deciders: Stakeholder (product owner), recorded by the implementation team
- Scope: Delivery, Governance

## Context

With the foundation complete (F0–F12), the remaining work is the business modules of engineering
Phases 2–9. [ADR-0025](adr-0025-macro-delivery-phases.md) grouped them into three remaining macro
phases for the schedule. The stakeholder has asked for the work to be delivered as five **business
master prompts** — instructions each sized for one delivery run that can be finished, verified and
reviewed on its own.

The risk in any regrouping is that it quietly changes what is registered: an ID merged into a new
name, a requirement marked done because its group is, scope added without registration.

## Decision

1. Five prompts, in order: **BMP-1** Inventory, CRM, Sales and Reservations; **BMP-2** Contracts,
   Installments, Collections, Finance and Banking; **BMP-3** Construction, Contractors, Procurement,
   Warehouses and Assets; **BMP-4** HR, Attendance, Leave, Payroll and Internal Administration;
   **BMP-5** Marketing, Official Integrations, Production Hardening and Launch. Their engineering scope
   and macro phase are in [../phases/business-master-prompts.md](../phases/business-master-prompts.md).
2. **A grouping only.** No requirement ID is renamed, renumbered, merged or retired; no status is
   raised by the grouping; the nine engineering phases and their gates keep their meaning.
3. **Each prompt starts only on explicit instruction**, after the previous prompt's gate. The
   foundation gate does not start BMP-1.
4. **New scope is registered before it is built**, in its existing namespace.

## Consequences

- Delivery runs have a defined size and a defined "done", which a macro phase alone did not give.
- Two layers of grouping (macro phases for the schedule, prompts for delivery) must stay consistent;
  the plan document maps each prompt to exactly one macro phase to keep that simple.

## References

- [ADR-0025](adr-0025-macro-delivery-phases.md), [phase-gates.md](../phases/phase-gates.md),
  [business-decision-register.md](business-decision-register.md)
