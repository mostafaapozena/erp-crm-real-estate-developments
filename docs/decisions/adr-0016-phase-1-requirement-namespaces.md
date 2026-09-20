# ADR-0016 — Approved Phase 1 requirement namespaces

- Status: Accepted · `SEC` boundary refined by [ADR-0019](adr-0019-security-account-organization-employee-boundary.md)
- Date: 2026-09-19
- Deciders: ALOLA business owner (stakeholder decision `SD-22`), implementation team
- Scope: Governance
- Amends: [ADR-0014](adr-0014-requirement-id-scheme.md) — the module-code rule only

## Context

[ADR-0014](adr-0014-requirement-id-scheme.md) requires every requirement ID to use a Master Mapping §8
module code verbatim. §8 defines codes for business-platform and domain modules, but none for the Phase 1
foundation: the monorepo and platform, localization, the design system, security hardening, test and
quality infrastructure, or operational foundations. Four codes (`PLAT`, `I18N`, `THEME`, `SEC`) were used
provisionally and escalated as `SD-22`.

The stakeholder approved a broader answer than the one proposed: nine stable namespaces covering all
Phase 1 foundation work, to be applied **consistently** — including where a foundation concern previously
sat under a `CORE-*` code.

## Decision

### Approved Phase 1 namespaces

| Namespace | Covers | Master Mapping scope it traces to |
|---|---|---|
| `PLAT` | Platform and application foundation | §4.1, §4.2 |
| `I18N` | Localization, direction, typography | §5.1, §5.2 |
| `THEME` | Light Mode and design tokens | §5.3 |
| `SEC` | Authentication, authorization, encryption, security | §6; modules `CORE-USER`, `CORE-RBAC` |
| `AUDIT` | Audit infrastructure | §6; module `CORE-AUDIT` |
| `APPROVAL` | Approval infrastructure | §7; module `CORE-APPROVAL` |
| `INTEGRATION` | Provider adapter foundations | §10; module `CORE-INTEGRATION` |
| `TEST` | Testing and quality infrastructure | §4.3, §13 |
| `OPS` | Environments, monitoring, backup, operational foundations | §4.1, §6 |

### Rules

1. Phase 1 requirement IDs use `<NAMESPACE>-<NNN>` with one of the nine namespaces above.
2. Where a namespace corresponds to a Master Mapping module (`SEC` ↔ `CORE-USER`/`CORE-RBAC`, `AUDIT` ↔
   `CORE-AUDIT`, `APPROVAL` ↔ `CORE-APPROVAL`, `INTEGRATION` ↔ `CORE-INTEGRATION`), the **namespace is the
   requirement ID prefix** and the Master Mapping module remains the product-scope name. The two are
   linked in [../REQUIREMENTS.md](../REQUIREMENTS.md).
3. Phase 1 business-platform modules that no approved namespace covers — `CORE-NOTIFY`, `CORE-TASK`,
   `CORE-DOC`, `CORE-SEARCH`, `CORE-IMPORT` — keep their Master Mapping codes verbatim, per ADR-0014.
4. Phases 2–9 continue to use Master Mapping §8 module codes verbatim. A new namespace for a later phase
   needs a new stakeholder decision.
5. All other ADR-0014 rules stand: IDs are permanent, never reused, one testable outcome each, sequential
   within a namespace, one phase each, and every ID declares its source.

### One-time re-keying

The provisional Phase 1 IDs were never used in code or in a commit. They were re-keyed once, before the
baseline commit, to apply the approved namespaces consistently. The complete old → new mapping is kept in
[../REQUIREMENTS.md](../REQUIREMENTS.md) so that no earlier reference becomes unresolvable. Retired
provisional IDs are **never reused**. This is the only re-keying ADR-0014 permits; after the baseline
commit, IDs are permanent.

The Master Mapping was not modified. Its §8 module catalog remains accurate as a product-scope list; this
ADR adds the requirement-ID layer beneath it.

## Consequences

**Accepted benefits**

- All 111 Phase 1 requirements are trackable by ID.
- Foundation work — tests, operations, audit, approvals, adapters — is tracked separately from the
  business features that use it.

**Accepted costs**

- Two identifier layers for four modules (namespace and module code). Mitigation: the mapping is published
  once, in the registry, and nowhere duplicated.

## Compliance

- A Phase 1 ID with a prefix outside the nine namespaces, or outside the five retained `CORE-*` codes, is a
  review defect.
- Every commit implementing Phase 1 scope references at least one ID.

## Status update — 2026-09-19

The Phase 1 review approved the `SEC` split with an explicit boundary against `CORE-ORG` and `HR-EMP`,
recorded in [ADR-0019](adr-0019-security-account-organization-employee-boundary.md). All of
`SEC-011`–`SEC-032` remain in `SEC`; `SEC-011`, `SEC-019`, and `SEC-026` were clarified, and `SEC-021`
was narrowed, with its record-reassignment part split into `CORE-TASK-005` and `APPROVAL-007` (Phase 1)
and `CRM-OWNER` (Phase 3). Phase 1 now has 113 requirements.

## References

- Stakeholder decision `SD-22`, 2026-09-19 — [open-decisions.md](open-decisions.md)
- [ADR-0014](adr-0014-requirement-id-scheme.md)
- `docs/MASTER-MAPPING.md` §4–§8
- [../REQUIREMENTS.md](../REQUIREMENTS.md)
