# ALOLA ERP — Mandatory Project Instructions

@docs/MEMORY.md

## Source of truth

- Product scope and phase order: `docs/MASTER-MAPPING.md`
- Execution prompts: `docs/PHASE-PROMPTS.md`
- Current repository state: code, tests, migrations, Git history, then `docs/MEMORY.md`
- When documentation conflicts with verified code, stop, investigate, and correct the documentation. Never guess.

## Required startup procedure

Before planning or changing anything:

1. Read `docs/MEMORY.md` completely.
2. Read the relevant sections of `docs/MASTER-MAPPING.md` and the current phase prompt.
3. Inspect repository structure, package manifests, configuration, Git status, and existing tests.
4. Identify the current phase, requirement IDs, dependencies, completed work, blockers, and exact requested scope.
5. Present a concise implementation plan before making material changes.
6. Preserve unrelated user changes. Never reset, overwrite, delete, push, deploy, or alter production data unless explicitly authorized.

## Engineering rules

- Use TypeScript in frontend and backend with strict mode.
- Build a modular monolith. Keep domain modules isolated through explicit interfaces.
- Arabic is the default language. Every component must ship with Arabic and English keys together.
- Support Arabic RTL and English LTR from the first component. Use the centralized Light Mode theme only; do not implement Dark Mode, System Mode, a theme switcher, or per-user theme preference. Do not hard-code user-facing text, direction, colors, currency, or date formats.
- The approved primary brand color is blue. Use centralized semantic tokens: primary `#2563EB`, primary-hover `#1D4ED8`, primary-pressed `#1E40AF`, primary-soft `#EFF6FF`, primary-soft-strong `#DBEAFE`, on-primary `#FFFFFF`, and focus-ring based on `#2563EB`. Never copy these values into components; expose them through the theme.
- Keep success, warning, error, and information colors semantically distinct from the primary blue. Verify WCAG AA contrast for text, icons, borders, charts, buttons, links, focus states, hover, pressed, selected, disabled, and table states.
- Arabic font: Alexandria. English font: Inter.
- Apply authorization on the server and database query scope, never only in the UI.
- Validate all external input at API boundaries.
- Never log or commit secrets, tokens, passwords, private keys, production personal data, bank credentials, card data, or document contents.
- Financial and inventory state changes require transactions, idempotency, audit records, and explicit approval rules where applicable.
- Never hard-delete financial, contractual, inventory-history, audit, check, or promissory-note records.
- Use reversal, cancellation, archival, or deactivation workflows.
- All integrations must use adapters, webhooks must verify signatures, and retryable jobs must be idempotent.
- Use UTC for storage and the configured organization timezone for display.
- Use decimal-safe money handling; never use binary floating point for financial calculations.
- Accessibility: keyboard operation, visible focus, labels, semantic markup, and WCAG AA contrast.

## Definition of done

A requirement is complete only when:

- Acceptance criteria are met.
- Permission and data-scope tests pass.
- Arabic/English, RTL/LTR, and Light Mode states are verified.
- The approved blue theme tokens, interaction states, and WCAG AA contrast are verified.
- Loading, empty, error, forbidden, and success states are handled.
- Unit/integration tests are added where applicable.
- Lint, typecheck, tests, and production build pass.
- API/schema documentation and `docs/MEMORY.md` are updated.

## Required memory update

After every completed feature, bug fix, migration, integration, or material decision:

1. Update `docs/MEMORY.md` with requirement IDs and current status.
2. Record meaningful modules/files changed, schema/environment changes, and verification results.
3. Record blockers, risks, technical debt, and the exact next action.
4. Replace stale status instead of accumulating contradictions.
5. Never place secrets or real customer/employee financial data in memory.
6. Before ending, ensure memory accurately reflects the repository state.
