# Requirement Registry

Version: 1.2 · Last updated: 2026-09-19 · Scheme: [ADR-0014](decisions/adr-0014-requirement-id-scheme.md),
namespaces [ADR-0016](decisions/adr-0016-phase-1-requirement-namespaces.md)

## How to use this registry

- Format: `<NAMESPACE>-<NNN>`, sequential within the namespace. **IDs are permanent and never reused.**
- Status values: `proposed` · `approved` · `in-progress` · `implemented` · `verified` · `blocked` · `withdrawn`
- **`implemented` is not `verified`.** Only `verified` counts toward a phase gate, and only against code and
  tests — never against documentation.
- A `blocked` requirement names its blocking `SD-` item from
  [decisions/open-decisions.md](decisions/open-decisions.md).
- Every commit implementing scope references at least one ID.

### Elaboration policy

Phase 1 is enumerated in full below because it is the active phase. Phases 2–9 are registered at
**module level** only. Enumerating detailed requirements for later phases today would mean inventing
business rules no stakeholder has confirmed, which `CLAUDE.md` prohibits. Each phase's requirements are
enumerated during that phase's discovery.

## Current status summary

| | Count |
|---|---|
| Phase 1 requirements registered | 113 |
| Status `approved` (not yet started) | see per-row status |
| Status `verified` | **0** — nothing is gate-verified until Phase 1 review |
| Gap requirements from discovery, status `proposed` | 9 (4 others already registered in Phase 1) |
| Modules registered for Phases 2–9 | 82 |

Per-requirement implementation status is recorded in `docs/MEMORY.md` by ID. A row with no status note
below is `approved` and not started.

## Phase 1 namespaces (approved — `SD-22`)

| Namespace | Covers | Linked Master Mapping module |
|---|---|---|
| `PLAT` | Platform and application foundation | — (§4.1, §4.2) |
| `I18N` | Localization, direction, typography | — (§5.1, §5.2) |
| `THEME` | Light Mode and design tokens | — (§5.3) |
| `SEC` | Authentication, user security accounts, sessions, authorization, encryption, security | `CORE-USER` (security account only), `CORE-RBAC` |
| `AUDIT` | Audit infrastructure | `CORE-AUDIT` |
| `APPROVAL` | Approval infrastructure | `CORE-APPROVAL` |
| `INTEGRATION` | Provider adapter foundations | `CORE-INTEGRATION` |
| `TEST` | Testing and quality infrastructure | — (§4.3, §13) |
| `OPS` | Environments, monitoring, backup, operational foundations | — (§4.1, §6) |

`CORE-NOTIFY`, `CORE-TASK`, `CORE-DOC`, `CORE-SEARCH`, and `CORE-IMPORT` are business-platform modules
that no namespace covers; they keep their Master Mapping codes (ADR-0016 rule 3).

### Ownership boundary: SEC, CORE-ORG, HR-EMP (approved — [ADR-0019](decisions/adr-0019-security-account-organization-employee-boundary.md))

| Owner | Owns | Phase |
|---|---|---|
| `SEC` | Authentication; user security accounts; passwords; sessions; devices; MFA; account activation and suspension; roles; permissions; field restrictions; data scopes; authorization policies; security events | 1 |
| `CORE-ORG` | Legal entities; branches; departments; teams; job titles; reporting hierarchy; organization placement references | 2 |
| `HR-EMP` | Employee business profiles; employment contracts; HR documents; attendance identity; payroll identity; employee organization placement | 8 |

A user security account may **reference** an employee record; it never becomes the employee HR aggregate.

**Review of `SEC-011`–`SEC-032` against this boundary (2026-09-19):** every ID represents account security,
authentication, sessions, authorization, roles, permissions, field restrictions, or data scopes, so all
stay in `SEC`. **None holds employee or HR business data, so none is restored to `CORE-ORG` or `HR-EMP`.**
Three were clarified and one was narrowed:

| ID | Change | Why |
|---|---|---|
| `SEC-011` | Clarified: the account holds an optional *reference* to an employee | The account is not the employee aggregate |
| `SEC-019` | Clarified: account suspension and *deactivation* | Employment termination is an `HR-EMP` event |
| `SEC-021` | **Narrowed** to the account-security part of offboarding | Reassigning tasks, approvals, and customers is owned elsewhere: `CORE-TASK-005`, `APPROVAL-007` (new, Phase 1) and `CRM-OWNER` (Phase 3) |
| `SEC-026` | Clarified: scopes reference organization units owned by `CORE-ORG` | `SEC` stores the assignment, not the hierarchy |

