# ALOLA ERP — Project Memory

Last updated: 2026-10-02 (Business Master Prompt 1 — Commercial Operations — package 8 complete, BMP-1 closed, stopped for review)
Blueprint documents: `MASTER-MAPPING.md` v2.0, `PHASE-PROMPTS.md` v2.0
Repository: Git · Branch: `main` · Remote `origin` (GitHub) added by the repository owner, who pushed
`9cc3189` on 2026-09-24. **This workstream never pushes, never adds a remote, and nothing is deployed.**

Commits: `7a840b3` documentation baseline → `4c988db` Phase 1 scaffolding → `4365775` Phase 1 review
decisions → `dfc0ac5` development services + integration gate → `3d6bdf1` audit and authorization core →
`45f73ca` MEMORY repair → `2edc45e` identity and authentication → `52cabbd` approval engine →
**Macro Phase 1** — `b61b4df` delivery rebaseline (ADR-0025, ADR-0026) → `f16f8a0` `CORE-ORG` minimum →
`5b2d89d` inventory → `a2d3ec6` CRM → `4f42474` reservations, contracts, schedules → `a514fb1`
collections → `56857f3` marketing → `4806fef` web application → `98f1003` demonstration seed →
`5cf39b8` end-to-end suite → `9cc3189` documentation → **Foundation completion** — `24fe608` F0 →
`1270ac7` F1 → `748a8b6` F2 → `d64ec0c` F3 → `85cf2ca` F4 → `92d3110` F5 → `8ee6271` F6 → `505b1e5` F7 →
`e79b456` F8 → `fe2127c` F9 → `17b6fef` F10 → `09dfb36` F11 → `ee3f7c4` F12 → `e8dacea` build-stable
migration checksums → planning and foundation gate → UI redesign and polish → **BMP-1** `6faac98` P1 →
`9a8eb7b` P2 → `d79330c` P3 → `f6dcdc4` P4 → `b09f1be` P5 → `472d83e` (owner) + `5288be0` P6 →
`444a485` web test stability → `58bb19e` PDF engine → `740ab7b` issuance → `5cf495b` QR verification →
`0baf10f` P7 UI, tests and docs → `b608ac9` (owner commit of P8 group 1: quotations, customer
workspace, conversion, opportunities) → `740cc5f` contract activation workflow → `3aed2d0` numbering
and sales settings → `4582537` unit timeline, demo permissions, Mongoose → P8 tests and documentation
(the commit containing this file). Local only; the owner pushes.

## Project identity

- Product: ALOLA Real Estate CRM & ERP
- Architecture: TypeScript MERN modular monolith (npm workspaces)
- Frontend: React 19, Vite 8, Material UI 9 · Backend: Node.js 24, Express 5 · Database: MongoDB (Mongoose 9)
- Jobs: BullMQ 6 + Redis (ioredis 6) · Files: private AWS S3 · Encryption: AWS KMS (adapters not yet built)
- Default language: Arabic. Supported: Arabic (RTL) and English (LTR)
- Theme: **Light Mode only**
- Fonts: Alexandria (Arabic), Inter (English), self-hosted via Fontsource

## Delivery plan — rebaselined 2026-09-22

Approved: [ADR-0025](decisions/adr-0025-macro-delivery-phases.md) (four macro phases) and
[ADR-0026](decisions/adr-0026-demonstration-mode-boundary.md) (what is simulated, and how it is labelled).

| Macro phase | Name | Covers engineering scope | State |
|---|---|---|---|
| **Macro Phase 1** | Client Demo MVP | A vertical demonstration slice crossing Phases 2–5, plus remaining shell work in Phase 1 | **complete — stopped for review** |
| Macro Phase 2 | Complete Real Estate Sales and Finance | Phases 2, 4, 5, 6 in full | not started |
| Macro Phase 3 | Operations, Procurement and Human Resources | Phases 7 and 8 in full | not started |
| Macro Phase 4 | Marketing Integrations, Production Hardening and Launch | Phase 3 provider work and Phase 9 in full | not started |

**The macro phases group work; they do not re-register it.** `docs/REQUIREMENTS.md` is unchanged: no ID
renamed, renumbered, merged, or retired, and no status raised. The nine engineering phases and
`docs/phases/phase-gates.md` keep their meaning, and **Phase 1's gate is still open**.

Macro Phase 1 produces a **demonstration slice** in modules registered to Phases 2–5. The slice is real
code — persisted, permission- and scope-enforced inside the query, transactional, audited — and it is
still not the module. Demo-slice scope is recorded in its own section below and **never** as an
implemented or verified requirement.

## Current phase

- Phase: **1 — Discovery, architecture, core, security, localization, Light Mode** (gate open)
- Active delivery: **Business Master Prompt 1 — Commercial Operations** (engineering Phases 2–4 scope,
  plus `CORE-DOC-003`/`005`), started 2026-09-29 on explicit instruction, **packages 1–8 complete on
  2026-10-02 and stopped for review**. BMP-2 is **not started** and must not start without explicit
  authorization — see the BMP-1 section below
- Sub-stage: Build half — foundation, audit, authorization, identity, and approvals complete; green
- Macro Phase 1 (Client Demo MVP) is **built and green**, and is a demonstration slice: it raises no
  requirement status and closes no gate. See "Macro Phase 1 — the demonstration slice" below.
- `D2`: **COMPLETE 2026-09-21.** Local Docker MongoDB (single-node replica set `rs0`) + Redis
  ([ADR-0020](decisions/adr-0020-local-docker-development-services.md)). Integration tier: **59 passed,
  0 failed, 0 skipped** (191 tests).
- Gate status: **PHASE 1 NOT APPROVED — SCOPE INCOMPLETE.** Every mandatory verification check passes, but
  every Phase 1 requirement is now started: **106 of 113** implemented, 7 in progress (`PLAT-007`,
  `PLAT-017`, `SEC-003`, `SEC-005`, `SEC-006`, `SEC-008`, `SEC-033`), and the gate also requires a
  stakeholder demonstration and written approval (phase-gates §1).
- Requirements `verified`: **0** — no requirement is marked `verified` before the stakeholder gate
- Requirements `implemented` (code + passing tests): **106 of 113** · `in-progress`: 7 · not started: 0 (`CORE-DOC-003`, `CORE-DOC-005` implemented in BMP-1 package 7, 2026-09-29)

## Business Master Prompt 1 — Commercial Operations — IN PROGRESS (started 2026-09-29)

Instruction of 2026-09-29: the stakeholder approved the foundation, the UI/UX redesign and the final UI
polish **for continuation into development only** — not production, not deployment, not acceptance of
any open business decision — and issued BMP-1 as the first of **three** prompts
([ADR-0032](decisions/adr-0032-three-business-master-prompts.md)). Starting HEAD `6089c33`, tree clean,
services healthy, migrations current (`0001` only).

Scope: Lead → Qualification → Opportunity → Customer → Unit Selection → Reservation → Approval →
Contract → Instalment Schedule Handoff, and the commercial documents and approvals it needs. 59 IDs
enumerated in `REQUIREMENTS.md` §"Business Master Prompt 1 — enumerated requirements" (55 BMP-1,
4 BMP-2), plus `CORE-DOC-003` and `CORE-DOC-005`. Blocked: `CRM-ASSIGN-002`, `CRM-OWNER-002` (`SD-04`).

Demonstration data snapshot before any change: `scratch/bmp1-demo-before.json` (counts and content
hashes of every collection, ignored). Nothing may reset or reseed; new scenarios only through
idempotent seed extensions.

| Package | State | Commit |
|---|---|---|
| 1 Scope consolidation, ADR-0032, discovery IDs, decisions, Arabic questionnaire | **complete** | `6faac98` |
| 2 CRM and customer completion | **complete** | `9a8eb7b` |
| 3 Opportunities and ownership | **complete** | `d79330c` |
| 4 Inventory and pricing | **complete** | `f6dcdc4` |
| 5 Reservations and approvals | **complete** | `b09f1be` |
| 6 Contracts, schedules and quotations | **complete** | `472d83e` (code, by the owner) + `5288be0` |
| 7 Arabic/English PDF documents and QR verification | **complete** | `444a485`, `58bb19e`, `740ab7b`, `5cf495b`, `0baf10f` |
| 8 Sales completion, activation, quotations, customer workspace, numbering, closure | **complete — stopped for review** | `b608ac9` (owner), `740cc5f`, `3aed2d0`, `4582537`, and the commit containing this row |
| 9 Final verification and phase documentation | **folded into package 8** (its final verification and documentation) | — |

### Package 1 — what changed

- [ADR-0032](decisions/adr-0032-three-business-master-prompts.md): five prompts → three (BMP-1
  Commercial Operations; BMP-2 Collections, Finance, Operations and People; BMP-3 Marketing,
  Integrations, Hardening and Launch). ADR-0029's sequence superseded, its rules kept. The
  module-by-module traceability table is in `phases/business-master-prompts.md`.
- Registered `SEC-034` (resource-level scope policy for ownerless catalogue records) and the BMP-1 IDs
  in `INV-*`, `CRM-*`, `SALE-*`, `COL-SCHEDULE-*`; all `approved` except the two `SD-04` rows.
- Business decision register: BD-25–BD-36 added (assignment, duplicates, opportunity stages,
  ownership, unit hold, competing requests, price overrides, schedule rules, required documents,
  identity, activation and signing, quotation validity). Five are `proposed`, seven `open`; none
  approved. Arabic client questionnaire: `decisions/bmp-1-decision-questionnaire-ar.md`.
- **Defects found during discovery, to be fixed in their packages:** the stored payment plan drops
  `downPaymentDueOn`, so a contract built from a reservation dates the deposit on the first instalment
  date (package 6); the manual unit-status route lets `inventory.unit.manage` move a `reserved` or
  `contracted` unit to `available` while its reservation or contract is live (package 4); reservation
  `holdDays` defaults to an invented 14 days although validity is BD-01 (package 5); lead creation,
  its first activity and its audit record are three separate writes (package 2).

### Package 2 — CRM and customers

- Contracts `packages/contracts/src/crm.ts`: customer `kind`, `alternateName`, `identity` (type,
  number, country), `city`, preferred language and channel, `consents`, team/department, `version`;
  correction, consent, transfer, duplicate-check and paged customer query schemas; lead
  `currentSource`, `qualification`, `lostReasonCode`, `nurture`, `convertedAt`, `lastActivityAt`;
  activities may belong to a lead, a customer or an opportunity; dashboard `openByAge` and
  `untouchedOpenLeads`. New permissions `crm.customer.viewIdentity`, `crm.customer.transfer`,
  `crm.lead.convert`, `crm.lead.import`; new field restriction `customer.identity`.
- Module `apps/api/src/modules/crm/`: new append-only collections `crmConsents`,
  `crmOwnershipChanges`; `importer.ts` (leads importer on CORE-IMPORT). Every new stored field is
  optional, so demonstration records read unchanged (no kind → individual, no version → 1, legacy
  `nationalId` → identity). **No migration was needed and none ran.**
- Service rules worth keeping: lead create/stage/qualify/assign/convert/activity each run in one
  transaction with their audit; an owner is refused unless active, holding the read permission, placed,
  in the actor's scope and in the record's branch (`ASSIGNEE_*` issue codes, audited as
  `crm.owner.assignmentRefused`); duplicate checks describe in-scope matches and only count the rest;
  conversion refuses to link an out-of-scope customer (`CUSTOMER_OUTSIDE_SCOPE`).
- Composition root: `describeAccount` (identity state + effective permissions + CORE-ORG placement)
  wired into CRM; `isActiveReason` wired to settings `activeCodes`; `hasConsent` wired from
  notifications to CRM; `OrganizationService.findBranchByCode` added for the importer.
- Web: `useErrorMessage` now prefers `errors:issue.<CODE>` when the API names an issue; `errors.json`
  gained an `issue` object. `scripts/i18n-merge.mjs` merges keys into both locales at once and refuses
  one-sided keys; `scripts/set-requirement-status.mjs` sets enumerated requirement statuses.
- Measured: typecheck (all workspaces), lint (changed areas), i18n, **unit 610 passed** (46 files),
  CRM + imports integration **70 passed**; full integration gate **534 passed / 0 failed / 0 skipped**, 27 files (501 before).
- Not yet done here, by design: screens (package 8), opportunities (package 3), seed extension for the
  new permissions (the demonstration roles do not yet hold `crm.lead.convert` etc.).

### Package 3 — opportunities

- `crmOpportunities` (`crm/model.ts`) and `OpportunityService` (`crm/opportunities.ts`, published in
  the module index, wired as `services.opportunities`, routed under `/api/v1/crm/opportunities`).
  Stages `discovery → unitSelection → proposal → negotiation → reservation → won | lost`;
  `reservation` and `won` only through `advanceInternal` (the port sales will call in packages 5–6).
- Permissions `crm.opportunity.view`, `.manage`, `.assign`. Setting
  `sales.opportunityStageProbabilities` (`BD-27`, default `null`); reference list `opportunityStages`
  (bound and locked, relabel only). The settings catalog test now accepts `BD-nn` as a decision name.
- `CrmService.convertLead` takes an optional `openOpportunity` callback, so conversion can open an
  opportunity in its transaction without CRM's customer code knowing about opportunities; eligibility
  helpers (`assertEligibleOwner`, `ownPlacement`, `placementUpdate`) are now shared inside the module.
- Weighted pipeline: Σ expected value × rate ÷ 100 in decimal arithmetic, rounded to 2 places at the
  end and written with exactly two decimals (the money helpers otherwise drop trailing zeros).
- Measured: unit **610 passed**; CRM integration **64 passed**; full integration gate **543 passed / 0 failed / 0 skipped**, 27 files.

### Package 4 — inventory and pricing

- **SEC-034 catalogue scope** (`packages/security/src/authorization/scope.ts`,
  `buildCatalogueScopeFilter`): every inventory read (projects, buildings, units, matrix, comparison,
  holds) now uses it. This retires the Macro Phase 1 debt "a scope level applies to an account, not to a
  resource" — a representative can be `assigned` for leads and still read their branch's units. The
  demonstration roles are still branch-scoped; moving them is the seed extension's decision.
- **Discovery defect fixed:** the manual unit-status route now allows only `available ↔ unavailable`
  (`STATUS_SET_BY_WORKFLOW` otherwise, audited).
- Module `apps/api/src/modules/inventory/`: `pricing.ts` (`PriceService`), `holds.ts`
  (`HoldService`), `templates.ts` (`PlanTemplateService`), `approval-port.ts`; new collections
  `inventoryPriceVersions`, `inventoryHolds`, `inventoryPlanTemplates`; unit attributes, project and
  building versions (absent → 1), `heldByHoldId`; `applyStatusChange` can require the holder
  (`expectHoldId`/`expectReservationId`) so a workflow only frees what it took.
- Contracts: `planFromTemplate` (half-up percentages, down payment on the contract date),
  `UNIT_EVENT_KINDS`, `MANUAL_UNIT_TRANSITIONS`; document owner type `building`.
- Permissions `inventory.price.propose`, `inventory.hold.create`, `inventory.hold.manage`,
  `inventory.plan.manage`. Setting `sales.unitHoldHours` (`BD-29`, default `null` → no hold can be
  taken). Approval operations `inventory.unit.priceChange`, `inventory.hold.extension`.
- Composition root: one shared `approvalPort` (sales now uses it too); `settleApprovalOutcome`
  applies a decided price or extension request when the engine publishes the decision, as
  `system:maintenance`; new maintenance sweep `inventory.sweep` (every 300 s: due prices, expired
  holds, decided approvals) — the safety net when an outcome is missed.
- Known display defect for package 8: the unit page timeline shows price and attribute events as
  "available" because it reads only statuses; `unitEventKind` labels now exist for the fix.
- Measured: unit **628 passed** (the two web timeouts seen once under load pass standalone), inventory
  integration **45 passed**, OpenAPI **209 paths / 0 broken references**; full integration gate
  **567 passed / 0 failed / 0 skipped**, 27 files.

### Package 5 — reservations and approvals

- Reservation states gain `approved` and `rejected`; `LIVE_RESERVATION_STATES`; a new partial unique
  index `salesReservations_liveUnit_v2_unique` (the old one stays declared, strictly narrower).
- Rules in `apps/api/src/modules/sales/reservation-rules.ts` (pure, unit-tested): minimum deposit
  (percentage rounded **up**), exact percentage comparison, exceptions, required approvals, combined
  outcome. `SALES_APPROVAL_OPERATIONS` in contracts names all eight sales operations (package 6
  uses the contract ones).
- `SalesService` ports: `HoldPort` (convert a hold inside the reservation transaction),
  `OpportunityPort` (advance to `reservation`; the contract still advances to `won` until package
  6), `ReservationPolicies` (settings), `NumberPort` (CORE-DOC-001, `undefined` = no active
  format → legacy series), `ApprovalPort.applies` (new `ApprovalService.hasApplicablePolicy`).
- Settings `sales.reservationValidityDays` (decision relabelled **BD-01**, was SD-03 — BD-01 cites
  SD-03), `sales.reservationMinimumDeposit` (BD-02), `sales.maximumDiscountPercent` (BD-03), all
  default `null`. **Discovery defects fixed:** no invented 14-day validity (refused while not
  configured); `downPaymentDueOn` stored and carried into the contract.
- `POST /sales/reservations/{id}/extend` (`sales.reservation.extend`); cancellation and extension
  go through approval where a policy applies; a cancellation that took money records
  `refundHandoff: pending` for BMP-2. Maintenance sweep `sales.sweep` (300 s: expiry and
  decided approvals); `settleApprovalOutcome` includes sales.
- **Seed:** a fresh `seed:demo` now sets `sales.reservationValidityDays = 14` as the system actor,
  reason "demonstration value — BD-01 open", only when not configured, and no longer passes
  `holdDays`. **The existing development database was not reseeded and has no validity
  configured**, so creating a reservation there answers `RESERVATION_VALIDITY_NOT_CONFIGURED`
  until the package 8 seed extension (or an administrator) sets it. Demo roles still lack the new
  permissions.
- Measured: typecheck, full lint, format, i18n, secrets (499 files), ignored-source, **unit 636
  passed / 49 files**, OpenAPI **210 paths / 0 broken references**, full integration gate **582
  passed / 0 failed / 0 skipped**, 27 files. Lint needs `NODE_OPTIONS=--max-old-space-size=8192`
  now — the default heap ran out once.

### Package 6 — contracts, schedules and quotations

- **Contracts are drafted, then activated** (`SalesService.createContract` / `activateContract`).
  A draft carries immutable `customerSnapshot`, `unitSnapshot`, `pricing`, parties and a
  computed `draftSchedule`; nothing is committed and the reservation records `contractId` (so it
  can be neither cancelled nor expired underneath; `CONTRACT_IN_PROGRESS`). Activation freezes the
  instalments, converts the reservation, contracts the unit and wins the lead **and the opportunity**
  (CRM-OPP-002 now implemented). New state `pendingApproval` for a `planChanged` exception governed
  by `sales.contract.exception`. Pre-BMP-1 contracts read unchanged (no snapshots, sole buyer at
  100 %, unsigned) — no migration.
- **Every caller of createContract must now activate** to get a schedule: the seed
  (`scripts/seed-demo/business.ts`), `collections.int-test.ts` and `sales.int-test.ts`
  (`contractFor` helper) do. The web "create contract" button on the reservation page still only
  drafts — **package 8 must add the activate step to the screen**, otherwise a user sees a draft with
  no schedule.
- Pure rules in `sales/contract-rules.ts`: `partyIssues`, `samePlan` (terms, not text),
  `amendmentRows`. Contracts: plan `milestones` and `maintenanceDeposit` (added to the price;
  contract total = price + deposit), `scheduleTotal`, `SCHEDULE_ROUNDING_RULE` on every preview,
  installment kinds `milestone`/`maintenanceDeposit`, rows sorted by date (stable).
