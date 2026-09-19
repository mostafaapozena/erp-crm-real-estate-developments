# Open Stakeholder Decisions and Blockers

Last updated: 2026-09-19 (stakeholder decisions applied)

This register tracks decisions that are **not** the implementation team's to make: business rules,
approval thresholds, legal and accounting policy, provider selection, and brand assets. `CLAUDE.md`
prohibits inventing business, accounting, legal, tax, commission, approval, or Meta billing policies —
so each item below is a genuine dependency, not a formality.

`SD-01`–`SD-12` are adopted **verbatim** from page 21 of the Arabic business scope document
(`نقاط تحتاج اعتماد العميل`), so that ALOLA and the implementation team work from one list rather than
two. `SD-13` onward are additions arising from the discovery review and the technical baseline.

## How to read this register

- **First blocks** names the earliest phase that cannot proceed without the answer. Per the stakeholder
  instruction of 2026-09-19, a business decision is **not** a Phase 1 blocker unless it directly affects
  the platform foundation.
- **Phase 1 impact** states what the Phase 1 foundation does instead of guessing: it builds a
  *configurable* mechanism with test fixtures only, and seeds no business value.
- **Risk if assumed** states what breaks if the team guesses instead of asking.
- A requirement whose status is `blocked` in [../REQUIREMENTS.md](../REQUIREMENTS.md) must name its `SD-` ID.

## Phase assignment summary

| ID | Topic | First blocks | Phase 1 scaffolding blocked? |
|---|---|---|---|
| `SD-01` | Organizational hierarchy | Phase 2 | No |
| `SD-02` | Roles, permissions, thresholds, SoD | Phase 2 | No |
| `SD-03` | Unit statuses and holds | Phase 2 | No |
| `SD-04` | Lead distribution and ownership | Phase 3 | No |
| `SD-05` | Payment plans, discounts, penalties, refunds | Phase 2 | No |
| `SD-06` | Commission policy | Phase 8 | No |
| `SD-07` | Check and note custody | Phase 5 | No |
| `SD-08` | Accounting, tax, periods | Phase 6 | No |
| `SD-09` | WhatsApp templates, reminders, consent | Phase 3 | No |
| `SD-10` | Document templates and numbering | Phase 4 | No |
| `SD-11` | Legacy data | Phase 9 | No |
| `SD-12` | Undocumented exceptions | Each phase's discovery | No |
| `SD-17` | Logo and brand assets | Phase 4 | No — text placeholder in development only |
| `SD-18` | Hosting, backup, recovery | Phase 9 | No |
| `SD-19` | Meta Business ownership and assets | Phase 3 | No |
| `SD-20` | Provider selection | Phase 3 | No |
| `SD-21` | Timezone, fiscal calendar, working week | Phase 2 | No — configurable, placeholder `UTC` in development |

**No open item blocks Phase 1 scaffolding.** Each one does block its named phase, and must be answered
before that phase starts.

## Open items

### SD-01 — Organizational hierarchy
**Question:** Confirm the legal entities, branches, departments, teams, projects, and cost-center
hierarchy, including which entities are separate legal persons.
**Owner:** ALOLA business owner · **First blocks:** Phase 2 CORE-ORG
**Phase 1 impact:** None to scaffolding. The data-scope *vocabulary* (`self`, `assigned`, `team`,
`department`, `branch`, `project`, `legalEntity`, `all`) is fixed by MASTER-MAPPING §6; the actual hierarchy
*values* arrive in Phase 2.
**Risk if assumed:** Scoped records and cost-center allocation are built on this shape. Restructuring it
later means migrating every scoped record and re-deriving every financial report. **Status:** Open

### SD-02 — Roles, permissions, approval authority, thresholds, and segregation of duties
**Question:** Confirm the role list, what each role may do, **who approves each operation type**, the
monetary and percentage thresholds at which approval escalates, and the segregation-of-duties policy
(which pairs of duties one person may never hold).
**Owner:** ALOLA business owner with finance · **First blocks:** Phase 2 (first phase applying real roles,
price approval limits, and project-scoped approvals); every later phase thereafter
**Phase 1 impact:** None to scaffolding. Phase 1 builds the permission catalog mechanism, the approval
engine, and maker-checker enforcement as configuration, tested with fixture roles only. No business role
or threshold is seeded. The privileged-MFA role *categories* are already fixed by MASTER-MAPPING §6.
**Risk if assumed:** Approval thresholds and maker-checker rules are the primary financial control.
Guessed thresholds are either an unenforced control or an operational obstruction.
**Note:** The Arabic document (p17) gives approval *examples* per department; those examples are useful
but are not thresholds. **Status:** Open

