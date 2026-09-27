# Requirement Registry

Version: 1.5 · Last updated: 2026-09-21 · Scheme: [ADR-0014](decisions/adr-0014-requirement-id-scheme.md),
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

## Macro delivery phases — a grouping, not a re-registration

Approved 2026-09-22 — [ADR-0025](decisions/adr-0025-macro-delivery-phases.md).

Delivery is now scheduled in four macro phases. **Nothing in this registry changes because of them.** No
ID is renamed, renumbered, merged, retired, or moved to another namespace; no status is raised; the nine
engineering phases and their gates keep their meaning.

| Macro phase | Name | Covers engineering scope |
|---|---|---|
| Macro Phase 1 | Client Demo MVP | A vertical demonstration slice crossing Phases 2–5, plus remaining shell work in Phase 1 |
| Macro Phase 2 | Complete Real Estate Sales and Finance | Phases 2, 4, 5, 6 in full |
| Macro Phase 3 | Operations, Procurement and Human Resources | Phases 7 and 8 in full |
| Macro Phase 4 | Marketing Integrations, Production Hardening and Launch | Phase 3 provider work and Phase 9 in full |

Macro Phase 1 builds real, persisted, authorized, audited code in modules registered to Phases 2–5. That
code is a **demonstration slice**, and a slice never satisfies a requirement:

- Modules registered for Phases 2–9 below stay at their registered status. A slice touching `CORE-ORG`,
  `INV-UNIT`, `CRM-LEAD`, `SALE-RESERVE`, `SALE-CONTRACT`, or `COL-*` does **not** make those modules
  `in-progress` or `implemented` in the engineering sense.
- `docs/MEMORY.md` records demo-slice scope in its own section, separately from requirement status.
- No requirement becomes `verified` because of the client demonstration.

**Macro Phase 1 was completed on 2026-09-23, and this registry is unchanged by it.** The slice built
`CORE-ORG`, inventory, CRM, sales, collections and marketing modules, a web application, a
development-only demonstration seed, and an end-to-end suite. Not one ID below was renamed,
renumbered, merged, retired or raised in status; nothing became `verified`; Phase 1's gate is still
open. What was built, and what it deliberately does not do, is in `docs/MEMORY.md` §"Macro Phase 1 —
the demonstration slice".

## Foundation completion — additions registered 2026-09-27

Source: the post-demonstration foundation master prompt and the stakeholder decision recorded in
[ADR-0027](decisions/adr-0027-single-tenant-per-deployment.md) (single tenant per deployment,
multi-client product). **These IDs are new; no existing ID is renamed, renumbered, merged or retired.**
They are claimed here before any code uses them (maintenance rule 1). Nothing is `verified`.

`CORE-ORG` is registered for Phase 2 at module level. The stakeholder has directed that its reusable
foundation be completed now, so its foundation requirements are enumerated here; the organization's
real **values** (`SD-01`) remain a Phase 2 input, and no business policy is decided by these IDs.

| ID | Requirement | Package | Status |
|---|---|---|---|
| PLAT-022 | Exactly one company profile per deployment: bilingual legal, trade and short names, registrations, address, contact, languages, timezone, base currency, country, footer; versioned with an append-only revision history; no secrets; no tenant identifier | F1 | implemented |
| PLAT-023 | Runtime branding — names, logo, compact logo, favicon, languages and the demonstration flag — served publicly without secrets and consumed by the sign-in screen, the shell and the browser tab, with a neutral fallback on any failure | F1 | implemented |
| THEME-013 | A deployment brand colour is validated against every contrast pair in use when saved and again before rendering; only the brand states are derived from it | F1 | implemented |
| CORE-ORG-001 | Legal entity, branch, department, team and job title with an active/inactive lifecycle; nothing referenced is ever deleted | F2 | implemented |
| CORE-ORG-002 | Hierarchy validation: a child belongs to an active parent in the same legal entity; reporting lines are cycle-free | F2 | implemented |
| CORE-ORG-003 | Employee placement with effective dates, direct manager and an append-only history; one active placement per security account | F2 | implemented |
| CORE-ORG-004 | Organization reads **and writes** constrained by the actor's data scope | F2 | implemented |
| CORE-ORG-005 | Direct-manager resolution for escalation, skipping nothing and inventing nothing | F2 | implemented |
| CORE-ORG-006 | Cost-centre and project-scope references on organization units | F2 | implemented |
| PLAT-024 | Centralized validated business settings, permissioned and audited, with history | F3 | implemented |
| PLAT-025 | Reference data with stable codes, bilingual labels, ordering and deactivation; a code in use is never removed or recoded | F3 | implemented |
| PLAT-026 | Feature flags limited to an approved catalog, audited | F3 | implemented |
| CORE-IMPORT-003 | Export: permission-checked, scope- and field-restricted, bounded, formula-safe, audited, expiring | F9 | approved |
| OPS-004 | Explicit, versioned schema migrations with a recorded database version | F11 | approved |
| OPS-005 | Repeatable client-deployment initialization, idempotent, refusing destructive resets | F11 | approved |
| OPS-006 | Operational readiness: worker, queue, integration and migration health; build metadata; redacted diagnostics | F12 | approved |
| OPS-007 | Scheduled maintenance sweeps run by the system, single-runner, idempotent | F12 | approved |

