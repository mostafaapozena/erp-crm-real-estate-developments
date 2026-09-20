# Phase 1 Discovery Checklist

Date: 2026-09-19 · Status: **Discovery approved for the build half** — documentation foundation reviewed and
approved; stakeholder decisions `SD-13`, `SD-14`, `SD-15`, `SD-16`, `SD-22` resolved

Source: `docs/PHASE-PROMPTS.md` Phase 1 discovery items 1–7.

Phase 1 has two halves. Discovery had to be approved before the build half began. On 2026-09-19 the
stakeholder approved the documentation foundation, resolved the escalated conflicts, and authorized Phase 1
application scaffolding.

The constraint on this phase is still `CLAUDE.md`: *"Do not invent business, accounting, legal, tax,
commission, approval, or Meta billing policies."* Business decisions that remain open are assigned to the
phase they actually block. None blocks Phase 1 scaffolding, because the Phase 1 foundation builds
configurable mechanisms and seeds no business values.

## Status summary

| Category | Items | Complete | Outstanding |
|---|---|---|---|
| Implementation team deliverables | 9 | **9** | 0 |
| Stakeholder decisions (`SD-01` … `SD-23`) | 23 | **6** closed | 17 — none blocks Phase 1 scaffolding |
| Environment prerequisites (`D1`, `D2`) | 2 | **2** | 0 |

---

## A. Implementation team deliverables — complete

| # | Deliverable | Artifact | Status |
|---|---|---|---|
| A1 | Arabic/English glossary established | [../glossary.md](../glossary.md) | ✅ Complete — 12 domains; terms needing confirmation marked 🔶 |
| A2 | Stable requirement ID scheme defined | [ADR-0014](../decisions/adr-0014-requirement-id-scheme.md), [ADR-0016](../decisions/adr-0016-phase-1-requirement-namespaces.md) | ✅ Complete — nine approved Phase 1 namespaces |
| A3 | Requirement registry created, Phase 1 enumerated | [../REQUIREMENTS.md](../REQUIREMENTS.md) | ✅ Complete — 113 Phase 1 requirements (111 re-keyed + 2 split from `SEC-021`, ADR-0019) |
| A4 | Architecture defined and recorded | [../architecture/](../architecture/) | ✅ Complete — 7 documents |
| A5 | Architecture decisions recorded | [../decisions/](../decisions/) | ✅ Complete — 20 ADRs |
| A6 | Data conventions defined: identifiers, money, time, status machines, concurrency, transactions, idempotency, soft state, indexes | [../architecture/data-model-conventions.md](../architecture/data-model-conventions.md) | ✅ Complete |
| A7 | Security model defined: identity, sessions, three authorization layers, field security, SoD, audit | [../architecture/security-model.md](../architecture/security-model.md) | ✅ Complete — policy *content* arrives with `SD-02` (Phase 2) |
| A8 | Light Mode token set specified and **contrast verified by measurement** | [ADR-0005](../decisions/adr-0005-light-mode-design-tokens.md) | ✅ Complete — 3 usage constraints derived from measured failures |
| A9 | Arabic business scope reviewed against the Master Mapping | [../discovery/arabic-scope-review.md](../discovery/arabic-scope-review.md) | ✅ Complete — 6 conflicts (3 material, now resolved), 13 gaps |

## B. Business process mapping — decision points per phase

Phase 1 discovery item 2 requires mapping seven end-to-end flows. The **sequence** of each is established
in MASTER-MAPPING §1 and the Arabic scope document. The decision points, thresholds, and exception paths
are stakeholder inputs, gathered in the discovery of the phase that builds each flow.

| Flow | Sequence known | Decision points needed by | Blocked on |
|---|---|---|---|
| Lead to contract | ✅ | Phases 3–4 | `SD-04`, `SD-05` |
| Campaign to revenue | ✅ | Phase 3 | `SD-04`, `SD-19` (scope approved under `SD-14`) |
| Contract to collection | ✅ | Phase 5 | `SD-05`, `SD-07` |
| Procure to pay | ✅ | Phase 7 | `SD-02`, `SD-08` |
| Project execution | ✅ | Phase 7 | `SD-02` |
| Hire to payroll | ✅ | Phase 8 | `SD-06`, `SD-08`, `SD-21` |
| Contract to handover | ✅ | Phase 9 | `SD-03`, `SD-12` |

