# ALOLA Real Estate CRM and ERP Master Mapping

Version: 2.0
Status: Approved implementation blueprint
Documentation language: English
Product default language: Arabic

## 1. Product mission

Build a secure Arabic-first real estate CRM and ERP for ALOLA Developments that connects marketing, Meta advertising, lead management, unit inventory, sales, reservations, contracts, installments, collections, accounting, banks, checks, promissory notes, procurement, construction, HR, payroll, handover, maintenance, and executive reporting in one auditable platform.

The continuous business record is:

`Meta Campaign -> Lead -> Opportunity -> Quotation -> Reservation -> Contract -> Installment Schedule -> Collection -> Accounting Entry -> Handover -> After-sales`

Employees perform authorized daily work from the ERP without routine access to Meta Ads Manager. Provider accounts may still require one-time owner setup outside the ERP when Meta does not expose an official API for that action.

## 2. Approved product decisions

1. Arabic is the default interface language.
2. Arabic and English are implemented together for every feature.
3. Arabic uses RTL and Alexandria; English uses LTR and Inter.
4. The application supports Light Mode only. Dark and System modes are out of scope.
5. The approved primary brand color is blue `#2563EB`, optimized for the Light Mode interface.
6. Users see only permitted modules, records, fields, actions, dashboards, and reports.
7. All integrations use official APIs; no browser automation or credential sharing.
8. Meta campaigns are created, reviewed, published, managed, and analyzed from the ERP through the official Marketing API.
9. An authorized owner configures Meta billing using Meta-supported tools. The ERP controls internal budget approval, campaign allocation, limits, monitoring, and reconciliation; it never stores card data or promises unsupported top-up.
10. Sensitive business mutations require authorization, audit, idempotency, and approval controls.
11. The initial architecture is a TypeScript MERN modular monolith.

## 3. Product principles

- One source of truth for every customer, unit, campaign, contract, payment, employee, and financial document.
- No hard-coded text, direction, presentation color, status label, approval limit, or financial rule.
- Server-enforced least privilege, data scopes, field security, and separation of duties.
- No double booking, collection, lead/webhook processing, or silent financial mutation.
- Configuration over code for workflows, statuses, templates, numbering, and policies.
- External providers are isolated behind versioned adapters with monitoring and retry controls.
- Every phase is independently testable, demonstrable, documented, and reversible.
- A feature is incomplete until Arabic, English, permissions, audit, and failure states pass.

## 4. Target architecture

### 4.1 Platform

- TypeScript monorepo with React/Vite web, Node.js/Express API, and background worker.
- Material UI with a shared design system.
- MongoDB Atlas or replica set with Mongoose strict schemas, indexes, and transactions.
- Redis for locks, caching, rate limits, and queues; BullMQ for reminders, provider sync, webhooks, and document jobs.
- Private AWS S3; AWS KMS and Secrets Manager for keys and secrets.
- REST API documented with OpenAPI.
- Domain-oriented modular monolith with explicit boundaries and contracts.

### 4.2 Suggested repository

```text
apps/
  web/
  api/
  worker/
packages/
  ui/
  i18n/
  contracts/
  config/
  security/
  testing/
docs/
  MEMORY.md
  architecture/
  decisions/
  phases/
```

### 4.3 Core libraries

- Material UI, TanStack Query, React Hook Form, Zod.
- i18next, react-i18next, Emotion RTL support, locale formatters.
- argon2, jose, Helmet, strict CORS, CSRF protection where applicable, rate-limiter-flexible.
- CASL or equivalent server-side authorization with database query scoping.
- BullMQ, Redis, Pino, Sentry, and AWS CloudWatch.
- Vitest, Supertest, Playwright, accessibility and integration contract tests.

Exact versions are checked, pinned, and recorded during Phase 1.

## 5. Localization, direction, typography, and Light Mode

### 5.1 Localization

- Arabic is the default and primary acceptance locale.
- Each change includes complete Arabic and English keys.
- APIs return stable codes; the frontend localizes labels and errors.
- User-entered names, notes, addresses, and documents are never machine-translated.
- Configurable translated labels store `{ ar, en }`.
- Missing keys fail development/CI checks instead of creating a mixed-language UI.
- Dates, numbers, money, percentages, plurals, notifications, exports, and PDFs are locale-aware.

### 5.2 Direction and typography

