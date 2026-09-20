# Phase Gate Checklist

Every phase passes the same gate. Source: `docs/MASTER-MAPPING.md` §13, `CLAUDE.md` definition of done.

**Verification is against code and tests. A claim in `docs/MEMORY.md` is not evidence.** Never record a
check as passed unless it actually passed.

## 1. Scope and approval

- [ ] Every requirement ID for the phase is `verified` in [../REQUIREMENTS.md](../REQUIREMENTS.md), or
      explicitly deferred with a recorded reason
- [ ] Acceptance criteria met for each requirement
- [ ] No open stakeholder decision (`SD-`) blocks a requirement claimed complete
- [ ] Stakeholder demonstration performed
- [ ] Explicit written approval to proceed

## 2. Quality gates

- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes — strict, no new `@ts-ignore` without written justification
- [ ] `npm run test:unit` passes
- [ ] `npm run test:integration:gate` passes — this mode **fails** rather than skips when MongoDB or
      Redis is not configured, so the gate cannot be passed on skipped tests. Start the services first with
      `npm run dev:services:up` ([ADR-0020](../decisions/adr-0020-local-docker-development-services.md)).
      Record the counts: passed / failed / **skipped must be 0**
- [ ] `npm run check:bundle` passes — web bundle within the approved budget
- [ ] `npm run test:e2e` passes in **both** locales and directions
- [ ] `npm run build` produces a working production build of all applications

## 3. Authorization and data protection

Per [../architecture/security-model.md](../architecture/security-model.md) §8. Per endpoint added or changed:

- [ ] Action denied without the required permission
- [ ] Out-of-scope records absent from results **and from counts, aggregates, and pagination totals**
- [ ] Protected fields absent for unauthorized actors — **including in exports and PDFs**
- [ ] Out-of-scope record returns `404`, not `403`
- [ ] Self-approval rejected where separation of duties applies
- [ ] Audit record written for every mutation, export, and download
- [ ] Privilege-escalation attempts fail
- [ ] Session invalidated immediately on suspension and on permission change
- [ ] Unknown and malformed input rejected, not coerced

## 4. Localization and direction

Per [../architecture/localization-and-theming.md](../architecture/localization-and-theming.md) §9.

- [ ] Complete `ar` and `en` keys; CI missing-key check passes
- [ ] **No mixed-language screen anywhere**
- [ ] No hard-coded user-facing text
- [ ] Arabic RTL verified: navigation, forms, tables, dialogs, drawers, menus, charts, print, PDFs
- [ ] English LTR verified across the same surfaces
- [ ] Mixed-direction fields (phone, email, URL, IBAN, codes) isolated and rendering correctly
- [ ] Locale-aware dates, numbers, currency, percentages, plurals
- [ ] Arabic glyph rendering asserted in every generated PDF

## 5. Theme and accessibility

Per [../decisions/adr-0005-light-mode-design-tokens.md](../decisions/adr-0005-light-mode-design-tokens.md).

- [ ] Light Mode only — no Dark Mode, System Mode, switcher, or preference
- [ ] No hard-coded brand colors or color literals in components
- [ ] All interaction states present: default, hover, pressed, selected, focus, disabled
- [ ] WCAG AA contrast verified for text, icons, borders, buttons, links, tables, charts, and every state
- [ ] `mainText` used on `primarySoftStrong` — `primary` there only at large text sizes (verified 4.24:1)
- [ ] `borderSubtle` not used for any interactive boundary; `borderStrong` used instead
- [ ] Placeholders use `secondaryText`, never `disabled`
- [ ] Charts differentiate series by label, marker, or pattern — not hue alone
- [ ] Status conveyed by text and icon, never color alone
- [ ] Keyboard operation complete; visible focus never removed
- [ ] Responsive verified in both directions

## 6. UI states

Every screen and every data surface:

- [ ] Loading
- [ ] Empty
- [ ] Error
- [ ] Forbidden
- [ ] Success

## 7. Data integrity

Per [../architecture/data-model-conventions.md](../architecture/data-model-conventions.md).

- [ ] Money is `Decimal128` in storage, string in transport, decimal arithmetic throughout — no `number`
- [ ] Allocation tests prove parts sum exactly to totals, including values that do not divide evenly
- [ ] `Instant` and `BusinessDate` used correctly; no business date stored as a timestamp
- [ ] Multi-document state changes are transactional
- [ ] Optimistic concurrency on edits; locks where scarce resources contend
- [ ] Retryable operations idempotent — a test runs each twice and asserts one effect
- [ ] No hard delete of protected records; cancellation, reversal, archival, or deactivation used
- [ ] Unique indexes partial where cancelled records must not block new ones
- [ ] Indexes declared for every new collection and reviewed
- [ ] Migration and rollback reviewed where applicable

