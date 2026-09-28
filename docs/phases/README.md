# Implementation Phases

Nine phases, executed strictly in order. **One phase at a time. Never begin the next phase before the
current gate is verified and explicitly approved** (`docs/PHASE-PROMPTS.md`).

| Document | Purpose |
|---|---|
| This file | Phase index, dependencies, and the client-stage crosswalk |
| [phase-gates.md](phase-gates.md) | The gate checklist every phase must pass |
| [phase-1-discovery-checklist.md](phase-1-discovery-checklist.md) | Phase 1 discovery deliverables and their status |

## Current position

| | |
|---|---|
| Active phase | **1 — Discovery, architecture, core, security, localization, Light Mode** |
| Sub-stage | Foundation completion (F0–F12) done on 2026-09-28; the foundation gate report is in `../MEMORY.md` |
| Status | **PHASE 1 NOT APPROVED.** Current verified status in `../MEMORY.md` |
| Requirements `verified` | 0 — nothing is gate-verified before the Phase 1 review |
| Blocking the phase gate | 2 of 113 requirements not started (`CORE-DOC-003` PDF with embedded Arabic fonts, `CORE-DOC-005` QR verification), 8 in progress, and the gate needs a stakeholder demonstration and written approval |

## Delivery grouping: four macro phases

Approved 2026-09-22 — [ADR-0025](../decisions/adr-0025-macro-delivery-phases.md).

**The macro phases below are a schedule grouping. They do not replace the nine engineering phases, and
they change no requirement ID, namespace, or status.** [../REQUIREMENTS.md](../REQUIREMENTS.md) remains
the register of record, and [phase-gates.md](phase-gates.md) remains the checklist every engineering phase
passes. Always write "Macro Phase N" in full; a bare "Phase N" always means the engineering phase.

| Macro phase | Name | Covers engineering scope |
|---|---|---|
| **Macro Phase 1** | Client Demo MVP | A vertical demonstration slice crossing Phases 2–5, plus remaining shell work in Phase 1 |
| **Macro Phase 2** | Complete Real Estate Sales and Finance | Phases 2, 4, 5, 6 in full |
| **Macro Phase 3** | Operations, Procurement and Human Resources | Phases 7 and 8 in full |
| **Macro Phase 4** | Marketing Integrations, Production Hardening and Launch | Phase 3 provider work and Phase 9 in full |

### What a demonstration slice is, and is not

Macro Phase 1 builds working code in domains whose engineering phase has not started. That code is real —
it persists to MongoDB, enforces permissions and data scopes inside the query, runs financial changes in
transactions, and writes audit records. It is nevertheless a **slice**, not the module:

- A slice **never** moves a requirement to `implemented` or `verified`. Those statuses still mean what
  [phase-gates.md](phase-gates.md) says they mean.
- Demo-slice scope is recorded separately in [../MEMORY.md](../MEMORY.md), named by the module it
  anticipates, alongside the statement that the module's own requirements are not started.
- The client demonstration is **not** the Phase 1 stakeholder demonstration required by
  [phase-gates.md](phase-gates.md) §1. Phase 1's gate stays open.

**Macro Phase 1 was completed on 2026-09-23** and is running: `npm run seed:demo`, then the usual
development servers. See [the demonstration runbook](../demo/runbook.md). It changed no requirement
status and closed no gate, exactly as this section requires.

Capabilities that depend on an unconnected provider — Meta, WhatsApp, payment providers — are simulated
behind the adapter interface they will later use, and say so on screen in both languages
([ADR-0026](../decisions/adr-0026-demonstration-mode-boundary.md)).

## After the foundation: five business master prompts

The remaining engineering phases are delivered as five business master prompts, a grouping of
registered work with no re-registration ([ADR-0029](../decisions/adr-0029-business-master-prompts.md)).
The plan, with each prompt's scope, prerequisites, decisions and definition of done, is
[business-master-prompts.md](business-master-prompts.md). **None of them is started.**

## Phase index

Authoritative scope is `docs/MASTER-MAPPING.md` §12. Requirement registration is
[../REQUIREMENTS.md](../REQUIREMENTS.md).

