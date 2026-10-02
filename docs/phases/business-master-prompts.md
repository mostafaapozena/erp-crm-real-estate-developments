# Business master prompts — delivery plan

For the stakeholder and the implementation team planning the work after the foundation gate. Approved
grouping: [ADR-0032](../decisions/adr-0032-three-business-master-prompts.md), which replaced the
five-prompt **sequence** of [ADR-0029](../decisions/adr-0029-business-master-prompts.md) on 2026-09-29
and kept its rules.

**This is a grouping of work already registered, not a re-registration.** No requirement ID is
renamed, renumbered, merged or retired by this plan; no status is raised by it.
[../REQUIREMENTS.md](../REQUIREMENTS.md) remains the register of record, the nine engineering phases
keep their meaning, and each phase still passes [phase-gates.md](phase-gates.md).

| Prompt | Name | Engineering scope | Macro phase | State |
|---|---|---|---|---|
| **BMP-1** | Commercial Operations — CRM, Sales, Inventory, Reservations, Contracts and Documents | Phase 2 in full; Phase 3 CRM modules without providers; Phase 4 in full up to collected money; `COL-SCHEDULE`; `CORE-DOC-003`, `CORE-DOC-005` | Macro Phase 2 | **packages 1–8 complete — stopped for review** (2026-09-29 – 2026-10-02); 47 of its requirements implemented, 7 in progress (screens), 2 blocked (`SD-04`) |
| **BMP-2** | Collections, Finance, Operations and People | Phase 5 after the schedule; `SALE-CANCEL` and `SALE-CHANGE` where money has moved; Phase 6; Phase 7; Phase 8 | Macro Phases 2 and 3 | not started |
| **BMP-3** | Marketing, Official Integrations, Production Hardening and Launch | Phase 3 provider work; Phase 9; `SEC-033`, `PLAT-017`, `SEC-005`, `SEC-006` | Macro Phase 4 | not started |

The prompts run in order. Each starts only on the stakeholder's explicit instruction, after the
previous one's gate, and each begins by re-reading `docs/MEMORY.md` and the decisions it depends on.
The names and boundaries of BMP-2 and BMP-3 are confirmed when those prompts are issued.

## Traceability — five planned prompts to three

Every module the five-prompt plan named appears exactly once below. "Split" means the module's
enumerated requirement IDs are divided between two prompts, and each ID's row in
[../REQUIREMENTS.md](../REQUIREMENTS.md) names its owner.

| Module or item | Five-prompt plan | Three-prompt plan | Note |
|---|---|---|---|
| `CORE-ORG` completion for the client's real structure | BMP-1 | BMP-1 | Values are `SD-01`; the mechanism is F2 |
| `INV-PROJECT`, `INV-UNIT`, `INV-STATUS`, `INV-PRICE`, `INV-PLAN`, `INV-HOLD`, `INV-SEARCH` | BMP-1 | BMP-1 | |
| `CRM-PERSON`, `CRM-LEAD`, `CRM-OPP`, `CRM-PIPE`, `CRM-ASSIGN`, `CRM-OWNER`, `CRM-ACTIVITY`, `CRM-MATCH`, `CRM-LOSS`, `CRM-REPORT` | BMP-1 | BMP-1 | Provider-free |
| `SALE-QUOTE`, `SALE-DISCOUNT`, `SALE-RESERVE` | BMP-1 | BMP-1 | |
| `SALE-CONTRACT` | BMP-2 | **BMP-1** | Moved: the journey ends on a contract |
| `SALE-CHANGE` | BMP-2 | **Split** | Plan change before money moves: BMP-1. Unit substitution and assignment/transfer: BMP-2 (`BD-07`, `BD-08`) |
| `SALE-CANCEL` | BMP-2 | **Split** | Cancellation before collection, with unit release: BMP-1. Penalties, refunds, commission reversal, paper return: BMP-2 (`BD-05`, `BD-06`, `BD-15`) |
| `COL-SCHEDULE` | BMP-2 | **Split** | Creating the contractual schedule and its approved revisions: BMP-1. Settlement against it: BMP-2 |
| `CORE-DOC-003` PDF with embedded Arabic fonts | BMP-2 | **BMP-1** | Phase 1 row, not started until now |
| `CORE-DOC-005` QR verification | BMP-2 | **BMP-1** | Phase 1 row, not started until now |
| `COL-INVOICE`, `COL-RECEIPT`, `COL-REMIND`, `COL-CHECK`, `COL-NOTE`, `COL-STATEMENT` | BMP-2 | BMP-2 | |
| `FIN-COA` … `FIN-REPORT` (Phase 6) | BMP-2 | BMP-2 | `SD-08` still blocks posting |
| `PROC-*`, `WH-*`, `CONST-*` (Phase 7) | BMP-3 | BMP-2 | |
| `HR-*` (Phase 8) | BMP-4 | BMP-2 | |
| `CRM-WA`, `MKT-*`, `MKT-CAPI` (Phase 3 providers) | BMP-5 | BMP-3 | |
| `HAND-*`, `CS-TICKET`, `PORTAL-CUSTOMER`, legacy migration (Phase 9) | BMP-5 | BMP-3 | |
| `SEC-033`, `PLAT-017`, `SEC-005`, `SEC-006` | BMP-5 | BMP-3 | Production blockers, unchanged |
| Carried debt: per-resource scope; reference lists in business modules; `salesCounters` → `CORE-DOC-001`; account picker; organization scope on account administration | BMP-1 | BMP-1 | Account administration scope stays debt unless BMP-1 needs it |