### SD-03 — Unit statuses, hold duration, and return-to-sale rules
**Question:** Confirm the unit status list and Arabic labels, the temporary hold duration and extension
rules, and the clearances required before a cancelled unit returns to sale.
**Owner:** Sales and inventory owners · **First blocks:** Phase 2 INV-STATUS, INV-HOLD
**Risk if assumed:** Also resolves conflict **C-06** — the Arabic term `موقوفة` is ambiguous between a
timed hold (expires automatically) and a management block (requires a decision to lift). Building the
wrong meaning produces either units that silently return to sale or units stuck out of inventory.
**Status:** Open

### SD-04 — Lead distribution, customer ownership duration, and reassignment
**Question:** Confirm how leads are distributed, how long a salesperson owns a customer, what counts as
meaningful activity to retain ownership, and how ownership disputes and reassignments are resolved.
**Owner:** Sales management · **First blocks:** Phase 3 CRM-ASSIGN, CRM-OWNER
**Risk if assumed:** Ownership drives commission entitlement. A wrong rule creates disputes over money
and requires retroactive recalculation. **Status:** Open

### SD-05 — Payment plans, discounts, penalties, cancellation, and refunds
**Question:** Confirm the payment plan templates, discount authority limits, late-payment penalty and
waiver rules, grace periods, cancellation penalty calculation, and refund policy.
**Owner:** Commercial and finance owners · **First blocks:** Phase 2 INV-PLAN (payment-plan templates);
then Phase 4 SALE-DISCOUNT, SALE-CANCEL and Phase 5 COL-SCHEDULE
**Risk if assumed:** These are contractual terms with legal effect. Implementing a guessed penalty
formula produces incorrect customer liabilities. **Status:** Open

### SD-06 — Commission policy for employees and brokers
**Question:** Confirm eligibility conditions, collection thresholds that trigger entitlement, project and
unit specific rules, team and manager shares, applicable taxes and deductions, and reversal rules on
cancellation.
**Owner:** ALOLA business owner with HR and finance · **First blocks:** Phase 8 HR-COMM
**Risk if assumed:** Commission is employee compensation. Errors are both a payroll defect and an
employment-relations problem. **Status:** Open

### SD-07 — Check and promissory note cycle, custody, and storage
**Question:** Confirm the custody workflow, physical storage locations for originals, who holds custody at
each stage, handover/receipt minute formats, and the legal escalation path for returned instruments.
**Owner:** Finance and collections owners · **First blocks:** Phase 5 COL-CHECK, COL-NOTE
**Risk if assumed:** Also resolves gap **G-06**. These are negotiable instruments — physical custody
errors are direct financial loss. **Status:** Open

### SD-08 — Accounting, tax rules, and financial periods
**Question:** Confirm the chart of accounts structure, posting rules, fiscal calendar and period-close
policy, tax and withholding treatment, and whether ALOLA is subject to Egyptian e-invoicing obligations.
**Owner:** Appointed accountant — **must be formally appointed** · **First blocks:** Phase 6 entirely
**Risk if assumed:** Also resolves conflict **C-04**. Phase 6 cannot start without an authorized
accounting reviewer; the phase prompt makes this a precondition. **Status:** Open — appointment of the
reviewer is itself outstanding

### SD-09 — WhatsApp templates, reminder timing, and customer consent
**Question:** Approve the WhatsApp message template texts in both languages, confirm reminder timing
beyond the mandatory 15-day reminder, and confirm the customer opt-in/consent mechanism and wording.
**Owner:** Marketing and legal · **First blocks:** Phase 3 CRM-WA; then Phase 5 COL-REMIND
**Risk if assumed:** Templates require Meta approval before use, and messaging without valid opt-in risks
account penalties. The 15-day reminder is mandatory in both documents and is not in question — the
additional reminders and consent wording are. **Status:** Open