- Locale and root direction change atomically: Arabic RTL and English LTR.
- Use logical CSS properties. Mirror directional icons only.
- Mixed-direction fields such as phone, email, URL, code, and account number get explicit handling.
- Test navigation, forms, tables, dialogs, charts, PDFs, and print in both directions.
- Host Alexandria and Inter locally using only required weights.
- Embed Arabic-capable fonts in reports and PDFs.

### 5.3 Light Mode

- One centrally managed Light Mode theme; no switcher or per-user theme state.
- Approved primary palette tokens:
  - `primary`: `#2563EB`
  - `primaryHover`: `#1D4ED8`
  - `primaryPressed`: `#1E40AF`
  - `primarySoft`: `#EFF6FF`
  - `primarySoftStrong`: `#DBEAFE`
  - `onPrimary`: `#FFFFFF`
  - `focusRing`: derived from `#2563EB` with visible contrast on light surfaces.
- Semantic tokens also cover canvas, surface, elevated surface, primary/secondary text, border, success, warning, error, information, disabled, overlay, and chart series.
- Components consume tokens instead of arbitrary colors.
- Use primary blue for brand actions, links, selected navigation, active controls, and focus treatment. Do not use it as a substitute for success, warning, error, or informational status colors.
- All default, hover, pressed, selected, focus, disabled, table, chart, text, icon, and border combinations meet WCAG AA. Statuses include text/icon meaning and never depend on color alone.

## 6. Identity, permissions, and security

- Employee-linked accounts; invitation, activation, suspension, termination, password reset, and device/session management.
- Argon2id passwords; short-lived access tokens and rotated refresh sessions in Secure HttpOnly cookies.
- Mandatory MFA for privileged, Meta administration, payroll, treasury, banking, and finance approval roles.
- Permissions cover view, create, edit, submit, approve, reject, publish, pause, cancel, export, download, communicate, reassign, reconcile, post, and reverse.
- Data scopes cover self, assigned, team, department, branch, project, legal entity, and all.
- Field controls protect identity, salary, bank, balance, commission, credential, audience, and financial information.
- Maker-checker separation for campaign budgets, discounts, refunds, banks, payroll, and posting.
- Append-only audit includes actor, action, entity, before/after summary, reason, time, session/IP, correlation ID, and provider reference.
- TLS, validation, upload limits, malware hooks, encryption, private signed files, dependency scanning, backup restore tests, monitoring, and incident runbooks.
- Meta tokens are encrypted, server-only, minimally scoped, and revocable.

## 7. Organization and master data

- Legal entities, branches, departments, teams, jobs, reporting lines, and cost centers.
- Projects, phases, buildings, floors, warehouses, treasuries, bank accounts, and Meta asset mappings.
- Localized dictionaries for unit types, activities, sources, loss reasons, statuses, documents, payment methods, taxes, currencies, campaign objectives, and approval reasons.
- Numbering sequences by entity, project, document type, and fiscal year.
- Reusable approvals based on amount, percentage, role, project, department, risk, and exception.
- Timezone, fiscal periods, currency precision, calendars, and notification quiet hours.

## 8. Domain modules

### CORE Platform administration

- CORE-ORG organization and master data.
- CORE-USER employees, users, lifecycle, sessions, and devices.
- CORE-RBAC roles, permissions, fields, and data scopes.
- CORE-APPROVAL approvals, delegation, escalation, and separation of duties.
- CORE-AUDIT immutable operational/security history.
- CORE-NOTIFY in-app, email, SMS, and WhatsApp orchestration.
- CORE-TASK tasks, reminders, escalation, and calendar.
- CORE-DOC templates, numbering, PDFs, QR verification, and versions.
- CORE-INTEGRATION encrypted provider configuration, health, sync, and errors.
- CORE-SEARCH permission-aware global search.
- CORE-IMPORT validated Excel/CSV import with preview and error reports.

### INV Projects, pricing, and inventory

- INV-PROJECT projects, phases, buildings, floors, plans, media, and documents.
- INV-UNIT unit code, activity, type, area, view, floor, finishing, parking/storage, attributes, and attachments.
- INV-STATUS available, internal/customer hold, reserved, contracted, blocked, cancelled-pending-release, delivered.
- INV-PRICE effective/versioned price lists, premiums, discounts, maintenance, and services.
- INV-PLAN payment-plan templates, eligibility, and calculations.
- INV-HOLD timed holds, atomic conflict prevention, extensions, release approval, and history.
- INV-SEARCH availability matrix, filtering, comparison, and scoped export.