Existing IDs the foundation packages implement or advance keep their original rows below:
`CORE-DOC-001`–`006` (F4, F5), `CORE-NOTIFY-001`–`005` (F6), `CORE-TASK-001`–`005` (F7),
`CORE-SEARCH-001` (F8), `CORE-IMPORT-001`–`002` (F9), `INTEGRATION-001`–`005` (F10),
`APPROVAL-005` (F2), `SEC-033` (F11/F12).

### Implementation evidence — F1 (2026-09-27)

| ID | Evidence |
|---|---|
| PLAT-022 | `apps/api/src/modules/company/company.int-test.ts` — five simultaneous creations yield one profile (201, 409 ×4); secret-shaped and unknown fields (`smtpPassword`, `whatsappAccessToken`, `tenantId`, `version`, forged `assets`) refused with nothing stored; a stale `expectedVersion` is a conflict that changes nothing and two simultaneous edits yield exactly one; every change writes a revision and an audit record in one transaction; profiles, revisions and images cannot be deleted through the models |
| PLAT-023 | `company.int-test.ts` — the public endpoint answers the neutral identity before a profile exists and, after, only names, languages, colour and image URLs (no registration, contact or footer); PNG and JPEG verified by magic bytes, a mismatched, GIF or SVG body refused, 600 KiB refused with 413, path traversal refused; images served with their verified type, `nosniff` and an immutable cache for the current hash; a replaced image is superseded, not deleted. `apps/web/src/branding.test.tsx` — tab title, logo with the company name as its text alternative, favicon, starting language, a single-language deployment with no switch, no demonstration notice on a live deployment, and the neutral fallback on a malformed or refused answer |
| THEME-013 | `packages/ui/src/brand.test.ts` — no configuration returns the approved token object itself; the approved blue validates; a derived palette changes only the brand states; a dark colour passes every pair in use; `#FACC15` is refused naming `onPrimary` on `primary`; non-hex input refused; the module imports only tokens and contrast, so the server validates with the browser's rule. `packages/ui/src/ThemeRoot.test.tsx` — the theme renders a valid colour and ignores an invalid one. `company.int-test.ts` — `#FACC15` refused by the API with `BRAND_COLOR_CONTRAST` and nothing stored |

### Implementation evidence — F2 (2026-09-27)

Tests: `apps/api/src/modules/organization/foundation.int-test.ts` (13, new) and
`organization.int-test.ts` (20, unchanged and still passing), against real MongoDB.