### SD-10 — Document templates, reports, and official numbering
**Question:** Approve templates for quotations, reservation forms, contracts, invoices, receipts, payment
vouchers, statements, custody minutes, handover minutes, and payslips; and confirm the official numbering
format per document type, project, and fiscal year.
**Owner:** ALOLA business owner with legal · **First blocks:** Phase 4 (first customer-facing documents)
**Phase 1 impact:** None to scaffolding. Phase 1 builds the numbering engine and template registry with a
configurable format and no official format seeded.
**Risk if assumed:** Numbering sequences cannot be renumbered retroactively — ADR-0009 prohibits reuse.
A wrong format is permanent in issued documents. **Status:** Open

### SD-11 — Legacy data to migrate
**Question:** Identify the existing files and systems holding customers, units, prices, contracts,
schedules, opening balances, vendors, and employees; their formats, quality, and authoritative owner.
**Owner:** ALOLA business owner with each department · **First blocks:** Phase 9 migration. Advisory input
to the Phase 2 and Phase 4 data models.
**Risk if assumed:** Legacy data shape frequently forces model changes. Discovering it late means
migrating twice. **Status:** Open

### SD-12 — Exceptional cases and special reports not yet documented
**Question:** Identify any operational exception, special approval case, or report required by a
department that neither document describes.
**Owner:** All department heads · **First blocks:** each phase's discovery, for that phase's domain
**Risk if assumed:** This is the client's own catch-all. Leaving it unanswered is the most common source
of late scope. **Status:** Open

### SD-17 — Brand logo and visual assets
**Question:** Provide the approved logo files (Arabic and English lockups, light-background variants,
vector source), favicon, and any usage constraints. Confirm the Arabic and English company name forms to
be used in documents and PDFs.
**Owner:** ALOLA business owner / brand authority · **First blocks:** Phase 4 customer-facing documents and
PDFs; production launch (Phase 9)
**Phase 1 impact:** **Non-blocking** (stakeholder decision, 2026-09-19). Development uses a clearly
labelled temporary **text** placeholder only. No logo is invented, redrawn, or permanently embedded; the
placeholder must never reach a customer-facing document.
**Status:** Open

### SD-18 — Hosting region, environments, backup, and recovery policy
**Question:** Confirm the hosting region and data-residency requirement, the environment set
(development, staging, production), backup frequency and retention, recovery-time objectives, and the
incident response and release policies.
**Owner:** ALOLA business owner / IT · **First blocks:** Phase 9 hardening and launch; must be answered
before any staging environment holds non-synthetic data
**Risk if assumed:** Data residency can be a legal requirement; discovering it after production data
exists forces a migration. **Status:** Open

### SD-19 — Meta Business ownership and production prerequisites
**Question:** Confirm Business Portfolio ownership, ad account IDs, Pages, Instagram accounts,
Pixels/Datasets, the current billing model and payment owner, the app-review owner, required permission
scopes, and which roles are authorized to create, approve, publish, and analyze campaigns.
**Owner:** ALOLA business owner / Meta administrator · **First blocks:** Phase 3 MKT-CONNECT, MKT-ASSET
**Risk if assumed:** Meta app review and asset access are lead-time items that gate Phase 3 regardless of
code readiness. With `SD-14` approving the full authoring scope, app review needs the broader write
permissions — so this lead time is now longer, not shorter. No secrets are to be recorded in this
repository — asset IDs only. **Status:** Open

### SD-20 — External provider selection
**Question:** Select the payment gateway, email provider, SMS provider, and confirm any telephony or call
recording requirement.
**Owner:** ALOLA business owner with finance · **First blocks:** Phase 3 notifications (email, SMS);
Phase 5 payment capture
**Risk if assumed:** Adapters isolate providers (ADR-0010), so selection can come late — but not after
the phase that needs it. **Status:** Open

