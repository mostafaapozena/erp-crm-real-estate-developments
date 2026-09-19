# ALOLA ERP Claude Code Nine Phase Prompts

Version: 2.0

Use exactly one phase prompt at a time. Never combine phases or begin the next phase before the current gate is approved.

## Session bootstrap prompt

```text
Read CLAUDE.md and docs/MEMORY.md completely. Then read docs/MASTER-MAPPING.md and the full prompt for the current phase. Inspect repository structure, package manifests, configuration, Git status, schemas, migrations, integrations, and tests. Report the current phase, completed requirement IDs, in-progress work, blockers, documentation/code conflicts, uncommitted user work, and the exact next bounded task. Present the plan before modifying anything. Verify completion against code and tests, never documentation alone.
```

## Phase 1 Discovery, architecture, core, security, localization, and Light Mode

```text
Execute Phase 1 only for the ALOLA Real Estate CRM and ERP.

Read CLAUDE.md, docs/MEMORY.md, and docs/MASTER-MAPPING.md completely. Start with discovery and decision records. Do not invent business, accounting, legal, tax, commission, approval, or Meta billing policies.

Discovery:
1. Confirm the Arabic/English glossary and stable requirement IDs.
2. Map lead-to-contract, campaign-to-revenue, contract-to-collection, procure-to-pay, project execution, hire-to-payroll, and contract-to-handover.
3. Confirm legal entities, branches, departments, teams, projects, phases, buildings, floors, cost centers, warehouses, treasuries, and bank accounts.
4. Define entities, aggregates, identifiers, status machines, ownership, retention, audit, transactions, idempotency, and integration contracts.
5. Produce roles, permissions, field restrictions, data scopes, approval limits, delegation, and segregation-of-duties matrices.
6. Confirm environments, hosting region, backup/recovery, monitoring, incident, migration, and release policies.
7. Confirm Meta Business ownership, ad accounts, Pages, Instagram accounts, Pixels/Datasets, billing model, payment owner, permissions, app-review owner, and production prerequisites without storing secrets.

After discovery approval, build the TypeScript monorepo and modular-monolith foundation with React, Vite, Material UI, Node.js, Express, MongoDB, Redis, BullMQ, strict configuration, structured logs, correlation IDs, centralized errors, health checks, OpenAPI, tests, CI, and private-file abstractions.

Implement employee-linked identity, invitation/activation, login/logout, Argon2id, rotated secure sessions, password reset, privileged MFA, device revocation, suspension, roles, permissions, data scopes, field restrictions, server policies, audit, approval-engine foundation, notifications, tasks/calendar, integration registry, permission-aware search, and validated import foundation.

Localization/design:
- Arabic is default and RTL; English is LTR.
- Ship complete Arabic and English keys together and fail CI for missing keys.
- Use Alexandria for Arabic and Inter for English, locally hosted.
- Implement one centralized Light Mode only.
- Do not implement Dark Mode, System Mode, theme switcher, or theme preference.
- Implement the approved blue palette as centralized semantic tokens only: primary #2563EB, primary-hover #1D4ED8, primary-pressed #1E40AF, primary-soft #EFF6FF, primary-soft-strong #DBEAFE, on-primary #FFFFFF, and a visible focus ring derived from #2563EB.
- Use the primary blue for brand actions, links, selected navigation, active controls, and focus treatment. Keep success, warning, error, and information colors semantically distinct.
- Never hard-code these brand hex values inside components. Use theme tokens and verify default, hover, pressed, selected, focus, disabled, table, chart, text, icon, and border contrast against WCAG AA.
- Use logical CSS, responsive navigation, keyboard support, and loading/empty/error/forbidden/success states.

Implement validation, CORS, Helmet, CSRF where applicable, rate limits, secure cookies, secret management, encryption abstractions, private signed files, malware hooks, log redaction, and privilege-escalation tests.

Run lint, strict typecheck, unit/integration/security tests, production build, and Arabic RTL/English LTR Light Mode E2E smoke tests. Update docs/MEMORY.md with decisions, requirement status, results, blockers, and exact Phase 2 criteria. Stop for approval.
```

## Phase 2 Organization, projects, units, pricing, plans, and inventory