### CRM Customers, opportunities, and communications

- CRM-PERSON unified customer, phones, identity, preferences, consent, and protected documents.
- CRM-LEAD capture, source attribution, validation, deduplication, and qualification.
- CRM-OPP multiple project/unit opportunities per customer.
- CRM-PIPE configurable pipeline and controlled transitions.
- CRM-ASSIGN manual, round-robin, and rules-based assignment with absence handling.
- CRM-OWNER ownership rules, meaningful activity, disputes, and reassignment history.
- CRM-ACTIVITY calls, messages, emails, notes, tasks, meetings, and visits.
- CRM-MATCH requirements and unit matching.
- CRM-LOSS invalid/lost/on-hold reasons and nurture lists.
- CRM-WA official WhatsApp templates, consent, status webhooks, and timeline.
- CRM-REPORT response time, conversion, quality, attribution, and performance.

### MKT Meta campaign management

- MKT-CONNECT secure official OAuth connection and minimum permissions.
- MKT-ASSET mapping of authorized Business portfolios, ad accounts, Pages, Instagram accounts, Pixels/Datasets, forms, catalogs, and supported audiences.
- MKT-CAMPAIGN create, read, edit, duplicate, archive, pause, resume, and sync campaigns.
- MKT-ADSET objective-compatible destination, budget, schedule, audience, placements, optimization, bidding, attribution, and status.
- MKT-CREATIVE upload/reuse media, localized copy, headline, description, CTA, destination, tracking, and previews.
- MKT-AD create and manage advertisements and variants.
- MKT-LEADFORM create/select supported instant forms, questions, privacy/consent, completion, and delivery.
- MKT-AUDIENCE supported saved, custom, lookalike, and exclusion audiences subject to policy and consent.
- MKT-WORKFLOW draft, content review, budget review, approval, publish, reject, revise, pause, and archive.
- MKT-BUDGET internal requests, reservations, approval limits, project/cost-center allocation, and variance.
- MKT-SPEND spend, limits, supported billing information, thresholds, and finance reconciliation.
- MKT-INSIGHT impressions, reach, frequency, clicks, CTR, CPC, CPM, leads, CPL, messages, conversions, and spend.
- MKT-ATTRIBUTION campaign/ad/form to lead, opportunity, visit, quotation, reservation, contract, collection, and revenue.
- MKT-CAPI consented and deduplicated CRM/offline events through Conversions API.
- MKT-POLICY review status, rejection/delivery issues, provider errors, and actionable guidance.
- MKT-SYNC webhooks plus scheduled reconciliation, retries, rate-limit handling, and divergence reports.
- MKT-AUDIT full history of create, change, approve, publish, pause, and budget actions.

#### Meta operating boundary

- Authorized employees manage supported campaigns from the ERP; routine Ads Manager access is unnecessary.
- A Meta administrator initially owns/configures the Business Portfolio, ad account, Page, Instagram, app, asset access, and payment method.
- The ERP never stores Meta passwords, card/CVV, or online banking credentials.
- It cannot promise to add a payment method or top up Available Funds unless Meta officially enables that capability for the exact account.
- The ERP Fund/Approve Campaign action is internal budget authorization. Publishing applies the approved campaign budget; Meta charges its configured method/balance.
- Monthly invoicing or extended credit becomes a separate adapter only after eligibility and API access are verified.
- Meta remains authoritative for policy review, delivery, billing failure, and API limitations; the ERP displays these outcomes accurately.

### SALE Quotations, reservations, and contracts

- SALE-QUOTE calculations, versions, validity, localized PDF, and delivery.
- SALE-DISCOUNT permission limits and approvals.
- SALE-RESERVE hold conversion, booking evidence, documents, expiry, and forms.
- SALE-CONTRACT parties, templates, reviews, signatures, activation, and amendments.
- SALE-CHANGE unit substitution, assignment/transfer, and plan change.
- SALE-CANCEL penalties, refunds, commission reversal, paper return, clearance, and unit release.

### COL Installments and collections

