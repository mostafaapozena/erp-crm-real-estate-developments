# Business master prompts — delivery plan

For the stakeholder and the implementation team planning the work after the foundation gate. Approved
grouping: [ADR-0029](../decisions/adr-0029-business-master-prompts.md).

**This is a grouping of work already registered, not a re-registration.** No requirement ID is
renamed, renumbered, merged or retired by this plan; no status is raised by it; nothing in it is
started. [../REQUIREMENTS.md](../REQUIREMENTS.md) remains the register of record, the nine engineering
phases keep their meaning, and each phase still passes [phase-gates.md](phase-gates.md). The five
prompts group those phases into instructions of a size one delivery run can finish and verify.

| Prompt | Name | Engineering scope | Macro phase |
|---|---|---|---|
| **BMP-1** | Inventory, CRM, Sales and Reservations | Phase 2 in full; Phase 3 CRM modules without providers; Phase 4 quotations, discounts, reservations | Macro Phase 2 |
| **BMP-2** | Contracts, Installments, Collections, Finance and Banking | Phase 4 contracts, changes, cancellations; Phase 5 in full; Phase 6 in full | Macro Phase 2 |
| **BMP-3** | Construction, Contractors, Procurement, Warehouses and Assets | Phase 7 in full; Phase 6 fixed assets if not delivered in BMP-2 | Macro Phase 3 |
| **BMP-4** | HR, Attendance, Leave, Payroll and Internal Administration | Phase 8 in full | Macro Phase 3 |
| **BMP-5** | Marketing, Official Integrations, Production Hardening and Launch | Phase 3 provider work (WhatsApp, Meta, CAPI); Phase 9 in full; `SEC-033` KMS adapter | Macro Phase 4 |

The prompts run in order. Each starts only on the stakeholder's explicit instruction, after the
previous one's gate, and each begins by re-reading `docs/MEMORY.md` and the decisions it depends on.

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

## BMP-1 — Inventory, CRM, Sales and Reservations

**Scope.** Phase 2: `CORE-ORG` completion for the client's real structure, `INV-PROJECT`, `INV-UNIT`,
`INV-STATUS`, `INV-PRICE`, `INV-PLAN`, `INV-HOLD`, `INV-SEARCH`. Phase 3 without providers:
`CRM-PERSON`, `CRM-LEAD`, `CRM-OPP`, `CRM-PIPE`, `CRM-ASSIGN`, `CRM-OWNER`, `CRM-ACTIVITY`,
`CRM-MATCH`, `CRM-LOSS`, `CRM-REPORT`. Phase 4: `SALE-QUOTE`, `SALE-DISCOUNT`, `SALE-RESERVE`.

**Starts from.** The demonstration slice (inventory, CRM, reservations) is real code and the natural
starting point, but it is a slice: each module's requirements are enumerated in its discovery and the
slice is brought up to them, not assumed to meet them.

**Carried debt to resolve.** Per-resource scope (a representative's own leads with readable
inventory); business modules reading reference lists instead of their own enumerations; the demo's
`salesCounters` moving to `CORE-DOC-001` numbering with a series-continuing migration; an account
picker for assignment; organization scope on account administration.

**Decisions required.** `SD-01`, `SD-02`, `SD-03`, `SD-04`, `SD-05` (reservation part), `SD-21`; register
entries BD-01, BD-02, BD-03, BD-04, BD-22, BD-24.

**Done when.** A client's real inventory, leads and reservations run end to end with approved
discounts and holds, in both languages, with every phase-gate check passing for Phases 2 and 4 (the
reservation part) and the provider-free Phase 3 modules.

## BMP-2 — Contracts, Installments, Collections, Finance and Banking

