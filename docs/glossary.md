# Arabic / English Glossary — المصطلحات العربية والإنجليزية

Version: 1.0 · Date: 2026-09-19 · Status: Proposed — pending stakeholder confirmation

## Purpose

One approved term per concept, in both languages. This matters more here than in a monolingual product:

- Arabic is the default interface language, so the Arabic term is what most users actually read.
- Translation keys are semantic, and the label behind each key must be consistent across every screen,
  document, notification, and PDF.
- The Arabic business scope document and the technical documents sometimes use different words for the same
  concept — and, in one case, the same word for two different concepts (see `موقوفة` below).

**Terms marked 🔶 need stakeholder confirmation.** Where the Arabic business scope document uses a term, it
is shown as the client's own usage and is preferred unless it is ambiguous.

## 1. Organization — الهيكل التنظيمي

| English | Arabic | Definition |
|---|---|---|
| Legal entity | كيان قانوني | A separately incorporated company. The outermost data-scope boundary. 🔶 `SD-01` |
| Branch | فرع | An operating location within a legal entity |
| Department | إدارة | An organizational function (sales, finance, HR) |
| Team | فريق | A group within a department, typically under one manager |
| Cost center | مركز تكلفة | The dimension financial transactions are allocated to |
| Project | مشروع | A real estate development |
| Project phase | مرحلة المشروع | A delivery stage within a project. Distinct from an **implementation phase** below. |
| Building | مبنى | A structure within a project |
| Floor | دور | A level within a building |
| Treasury | خزينة | A cash-holding location |
| Warehouse / store | مستودع / مخزن | A materials-holding location |
| Reporting line | التسلسل الإداري | Manager relationship, used for approval escalation |

> **Terminology hazard:** "phase" means two different things. `مرحلة المشروع` is a construction stage;
> `مرحلة التنفيذ` is a software delivery phase. Never render both as a bare "phase" / "مرحلة" in the UI.

## 2. Identity and access — الهوية والصلاحيات

| English | Arabic | Definition |
|---|---|---|
| User | مستخدم | An employee with system access. Personal accounts only; shared accounts prohibited (`G-10`) |
| Role | دور | A named bundle of permissions |
| Permission | صلاحية | Authority to perform one verb on one entity type |
| Data scope | نطاق البيانات | Which records an actor may see — `self`…`all` |
| Field restriction | تقييد الحقول | Fields removed from the response for unauthorized actors |
| Approval | اعتماد / موافقة | An authorization decision recorded against a document |
| Maker–checker | فصل المنشئ عن المعتمد | The creator of a record may not approve it |
| Segregation of duties | فصل المهام | Duties one person may never hold together |
| Delegation | تفويض | Temporary transfer of approval authority |
| Escalation | تصعيد | Raising an overdue task or approval to the manager (`G-09`) |
| Audit trail | سجل التدقيق | Append-only record of who did what, when |
| Session | جلسة | An authenticated login, individually revocable |
| Suspension | إيقاف الحساب | Access withdrawn without deleting history |

> `اعتماد` and `موافقة` are both used for "approval". Recommendation: `اعتماد` for the formal act that
> commits the document, `موافقة` for an intermediate consent step. 🔶 `SD-02`

## 3. Inventory — المخزون العقاري

| English | Arabic | Definition |
|---|---|---|
| Unit | وحدة | The saleable asset |
| Unit code | رقم الوحدة | Human-facing unit identifier |
| Unit type | نوع الوحدة | Apartment, villa, shop, office… |
| Activity | النشاط | Residential, commercial, administrative |
| Area | المساحة | Unit area |
| View | الإطلالة | Outlook, priced as a premium |
| Finishing | التشطيب | Finishing level |
| Parking space | جراج / موقف | Linked parking |
| Storage room | مخزن الوحدة | Linked storage. Note: distinct from a materials `مستودع` |
| Price list | قائمة أسعار | Versioned, effective-dated prices |
| Premium | فرق سعر | Price adjustment for floor, view, or attribute |
| Payment plan | نظام سداد | Down payment and installment structure |
| Down payment | المقدم | Initial payment |
| Maintenance charge | وديعة الصيانة | Maintenance deposit or charge |
| Availability matrix | مصفوفة الإتاحة | Grid view of unit availability |

### Unit statuses — حالات الوحدة 🔶 `SD-03`