- COL-SCHEDULE contractual schedules and approved revisions.
- COL-INVOICE customer charges and allocation.
- COL-RECEIPT cash, bank transfer, check, gateway, partial/overpayment allocation.
- COL-REMIND mandatory 15-day reminder, optional 7-day/due-date reminders, and overdue escalation.
- COL-CHECK incoming check custody, deposit, clearing, return, replacement, and legal workflow.
- COL-NOTE promissory-note custody, maturity, collection, renewal, return, and legal workflow.
- COL-STATEMENT customer, contract, unit, and aging statements.

### FIN Accounting, treasury, banks, tax, assets, and budgets

- FIN-COA chart of accounts and dimensions.
- FIN-GL journals, ledgers, posting, reversal, periods, and closing.
- FIN-ARAP customer/vendor subledgers.
- FIN-INVOICE customer/vendor invoices and credit/debit notes.
- FIN-CASH treasuries, receipts, payments, transfers, and reconciliation.
- FIN-BANK accounts, deposits, fees, statement import, matching, and reconciliation.
- FIN-FACILITY loans, facilities, schedules, and guarantees.
- FIN-BUDGET budgets by entity, project, department, campaign, and cost center.
- FIN-TAX configurable tax/withholding rules subject to authorized review.
- FIN-ASSET asset custody, depreciation, maintenance, transfer, and disposal.
- FIN-REPORT trial balance, statements, cash flow, aging, liquidity, and project profitability.

### PROC and CONST Procurement, stores, contractors, and execution

- PROC-VENDOR onboarding, protected bank changes, documents, and evaluation.
- PROC-REQUEST requests and budget validation.
- PROC-RFQ quotation requests and comparison.
- PROC-PO purchase orders, approval, changes, receipt, and closure.
- WH-ITEM catalog, units, batches where needed, and reorder levels.
- WH-TRANS receipt, issue, transfer, return, adjustment, count, and custody.
- CONST-CONTRACT contractor contracts, BOQ, advances, retention, and guarantees.
- CONST-CERT progress certificates, deductions, and engineering/finance approval.
- CONST-PROGRESS plans, milestones, reports, photos, delays, risks, and change orders.

### HR People, payroll, commissions, and custody

- HR-EMP employee profile, contract, documents, and placement.
- HR-TIME shifts, attendance, leave, overtime, and exceptions.
- HR-PAY payroll, earnings, deductions, statutory configuration, payslips, bank export, and posting.
- HR-COMM sales/broker commissions, eligibility, approval, reversal, and payment.
- HR-ADV advances/loans and payroll deductions.
- HR-CUSTODY cash/asset custody, settlement, and exit clearance.
- HR-PERF goals and reviews.

### HAND Handover and after-sales

- HAND-READY readiness checklist and approvals.
- HAND-APPT inspections/handover appointments and reminders.
- HAND-INSPECT defects, photos, responsibility, deadlines, escalation, and resolution.
- HAND-DELIVER signed handover, keys, meters, documents, and delivered status.
- CS-TICKET complaints/maintenance, SLA, escalation, resolution, and satisfaction.
- PORTAL-CUSTOMER optional secure portal for statements, documents, approved payment options, appointments, and tickets.

## 9. Cross-domain business rules

1. One customer may have multiple opportunities, units, and contracts.
2. Phone normalization and controlled matching prevent silent duplicates.
3. Unit status changes use atomic transactions and optimistic concurrency.
4. A quotation never reserves inventory.
5. Payment evidence is not a confirmed collection until authorized verification/reconciliation.
6. Contract activation creates approved schedules and idempotent accounting effects.
7. Cancelled inventory returns to sale only after all required clearances.
8. Checks and promissory notes preserve physical custody history and are never hard-deleted.
9. Payroll, bank, refund, price, discount, permission, and campaign-budget changes use maker-checker rules.
10. External events store provider IDs and reject duplicates.
11. Meta objects store internal/provider IDs, last sync, sync status, and error history.
12. Meta publishing requires valid assets, preflight validation, content approval, budget approval, and publisher permission.
13. Spend cannot exceed internal approval without reapproval even if Meta permits it.
14. Attribution preserves original, first-touch, last-touch, and current-source references.
15. Offline conversions require consent/legal basis, minimization, hashing, and event deduplication.

## 10. Integrations