- Signing (once; signed copy must be a contract-owned document; warning only, `BD-35`),
  amendments (policy **required**; replaced unpaid rows → `rescheduled`; stale if paid meanwhile),
  cancellation (draft withdrawn; active refused beyond the reservation's own money; approval where
  governed), history (`AuditService.targetHistory`, summary only).
- `QuotationService` (`sales/quotations.ts`, `salesQuotations`, routes `/sales/quotations`):
  revisions, withdraw, computed expiry, no inventory call at all. Legacy prefix `QUO`; numbering
  type `quotation` added to `SEQUENCE_TYPES`.
- **Boundary kept:** CRM never hands identity to another module unscoped, so the buyer identity is
  snapshotted through `CrmService.customerForSnapshot` (scoped, restricted) — recorded only when
  the drafter may see it; otherwise the contract warns `identityMissing`.
- Test-fixture finding: since package 2 a customer's owner other than the creator needs
  `crm.customer.transfer`; the sales fixture now creates customers as their owner.
- Measured: typecheck, full lint (8 GB heap), format, i18n, OpenAPI **219 paths / 0 broken
  references**, **unit 648 passed** (two web tests timed out under load in the full run and pass
  standalone, 9/9), full integration gate **602 passed / 0 failed / 0 skipped**, 27 files.

### Package 7 — Arabic/English PDF documents and QR verification (2026-09-29/30)

**Superseded status line:** package 8 has since been completed — see "Package 8" below.

- **Timeout investigation first (`444a485`).** The two dashboard/chart web tests timed out because the
  first test of a file paid for compiling and importing lazily loaded chunks (recharts alone ~1 s idle)
  inside vitest's 5 s per-test limit. Fix: `routes.tsx` exposes `PAGE_MODULES`/`preloadPages`,
  `charts` exposes `preloadCharts`, and `src/testing/warm-up.ts` warms them in `beforeAll` under
  its own 60 s budget; `FIRST_RENDER` is 4 s, below the per-test limit, so a slow lookup names what it
  was looking for. No global timeout raised, no concurrency reduced, no assertion weakened. Idle
  first-test times: dashboard 2.3 → 0.97 s, tasks 2.6 → 1.3 s, branding 1.7 → 0.5 s. Full suite then
  passed 3 consecutive times (648/648), and once with `tsc` running alongside. **Honest limit:** under
  an artificial ~4× oversubscription (three suites plus `tsc` at once) 8–9 tests still fail — now with a
  message naming the missing element rather than "timed out".