**Action:** hold one workshop per flow with the owning department during that phase's discovery, walking
the sequence and recording every decision point, approval, and exception.

## C. Stakeholder inputs

Full detail and phase assignment in [../decisions/open-decisions.md](../decisions/open-decisions.md).

### Resolved on 2026-09-19

- [x] `SD-13` **Dark Mode** — approved and closed: Light Mode only (conflict `C-01`)
- [x] `SD-14` **Meta campaign management scope** — approved and closed: full Master Mapping scope (conflict `C-02`)
- [x] `SD-15` **Conversions API** — approved as optional; production delivery gated (conflict `C-03`, ADR-0017)
- [x] `SD-16` Local development infrastructure — Atlas development cluster + Redis adapter (ADR-0018)
- [x] `SD-22` Phase 1 requirement namespaces — nine approved (ADR-0016); `SEC` boundary refined (ADR-0019)
- [x] `SD-23` Arabic digits — Western digits in both languages (ADR-0003 status update)

### Open — none blocks Phase 1 scaffolding

| Discovery item | Decision | First blocks |
|---|---|---|
| 3 — Organizational structure | `SD-01` hierarchy | Phase 2 |
| 5 — Authorization matrices | `SD-02` roles, thresholds, SoD | Phase 2 |
| 6 — Environment and operations | `SD-18` hosting, backup, recovery | Phase 9 |
| 6 — Environment and operations | `SD-21` timezone, fiscal calendar | Phase 2 |
| 7 — Meta prerequisites | `SD-19` Business ownership, assets, app review | Phase 3 |
| Business rules | `SD-03` Phase 2 · `SD-04` Phase 3 · `SD-05` Phase 2 · `SD-06` Phase 8 · `SD-07` Phase 5 · `SD-08` Phase 6 · `SD-09` Phase 3 · `SD-10` Phase 4 · `SD-11` Phase 9 · `SD-12` each phase · `SD-20` Phase 3 | as listed |
| Brand | `SD-17` logo assets — text placeholder in development only | Phase 4 |

## D. Environment prerequisites

| # | Prerequisite | Status |
|---|---|---|
| D1 | Free disk space on `C:` | ✅ **Resolved.** ~21 GB free, measured 2026-09-19 before installation. |
| D2 | Development MongoDB (replica set) and Redis available | ✅ **Complete 2026-09-21.** Local Docker: `mongo:8.0.32` single-node replica set `rs0` + `redis:8.10.1-alpine`, localhost-only ports, persistent named volumes ([ADR-0020](../decisions/adr-0020-local-docker-development-services.md)). Integration tier: **3 passed, 0 skipped**. |

---

## Definition of discovery approval

1. [x] Stakeholders reviewed the documentation foundation and approved proceeding.
2. [x] `SD-13`, `SD-14`, and `SD-15` have written stakeholder decisions.
3. [x] `SD-16` chosen and `D1` resolved, so scaffolding can run.
4. [x] `SD-22` approved, so Phase 1 work is trackable by requirement ID.
5. [x] Remaining open decisions assigned to the phase they block; none blocks Phase 1 scaffolding.

Remaining for later: the 🔶 glossary terms are confirmed within the phase that first uses each term.

## Next action

Scaffolding complete and reviewed; `D2` complete and the integration gate passing as of 2026-09-21.

**Phase 1 is not yet approved.** The foundation verification suite passes in full, but Phase 1 scope is
incomplete: 60 of 113 requirements are not started (identity and authorization `SEC-010`–`SEC-032`,
`AUDIT-*`, `APPROVAL-*`, `INTEGRATION-001`–`005`, `CORE-NOTIFY`, `CORE-TASK`, `CORE-DOC`, `CORE-SEARCH`,
`CORE-IMPORT`), and the gate also requires a stakeholder demonstration and written approval. Do not start
Phase 2.