---

# Phase 1 — Discovery, architecture, core, security, localization, Light Mode

Source: `docs/PHASE-PROMPTS.md` Phase 1; `docs/MASTER-MAPPING.md` §4–§6, §12.

## PLAT — Platform foundation

| ID | Requirement | Source | Notes |
|---|---|---|---|
| PLAT-001 | TypeScript monorepo: `apps/web`, `apps/api`, `apps/worker`, `packages/*` | MM §4.2 | |
| PLAT-002 | Strict TypeScript everywhere; `tsc --noEmit` passes | ADR-0002 | |
| PLAT-003 | ESLint/Prettier with module-import-boundary, no-color-literal, and no-physical-CSS rules | ADR-0001, ADR-0005 | Boundary enforcement is what keeps ADR-0001 real |
| PLAT-006 | Pino structured logging with redaction configured once at the instance | ADR-0015 | |
| PLAT-007 | Correlation ID generated per request and propagated to worker, logs, audit, provider calls | MM §6 | |
| PLAT-008 | Centralized error handling with stable machine codes | ADR-0003 | Codes, not prose — the client localizes |
| PLAT-010 | OpenAPI documentation generated from the contracts package | MM §4.1 | |
| PLAT-011 | `packages/contracts` as the single definition of every request, response, and domain enum | ADR-0002 | |
| PLAT-012 | Money type: `Decimal128` storage, string transport, decimal arithmetic, explicit rounding | ADR-0007 | |
| PLAT-013 | Distinct `Instant` and `BusinessDate` types; `TZ=UTC` asserted | ADR-0008 | Wrong choice must fail typecheck |
| PLAT-014 | MongoDB client with strict schemas, transaction capability detection, fail-safe errors | ADR-0012 | Must report clearly when no replica set is present |
| PLAT-015 | Redis client with fail-safe errors | ADR-0012 | |
| PLAT-016 | BullMQ worker bootstrap with backoff, bounded retries, dead-letter queue | ADR-0010 | |
| PLAT-017 | Private S3 file abstraction with short-lived signed URLs | MM §4.1 | No public objects |
| PLAT-021 | Production build of all three applications | MM §13 | |

Retired provisional IDs `PLAT-004`, `PLAT-005`, `PLAT-009`, `PLAT-018`, `PLAT-019`, `PLAT-020` moved to
other namespaces — see the re-keying table. They are never reused.

## OPS — Environments and operational foundations

| ID | Requirement | Source | Notes |
|---|---|---|---|
| OPS-001 | Environment configuration validated at startup; clear failure naming the variable, never its value | ADR-0012 | Was `PLAT-004` |
| OPS-002 | `.env.example` complete with placeholders only; automated completeness check against the schema | ADR-0015 | Was `PLAT-005` |
| OPS-003 | Per-dependency health checks | ADR-0012 | Was `PLAT-009`. Redis outage distinguishable from database outage |

Backup, restore, monitoring, and incident policy are blocked on `SD-18` and are registered when Phase 9
discovery enumerates them.

## TEST — Testing and quality infrastructure

| ID | Requirement | Source | Notes |
|---|---|---|---|
| TEST-001 | Test harness with unit / integration / E2E tiers; service-dependent tests skipped with explicit message | ADR-0012 | Was `PLAT-019`. A skip is never reported as a pass |
| TEST-002 | Quality pipeline: lint, typecheck, unit tests, build, i18n key check, secret scan, dependency scan | MM §13 | Was `PLAT-020` |
| TEST-003 | Arabic RTL / English LTR Light Mode E2E smoke tests | Phase 1 prompt | New — registered from the Phase 1 prompt's closing instruction |

## SEC — Authentication, authorization, encryption, security

### Hardening

