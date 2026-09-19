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
| Sub-stage | Build half — application scaffolding |
| Status | Discovery approved 2026-09-19; scaffolding authorized. Current verified status in `../MEMORY.md` |
| Requirements `verified` | 0 — nothing is gate-verified before the Phase 1 review |
| Blocking the phase gate | Integration tests need the Atlas development cluster and Redis (`D2`); the gate cannot pass on skipped tests |

## Phase index

Authoritative scope is `docs/MASTER-MAPPING.md` §12. Requirement registration is
[../REQUIREMENTS.md](../REQUIREMENTS.md).

| Phase | Scope | Depends on | Exit result | Key blockers |
|---|---|---|---|---|
| **1** | Discovery, architecture, core platform, security, localization, Light Mode | — | Approved secure Arabic-first foundation | None for scaffolding; `D2` (Atlas + Redis provisioning) for integration tests |
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