| ID | Evidence |
|---|---|
| CORE-ORG-001 | Editable fields change, code/parent/currency are refused by the schema, an empty update is refused; a branch with an active department, a department with an active placement and a held job title cannot be deactivated (`ACTIVE_CHILDREN`); an empty department retires with its reason audited; a second deactivation is a conflict; nothing is deletable (existing suite) |
| CORE-ORG-002 | Nothing is created beneath an inactive parent (`PARENT_INACTIVE`, nothing stored); a unit reactivates only under an active parent; **six rounds of a deactivation racing a team creation and a placement** never leave an inactive department with anything active beneath it, and every request gets 200/201/409 — the parent "touch" and the deactivation write the same document inside their transactions, so MongoDB serializes them; cycles refused (existing suite and here) |
| CORE-ORG-003 | A transfer from a date takes branch and legal entity from the new department, refuses a team from another department (also on update — a defect in the slice) and a date before the start; history lists `transferred`, `created` with effective dates, reasons and before/after references and no names; deactivation sets `endedOn`; one active placement per account enforced on creation and on reactivation (`ACCOUNT_ALREADY_PLACED`); the history model refuses every update and delete |
| CORE-ORG-004 | A branch administrator changes their branch and gets `404` — identical to an absent record — for another branch, its departments and its placements, cannot transfer a placement out of scope, and gets `403` for deployment-wide legal entities and job titles; nothing outside the scope changed; a legal-entity administrator opens branches in their entity only |
| CORE-ORG-005 | The manager resolves only while effective: not before `startedOn`, not after an ended placement, never a skipped level; the reporting line walks to the top for an `all` actor and stops, `interrupted`, where a branch-scoped actor may not see |
| CORE-ORG-006 | Branch cost-centre set and returned; departments and teams carry cost centres, teams carry project references (contract and model; indexed) |

**`APPROVAL-005` moves from `in-progress` to `implemented`.** The one thing it lacked was a
reporting line that exists outside a demonstration slice. `foundation.int-test.ts` now submits a
request through a real `ApprovalService` wired exactly as `domain-services.ts` wires it —
`resolveManager` backed by `OrganizationService.resolveManagerAccount` — lets the stage go overdue,
sweeps, and finds the requester's manager among the pending approvers. The unresolved case (no manager,
an ended or future manager) is proven by the CORE-ORG-005 tests and by `approval.int-test.ts`.

### Implementation evidence — F3 (2026-09-27)

Tests: `apps/api/src/modules/settings/settings.int-test.ts` (14, real MongoDB) and
`packages/contracts/src/settings.test.ts` (17).

| ID | Evidence |
|---|---|
| PLAT-024 | Only catalogued keys can be written (`smtp.password`, `meta.accessToken`, `__proto__` refused, nothing stored); each value is validated against its own setting's schema (nine invalid shapes and an operator object refused); undecided values (`finance.fiscalYearStartMonth`, `sales.reservationValidityDays`, quiet hours) are `null` — *not configured* — and name their open decision; every non-null default satisfies its own schema; a change and a reset to default each create a version, an append-only revision with its reason, and an audit record; three simultaneous first edits yield one success and two conflicts, a stale version is refused; revisions and values cannot be deleted or rewritten through the models; `settings.view` / administrative `settings.manage` enforced |
| PLAT-025 | A bound list (`leadSources`, `unitTypes`, …) always serves every product code with its bilingual product label; it can be relabelled (the code unchanged) but not extended or recoded; the pipeline-stage list is locked because its state machine needs every stage; open lists are extended, duplicate codes refused, items withdrawn from new use but kept in storage, and retired items visible only with `referenceData.manage`; single-language labels refused; optimistic concurrency on items; tax rates are added forward only (`RATE_NOT_FORWARD`), bounded 0–100 on the digits, never through floating point, and `effectiveTaxRate` answers the rate in force on a date — no rate is seeded (`SD-08`) |
| PLAT-026 | Feature flags are exactly the catalogued `feature.*` settings; a flag gated by an ADR (`feature.meta.conversionsApiDelivery`, ADR-0017) cannot be switched on by configuration (`FEATURE_LOCKED`); an ordinary flag switches with a reason and an audit record; `isEnabled` accepts only catalogued feature keys by type |

### Implementation evidence — F4 (2026-09-27)

Tests: `apps/api/src/modules/numbering/numbering.int-test.ts` (11, real MongoDB) and
`apps/api/src/http/validate.test.ts` (3).