| English | Proposed Arabic | Meaning |
|---|---|---|
| Available | متاحة | Sellable |
| Internal hold | موقوفة مؤقًتا (داخلي) | Timed hold by staff; **expires automatically** |
| Customer hold | موقوفة مؤقًتا (عميل) | Timed hold for a specific customer; expires automatically |
| Reserved | محجوزة | Reservation confirmed |
| Contracted | متعاقد عليها | Contract activated |
| Blocked | محجوبة عن البيع | Withdrawn from sale by management decision; **does not expire** |
| Cancelled pending release | ملغاة بانتظار الإفراج | Cancelled, awaiting clearances before returning to sale |
| Delivered | مسلمة | Handed over to the customer |

> **Conflict `C-06`.** The Arabic business scope document (p5, p18) uses one word — `موقوفة` — where the
> technical model needs two distinct concepts: a **timed hold that expires on its own**, and a
> **management block that must be lifted deliberately**. Building the wrong one produces either units that
> silently return to sale or units stuck out of inventory. The split above (`موقوفة مؤقًتا` vs
> `محجوبة عن البيع`) is a proposal requiring confirmation before Phase 2.

## 4. CRM and marketing — العملاء والتسويق

| English | Arabic | Definition |
|---|---|---|
| Customer / person | عميل | Unified customer record |
| Lead | عميل محتمل | An inbound enquiry not yet qualified |
| Qualified lead | عميل مؤهل | A lead meeting qualification criteria 🔶 `SD-04` |
| Opportunity | فرصة بيع | A specific interest in a project or unit. One customer may have several |
| Pipeline stage | مرحلة المتابعة | Position in the sales process |
| Assignment | توزيع / إسناد | Allocating a lead to a salesperson |
| Customer ownership | ملكية العميل | Which salesperson owns the relationship 🔶 `SD-04` |
| Meaningful activity | نشاط معتبر | Activity that retains ownership 🔶 `SD-04` |
| Reassignment | إعادة توزيع | Transferring ownership |
| Loss reason | سبب فقدان الفرصة | Why an opportunity was lost |
| Nurture list | قائمة إعادة المتابعة | Lost or dormant leads for later follow-up |
| Visit | زيارة | A site or office visit |
| Consent / opt-in | موافقة العميل على التواصل | Permission to send messages |
| Campaign | حملة إعلانية | A Meta advertising campaign |
| Ad set | مجموعة إعلانية | Targeting and budget grouping |
| Creative | التصميم الإعلاني | Ad media and copy |
| Instant form | نموذج العملاء المحتملين | Meta lead form |
| Attribution | إرجاع المصدر | Linking a lead and its revenue to its source |
| Cost per lead (CPL) | تكلفة العميل المحتمل | Spend ÷ leads |
| Cost per acquisition (CAC) | تكلفة الاستحواذ | Spend ÷ contracts |
| Return on ad spend (ROAS) | العائد على الإنفاق الإعلاني | Attributed revenue ÷ spend |
| Internal budget authorization | اعتماد ميزانية داخلي | ERP approval to spend. **Not** a payment to Meta |
| Provider payment configuration | إعداد الدفع عند المزود | Meta's own payment method. Configured at Meta, not in the ERP |

> **Critical distinction.** The last two rows must remain clearly separate in both languages
> ([ADR-0011](decisions/adr-0011-meta-operating-boundary.md)). Arabic copy must not let
> `اعتماد ميزانية` read as "funds have been paid to Meta" — the most damaging possible misunderstanding in
> this product. 🔶 Arabic wording to be confirmed with marketing in Phase 3 (scope approved under `SD-14`)

## 5. Sales — المبيعات

| English | Arabic | Definition |
|---|---|---|
| Quotation | عرض سعر | Priced offer. **Never reserves inventory** (MASTER-MAPPING §9.4) |
| Discount | خصم | Price reduction, subject to approval limits 🔶 `SD-05` |
| Hold | حجز مؤقت | Timed, expiring claim on a unit |
| Reservation | حجز | Confirmed booking |
| Reservation form | استمارة الحجز | Numbered booking document |
| Contract | عقد | The binding sale agreement |
| Amendment / annex | ملحق العقد | A contract modification |
| Unit substitution | استبدال الوحدة | Replacing the contracted unit |
| Contract transfer | نقل التعاقد | Assigning the contract to another party |
| Plan change | تعديل نظام السداد | Changing the payment plan |
| Cancellation | إلغاء | Terminating a reservation or contract |
| Penalty | غرامة | Charge on cancellation or late payment 🔶 `SD-05` |
| Refund | استرداد | Returning money to the customer 🔶 `SD-05` |
| Clearance | إخلاء طرف / تسوية | Confirmation that obligations are settled before release |

