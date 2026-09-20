# Arabic Business Scope Review — Gap and Conflict Report

Document ID: `DISC-001`
Status: Complete — awaiting stakeholder decisions
Date: 2026-09-19
Reviewer: Implementation team (Phase 1 discovery)

## 1. Purpose

This report records the review of the supplementary Arabic client-facing business scope document
against the technical sources of truth. It exists to satisfy the approved rule:

> Review the Arabic PDF during discovery and report any material business requirement that is
> missing from or conflicts with the Master Mapping. Do not silently override the Master Mapping.
> Any material conflict must be documented and presented for stakeholder approval.

Nothing in the Master Mapping has been changed as a result of this review. Every divergence below is
recorded as an open item for stakeholder decision.

## 2. Documents reviewed

| Role | Document | Version | Status |
|---|---|---|---|
| Supplementary business scope (client-facing) | [`docs/source/alola-client-business-scope-ar.pdf`](../source/README.md) (originally `نطاق_أعمال_نظام_شركة_العلا_للتطوير_العقاري.pdf`) | 1.0, September 2026 | `مسودة للمراجعة` — **draft for review, signature page blank** |
| Technical source of truth | `CLAUDE.md` | n/a | Active |
| Technical source of truth | `docs/MEMORY.md` | n/a | Active |
| Technical source of truth | `docs/MASTER-MAPPING.md` | 2.0 | Approved implementation blueprint |
| Technical source of truth | `docs/PHASE-PROMPTS.md` | 2.0 | Active |

The Arabic document is 22 pages and self-describes its own limits on its final page:

> "يعبر هذا المستند عن نطاق الأعمال المقترح، ولا ُيعد مواصفات تقنية أو جدوًلا زمنًيا أو عرًضا مالًيا نهائًيا."
> ("This document expresses the proposed business scope and is not a technical specification, a
> timeline, or a final financial offer.")

This is consistent with its designation as supplementary. See
[adr-0013-arabic-scope-document-status.md](../decisions/adr-0013-arabic-scope-document-status.md).

**Important:** the document is an unsigned draft. Its approval page (`اعتماد نطاق الأعمال`, p. 22) is
blank — no name, title, review status, or signature. It therefore carries no stakeholder authority yet,
which is a further reason not to let it override the Master Mapping.

## 3. Structural crosswalk

The Arabic document is organised into 15 numbered business sections (`القسم ٠١`–`القسم ١٥`) plus
cross-cutting chapters. They map onto Master Mapping domain modules as follows.

| Arabic section | Title (AR) | Title (EN) | Master Mapping modules | Coverage |
|---|---|---|---|---|
| القسم ٠١ (p4) | لوحة الإدارة الرئيسية | Executive dashboard | §11 Dashboards | Covered |
| القسم ٠٢ (p4) | هيكل الشركة والمستخدمون والصلاحيات | Org structure, users, permissions | CORE-ORG, CORE-USER, CORE-RBAC | Covered |
| القسم ٠٣ (p5) | المشروعات والوحدات والأسعار | Projects, units, prices | INV-PROJECT, INV-UNIT, INV-STATUS, INV-PRICE, INV-PLAN, INV-HOLD, INV-SEARCH | Covered |
| القسم ٠٤ (p6) | إدارة العملاء والمبيعات | CRM and sales | CRM-PERSON, CRM-LEAD, CRM-OPP, CRM-PIPE, CRM-ASSIGN, CRM-OWNER, CRM-ACTIVITY, CRM-MATCH, CRM-LOSS | Covered |
| القسم ٠٥ (p6) | التسويق والحملات الإعلانية | Marketing and ad campaigns | MKT-* | **Narrower than Master Mapping — see C-02** |
| القسم ٠٦ (p7) | عروض الأسعار والحجوزات والعقود | Quotations, reservations, contracts | SALE-* | Covered |
| القسم ٠٧ (p8) | الأقساط والتحصيل والتذكير | Installments, collection, reminders | COL-SCHEDULE, COL-INVOICE, COL-RECEIPT, COL-REMIND, COL-STATEMENT | Covered |
| القسم ٠٨ (p9) | الشيكات والكمبيالات | Checks and promissory notes | COL-CHECK, COL-NOTE | Covered — see G-06 |
| القسم ٠٩ (p10) | البنوك والخزائن | Banks and treasuries | FIN-CASH, FIN-BANK, FIN-FACILITY | Covered — see G-01, G-11 |
| القسم ١٠ (p11) | الفواتير والحسابات العامة | Invoices and general accounting | FIN-COA, FIN-GL, FIN-ARAP, FIN-INVOICE, FIN-TAX, FIN-REPORT | Covered — see G-04, G-12 |
| القسم ١١ (p12) | الميزانيات والمصروفات والأصول | Budgets, expenses, assets | FIN-BUDGET, FIN-ASSET | Covered — see G-02, G-07 |
| القسم ١٢ (p13) | المشتريات والموردون والمخازن | Procurement, vendors, warehouses | PROC-*, WH-ITEM, WH-TRANS | Covered |
| القسم ١٣ (p14) | المقاولون ومتابعة تنفيذ المشروعات | Contractors and construction | CONST-CONTRACT, CONST-CERT, CONST-PROGRESS | Covered — see G-13 |
| القسم ١٤ (p15) | الموارد البشرية والمرتبات والعمولات | HR, payroll, commissions | HR-* | Covered |
| القسم ١٥ (p16) | التسليم وخدمة ما بعد البيع | Handover and after-sales | HAND-*, CS-TICKET, PORTAL-CUSTOMER | Covered |
| Cross-cutting (p17) | الإشعارات والموافقات والمستندات | Notifications, approvals, documents | CORE-NOTIFY, CORE-TASK, CORE-APPROVAL, CORE-DOC | Covered — see G-03, G-04, G-05, G-09 |
| Cross-cutting (p18) | التقارير الرئيسية | Key reports | §11 Dashboards | Covered |
| Cross-cutting (p19) | الضوابط العامة وحماية المعلومات | General controls and data protection | §6 Security | Covered — see G-08, G-10 |
| Cross-cutting (p20) | مراحل التنفيذ المقترحة | Proposed implementation stages | §12 Nine-phase plan | **Different numbering — see C-05** |
| Cross-cutting (p21) | نقاط تحتاج اعتماد العميل | Points needing client approval | — | Adopted as the blockers register |

No Arabic business section is absent from the Master Mapping. All divergences are either depth
differences, wording differences, or scope expansions introduced by the Master Mapping.

## 4. Material conflicts requiring stakeholder approval

These were presented for decision. **All three were resolved by written stakeholder decision on
2026-09-19**; each entry below records its resolution. The original analysis is kept unchanged for
traceability.

### C-01 — Dark Mode is required by the Arabic document and prohibited by the technical baseline

**Severity: material. Blocks nothing today, but must be settled before UI work begins in Phase 1.**

- Arabic document, p3, general characteristics of all sections:
  "الوضع الفاتح والوضع الداكن مع وضوح النصوص والألوان في جميع الشاشات."
  ("Light Mode **and Dark Mode**, with clear text and colors on all screens.")
- `CLAUDE.md`: "Use the centralized Light Mode theme only; do not implement Dark Mode, System Mode,
  a theme switcher, or per-user theme preference."
- `docs/MASTER-MAPPING.md` §2.4 and §15: Light Mode only; Dark and System modes explicitly out of scope.
- The user's approved decisions in this engagement reaffirm Light Mode only.

This is a direct contradiction, not a depth difference.

**Recommendation:** keep Light Mode only and obtain written client acknowledgement that Dark Mode is
removed from the approved scope, recorded in the next revision of the Arabic document. Rationale: the
technical baseline, the approved extended token set, and all WCAG AA verification work are specified
for a single light palette; adding a second palette doubles the contrast-verification surface of every
component, table, chart, and status state. If the client insists on Dark Mode, it should be a separately
approved, separately estimated scope item scheduled after Phase 1, not an unstated assumption.

**Decision owner:** ALOLA business owner plus design authority. Tracked as `SD-13`.

**Resolution (2026-09-19):** `SD-13` approved and closed. Light Mode only; no Dark Mode, System Mode, theme
switching, or per-user theme preference. The PDF statement is an older requirement superseded by the later
stakeholder decision recorded in the Master Mapping.

### C-02 — Meta campaign management: the Master Mapping is substantially broader than the client document

**Severity: material. Affects cost, Meta app review, permissions, and legal exposure.**

The Arabic document (p6, القسم ٠٥) asks for campaign **measurement and linkage** only:

- link Facebook/Instagram campaigns and lead forms (`ربط حملات فيسبوك وإنستجرام ونماذج العملاء المحتملين`)
- leads entering the system with campaign, ad, and source name
- display budget, spend, reach, clicks, and lead count
- measure cost per qualified lead, per reservation, per contract, and sales value
- compare campaigns, projects, and periods; assess lead quality
- alert when lead intake breaks or sync fails

The Master Mapping (§8 MKT-*, §14) specifies a full in-ERP campaign management platform:
campaign/ad-set/creative/ad creation and editing (MKT-CAMPAIGN, MKT-ADSET, MKT-CREATIVE, MKT-AD),
publishing and pause/resume, instant lead form authoring (MKT-LEADFORM), custom and lookalike
audience management (MKT-AUDIENCE), a content/budget/publish approval workflow (MKT-WORKFLOW),
internal campaign budget control (MKT-BUDGET, MKT-SPEND), and a dedicated Meta acceptance gate (§14).

Everything in the Arabic document is a subset of the Master Mapping, so there is no contradiction —
but the Master Mapping commits the project to a much larger build than the client document describes.
That difference must be explicit before Phase 3 is planned, because it drives Meta app review,
permission scopes, and a significant share of total effort.

**Recommendation:** confirm the larger scope in writing, or agree a reduced Phase 3 scope
("measure and attribute only") with campaign authoring deferred. Do not begin Phase 3 planning until
this is settled. Note that the reduced scope removes the need for most Meta write permissions and
materially shortens app review.

**Decision owner:** ALOLA business owner plus marketing authority. Tracked as `SD-14`.

**Resolution (2026-09-19):** `SD-14` approved and closed. The full Master Mapping Meta scope is the current
requirement and supersedes the narrower PDF scope. Payment methods remain configured by an authorized
account owner in Meta's billing tools; no card/CVV storage and no unsupported Add Funds. See the status
update in [ADR-0011](../decisions/adr-0011-meta-operating-boundary.md).

### C-03 — Meta Conversions API / offline conversion upload is not requested by the client document

**Severity: material — data-protection and legal-basis implications.**

The Master Mapping specifies MKT-CAPI: "consented and deduplicated CRM/offline events through
Conversions API", and §9.15 requires "consent/legal basis, minimization, hashing, and event
deduplication". The Arabic document does not request this capability anywhere.

This feature sends hashed customer identifiers and business events (qualified lead, visit,
reservation, contract, payment) to Meta. It cannot be built on an implied requirement.

**Recommendation:** treat MKT-CAPI as opt-in, requiring documented legal basis and customer consent
language approved by the client before any implementation. Keep it out of the Phase 3 baseline unless
explicitly approved. This is already the Master Mapping's own position (§9.15, Phase 3 prompt item 6:
"only after legal-basis approval") — this entry records that the client document provides no mandate for it.