```text
Execute Phase 2 only after Phase 1 approval.

Read the mandatory project files and inspect current code. Preserve architecture, localization, permissions, audit, and Light Mode tokens.

Implement organization/master data for legal entities, branches, departments, teams, jobs, reporting lines, projects, phases, buildings, floors, cost centers, warehouses, treasuries, bank-account references, localized dictionaries, calendars, numbering, and project-scoped approvals.

Implement project/unit management: documents/media; hierarchy; unit code, type, activity, area, view, floor, finishing, parking/storage, attributes, attachments, and searchable metadata. Support available, internal hold, customer hold, reserved, contracted, blocked, cancelled-pending-release, and delivered.

Implement effective-dated/versioned prices, premiums, maintenance/services, payment-plan templates, eligibility, decimal-safe calculations, price history, approval limits, and controlled import/export.

Implement atomic timed holds with expiry, extension, release reason/approval, conflict detection, optimistic concurrency, distributed locks when justified, immutable history, and scheduled cleanup. A quotation never reserves inventory.

Build Arabic-first Light Mode screens for organization, project, unit list, inventory matrix, filters, comparison, availability, prices, holds, imports, and exports. Consume the approved blue semantic tokens from the shared theme; do not hard-code brand colors. Include complete Arabic/English keys, RTL/LTR tests, and contrast checks for interactive/table states.

Test concurrent holds/transitions, cross-project denial, field restrictions, price activation, calculations, import validation, audit, expiry, and scoped exports. Run lint, strict typecheck, tests, and production build. Update docs/MEMORY.md and stop for inventory/commercial approval.
```

## Phase 3 CRM, WhatsApp, Meta campaigns, leads, insights, and attribution

```text
Execute Phase 3 only after Phases 1 and 2 approval.

Read all mandatory files. Verify the current official Meta Marketing API version and capabilities before implementation. Use official APIs only. Never automate a browser, collect Meta passwords, expose tokens to the frontend, or claim unsupported billing functionality.

CRM:
1. Implement the unified customer with normalized phones, identity, preferences, consent, protected documents, duplicate candidates, approved merge, and immutable merge history.
2. Implement leads, multiple opportunities, pipeline transitions, manual/round-robin/rule assignment, absence handling, ownership/disputes/reassignment, calls, messages, notes, tasks, meetings, visits, requirements, unit matching, loss reasons, nurture, and SLA.
3. Implement official WhatsApp conversations with consent, approved templates, inbound/outbound status webhooks, retries, and unified timeline.

Meta connection/assets:
1. Build a server-side Meta adapter using official OAuth, encrypted minimum-scope tokens, token health, revocation handling, and API-version isolation.
2. Allow authorized admins to map permitted Business portfolios, ad accounts, Pages, Instagram accounts, Pixels/Datasets, forms, catalogs, and supported audiences.
3. Show asset access, permissions, token/webhook health, last sync, rate limits, and actionable errors without secrets.
4. Treat Business ownership, asset assignment, app setup/review, and payment-method configuration as authorized initial setup and document one-time Meta steps.

ERP campaign builder:
1. Create campaigns with objective, supported buying settings, special-ad-category controls where applicable, campaign budget mode, schedule, naming, and status.
2. Create ad sets with compatible conversion location/destination, optimization event, daily/lifetime budget, time, bidding, attribution, audience, location, age, language, exclusions, placements, and promoted object.
3. Create creatives with uploaded/reusable image/video, Arabic/English copy variants, headline, description, CTA, destination, UTM/tracking, Page/Instagram identity, and supported preview.
4. Create ads/variants and support draft, duplicate, edit, archive, publish, pause, resume, and sync where the current API permits.
5. Create/select supported Lead Ads instant forms with questions, privacy reference, consent, completion screen, validation, and delivery.
6. Implement supported saved/custom/lookalike/exclusion audiences only after policy, consent, hashing, and permission validation.
7. Hide or clearly disable controls unsupported for the connected account/API instead of failing silently.

Approvals/finance:
1. Separate campaign creator, content reviewer, budget approver, publisher, analyst, Meta admin, and finance permissions.
2. Implement draft -> content review -> budget review -> approved -> publish requested -> active -> paused/completed/archived, with rejection, revision, delegation, escalation, and immutable approval history.
3. A creator cannot approve budget or publish unless an explicit authorized policy permits it.
4. Implement internal budget requests, project/cost-center allocation, reservation, revision, variance, thresholds, and finance reconciliation.
5. Fund/Approve Campaign means internal authorization. Publishing applies the approved Meta campaign budget; Meta charges its previously configured method/balance.
6. Never store card/CVV/bank credentials or implement generic Add Funds/payment-method actions without a verified official capability separately approved for this exact account.
7. Show only billing/spend/limit information officially exposed. Surface payment failure/disabled account alerts and never fabricate wallet balances.

Capture/analytics/attribution:
1. Verify lead webhook signatures; store provider event IDs; fetch permitted lead data server-side; normalize/deduplicate; create/update CRM; attach campaign/ad set/ad/form; assign; notify.
2. Run scheduled incremental reconciliation for missed webhooks and provider/internal divergence.
3. Sync campaign/ad-set/ad status, review/rejection/delivery issues, budget, spend, impressions, reach, frequency, clicks, CTR, CPC, CPM, leads, CPL, messages, and supported conversions.
4. Build operator/management dashboards with account, project, campaign, ad set, ad, form, date, and owner filters plus data-freshness indicators.
5. Preserve original, first-touch, last-touch, and current-source attribution. Link to opportunities, visits, quotes, reservations, contracts, collections, revenue, CPL, CAC, and ROAS.
6. Implement consented Conversions API events for qualified lead, visit, reservation, contract, and payment only after legal-basis approval. Minimize/hash identifiers, deduplicate with event IDs, redact logs, retry, and dead-letter failures.

Reliability:
- Use idempotency, transactions, signed webhooks, queues, backoff, rate-limit handling, dead letters, provider request IDs, reconciliation, and audit.
- Validate objective, conversion location, optimization, destination, creative, form, audience, placement, and billing state before publish.
- Surface Meta policy, delivery, and billing outcomes honestly; never imply bypass.
- Enforce user, record, field, asset, account, project, and action permission server-side.

Use the approved blue theme tokens for campaign actions, links, selected navigation, filters, charts, and focus states while keeping delivery/rejection/budget statuses semantically distinct. Test unauthorized assets, separation of duties, overrun/reapproval, invalid combinations, publish/pause/resume, signatures/replay, duplicate leads, reconciliation, revoked tokens, rate limits, rejected ads, partial provider failures, freshness, attribution, CAPI deduplication, Arabic RTL, English LTR, Light Mode, blue-token contrast, responsive states, and audit.

Run lint, strict typecheck, unit/integration/contract/E2E tests, and production build. Update OpenAPI, runbooks, data dictionary, and docs/MEMORY.md. Stop for CRM, marketing, security, finance, and Meta UAT approval.
```