| ID | Requirement | Source | Notes |
|---|---|---|---|
| SEC-001 | Helmet security headers, HSTS, strict CORS allow-list | MM §6 | |
| SEC-002 | CSRF protection where cookie authentication applies | MM §6 | |
| SEC-003 | Rate limiting per IP and per account on auth, export, and provider-triggering endpoints | MM §6 | |
| SEC-004 | Validation at every API boundary; unknown fields rejected, not ignored | ADR-0006 | Silently ignoring hides mass-assignment attempts |
| SEC-005 | Upload validation of size, declared type, and actual content type, plus a malware scanning hook | MM §6 | |
| SEC-006 | Secrets from environment / Secrets Manager only; never in code, never logged | ADR-0015 | |
| SEC-007 | Log redaction configured centrally at the logger | ADR-0015 | |
| SEC-008 | Private file access by short-lived signed URL only | MM §6 | |
| SEC-009 | Dependency and secret scanning; no unresolved critical or high finding passes a gate | MM §13 | |
| SEC-010 | Privilege-escalation test suite | MM §13 | |

### Authentication and identity lifecycle — Master Mapping module `CORE-USER`

| ID | Requirement | Source | Notes |
|---|---|---|---|
| SEC-011 | User security account with an optional reference to an `HR-EMP` employee record; no employee business data on the account | MM §6, ADR-0019 | Was `CORE-USER-001`. Reference validated once `HR-EMP` exists (Phase 8) |
| SEC-012 | Invitation and activation flow | MM §6 | Was `CORE-USER-002` |
| SEC-013 | Login/logout with Argon2id password hashing | MM §6 | Was `CORE-USER-003` |
| SEC-014 | Short-lived access tokens; refresh tokens rotated in `Secure` `HttpOnly` cookies | MM §6 | Was `CORE-USER-004`. Never `localStorage` |
| SEC-015 | Refresh-token reuse detection invalidating the whole session family | ADR-0006 | Was `CORE-USER-005` |
| SEC-016 | Password reset | MM §6 | Was `CORE-USER-006` |
| SEC-017 | Mandatory MFA for privileged roles | MM §6 | Was `CORE-USER-007`. Role categories fixed by MM §6; the concrete role list arrives with `SD-02` in Phase 2 |
| SEC-018 | Device and session listing with individual and bulk revocation | MM §6 | Was `CORE-USER-008` |
| SEC-019 | Account suspension and deactivation without deletion | ADR-0009, ADR-0019 | Was `CORE-USER-009`. Deleting an account orphans audit records. Employment termination is `HR-EMP` |
| SEC-020 | Immediate server-side session invalidation on suspension, password reset, and permission change | G-08 | Was `CORE-USER-010` |
| SEC-021 | Account offboarding as one audited action: suspend the account and revoke all sessions, devices, and delegations | **G-08**, ADR-0019 | Was `CORE-USER-011`. Narrowed 2026-09-19; record reassignment moved to `CORE-TASK-005`, `APPROVAL-007`, `CRM-OWNER` |
| SEC-022 | Personal accounts only; shared accounts prohibited | **G-10** | Was `CORE-USER-012`. Arabic scope p19 |

### Authorization — Master Mapping module `CORE-RBAC`

| ID | Requirement | Source | Notes |
|---|---|---|---|
| SEC-023 | Permission catalog of granular verbs | MM §6 | Was `CORE-RBAC-001` |
| SEC-024 | Roles as named permission bundles | MM §6 | Was `CORE-RBAC-002`. Mechanism only; business role content arrives with `SD-02` |
| SEC-025 | Server-side authorization evaluating **permissions, never role names** | ADR-0006 | Was `CORE-RBAC-003` |
| SEC-026 | Data scope model: `self`…`all` | MM §6, ADR-0019 | Was `CORE-RBAC-004`. Scopes reference `CORE-ORG` units; hierarchy values arrive with `SD-01` |
| SEC-027 | Scoped repository: no method accepts a filter without a scope; fetch-then-filter prohibited | ADR-0006 | Was `CORE-RBAC-005`. The single most important control in the system |
| SEC-028 | Scope applied to counts, aggregates, pagination totals, exports, and search | ADR-0006 | Was `CORE-RBAC-006` |
| SEC-029 | Field-level restriction; protected fields **absent** from serialization, exports, and PDFs | ADR-0006 | Was `CORE-RBAC-007` |
| SEC-030 | Out-of-scope record returns `404`, not `403` | ADR-0006 | Was `CORE-RBAC-008` |
| SEC-031 | Privilege-escalation prevention with test coverage | MM §13 | Was `CORE-RBAC-009` |
| SEC-032 | Permission and scope changes take effect immediately, not at next login | ADR-0006 | Was `CORE-RBAC-010` |

### Encryption

| ID | Requirement | Source | Notes |
|---|---|---|---|
| SEC-033 | Encryption abstraction over KMS | MM §6 | Was `PLAT-018` |