## 6. Collections — التحصيل

| English | Arabic | Definition |
|---|---|---|
| Installment | قسط | A scheduled due amount |
| Installment schedule | جدول الأقساط | The full set of dues for a contract |
| Due date | تاريخ الاستحقاق | When payment is due. A **business date**, not a timestamp |
| Receipt / receipt voucher | سند قبض | Evidence of money received |
| Payment voucher | سند صرف | Evidence of money paid out |
| Allocation | تخصيص السداد | Applying a payment to specific dues |
| Partial payment | سداد جزئي | Less than the due amount |
| Overpayment | مبلغ زائد | More than the due amount |
| Arrears / overdue | متأخرات | Past-due amounts |
| Aging | أعمار الديون | Overdue amounts bucketed by age |
| Waiver | إعفاء من الغرامة | Forgiving a penalty, subject to approval |
| Statement of account | كشف حساب | Transaction and balance history |
| Reminder | تذكير | Pre-due notification. **Mandatory at 15 days before due** |
| Payment evidence | إثبات الدفع | Customer-supplied proof. **Not a confirmed collection** until verified (§9.5) |
| Confirmed collection | تحصيل معتمد | Verified and reconciled receipt |

> `سند قبض` (money in) and `سند صرف` (money out) differ by one word and are frequently confused. UI copy
> must pair each with a direction indicator, not rely on the label alone.

## 7. Negotiable instruments — الأوراق المالية

| English | Arabic | Definition |
|---|---|---|
| Check | شيك | Bank instrument |
| Promissory note | كمبيالة | Written promise to pay |
| Drawer | الساحب | Who issued the instrument |
| Maturity date | تاريخ الاستحقاق | When it becomes payable |
| Custody | العهدة / الحفظ | Responsibility for the physical original |
| Custody location | مكان حفظ الأصل | Where the original is physically kept |
| Handover minute | محضر تسليم واستلام | Numbered document evidencing physical transfer (`G-06`) |

### Custody statuses — حالات الورقة المالية 🔶 `SD-07` · gap `G-06`

Taken directly from the Arabic business scope document (p9). Movements are **append-only** — never
overwritten ([ADR-0009](decisions/adr-0009-no-hard-delete.md)).

| English | Arabic |
|---|---|
| Received | مستلمة |
| In treasury | بالخزينة |
| Out for collection | خرجت للتحصيل |
| Collected | محصلة |
| Returned (bounced) | مرتجعة |
| Replaced | مستبدلة |
| Returned to customer | مردودة للعميل |

> `مرتجعة` (dishonoured by the bank) and `مردودة` (deliberately given back to the customer) are entirely
> different events with opposite financial meaning. They must never be merged into one status.

## 8. Finance — المالية

| English | Arabic | Definition |
|---|---|---|
| Chart of accounts | دليل الحسابات | Account structure 🔶 `SD-08` |
| Journal entry | قيد يومية | A balanced accounting entry |
| Posting | ترحيل / إثبات القيد | Committing an entry to the ledger. Immutable once posted |
| Reversal | قيد عكسي | A new opposite entry correcting a posted one. **Not** a deletion |
| Subledger | حساب فرعي | Customer or vendor detail ledger |
| Financial period | فترة مالية | An accounting period. **Opening one requires approval** (`G-04`) |
| Trial balance | ميزان مراجعة | Debit/credit totals per account |
| Income statement | قائمة الدخل | Revenue and expense |
| Statement of financial position | المركز المالي | Balance sheet |
| Cash flow | التدفقات النقدية | Cash movement |
| Bank reconciliation | مطابقة البنك | Matching statement lines to internal records |
| Book balance | الرصيد الدفتري | Internal balance, before reconciliation (`G-11`) |
| Unidentified receipt | تحويل غير معروف | Money received that is not yet attributable |
| Outgoing transfer request | طلب تحويل صادر | Internal request → approval → **proof of execution**. The system never executes the transfer (`G-01`) |
| Expense request | طلب مصروف | Attachments, approval stages, spending limits (`G-02`) |
| Beneficiary / payee | المستفيد | Payment recipient. Data changes require approval (`G-05`) |
| Budget | ميزانية | Planned spend by entity, project, department, or campaign |
| Commitment | التزام | Approved but not yet spent |
| Variance | انحراف | Planned versus actual |
| Fixed asset | أصل ثابت | Capitalized asset |
| Depreciation | إهلاك | Periodic write-down |
| Withholding tax | ضريبة خصم وإضافة | Tax withheld at source 🔶 `SD-08` |

