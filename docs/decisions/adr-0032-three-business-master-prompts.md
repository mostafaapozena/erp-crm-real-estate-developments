# ADR-0032 — Three business master prompts replace the five-prompt sequence

- Status: Accepted
- Date: 2026-09-29
- Deciders: Stakeholder (product owner), recorded by the implementation team
- Scope: Delivery, Governance
- Supersedes: the **sequence** in [ADR-0029](adr-0029-business-master-prompts.md) (its rules 2–4 stay in force)

## Context

[ADR-0029](adr-0029-business-master-prompts.md) grouped the remaining engineering Phases 2–9 into five
business master prompts. On 2026-09-29 the stakeholder approved the foundation, the demonstration
UI/UX redesign and the final UI polish **for continuation into development only** — not for
production, deployment, or acceptance of any open business decision — and instructed that the five
planned prompts be delivered as **three**, the first being the complete commercial journey:

> Lead → Qualification → Opportunity → Customer → Unit Selection → Reservation → Approval → Contract →
> Instalment Schedule Handoff

The five-prompt plan split that journey in the middle: contracts, contract changes and the contractual
schedule sat in BMP-2 with finance, so the first prompt could not end on a signed contract. The PDF
and QR capabilities (`CORE-DOC-003`, `CORE-DOC-005`) that commercial documents need were also in BMP-2.

## Decision

1. **Three prompts, in order.** Each starts only on the stakeholder's explicit instruction.

   | New prompt | Name | Takes from the five-prompt plan |
   |---|---|---|
   | **BMP-1** | Commercial Operations — CRM, Sales, Inventory, Reservations, Contracts and Documents | Old BMP-1 in full; from old BMP-2 the contract side of Phase 4 (`SALE-CONTRACT`, `SALE-CHANGE`, `SALE-CANCEL` up to the point money has been collected), the contractual schedule (`COL-SCHEDULE`), and `CORE-DOC-003` / `CORE-DOC-005` |
   | **BMP-2** | Collections, Finance, Operations and People | The rest of old BMP-2 (collections after the schedule, refunds and penalties on cancellation, Phase 6 in full), old BMP-3 (Phase 7) and old BMP-4 (Phase 8) |
   | **BMP-3** | Marketing, Official Integrations, Production Hardening and Launch | Old BMP-5 unchanged |

   The names and exact boundaries of BMP-2 and BMP-3 are this team's reading of the instruction and
   are confirmed or corrected when those prompts are issued. The authoritative mapping, module by
   module, is in [../phases/business-master-prompts.md](../phases/business-master-prompts.md).

2. **ADR-0029's rules still hold.** A grouping only: no requirement ID is renamed, renumbered, merged
   or retired; no status is raised because a module moved between groups; new scope is registered
   before it is built.

3. **The boundary inside a module is stated, not implied.** Where a module straddles two prompts
   (`SALE-CANCEL`, `COL-SCHEDULE`, `SALE-CHANGE`), its enumerated requirement IDs say which prompt
   owns each one. BMP-1 creates the contractual schedule; posting, allocation and settlement of money
   against it belong to BMP-2.

4. **BMP-1 enumerates its requirements first.** Phases 2–4 were registered at module level only.
   BMP-1's discovery claims IDs in each module's own namespace (`INV-*`, `CRM-*`, `SALE-*`,
   `COL-SCHEDULE-*`) with status `approved`, before any code uses them.

5. **Business decisions are not decided by building.** Where BMP-1 needs a value the business decision
   register leaves open, it builds a configurable policy that stores `null` (*not configured*) and
   refuses or defers the operation; the development demonstration seed may set a value, labelled on
   the record and in the documentation as a demonstration value. The register entry stays `open` or
   `proposed`.

## Consequences

- BMP-1 ends on a real, persisted, approved contract with a reconciled schedule and its documents,
  which is the unit of work the commercial stakeholders can review.
- BMP-2 is large: it carries three engineering phases (5, 6 remainder, 7, 8). Its prompt will need
  internal packages with their own verification, as BMP-1 has.
- ADR-0029's simplification — each prompt maps to exactly one macro phase — no longer holds: BMP-2
  spans Macro Phases 2 and 3. The plan document shows both columns.
- Phase 1's gate is unaffected: it still requires the stakeholder demonstration and written approval.
  `CORE-DOC-003` and `CORE-DOC-005`, the two Phase 1 rows not started, are delivered inside BMP-1.

## References

- [ADR-0025](adr-0025-macro-delivery-phases.md), [ADR-0029](adr-0029-business-master-prompts.md),
  [../phases/business-master-prompts.md](../phases/business-master-prompts.md),
  [business-decision-register.md](business-decision-register.md)