## AUDIT — Audit infrastructure (Master Mapping module `CORE-AUDIT`)

| ID | Requirement | Source | Notes |
|---|---|---|---|
| AUDIT-001 | Append-only store with no delete path in code, migrations, or tooling | ADR-0009 | Was `CORE-AUDIT-001` |
| AUDIT-002 | Full record: actor, action, entity, before/after summary, reason, UTC time, session, IP, correlation ID, provider reference | MM §6 | Was `CORE-AUDIT-002` |
| AUDIT-003 | Automatic audit on every mutation | MM §6 | Was `CORE-AUDIT-003` |
| AUDIT-004 | Audit of every export and of sensitive-data reads | MM §11 | Was `CORE-AUDIT-004` |
| AUDIT-005 | Audit of authentication events and permission/role/scope changes | MM §6 | Was `CORE-AUDIT-005` |
| AUDIT-006 | Summaries, not verbatim protected values | ADR-0006 | Was `CORE-AUDIT-006` |

## APPROVAL — Approval infrastructure (Master Mapping module `CORE-APPROVAL`)

| ID | Requirement | Source | Notes |
|---|---|---|---|
| APPROVAL-001 | Approval request entity and state machine | MM §7 | Was `CORE-APPROVAL-001` |
| APPROVAL-002 | Rules configurable by amount, percentage, role, project, department, risk, exception | MM §7 | Was `CORE-APPROVAL-002`. Engine only; thresholds arrive with `SD-02` |
| APPROVAL-003 | Maker-checker: self-approval rejected unless an explicit audited policy permits it | ADR-0006 | Was `CORE-APPROVAL-003`. Never a code branch |
| APPROVAL-004 | Delegation, time-bounded and audited | MM §6 | Was `CORE-APPROVAL-004` |
| APPROVAL-005 | Escalation of an overdue task **or approval** to the direct manager | **G-09** | Was `CORE-APPROVAL-005`. Arabic scope p17 |
| APPROVAL-006 | Immutable approval history | ADR-0009 | Was `CORE-APPROVAL-006` |
| APPROVAL-007 | Reassign an offboarded user's pending approvals to an authorized approver, audited | **G-08**, ADR-0019 | New 2026-09-19 — split from `SEC-021` |

## INTEGRATION — Provider adapter foundations (Master Mapping module `CORE-INTEGRATION`)

| ID | Requirement | Source | Notes |
|---|---|---|---|
| INTEGRATION-001 | Registry with encrypted provider configuration | ADR-0010 | Was `CORE-INTEGRATION-001` |
| INTEGRATION-002 | Pinned API version per adapter, recorded in config and `MEMORY.md` | ADR-0010 | Was `CORE-INTEGRATION-002` |
| INTEGRATION-003 | Health, token validity, last sync, last error, and data-freshness exposure | ADR-0010 | Was `CORE-INTEGRATION-003` |
| INTEGRATION-004 | Webhook signature verification framework, applied before any processing | ADR-0010 | Was `CORE-INTEGRATION-004` |
| INTEGRATION-005 | Provider event ID uniqueness; duplicates acknowledged and discarded | ADR-0010 | Was `CORE-INTEGRATION-005` |
| INTEGRATION-006 | Idempotent job framework with backoff and dead-letter queue | ADR-0010 | Was `CORE-INTEGRATION-006` |

## CORE-NOTIFY — Notifications

| ID | Requirement | Source | Notes |
|---|---|---|---|
| CORE-NOTIFY-001 | Notification model with in-app delivery | MM §8 | |
| CORE-NOTIFY-002 | Channel adapter registry for email, SMS, WhatsApp — functional with no live provider | ADR-0010, ADR-0012 | Providers arrive with `SD-20` (Phase 3) |
| CORE-NOTIFY-003 | Per-recipient language selection | ADR-0003 | |
| CORE-NOTIFY-004 | Quiet hours honoured in the organization timezone | ADR-0008 | Mechanism only; values arrive with `SD-21` |
| CORE-NOTIFY-005 | Delivery status tracking with retry that does not duplicate | ADR-0010 | Arabic scope p17 |

## CORE-TASK — Tasks and reminders