| ID | Evidence |
|---|---|
| CORE-DOC-001 | A draft format numbers nothing until activated; the preview reserves nothing; 25 concurrent issues yield exactly 1–25, no duplicate, no gap; a replayed idempotency key returns the same number — also when two replays race — and a replay with a different source is a conflict; a voided number is never reissued and cannot be deleted; each **legal entity**, branch and year is numbered separately; a number issued inside a transaction that then fails leaves no gap; a fiscal-year format refuses to issue until the fiscal year is configured (`SD-21`) and then follows it across its start month; the series continues across a format change, and a format that would reproduce an existing number is refused (`NUMBER_COLLISION`) with nothing consumed; a reset the number cannot show is refused at definition; only drafts are editable; two simultaneous activations leave exactly one active format; there is **no route that issues a number** |

**Not adopted yet by the demonstration modules.** Reservation, contract and receipt numbers in the
demonstration slice still come from the slice's own `salesCounters` (whose year comes from the
server's UTC clock — recorded as a defect). Moving them onto this engine, with a migration that
continues their existing series, is Business Master Prompt 1 work; the engine does not renumber any
existing record.

### Implementation evidence — F5 (2026-09-27)

Tests: `apps/api/src/modules/documents/documents.int-test.ts` (17, real MongoDB and a real disk) and
`packages/security/src/files.test.ts` (17).

