# ADR-0014 — Stable requirement ID scheme

- Status: Accepted · Module-code rule amended by [ADR-0016](adr-0016-phase-1-requirement-namespaces.md)
- Date: 2026-09-19
- Deciders: Implementation team
- Scope: Governance

## Context

`CLAUDE.md` requires that `docs/MEMORY.md` record progress "with requirement IDs", and every phase prompt
asks for completed and in-progress requirement IDs. The Master Mapping already defines module codes
(`CORE-RBAC`, `INV-UNIT`, `MKT-CAMPAIGN`, `COL-CHECK`, …) but no requirement-level identifiers.

Without a defined scheme, each session would invent its own, and status records would become
unmatchable across sessions — which is precisely the drift the memory discipline exists to prevent.

## Decision

### Format

```
<MODULE>-<NNN>
```

- `<MODULE>` is an existing Master Mapping module code, used verbatim. No new module codes are invented
  without updating the Master Mapping.
- `<NNN>` is a zero-padded three-digit integer, assigned sequentially within the module, starting at `001`.

Examples: `CORE-RBAC-001`, `INV-HOLD-004`, `COL-CHECK-002`, `MKT-BUDGET-001`.

### Rules

1. **IDs are permanent.** Once assigned, an ID is never reused, renumbered, or reassigned to different
   scope — even if the requirement is withdrawn. A withdrawn requirement keeps its ID with status
   `withdrawn`, so historical records stay resolvable.
2. **One ID, one testable outcome.** If a requirement cannot be verified by a specific test or a specific
   demonstrable behaviour, it is too broad and must be split.
3. **Numbers are sequential within a module, not global**, so modules can be elaborated independently
   without coordinating a global counter.
4. **Every ID declares its phase.** A requirement belongs to exactly one phase. Cross-phase work is
   split into per-phase requirements.
5. **Every ID declares its source** — Master Mapping section, phase prompt, or the Arabic scope review
   gap ID (`G-01`…`G-13`). A requirement with no traceable source is not a requirement.

### Status values

| Status | Meaning |
|---|---|
| `proposed` | Identified, not approved. Must not be built. |
| `approved` | Approved for the named phase. May be built when the phase is active. |
| `in-progress` | Implementation started. |
| `implemented` | Code complete, not yet gate-verified. |
| `verified` | Passed acceptance criteria, permission and data-scope tests, bilingual/RTL checks, and quality gates. |
| `blocked` | Waiting on an open stakeholder decision — the blocking `SD-` ID must be named. |
| `withdrawn` | Removed from scope. ID retired, never reused. |

**`implemented` is not `verified`.** Only `verified` counts toward a phase gate, and only against code
and tests — never against documentation alone.

### Related identifier namespaces

| Prefix | Meaning | Location |
|---|---|---|
| `ADR-NNNN` | Architecture decision record | `docs/decisions/` |
| `SD-NN` | Open stakeholder decision / blocker | `docs/decisions/open-decisions.md` |
| `C-NN` | Conflict found in discovery | `docs/discovery/arabic-scope-review.md` |
| `G-NN` | Gap found in discovery | `docs/discovery/arabic-scope-review.md` |
| `DISC-NNN` | Discovery deliverable | `docs/discovery/` |

### Elaboration policy

Requirements are enumerated in full for the **active and next** phase only. Later phases are registered
at module level, with requirement-level detail added during that phase's discovery. Enumerating detailed
requirements for Phase 7 today would mean inventing business rules that no stakeholder has confirmed —
which `CLAUDE.md` prohibits.

## Consequences

**Accepted benefits**

- Status is comparable across sessions, so `docs/MEMORY.md` stays meaningful.
- Traceability runs both ways: scope → requirement → test, and defect → requirement → source.
- Gaps found in discovery are tracked as first-class items rather than prose in a report.

**Accepted costs**

- Registry maintenance is manual and must be updated in the same change as the code. Mitigation: it is
  part of the definition of done.
- Sequential per-module numbering means two parallel sessions could collide on a number. Mitigation:
  claim IDs in the registry before use.

## Compliance

- Every commit implementing scope references at least one requirement ID.
- Every requirement reaching `verified` names the tests that verify it.
- `docs/MEMORY.md` records status by ID, never by prose description alone.

## Status update — 2026-09-19

The rule "`<MODULE>` is an existing Master Mapping module code, used verbatim" is amended for Phase 1 by
[ADR-0016](adr-0016-phase-1-requirement-namespaces.md), which approves nine Phase 1 namespaces (`PLAT`,
`I18N`, `THEME`, `SEC`, `AUDIT`, `APPROVAL`, `INTEGRATION`, `TEST`, `OPS`) under stakeholder decision
`SD-22`. The example `CORE-RBAC-001` above is historical; that requirement is now `SEC-023`. All other
rules in this ADR stand.

## References

- `CLAUDE.md` — required memory update, requirement IDs
- `docs/MASTER-MAPPING.md` §8 — module codes
- [../REQUIREMENTS.md](../REQUIREMENTS.md)