- WhatsApp Business Platform Cloud API for templates, opt-in, status webhooks, and inbound messages.
- Meta Marketing API for campaigns, ad sets, creatives, ads, supported forms/audiences, insights, and status.
- Meta Lead Ads Webhooks and Meta Conversions API.
- Email, SMS, payment gateway, Egyptian e-invoice/e-receipt, bank import/API, and maps behind adapters.
- Store payment references/tokens only, never raw card/CVV.
- Start banking with statement import; direct execution needs separate official API authorization.

## 11. Dashboards and reporting

- Executive: sales, collections, liquidity, profitability, inventory, construction, marketing ROI, and exceptions.
- Marketing operator: delivery, spend, consumption, leads, CPL, rejected ads, sync issues, and approvals.
- Marketing management: channel/campaign comparison, qualified leads, bookings, contracts, collections, and ROAS.
- Sales: response time, pipeline, activities, visits, quotations, reservations, and contracts.
- Collections: due/overdue, reminders, checks, notes, and aging.
- Finance: cash, banks, AP/AR, reconciliation, campaign budgets, cash flow, and variance.
- HR: headcount, attendance, payroll, advances, commissions, and custody.
- Construction/procurement: progress, commitments, purchasing, stock, and certificates.
- Dashboards and exports enforce data/field scope and audit sensitive exports.

## 12. Nine-phase implementation plan

| Phase | Scope | Dependency | Exit result |
|---|---|---|---|
| 1 | Discovery, architecture, core, security, localization, and Light Mode design | None | Approved secure Arabic-first foundation |
| 2 | Organization, projects, units, pricing, plans, and inventory | Phase 1 | Controlled saleable inventory |
| 3 | CRM, WhatsApp, Meta campaign management, lead capture, insights, and attribution | Phases 1-2 | ERP-managed campaign-to-opportunity workflow |
| 4 | Quotations, reservations, contracts, amendments, and cancellations | Phases 1-3 | Auditable lead-to-contract workflow |
| 5 | Installments, collections, reminders, checks, and promissory notes | Phase 4 | Controlled contract-to-collection workflow |
| 6 | Accounting, invoices, treasury, banks, tax, assets, budgets, and marketing reconciliation | Phases 1 and 4-5 | Auditable finance workflow |
| 7 | Procurement, vendors, stores, contractors, and construction | Phases 1-2 and 6 | Project cost/execution control |
| 8 | HR, attendance, payroll, commissions, advances, custody, and performance | Phases 1 and 6 | Employee-to-payroll workflow |
| 9 | Handover, after-sales, portal, analytics, migration, hardening, UAT, launch, and operations | All enabled phases | Approved production release |

## 13. Phase gates

- Approved requirements and stakeholder demo.
- Passing lint, strict typecheck, tests, and production build.
- Server authorization, field security, data-scope, audit, and idempotency tests.
- Complete Arabic/English keys with no mixed-language UI.
- Arabic RTL, English LTR, Light Mode, responsive, keyboard, and contrast checks.
- Approved primary-blue token and interaction-state checks with no component-level hard-coded brand colors.
- Loading, empty, error, forbidden, success, and provider-failure states.
- Migration/rollback review where applicable.
- No unresolved critical/high security issue.
- Updated API/schema docs and `docs/MEMORY.md`.
- Explicit approval before the next phase.

## 14. Meta acceptance gate

- Connect only approved assets without exposing tokens.
- Create draft campaign, ad set, creative, supported lead form, and ad from the ERP.
- Separate content, budget, and publishing approvals.
- Publish, pause, resume, and edit supported settings from the ERP.
- Synchronize IDs, statuses, review results, errors, spend, and insights reliably.
- Verify/sign and deduplicate lead webhooks; recover missed events.
- Alert on consumption thresholds and billing/payment failure.
- Clearly distinguish internal funding approval from Meta payment configuration.
- Never display fake wallet/top-up capabilities.
- Trace campaign through lead, sale, collection, revenue, and ROAS.
- Audit every provider mutation and support error recovery.

## 15. Out of scope unless separately approved

- Dark Mode and System Mode.
- Direct bank transfer execution.
- Storage of Meta passwords, banking credentials, raw cards, or CVV.
- Generic Meta payment-method creation or Available Funds top-up without an official approved capability.
- Circumventing Meta policy, review, billing controls, permissions, or rate limits.
- AI-based legal/accounting decisions.
- Automatic contract signature without provider/legal approval.
- Hard deletion of audited or financial records.
- Microservices, native mobile apps, and multi-region active-active deployment in the initial release.
