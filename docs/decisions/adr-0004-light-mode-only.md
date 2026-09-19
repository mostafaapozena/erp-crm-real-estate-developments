# ADR-0004 — Light Mode only; no Dark Mode, System Mode, or theme switcher

- Status: Accepted · Business conflict `SD-13` closed 2026-09-19 (see status update)
- Date: 2026-09-19
- Deciders: ALOLA business owner (approved decision), implementation team
- Scope: Design

## Context

The technical baseline specifies a single centrally managed Light Mode theme. The supplementary Arabic
business scope document (p3) instead lists "الوضع الفاتح والوضع الداكن" — Light **and Dark** Mode — as a
general characteristic of all screens.

This is a direct contradiction between the two documents, not a difference of detail. It was reviewed
during discovery and recorded as conflict **C-01** in
[../discovery/arabic-scope-review.md](../discovery/arabic-scope-review.md).

The Arabic document is an unsigned draft (its approval page is blank) and is designated supplementary
by [ADR-0013](adr-0013-arabic-scope-document-status.md). The Light Mode decision has been explicitly
reaffirmed by the business owner in this engagement.

## Decision

**Implement one centralized Light Mode theme. Do not implement Dark Mode, System Mode, a theme
switcher, or any per-user theme preference.**

Concretely, the following must not exist in the codebase:

- a `prefers-color-scheme` media query that changes application colors
- a `data-theme` attribute, theme class toggle, or theme context with more than one value
- a theme field on the user profile, in user settings, or in local storage
- a second palette, "dark token" set, or inverted color map

The single approved palette is specified in [ADR-0005](adr-0005-light-mode-design-tokens.md).

## Status of the conflict

This ADR records the implementation decision. It does **not** close the business conflict. Dark Mode
remains an open stakeholder item, `SD-13` in [open-decisions.md](open-decisions.md), and requires the
client to acknowledge in writing that Dark Mode is removed from the approved scope. Until that
acknowledgement exists, there is a known divergence between what the client document says and what is
being built — which is precisely why it is written down here rather than quietly resolved.

If the client ultimately requires Dark Mode, it must be a separately approved and separately estimated
scope item, introduced by a new ADR superseding this one, and scheduled after Phase 1.

## Consequences

**Accepted benefits**

- One palette to verify. WCAG AA contrast must be proven once per token pair, not twice.
- No theme-flash, no hydration mismatch, no per-user theme state to persist or migrate.
- Charts, tables, status colors, PDFs, and print output have one deterministic appearance, which makes
  visual regression testing meaningful.

**Accepted costs**

- Users who prefer dark interfaces are not served. Accepted by the business owner.
- A future Dark Mode becomes a real project rather than a configuration change — every hard-coded
  assumption of a light ground would surface at once. Mitigation: because components consume semantic
  tokens (never raw hex), the eventual cost is bounded to redefining token values rather than editing
  components. This is the main reason the token discipline in ADR-0005 is non-negotiable even though
  only one theme exists today.

**Explicitly not a consequence**

Light-only does not mean the page may assume a light background implicitly. Components must still paint
explicit token-based background and foreground colors, so that a surface is never transparent over an
unknown ground.

## Compliance

- Lint/CI must fail on `prefers-color-scheme` in application styles.
- Code review must reject any theme-selection state.
- Visual regression tests capture one theme only.

## Status update — 2026-09-19

Stakeholder decision `SD-13`: **approved and closed.** The product uses Light Mode only. Dark Mode, System
Mode, theme switching, and per-user theme preferences are not implemented. The Arabic PDF's Dark Mode
statement (p3) is an older requirement, superseded by the later stakeholder decision recorded in the
Master Mapping (§2.4, §15). The "Status of the conflict" section above is therefore historical: the
divergence it describes is resolved. The Decision section is unchanged.

## References

- `CLAUDE.md` — "Use the centralized Light Mode theme only"
- `docs/MASTER-MAPPING.md` §2.4, §5.3, §15
- Arabic scope document p3 — the conflicting requirement
- [ADR-0005](adr-0005-light-mode-design-tokens.md), [ADR-0013](adr-0013-arabic-scope-document-status.md)