| ID | Evidence |
|---|---|
| CORE-DOC-002 | Drafts in Arabic **and** English (one language refused); publishing refuses a placeholder the kind does not support (a typo, or another kind's) and placeholders that differ between the languages; a published version cannot be edited — by the service (`TEMPLATE_NOT_DRAFT`) or directly through the model, whose hook refuses any update touching a published row's content; a key keeps one kind; selection returns the most specific version in force (project over general, never a future one); previews use obviously synthetic values (amounts in `XXX`) and never a record; no wording ships (`SD-10`) |
| CORE-DOC-004 | Each upload is a new version and the earlier ones are kept; a stale uploader and the loser of two simultaneous uploads get `409` and store nothing; versions and documents cannot be deleted through the models; archiving withdraws a document from lists and keeps its file |
| CORE-DOC-006 | A download or print link is issued only to an actor who can see the document, and **issuing it records who obtained which version, for download or print, with its scan status** before the link is returned; an out-of-scope request is `404` and records no download; the link is a short-lived signed token — tampered, forged, cross-process and expired tokens are refused |

**Advanced but not complete:** `SEC-005` (the upload endpoint now exists and validates by magic bytes;
a real scanner is still not selected, so files are recorded `not_scanned` and an infected verdict is
refused and audited), `SEC-008` and `PLAT-017` (signed expiring access and a local development store
exist; the private object-storage adapter for staging and production does not). All three stay
`in-progress`. `CORE-DOC-003` (PDF generation with embedded Arabic fonts) and `CORE-DOC-005` (QR
verification) are **not started** — outside this package.

## Current status summary

| | Count |
|---|---|
| Phase 1 requirements registered | 113 |
| Status `implemented` (code and passing tests) | **79** — see per-row status in `docs/MEMORY.md` |
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

## Implementation evidence — audit and authorization core (2026-09-21)

Status `implemented`: code exists and its tests pass. **None of these is `verified`**; `verified` requires
the Phase 1 exit-gate review, which has not happened. Evidence is the test that would fail if the
behaviour regressed, not the file that contains the feature.

| ID | Status | Evidence |
|---|---|---|
| AUDIT-001 | implemented | `apps/api/src/modules/audit/audit.int-test.ts` — every mutating query operation, `bulkWrite`, and a document re-save are refused against real MongoDB; `authorization.int-test.ts` — no HTTP route updates or deletes an event. Limits stated in [ADR-0021](decisions/adr-0021-audit-trail-integrity.md) §2 |
| AUDIT-002 | implemented | `audit.int-test.ts` — actor, action, outcome, target, correlation ID, request context, provider reference, and a UTC `occurredAt` are stored and returned |
| AUDIT-003 | implemented | `apps/api/src/http/guards.test.ts` — a successful mutation recording no audit event returns `500` and logs `AUDIT_MISSING_FOR_MUTATION`; `authorization.int-test.ts` — real mutating routes pass the assertion |
| AUDIT-004 | implemented | `authorization.int-test.ts` — a list read and an export each record their own event before the response is sent; export requires a separate permission |
| AUDIT-005 | implemented | `authorization.int-test.ts` — role creation, grant change (with before/after summary), authorization denials, anonymous denials, and refused escalation attempts are all recorded. Authentication events: `recordAuthenticationEvent` exists and is tested, but no authentication flow calls it yet (`SEC-013`) |
| AUDIT-006 | implemented | `packages/security/src/audit/summary.test.ts` — 19 sensitive key names redacted, nested values covered, length and path count bounded, no whole request body stored |
| SEC-023 | implemented | `packages/contracts/src/authorization.ts` — granular verb catalog with administrative permissions listed explicitly; `authorization.test.ts` — an administrative permission is never implied by another |
| SEC-024 | implemented | `authorization.int-test.ts` — roles created and listed over HTTP, duplicate key rejected with `CONFLICT`, administrative roles flagged. Business role content still blocked on `SD-02`; nothing seeded |
| SEC-025 | implemented | `authorization.int-test.ts` — 401 without an actor, 403 without the permission, deny wins over a granting role, headers/cookies/bodies claiming roles are ignored |
| SEC-026 | implemented | `packages/contracts` scope model `self`…`all`; `authorization.test.ts` covers every level. Hierarchy **values** remain blocked on `SD-01` |
| SEC-027 | implemented | `authorization.test.ts` — an unsatisfiable scope becomes a filter matching nothing, never an open one; `audit.int-test.ts` — operator objects in a filter are rejected. No repository method accepts a filter without a scope |
| SEC-028 | implemented | `authorization.int-test.ts` — items, the total, and the export are all scoped; totals stay consistent across keyset pages |
| SEC-029 | implemented | `authorization.int-test.ts` — restricted fields absent from list, single read, and NDJSON export, and a grant's denial list absent for a view-only actor; `authorization.test.ts` — writes to unseen fields refused |
| SEC-030 | implemented | `authorization.int-test.ts` — an out-of-scope event and an absent event return identical `404` bodies; denials never name the permission or scope |
| SEC-031 | implemented | `authorization.int-test.ts` — self-grant refused, granting unheld permissions refused, widening scope refused, role minting with unheld permissions refused, `security.grant.assignAny` allows it, and every refusal is audited |
| SEC-032 | implemented | `authorization.int-test.ts` — a grant written over HTTP changes the next request's outcome in both directions, with no cache to invalidate ([ADR-0022](decisions/adr-0022-authorization-resolved-per-request.md)) |

**Not covered by this group:** `SEC-010`–`SEC-022` (accounts, passwords, sessions, devices, MFA,
activation, offboarding) and `SEC-033` (KMS adapter). The production actor resolver returns no actor, so
protected endpoints answer `401` until `SEC-013` lands. The integration suites inject a test resolver;
it is a fixture for exercising authorization and is **not** an authentication implementation.

## Implementation evidence — approval engine (2026-09-21)

Status `implemented`: code exists and its tests pass. **None of these is `verified`**; `verified` requires
the Phase 1 exit-gate review. The engine is mechanism only — no role, threshold, approver, or operation
type is seeded, because that content is `SD-02` ([ADR-0024](decisions/adr-0024-approval-engine.md)).

| ID | Registry wording | Status | Evidence |
|---|---|---|---|
| APPROVAL-001 | Approval request entity and state machine | implemented | `rules.test.ts` — the transition matrix, including every refusal out of a terminal state; `approval.int-test.ts` — submission opens stage 1, approval completes only when every stage is satisfied, rejection and cancellation end it, an illegal transition answers `409` and is recorded, and expiry runs idempotently |
| APPROVAL-002 | Rules configurable by amount, percentage, role, project, department, risk, exception | implemented | `rules.test.ts` — all seven axes accepted, decimal-safe amount comparison, mismatched currencies not comparable, and every ambiguous configuration refused with a code; `approval.int-test.ts` — draft, edit, publish, version selection by specificity, and a permission-based stage resolved to accounts within scope |
| APPROVAL-003 | Maker-checker: self-approval rejected unless an explicit audited policy permits it | implemented | `rules.test.ts` — refusal by default, permitted only with a reason, a delegate acting for the requester still caught, one person refused across two stages; `approval.int-test.ts` — refused over HTTP with nothing stored, permitted case marked `selfApproved` in the response and in the audit record, and **not** bypassed by an administrative permission |
| APPROVAL-004 | Delegation, time-bounded and audited | implemented | `rules.test.ts` — window, revocation, self-delegation, over-long window, and cycle detection; `approval.int-test.ts` — a delegate acts and both hands are recorded, revocation takes effect immediately, a future window does not work, a delegation applies only to the policies it names, and it never widens what the delegate may otherwise do |
| APPROVAL-005 | Escalation of an overdue task **or approval** to the direct manager | **implemented** (2026-09-27, F2) | `approval.int-test.ts` — the manager is added to the pending approvers once a stage is overdue, idempotently, audited, and the sweep needs its permission; an overdue stage with no resolvable manager is reported *unresolved*. `organization/foundation.int-test.ts` — the same sweep, wired to the real `CORE-ORG` reporting line, escalates to the requester's effective manager. The task half is `CORE-TASK-003` |
| APPROVAL-006 | Immutable approval history | implemented | `approval.int-test.ts` — a published policy version cannot be edited through the API or the model, a request keeps the version it was submitted under even after a newer one is published, and decisions survive a return, a resubmission, and a reassignment |
| APPROVAL-007 | Reassign an offboarded user's pending approvals to an authorized approver, audited | implemented | `approval.int-test.ts` — one request and a whole account's pending approvals moved, each audited; decisions already recorded are untouched; the old approver can no longer act and the new one can; refused without the administrative permission |

**Concurrency and idempotency:** two simultaneous approvals of the same stage, and two by the same
approver, each yield exactly one accepted decision; a decision against a stale version is refused; a
replayed submission returns the original request and a conflicting replay is a `409`.

**Not part of this group:** `CORE-NOTIFY` and `CORE-TASK` remain unimplemented. The engine publishes a
domain event after the transaction commits through a port with no implementation wired, and a failure to
publish is logged and swallowed — an approval is correct with nothing listening.

## Implementation evidence — identity and authentication (2026-09-21)

Status `implemented`: code exists and its tests pass. **None of these is `verified`**; `verified` requires
the Phase 1 exit-gate review. Evidence is the test that would fail if the behaviour regressed.

`SEC-010` is listed here rather than with the identity rows because the registry defines it as the
privilege-escalation **test suite** — a cross-cutting requirement, not an identity feature.

| ID | Status | Evidence |
|---|---|---|
| SEC-010 | implemented | `apps/api/src/modules/identity/privilege-escalation.int-test.ts` — 15 attacks on the identity surface: every administrative route refused to a plain account; an account that may create accounts still cannot grant authority; self-targeted MFA and password resets refused and recorded; a session that predates the account becoming privileged loses its authority; a challenge token refused as an access token and as another account's enrolment; a reset token bound to one account; a replayed activation refused; suspended and offboarded accounts unable to act; an access token refused as a refresh cookie; claimed identity headers ignored. Authorization-core escalation is `SEC-031` in `security/authorization.int-test.ts` |
| SEC-011 | implemented | `identity.int-test.ts` — an invited account with no credential in the response; employee business data refused by the strict schema; state, version, and credential generation refused from a body; the employee reference kept through offboarding |
| SEC-012 | implemented | `identity.int-test.ts` — activation sets the first password and the token is single-use and expiring; a policy-violating password leaves the account invited; an unactivated account cannot sign in and is indistinguishable from an unknown one |
| SEC-013 | implemented | `identity.int-test.ts` + `packages/security/src/credentials/credentials.test.ts` — Argon2id with the configured parameters, transparent rehash, a wrong password answered exactly as an unknown identifier with comparable work, logout ending the session immediately |
| SEC-014 | implemented | `identity.int-test.ts` — access token in the body and refresh token only as an `HttpOnly` `SameSite=Strict` path-scoped cookie; rotation on refresh; idle and absolute timeouts end the session whatever the token says; `Secure` outside development |
| SEC-015 | implemented | `identity.int-test.ts` — a replayed refresh token revokes the whole family, including the legitimate holder's newest session, and records `security.session.reuseDetected` |
| SEC-016 | implemented | `identity.int-test.ts` — change with re-authentication (wrong current password answers `REAUTHENTICATION_REQUIRED`), identical answers for known and unknown identifiers, an administrative reset token that is single-use and expiring, and every session revoked on completion. **Delivery** of the self-service token is `CORE-NOTIFY` and is not part of this group |
| SEC-017 | implemented | `identity.int-test.ts` — enrolment inactive until confirmed; a replayed TOTP code refused; a recovery code usable once; the secret stored as ciphertext and absent from audit and logs; a privileged account forced to enrol before signing in; disabling requires the password; the administrative reset needs its own permission. Mechanism only — the concrete privileged **role list** is `SD-02` |
| SEC-018 | implemented | `identity.int-test.ts` — own sessions listed with the current one marked and no token or raw user agent; single and bulk revocation; another account's session reported as absent (`SEC-030`); administrative listing and revocation behind their own permissions |
| SEC-019 | implemented | `identity.int-test.ts` — suspension ends sessions at once and login fails generically; the row survives with its reason (ADR-0009); reactivation works; an impossible transition is a conflict |
| SEC-020 | implemented | `identity.int-test.ts` — suspension invalidates a live access token mid-session; a password change ends every session including the one that made it; a permission change applies to the very next request |
| SEC-021 | implemented | `identity.int-test.ts` — one `security.account.offboarded` event terminates the account, ends every session, and invalidates outstanding activation and reset tokens; the employee reference is retained and nothing is deleted; the handover acknowledgement is required; a terminated account cannot be revived |
| SEC-022 | implemented | `identity.int-test.ts` — case- and whitespace-insensitive identifier uniqueness; one live account per employee with a replacement allowed after termination; the personal-account attestation required and audited |

**Related registry rows this group completes or advances:**

| ID | Change | Evidence |
|---|---|---|
| SEC-002 | `in-progress` → **implemented**. Cookie authentication now exists, and so does its protection: the only cookie is `SameSite=Strict`, `HttpOnly`, and scoped to `/api/v1/auth`, so a browser never sends it cross-site, and the origin guard rejects a cookie-bearing state change from an unlisted origin. A double-submit token would add nothing while both hold; if a cookie ever needs `SameSite=Lax`, one becomes necessary and this row reopens | `apps/api/src/app.test.ts` (origin guard) and `identity.int-test.ts` (cookie attributes, `Secure` outside development) |
| SEC-003 | stays `in-progress`. Now covers authentication per address and per identifier with TTL-bounded counters and `Retry-After`; export and provider-triggering endpoints do not exist yet | `identity.int-test.ts` — lockout, recovery, TTL, and second-factor throttling |
| AUDIT-005 | its **authentication** half is now live: login success and failure, logout, session creation, rotation and revocation, password change and reset, lockout, and every MFA event are recorded | `identity.int-test.ts` — lifecycle coverage and redaction |

**Not covered:** `SEC-033` (KMS) is **not implemented**. Development and test encrypt MFA secrets with a
configured local key; staging and production refuse that key and cannot store an MFA secret until the KMS
adapter exists ([ADR-0023](decisions/adr-0023-password-hashing-and-session-tokens.md) §6).

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
| CORE-DOC-001 | Numbering sequences by entity, document type, project, and fiscal year; atomic generation; **no reuse** | ADR-0009 | **implemented** 2026-09-27 (F4). Engine only; official formats arrive with `SD-10` (Phase 4) |
| CORE-DOC-002 | Template registry with bilingual templates | ADR-0003 | **implemented** 2026-09-27 (F5). Registry only; templates arrive with `SD-10` |
| CORE-DOC-003 | PDF generation with **embedded Arabic-capable fonts**; glyph rendering asserted by test | ADR-0003 | A "file produced" assertion does not catch this |
| CORE-DOC-004 | Document version retention | ADR-0009 | **implemented** 2026-09-27 (F5) |
| CORE-DOC-005 | QR verification | MM §8 | |
| CORE-DOC-006 | Audit of **who printed or downloaded** each document | **G-03** | **implemented** 2026-09-27 (F5). Arabic scope p17 |

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