| ID | Requirement | Source | Notes |
|---|---|---|---|
| CORE-TASK-001 | Task with owner, due date, priority, and linked entity | MM §8 | Arabic scope p17 |
| CORE-TASK-002 | Reminder scheduling computed in the organization timezone, stored in UTC | ADR-0008 | |
| CORE-TASK-003 | Escalation on overdue | **G-09** | |
| CORE-TASK-004 | Calendar view | MM §8 | |
| CORE-TASK-005 | Reassign an offboarded user's open tasks, audited | **G-08**, ADR-0019 | New 2026-09-19 — split from `SEC-021` |

## CORE-DOC — Documents, templates, numbering

| ID | Requirement | Source | Notes |
|---|---|---|---|
| CORE-DOC-001 | Numbering sequences by entity, document type, project, and fiscal year; atomic generation; **no reuse** | ADR-0009 | Engine only; official formats arrive with `SD-10` (Phase 4) |
| CORE-DOC-002 | Template registry with bilingual templates | ADR-0003 | Registry only; templates arrive with `SD-10` |
| CORE-DOC-003 | PDF generation with **embedded Arabic-capable fonts**; glyph rendering asserted by test | ADR-0003 | A "file produced" assertion does not catch this |
| CORE-DOC-004 | Document version retention | ADR-0009 | |
| CORE-DOC-005 | QR verification | MM §8 | |
| CORE-DOC-006 | Audit of **who printed or downloaded** each document | **G-03** | Arabic scope p17 |

## CORE-SEARCH / CORE-IMPORT

| ID | Requirement | Source | Notes |
|---|---|---|---|
| CORE-SEARCH-001 | Global search honouring data scope and field restrictions | ADR-0006 | Search is a common scope-leak path |
| CORE-IMPORT-001 | Validated Excel/CSV import with preview before commit | MM §8 | |
| CORE-IMPORT-002 | Per-row error report; no partial silent import | MM §8 | |

## I18N — Localization

| ID | Requirement | Source | Notes |
|---|---|---|---|
| I18N-001 | i18next with Arabic default and per-module namespaces | ADR-0003 | |
| I18N-002 | Complete `ar` and `en` keys in every change; **the check fails on a missing key** | ADR-0003 | |
| I18N-003 | Locale and direction change atomically | ADR-0003 | No frame with mismatched locale and `dir` |
| I18N-004 | Logical CSS properties enforced by lint | ADR-0003 | |
| I18N-005 | Bidirectional isolation for phone, email, URL, IBAN, account, and code fields | ADR-0003 | Prevents visible digit/punctuation reordering |
| I18N-006 | Locale-aware date, number, currency, percentage, and ICU plural formatting | ADR-0003 | Arabic has six plural categories |
| I18N-007 | Self-hosted Alexandria and Inter with real fallback stacks | ADR-0003 | |
| I18N-008 | Server returns stable codes; client localizes all messages | ADR-0003 | |
| I18N-009 | `{ ar, en }` shape required for every configurable label | ADR-0003 | |

## THEME — Design system and Light Mode

| ID | Requirement | Source | Notes |
|---|---|---|---|
| THEME-001 | Centralized Light Mode theme exposing the approved token set | ADR-0005 | |
| THEME-002 | No Dark Mode, System Mode, switcher, or preference; lint fails on `prefers-color-scheme` | ADR-0004 | `SD-13` closed — Light Mode only confirmed |
| THEME-003 | No color literals in components; lint-enforced | ADR-0005 | |
| THEME-004 | Default, hover, pressed, selected, focus, and disabled states on every interactive element | ADR-0005 | |
| THEME-005 | Automated contrast verification for every token pair in use | ADR-0005 | |
| THEME-006 | `mainText` on `primarySoftStrong`; `primary` there only at large text sizes | ADR-0005 | **Verified 4.24:1 — fails AA for normal text** |
| THEME-007 | `borderSubtle` decorative only; interactive boundaries use `borderStrong` | ADR-0005 | `borderSubtle` is 1.48:1 |
| THEME-008 | Placeholders use `secondaryText`, never `disabled` | ADR-0005 | `disabled` is 2.56:1 |
| THEME-009 | Charts differentiate series by label, marker, or pattern — never hue alone | ADR-0005 | Palette pairs are 1.00–1.25 in relative contrast |
| THEME-010 | Loading, empty, error, forbidden, and success states in shared components | MM §13 | |
| THEME-011 | Full keyboard operation with a visible `focusRing`; focus never removed | MM §6 | |
| THEME-012 | Responsive navigation and layout verified in both RTL and LTR | MM §5.2 | |

---