- **PDF engine (`58bb19e`)** `apps/api/src/platform/pdf/`: pdfkit 0.20.2 with Alexandria and Inter
  embedded from `@fontsource` WOFF files; fontkit shapes Arabic; our own layout orders words with
  `bidi-js` 1.1.0 (UAX #9, isolates). Values inside sentences must go through `ltrIsolate()` —
  without it rule W2 detaches `%` and digit groups. Spaces are advances (the Arabic subset has no
  space glyph). Arabic ligature ToUnicode entries are reversed for extraction through pdfkit's private
  `_fontFamilies` (pdfkit pinned; a test guards it). QR by `qrcode-generator` 2.0.4, vector, level M.
  Dev-only: pdfjs-dist, @napi-rs/canvas, jsqr (extract, rasterize, decode in tests).
- **Issuance (`740ab7b`)** `apps/api/src/modules/issuance/` (`issuedDocuments`): six types
  (quotation, reservation, contract summary, instalment schedule, receipt, customer statement), versions
  per (type, source, language), supersession in the same transaction, revocation
  (`document.revoke`, administrative), `restrictionKey`, 256-bit token, fingerprint = first 16 hex of
  the content SHA-256. Files stored as versions of ordinary documents; the documents module gained
  `requiredPermissions` (restricted-content files invisible without them) and owner type
  `quotation`. Permissions `document.generate`, `document.revoke`. Env `PUBLIC_APP_URL` (optional;
  falls back to the first CORS origin) and `VERIFY_RATE_LIMIT_PER_MINUTE` (20). Statements numbered
  through the legacy `STM` series. Public `GET /api/v1/public/verify/{token}`, own limiter
  `rl-verify`, `no-store`, `noindex`, audited anonymously without address or user agent.
- **Verification page (`5cf495b`)** `/verify/:token` rendered outside `SessionProvider` (plain
  `fetch`, `credentials: 'omit'`), Arabic/English; ADR-0033 (trust model); enumerations
  `issuedDocumentType`, `issuedState`, `issueWarning`, `verificationResult` registered. **Defect
  found there:** `bidi-js` ships its own types; the local `bidi-js.d.ts` contradicted them, so the root
  typecheck project failed at `740ab7b` (the workspace typecheck passed). Declaration removed.
- **UI, tests, docs (this commit):** `IssuedDocumentsPanel` on contract (summary + schedule, and the
  customer statement), reservation and receipt pages — list versions, issue with language choice and the
  server's warnings shown first, download (audited link, same-page attachment), verification link,
  revoke with reason; every control permission-aware. Icon `FileText` added.
- **Defect found by visual QA and fixed:** a contract drafted before package 6 has no snapshots, so its
  summary and schedule printed "—" for buyer, unit and project. The loader now supplies current display
  names only when a snapshot is missing, and the file says so; contract layouts raised to version 2.
- **Seed extension `npm run seed:demo:documents`** (`scripts/seed-demo/documents-cli.ts`), run on the
  development database 2026-09-29: **adds** document permissions to the demo roles (executive and
  accountant read; managers, representatives and the collection officer issue; the administrator reads
  every source and may revoke), audited as `security.role.permissionsAdded`; then issues one sample per
  type as the seeded account who would issue it, ledgered by type/source/language/layout (the two
  contract samples were re-issued once as v2 after the layout fix, superseding v1). Second run: all
  `unchanged`. Nothing reseeded, no password reset.
- **Demo-data integrity** (`scratch/p7-demo-before.json` → `p7-demo-after.json`): changed only
  `auditEvents`, sessions/refresh tokens, `accountTokens` (16 → 8, TTL purge), `securityAccounts`
  (last sign-in), `roles` (permissions added), `demoSeedLedger` (+14), `salesCounters` (the `STM`
  series), and new `documents` (5), `documentVersions` (7), `issuedDocuments` (7). No lead,
  customer, unit, reservation, contract, instalment or receipt changed. The E2E suite stays read-only on
  business data.
- **Measured (`scratch/p7-verify.sh`, logs `scratch/p7-final/`):** format, lint (0/0), strict
  typecheck, i18n, secrets, links, ignored-source, 0 vulnerabilities ✅ · **unit 679 passed / 54 files** ·
  **integration gate 613 passed / 0 failed / 0 skipped**, 28 files · build ✅ · bundle ✅ (largest
  `vendor-mui` 409.3 / 122.2 kB gzip; `VerifyPage` its own 4.7 kB chunk) · migration status and
  source/built parity ✅ · client file ✅ · built-API smoke ✅ (ready 200, real tokens: `valid` with the
  printed fingerprint, `superseded`, bare `invalid` for unknown and malformed, no extra fields,
  `no-store`, `noindex`, **224 OpenAPI paths**) · **E2E 64 passed / 0 failed / 0 skipped** (desktop +
  mobile; `documents.spec.ts` 12 of them).
- **Package 8 dependencies:** contract activation step on the reservation/contract screens (a drafted
  contract still has no schedule until activated); quotation screens (quotation PDFs exist in the API
  only); the full demo-role seed extension for BMP-1 permissions (`crm.lead.convert`,
  `sales.contract.activate`, …); official number-series continuation (`SALE-RESERVE-006` stays
  in-progress; statements use the legacy `STM` series); `sales.reservationValidityDays` not configured
  in the development database; the unit timeline shows price/attribute events as statuses; a customer
  detail page (statements are issued from the contract page meanwhile); amendment, cancellation-form and
  approval-record PDFs were not built as separate types.
- **Debt recorded:** 30+ existing `findOneAndUpdate(..., { new: true })` calls trigger a Mongoose
  deprecation warning (none in package 7 code) — **resolved in package 8**; verification is database-backed, not a signature
  (`SEC-033`); production cannot issue until `PLAT-017`; `PUBLIC_APP_URL` must be fixed per
  deployment or printed codes break; sample QR codes point at `http://localhost:5173`.

### Package 8 — sales completion, activation, quotations, customer workspace, numbering, closure (2026-09-30 – 2026-10-02)

**BMP-1 is closed and stopped for review. Business Master Prompt 2 is not started.**

Starting HEAD `0baf10f`, tree clean, services healthy, migrations current (`0001` only), demo database
byte-identical to the package 7 closing snapshot (`scratch/p8-demo-before.json`). The owner committed and
pushed the group-1 work in progress as `b608ac9` mid-package; it was built on, never rewritten.

- **Contract workflow (`740cc5f`).** `PUT /sales/contracts/{id}/payment-plan` (drafts only; audited
  `sales.contract.planChanged`; `planChanged` set/cleared against the reservation's plan; the total
  follows the maintenance deposit — `totalPrice` is `immutable` in the model, so the one draft-only update
  passes `overwriteImmutable`, otherwise Mongoose silently drops the path). `GET …/activation-review`
  (exceptions, `approvalRequired`, blockers, rows to freeze; writes nothing). Activation takes an optional
  `idempotencyKey` (`activationKey` on the contract): a retry with the key answers 200 and records
  nothing; concurrent activations: one 200, one 409. `CONTRACT_HAS_COLLECTIONS` is now a named issue.
  Web: contract page is a draft workspace (snapshots, parties editor, plan editor with server preview,
  proposed schedule, warnings, approvals, history, signing, amendment, cancellation) with a reviewed
  activation dialog; the reservation page drafts after a confirmation and links an existing draft.
- **Quotations, customers, conversion (`b608ac9`).** Quotation register (server-computed state filter,
  anchored search), create (from customer/lead/opportunity/unit; preview before create), detail
  (revisions, revise, withdraw, PDF, "reserve on these terms"). Customer workspace `/customers/{id}`
  (each section its own scoped request, not requested without its permission; identity only when
  returned). Lead conversion panel; opportunities panel. `GET /sales/defaults` (authenticated; validity
  periods only). `CustomerQuery.ids` (≤100, scoped). Issue requests take an idempotency key (statement
  double-submit draws one number). `PublicBranding.baseCurrency` (forms no longer fall back to `'EGP'`).
  Shared web modules: `pages/plan.tsx`, `lookups.tsx`, `activity.tsx`, `convert.tsx`,
  `opportunities.tsx`; `useToday()` in `format.ts` (organization calendar, computed with `Intl` so the
  entry bundle does not import the contracts' runtime).
- **Numbering and settings (`3aed2d0`).** Sequence type `customerStatement`; statements and receipts take
  CORE-DOC-001 numbers when a format is active, legacy `STM`/`RCT` otherwise. **Legacy continuation:**
  activating a format of the legacy shape (`PREFIX-yyyy-00001`, yearly, 5 digits, no codes) seeds each
  year's counter after the last legacy number inside the activating transaction (audited); other shapes
  start their own series. Setting `sales.quotationValidityDays` (`BD-36`, not configured). Settings →
  Sales (`/settings/sales`). **No format is activated** (`BD-19` open). Runbook:
  [operations/numbering-runbook.md](operations/numbering-runbook.md).
- **Timeline, roles, Mongoose (`4582537`).** Unit timeline renders by kind (status transitions with cause;
  price and details changes by name; creation) — stored events untouched. `BMP1_ADDITIONS` in
  `scripts/seed-demo/roles.ts` (manager commits contracts and sees identities; representative raises
  only; settings and numbering administrative; executive read-only), pinned by `roles.test.ts`;
  **`npm run seed:demo:bmp1` applied to the development database on 2026-10-02** (roles added, audited;
  `sales.reservationValidityDays = 14` as the system actor, "BD-01 open"); second run all `unchanged`.
  All 31 `new: true` → `returnDocument: 'after'` (Mongoose's own conversion; behaviour identical);
  `tests/mongoose-options.test.ts` guards it; the integration log has no deprecation warning.
- **Defects found and fixed outside the brief:** (1) approval requests capped pending approvers at 50
  while a permission stage resolves 200 → submission and queues 500 once more than 50 eligible accounts
  hold the permission (`MAX_PENDING_APPROVERS`, regression test); (2) the issuance fixture leaked four
  grants per run (75 approvers had accumulated) and depended on running after the collections file —
  both fixed; (3) a flaky assertion (`'250'` matched inside a random fingerprint); (4) pre-package-6
  contracts showed their buyer as "outside your access" (parties carry no stored name) — names now come
  from the scoped lookup; shares printed `100.0000%`.
- **A JavaScript `String.replace` splice happened once more in this package** (a `$'` in a replacement
  string) and was caught by the diff size before anything ran; the file was restored from `HEAD`. Edit
  scripts now pass a **function** as the replacement.
- **Requirements:** `CRM-PERSON-004` and `SALE-RESERVE-006` → implemented (evidence in `REQUIREMENTS.md`
  §"package 8"). BMP-1: **47 implemented, 7 in progress, 2 blocked** (`CRM-ASSIGN-002`,
  `CRM-OWNER-002`, `SD-04`). In progress, screens only (APIs tested): `INV-PROJECT-003`,
  `INV-SEARCH-002`, `INV-SEARCH-003`, `CRM-MATCH-001`, `CRM-LEAD-006`, `CRM-ACTIVITY-001`,
  `CRM-REPORT-001`. Phase 1 unchanged: 106 of 113 implemented, 7 in progress, gate open.
- **Not built, by decision:** separate amendment, cancellation-form and approval-record PDFs (no approved
  wording; cancellation settlement is BMP-2; approvals live in the approval screens). Customers have no
  business code (needs `BD-19` and a backfill).
- **Measured (`scratch/p8/p8-verify.sh`, logs `scratch/p8/final/`):** format, lint (0/0), strict
  typecheck, i18n, secrets (552 files), links (439 in 66 files), ignored-source, 0 vulnerabilities ✅ ·
  **unit 707 passed / 61 files**, three consecutive full runs after the last change · **integration gate
  627 passed / 0 failed / 0 skipped, 29 files** · build ✅ · bundle ✅ (largest `vendor-mui` 409.3 / 122.2
  kB gzip; entry 189.9 / 59.2 kB — it carries both languages' translations, which grew ~42 kB in BMP-1) ·
  migration status and source/built parity ✅ · client file ✅ · built-API smoke ✅ (ready 200, **227
  OpenAPI paths**, new endpoints 401 without a token, verification answers unchanged) · **E2E 76 passed /
  0 failed / 0 skipped** (desktop + mobile; `commercial.spec.ts` 12, read-only) · **visual QA 46 screens,
  0 issues, 0 failed API calls** (`scratch/p8/visual-qa/`, Arabic 1920/1440/1024/390, English 1440/390).
- **Unit-tier stability, honestly:** at the starting HEAD the full unit run failed 3 web tests (5 s
  timeouts) on this machine (8 GB RAM, ~0.9 GB free; Docker's VM holds ~3 GB). Package 8's new screen tests
  use a light harness (`apps/web/src/testing/harness.tsx`: providers + one route, no shell, no
  `StrictMode` double render, text instead of role queries on large forms). No timeout was raised and no
  concurrency reduced. Under heavy outside load a timeout can still occur; nine full runs were made, the
  last three consecutive all green.
- **Demo-data integrity** (`scratch/p8-demo-before.json` → `scratch/p8/demo-after.json`): changed only
  `auditEvents`, `authSessions`, `authRefreshTokens`, `securityAccounts` (last sign-in), `roles`
  (permissions added) and `settingValues`/`settingRevisions` (+1 each, validity 14). Every lead, customer,
  unit, reservation, contract, instalment, receipt, document, document version and issued document —
  and therefore every QR token — is byte-identical. Nothing was reset or reseeded.
- **Debt:** translations are loaded for both languages at start-up (lazy-load the inactive one); the
  activation race window for legacy continuation is documented (unique index refuses a duplicate);
  receipts still dated by `today` for the period, not `receivedOn` (as before); the "customer service" and
  "contract operations" demo roles do not exist — their duties sit with the sales manager.

#### Resume point (BMP-1)

**Stop.** Nothing pushed by this workstream, nothing deployed. Next actions belong to the owner: review
package 8 (start: `npm run dev:services:up`, `npm run build`, `node apps/api/dist/main.js`,
`npm run preview -w @alola/web` → <http://localhost:4173>; the BMP-1 walk is in
[demo/walkthrough-ar.md](demo/walkthrough-ar.md)), decide `BD-19` (number formats), `BD-34`/`BD-35`
(identity and signing), `BD-36` (quotation validity), `BD-01`–`BD-03`, and authorize BMP-2 explicitly.

## Foundation completion (post-demo master prompt) — COMPLETE, stopped at the foundation gate

Started 2026-09-27. Scope: Part A forensic audit, then work packages F0–F12 (stabilization, deployment
model and company profile, organization, settings, number sequences, documents and templates,
notifications, tasks, search, import/export, integrations, client initialization, observability). One
local commit per green package. **Business Master Prompts 1–5 are not started and must not be.**

### Part A — audit verdict: PASS (2026-09-27, at `9cc3189`)

- Tree clean; secret files ignored, untracked, never in history. Remote `origin` exists and equals HEAD —
  pushed by the owner on 2026-09-24. Documentation said "no remote"; corrected.
- Baseline measured: lint, format, typecheck, i18n, secrets (327 files), links, **430 unit**,
  **integration 337 passed / 0 failed / 0 skipped** (own database; development counts unchanged
  afterwards), **E2E 37 passed / 1 skipped**, build, bundle 325.1 kB, 0 vulnerabilities, PDF checksum
  intact. Demonstration collection counts recorded before any change (`scratch/demo-counts-before.json`,
  ignored).
- Structural defects found: `docs/architecture/security-model.md` (since `3d6bdf1`) and
  `docs/architecture/dependencies.md` were **spliced into themselves** by the same
  `String.replace` "text-before-match" substitution that once damaged this file; the dashboard summed
  contract money with `Number()` over only the first 100 contracts and fell back to a hard-coded
  `'EGP'`; the four demo issues below were all still open; organization writes check a permission
  but apply **no data scope**; sales numbering takes its year from the server's UTC clock; the
  authenticator issuer defaults to a client name; sweeps are HTTP-triggered only.

### Work-package status

| Package | State | Commit |
|---|---|---|
| F0 Stabilization | **complete** | `24fe608` |
| F1 Deployment model, company profile, branding | **complete** | `1270ac7` |
| F2 Organization foundation | **complete** | `748a8b6` |
| F3 Settings, reference data, feature flags | **complete** | `d64ec0c` |
| F4 Number sequences | **complete** | `85cf2ca` |
| F5 Documents and templates | **complete** | `92d3110` |
| F6 Internal notifications | **complete** | `8ee6271` |
| F7 Tasks and escalation | **complete** | `505b1e5` |
| F8 Global search | **complete** | `e79b456` |
| F9 Import and export | **complete** | `fe2127c` |
| F10 Integration foundation | **complete** | `17b6fef` |
| F11 Migrations, client initialization, operations docs | **complete** | `09dfb36` |
| F12 Observability and operational readiness | **complete** | the commit containing this row |

### F0 — what changed

- `receiptState` labelled in Arabic and English. New `DISPLAYED_ENUMS` registry
  (`packages/i18n/src/enums.ts`) maps every enumeration the interface displays to the contract's own
  value list; `npm run check:i18n` now fails on any value without a label in **both** languages —
  the case key parity cannot see, because a namespace missing from both locales is symmetrical.
- Refresh is **single-flight** in the web client (`refreshSession`): StrictMode's double effect and
  concurrent 401s share one request, so the client never presents one single-use cookie twice. Server
  rotation and replay detection are untouched.
- Dashboard portfolio totals come from a new scoped, database-side aggregate,
  `GET /api/v1/sales/contracts/summary` — `$sum` over `Decimal128`, scope inside `$match`, one row
  per currency. This is demonstration-slice scope (`SALE-*`), not a requirement status change.
- `<div>` inside `<p>` on the dashboard: **not reproducible at `9cc3189`** in the ready, loading, or
  forbidden states. A StrictMode render test now fails on any nesting warning or block element inside a
  paragraph.
- The mobile drawer E2E test is re-enabled: on a phone the temporary drawer is opened, measured,
  closed for the language switch, and reopened.
- Both corrupted architecture documents repaired; `check:links` now also fails on a document that
  repeats its own title (the splice signature) and skips the ignored `scratch/` and `sandbox/`.
- A stale Playwright comment claimed a test approves the demo's pending approval; none does. Corrected.
- Measured at the F0 commit: typecheck, lint, **444 unit**, **integration 338 passed / 0 failed / 0
  skipped**, **E2E 38 passed / 0 failed / 0 skipped**, i18n (enum check included), links and
  integrity; demonstration business counts identical to the pre-change snapshot.

### F1 — what changed

- [ADR-0027](decisions/adr-0027-single-tenant-per-deployment.md): single tenant per deployment,
  multi-client product. No `tenantId`, no shared database, no source fork; client differences are
  configuration. Internal code namespaces (`@alola/*`, cookie and queue names) are documented as
  code identity, not client identity.
- New registry IDs `PLAT-022`–`026`, `THEME-013`, `CORE-ORG-001`–`006`, `CORE-IMPORT-003`,
  `OPS-004`–`007` (all claimed before use; F1's three are `implemented`, the rest `approved`).
- Company module (`apps/api/src/modules/company/`): one profile under a unique key, optimistic
  concurrency, append-only revisions, audited in one transaction; brand images (PNG/JPEG, magic bytes,
  512 KiB) superseded never deleted; public `/api/v1/branding` exposing no registration or contact.
  Permissions `company.profile.view` and administrative `company.profile.manage`.
- `packages/ui/src/brand.ts` (React-free `@alola/ui/brand`): the brand states derived from one
  colour and validated against every contrast pair in use — by the API on save, by `ThemeRoot`
  before render. `createAppTheme(locale, palette)`.
- Web: `BrandingProvider` loads branding at runtime with a neutral fallback; title, favicon, logo
  (with the name as alt text), starting language, a hidden switch for single-language deployments,
  and the demonstration notice only on development/test deployments.
- Neutralized client identity in source: authenticator issuer default `Real Estate ERP` (the
  profile's short name wins at enrolment), OpenAPI title, `.env.example`, API package description.
- Mongoose `minimize` would have silently dropped an empty `assets: {}` from stored revision
  snapshots — caught by the revision test; revisions now store snapshots exactly.
- Lint boundary: server code may import `@alola/ui/brand` and nothing else from `@alola/ui` (a
  regular expression, because glob negation cannot re-include a path under an excluded one); tested.
- Measured at the F1 commit: typecheck, full lint, format, **unit 462** (the F1 commit message says
  463 — a transcription error; 462 is what ran), **integration 360 passed /
  0 failed / 0 skipped**, **E2E 38 passed / 0 skipped**, i18n, secrets (346 files), links, bundle
  325.1 kB; all 30 baseline demonstration collections unchanged (three new, empty F1 collections).

### F2 — what changed

- `CORE-ORG-001`–`006` implemented; **`APPROVAL-005` moved to `implemented`** — an overdue
  approval now escalates through the real reporting line (`organization/foundation.int-test.ts`).
- **Defects in the demonstration slice fixed:** organization writes applied **no data scope** (a
  branch-scoped administrator could edit another branch's placements); a placement's `teamId` could
  be changed to a team of another department; a manager could be inactive; duplicate codes and a
  second active placement per account surfaced as `500` (duplicate-key error) instead of `409`;
  `startedOn` was an unchecked string.
- Units gain update and deactivate/reactivate routes with child/parent guards; the parent is
  "touched" (`structureVersion`) inside the creating transaction so a concurrent deactivation and
  creation serialize — proven by a six-round race test.
- Placements: effective-dated (`startedOn`/`endedOn`), transfer from a date, deactivate/reactivate,
  append-only `orgPlacementHistory`, reporting line that stops where the actor may not see; manager
  resolution only for an **effective** manager, in the organization's timezone.
- Cost-centre on branches and teams, `projectRefs` on teams (opaque; `CORE-ORG` imports no business
  module).
- New shared helpers: `apps/api/src/platform/audit-port.ts` (audit port with transaction session,
  `DomainError`, duplicate-key detection) and `apps/api/src/http/request-context.ts`.
- Measured at the F2 commit: typecheck, lint, format, **unit 462**, **integration 373 passed / 0
  failed / 0 skipped**, **E2E 38 passed / 0 skipped**; 30 baseline demonstration collections unchanged.

### F3 — what changed

- `PLAT-024`–`026` implemented: module `apps/api/src/modules/settings/`, contracts
  `packages/contracts/src/settings.ts`. Routes `/api/v1/settings` (`settings.view`, administrative
  `settings.manage`) and `/api/v1/reference-data` (read by anyone signed in, active items only;
  administrative `referenceData.manage` for changes and retired items).
- **Nothing is invented:** fiscal-year start (`SD-21`), reservation validity (`SD-03`) and quiet
  hours (`SD-21`) default to `null` — *not configured* — and name their decision; the 15-day reminder
  is the one default both source documents mandate; no tax rate is seeded (`SD-08`).
- Bound lists (unit, usage and finishing types, lead sources, pipeline stages, payment methods) mirror
  the contract enumerations and take their default labels from `@alola/i18n`; a deployment relabels
  and reorders them. **The business modules still read their own enumerations**; switching their
  screens and validation to the reference lists is Business Master Prompt 1 work.
- `ReferenceCodeSchema` exists because `BusinessCodeSchema` (upper case only) rejects the product's own
  enumeration codes.
- Measured at the F3 commit: typecheck, lint, format, **unit 479**, **integration 387 passed / 0
  failed / 0 skipped**, **E2E 38 passed / 0 skipped**; 30 baseline demonstration collections unchanged.

### F4 — what changed

- `CORE-DOC-001` implemented: module `apps/api/src/modules/numbering/`, contracts
  `packages/contracts/src/numbering.ts`. Seventeen document types; formats with prefix, suffix,
  separator, date part (`yyyy`, `yy`, `yyyyMM`, `fiscalYear`), entity/branch/project parts and
  reset policy; administrative `numbering.manage`.
- Issuing is `NumberingService.issue(issuer, request, session?)` — joining the caller's
  transaction — and deliberately has **no route**. Voiding keeps the number forever.
- The fiscal year comes from the F3 setting; a fiscal-year format refuses to issue while it is not
  configured rather than assuming January.
- Platform change: `validate` now reports a refinement's stable code (an `UPPER_SNAKE` message)
  instead of Zod's generic `custom` (`apps/api/src/http/validate.test.ts`).
- The demonstration modules still number through `salesCounters`; adoption with a series-continuing
  migration is Business Master Prompt 1 work.
- Measured at the F4 commit: typecheck, lint, format, **unit 482**, **integration 398 passed / 0
  failed / 0 skipped**, **E2E 38 passed / 0 skipped**; 30 baseline demonstration collections unchanged.

### F5 — what changed

- `CORE-DOC-002`, `004`, `006` implemented: module `apps/api/src/modules/documents/` (documents,
  versions, templates), contracts `packages/contracts/src/documents.ts`, storage
  `packages/security/src/local-files.ts`, `sanitizeFileName` in `uploads.ts`.
- Owner resolution is a port wired in `domain-services.ts` to each module's scoped getter (lead,
  customer, project, unit, reservation, contract, receipt; company papers for the `all` scope).
- Development and test store files under `FILE_STORAGE_DIR` (default `.local-storage`, ignored);
  staging/production use `UnconfiguredFileStore` and refuse, because the object-storage adapter is not
  built. `/api/v1/files/{token}` exists only with the disk store.
- `domain-services.ts` now takes `repositoryRoot` from the entry point: resolving it from
  `import.meta.url` inside the composition root would have pointed outside the repository in the
  bundled build.
- A literal U+202E character had slipped into a doc comment (an example of the attack the sanitizer
  prevents); replaced with a written-out code point. No other bidirectional control character exists in
  the source.
- No upload screen yet: the registry rows describe mechanism; screens come with the business modules.
- Measured at the F5 commit: typecheck, lint, format, **unit 499**, **integration 415 passed / 0
  failed / 0 skipped**, **E2E 38 passed / 0 skipped**, secrets (367 files); 30 baseline demonstration
  collections unchanged.

### F6 — what changed

- `CORE-NOTIFY-001`–`005` implemented: module `apps/api/src/modules/notifications/` (model, adapters,
  service, router), contracts `packages/contracts/src/notifications.ts`, routes under
  `/api/v1/notifications` (inbox, unread count, read one/all, preferences for oneself; administrative
  `notification.viewDeliveries` and `notification.dispatch`).
- Stored as a **type plus parameters**, rendered in the recipient's language; deduplicated by a unique
  key; external channels need opt-in, and customers need recorded consent; quiet hours defer
  non-urgent external messages in the organization timezone.
- Dispatch is a leased claim with an append-only attempt row, retries with the same idempotency key,
  and `failed` after five attempts. `dispatchDue`/`sweep` is what the worker will call on a schedule
  (F12); today it runs through the administrative dispatch route.
- **No real message can leave:** channel adapters are simulated in development and test (state
  `simulated`, `connected: false`) and absent elsewhere (`undeliverable`); even a connected provider
  sends nothing while `feature.notifications.externalDelivery` is off.
- Wired consumers: the approval engine's event port (pending approvers, escalation target, requester;
  `ApprovalEvent` gained `requesterAccountId` and an escalation event), and the reminder centre through
  `platform/reminder-delivery.ts` — reminders still reach `simulated`, never `sent`.
- Web: `NotificationBell` in the shell (unread badge, replacing the disabled placeholder) and
  `/notifications`.
- **Defect fixed — hard-coded timezone:** `apps/web/src/format.ts` displayed every instant in a
  constant `'Africa/Cairo'`. The branding answer now carries `timeZone` (the profile's, or
  `ORG_TIMEZONE` before one exists) and the formatters use it.
- **Serious defect found in F5's commit — the documents module was never committed.** The baseline
  `.gitignore` rule `documents/` (meant for real business papers) matched
  `apps/api/src/modules/documents/`, so `92d3110` contains its OpenAPI, wiring and contracts but **not
  the module itself**: a clean checkout of `92d3110` does not build. The working tree always had it,
  which is why every F5 check passed. Fixed here: a `!apps/api/src/modules/documents/` re-include
  (the protective rule stays) and the module is committed in F6. New guard `npm run check:ignored`
  (`scripts/check-ignored-source.mjs`, part of `verify`) fails whenever Git ignores a source file.
- F5's record says lint passed, but the module had three lint errors (unsafe `any` calls in
  `documents.int-test.ts`, an `import()` type in `templates.ts`); ESLint reports them with or without
  the ignore rule, so the F5 lint result was not what it recorded. Fixed here. Prettier 3 honours
  `.gitignore` by default, so `format:check` had skipped the module until the re-include.
- E2E note: the shell's badge first rendered a hidden `0`, which the dashboard test's "first number"
  locator picked up; the badge now renders no content when nothing is unread. Running the full E2E
  suite several times within fifteen minutes spends the per-address sign-in budget (120) and fails
  with "too many requests" — the throttle working, not a regression. Wait out the window.
- Measured at the F6 commit: typecheck, lint, format, **unit 504**, **integration 429 passed / 0
  failed / 0 skipped**, i18n; E2E and demonstration counts as recorded in the F6 commit message.

### F7 — what changed

- `CORE-TASK-001`–`005` implemented: module `apps/api/src/modules/tasks/`, contracts
  `packages/contracts/src/tasks.ts`, routes under `/api/v1/tasks` (list, calendar, create, read,
  edit, transition, assign; administrative `task.reassign` and `task.sweep`), screen `/tasks` (list
  and a Saturday-first month calendar) and a navigation entry visible to everyone.
- Permissions `task.view`, `task.create`, `task.manage`, and administrative `task.reassign`,
  `task.sweep`. One's own tasks (assigned, escalated to, or created by) need no permission.
- Linked tasks resolve their record through the documents' scoped owner resolver (one port, wired
  once in `domain-services.ts`) and copy its placement for their own scope. **A personal, unlinked
  task has no placement**, so a team or branch manager does not see a member's personal tasks — only
  the three people on the task and an `all`-scope viewer do.
- New shared helper `instantInZone(date, time, zone)` in `packages/contracts/src/time.ts`: a wall
  time in a zone to UTC; a skipped daylight-saving time moves forward by the gap and a repeated one
  takes its first occurrence.
- New setting `tasks.escalationDelayHours` (category `tasks`), default `null` = escalate as soon
  as overdue (the registry's own rule, G-09); a grace period is `SD-02`.
- The sweep (`TaskService.sweep`) is idempotent — conditional updates plus notification dedupe keys
  tied to the moment concerned; the worker schedule arrives with F12. The demonstration seeds no tasks
  and its roles hold no task permission.
- Assigning to someone else in the web screen needs an account picker, which the business modules
  bring; the API accepts any active account. Account administration has no organization scope yet, so
  assignment is not limited to the creator's organization unit — recorded as debt.
- **E2E and the sign-in budget:** the suite now signs in about forty times, a third of the per-address
  budget (120 per 15 minutes). A run started while an earlier run's window is still open can cross it
  mid-run. Check `throttle-login-ip:*` in Redis, or wait fifteen minutes between full runs.
- Web page tests render the whole lazily loaded shell; with two such files running in parallel the
  first render exceeded Testing Library's 1 s default. Their first heading lookup now waits up to 10 s
  (`FIRST_RENDER`) — test infrastructure, not an application change.
- Measured at the F7 commit: typecheck, lint, format, **unit 509**, **integration 444 passed / 0
  failed / 0 skipped**, **E2E 40 passed / 0 skipped**, i18n, links, secrets, ignored-source, build,
  bundle; 30 baseline demonstration collections unchanged (new empty `tasks`).

### F8 — what changed

- `CORE-SEARCH-001` implemented: module `apps/api/src/modules/search/` (no data of its own),
  contracts `packages/contracts/src/search.ts`, `GET /api/v1/search?q=&types=` (authentication only),
  and a search box in the shell — the top bar on desktop, the top of the navigation drawer on a phone.
- Providers are wired in `domain-services.ts` to one new scoped method per owning module:
  `CrmService.searchLeads`/`searchCustomers`, `InventoryService.searchProjects`/`searchUnits`,
  `SalesService.searchReservations`/`searchContracts`, `CollectionService.searchReceipts`,
  `DocumentService.searchDocuments`, `TaskService.searchTasks`. Each matches an escaped, anchored,
  case-insensitive prefix on unrestricted identifying fields only, and returns an identifier, a label,
  an optional bilingual name and an optional status enumeration value.
- A hit's label is shown in `<bdi>` (a name may be Arabic, a code Latin); its status is labelled
  through the owning type's enumeration translations.
- The validator reports Zod's own code (`too_small`) for a length rule; only a refinement's
  UPPER_SNAKE message becomes a custom code. The search contract relies on that.
- Prefix regular expressions scan an index only when anchored and case-sensitive; the
  case-insensitive form scans the scoped set. Acceptable at demonstration volumes; a collated or
  text index is Business Master Prompt work when volumes are known.
- **E2E budgets fixed.** One E2E run signs in about a hundred times from one address, so two runs within
  fifteen minutes crossed the 120 per-address sign-in budget, and busy screens neared the 300/min API
  limit. New validated setting `AUTH_LOGIN_IP_MAX_ATTEMPTS` (default 120; **refused above 120 in
  staging and production**, tested); `AuthThrottle` takes it as an override. Playwright starts the API
  with 2000 sign-ins and 5000 requests per minute. Production budgets are unchanged.
- Measured at the F8 commit: typecheck, lint, format, links, secrets (403 files), **unit 514**,
  **integration 450 passed / 0 failed / 0 skipped**, build, bundle, OpenAPI 165 paths / 0 broken refs,
  **E2E 42 passed / 0 skipped** (three consecutive runs: 42, 41 + one slow-load timeout during a run
  that took 4.5 min instead of 1.2, 42); 30 baseline demonstration collections unchanged.

### F9 — what changed

- `CORE-IMPORT-001`–`003` implemented: module `apps/api/src/modules/imports/` (mechanism only),
  contracts `packages/contracts/src/imports.ts`, `platform/csv.ts` (RFC 4180 reader, formula-safe
  writer with a UTF-8 byte-order mark), routes `/api/v1/imports` (preview, read, issues.csv,
  commit, discard) and `POST /api/v1/exports`, screen `/imports` (Administration, needs
  `referenceData.manage`), and an "Export CSV" button on the leads and units screens.
- Importers and exporters belong to their modules: `referenceItemImporter` in settings (with
  `SettingsService.storedCodes` and `importItems`, which inserts inside the caller's transaction),
  `CrmService.exportLeads`, `InventoryService.exportUnits`. New permissions `crm.lead.export`,
  `inventory.unit.export` (not administrative; the demonstration roles do not hold them).
- New dependency `read-excel-file@9.3.10` (pinned, justified in `architecture/dependencies.md`),
  0 vulnerabilities. Exports are CSV only; no spreadsheet writer was added.
- Object keys may not contain `.`, so an export is stored as `exports/<id>`; the file name comes
  with the signed link. The web client gained `apiBlob` (authenticated download) and a raw `file`
  body for uploads.
- Measured at the F9 commit: lint, format, typecheck, i18n, secrets (417 files), ignored-source,
  0 vulnerabilities, **unit 521**, **integration 461 passed / 0 failed / 0 skipped**, build, bundle,
  OpenAPI 171 paths / 0 broken refs, **E2E 42 passed / 0 skipped**; 30 baseline demonstration
  collections unchanged.

### F10 — what changed

- `INTEGRATION-001`–`005` implemented: module `apps/api/src/modules/integrations/` (model, adapter
  contract, service, routers), contracts `packages/contracts/src/integrations.ts`, routes
  `/api/v1/integrations` (list, read, credentials, disable/enable, check, sweep) and the public
  `POST /api/v1/webhooks/{provider}`. Administrative permissions `integration.view`, `.manage`,
  `.process`.
- **No adapter is registered** (`adapters: []` in `domain-services.ts`); every provider reads
  `noAdapter`. Pinned API versions in this build: **none** (INTEGRATION-002 records them here as
  adapters arrive).
- Credentials go through the same `Encryptor` as MFA secrets — so in staging and production they
  **cannot be stored** until the KMS adapter exists (`SEC-033`), by design.
- `http/raw-body.ts`: the global JSON parser keeps the exact bytes for `/api/v1/webhooks/*` only, so
  a signature is checked against what the provider sent. `WEBHOOK_MAX_BYTES` equals the 100 kB JSON
  limit.
- `verifyHmacSha256`/`signHmacSha256`: timestamped HMAC-SHA256 with a 300 s tolerance and
  constant-time comparison, as a building block for adapters.
- Processed inbox rows carry a 30-day `purgeAfter` TTL (operational delivery records; the business
  record is the evidence). Outbox rows are never deleted.
- `INTEGRATION-006` stays `in-progress`: the registry now exists, but no worker job consumes the
  sweeps yet — that is F12.
- ADR-0010's "a provider SDK import outside its adapter fails lint" is not enforced yet: no SDK exists.
  Add the rule with the first adapter.
- Measured at the F10 commit: lint, format, typecheck, i18n, secrets (428 files), ignored-source, links,
  **unit 524**, **integration 474 passed / 0 failed / 0 skipped**, build, bundle, OpenAPI 179 paths / 0
  broken refs, **E2E 42 passed / 0 skipped**; 30 baseline demonstration collections unchanged.

### F11 — what changed

- `OPS-004` implemented: `apps/api/src/platform/migrations.ts` (runner, checksum, lock) and
  `migration-list.ts` (one migration, `0001-foundation-baseline`, a no-op that records the starting
  version). Commands `db:migrate`, `db:migrate:status`. The development database is now at
  `0001-foundation-baseline` (a `schemaMigrations` row; no business data touched).
- `OPS-005` implemented: `packages/contracts/src/client-init.ts` (file schema),
  `apps/api/src/platform/client-init.ts` (`initializeClient`, system actor `system:client-init`),
  `scripts/client-init.ts` (`client:init --file … [--check]`). The first administrator stays with
  `bootstrap:admin`, which already refuses a second run.
- Documents: `docs/operations/` — client deployment checklist, client data-intake checklist,
  migrations and upgrades runbook, backup/restore/retention, example client file; and
  `docs/decisions/business-decision-register.md` (24 entries, BD-01…BD-24, each with options,
  a default only where safe, owner, blocking macro phase and status; four `proposed`, the rest `open`).
- A schema with no declared index is not created by `ensureIndexes` (Mongoose creates the collection
  on the first index); the lock schema declares one for that reason.
- **Corrected after the fact (`e8dacea`):** F11's checksum hashed the migration function's text,
  which differs between `tsx` and the production bundle, so the built API reported a source-migrated
  database as `mismatch`. It now hashes declared fields only — see "Foundation gate" below.
- Measured at the F11 commit: lint, format, typecheck, i18n, secrets (441 files), ignored-source, links,
  **unit 524**, **integration 485 passed / 0 failed / 0 skipped**, build, bundle, **E2E 42 passed / 0
  skipped**; 30 baseline demonstration collections unchanged (new: one `schemaMigrations` row).

### F12 — what changed

- `OPS-006`: readiness includes the schema check (`platform/migrations` via a probe in `main.ts`);
  `packages/config/src/build-info.ts` + an esbuild `define` in `scripts/build-node-app.mjs` compile
  version, commit and build time into the bundles; `apps/worker/src/heartbeat.ts` writes
  `alola:worker:heartbeat` (90 s expiry) with the dead-letter count; module
  `apps/api/src/modules/operations/` serves `GET /api/v1/operations/diagnostics` (administrative
  `operations.diagnostics`), configuration as set/not set only.
- `OPS-007`: `apps/api/src/platform/maintenance.ts` — five sweeps, single-runner under a
  `maintenanceRuns` lease, as `system:maintenance`; [ADR-0028](decisions/adr-0028-scheduled-maintenance-in-api.md)
  records why the API process and not the worker. Off by default in development and test.
- `INTEGRATION-006` moved to `implemented` (registry exists; dead letters visible).
- **`SEC-033` stays `in-progress`, by instruction.** The provider-neutral `Encryptor` interface is
  the only thing domain code depends on; staging and production **fail closed** — the development key
  is refused by the configuration loader, and `UnconfiguredEncryptor` rejects every call — so MFA
  secrets and provider credentials cannot be stored there. It is not marked implemented while no real
  KMS provider exists.
- A test fixture shaped like a connection string was caught by the secret scan; replaced rather than
  exempted.
- Measured at the F12 commit: lint, format, typecheck, i18n, secrets (454 files), ignored-source, links,
  0 vulnerabilities, **unit 530**, **integration 490 passed / 0 failed / 0 skipped**, build (bundles
  carry version and commit), bundle budget, **E2E 42 passed / 0 skipped**; 30 baseline demonstration
  collections unchanged.

### Planning (the commit containing this section)

- [phases/business-master-prompts.md](phases/business-master-prompts.md): the five business master
  prompts — scope by engineering phase and module, prerequisites, carried debt, decisions required,
  definition of done — and [ADR-0029](decisions/adr-0029-business-master-prompts.md): a grouping only,
  each prompt started on explicit instruction. `phases/README.md` "Current position" refreshed.

### Foundation gate — final verification, 2026-09-28

The gate was first reported with "every mandatory check passes" **before the built-API smoke had
run**. When the smoke ran, it failed — see "What the smoke found" below. The table records what was
measured after the fix. "Rerun" means measured after `e8dacea`; nothing in it is inherited.

| # | Check | Result |
|---|---|---|
| 1 | Format | ✅ rerun |
| 2 | Lint | ✅ rerun, 0 errors, 0 warnings |
| 3 | Typecheck (strict, root + workspaces) | ✅ rerun |
| 4 | Unit | ✅ rerun, **542 passed**, 39 files (530 + 12 migration-registry tests) |
| 5 | Integration gate, real MongoDB + Redis | ✅ rerun, **498 passed / 0 failed / 0 skipped**, 27 files (490 + 8) |
| 6 | i18n (keys and every displayed enumeration, both languages) | ✅ rerun |
| 7 | Secret scan | ✅ rerun, 460 files before the documentation commit; rerun on the final tree |
| 8 | Documentation links and integrity | ✅ rerun on the final tree |
| 9 | Ignored-source check | ✅ rerun |
| 10 | Dependency audit | ✅ rerun, 0 vulnerabilities (no dependency changed; only npm scripts were added) |
| 11 | Production build (web, api, worker) | ✅ rerun |
| 12 | Bundle budget | ✅ rerun; largest chunk `vendor-mui` 389.4 kB / 117.2 kB gzip (budget 650 / 210) |
| 13 | OpenAPI | ✅ rerun, 180 paths, 0 broken references |
| 14 | Built API smoke (`scratch/final-smoke.mjs`, port 4321) | ✅ rerun: live 200, **ready 200**, MongoDB up with transactions, Redis up, migrations `current`, `/me` and diagnostics 401 without a token, 180 OpenAPI paths, API process exited, port released |
| 15 | Migration status, development database | ✅ `0001-foundation-baseline`; nothing pending, changed or unknown |
| 16 | Migration checksum parity, source against the built API (`check:migrations:parity`, integration database) | ✅ new: source-applied schema reads `current`, readiness 200 |
| 17 | Client file validation (`client:init --check`) | ✅ rerun |
| 18 | End-to-end, built app + built API + real services — the demonstration journey, Arabic RTL, English LTR, Western digits | ✅ rerun, **42 passed / 0 failed / 0 skipped** |
| 19 | Demonstration data | ✅ 30 baseline collections' counts unchanged since the Part A snapshot; reservations, contracts, instalments, receipts, instruments, reminders, approvals and the seed ledger byte-identical (content hashes) across the repair and the smoke. No seed or reset ran |
| 20 | Arabic PDF | ✅ `89fade53…99f7b`, unchanged |
| 21 | Secret files tracked by Git | ✅ none |
| 22 | Client identity in user-facing text | ✅ none (product name only in code identifiers, ADR-0027) |
| 23 | Git | ✅ `main`, clean after the documentation commit; nothing pushed, no remote added (the owner's `origin` untouched) |

**What the smoke found.** The first smoke run never reached the API: it used port 4190, which Node's
`fetch` refuses. The recovery session found that the script still used 4190, although the previous
session reported that it had been changed. The corrected script, on port 4321 and now checking its
own results, then showed a **real defect**: `/health/ready` answered **503** with
`migrations: mismatch`. The migration checksum hashed `up.toString()`. `tsx` (used by
`npm run db:migrate`) printed `()=>Promise.resolve()` and the production bundle printed
`() => Promise.resolve()`, so a database migrated from source looked edited to the built API, and
**no built API could ever report ready** against it. E2E missed it because nothing there asserts
readiness, and the migration tests ran from source only.

**The fix — `e8dacea` `fix: make migration checksums build-stable`.**

- The checksum is now the SHA-256 of `["alola-migration-checksum/v2", id, revision, fingerprint]`.
  Each migration declares `revision` (a positive integer) and `fingerprint` (printable ASCII). Neither
  function text nor the description is hashed. The new module is
  `apps/api/src/platform/migration-registry.ts`.
- `validateMigrations` refuses a missing or malformed revision or fingerprint, and duplicate
  identifiers (`MIGRATION_INVALID`), and keeps the ordering rules.
- `schemaHealth` makes the readiness mapping testable. Pending, a genuine mismatch and unreadable
  history still keep an instance not ready.
- Tests: an esbuild bundle of the registry, minified and unminified, computes the same checksums as
  source. The baseline checksum is pinned to `c7e83ede…9df83e`. Readiness is tested against real
  recorded state, and the transition against real MongoDB.
- `npm run check:migrations:parity` applies the list from source to the integration database and
  requires the **built** API to report it `current` with 200.

**Development metadata repair.** `npm run db:migrate:transition-checksum` does a development-only
compare-and-set. It ran once on `real_estate_erp_dev`: row `0001-foundation-baseline`
`19a7cdc2…e65e65` → `c7e83ede…9df83e`, outcome `updated`. A second run reported `unchanged`. The same
row (same `_id`, `appliedAt` and `durationMs`) was kept, and no other field changed. The migration
body did not run and nothing was deleted or recreated. The integration database had no migration
row; the parity check recorded its baseline from source. No staging or production database exists.

**Verdict: FOUNDATION GATE COMPLETE — the local, reusable foundation.** F0–F12 are built and committed,
the checksum defect is fixed, and every check above passes. This is **not** production readiness.
These remain explicit production blockers, unchanged:

- `SEC-033` stays `in-progress`: no external KMS provider, so **no MFA secret or provider credential
  can be stored outside development**; staging and production fail closed.
- No object-storage adapter (`PLAT-017`), malware scanner (`SEC-005`) or secrets manager (`SEC-006`):
  staging and production refuse document uploads.
- `CORE-DOC-003` (PDF with embedded Arabic fonts) and `CORE-DOC-005` (QR verification) — **since
  implemented** in BMP-1 package 7 (2026-09-29); production issuance still waits on `PLAT-017`.
- The business decision register (BD-01–BD-24) is written; every entry is `open` or `proposed` —
  none is approved.
- **Phase 1 is not approved**: its gate still needs the stakeholder demonstration and written approval.

### Resume point

**Stop.** Business Master Prompts 1–5 are planned and **not started**; none may begin without the
stakeholder's explicit instruction. Next actions belong to the stakeholder: review the foundation,
answer the business decision register (at least BD-01–BD-04, BD-19, BD-22 for BMP-1), decide `SEC-033`'s
KMS provider, and give the Phase 1 written approval or its conditions.

### Superseded resume note (F12, kept for traceability)

Next package: **F12 — observability and operational readiness** (`OPS-006`, `OPS-007`): readiness
reporting worker, queue, integration and migration health, build metadata, redacted diagnostics; the
worker running the notification, task, integration and instalment sweeps on a schedule, single-runner
and idempotent. Then SEC-033's provider-neutral KMS interface status, the five business-phase
planning documents and ADR, the final 22-item verification and the final report.

### Superseded resume note (F9, kept for traceability)

Next package: **F9 — import and export** (`CORE-IMPORT-001`–`003`). Drafts already written and
parked, uncommitted, in the ignored `scratch/hold-f9/` (contracts `imports.ts`, module
`apps/api/src/modules/imports/` model and service, `platform/csv.ts` with tests): move them back to
the same paths. Remaining: the reference-items importer, leads and units exporters, the XLSX reader
(`read-excel-file`, pinned), router, OpenAPI, tests, screen.

## UI/UX redesign, company branding and visual quality gate — COMPLETE (2026-09-28), stopped for review

Scope: the UI/UX master prompt — a cohesive corporate interface over the existing product, with no
backend behaviour, permission, scope, requirement ID or API contract weakened. Business Master
Prompts remain **not started**. Starting HEAD `45aee8c`. One local commit per bounded group.

Baseline at `45aee8c` (measured before any change): lint, format, typecheck, i18n, secrets, links,
ignored-source ✅; **unit 542 / 39 files** (the chained `verify` run hit vitest worker start-up
timeouts under load — 10 files never started, 0 failures — and a standalone rerun passed all 542);
build + bundle ✅ (largest `vendor-mui` 389.4 kB / 117.2 kB gzip); **integration 498 passed / 0 failed
/ 0 skipped**. Demo database snapshot: `scratch/ui-demo-before.json` (counts + content hashes, ignored).

| Group | State | Commit |
|---|---|---|
| UI-1 Tokens, icon library, shared primitives, ADR-0030 | **complete** | `c208e71` |
| UI-2 Company identity, application shell, sign-in, people lookup | **complete** | `cbc5275` |
| UI-3 Dashboard and charts | **complete** | `12c3cc3` |
| UI-4 Lists and tables | **complete** | `2384dc1` |
| UI-5 Details, forms, marketing, organization, visual QA | **complete** | the commit containing this row |

### UI-1 — what changed

- [ADR-0030](decisions/adr-0030-ui-design-system-icons-and-charts.md): layout scale
  (`packages/ui/src/layout.ts`), elevation (`tokens.elevation`), type scale in the theme, icons from
  `lucide-react` **1.48.0** (exact) through `@alola/ui/icons` + `<Icon>`, charts to be `recharts`
  (added in UI-3). ADR-0005 status update: three **added** neutral tokens (`neutralSoft`,
  `mutedText`, `borderSoft`), measured and registered; no approved value changed.
- Lint: `lucide-react`, `@mui/icons-material`, `react-icons` refused in `apps/web` (tested).
- Primitives rebuilt: `StatusChip` (soft chip, distinct glyph per tone, `data-tone` kept), `StateView`
  (+ `noResults`, `offline`, `notConnected`, `simulated`, `inline` variant), `MetricCard` (icon disc,
  `attention`/`positive` edge, optional link — no invented trends), `PageHeader` (`eyebrow`,
  `status` beside the title, `meta`), new `SectionCard`, `TableToolbar`, `DataTable` (skeleton rows,
  empty vs no-results, toolbar/footer, keyboard-openable rows with a mirrored chevron, secondary
  columns hidden below `lg`, optional `maxHeight` sticky header). Theme: component defaults for
  buttons, inputs (`TextField` defaults to `small`), tables, tabs, dialogs, menus, tooltips, and a
  `prefers-reduced-motion` rule.
- Web: `Panel` now wraps `SectionCard`; `Field` restyled; `useTableLabels()` added.
- Measured: unit **563** (542 + 21), lint/typecheck/format on changed areas, i18n, links, secrets
  (466 files), ignored-source, build, bundle (`vendor-mui` 392.6 / 117.9 kB gzip).

### UI-2 — what changed

- **Company identity (PLAT-022/023 screens):** `/settings/company` (`CompanyIdentityPage.tsx`) over the
  existing F1 API — no new company model. Draft → "Publish changes" (one audited revision, guarded by
  `expectedVersion`), discard, unpublished-changes chip, read-only view without
  `company.profile.manage`, live preview (sidebar, sign-in, document header) under a theme built from
  the draft colour, colour validated in the browser with the server's rule (`validateBrandColor`),
  logo/compact/favicon upload through the existing validated endpoint (PNG/JPEG, magic bytes,
  512 KB, stored in MongoDB — no object-storage bypass), revision history with names. Not supported by
  the contract and therefore not built: per-language logos, a secondary colour.
- `BrandingProvider` gained `useBrandingReload()`: a publish updates the running app without a reload.
  `brandDisplayName`, `initialsOf` helpers. `apiRequest` gained `fileType` (declared upload type).
- **ALOLA demonstration identity, applied 2026-09-28** with the new `npm run seed:demo:identity`
  (`scripts/seed-demo/identity.ts`, `identity-cli.ts`; guarded exactly like the seed, idempotent,
  writes through the services as the seeded administrator and marketing manager). Development
  database change, verified by content hash against `scratch/ui-demo-before.json`: `companyProfiles`
  0→1 and `companyProfileRevisions` 0→1 (legal/display name شركة العلا للتطوير العقاري / ALOLA
  Developments, short العلا / ALOLA, fictional CR/tax/contact); `orgLegalEntities` LE-DEMO renamed from
  the superseded دار المستقبل للتطوير العقاري / Future House Development; one `marketingCampaigns`
  headline; `roles` (demo administrator gains `company.profile.view` and administrative
  `company.profile.manage`); `auditEvents` +3. Nothing else changed; a second run reports `unchanged`.
  A fresh `seed:demo` now creates the ALOLA identity directly (`dataset.ts`).
- **People lookup (ADR-0031):** `GET /api/v1/organization/people?ids=` — authenticated only, ≤100
  well-formed references, returns directory label + job title of **active** placements only, not
  scope-filtered by design (the caller already holds the reference). OpenAPI documented. Web:
  `people.tsx` (`PeopleProvider` batches per frame and caches per session; `PersonName`,
  `usePersonLabel`; localized "System" / "Unavailable user" fallbacks). **Raw `acc_…` IDs removed**
  from leads list, lead detail, reservation detail, receipt detail, organization and the dashboard
  owner chart.
- **Shell:** grouped navigation (overview, CRM, inventory, reservations & contracts, collections &
  finance, marketing, organization & administration, settings) with lucide icons, collapsible groups
  (the active group cannot fold), icon-only collapsed mode with tooltips, both remembered in
  `localStorage` (try/catch), brand block (logo or monogram, display name, product descriptor), sticky
  top bar (global search with icon and description, notifications, compact language switch, user
  avatar/name/job title menu with Company identity and sign-out), breadcrumbs with a detail-page tail
  (`useBreadcrumbTail`), single page scroll, mobile drawer from the inline start.
- **Sign-in:** brand mark and name from configuration, show/hide password, loading state, language
  switch in the header, demonstration notice only when `demonstration` is true, no "forgot password"
  (no delivery provider exists).
- Tests: `navigation.test.ts` (groups, permissions, active item, breadcrumbs, initials), branding tests
  (display-name alt text, monogram), `organization.int-test.ts` (+3 people lookup), E2E
  `identity.spec.ts` (ALOLA on sign-in/sidebar/organization, no superseded name, no `acc_`, no raw
  `receiptState.` key).
- **Defect found and fixed during verification:** `initialsOf` had lost its `\s` escapes when the file
  was generated, producing wrong initials — caught by the new unit test.
- Measured (working tree including the UI-3/UI-4 drafts): typecheck ✅, lint on changed areas ✅,
  unit **570 / 40 files**, **integration 501 passed / 0 failed / 0 skipped** (498 + 3), i18n, secrets
  (478 files), links, ignored-source. E2E runs with the full suite at the end of UI-5.

### UI-3 — what changed

- `recharts` **3.10.1** + `react-is` **19.3.0** (exact, 0 audit findings) in `apps/web` only;
  `apps/web/src/charts/`: `Charts.tsx` (`CategoryBarChart` horizontal/columns, `DonutChart` with an
  HTML legend carrying label, value and share), `RatioMeter.tsx` (no chart dependency), `index.tsx`
  (lazy wrappers with a skeleton). Every chart is a `<figure>` whose numbers are repeated in a
  visually hidden table; RTL reverses category axes; value axes start at zero; colours from
  `CHART_SERIES_ORDER`; nothing invented, no trends.
- **Bundle:** recharts lives only in the lazy `Charts` chunk (378.2 kB / 107.3 kB gzip), not preloaded
  and not imported by the entry. A Vite manual `vendor-charts` group was tried and **reverted**:
  rolldown pulled react/clsx into it recursively and the entry then imported it at start-up.
- **Dashboard** (`DashboardPage.tsx`): executive summary (active contracts, contracted, collected with
  collection rate, outstanding — server `Decimal128` totals, exact two decimals); "needs attention
  today" (overdue and upcoming instalments, reservations pending approval, overdue and due
  follow-ups, reminders ready and simulated, own open and overdue tasks — each a count linking to its
  list, only non-empty items shown); collections (collection-rate meter, contracted/collected/
  outstanding bars, overdue ageing by days late — counts from at most 200 rows, labelled as partial
  when more exist); sales (KPIs, pipeline by stage, leads by source donut); inventory (units by
  status donut + KPIs linking to filtered units); marketing (spend by platform, labelled as
  demonstration figures); team (per-representative leads with names). Every request is
  permission-gated and every figure scoped by the server.
- Ratios for the meter and chart geometry use `Number` on decimal strings — presentation only; every
  money figure shown is the server's decimal string formatted, never recomputed.
- Measured: typecheck, lint, unit 570, build, bundle budget (largest `vendor-mui` 409.3 / 122.2 kB
  gzip; `Charts` 378.2 / 107.3 kB gzip).

### UI-4 — what changed

- One list pattern on leads, customers, projects, units, reservations, contracts, instalments,
  receipts, cheques/notes and reminders: `TableToolbar` (in-list `ListSearch` labelled "search this
  list", `FilterSelect` with "All", removable active-filter chips, clear-all), `DataTable` with shared
  `useTableLabels()` (empty vs no-results), keyboard-openable rows with accessible names, and a
  `ListFooter` ("Showing N of M" from the server's scoped total, "Show more" by keyset cursor through
  the new `usePagedList`; tested). New filters where the API already supports them: lead stage and
  source, reservation state, contract state; unit filters moved into the toolbar and kept in the URL.
  Sales-owner column (as a name) on reservations and contracts. Instalment bucket cards now ask for
  `limit=1` totals; the table pages the selected bucket.
- **Defect fixed:** unit and new-lead project/branch selects always showed the Arabic name, also in
  English — now the current language.
- Projects: icons, positive tone on availability, an availability meter.
- **E2E fixes (test code, not product):** the sign-in helper now finds the password field by role and
  exact name (the show-password toggle's name contains the field label; the label text carries the
  required asterisk). In `identity.spec.ts` the mobile drawer toggle is probed before the drawer
  opens, and the Organization identity check signs in as the all-scope executive.
- **Finding, recorded as behaviour rather than changed:** a branch-scoped role (the demo sales
  manager) sees **no legal entity** on Organization, because legal entities are scope-filtered and
  sit above the branch. Correct under ADR-0006; a read-only "own legal entity" view is a candidate
  for Business Master Prompt 1.
- E2E measured on the UI-3 tree before these fixes: **50 passed / 2 failed** (both the mobile cases of
  the new identity spec, fixed above); the full suite reruns at the end of UI-5.
- Measured: typecheck, lint, web unit 39 (37 + 2 paging tests).

### UI-5 — what changed

- **Record pages** (contract, reservation, receipt, unit, lead): back link, record-type eyebrow,
  status chip beside the title (full-width banners kept only for genuine alerts: pending approval,
  reversed receipt), metadata line, secondary actions before the primary one, record number as the
  last breadcrumb, icons on sections and KPIs; the contract schedule is a sticky-header table.
  Shared `Timeline` and `Transition` (direction-aware arrow) replace hand-typed "→" on the unit and
  lead histories; activity kinds carry distinct glyphs.
- **Defects fixed:** unit view and payment-plan text always Arabic (now `[locale]`); `visuallyHidden`
  used `width: 1`, which MUI reads as 100% — every hidden label was page-wide and gave wide screens
  up to 1,847 px of horizontal scroll (fixed with px strings, tested); the chart's hidden data table
  now sits in a clipping box; horizontal bar charts rebuilt with layout after recharts' RTL axis put
  labels under bars (ADR-0030 status update); long money KPIs stepped down a size instead of
  wrapping their last character; pipeline in pipeline order; `PersonName` loading marker.
- **Marketing:** connection panel (Meta — not connected, never synchronised, simulated mode),
  performance KPIs incl. remaining budget (decimal `subtractMoney`), reach and impressions (integer
  sums over loaded campaigns), leads by campaign, spend and leads by platform, platform/state
  filters, a "simulated" badge on every state. Only the product's real states are shown (draft,
  ready to publish, archived); no publish control exists.
- **Organization:** counts, the legal entity, branches with departments, teams, cost centres and
  head-counts, and a searchable, filterable people directory with names, titles, teams and managers.
  Placements only — no account or HR data joined (ADR-0019).
- Dead code removed: the retired `DevLogoPlaceholder` and its two keys. Docs:
  `architecture/localization-and-theming.md` §10 (building blocks, direction rules, responsive
  behaviour, visual QA), ADR-0030 status update, `REQUIREMENTS.md` evidence section;
  **THEME-009 → `implemented`** (Phase 1: 104 implemented, 7 in progress, 2 not started).
- **Visual QA** (`scratch/ui-visual-qa.mjs`, screenshots in `scratch/visual-qa/`, ignored): 69 screens
  — sign-in (4 widths, AR/EN), dashboard at 1920/1440/1024/390, every list and record page in Arabic
  at 1440 and 390, every list in English at 1920, company identity (admin, second factor computed in
  memory), collapsed sidebar, mobile drawer. Final report: 0 horizontal overflow, 0 raw keys, 0 raw
  account ids, 0 emoji, 0 unnamed controls, 0 failed API calls; the only console errors are the
  expected signed-out 401 of the session probe; three "0 h1" flags were the probe sampling mid-route
  (the screenshots show one h1).

### Final verification — 2026-09-28 (`scratch/ui-final-verify.sh`, logs in `scratch/final/`)

| Check | Result |
|---|---|
| format · lint · strict typecheck | ✅ 0 errors, 0 warnings |
| i18n (keys + displayed enumerations, both languages) | ✅ |
| secrets · links · ignored-source | ✅ 480 files · 406 links in 61 files · none hidden |
| dependency audit | ✅ 0 vulnerabilities |
| unit | ✅ **577 passed**, 42 files |
| integration gate (real MongoDB + Redis) | ✅ **501 passed / 0 failed / 0 skipped** |
| production build · bundle budget | ✅ largest `vendor-mui` 409.3 / 122.2 kB gzip; `Charts` 378.3 / 107.3 (lazy); entry 104.0 / 33.6 |
| migration status · source/built parity | ✅ nothing pending; parity agrees |
| client file validation | ✅ |
| built-API smoke | ✅ ready 200 (transactions, migrations current), 401 without token, **181 OpenAPI paths** |
| E2E (built web + built API + real services, desktop + mobile) | ✅ **52 passed / 0 failed / 0 skipped** |
| demonstration data | ✅ 14 business collections byte-identical to the pre-redesign snapshot; only the audited identity records, sessions, tokens, audit events and last sign-in times changed |
| secrets | ✅ `.env`, `docker/dev.env`, `.demo-credentials.md` ignored, untracked, never in history |

### Remaining debt from the redesign

- Branch-scoped roles see no legal entity on Organization (scope design; candidate for BMP-1).
- The customer screen has no detail page, so customers are not clickable; per-customer pages are
  business work (BMP-1).
- Per-language logos and a secondary brand colour are not in the company contract; not built.
- The organization timezone of this development deployment is `UTC` (`ORG_TIMEZONE`); a client file
  sets the real one.
- The visual QA is a script, not a CI gate; no pixel-diff baseline is stored (screenshots stay out of
  Git by instruction).
- Hosted CI still never observed.

### Resume point (UI redesign)

**Stop.** The redesign is complete and committed locally; nothing is pushed or deployed. Business
Master Prompts 1–5 remain **not started**. To review: `npm run dev:services:up`, then
`npm run build`, `node apps/api/dist/main.js` and `npm run preview -w @alola/web` →
http://localhost:4173 (or `npm run dev:api` + `npm run dev:web` → http://localhost:5173). Passwords
are in the ignored `.demo-credentials.md`.

## Final UI polish and RTL formatting pass — COMPLETE (2026-09-29), stopped for review

Scope: a bounded polish pass over the redesign, starting at `6cc12dd`. No API, permission, scope,
business rule, schema, migration or requirement status changed; Business Master Prompts remain **not
started**. One local commit (`fix: complete final UI polish and RTL formatting`).

- **RTL-safe values:** new `FormattedValue` and `ValueRange` (`packages/ui/src/FormattedValue.tsx`):
  the isolate's direction follows the content (Arabic script → RTL, everything else → LTR), values
  never wrap internally, long e-mails may. Fixes `%24.62` → `24.62%` and Arabic money units reordered
  inside LTR isolates. Used by `MetricCard`, `BarChart`, the web charts, `RatioMeter`,
  `HorizontalBars`, the dashboard hint and the web `Verbatim`. The lead budget is a `ValueRange`.
  `tests/bidi-source.test.ts` refuses raw bidi control characters in source.
- **System references:** `SystemNote` (`pages/shared.tsx`) translates the sales service's stored
  English references (`contract CTR-…`, `reservation RSV-… confirmed|cancelled`) on display — "عقد
  CTR-…" — in lead activity and unit history. Stored data unchanged; unmatched text shown as written.
- **Record pages:** `DetailLayout` (main + aside) and `FieldGroup` (titled sections, 1–3 columns) on
  lead, unit, reservation, receipt and contract detail; the reservation's unit is a link showing the
  unit code, never an identifier; the receipt links to its contract.
- **Tasks empty states:** open/mine is a success state ("no open tasks for you"), closed and scoped views
  have their own wording, the "new task" action appears only with `task.create`, errors retry
  (`DataTable` gained `emptyKind`).
- **Sidebar:** brand fixed at the top, collapse control at the bottom, the navigation list the only
  scrolling region, thin scrollbar visible on hover/focus, `overscroll-behavior: contain`, 44 px
  touch rows on phones. Measured at 1440×900 and 1920×900 in Arabic (right) and English (left) and
  in the mobile drawer.
- **Branding:** `BrandMark` falls back to the monogram when a logo fails to load; the logo is
  documented as client-provided content.
- **Marketing disclosure:** one banner (provider, connection, last sync, mode), one badge on the
  performance section; per-row and per-chart badges removed.
- **Row labels:** instalment and unit-picker rows carry descriptive accessible names.
- **`vendor-charts`:** the prompt asked to preserve a separate `vendor-charts` chunk. None exists by
  design since UI-5 (ADR-0030 status update: the manual group pulled React into itself and the entry
  imported it at start-up). Recharts stays in the lazy `Charts` chunk; the entry does not load it.
- Docs: `architecture/localization-and-theming.md` (logo note; §10 building blocks, RTL-safe
  formatting, empty states and disclosure, sidebar structure, visual QA).

Visual QA: `scratch/ui-visual-qa-final.mjs` → `scratch/visual-qa-final-polish/` (ignored), 38 screens +
5 sidebar measurements, Arabic and English, 1920/1440/1024/390: **0 issues** (overflow, raw keys,
`acc_`, emoji, h1 count, unnamed controls, percent isolation, range order, English record words in
Arabic, sidebar structure); 0 failed API calls; the only console errors are the expected signed-out
401 of the session probe. Screenshots inspected.

Verification (`scratch/ui-final-polish-verify.sh`, logs `scratch/final-polish/`): format, lint (0/0),
strict typecheck, i18n, secrets, links, ignored-source, 0 vulnerabilities ✅ · **unit 595 passed, 45
files** · **integration 501 passed / 0 failed / 0 skipped** · build ✅ · bundle ✅ (largest
`vendor-mui` 409.3 / 122.2 kB gzip, budget unchanged) · migration status and source/built parity ✅ ·
client file ✅ · built-API smoke ✅ ready 200, 181 OpenAPI paths (the first smoke attempt failed only
because the copied harness pointed at a misnamed script; rerun with the real one) · **E2E 52 passed /
0 failed / 0 skipped**. Demo data: every business collection byte-identical to
`scratch/polish-demo-before.json`; only `auditEvents`, `authSessions`, `authRefreshTokens` and
last sign-in times changed (sign-ins by QA and E2E). No seed or reset ran.

Remaining debt: unchanged from the redesign list below, plus — the unit-test tier sometimes hits vitest
worker start-up timeouts when run chained under load (0 assertion failures; a standalone rerun passes
all); the visual QA is still a script, not a CI gate.

**Resume point: stop.** Nothing pushed or deployed. Review at http://localhost:4173 after
`npm run build`, `node apps/api/dist/main.js`, `npm run preview -w @alola/web`; recommended account
`executive@demo.invalid` (password in the ignored `.demo-credentials.md`). Business Master Prompts
1–5 remain not started.

## Phase status

- [ ] Phase 1 — *in progress: scaffolding, audit, authorization, identity/authentication, and the
      approval engine done; foundation packages F0–F7 done (organization, settings, numbering, documents,
      notifications, tasks) F8 (search), F9 (import/export) and F10 (integration foundation), F11 (migrations, client init) and F12 (operations) done; PDF/QR
      (CORE-DOC-003, 005) done in BMP-1 package 7; 7 IDs in progress; gate needs stakeholder approval*
- [ ] Phases 2–9 — not started. **Do not start Phase 2.**

## Recently completed — 2026-09-19

### 1. Stakeholder decisions applied (commit `7a840b3`)

`SD-13` Light Mode only (closed) · `SD-14` full Master Mapping Meta scope (closed) · `SD-15` Conversions
API optional, production delivery gated (ADR-0017) · `SD-16` Atlas dev cluster + Redis adapter, no Docker
(ADR-0018) · `SD-22` nine Phase 1 namespaces (ADR-0016; REQUIREMENTS.md re-keyed, old → new table kept) ·
PDF confirmed supplementary (ADR-0013 status update) · `SD-17` logo open, non-blocking · all remaining
decisions assigned to the phase they block — none blocks Phase 1 scaffolding.

### 2. Phase 1 scaffolding (this commit)

| Workspace | Contents |
|---|---|
| `packages/contracts` | Error codes and error response; health schemas; decimal-string money with explicit rounding and exact allocation; branded `Instant` / `BusinessDate`; `{ ar, en }` labels |
| `packages/config` | Zod-validated env for API and worker; value-free errors; production-DB-name guard; UTC runtime assertion; `.env` loader |
| `packages/security` | Pino logger with central redaction; `Encryptor` interface + unconfigured + dev-only AES-GCM; `PrivateFileStore` with signed-URL TTL ≤ 300 s and safe keys; upload validation by magic bytes; malware-scan hook (`not_scanned` until a scanner exists) |
| `packages/i18n` | `ar`/`en` resources (`common`, `errors`); key-parity + plural-category checker; direction and font stacks; `Intl` formatters (org timezone, exact money strings, un-shifted business dates) |
| `packages/ui` | `tokens.ts` (only file with color values); WCAG contrast calculator + registry of every pair in use; Light-only MUI theme with all interaction states; RTL/LTR emotion caches; `StateView` (5 states); `LtrIsolate` |
| `packages/testing` | `serviceGate` — loud, explicit skips for integration tests |
| `apps/api` | Express 5: correlation IDs (AsyncLocalStorage), pino-http, Helmet, strict CORS, health (live/ready per dependency), rate limiting (Redis or memory), JSON limit, CSRF origin guard, strict validation, centralized errors, OpenAPI 3.1 from Zod, fail-safe Mongo/Redis connectors, Decimal128 conversion, module mount point |
| `apps/worker` | BullMQ bootstrap: bounded exponential retries, dead-letter queue (metadata only, no payload), deterministic idempotent job IDs, correlation envelope; exits cleanly without Redis |
| `apps/web` | Locale provider (one state drives text, `lang`, `dir`, theme); responsive shell (drawer at inline start, skip link, language switch); dev-only text logo placeholder; foundation page |
| Root | ESLint flat config + `eslint.restrictions.js`; Prettier; Vitest projects (unit) and integration config; Playwright; `scripts/bin.mjs`, `build-node-app.mjs`, `check-i18n.ts`, `scan-secrets.mjs`; `.env.example`; `.gitattributes`; `.editorconfig`; `.nvmrc`; `.github/workflows/ci.yml` |

Docs changed: `architecture/dependencies.md` (new), `architecture/environments.md` (variables and
commands), `architecture/overview.md`, `architecture/README.md`, `decisions/open-decisions.md` (`SD-23`),
`README.md` (getting started).

### 3. Phase 1 review decisions (the commit containing this file)

| Decision | Applied |
|---|---|
| `SEC` boundary | ADR-0019: `SEC` = accounts, auth, sessions, devices, MFA, activation/suspension, roles, permissions, field restrictions, scopes, policies, security events · `CORE-ORG` = entities, branches, departments, teams, job titles, hierarchy, placement references · `HR-EMP` = employee profiles, contracts, HR documents, attendance/payroll identity, placement. **No `SEC` ID held HR data — none restored.** `SEC-011`, `SEC-019`, `SEC-026` clarified; `SEC-021` narrowed; new `CORE-TASK-005`, `APPROVAL-007` (split from `SEC-021`); customer transfer → Phase 3 `CRM-OWNER`. Phase 1 now 113 IDs. |
| Arabic PDF | Committed at `docs/source/alola-client-business-scope-ar.pdf`, bytes unchanged, SHA-256 `89fade53871af54f69527c3a23cee7171197525b322db0ed0d301e9c53199f7b`; `docs/source/README.md` records the original name and status |
| `SD-23` | **Closed.** Western digits in Arabic and English, forced with `-u-nu-latn`; `dd/MM/yyyy` dates; ICU bidi marks stripped except a leading LRM on negatives; contracts reject Arabic-Indic digits; identifiers rendered verbatim and direction-isolated. ADR-0003 status update |
| Integration gate | New `npm run test:integration:gate` fails (not skips) without MongoDB/Redis |
| Bundle budget | `npm run check:bundle`: largest chunk ≤ 650 kB minified / ≤ 210 kB gzip; route splitting required before feature-heavy phases |
| Dependencies | Unchanged — no upgrades |

### 4. Recovery after an interrupted session (2026-09-20)

The session applying the review decisions stopped at its usage limit **after writing every file but before
committing**. Recovery verified each decision against the repository rather than against notes:

| Item | State found | Action |
|---|---|---|
| A — `SEC` boundary (ADR-0019, registry, ADR-0016, security model, ADR index) | Complete, uncommitted | Committed as-is |
| B — Arabic PDF moved to `docs/source/`, README, checksum | Complete, **untracked** | Verified checksum and single copy, then committed |
| C — `SD-23` formatter, ADR-0003 status update, localization doc | Complete, uncommitted | Kept; **added** identifier tests (phone, national ID, IBAN, unit code) that decision C also required |
| D — Integration gate script, strict `serviceGate`, gate docs | Complete, uncommitted | Committed as-is |
| E — Bundle budget script and documentation | Complete, uncommitted | Committed as-is |
| F — Dependencies unchanged | Verified: `package.json` diff is scripts only, `package-lock.json` untouched | No action |
| `docs/MEMORY.md` unit-test row | **Defective** — literal `REPLACE_UNIT_COUNT` placeholder | Replaced with the measured count |

Nothing was reset, discarded, or duplicated; no destructive Git command was run; the two existing commits
were left untouched.

### 5. Development services and Phase 1 verification (2026-09-21, the commit containing this file)

The stakeholder cancelled the managed-service route for development (no external accounts, API keys, or
hand-copied connection strings) and approved local Docker instead — [ADR-0020](decisions/adr-0020-local-docker-development-services.md).
Atlas and managed Redis remain the staging/production direction ([ADR-0018](decisions/adr-0018-development-infrastructure-selection.md)
status update). **Nothing was provisioned in any cloud: no Atlas project, cluster, user, or managed Redis
instance exists, and no payment method was ever entered.**

| Item | Result |
|---|---|
| Prerequisites | Docker Desktop 4.91.0 + Docker Engine 29.8.0 + Compose v5.5.1 on WSL 2. Installing WSL 2 needed Administrator rights and a restart — done by the stakeholder, it is not automatable from here |
| MongoDB | `mongo:8.0.32`, single-node replica set `rs0`, PRIMARY, keyfile internal auth, published to `127.0.0.1:27017` only |
| Redis | `redis:8.10.1-alpine`, password-protected, `appendonly yes`, published to `127.0.0.1:6379` only |
| Volumes | Persistent named volumes `alola-dev-mongodb-data`, `alola-dev-mongodb-config`, `alola-dev-redis-data`; `dev:services:down` keeps them |
| Least privilege | `erp_dev_user` = `readWrite` on `real_estate_erp_dev` only; `listDatabases` as that user returns `[]` |
| Credentials | Generated locally, stored only in the ignored `docker/dev.env` and `.env`; never printed, never committed. `.env` ACL restricted to the current user |
| Connectivity checks | **9/9 passed** — Mongo connect, write, read, multi-document **transaction**, delete + collection drop; Redis connect, set + get, delete, `appendonly` confirmed. All test records and keys removed |
| Added | `docker/compose.dev.yml`, `scripts/dev-services.mjs`, npm scripts `dev:services:up|status|down` |

## Recently completed — 2026-09-21 (audit subsystem and authorization core)

Bounded group: `AUDIT-001`–`AUDIT-006` and `SEC-023`–`SEC-032`. Nothing outside it was implemented.

### Audit subsystem

| Piece | Where | What it guarantees |
|---|---|---|
| Append-only store | `apps/api/src/modules/audit/model.ts` | `auditEvents`; every mutating query op, `bulkWrite`, and a document re-save throw; every field `immutable` under `strict: 'throw'`; 7 named indexes |
| Service | `apps/api/src/modules/audit/service.ts` | `record`, `query`, `findByEventId`, `exportEvents`, `recordAuthenticationEvent`. No update or delete path exists. A failed write is logged **and rethrown** |
| Query surface | `apps/api/src/modules/audit/router.ts` | `GET /api/v1/audit/events`, `/events/export` (NDJSON, bounded, reports truncation), `/events/{eventId}`. Each read records its own event before responding |
| Change summaries | `packages/security/src/audit/summary.ts` | `{ path, from, to }` only; sensitive keys redacted; value length, path count, and depth bounded; no request body stored |
| AUDIT-003 enforcement | `apps/api/src/http/audit-context.ts` | Per-request audit-write counter: a successful mutation that recorded nothing becomes `500` and logs `AUDIT_MISSING_FOR_MUTATION` |

Pagination is **keyset** (`occurredAt desc, eventId desc`, opaque cursor), so pages neither repeat nor skip
as events arrive. Immutability is **application-level**: the privileged-database-administrator limit and the
absence of cryptographic tamper-proofing are stated in
[ADR-0021](decisions/adr-0021-audit-trail-integrity.md) §2, and in the model's own doc comment.

### Authorization core

| Piece | Where | What it guarantees |
|---|---|---|
| Permission catalog | `packages/contracts/src/authorization.ts` | Granular verbs; `ADMINISTRATIVE_PERMISSIONS` explicit; `security.grant.assignAny` never implied |
| Policy | `packages/security/src/authorization/policy.ts` | Default deny; unknown permission denied; **deny wins** |
| Scope | `.../scope.ts` | Filter merged into the query before the database answers; an unsatisfiable scope matches **nothing** |
| Fields | `.../fields.ts` | Restricted fields deleted from responses and exports; writes to unseen fields refused |
| Escalation | `.../escalation.ts` | No self-grant, no granting unheld permissions, no widening scope |
| Filter safety | `.../sanitize.ts` | `$`-prefixed keys, dotted keys, and operator objects rejected |
| Guard | `apps/api/src/http/actor.ts` | `401`/`403` without naming the permission; denial recorded as `security.authorization.denied` |
| Admin surface | `apps/api/src/modules/security/` | `roles` and `accountGrants` collections; `GET/POST /security/roles`, `GET/PUT /security/accounts/{id}/grants` |

The actor is rebuilt from stored grants on **every** request, so `SEC-032` holds with no cache to
invalidate ([ADR-0022](decisions/adr-0022-authorization-resolved-per-request.md)).

### Defects this group's own tests found, and the fixes

| Found | Fix |
|---|---|
| Domain errors (privilege escalation, role-key conflict, unknown role) surfaced as `500`: the error handler only knew `AppError` | `ERROR_STATUS` map in contracts; the handler accepts a `code` that is in the published list, so a module can answer correctly without importing the HTTP layer. A Node code such as `ENOENT` still falls through to `INTERNAL_ERROR` |
| A refused privilege escalation left **no evidence**: the guard passed, and the service refused silently | `SecurityService.assertNoEscalation` records `security.authorization.denied` with the attempt, then rethrows |
| The `accountGrant` field restriction required the same permission as its own route guard, so it could never trigger — and the router never applied it | The denial list now requires `security.grant.assign`; `GET` applies `restrictDocument` |
| Cross-module imports in the new integration test broke the ADR-0001 boundary | Import through `../audit` only; the lint rule caught it |

### Not done, deliberately

No authentication (`SEC-010`–`SEC-022`), no approval engine, no notifications, tasks, documents, search, or
import. The **production actor resolver returns no actor**, so every protected endpoint answers `401` until
`SEC-013` lands. Integration tests inject their own resolver that reads an account id from a header and then
resolves grants from the database: a fixture for exercising authorization, **not** authentication, and not
compiled into the application.

## Recently completed — 2026-09-21 (identity and authentication)

Bounded group: `SEC-010` and `SEC-011`–`SEC-022`. Nothing outside it was implemented.

**`SEC-010` is not an identity requirement.** The registry defines it as the privilege-escalation **test
suite** (MM §13), in the general security block. It was implemented as registered — a dedicated suite — not
reinterpreted as a feature.

### What exists

| Piece | Where | What it guarantees |
|---|---|---|
| Accounts | `apps/api/src/modules/identity/model.ts` | `securityAccounts`: credentials, lifecycle, second factor, and an **opaque** employee reference. Unique normalized identifier; one live account per employee (partial index). No deletion |
| Lifecycle | `…/identity/service.ts` | `invited` → `active` → `suspended` → `terminated`, compare-and-set on the current state so a concurrent transition loses rather than overwrites |
| Passwords | `packages/security/src/credentials/passwords.ts` | Argon2id (m=19456, t=2, p=1), PHC format, transparent rehash when parameters rise, length-first policy, never trimmed, never logged |
| Tokens | `packages/security/src/credentials/tokens.ts` | Short-lived HS256 access token; 256-bit opaque refresh secret stored as a SHA-256 digest only |
| Sessions | `…/identity/model.ts`, `service.ts` | MongoDB rows with idle and absolute expiry and a revocation **reason**; rotation on refresh; replay revokes the whole family |
| Second factor | `packages/security/src/credentials/mfa.ts` | TOTP with the accepted step stored against replay; secret encrypted at rest; ten independently hashed single-use recovery codes |
| Throttling | `…/identity/throttle.ts` | Redis counters per address and per identifier, **every one with a TTL** |
| Cookie | `…/identity/cookies.ts` | `HttpOnly`, `SameSite=Strict`, path-scoped, `Secure` everywhere except development and test |
| Bootstrap | `scripts/bootstrap-admin.ts` | Runs once, refuses if any account exists, creates an `invited` account with **no password** |

Endpoints: 9 under `/api/v1/auth`, 6 under `/api/v1/me`, 11 under `/api/v1/security/accounts`. All 33
documented paths resolve in the generated OpenAPI document with zero broken references.

**Why revocation is immediate.** Every authenticated request re-reads the session and the account and
compares the token's credential generation with the account's, so suspension, offboarding, a password
change, and a permission change all take effect on the next request rather than at token expiry
([ADR-0023](decisions/adr-0023-password-hashing-and-session-tokens.md) §4).

### Decisions worth not reversing

- **Argon2id via `@node-rs/argon2`, not `argon2`.** The named package's install script runs `cross-env`,
  whose Windows shim breaks on the `&` in the repository path. Same algorithm, prebuilt binaries, no
  install script. A unit test asserts the stored value really begins with `$argon2id$` (ADR-0023 §1).
- **Password policy is length-first** (12–200, blocklist, no composition rules) per NIST SP 800-63B, and the
  raw password is never trimmed or normalized.
- **An access token is never trusted alone** — that is what makes `SEC-020` true.
- **Lockout is a TTL-bounded counter, never a stored state**, so no sequence of failures can make an account
  permanently unusable. `suspended` is the administrative decision.
- **The per-address sign-in budget is generous (120/15 min)** because a branch office behind one NAT shares
  an address; precision is the per-identifier rule's job.
- **No default administrator, no seeded role, no self-registration.**

### Defects this group's own tests found, and the fixes

| Found | Fix |
|---|---|
| An administrator could reset **their own** MFA or password through the administrative routes, skipping the re-authentication the self-service routes require — a way around `SEC-017` | `assertNotSelfAdministration`: suspend, offboard, password reset, and MFA reset are refused on the caller's own account and the attempt is recorded |
| A `429` from the authentication throttle carried no `Retry-After`, which invites an immediate retry loop | `AppError` gained an optional retry hint and the error pipeline sets the header |
| The per-IP sign-in budget (30/15 min) would lock out a whole office behind one NAT | Raised to 120 with the reason recorded; the per-identifier rule stays tight at 8 |
| `z.toJSONSchema` could not represent the login-identifier contract because it carried a `.transform` | Normalization moved to the service, which already did it at every entry point; the schema now only validates |
| The integration suites reached into the security module's internals to seed roles and grants (ADR-0001) | `bootstrapRole` / `bootstrapGrant` published by that module, documented as the unguarded bootstrap path used by the script and by fixtures, never by a router |

### Not done, deliberately

- **`SEC-033` (KMS) is not implemented.** Development and test encrypt MFA secrets with a configured local
  key; staging and production refuse that key and cannot store an MFA secret until the adapter exists.
- **Delivery** of invitation and reset tokens is `CORE-NOTIFY`. An administrator issues and hands over a
  reset token meanwhile; the self-service request answers identically for every identifier and returns
  nothing.
- **No authentication screens.** The registry rows for `SEC-011`–`SEC-022` describe mechanism, not UI, and
  the Phase 1 prompt names no login screen. This group is API-only.
- **Employee references are opaque** until `HR-EMP` (Phase 8); nothing validates them and nothing stores
  employee data.
- **Account administration has no organization scope**: account rows carry no branch, department, or team,
  so a team-scoped actor resolves to "no records" rather than a subset. Needs `CORE-ORG` and `SD-01`.

## Recently completed — 2026-09-21 (approval engine)

Bounded group: `APPROVAL-001`–`APPROVAL-007`. Nothing outside it was implemented.

**The engine is mechanism only.** No role, threshold, approver, operation type, or service-level target is
seeded: that content is `SD-02`, whose own entry says Phase 1 builds "the approval engine and
maker-checker enforcement as configuration, tested with fixture roles only". So this group was buildable
without deciding a business rule, and it decided none.

### What exists

| Piece | Where | What it guarantees |
|---|---|---|
| Policies | `apps/api/src/modules/approval/model.ts` | `approvalPolicies`, versioned. A published version cannot be edited through the API **or** the model |
| Conditions | `…/approval/rules.ts` | Exactly the seven axes Master Mapping §7 names; decimal-safe amounts with their currency; an ambiguous stage rule refused when the policy is written |
| Requests | `…/approval/service.ts` | An **opaque** source reference and a sanitized summary; the policy version is recorded and never re-evaluated |
| Decisions | `…/approval/model.ts` | `approvalDecisions`, append-only. A unique index on request + stage + approver is the concurrency control |
| Maker-checker | `…/approval/rules.ts` | A policy field, evaluated after authorization has already succeeded, so no permission bypasses it |
| Delegation | `…/approval/rules.ts` | Time-bounded, cycle-free, revoked rather than deleted, never widening the delegate's own authority |
| Escalation | `…/approval/service.ts` | Adds the direct manager to the pending approvers once a stage is overdue, idempotently |
| Atomicity | `apps/api/src/platform/transactions.ts` | Decision, stage counter, request state, and audit records commit together |

Endpoints: 16 under `/api/v1/approvals`. The generated OpenAPI document covers all of them with zero
broken references.

### Decisions worth not reversing ([ADR-0024](decisions/adr-0024-approval-engine.md))

- **Approving never executes the operation.** A request records a decision; the owning module observes the
  outcome and acts. That is what keeps one engine usable by every module — and it means a module that
  forgets to act leaves a visible approved request rather than a half-applied change.
- **A request is bound to the policy version it was submitted under.** Publishing a newer version never
  re-opens or retroactively satisfies an outstanding request.
- **"All" and "quorum" require an enumerated approver set.** Over a permission-based rule the count would
  change as grants change, so such a policy is refused at write time.
- **Maker-checker is configuration, never a code branch** — the registry's own words.
- **Concurrency is settled by a unique index**, not by application locking.
- **Escalation resolves the manager through a port.** With no reporting line configured, an overdue stage
  is reported as *unresolved* rather than escalated to an invented manager.

### A defect this group surfaced in already-shipped code

`PrivilegeEscalationError` built its reason from the **entire** list of permissions an actor lacked. With
the approval permissions added, that string passed the audit contract's 500-character limit, so
`AuditService.record` threw during validation — and `assertNoEscalation`'s blanket `catch {}` swallowed it.
The refusal still happened, but **the evidence of it was silently lost**, which is exactly what
`AUDIT-005` exists to prevent. Two fixes: the reason now names the first five and counts the rest, and the
swallow logs through an optional logger instead of discarding the error. A unit test asserts the reason
stays inside the contract's limit however many permissions are missing.

### Not done, deliberately

- **`APPROVAL-005` is `in-progress`.** The escalation mechanism is complete, tested, audited, and
  idempotent, but the **direct manager cannot be resolved** until `CORE-ORG` supplies the reporting line
  (Phase 2, `SD-01`). In the running system an overdue stage is reported as unresolved. The task half of
  that registry row is `CORE-TASK-003`.
- **`CORE-NOTIFY` and `CORE-TASK` are untouched.** The engine publishes a domain event after the
  transaction commits, through a port with nothing wired to it; a publication failure is logged and
  swallowed, because an approval must be correct with nothing listening.
- **No approval screens.** The registry rows describe mechanism, not UI.

## Macro Phase 1 — the demonstration slice (2026-09-22/23)

Approved by [ADR-0025](decisions/adr-0025-macro-delivery-phases.md) and bounded by
[ADR-0026](decisions/adr-0026-demonstration-mode-boundary.md).

**Read this first: none of it raises a requirement status.** The modules below are registered to
Phases 2–5. They are real code — persisted, permission- and scope-enforced inside the query,
transactional, audited — and they are still a slice, not the module. `docs/REQUIREMENTS.md` is
unchanged: no ID renamed, renumbered, merged or retired, and no status raised. Phase 1's gate is
still open, and no requirement is `verified`.

### What was built

| Work package | Commit | Contents |
|---|---|---|
| Governance | `b61b4df` | ADR-0025 (four macro phases), ADR-0026 (the demonstration boundary and its bilingual labels), macro-phase sections in `REQUIREMENTS.md`, `phases/README.md` and this file, `scripts/check-doc-links.mjs` + `check:links` added to `verify` |
| `CORE-ORG` minimum | `f16f8a0` | Legal entity → branch → department → team, job titles, placements with a cycle-free reporting line; `resolveManagerAccount` wired into the approval engine's escalation port |
| Inventory | `5b2d89d` | Projects, buildings, units, append-only unit events; a **conditional-update state machine** that names the state it read, so a unit cannot be sold twice |
| CRM | `a2d3ec6` | Customers, leads, activities; a pipeline whose backwards moves are allowed and whose terminal stages are not; duplicate phone is a **warning**, never a refusal |
| Sales | `4f42474` | Reservations, contracts, instalment schedules, atomic document numbering; discount approval submitted through the approval engine's port |
| Collections | `a514fb1` | Receipts with exact allocation, reversal instead of edit, cheques and promissory notes in custody, the reminder centre behind a `ReminderDeliveryAdapter` |
| Marketing | `56857f3` | Campaigns as **local drafts**: no publish route, no publish permission, no published state, `demoMetrics` never `metrics`, `providerConnected: false` on every response |
| Web application | `4806fef` | Sign-in with the second-factor step, the shell, and 20 lazily-loaded screens; route-level and vendor code splitting |
| Demonstration seed | `98f1003` | `npm run seed:demo` / `seed:demo:reset`, written through the product's own services as the seeded accounts; `platform/domain-services.ts` extracted so the seed and the API share one composition root |
| End-to-end suite | `5cf39b8` | 37 Playwright tests against the built web application, the built API, real MongoDB and real Redis |

### The demonstration journey, as it actually runs

Dashboard → lead → opportunity → unit → reservation → contract → instalment schedule → collection →
receipt → upcoming-instalment reminder. Two contracts exist with full schedules, six receipts are
allocated against them, two instalments are genuinely overdue, and two reminders fall inside the
fifteen-day window. One reservation carrying a 12% discount sits at **pending approval**, left
undecided on purpose so the live demonstration has something to decide.

### Honesty, enforced structurally rather than by labels

- **Marketing**: there is no publish route, no publish permission and no `published` state. A provider
  cannot be faked because there is nothing to fake it into.
- **Reminders**: `simulated` and `sent` are different states; nothing in the product can reach `sent`.
  `deliveryConnected: false` is on every response, and the simulated adapter throws outside
  development and test.
- **Figures**: campaign numbers are stored as `demoMetrics`, and the screens label them as such.
- **The sign-in screen itself** says the environment is a demonstration with fictional data.

### The seed

- Writes **through the guarded services, as the seeded accounts**: the representative raises the lead
  and the reservation, the manager confirms and signs, the collection officer takes the money. Every
  record therefore passed the same validation, permission check, scope filter, transaction and audit
  write an HTTP request would. The two exceptions are `bootstrapRole` and `bootstrapGrant`, the
  documented bootstrap path that `scripts/bootstrap-admin.ts` also uses.
- **Refuses** unless `APP_ENV` is development or test, the database name carries a development marker,
  and the host is local — three independent checks, 27 unit tests.
- **Idempotent** through `demoSeedLedger`: a second run creates nothing.
- Generates passwords per run into the ignored `.demo-credentials.md`. Nothing is printed or logged.
- Enrols a **real second factor** for the administrator account rather than exempting it from
  `SEC-017`, and records the authenticator secret in the same ignored file.
- `seed:demo:reset` requires `--confirm`, deletes only ledgered records and their ledgered children,
  leaves unrelated data alone (an integration run's leftovers survived a reset, as intended), and
  **never deletes the audit trail**.

### Defects this work found in already-shipped code, and the fixes

| Found | Fix |
|---|---|
| `buildInstallmentSchedule` placed instalment #1 one period *after* `firstDueOn`, contradicting the field's own documentation and making the 15-day reminder window find nothing | Corrected to `addMonths(firstDueOn, step × index)`; `downPaymentDueOn` added so a deposit is not dated a month after it was paid; `lastDueDate` fixed; unit tests added, including one asserting the two agree |
| `actOnReminder` treated **any** caller-supplied `reason` as a failure reason, so an explanatory note on a successful simulation silently stored the reminder as `failed` — a red row for something that worked | Only an adapter rejection produces a failure now; the caller's reason still reaches the audit record. Two integration tests cover both directions |
| `PhoneSchema` rejected a leading parenthesis | Widened, with a digit-count refinement that still bounds it |
| The integration tier and development shared one database, so seeded accounts made `createBootstrapAccount` conflict — and the tier's own cleanup wiped the demonstration data | The tier has its own database (`MONGODB_INTEGRATION_DB_NAME`); `dev:services:up` grants it and writes the name into `.env` |
| A dual `stylis` instance (4.4.0 via `stylis-plugin-rtl`, 4.2.0 inside `@emotion/cache`) crashed the RTL cache at runtime | Pinned to 4.2.0 with a root `overrides` entry. Latent and pre-existing, not introduced here |
| The E2E suite still tested the scaffolding page the demonstration screens replaced; 10 of its 14 tests had been failing since `4806fef` | Replaced with 37 tests against the real application |

### Recorded as debt rather than papered over

**A scope level applies to an account, not to a resource.** A unit has no assignee, so an
`assigned`-scoped sales representative correctly resolves to "no inventory" and can never reach the
unit they are trying to reserve. Per-representative lead privacy with readable inventory needs
**per-resource scope**, which does not exist. The demonstration roles use branch scope instead; giving
units a fake owner to work around it was refused.

### Not done, deliberately

- No Meta, WhatsApp, e-mail, SMS or payment-provider integration, and no account with any of them.
- No `CORE-NOTIFY`, `CORE-TASK`, `CORE-DOC`, `CORE-SEARCH`, `CORE-IMPORT`, `INTEGRATION-001`–`005`.
- No KMS adapter (`SEC-033`), so staging and production still cannot store an MFA secret.
- No hosted CI run verified — a remote now exists (owner push, 2026-09-24), but no workflow result has
  been observed from this machine.

## Verification — actual results, 2026-09-23 (end of Macro Phase 1)

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | ✅ 0 errors, 0 warnings |
| Format | `npm run format:check` | ✅ |
| Typecheck (strict) | `npm run typecheck` | ✅ root + 9 workspaces |
| Unit tests | `npm run test:unit` | ✅ **430 passed**, 22 files |
| **Integration gate** | `npm run test:integration:gate` | ✅ **337 passed, 0 failed, 0 skipped**, 13 files, exit 0 — real MongoDB and Redis, no mocks |
| **End-to-end** | `npm run test:e2e` | ✅ **37 passed, 1 skipped** — built web application + built API + real MongoDB + real Redis, desktop and mobile Chromium. The skip is the drawer-position assertion, meaningless on a phone |
| i18n keys | `npm run check:i18n` | ✅ Arabic and English complete |
| Secret scan | `npm run check:secrets` | ✅ 327 files, no credential patterns |
| Documentation links | `npm run check:links` | ✅ 50 files, 351 relative links, 0 broken |
| Production build | `npm run build` | ✅ web, api, worker |
| Bundle budget | `npm run check:bundle` | ✅ largest chunk **325.1 kB / 97.0 kB gzip** (budget 650 / 210) — under budget with 20 screens added, because of route and vendor splitting |
| Dependency audit | `npm run check:deps` | ✅ 0 vulnerabilities |
| Arabic PDF integrity | `sha256sum` | ✅ `89fade53…99f7b` — unchanged |
| Built API smoke | `node apps/api/dist/main.js` | ✅ ready with `transactions: true`; **98 OpenAPI paths, 0 broken `$ref`s**; `GET /me` and `GET /inventory/units` without a token → 401 |
| Seed idempotency | `npm run seed:demo` twice | ✅ second run created **0** records |
| Seed reset | `npm run seed:demo:reset -- --confirm` | ✅ removed only ledgered records; integration-test leftovers in the same database were **not** touched; audit trail retained |
| Hosted CI | `.github/workflows/ci.yml` | ⚠ defined, **never run** — no remote exists |

What the end-to-end tests prove, beyond that the pages render: signing in with a generated password
returns a session whose permission set actually changes what the server answers; a sales
representative is refused the marketing API **with their own captured access token**, from outside the
browser, while the same token still works for what they may do; the Alexandria project never leaves
the database for a New-Cairo-scoped account; instalments that are past due really read as overdue; the
reminder centre states that no provider is connected and never reaches the `sent` state; Arabic is
right-to-left with Alexandria and English is left-to-right with Inter, on the same screens; Light Mode
holds under a dark system preference; and money and dates render with Western digits in Arabic.

## Verification — actual results, 2026-09-21 (Phase 1 build half)

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | ✅ 0 errors, 0 warnings |
| Format | `npm run format:check` | ✅ |
| Typecheck (strict) | `npm run typecheck` | ✅ root + 9 workspaces |
| Unit tests | `npm run test:unit` | ✅ **363 passed**, 19 files |
| **Integration gate** | `npm run test:integration:gate` | ✅ **191 passed, 0 failed, 0 skipped**, 7 files, exit 0 — real MongoDB and Redis, no mocks |
| i18n keys | `npm run check:i18n` | ✅ |
| Secret scan | `npm run check:secrets` | ✅ 212 files, no credential patterns |
| Documentation links | link check over all Markdown | ✅ 44 files, 294 relative links, 0 broken |
| Production build | `npm run build` | ✅ web, api, worker |
| Bundle budget | `npm run check:bundle` | ✅ 589.9 kB / 187.1 kB gzip (budget 650 / 210) |
| E2E | `npm run test:e2e` | ✅ **14 passed** — 7 desktop-chromium + 7 mobile-chromium; every test starts in Arabic RTL, 2 per viewport also assert English LTR |
| Dependency audit | `npm run check:deps` | ✅ 0 vulnerabilities |
| Arabic PDF integrity | `sha256sum` working tree + committed blob | ✅ `89fade53…99f7b` — unchanged |
| Built API smoke | `node apps/api/dist/main.js` | ✅ starts, connects to Redis and MongoDB with transactions; 33 OpenAPI paths and 0 broken `$ref`s; `POST /auth/login` for an unknown account → 401; `GET /me` without a token → 401 |
| Hosted CI | `.github/workflows/ci.yml` | ⚠ defined, **never run** — no remote exists |

What the tests prove, beyond compiling: all 39 token pairs in use meet their WCAG thresholds and the ratios recorded in ADR-0005 are reproduced; lint rules fire on
fixtures (colors, physical CSS, dark mode, hard-coded text, module boundaries); secrets are redacted in
real log output; config errors never echo values; unknown fields are rejected; errors never leak
messages; locale and direction switch together with no mixed-language text; Alexandria and Inter
actually load; focus ring is 3px `#1D4ED8`; Light Mode holds under a dark system preference.

Added by this group, against **real MongoDB**: every mutating operation on an audit record is refused; a
mutation that records no audit event returns `500`; an out-of-scope record and an absent one produce
identical `404` bodies; a scoped total differs from the unscoped total on the same data (2 against 3); an
unsatisfiable scope returns nothing rather than everything; restricted fields are absent from list, single
read, and NDJSON export alike; keyset pages return each record exactly once; operator objects in filters and
in path parameters are rejected; self-grant, over-granting, and scope widening are refused and each refusal
is recorded; a grant written over HTTP changes the very next request's outcome, in both directions.

Added by the identity group, against **real MongoDB and Redis**: a wrong password and an unknown identifier
produce identical answers and comparable timing; an activation token works once and expires; a rotated
refresh token replays into a family-wide revocation; idle and absolute timeouts end a session while its
access token is still unexpired; suspension, offboarding, and a password change end a live session on the
next request; a TOTP code cannot be replayed and a recovery code works once; an MFA secret is stored as
ciphertext and appears in no audit record or log line; a privileged account cannot sign in without enrolling
a second factor, and a session created before the account became privileged loses its authority; every
throttle key carries a TTL and a successful sign-in clears the counter; 15 escalation attacks fail and leave
nothing changed.

Added by the approval group, against **real MongoDB**: a published policy version cannot be edited through
the API or the model; a request keeps the version it was submitted under even after a newer one is
published; an ambiguous policy is refused and stored nowhere; stage order is enforced and a later-stage
approver cannot act early; a quorum completes only at its threshold; one person cannot satisfy two stages;
self-approval is refused by default, permitted only with a reason when the policy says so, and not bypassed
by an administrative permission; two simultaneous approvals yield exactly one decision; a stale version is
refused; a replayed submission returns the original and a conflicting replay is a conflict; a delegate acts
only inside the window, only for the named policies, and never beyond their own authority; a cycle is
refused; an overdue stage escalates to the manager when one is resolvable and is reported as unresolved
when not; reassignment moves who is awaiting a decision and never alters one already recorded; a
cross-scope request is absent rather than forbidden; and every refused action leaves the stored state
untouched.

## Requirement status

### Phase 1 registry (113 IDs)

**`implemented` (106):** PLAT-001, 002, 003, 006, 008, 010, 011, 012, 013, 014\*, 015\*, 016\*, 021 ·
OPS-001, 002, 003 · TEST-001, 002†, 003 · SEC-001, 004, 007, 009 · I18N-001–009 (9) ·
THEME-001–012 (12; THEME-009 added 2026-09-28, UI redesign) · **AUDIT-001–006 (6)** · **SEC-023–032 (10)** ·
**SEC-002, 010, 011–022 (14)** · **APPROVAL-001–007 (7)** — `APPROVAL-005` added 2026-09-27 (F2) ·
**CORE-DOC-001** (F4) · **CORE-DOC-002, 004, 006** (F5) · **CORE-DOC-003, 005** (BMP-1 package 7) · **CORE-NOTIFY-001–005** (F6) · **CORE-TASK-001–005** (F7) · **CORE-SEARCH-001** (F8) · **CORE-IMPORT-001–002** (F9) · **INTEGRATION-001–005** (F10) · **INTEGRATION-006** (F12)

Per-ID evidence for the 16 added on 2026-09-21 is in `docs/REQUIREMENTS.md` → "Implementation evidence —
audit and authorization core". `AUDIT-005` covers permission, role, and scope changes and authorization
denials; its **authentication**-event half exists as a tested method that no flow calls yet (`SEC-013`).

\* **Now verified against real services** (integration tier, 2026-09-21): `PLAT-014` reports
`transactions: true` against `rs0`, `PLAT-015` answers `PING`, `PLAT-016`/`INTEGRATION-006` prove a
duplicate enqueue creates one job. † Local `npm run verify`; hosted CI never run.

`INTEGRATION-006` moved from `in-progress` to integration-verified behaviour (idempotent enqueue proven
against real Redis); it stays `in-progress` overall because the adapter registry it belongs to is not built.

**`in-progress` (7):** PLAT-007 (request, logs, jobs, **and audit** done; provider correlation waits for
adapters) · PLAT-017 (interface and policy; local development store; no S3 adapter) · SEC-003
(authentication endpoints throttled per address and per identifier; exports permission-checked, bounded
and audited since F9; no per-endpoint throttle on exports or provider-triggering endpoints) · SEC-005
(upload endpoints validate by magic bytes since F5; no malware scanner selected, files stay
`not_scanned`) · SEC-006 (env-only secrets; Secrets Manager not integrated) · SEC-008 (signed, expiring
links for the local store; no object-storage adapter) · SEC-033 (provider-neutral `Encryptor`; staging and
production **fail closed**; **no KMS adapter**, so they cannot store an MFA secret or a provider
credential)

`SEC-002` moved to `implemented`: cookie authentication now exists, and its protection is the
`SameSite=Strict` `HttpOnly` path-scoped cookie plus the origin guard. A double-submit token would add
nothing while both hold; it becomes necessary only if a cookie ever needs `SameSite=Lax`.

`APPROVAL-005` left `in-progress` on 2026-09-27: with the organization foundation (F2) an overdue
approval escalates through the real reporting line, and an unresolvable one is still reported as such.

**Not started (0).**

### Foundation additions (registered 2026-09-27, 17 IDs)

**`implemented` (17):** PLAT-022, PLAT-023, THEME-013 (F1) · CORE-ORG-001–006 (F2) · PLAT-024–026 (F3) ·
CORE-IMPORT-003 (F9) · OPS-004, OPS-005 (F11) · OPS-006, OPS-007 (F12)

**`approved`, not started (0).**

## Next exact task

**Current (2026-10-02):** Business Master Prompt 1 is complete (packages 1–8) and stopped for review —
see "Package 8" and its resume point above. Do not start Business Master Prompt 2 until instructed.

**Superseded (2026-09-28):** the foundation is complete and stopped at the foundation gate — see
"Foundation gate" and "Resume point" above.
The items below are the Macro Phase 1 list, kept for traceability; item 4's scope is now built.

1. **Macro Phase 1 is complete and the session stopped for review.** Do not begin Macro Phase 2, and do
   not start Phase 2 of the engineering plan, until instructed.
2. **To run the demonstration:** `npm run dev:services:up` → `npm run seed:demo` → `npm run dev:api` and
   `npm run dev:web`. Passwords are in the ignored `.demo-credentials.md`. The operational guide is
   [`demo/runbook.md`](demo/runbook.md); the Arabic presentation script is
   [`demo/walkthrough-ar.md`](demo/walkthrough-ar.md).
3. **What the stakeholder review has to decide**, because the answers change what is built next:
   - whether the journey matches how the client's sales floor actually works;
   - `SD-01` and `SD-02` — the real organization structure, roles, approval thresholds and
     segregation-of-duty rules. The demonstration's seven roles and its single 10% discount policy are
     **illustrative** and close neither decision;
   - `SD-20` — whether a WhatsApp Business account and an approved template set will exist, which is
     what the reminder centre is waiting for.
4. **The remaining Phase 1 scope**, in dependency order, unchanged: `CORE-NOTIFY-001`–`005` (which also
   unblocks invitation and reset **delivery** for `SEC-012` and `SEC-016`, and gives the approval
   engine's event port an implementation), then `CORE-TASK-001`–`005`, `CORE-DOC-001`–`006`,
   `CORE-SEARCH-001`, `CORE-IMPORT-001`–`002`, and `INTEGRATION-001`–`005`.
5. **`SEC-033` (the KMS adapter)** remains the blocker for MFA anywhere outside development.
6. To create a first account on an empty database without the demonstration data:
   `BOOTSTRAP_ADMIN_EMAIL=… npm run bootstrap:admin`. It prints an activation token and sets no password.

## Approved decisions

- Arabic-first; Arabic and English together. Alexandria / Inter, self-hosted.
- **Light Mode only** (`SD-13` closed). Tokens per ADR-0005; `tokens.ts` is the only file with color values.
- Primary `#2563EB`; hover `#1D4ED8`; pressed `#1E40AF`; soft `#EFF6FF`; soft-strong `#DBEAFE`; on-primary
  `#FFFFFF`; focus ring `#1D4ED8`.
- Modular monolith with lint-enforced boundaries (enforced and tested as of this commit).
- Server-side authorization inside queries; decimal-safe money; UTC storage; no hard deletes.
- **Meta: full Master Mapping scope** (`SD-14`); billing honesty per ADR-0011. **CAPI** optional, production
  delivery off by default (ADR-0017).
- **Dev infrastructure:** local Docker MongoDB replica set + Redis for development (ADR-0020); Atlas +
  managed Redis remain the staging/production direction (ADR-0018). No production credentials anywhere.
- Sources of truth: `CLAUDE.md`, this file, Master Mapping, Phase Prompts, approved ADRs. Arabic PDF supplementary.
- Requirement IDs: nine Phase 1 namespaces (ADR-0016); `SEC` / `CORE-ORG` / `HR-EMP` boundary (ADR-0019).
- **Western digits (0–9) in Arabic and English** (`SD-23`, ADR-0003); display only, storage language-neutral.
- Arabic PDF committed as a supplementary reference (`docs/source/`), never edited.
- **Audit integrity** (ADR-0021): append-only enforced in three application layers; the privileged-operator
  limit documented and **no cryptographic tamper-proofing claimed**; "every mutation is audited" asserted at
  runtime; keyset pagination; summaries only.
- **Authorization resolved per request** (ADR-0022): no permission cache, so `SEC-032` holds by
  construction. Adding a cache later needs a bounded TTL, explicit invalidation, a test, and its own ADR.
- Domain errors carry a **published stable code**; `ERROR_STATUS` in contracts is the single code → status
  map. A code outside the published list never chooses its own status. A throttled answer also carries
  `Retry-After`.
- **Passwords, tokens, and the second factor** (ADR-0023): Argon2id at the OWASP minimum through
  `@node-rs/argon2` with transparent rehash; a length-first password policy and no composition rules; a
  short-lived JWT access token that is **never trusted alone**; opaque rotated refresh tokens in a
  `SameSite=Strict` `HttpOnly` cookie with family revocation on replay; TOTP with a stored accepted step
  and independently hashed single-use recovery codes; TTL-bounded throttling that can never become a
  permanent lockout; no default administrator.
- Administrative account routes are **never** applied to the caller's own account: the self-service route
  asks for the password first.
- **Approval engine** (ADR-0024): mechanism only, with `SD-02` supplying the content. Approving records a
  decision and never executes the operation; a request is bound to the policy version it was submitted
  under; a published version is immutable; "all" and "quorum" require an enumerated approver set;
  maker-checker is a policy field rather than a code branch; decisions are append-only and concurrency is
  settled by a unique index; the decision and its audit records commit in one transaction; escalation
  resolves the direct manager through a port and reports *unresolved* rather than inventing one.
- Web bundle budget: ≤ 650 kB minified / ≤ 210 kB gzip per chunk; route splitting before feature-heavy phases.
- Git: local commits authorized. The owner added `origin` and pushes; **this workstream never pushes,
  never adds a remote, and never deploys.**

## Implementation notes a later session needs

### Added by Macro Phase 1

- **Domain services come from one composition root**, `apps/api/src/platform/domain-services.ts`. The
  API and the demonstration seed both build the graph from it. Wire a new module's ports there, not in
  `main.ts` — a second copy of the wiring drifts, and the seed would then write records the running
  application could not have produced.
- **The seed writes as the seeded accounts**, through the guarded services. If a seed step starts
  failing with a permission error, the answer is usually that the role in `scripts/seed-demo/roles.ts`
  is wrong, not that the seed needs a wider actor.
- **Collection names in the seed come from `scripts/seed-demo/collections.ts`**, which imports them
  from the owning modules. Never type one by hand: the ledger records a collection name, and the reset
  deletes from whatever that name points at — a wrong name makes the reset silently delete nothing
  while reporting success. This happened once and was caught only by checking the reset's output
  against the database.
- **The reset deletes only ledgered records and their ledgered children.** Anything created indirectly
  that is not reachable from a ledgered parent will survive a reset; add it to `DEPENDENTS` in
  `collections.ts` rather than deleting a whole collection.
- **`npm run seed:demo` re-establishes every password on each run** through the ordinary administrative
  reset flow, and re-enrols the administrator's second factor. That is what keeps
  `.demo-credentials.md` truthful; it is not a shortcut around the password policy.
- Receipts must be recorded against **`remainingAmount`**, not `amount`: the reservation deposit is
  already credited against the down payment by the time the contract exists, so paying the nominal
  amount over-allocates and the service correctly refuses it.
- `refreshInstallmentStates` is the sweep a scheduled job would run. Without it every instalment stays
  `upcoming` however long ago it fell due; the seed calls it, and so must anything that wants a
  realistic collections screen.
- `actOnReminder`'s `reason` is a note for the audit record. **Only an adapter rejection** marks a
  reminder `failed`. It used to treat any supplied reason as a failure, which turned a successful
  simulation red.
- **The integration tier has its own database.** `vitest.integration.config.ts` reads
  `MONGODB_INTEGRATION_DB_NAME` and falls back to `MONGODB_DB_NAME`. On a machine provisioned before
  this change, re-run `npm run dev:services:up` once — otherwise the tier runs against the development
  database and its cleanup deletes the demonstration data.
- **Playwright starts the API as well as the preview server**, and the preview server proxies `/api`
  to it (`apps/web/vite.config.ts`). One origin has to serve both: the session cookie is
  `SameSite=Strict`, so across two origins the refresh never arrives.
- The E2E suite reads `.demo-credentials.md` and signs in through the real form. It never injects a
  session, and it captures a real `Authorization` header from a request the application made when it
  needs to prove the server refuses something.
- `getByRole('navigation')` matches **two** landmarks in the shell — the menu and the breadcrumb
  trail. Use `#app-navigation`, and open the drawer first on a phone (`mainNav` in `e2e/demo.ts` does
  both).
- `UNIT_PAGE_SIZE_MAX` is 100; asking for 200 is a `400`, not a truncated page.
- Restricted fields are **optional in the contract type**, not merely absent at runtime: `unit.basePrice`
  and `unit.currentPrice` are `Money | undefined` because an actor without `inventory.unit.viewPricing`
  genuinely receives a unit with no price. Handle the absence; do not assert it away.
- `scratch/` and `sandbox/` are ignored by Git **and** by ESLint. Throwaway probe scripts go there.

### From Phase 1

- **Path contains `&`.** npm's Windows `.cmd` shims break on it, so every script runs tools through
  `node scripts/bin.mjs <tool>`. Don't replace those with bare tool names. Moving the repository to a
  path without `&` removes the problem.
- Integration tests use the `.int-test.ts` suffix; unit tests `.test.ts`. The integration config loads `.env`.
- Start services with `npm run dev:services:up` (idempotent). It reuses `docker/dev.env` credentials, so
  deleting that file while the volumes exist orphans the MongoDB users — remove the volumes too for a clean
  start. `down` never deletes volumes.
- `scripts/dev-services.mjs` assembles connection user-info separately from the scheme so no source line
  spells `scheme://user:password@`, which keeps the secret scan strict rather than needing an exception.
- Internal packages ship TypeScript source (`exports: ./src/index.ts`); the API and worker production
  builds bundle them with esbuild and keep third-party dependencies external.
- `react-i18next` deliberately not used: `LocaleProvider` + `getFixedT(locale)` keeps language, direction,
  and theme in one state. i18next has no fallback language, so a missing key can never render English.
- Formatting: always through `createFormatters` (`packages/i18n`). It forces `-u-nu-latn`; `ar-EG` would
  otherwise produce Arabic-Indic digits. Dates are assembled as `dd/MM/yyyy` from timezone-resolved parts.
- Identifiers (phone, national ID, account/IBAN, unit code) are **never** reformatted: displayed verbatim
  inside `LtrIsolate`. Tested in `packages/ui/src/components.test.tsx`.
- Running `npm run format` and `npm run test:unit` in one chained command can make vitest collect a
  partial set while files are being rewritten. Run them as separate commands before trusting a count.
- The integration gate sets `ALOLA_REQUIRE_INTEGRATION_SERVICES=1` via `scripts/integration-gate.mjs`.
- MUI 9 removed `containedPrimary`-style override keys; use `styleOverrides.root.variants`.
- TypeScript is 6.0.3, not 7.x: typescript-eslint supports `<6.1`. jsdom is 29.1.1: 30.x needs Node ≥24.15.
- Playwright Chromium is installed under the user profile on `C:` (~115 MB).
- Mongoose rejects an inline nested object that also carries options such as `required`: it reads the option
  as another path ("`true` is not a valid type at path `required`"). Declare sub-schemas explicitly with
  `new Schema({...}, { _id: false })`, as the audit and security models do.
- With every field `immutable: true` **and** `strict: 'throw'`, editing a loaded audit document fails as a
  `StrictModeError` during validation, **before** the `pre('save')` hook runs. Both paths are refused;
  assert the refusal and the unchanged stored value rather than one specific error class.
- Type test helper overrides as the schema's **input** (`z.input<typeof Schema>`), not its output.
  `ScopeAssignment`'s reference arrays use `.default([])`, so the output type requires them and
  `{ level: 'all' }` will not typecheck against it.
- `req.params` values are `string | string[]` in Express 5. Validate path parameters with strict Zod
  schemas; never pass a raw param into a query.
- Tests obey the ADR-0001 module boundary too: reach another module only through its index (`../audit`),
  never `../audit/model`. The lint rule covers test files.
- The integration suites clean up with the raw driver, because the application has no delete path for audit
  records. That is the privileged path ADR-0021 documents as the residual risk, not a loophole.
- A new route that legitimately mutates nothing must call `markAuditExempt(res)`, or `assertMutationAudited`
  turns its success into a `500`. Domain mutations are never exempt.
- `argon2` (the npm package named in MM §4.3) **cannot be installed here**: its install script runs
  `cross-env`, whose Windows shim breaks on the `&` in the path. `@node-rs/argon2` is used instead, same
  algorithm, no install script (ADR-0023 §1).
- `@node-rs/argon2` exports `Algorithm` as an ambient const enum, which `verbatimModuleSyntax` cannot
  import as a value. The numeric variant is passed and a unit test asserts the `$argon2id$` prefix.
- A Zod schema with `.transform` **cannot** become a JSON Schema, and the OpenAPI document is generated
  from the contracts. Validate in the schema; normalize in the service.
- An account holding any administrative permission needs a second factor (`SEC-017`), so **every test
  fixture for an administrator must complete the enrol-or-verify flow** — a plain password sign-in returns
  `mfaRequired`, not a session. Advance the test clock by 31 seconds per code so a step is never reused.
- The integration suites send `X-Forwarded-For` with `TRUST_PROXY_HOPS: 1` so each logical client gets its
  own address; otherwise one shared loopback address spends the whole per-IP budget for the file.
- Sessions and tokens live in MongoDB with a `purgeAfter` TTL index; Redis holds only throttle counters.
  Deleting Redis data can never lock an account out.
- **Approval and audit history carry no TTL index.** Operational rows expire; business evidence does not.
- An audit `reason` is bounded at 500 characters by the contract, and `record` parses **before** its
  try/catch — so an over-long reason throws at validation, not as an `AuditWriteError`. Any caller that
  swallows audit failures must log, or the evidence disappears silently. This bit once: see the defect note
  in the approval group above.
- `AuditService.record` takes an optional `session`, so an audit write can join a caller's transaction.
- `withTransaction` may run its callback more than once (MongoDB retries transient errors), so the callback
  must not mutate anything outside the session.
- A vitest filter matches **every** file whose path contains it: `vitest run rules.test` also picks up
  `lint-rules.test.ts`. Check the per-file breakdown before trusting a count from a filtered run.
- Approval requests are the first records carrying organization references, so `team`, `branch`,
  `department`, `project`, and `legalEntity` scopes finally resolve to a real filter instead of failing
  closed. Expect scope tests elsewhere to keep failing closed until their module stores those references.

## Database state

- Schema version: 1 (audit records carry `schemaVersion`) · Migrations (OPS-004): one,
  `0001-foundation-baseline` (no-op), applied to the development and integration databases with the
  build-stable checksum `c7e83ede…9df83e` (2026-09-28)
- **Seed data: none in the product.** A fresh database still authenticates nobody and authorizes
  nobody: there is no default administrator, no seeded role, no seeded approval policy, and no
  self-registration. The demonstration data is written by `npm run seed:demo`, which **refuses to run
  outside a local development database** and is not part of the application.
- Collections: 57 product collections in the development database as measured on 2026-09-28 (plus
  `demoSeedLedger`), created explicitly by `apps/api/src/platform/indexes.ts` at startup
  (`autoIndex` is off); the full index list is in `architecture/security-model.md` §9. The Macro
  Phase 1 set of 31, kept for traceability:
  - security and platform (11): `auditEvents` (append-only), `roles`, `accountGrants`,
    `securityAccounts`, `authSessions`, `authRefreshTokens`, `accountTokens`, `approvalPolicies`,
    `approvalRequests`, `approvalDecisions` (append-only), `approvalDelegations`
  - demonstration slice (20): `orgLegalEntities`, `orgBranches`, `orgDepartments`, `orgTeams`,
    `orgJobTitles`, `orgPlacements`, `inventoryProjects`, `inventoryBuildings`, `inventoryUnits`,
    `inventoryUnitEvents` (append-only), `crmCustomers`, `crmLeads`, `crmActivities`,
    `salesReservations`, `salesContracts`, `salesInstallments`, `salesCounters`, `collectionReceipts`,
    `collectionInstruments`, `collectionReminders`, `marketingCampaigns`
- `demoSeedLedger` exists **only in a development database**. It is written by the seed, read by the
  reset, and belongs to neither the application nor any module.
- Session, refresh-token, and account-token rows carry a `purgeAfter` TTL index. Audit, approval and
  business history carry none: operational rows expire, evidence does not.
- The **integration tier has its own database** (`MONGODB_INTEGRATION_DB_NAME`, default
  `real_estate_erp_dev_int`). Sharing one with development meant the suites' unscoped totals counted
  seeded data, and their cleanup deleted it.
- Mongoose configured `strict: 'throw'`, `strictQuery: 'throw'`, `autoIndex`/`autoCreate` off.

## Integration state

| Integration | Status | Notes |
|---|---|---|
| MongoDB | **Running locally** (Docker `rs0`) | ADR-0020; readiness reports transaction support; audit and authorization collections in use |
| Redis | **Running locally** (Docker) | ADR-0020; rate limiting and BullMQ |
| AWS S3 / KMS | Interfaces only | Unconfigured implementations fail loudly |
| WhatsApp | **Adapter interface only.** `ReminderDeliveryAdapter` with a simulated implementation that refuses to run outside development and test, and reports `connected: false`. No account, no approved template, no provider selected (`SD-20`) |
| Meta / advertising platforms | **Not connected, and there is nothing to connect.** Campaigns are local drafts: no publish route, no publish permission, no published state, no external reference field (ADR-0026) |
| E-mail / SMS / payment gateway | Not started | Phase 3+ |
| Meta Conversions API | Not started | Optional; production delivery gated (ADR-0017) |

## Blockers

| ID | Blocker | Blocks |
|---|---|---|
| Phase 1 scope | 0 of 113 requirements not started; 7 in progress | **Phase 1 approval** (phase-gates §1) |
| Stakeholder gate | Written approval outstanding. The demonstration is now **buildable and runnable** — `npm run seed:demo` — but has not been given | **Phase 1 approval** |
| `SD-01`, `SD-02` | The real organization, roles, approval thresholds and segregation-of-duty rules. The demonstration seeds illustrative ones and closes neither | **Macro Phase 2** |
| `SEC-033` | No KMS adapter, so staging and production cannot store an MFA secret | Any environment beyond development |
| `SD-01`–`SD-12`, `SD-17`–`SD-21` | Open stakeholder decisions (17) | Their assigned phases — none blocks Phase 1 |

`D2` is **closed**: development services exist and the integration tier passes with zero skips.

## Risks and technical debt

| Item | Mitigation / next step |
|---|---|
| **A scope level applies to an account, not to a resource.** A unit has no assignee, so an `assigned`-scoped representative resolves to "no inventory" and can never reach the unit they are reserving | The demonstration roles use branch scope instead. Per-resource scope is Macro Phase 2 work; giving units a fake owner to sidestep it was refused |
| The demonstration seed and the integration tier write to the same MongoDB | They now use **separate databases**. An existing machine picks the second one up by re-running `npm run dev:services:up`. Before that separation, an integration run silently deleted the seeded demonstration data |
| The end-to-end suite needs the demonstration data and the generated credentials file | Run `npm run seed:demo` first. The suite says exactly that in its failure message rather than failing obscurely |
| The demonstration roles, the 10% discount threshold and the seeded approval policy are illustrative | They are **not** `SD-01`/`SD-02` and close neither. `scripts/seed-demo/roles.ts` says so at the top, and so does the runbook |
| Campaign figures are invented | Stored as `demoMetrics`, never `metrics`; labelled on screen; no provider is connected, and there is no publish operation to connect one to |
| `.demo-credentials.md` holds working passwords and an authenticator secret in plain text | Ignored by Git, written with restrictive permissions, never printed or logged, and deleted by the reset. It exists only on the machine that ran the seed |
| The demonstration contract preview could be mistaken for an approved contract | Labelled as a demonstration document on screen, and stated in the walkthrough's "what not to say" list. The real template is a stakeholder input |
| Hosted CI result never observed (remote exists since the owner's 2026-09-24 push) | Run `npm run verify`, the integration gate and E2E locally before each commit; confirm the workflow on GitHub when the owner next pushes |
| Secret scan is pattern-based, not a dedicated scanner | Add a dedicated scanner when CI exists |
| An ended manager leaves their direct reports without an escalation path until they are re-parented | Reported as *unresolved* by the sweep rather than skipped to the next level (CORE-ORG-005). A report of placements whose manager has ended is a small addition for Business Master Prompt 1 or HR |
| A module that forgets to act on an approved request leaves an approval that achieves nothing | Deliberate (ADR-0024 §2): the engine never executes the operation. Each consuming module needs its own test that it acts on the outcome |
| A permission-based approver queue is bounded at 200 candidates | Logged when it truncates; a permission held by thousands of accounts is not a work queue. Narrow the stage rule instead |
| **`SEC-033` (KMS) is not implemented**, so staging and production cannot store an MFA secret | Development and test use a configured local key, refused outside development. The KMS adapter is the blocker for enabling MFA anywhere real (ADR-0023 §6) |
| Invitation and password-reset **delivery** does not exist | `CORE-NOTIFY` exists since F6, but no e-mail or SMS provider is connected (BMP-5), so an administrator still issues and hands over the token; the self-service request reveals nothing |
| The password blocklist is a short built-in list, not a breach corpus | Replace with a checked corpus when one is available (`SD-18` operational scope); it is a data change, not a redesign |
| An account holding administrative permissions must carry an authenticator application | That is `SEC-017`. The administrative MFA reset exists as the recovery path and is itself audited and refused on the caller's own account |
| Audit retention and archival are not implemented; the collection grows without bound | Retention policy is `SD-18`/Phase 9. The existing indexes already support time-range scans |
| An operator with direct database access can still alter audit records | ADR-0021 §2 records this as an operational control — restricted database roles, append-only backups — not an application one |
| The test actor resolver could be mistaken for authentication | It exists only inside integration tests; the production default resolver returns no actor, and both are commented to say so |
| Bundle growth as screens are added | **Resolved for now**: route and vendor splitting since `4806fef`; largest chunk 325.1 kB / 97.0 kB gzip against the unchanged 650/210 budget, enforced by `check:bundle` |
| Local topology is a single-node replica set, so failover is not exercised | Accepted for development; staging on Atlas is multi-node (ADR-0020) |
| Docker Desktop + WSL 2 are now prerequisites for the integration tier | Documented in environments.md §5; unit tests, lint, typecheck and build still need no services |
| `C:` free space dropped from ~21 GB to ~17 GB during the session (not caused by this project's ~0.6 GB) | Re-check before large installs |

## Handoff summary — Macro Phase 1 (superseded by the foundation gate above, kept for traceability)

**Macro Phase 1 (Client Demo MVP) is built, green, and stopped for review.** Eleven local commits on
`main`, from the delivery rebaseline (`b61b4df`) to this documentation commit. Nothing is pushed,
nothing is deployed, and there is still no remote.

A person with Docker running can demonstrate the product in four commands:

```
npm run dev:services:up
npm run seed:demo          # passwords land in the ignored .demo-credentials.md
npm run dev:api
npm run dev:web            # http://localhost:5173, Arabic RTL
```

The journey is real: dashboard → lead → opportunity → unit → reservation → contract → instalment
schedule → collection → receipt → upcoming-instalment reminder. Every record was written through the
product's own services, with the same permission checks, scope filters, transactions and audit writes
an HTTP request would produce. Two contracts carry full schedules, two instalments are genuinely
overdue, two reminders fall inside the fifteen-day window, and one 12% discount sits at pending
approval, left undecided so the live demonstration has something to decide.

**What is deliberately not connected, and says so on screen:** Meta advertising, WhatsApp delivery,
and payment providers. Marketing campaigns are local drafts with no publish route, no publish
permission and no published state. Reminders reach `simulated` and can never reach `sent`. Campaign
figures are stored as `demoMetrics` and labelled as demonstration figures. The sign-in screen itself
states that the environment is a demonstration with fictional data. All of it is fictional: e-mail
addresses use the reserved `demo.invalid` domain, phone numbers are a synthetic series, and national
identifiers read `DEMO-NID-…`.

**Nothing about requirement status changed.** `docs/REQUIREMENTS.md` is untouched: no ID renamed,
renumbered, merged or retired; no status raised; no requirement `verified`. Phase 1's gate is still
open, 24 of its 113 requirements are not started, and **Phase 1 is not approved**. The demonstration
slice lives in modules registered to Phases 2–5 and does not make them `implemented` (ADR-0025).

Verification, measured on 2026-09-23: lint and format clean, strict typecheck across the root and
nine workspaces, **430 unit tests**, **integration gate 337 passed / 0 failed / 0 skipped** against
real MongoDB and Redis, **37 end-to-end tests** against the built web application and the built API,
i18n complete, secret scan over 327 files, 351 documentation links with none broken, production build
green, largest bundle chunk 325.1 kB (97.0 kB gzip) against an unchanged 650/210 budget, 0 dependency
vulnerabilities, the Arabic PDF byte-identical, and the built API serving 98 OpenAPI paths with no
broken references and answering 401 without a token.

Three defects in already-shipped code were found and fixed along the way: the instalment schedule
dated every instalment one period late, `actOnReminder` recorded a successful simulation as failed
whenever the caller explained why, and the integration tier shared a database with development and
was deleting the demonstration data through its own cleanup. Each has a test.

One thing is recorded as debt rather than worked around: **a scope level applies to an account, not to
a resource**, so per-representative lead privacy cannot coexist with readable inventory until
per-resource scope exists.

**Next:** the stakeholder review. `SD-01` and `SD-02` — the real organization, roles, approval
thresholds and segregation-of-duty rules — are what Macro Phase 2 needs, and the demonstration's seven
roles and single 10% discount policy close neither. `SEC-033` (the KMS adapter) still blocks MFA
outside development. Do not begin Macro Phase 2 until instructed.

Operational guide: [`demo/runbook.md`](demo/runbook.md). Arabic presentation script:
[`demo/walkthrough-ar.md`](demo/walkthrough-ar.md).

## Handoff summary — Phase 1 build half (superseded detail, kept for traceability)

Local commits: documentation baseline (`7a840b3`), Phase 1 scaffolding (`4c988db`), Phase 1 review decisions
(`4365775`), development services and the integration gate (`dfc0ac5`), the audit subsystem plus
authorization core (`3d6bdf1`), a MEMORY repair (`45f73ca`), identity and authentication (`2edc45e`), and
the approval engine added on 2026-09-21.

`APPROVAL-001`–`004`, `006`, and `007` are implemented with passing tests: versioned approval policies
whose published versions are immutable, requests bound to the version they were submitted under, ordered
multi-stage approval with quorum rules, maker-checker as configuration rather than a code branch,
append-only decisions whose concurrency is settled by a unique index, time-bounded delegation that never
widens authority, and reassignment of an offboarded approver's pending work. `APPROVAL-005` is
`in-progress`: escalation is built and tested but cannot resolve a direct manager until `CORE-ORG` exists.

`SEC-010` and `SEC-011`–`SEC-022` are implemented with passing tests: security accounts with an opaque
employee reference and no employee data, invitation and activation, Argon2id passwords with a length-first
policy, short-lived access tokens that are never trusted alone, rotated refresh cookies with family
revocation on replay, TOTP with replay protection and single-use recovery codes, device and session listing
with individual and bulk revocation, suspension and offboarding without deletion, immediate server-side
invalidation, personal-account uniqueness, and a 15-attack privilege-escalation suite. There is no default
administrator: `npm run bootstrap:admin` runs once and sets no password.

`AUDIT-001`–`006` and `SEC-023`–`032` are implemented with passing tests: an append-only audit store whose
immutability is enforced in three application layers and whose limits are documented rather than overstated,
a query and export surface that audits its own reads, and an authorization core that denies by default,
applies the data scope inside the query, strips restricted fields from every serialization path, answers
`404` rather than `403` for an out-of-scope record, refuses privilege escalation and records the attempt,
and takes effect on the next request with no cache to invalidate.

The full verification suite is green: format, lint, strict typecheck (root + 9 workspaces), **363 unit
tests**, **integration gate 191 passed / 0 failed / 0 skipped against real MongoDB and Redis**, i18n keys,
secret scan (212 files), documentation links, production build, bundle budget, **14 E2E tests** across
desktop and mobile in Arabic RTL and English LTR, and 0 dependency vulnerabilities. The built API starts and
answers `401` on both `/auth/login` for an unknown account and `/me` without a token. The Arabic PDF is
byte-identical (`89fade53…99f7b`). `.env` and `docker/dev.env` remain ignored and untracked.

**PHASE 1 IS NOT APPROVED.** 24 of 113 Phase 1 requirements are not started — `INTEGRATION`,
`CORE-NOTIFY`, `CORE-TASK`, `CORE-DOC`, `CORE-SEARCH`, `CORE-IMPORT` — 10 are in progress, no requirement
is `verified`, and the gate requires a stakeholder demonstration plus written approval. `SEC-033` (KMS)
remains unimplemented, which blocks MFA in staging and production, and `APPROVAL-005` waits on
`CORE-ORG`. Stopped for review of this group. Phase 2 not started. No remote, nothing pushed, nothing
deployed.