## Phase 4 Quotations, reservations, contracts, amendments, and cancellations

```text
Execute Phase 4 only after CRM, Meta attribution, and inventory approval.

Implement versioned quotations using effective unit prices/plans, decimal-safe calculations, parking/storage/maintenance/services, validity, discounts, approvals, localized secure PDF, delivery, and immutable history.

Implement reservations that atomically convert eligible holds, validate booking evidence without confirming collection, collect documents, enforce expiry/extension, generate numbered forms, and notify finance/contracts. Prevent concurrent double booking.

Implement parties, localized templates, legal/financial checklists, approvals, signed versions, activation, amendments, unit substitution, assignment/transfer, plan change, and controlled cancellation. Cancellation calculates approved penalties/refunds, reverses commissions when applicable, returns checks/notes through custody, and releases inventory only after required clearances.

Preserve Meta campaign/ad/form attribution through quotation, reservation, contract, cancellation, and revenue without overwriting original source.

Test Meta-attributed lead-to-contract, permissions, approvals, calculations, documents, concurrency, amendments, and cancellation rollback. Verify Arabic RTL, English LTR, Light Mode, approved blue tokens and interaction contrast, secure PDFs, and audit. Run all quality gates, update docs/MEMORY.md, and stop for commercial/legal/finance approval.
```

## Phase 5 Installments, collections, reminders, checks, and promissory notes