## 9. Procurement and construction — المشتريات والتنفيذ

| English | Arabic | Definition |
|---|---|---|
| Vendor / supplier | مورد | External goods or services supplier |
| Purchase request | طلب شراء | Internal request to buy |
| Request for quotation | طلب عرض سعر | Solicitation to vendors |
| Purchase order | أمر شراء | Committed order |
| Goods receipt | استلام الخامات | Recording delivery |
| Three-way match | المطابقة الثلاثية | PO, receipt, and invoice agree |
| Stock movement | حركة مخزون | Receipt, issue, transfer, return, adjustment |
| Stock count | جرد | Physical verification |
| Reorder level | الحد الأدنى | Threshold triggering an alert |
| Contractor | مقاول | Main construction contractor |
| Subcontractor | مقاول باطن | Contractor engaged under the main contractor (`G-13`) |
| Bill of quantities (BOQ) | جدول الكميات | Itemized work quantities |
| Progress certificate | مستخلص | Contractor claim for completed work |
| Advance payment | دفعة مقدمة | Paid ahead, recovered from certificates |
| Retention | استقطاع / محتجز | Withheld pending completion |
| Guarantee / bond | خطاب ضمان | Bank guarantee |
| Change order | أمر تغيير | Approved change to scope, time, or cost |
| Completion percentage | نسبة الإنجاز | Work completed |

## 10. HR — الموارد البشرية

| English | Arabic | Definition |
|---|---|---|
| Employee | موظف | A person employed by ALOLA |
| Attendance | الحضور والانصراف | Clock in and out |
| Leave | إجازة | Authorized absence |
| Overtime | عمل إضافي | Hours beyond the contracted schedule |
| Payroll run | مسير المرتبات | A payroll cycle |
| Allowance | بدل | Additional earning |
| Deduction | خصم | Reduction from pay |
| Payslip | قسيمة راتب | Per-employee statement |
| Social insurance | التأمينات الاجتماعية | Statutory insurance 🔶 `SD-08` |
| Commission | عمولة | Sales or broker incentive 🔶 `SD-06` |
| Commission reversal | عكس العمولة | Reversing commission on cancellation 🔶 `SD-06` |
| Advance / loan | سلفة / قرض | Money advanced, recovered from payroll |
| Custody (asset) | عهدة | Company cash or asset held by an employee |
| Exit clearance | تصفية / إخلاء طرف | Settlement on termination |

## 11. Handover and service — التسليم والخدمة

| English | Arabic | Definition |
|---|---|---|
| Readiness checklist | قائمة جاهزية الوحدة | Pre-handover verification |
| Inspection appointment | موعد المعاينة | Customer inspection |
| Defect / snag | ملاحظة / عيب | Issue found at inspection |
| Handover minute | محضر التسليم | Signed handover document |
| Meter reading | قراءة العدادات | Utility readings at handover |
| Ticket | طلب / شكوى | Complaint or maintenance request |
| SLA | مدة الاستجابة | Committed response and resolution time |
| Satisfaction rating | تقييم رضا العميل | Post-resolution feedback |

## 12. System and process terms — مصطلحات النظام

| English | Arabic | Definition |
|---|---|---|
| Implementation phase | مرحلة التنفيذ | A software delivery phase. Distinct from `مرحلة المشروع` |
| Requirement ID | معرف المتطلب | Stable identifier, e.g. `INV-HOLD-004` ([ADR-0014](decisions/adr-0014-requirement-id-scheme.md)) |
| Light Mode | الوضع الفاتح | The only supported theme ([ADR-0004](decisions/adr-0004-light-mode-only.md)) |
| Dark Mode | الوضع الداكن | **Out of scope.** Requested in an older Arabic document revision; superseded by stakeholder decision `SD-13` (closed) |
| Idempotency | عدم التكرار | Repeating an operation produces one effect |
| Reconciliation | مطابقة | Comparing two records of the same facts |
| Soft delete / archival | أرشفة | Excluded from default views, fully retained |
| Deactivation | تعطيل | No longer selectable; history preserved |
| Hard delete | حذف نهائي | **Prohibited** for financial, contractual, and audited records ([ADR-0009](decisions/adr-0009-no-hard-delete.md)) |

## Maintenance

- A new user-facing concept is added here **before** its translation keys are written.
- A term changing meaning is corrected here and in every translation key in the same change.
- Terms marked 🔶 are confirmed as part of Phase 1 discovery sign-off; the confirming decision is recorded
  in [decisions/open-decisions.md](decisions/open-decisions.md).