**Scope.** Phase 4: `SALE-CONTRACT`, `SALE-CHANGE`, `SALE-CANCEL`. Phase 5: `COL-SCHEDULE`,
`COL-INVOICE`, `COL-RECEIPT`, `COL-REMIND`, `COL-CHECK`, `COL-NOTE`, `COL-STATEMENT` (with gap `G-06`).
Phase 6: `FIN-COA`, `FIN-GL`, `FIN-ARAP`, `FIN-INVOICE`, `FIN-CASH`, `FIN-BANK`, `FIN-FACILITY`,
`FIN-BUDGET`, `FIN-TAX`, `FIN-ASSET`, `FIN-REPORT` (with gaps `G-01`, `G-02`, `G-04`, `G-05`, `G-07`,
`G-11`, `G-12`). `CORE-DOC-003` (PDF with embedded Arabic fonts) and `CORE-DOC-005` (QR verification),
which official contracts and receipts need.

**Hard prerequisite.** `SD-08`: Phase 6 cannot start without a formally appointed accounting reviewer.
Contracts and collections may proceed; posting may not.

**Decisions required.** `SD-05`, `SD-07`, `SD-08`, `SD-10`, `SD-17`; register entries BD-05 to BD-19.

**Done when.** A contract, its schedule, its collections, its cheques and notes, and their postings
reconcile to the ledger in the reviewer's presence, with reversals by contra-entry only.

## BMP-3 — Construction, Contractors, Procurement, Warehouses and Assets

**Scope.** Phase 7: `PROC-VENDOR`, `PROC-REQUEST`, `PROC-RFQ`, `PROC-PO`, `WH-ITEM`, `WH-TRANS`,
`CONST-CONTRACT` (with gap `G-13`), `CONST-CERT`, `CONST-PROGRESS`; `FIN-ASSET` if BMP-2 deferred it.

**Depends on.** BMP-2's ledger (every purchase and certificate posts), approvals for spending limits.

**Decisions required.** `SD-02` (purchase and certificate approval limits), `SD-12` for the domain.

**Done when.** A project's costs — purchases, stock movements, contractor certificates — reach its
cost report per project and per phase, with inventory history never deleted.

## BMP-4 — HR, Attendance, Leave, Payroll and Internal Administration

**Scope.** Phase 8: `HR-EMP` (the boundary with `SEC` accounts is ADR-0019), `HR-TIME`, `HR-PAY`,
`HR-COMM`, `HR-ADV`, `HR-CUSTODY`, `HR-PERF`; leave and internal administration as enumerated in its
discovery.

**Depends on.** BMP-2's ledger (payroll posts), the organization and placements (F2), commissions from
BMP-1/BMP-2 sales.

**Decisions required.** `SD-06`, `SD-08`, `SD-21`; register entries BD-14, BD-15, BD-24.

**Done when.** An employee's month — attendance, leave, commission, advances, custody — produces a
payroll run that posts, with employee data protected by field restrictions and never exported without
the export permission.

## BMP-5 — Marketing, Official Integrations, Production Hardening and Launch

**Scope.** Phase 3 provider work: `CRM-WA`, `MKT-CONNECT` through `MKT-AUDIT`, `MKT-CAPI` (production
delivery gated, ADR-0017), each as an adapter on the F10 registry with contract tests. Phase 9:
`HAND-READY`, `HAND-APPT`, `HAND-INSPECT`, `HAND-DELIVER`, `CS-TICKET`, `PORTAL-CUSTOMER`, analytics,
legacy data migration (`SD-11`), hardening and UAT. `SEC-033`: the KMS adapter, which staging and
production need before any MFA secret or provider credential can be stored. Object storage (`PLAT-017`),
a malware scanner (`SEC-005`), a secrets manager (`SEC-006`).

**Decisions required.** `SD-09`, `SD-11`, `SD-15`, `SD-17`, `SD-18`, `SD-19`, `SD-20`; register entries
BD-20, BD-21, BD-23.

**Done when.** The approved production release: providers connected under the client's own accounts,
data migrated and reconciled, backups restored in rehearsal, and the Phase 9 gate signed.

---

## Not in this plan

Anything not registered. A new need found during a prompt is registered first (next free ID in its
namespace, status `proposed`), approved, and only then built — never added silently to a prompt's
scope.