```text
Execute Phase 5 only after Phase 4 approval.

Implement contract-derived schedules, approved revisions, due dates, authorized grace rules, partial payments, overpayments, allocation priority, penalties/waivers, charges, receipts, statements, aging, and queues. Payment evidence is unconfirmed until authorized verification/reconciliation.

Implement idempotent reminders for mandatory 15 days before due date, optional 7-day and due-date reminders, and overdue escalation. Use official WhatsApp templates, consent, selected language, quiet hours, deduplication, retries, delivery/read/failure status, manual resend permission, and collector tasks. Stop reminders when confirmed allocation satisfies the due amount and safely reschedule after approved schedule changes.

Implement checks and promissory notes with physical custody, secure scans, numbers, amount, drawer/bank where relevant, maturity, storage location, handover, deposit/presentation, collection, return, replacement, renewal, cancellation, customer return, legal escalation, and acknowledgements. Never hard-delete.

Preserve campaign/sales attribution on collected revenue for ROI while restricting financial detail from marketing roles.

Test schedules, revisions, partial allocation, duplicate jobs, webhook replay, payment/reminder races, opt-out, language/direction, custody, permissions, Light Mode, approved blue tokens and contrast, audit, and recovery. Run quality gates, update docs/MEMORY.md, and stop for collections/finance approval.
```

## Phase 6 Accounting, invoices, treasury, banks, tax, assets, and budgets

```text
Execute Phase 6 only after approved accounting policies and assignment of an authorized accounting reviewer.

Implement chart of accounts, dimensions, periods, journals, posting, reversal, closing, customer/vendor subledgers, invoices, credit/debit notes, accruals, prepayments, treasuries, receipts/payments/transfers, bank accounts, deposits, fees, statement import, matching/reconciliation, unidentified receipts, facilities, loans, schedules, guarantees, fixed assets, depreciation, budgets, commitments, and variance.

Create configurable posting rules linking reservations, contracts, invoices, collections, refunds, procurement, payroll, commissions, campaign expenses, and adjustments to balanced entries. Use decimal-safe money, transactions, idempotency, immutable posting, reversals, locks, maker-checker, and sensitive-field protection.

Marketing reconciliation:
- Budgets by entity, project, campaign, channel, and cost center.
- Approved campaign budgets become commitments/reservations.
- Synchronize Meta actual spend and reconcile it with approval, provider statements/invoices when available, and accounting.
- Report approved/reserved/actual/variance, CPL, CAC, attributed contracts, collections, and ROAS using documented formulas.
- Alert on consumption, overrun, billing failure, disabled accounts, stale sync, and unexplained variance.
- Restrict payment instruments/bank/accounting details while giving marketing permissioned aggregates.
- Keep Meta payment-method setup/top-up provider-side unless an official account-specific capability is separately approved.

Prepare Egyptian tax and e-invoice/e-receipt adapters without claiming compliance until current requirements, certificates, registration, and accountant approval. Begin banks with statement import; do not execute transfers or store banking credentials without a separate official project.

Deliver trial balance, ledger, AR/AP aging, income statement, financial position, cash flow, liquidity, budget variance, marketing reconciliation, and project profitability. Test balanced entries, period controls, reconciliation, permissions, reversals, campaign commitment/actual matching, and attribution totals. Verify Arabic RTL, English LTR, Light Mode, approved blue tokens, table/chart differentiation, and contrast; run quality gates; update docs/MEMORY.md; stop for finance sign-off.
```

## Phase 7 Procurement, vendors, stores, contractors, and construction

```text
Execute Phase 7 only after inventory and finance foundations are approved.

Implement vendor onboarding, documents, evaluation, protected bank changes, purchase requests, budget checks, approvals, RFQ, comparison, purchase orders/amendments, receipt/inspection, invoices, three-way match, returns, payment requests, and statements.

Implement item catalog, units, project stores, opening balances, receipts, issues, transfers, returns, adjustments, counts, minimum levels, custody, and project/cost-center allocation.

Implement contractor contracts, BOQ, advances/recovery, retention, guarantees, progress certificates, deductions, engineering/finance approvals, milestones, schedules, daily reports, progress evidence, delays, risks, and change orders.

Test budgets/approvals, bank-change separation, matching exceptions, stock concurrency, negative-stock policy, certificate calculations, postings, permissions, Arabic RTL, English LTR, Light Mode, approved blue tokens and contrast, files, and audit. Run quality gates, update docs/MEMORY.md, and stop for procurement/construction/finance approval.
```

## Phase 8 HR, attendance, payroll, commissions, advances, and custody