| Phase | Scope | Depends on | Exit result | Key blockers |
|---|---|---|---|---|
| **1** | Discovery, architecture, core platform, security, localization, Light Mode | — | Approved secure Arabic-first foundation | Remaining Phase 1 scope, then the stakeholder demonstration and written approval. `D2` closed |
| 2 | Organization, projects, units, pricing, plans, inventory | 1 | Controlled saleable inventory | `SD-01`, `SD-02`, `SD-03`, `SD-05`, `SD-21`; `D2` |
| 3 | CRM, WhatsApp, Meta campaigns, leads, insights, attribution | 1–2 | Campaign-to-opportunity workflow | `SD-04`, `SD-09`, `SD-19`, `SD-20`. Scope approved (`SD-14`); CAPI gated (`SD-15`) |
| 4 | Quotations, reservations, contracts, amendments, cancellations | 1–3 | Auditable lead-to-contract workflow | `SD-05`, `SD-10`, `SD-17` |
| 5 | Installments, collections, reminders, checks, promissory notes | 4 | Contract-to-collection workflow | `SD-05`, `SD-07`, `SD-09`, `SD-20`, `SD-21` |
| 6 | Accounting, invoices, treasury, banks, tax, assets, budgets | 1, 4–5 | Auditable finance workflow | **`SD-08` blocks the phase entirely** |
| 7 | Procurement, vendors, stores, contractors, construction | 1–2, 6 | Project cost and execution control | `SD-02` |
| 8 | HR, attendance, payroll, commissions, advances, custody | 1, 6 | Employee-to-payroll workflow | `SD-06`, `SD-08`, `SD-21` |
| 9 | Handover, after-sales, portal, analytics, migration, hardening, UAT, launch | All enabled | Approved production release | `SD-11`, `SD-17`, `SD-18` |

`SD-12` (undocumented exceptions) is asked again in each phase's discovery for that phase's domain.

Phase 6 is worth noting: it cannot start without a **formally appointed accounting reviewer**, and that
appointment is itself outstanding. This is a lead-time dependency, not a paperwork step.

## Crosswalk: client stages ↔ engineering phases

The Arabic business scope document (p20) proposes a preliminary stage plus stages 1–10 — eleven stages
against nine phases. The schemes are compatible: the client document splits engineering Phase 1 into two
stages and Phase 9 into two.

Two numbering schemes in the same project guarantees confusion at every gate, so **the nine-phase
engineering numbering is canonical for delivery tracking**, and this table is published in client-facing
material so both parties mean the same thing by "phase 5".

| Client stage (Arabic) | Client scope | Engineering phase |
|---|---|---|
| المرحلة التمهيدية | Approval of company procedures, permissions, forms, and reports | 1 — discovery |
| 1 | System foundation, users, permissions, interface | 1 — build |
| 2 | Projects, units, prices, payment plans | 2 |
| 3 | Customers, sales, marketing, campaign linkage | 3 |
| 4 | Quotations, reservations, contracts, cancellations | 4 |
| 5 | Installments, collection, reminders, checks, notes | 5 |
| 6 | Invoices, accounting, banks, treasuries, budgets | 6 |
| 7 | Procurement, warehouses, contractors, execution | 7 |
| 8 | HR, payroll, commissions, advances, custody | 8 |
| 9 | Handover and after-sales | 9 — delivery |
| 10 | Data migration, testing, training, go-live | 9 — launch |

Recorded as reconciliation `C-05` in [../discovery/arabic-scope-review.md](../discovery/arabic-scope-review.md).
No scope is lost in either direction.

## Rules

1. **One phase at a time.** Never combine phases or start the next before the current gate is approved.
2. **Verification is against code and tests, never documentation.** `docs/MEMORY.md` describing something
   as done is not evidence that it is.
3. **A skipped test is not a pass.** Where infrastructure is unavailable, the gate does not pass on skipped
   integration tests — it stays open.
4. **Update `docs/MEMORY.md` and [../REQUIREMENTS.md](../REQUIREMENTS.md)** at the end of every phase and
   every material change within one.
5. **Stop and request approval** at every gate. Do not proceed on inferred approval.