# Re-keying record — 2026-09-19 (`SD-22`, ADR-0016)

Provisional IDs were re-keyed once, before the baseline commit, to apply the nine approved namespaces
consistently. No code or commit used the old IDs. **Old IDs are retired and never reused.**

| Old ID | New ID | | Old ID | New ID |
|---|---|---|---|---|
| PLAT-004 | OPS-001 | | CORE-RBAC-001 | SEC-023 |
| PLAT-005 | OPS-002 | | CORE-RBAC-002 | SEC-024 |
| PLAT-009 | OPS-003 | | CORE-RBAC-003 | SEC-025 |
| PLAT-018 | SEC-033 | | CORE-RBAC-004 | SEC-026 |
| PLAT-019 | TEST-001 | | CORE-RBAC-005 | SEC-027 |
| PLAT-020 | TEST-002 | | CORE-RBAC-006 | SEC-028 |
| — | TEST-003 (new) | | CORE-RBAC-007 | SEC-029 |
| CORE-USER-001 | SEC-011 | | CORE-RBAC-008 | SEC-030 |
| CORE-USER-002 | SEC-012 | | CORE-RBAC-009 | SEC-031 |
| CORE-USER-003 | SEC-013 | | CORE-RBAC-010 | SEC-032 |
| CORE-USER-004 | SEC-014 | | CORE-AUDIT-001…006 | AUDIT-001…006 |
| CORE-USER-005 | SEC-015 | | CORE-APPROVAL-001…006 | APPROVAL-001…006 |
| CORE-USER-006 | SEC-016 | | CORE-INTEGRATION-001…006 | INTEGRATION-001…006 |
| CORE-USER-007 | SEC-017 | | | |
| CORE-USER-008 | SEC-018 | | | |
| CORE-USER-009 | SEC-019 | | | |
| CORE-USER-010 | SEC-020 | | | |
| CORE-USER-011 | SEC-021 | | | |
| CORE-USER-012 | SEC-022 | | | |

Added after re-keying (2026-09-19, ADR-0019): `CORE-TASK-005`, `APPROVAL-007` — split from `SEC-021`.

Unchanged: all `I18N-*`, `THEME-*`, `SEC-001`…`SEC-010`, the remaining `PLAT-*`, and every `CORE-NOTIFY`,
`CORE-TASK`, `CORE-DOC`, `CORE-SEARCH`, and `CORE-IMPORT` ID.

---

# Gap requirements from discovery — status `proposed`

From [discovery/arabic-scope-review.md](discovery/arabic-scope-review.md). Present in the Arabic business
scope document but not explicit in the Master Mapping. **`proposed` means not approved and not to be built.**
Those assigned to Phase 1 (`G-03`, `G-08`, `G-09`, `G-10`) are already registered with IDs; the rest
receive IDs when their phase is elaborated.

| Gap | Requirement | Module | Phase | Registered as | Status |
|---|---|---|---|---|---|
| G-01 | Outgoing transfer request → review → approval → proof of execution; system never executes | FIN-CASH | 6 | pending Phase 6 | `proposed` |
| G-02 | General expense request with attachments, approval stages, spending limits | FIN-CASH | 6 | pending Phase 6 | `proposed` |
| G-03 | Per-document print/download audit | CORE-DOC | 1 | `CORE-DOC-006` | `approved` |
| G-04 | Approval-controlled **opening** of a financial period | FIN-GL | 6 | pending Phase 6 | `proposed` |
| G-05 | Approval-controlled beneficiary/payee data change | FIN-CASH | 6 | pending Phase 6 | `proposed` |
| G-06 | Check/note custody state machine + numbered handover minutes | COL-CHECK, COL-NOTE | 5 | pending Phase 5 | `proposed` |
| G-07 | Budget alert on **approaching** the limit, not only exceeding it | FIN-BUDGET | 6 | pending Phase 6 | `proposed` |
| G-08 | Offboarding: suspend + terminate sessions + transfer owned records | SEC, CORE-TASK, APPROVAL, CRM-OWNER | 1, 3 | `SEC-021`, `CORE-TASK-005`, `APPROVAL-007`; customer transfer pending Phase 3 `CRM-OWNER` | `approved` (Phase 1 parts) |
| G-09 | Escalate overdue task or approval to the direct manager | CORE-TASK, APPROVAL | 1 | `CORE-TASK-003`, `APPROVAL-005` | `approved` |
| G-10 | Personal accounts only; shared accounts prohibited | SEC (`CORE-USER`) | 1 | `SEC-022` | `approved` |
| G-11 | Book balances and currency per treasury and bank account | FIN-CASH, FIN-BANK | 6 | pending Phase 6 | `proposed` |
| G-12 | Cost and profitability per project **and per phase** | FIN-REPORT | 6 | pending Phase 6 | `proposed` |
| G-13 | Subcontractor contracts as a distinct tier | CONST-CONTRACT | 7 | pending Phase 7 | `proposed` |