```text
Execute Phase 8 only after identity and accounting approval.

Implement employee records, contracts, documents, placement, reporting lines, shifts, attendance, leave, overtime, exceptions, payroll components, earnings, deductions, statutory configuration, runs, approvals, payslips, bank export, and accounting posting.

Implement goals/reviews. Implement sales and broker commissions with configurable eligibility, collection thresholds, project/unit rules, team/manager shares, taxes/deductions, cancellation reversal, approval, payment, and transparent calculations. Implement advances/loans, repayment deductions, cash/asset custody, settlement, and exit clearance.

Enforce strict salary, identity, bank, attendance, and commission field access; maker-checker payroll; encrypted exports; audit; and log redaction. Validate statutory, tax, commission, and social-insurance rules with authorized stakeholders.

Test deterministic payroll/commissions, attribution where commission depends on source, cancellation/reversal, field permissions, Arabic RTL, English LTR, Light Mode, approved blue tokens and contrast, and posting reconciliation. Run quality gates, update docs/MEMORY.md, and stop for HR/finance approval.
```

## Phase 9 Handover, after-sales, analytics, migration, hardening, UAT, and launch

```text
Execute Phase 9 only after all enabled dependencies pass.

Implement readiness checklists, approvals, inspection/handover appointments, reminders, attendance, defects, photos, responsibility, deadlines, escalation, resolution verification, keys, meters, documents, signed handover, and delivered status.

Implement complaint/maintenance tickets with category, priority, SLA, assignment, escalation, timeline, attachments, resolution, reopening, and satisfaction. If separately approved, implement a secure customer portal limited to the authenticated customer's contracts, statements, documents, approved payment options, appointments, and tickets with strong verification, private files, rate limits, privacy, and audit.

Complete role dashboards and analytics for executives, marketing, sales, collections, finance, inventory, procurement, construction, HR, handover, and service. Verify/document every formula. Link Meta campaign/ad/form spend and leads to qualified opportunities, visits, quotations, reservations, contracts, collected revenue, CPL, CAC, and ROAS while enforcing finance restrictions.

Build migration tooling for customers, units, prices, approved campaign references, contracts, schedules, opening balances, vendors, employees, and approved legacy data with templates, dry-run, validation, deduplication, reconciliation totals, rollback, and signed reports. Never put production data in development.

Perform threat review, dependency scanning, authorization coverage, Meta/WhatsApp replay tests, integration failure/reconciliation drills, load tests, accessibility, Arabic RTL, English LTR, Light Mode, approved blue-token visual regression and WCAG AA contrast, responsive checks, backup restore, disaster recovery, monitoring, log redaction, retention, and runbooks.

Run role-based UAT across campaign creation/approval, lead receipt, sale, collection, accounting, execution, payroll, handover, and support. Resolve findings, freeze scope, validate staging migration, prepare rollback/incident plans, and train users. Do not deploy, publish production campaigns, charge payment methods, import production data, or launch without explicit authorization.

Update docs/MEMORY.md with versions, migration/verification evidence, Meta app-review status, residual risks, owners, backup status, and exact launch runbook. Stop for explicit production approval.
```

## Feature execution prompt template

```text
Implement only requirement IDs [REQUIREMENT_IDS] in Phase [PHASE_NUMBER].

Read CLAUDE.md, docs/MEMORY.md, relevant MASTER-MAPPING sections, and the full phase prompt. Inspect code, Git status, schemas, APIs, integrations, and tests. Confirm dependencies and present a bounded plan.

Outcomes:
- [OUTCOME_1]
- [OUTCOME_2]

Acceptance:
- [CRITERION_1]
- [CRITERION_2]

Include server-side authorization/data scope, field restrictions, validation, audit, idempotency/transactions where applicable, complete Arabic/English keys, RTL/LTR, Light Mode only, approved centralized blue tokens (#2563EB primary, #1D4ED8 hover, #1E40AF pressed, #EFF6FF and #DBEAFE soft backgrounds, #FFFFFF on-primary), responsive and all UI states, WCAG AA contrast, and tests. Never hard-code brand colors inside components. For Meta, verify official current capabilities, use the adapter, protect tokens, and never implement unsupported billing.

Run lint, strict typecheck, relevant tests, and production build. Do not push, deploy, publish production campaigns, change billing, or modify production data. Update docs/MEMORY.md with verified status, blockers, and next action.
```

## End of session handoff prompt

```text
Inspect Git diff/status and reconcile docs/MEMORY.md with the verified repository. Record complete/incomplete requirement IDs, modules changed, schema/migration/environment/integration changes, commands/results, failures, blockers, risks, and exact next action. Replace stale contradictions. Never store secrets, access tokens, payment credentials, or real customer/employee financial data. Do not claim any check passed unless it did.
```