## 8. Integrations (phases with providers)

Per [../architecture/integrations.md](../architecture/integrations.md) §7.

- [ ] Provider reached only through its adapter; no SDK import in a domain module
- [ ] API version pinned and recorded
- [ ] Webhook signature verification enforced before processing
- [ ] Replay and duplicate delivery produce exactly one effect
- [ ] Provider errors mapped to domain errors with request IDs
- [ ] Rate limits handled without data loss
- [ ] Revoked or expired token produces an actionable error, not a crash
- [ ] Reconciliation detects a deliberately dropped event
- [ ] Partial provider failure leaves no half-applied internal state
- [ ] No secret in any log line
- [ ] No fabricated provider capability shown in the UI

## 9. Security review

- [ ] No unresolved critical or high finding
- [ ] Dependency scan clean
- [ ] Secret scan clean; no secret in the repository or its history
- [ ] Log redaction verified against real log output
- [ ] No production data in development or CI

## 10. Documentation

- [ ] OpenAPI updated
- [ ] Data dictionary / schema documentation updated
- [ ] Affected ADRs added or superseded — never edited in place
- [ ] [../glossary.md](../glossary.md) updated for new user-facing terms
- [ ] [../REQUIREMENTS.md](../REQUIREMENTS.md) statuses updated
- [ ] [../decisions/open-decisions.md](../decisions/open-decisions.md) updated — items closed, items added
- [ ] **`docs/MEMORY.md` reconciled against the verified repository**, with stale content replaced rather
      than accumulated
- [ ] Runbooks updated where operational behaviour changed

## 11. Prohibited without explicit authorization

Confirm none of these occurred:

- [ ] No push to any remote; no remote created
- [ ] No deployment
- [ ] No production campaign published
- [ ] No billing change
- [ ] No production data modified, imported, or copied into a lower environment
- [ ] No secret committed
- [ ] No unrelated user work reset, overwritten, or deleted

## Gate outcome

Record in `docs/MEMORY.md`:

- phase, date, requirement IDs `verified` and deferred
- commands run and their **actual** results
- checklist items that failed or remain open, and why
- residual risks and technical debt
- the exact next action

A gate with any unchecked item in sections 2–9 has **not** passed. Say so plainly rather than hedging.

---

## Phase 1 — gate status as of 2026-09-21

**Phase 1 has NOT passed its gate.** Recorded here because the checklist above is a template; only proven
facts appear below.

Proven for the scope implemented so far (commands run locally, results as observed):

| Section | Item | Result |
|---|---|---|
| 2 | `npm run lint` | ✅ 0 errors, 0 warnings |
| 2 | `npm run format:check` | ✅ |
| 2 | `npm run typecheck` | ✅ strict, root + 9 workspaces, no new suppressions |
| 2 | `npm run test:unit` | ✅ 284 passed, 17 files |
| 2 | `npm run test:integration:gate` | ✅ 59 passed, 0 failed, **0 skipped**, 4 files |
| 2 | `npm run check:bundle` | ✅ within budget |
| 2 | `npm run test:e2e` | ✅ Arabic RTL and English LTR, desktop and mobile |
| 2 | `npm run build` | ✅ web, api, worker |
| 3 | Permission denied without the permission | ✅ tested per implemented endpoint |
| 3 | Out-of-scope records absent from results, totals, and exports | ✅ tested |
| 3 | Protected fields absent for unauthorized actors, including exports | ✅ tested |
| 3 | Out-of-scope record returns `404`, not `403` | ✅ tested |
| 3 | Audit record for every mutation and every export | ✅ tested, and enforced at runtime |
| 3 | Privilege-escalation attempts fail | ✅ tested, and each refusal audited |
| 3 | Unknown and malformed input rejected | ✅ tested |
| 9 | Dependency scan, secret scan, log redaction | ✅ |

Open, and therefore blocking:

- Section 1 — no requirement is `verified`; **44 of 113** Phase 1 requirements are not started and 10 are
  in progress. No stakeholder demonstration, no written approval.
- Section 3 — **self-approval / separation of duties** untested because `APPROVAL-*` is not built.
- Section 3 — **session invalidation on suspension and permission change** untested because there are no
  sessions (`SEC-010`–`SEC-022`). Grant changes do take effect immediately
  ([ADR-0022](../decisions/adr-0022-authorization-resolved-per-request.md)).
- Section 4 — Arabic glyph assertion in generated PDFs: no PDF generation exists yet.
- Section 6 — the implemented scope is API-only; no new screens, so no UI states to verify.
- Section 8 — no integrations built.
- Section 10 — a data dictionary for the new collections is recorded in
  [../architecture/security-model.md](../architecture/security-model.md) §9 rather than a separate document.

Hosted CI has still never run: there is no remote.