---

# Phases 2–9 — module-level registration

Requirements are enumerated during each phase's discovery. Module codes are authoritative in
MASTER-MAPPING §8.

| Phase | Modules | Blocking decisions |
|---|---|---|
| 2 — Organization, projects, units, pricing, inventory | CORE-ORG (legal entities, branches, departments, teams, job titles, reporting hierarchy, placement references — ADR-0019), INV-PROJECT, INV-UNIT, INV-STATUS, INV-PRICE, INV-PLAN, INV-HOLD, INV-SEARCH | `SD-01`, `SD-02`, `SD-03` (incl. conflict `C-06`), `SD-05`, `SD-21`; Atlas cluster provisioned (`D2`) for transaction verification |
| 3 — CRM, WhatsApp, Meta, leads, attribution | CRM-PERSON, CRM-LEAD, CRM-OPP, CRM-PIPE, CRM-ASSIGN, CRM-OWNER, CRM-ACTIVITY, CRM-MATCH, CRM-LOSS, CRM-WA, CRM-REPORT, MKT-CONNECT, MKT-ASSET, MKT-CAMPAIGN, MKT-ADSET, MKT-CREATIVE, MKT-AD, MKT-LEADFORM, MKT-AUDIENCE, MKT-WORKFLOW, MKT-BUDGET, MKT-SPEND, MKT-INSIGHT, MKT-ATTRIBUTION, MKT-CAPI, MKT-POLICY, MKT-SYNC, MKT-AUDIT | Full Meta scope approved (`SD-14` closed). MKT-CAPI built with production delivery disabled (`SD-15`, ADR-0017). Open: `SD-04`, `SD-09`, `SD-19`, `SD-20` |
| 4 — Quotations, reservations, contracts | SALE-QUOTE, SALE-DISCOUNT, SALE-RESERVE, SALE-CONTRACT, SALE-CHANGE, SALE-CANCEL | `SD-05`, `SD-10`, `SD-17` |
| 5 — Installments, collections, checks, notes | COL-SCHEDULE, COL-INVOICE, COL-RECEIPT, COL-REMIND, COL-CHECK, COL-NOTE, COL-STATEMENT | `SD-05`, `SD-07` (incl. `G-06`), `SD-09`, `SD-20`, `SD-21` |
| 6 — Accounting, treasury, banks, tax, assets, budgets | FIN-COA, FIN-GL, FIN-ARAP, FIN-INVOICE, FIN-CASH, FIN-BANK, FIN-FACILITY, FIN-BUDGET, FIN-TAX, FIN-ASSET, FIN-REPORT | **`SD-08` blocks the entire phase** — requires an appointed accounting reviewer |
| 7 — Procurement, stores, contractors, construction | PROC-VENDOR, PROC-REQUEST, PROC-RFQ, PROC-PO, WH-ITEM, WH-TRANS, CONST-CONTRACT, CONST-CERT, CONST-PROGRESS | `SD-02` |
| 8 — HR, payroll, commissions, custody | HR-EMP (employee profiles, contracts, HR documents, attendance and payroll identity, placement — ADR-0019), HR-TIME, HR-PAY, HR-COMM, HR-ADV, HR-CUSTODY, HR-PERF | `SD-06`, `SD-08`, `SD-21` |
| 9 — Handover, after-sales, analytics, migration, launch | HAND-READY, HAND-APPT, HAND-INSPECT, HAND-DELIVER, CS-TICKET, PORTAL-CUSTOMER | `SD-11`, `SD-17`, `SD-18` |

## Maintenance

1. Claim IDs here **before** using them in code, so parallel sessions do not collide.
2. Update status in the same change as the code.
3. A requirement reaching `verified` names the tests that verify it.
4. `docs/MEMORY.md` records status by ID, never by prose alone.
5. A withdrawn requirement keeps its ID with status `withdrawn`. Never renumber.