**Decision owner:** ALOLA business owner plus legal/data-protection reviewer. Tracked as `SD-15`.

**Resolution (2026-09-19):** `SD-15` approved as an optional, controlled integration. The adapter is built;
production event delivery is disabled by default until ten recorded preconditions are met. See
[ADR-0017](../decisions/adr-0017-meta-conversions-api-gated-activation.md).

### C-04 — Egyptian e-invoice / e-receipt integration is not requested by the client document

**Severity: moderate.**

The Master Mapping §10 lists "Egyptian e-invoice/e-receipt" among integrations, and Phase 6 prepares
adapters. The Arabic document (p11) asks only for
"الضرائب والخصومات والتأمينات وفق سياسة الشركة والمتطلبات المعتمدة"
("taxes, deductions, and insurance according to company policy and approved requirements") — it does
not name an e-invoicing integration or claim compliance.

The Master Mapping already qualifies this correctly ("Validate Egyptian requirements at implementation
time", "without claiming compliance until current requirements, certificates, registration, and
accountant approval"). No contradiction; recorded so the client is not assumed to have requested a
regulated integration.

**Recommendation:** confirm with the appointed accountant whether ALOLA is in scope for Egyptian
e-invoicing obligations and, if so, whether it belongs in Phase 6 or a separate compliance project.

**Decision owner:** appointed accountant. Tracked as `SD-08` (accounting policies).

### C-05 — Implementation stage numbering differs (11 client stages vs 9 engineering phases)

**Severity: low technically, high for communication. Two different numbering schemes in client and
engineering conversations will cause confusion at every gate.**

The Arabic document (p20) proposes a preliminary stage (`المرحلة التمهيدية`) plus stages 1–10.
The Master Mapping (§12) defines nine phases. The reconciliation is:

| Arabic stage | Arabic scope | Master Mapping phase |
|---|---|---|
| المرحلة التمهيدية | Approval of company procedures, permissions, forms, and reports | Phase 1 — discovery half |
| 1 | System foundation, users, permissions, interface | Phase 1 — build half |
| 2 | Projects, units, prices, payment plans | Phase 2 |
| 3 | Customers, sales, marketing, campaign linkage | Phase 3 |
| 4 | Quotations, reservations, contracts, cancellations | Phase 4 |
| 5 | Installments, collection, reminders, checks, notes | Phase 5 |
| 6 | Invoices, accounting, banks, treasuries, budgets | Phase 6 |
| 7 | Procurement, warehouses, contractors, execution | Phase 7 |
| 8 | HR, payroll, commissions, advances, custody | Phase 8 |
| 9 | Handover and after-sales | Phase 9 — delivery half |
| 10 | Data migration, testing, training, go-live | Phase 9 — launch half |

The schemes are compatible: the Arabic document splits Master Mapping Phase 1 into two stages and
Phase 9 into two stages. No scope is lost in either direction.

**Recommendation:** adopt the nine-phase engineering numbering as canonical for all delivery tracking,
and publish this crosswalk table in client-facing material so both parties refer to the same gates.
The crosswalk is maintained at [../phases/README.md](../phases/README.md). No stakeholder decision is
required beyond acknowledging the crosswalk.

### C-06 — Unit status vocabulary differs; `موقوفة` is ambiguous

**Severity: low, but it must be resolved before Phase 2 builds the status machine.**

Arabic document (p5): five statuses — `متاحة، موقوفة، محجوزة، متعاقد عليها، مسلمة`
(available, `موقوفة`, reserved, contracted, delivered).

Master Mapping INV-STATUS: seven statuses — available, internal hold, customer hold, reserved,
contracted, blocked, cancelled-pending-release, delivered.

The Master Mapping is a superset, so no requirement is lost. The risk is the Arabic term `موقوفة`,
which can mean either **on hold** (a timed sales hold, Master Mapping "internal/customer hold") or
**blocked/withdrawn from sale** (Master Mapping "blocked"). These are operationally different: a hold
expires automatically, a block requires a management decision to lift. The same Arabic word is used
on p4 of the executive dashboard section (`الموقوفة`) and again on p18 in the units report row.

**Recommendation:** confirm the Arabic label set with the sales and inventory owners and fix it in the
glossary before Phase 2. The glossary proposes `موقوفة مؤقًتا` for a timed hold and `محجوبة عن البيع`
for a management block. See [../glossary.md](../glossary.md).

**Decision owner:** sales and inventory owners. Tracked as `SD-03` (unit statuses and hold duration).

## 5. Requirements present in the Arabic document but not explicit in the Master Mapping

These are genuine coverage gaps. Each is proposed as a requirement with a stable ID and is registered
in [../REQUIREMENTS.md](../REQUIREMENTS.md) with status `proposed`. None has been implemented, and none
modifies the Master Mapping — they extend it, subject to approval.

| ID | Gap | Arabic source | Proposed module | Phase | Severity |
|---|---|---|---|---|---|
| G-01 | Outgoing bank transfer **request → review → approval → proof of execution** workflow, with no transfer executed by the system | p10: "طلبات التحويلات الصادرة ومراحل مراجعتها واعتمادها وإثبات تنفيذها" | FIN-CASH | 6 | Material |
| G-02 | General expense request workflow with attachments, approval stages, and spending limits (distinct from procurement requests) | p12: "طلبات مصروفات ومرفقات ومراحل اعتماد وحدود صرف" | FIN-CASH / CORE-APPROVAL | 6 | Material |
| G-03 | Per-document audit of **who printed or downloaded** each generated document | p17: "وتسجيل من قام بالطباعة أو التنزيل" | CORE-DOC / CORE-AUDIT | 1 | Material |
| G-04 | Approval-controlled **opening** of a financial period (not only closing) | p17 approval examples: "فتح فترة مالية" | FIN-GL / CORE-APPROVAL | 6 | Moderate |
| G-05 | Approval-controlled change of **beneficiary/payee data**, beyond vendor bank-account changes | p17 approval examples: "تعديل بيانات مستفيد" | FIN-CASH / CORE-APPROVAL | 6 | Material |
| G-06 | Explicit check/note custody state machine (`مستلمة، بالخزينة، خرجت للتحصيل، محصلة، مرتجعة، مستبدلة، مردودة`) plus numbered handover/receipt minutes (`محاضر تسليم واستلام`) | p9 | COL-CHECK, COL-NOTE, CORE-DOC | 5 | Material |
| G-07 | Budget alert when spending **approaches** the limit, not only when it is exceeded | p12: "تنبيه عند تجاوز الميزانية أو اقترابها من الحد" | FIN-BUDGET | 6 | Moderate |
| G-08 | Offboarding as one atomic workflow: suspend account, **terminate sessions immediately**, and transfer tasks and customers | p19: "إمكانية إيقاف حساب الموظف وإنهاء جلساته فوًرا مع نقل مهامه وعملائه" | CORE-USER, CRM-OWNER | 1 | Material |
| G-09 | Escalation of an overdue task **or approval** to the direct manager | p17: "تصعيد المهمة أو الموافقة للمدير عند التأخير" | CORE-TASK, CORE-APPROVAL | 1 | Moderate |
| G-10 | Explicit policy: every user has a personal account; **shared accounts are prohibited** | p19: "كل مستخدم يدخل بحساب شخصي، ولا ُتستخدم حسابات مشتركة" | CORE-USER | 1 | Moderate |
| G-11 | Book balances (`الأرصدة الدفترية`) and currency defined per treasury and bank account | p10 | FIN-CASH, FIN-BANK | 6 | Moderate |
| G-12 | Cost and profitability measured per project **and per phase** | p11: "قياس تكلفة وربحية كل مشروع ومرحلة" | FIN-REPORT | 6 | Moderate |
| G-13 | Subcontractor (`المقاولين الباطن`) contracts as a distinct tier under main contractor contracts | p14 | CONST-CONTRACT | 7 | Moderate |

Notes on near-misses that were assessed and judged **already covered**, recorded so the assessment is
not repeated:

- WhatsApp reminder at 15 days before due date with message status (sent/delivered/read/failed) and
  stop-on-payment — already COL-REMIND and Master Mapping §8 COL-REMIND; the mandatory 15-day rule is
  explicit in both documents.
- Minimum-stock alerts and prevention of undocumented issue — WH-TRANS.
- Fixed asset location, custodian, transfer, maintenance, depreciation, disposal — FIN-ASSET.
- No hard deletion of financial records, contracts, checks, and notes — Master Mapping §9.8, §15.
- Customer portal "later" — PORTAL-CUSTOMER is already marked optional in both documents.
- Multi-company / branch / subsidiary expansion — CORE-ORG legal entities.
- Role-specific dashboards per user — Master Mapping §11.
- Approval examples for sales, collection, finance, procurement, and HR (p17) — CORE-APPROVAL is
  configurable by amount, percentage, role, project, department, risk, and exception, which covers the
  listed examples; the specific thresholds are a stakeholder input, not a design gap (`SD-02`).

## 6. Client approval checklist adopted from the Arabic document

Page 21 of the Arabic document lists 12 points the client must decide (`نقاط تحتاج اعتماد العميل`).
These are adopted verbatim as the authoritative stakeholder blockers register and are tracked as
`SD-01`–`SD-12` in [../decisions/open-decisions.md](../decisions/open-decisions.md). Adopting the
client's own checklist rather than an invented one keeps both parties working from the same list.

## 7. Conclusion

- No Arabic business section is missing from the Master Mapping.
- One direct contradiction exists and must be resolved: **C-01, Dark Mode**.
- Two material scope expansions in the Master Mapping are not mandated by the client document and
  should be confirmed or reduced before their phases are planned: **C-02 (Meta campaign authoring)**
  and **C-03 (Conversions API)**.
- Thirteen requirements present in the Arabic document need explicit requirement IDs: **G-01**–**G-13**.
- The Master Mapping has not been modified.
- **Update 2026-09-19:** C-01, C-02, and C-03 are resolved by stakeholder decisions `SD-13`, `SD-14`, and
  `SD-15`. Later written stakeholder decisions supersede conflicting PDF statements
  ([ADR-0013](../decisions/adr-0013-arabic-scope-document-status.md) status update). The gap requirements
  remain `proposed` until their phases are elaborated.

## 8. Reproducing this review

The PDF is not readable by the repository tooling directly (no `pdftoppm`/poppler rendering available
in this environment). Text was extracted with:

```sh
pdftotext -enc UTF-8 -layout docs/source/alola-client-business-scope-ar.pdf scope.txt
```

Page references above are the printed page numbers in the PDF footer.