## What every prompt inherits from the foundation

The foundation (F0–F12) is the platform every business module uses, and a prompt must use it rather
than build a second one:

- Organization and data scope (`CORE-ORG`, `SEC-026`–`032`); approvals (`APPROVAL-*`) for every
  threshold the business decision register names; numbering (`CORE-DOC-001`) for every official
  document; documents and templates (`CORE-DOC-002`/`004`/`006`); notifications and tasks
  (`CORE-NOTIFY`, `CORE-TASK`); search providers and import/export (`CORE-SEARCH`, `CORE-IMPORT`);
  settings and reference data (`PLAT-024`–`026`); the integration registry, inbox and outbox
  (`INTEGRATION-*`); migrations for any data change (`OPS-004`); maintenance sweeps (`OPS-007`).
- The rules that do not change: Arabic and English together, right-to-left and left-to-right, Light
  Mode only, decimal-safe money, UTC storage with the organization's calendar for display, no hard
  delete of business records, an audit record for every mutation, scope inside every query.

---

## BMP-1 — Commercial Operations

**Scope.** The journey Lead → Qualification → Opportunity → Customer → Unit Selection → Reservation →
Approval → Contract → Instalment Schedule Handoff, and the commercial documents and approvals it
needs. Enumerated requirement IDs: [../REQUIREMENTS.md](../REQUIREMENTS.md) §"Business Master Prompt 1
— enumerated requirements".

**Starts from.** The demonstration slice is real code and the starting point, but it is a slice: each
module is brought up to its enumerated requirements, not assumed to meet them.

**Decisions required.** `SD-01`–`SD-05`, `SD-10`, `SD-17`, `SD-21`; register entries BD-01–BD-05,
BD-07–BD-09, BD-19, BD-22, BD-24 and the new commercial entries BD-25 onward. Each is handled as a
configurable policy that stores *not configured* until the owner answers
([ADR-0032](../decisions/adr-0032-three-business-master-prompts.md) rule 5). The Arabic questionnaire
for the client is [../decisions/bmp-1-decision-questionnaire-ar.md](../decisions/bmp-1-decision-questionnaire-ar.md).

**Not in BMP-1.** Finance, payroll, procurement, Meta, WhatsApp, payment providers and production
deployment — except interfaces strictly needed by a later prompt.

**Done when.** The full journey runs on persisted data; concurrent users cannot double-reserve a unit;
discounts and exceptions obey approvals; confirmed contracts keep their snapshots; schedules reconcile
exactly; Arabic and English documents render correctly and verify by QR; permissions and scopes are
proven; every mandatory check passes with zero skips; demonstration data is preserved.

## BMP-2 — Collections, Finance, Operations and People

**Scope.** Phase 5 after the schedule: `COL-INVOICE`, `COL-RECEIPT`, `COL-REMIND`, `COL-CHECK`,
`COL-NOTE`, `COL-STATEMENT` (with gap `G-06`). The money side of `SALE-CANCEL` and `SALE-CHANGE`.
Phase 6: `FIN-COA` … `FIN-REPORT` (with gaps `G-01`, `G-02`, `G-04`, `G-05`, `G-07`, `G-11`, `G-12`).
Phase 7: `PROC-*`, `WH-*`, `CONST-*` (with gap `G-13`). Phase 8: `HR-*` (boundary ADR-0019).

**Hard prerequisite.** `SD-08`: Phase 6 posting cannot start without a formally appointed accounting
reviewer. Collections may proceed; posting may not.

**Decisions required.** `SD-02`, `SD-05`–`SD-08`, `SD-10`, `SD-12`, `SD-21`; register entries BD-05 to
BD-18, BD-24.

**Done when.** A contract's collections, cheques and notes, and their postings reconcile to the ledger
in the reviewer's presence, with reversals by contra-entry only; project costs reach the cost report
per project and per phase; an employee's month produces a payroll run that posts.

## BMP-3 — Marketing, Official Integrations, Production Hardening and Launch

**Scope.** Phase 3 provider work: `CRM-WA`, `MKT-CONNECT` through `MKT-AUDIT`, `MKT-CAPI` (production
delivery gated, ADR-0017), each as an adapter on the F10 registry with contract tests. Phase 9:
`HAND-*`, `CS-TICKET`, `PORTAL-CUSTOMER`, analytics, legacy data migration (`SD-11`), hardening and
UAT. `SEC-033` (KMS), `PLAT-017` (object storage), `SEC-005` (malware scanner), `SEC-006` (secrets
manager).

**Decisions required.** `SD-09`, `SD-11`, `SD-15`, `SD-17`–`SD-20`; register entries BD-20, BD-21,
BD-23.

**Done when.** The approved production release: providers connected under the client's own accounts,
data migrated and reconciled, backups restored in rehearsal, and the Phase 9 gate signed.

---

## Not in this plan

Anything not registered. A new need found during a prompt is registered first (next free ID in its
namespace, status `proposed`), approved, and only then built — never added silently to a prompt's
scope.

## Superseded: the five-prompt sequence (ADR-0029, 2026-09-28)

Kept for traceability. BMP-1 Inventory, CRM, Sales and Reservations · BMP-2 Contracts, Installments,
Collections, Finance and Banking · BMP-3 Construction, Contractors, Procurement, Warehouses and Assets
· BMP-4 HR, Attendance, Leave, Payroll and Internal Administration · BMP-5 Marketing, Official
Integrations, Production Hardening and Launch. The table above maps each of their modules to the
three-prompt plan.