### SD-21 — Organization timezone, fiscal calendar, and working week
**Question:** Confirm the organization timezone, fiscal year start, weekend days, public holidays, and
notification quiet hours.
**Owner:** ALOLA business owner with HR and finance · **First blocks:** Phase 2 (calendars, numbering by
fiscal year); then Phase 5 reminder scheduling and Phase 8 attendance and overtime
**Phase 1 impact:** None to scaffolding. `ORG_TIMEZONE` is a validated configuration value (any IANA
zone). Development uses the placeholder `UTC`, which is explicitly **not** a business decision.
**Risk if assumed:** Due-date, penalty, reminder, and attendance calculations all depend on the local
calendar. See [adr-0008-utc-storage-and-display-timezone.md](adr-0008-utc-storage-and-display-timezone.md).
**Status:** Open

## Closed items

| ID | Decision | Resolution | Date |
|---|---|---|---|
| `SD-13` | Dark Mode (conflict `C-01`) | **Approved and closed.** Light Mode only. No Dark Mode, System Mode, theme switching, or per-user theme preference. The Arabic PDF's Dark Mode statement is an older requirement superseded by the later stakeholder decision recorded in the Master Mapping. [ADR-0004](adr-0004-light-mode-only.md) | 2026-09-19 |
| `SD-14` | Meta campaign management scope (conflict `C-02`) | **Approved and closed.** The full Meta scope in `docs/MASTER-MAPPING.md` is the current requirement and supersedes the narrower Arabic PDF scope. Employees do not need routine Ads Manager access. Payment methods stay with an authorized account owner in Meta's own billing tools; no card/CVV storage; no unsupported Add Funds. [ADR-0011](adr-0011-meta-operating-boundary.md) | 2026-09-19 |
| `SD-15` | Meta Conversions API (conflict `C-03`) | **Approved — production activation gated.** Architecture and adapter are in scope; production event delivery is disabled by default and needs ten recorded preconditions before it is switched on. Does not block Phase 1 or the general Phase 3 architecture. [ADR-0017](adr-0017-meta-conversions-api-gated-activation.md) | 2026-09-19 |
| `SD-16` | Local development infrastructure | **Approved.** MongoDB Atlas development cluster; Redis through an adapter that accepts a managed development instance or an approved local instance; no Docker; no production credentials; no live service required for scaffolding. [ADR-0018](adr-0018-development-infrastructure-selection.md). *Provisioning* the cluster is a separate environment task (`D2` in `docs/MEMORY.md`). | 2026-09-19 |
| `SD-22` | Phase 1 requirement namespaces | **Approved.** Nine stable namespaces: `PLAT`, `I18N`, `THEME`, `SEC`, `AUDIT`, `APPROVAL`, `INTEGRATION`, `TEST`, `OPS`. [ADR-0016](adr-0016-phase-1-requirement-namespaces.md) | 2026-09-19 |
| — | Status of the Arabic business scope document | Supplementary client-facing business document, not a technical source of truth. Later written stakeholder decisions supersede conflicting PDF statements. [ADR-0013](adr-0013-arabic-scope-document-status.md) | 2026-09-19 |
| — | Primary brand colour and extended Light Mode token set | Approved. Recorded in [adr-0005-light-mode-design-tokens.md](adr-0005-light-mode-design-tokens.md), contrast verified. | 2026-09-19 |
| — | Git authorization | `git init`, `.gitignore`, and local commits authorized. No remote, no push, no deploy. [adr-0015](adr-0015-secrets-and-repository-hygiene.md) | 2026-09-19 |
| — | Whether missing Docker blocks Phase 1 | It does not. Scaffold without live services; fail safely. [adr-0012](adr-0012-local-development-infrastructure.md) | 2026-09-19 |
| — | Theme strategy (implementation) | Light Mode only. [adr-0004](adr-0004-light-mode-only.md) | 2026-09-19 |

## Summary

| Category | Count |
|---|---|
| Open, adopted from the client's own checklist (`SD-01`–`SD-12`) | 12 |
| Open, raised by discovery or the technical baseline (`SD-17`–`SD-21`) | 5 |
| **Total open** | **17** |
| Open items blocking Phase 1 scaffolding | **0** |
| Blocking an entire phase | `SD-08` blocks Phase 6 |
| Closed stakeholder items (`SD-13`, `SD-14`, `SD-15`, `SD-16`, `SD-22`) | 5 |
| Other closed decisions | 5 |
