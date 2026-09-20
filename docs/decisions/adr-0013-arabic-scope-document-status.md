# ADR-0013 — Arabic PDF is supplementary, not a technical source of truth

- Status: Accepted · Sources of truth confirmed and extended 2026-09-19 (see status update)
- Date: 2026-09-19
- Deciders: ALOLA business owner (approved decision), implementation team
- Scope: Governance

## Context

The repository contains `نطاق_أعمال_نظام_شركة_العلا_للتطوير_العقاري.pdf` (stored since 2026-09-19 as
`docs/source/alola-client-business-scope-ar.pdf`, see [../source/README.md](../source/README.md)) — a 22-page Arabic
client-facing business scope document, version 1.0, September 2026.

Two properties matter for how it is treated:

1. It self-describes its limits on its final page: it "expresses the proposed business scope and is not a
   technical specification, a timeline, or a final financial offer"
   (`ولا ُيعد مواصفات تقنية أو جدوًلا زمنًيا أو عرًضا مالًيا نهائًيا`). Its status line reads
   `مسودة نطاق أعمال للمراجعة` — a draft business scope for review.
2. **Its approval page (p22) is blank.** No name, job title, review status, version number, date, or
   signature. The document has not been formally approved by anyone.

Without an explicit rule, a later session could reasonably treat a detailed Arabic scope document as
authoritative and silently build against it — for example implementing Dark Mode, which the PDF requires
and the technical baseline prohibits.

## Decision

**The Arabic PDF is a supplementary business reference. It is not a technical source of truth.**

The technical sources of truth, in precedence order, are:

1. `CLAUDE.md`
2. `docs/MEMORY.md`
3. `docs/MASTER-MAPPING.md`
4. `docs/PHASE-PROMPTS.md`

### How the PDF is used

1. **Reviewed during discovery** for business requirements that the technical documents miss or
   contradict. This review is complete and recorded in
   [../discovery/arabic-scope-review.md](../discovery/arabic-scope-review.md).
2. **It never silently overrides the Master Mapping.** No change was made to the Master Mapping as a
   result of the review.
3. **Material conflicts are documented and escalated**, not resolved unilaterally. Six were found
   (`C-01`–`C-06`); the material ones are open stakeholder items.
4. **Gaps become proposed requirements** with stable IDs and status `proposed` in
   [../REQUIREMENTS.md](../REQUIREMENTS.md) — visible and traceable, but not treated as approved scope.
5. **It is useful as the client's own language.** Its terminology feeds the bilingual glossary, and its
   page-21 list of twelve points needing client approval is adopted directly as the stakeholder blockers
   register rather than inventing a parallel list.

### Revision handling

If a new revision of the Arabic document is supplied, or it is signed, the discovery review must be
re-run against it and this ADR reconsidered. A signed client scope document is a materially different
artifact from an unsigned draft, and the precedence question should be revisited at that point rather
than assumed settled.

## Consequences

**Accepted benefits**

- One unambiguous precedence order; no silent divergence between client narrative and engineering scope.
- Business requirements in the PDF are still captured rather than lost, because the review is a recorded
  deliverable with tracked IDs.

**Accepted costs**

- Two documents describing the same product can drift. Mitigation: the discovery review is re-run on each
  new PDF revision, and conflicts stay visible in the open-decisions register until closed.
- The client may expect features described in their document — notably Dark Mode — that are not being
  built. Mitigation: `C-01` is explicitly escalated for written acknowledgement rather than left implicit.
  This is the main risk this ADR exists to surface.

## Compliance

- Any change justified solely by the PDF must cite an approved open-decision resolution.
- A new PDF revision triggers a re-run of the discovery review before the next phase gate.

## Status update — 2026-09-19

Stakeholder decision on PDF authority, confirming and extending the Decision above:

- The Arabic PDF remains a **supplementary client-facing business document**.
- The implementation sources of truth are: `CLAUDE.md`, `docs/MEMORY.md`, `docs/MASTER-MAPPING.md`,
  `docs/PHASE-PROMPTS.md`, and **approved ADRs** in this directory.
- **Later written stakeholder decisions supersede conflicting statements in the Arabic PDF.** Conflicts
  `C-01` (Dark Mode), `C-02` (Meta scope), and `C-03` (Conversions API) were resolved on this basis as
  `SD-13`, `SD-14`, and `SD-15` — see [open-decisions.md](open-decisions.md).
- The reconciliation report [../discovery/arabic-scope-review.md](../discovery/arabic-scope-review.md) is
  kept for traceability.
- **The PDF is committed for traceability** (Phase 1 review decision) at
  `docs/source/alola-client-business-scope-ar.pdf`: moved and renamed only, bytes unchanged, SHA-256
  `89fade53871af54f69527c3a23cee7171197525b322db0ed0d301e9c53199f7b`. The original filename and status
  are recorded in [../source/README.md](../source/README.md).

## References

- `CLAUDE.md`; user-approved decisions on Arabic PDF status
- [../discovery/arabic-scope-review.md](../discovery/arabic-scope-review.md)
- [open-decisions.md](open-decisions.md), [ADR-0004](adr-0004-light-mode-only.md)
