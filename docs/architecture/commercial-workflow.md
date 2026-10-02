# Commercial workflow (BMP-1)

Audience: engineers and reviewers working on the commercial journey. Covers the screens and API
built in Business Master Prompt 1 (packages 2–8) and the rules they enforce. Business decisions that
are still open are named where they apply; none is decided here.

## The journey

```
Lead ─convert→ Customer ─┬─ Opportunity ─┬─ Quotation (reserves nothing)
                         │               └─ Reservation ─confirm→ Contract draft ─activate→ Active contract
                         └─ Customer workspace                                     │
                                                                                   ├─ Instalments (frozen schedule)
                                                                                   ├─ Issued documents (PDF + QR)
                                                                                   └─ Collections (receipts, BMP-2)
```

| Step | Screen | API | Notes |
|---|---|---|---|
| Convert a lead | Lead page → *Convert to customer* | `POST /crm/leads/{id}/convert` | Idempotent; links an existing customer by phone; may open an opportunity (`crm.opportunity.manage`) in the same transaction |
| Work an opportunity | Customer workspace → *Opportunities* | `/crm/opportunities` | `reservation` and `won` are set by sales only (`STAGE_SET_BY_SALES`) |
| Quote | `/quotations/new?customerId=&opportunityId=&unitId=&leadId=` | `POST /sales/quotations` | Never reserves the unit; preview required on screen before creating; validity proposed from `sales.quotationValidityDays` only when configured (`BD-36`) |
| Revise / withdraw | `/quotations/{id}` | `…/revisions`, `…/withdraw` | A revision is a new record; earlier ones stay `superseded` |
| Reserve | `/reservations/new?quotationId=…` (or customer, opportunity, lead, unit) | `POST /sales/reservations` | A quotation pre-fills customer, unit, price and plan; **every reservation rule applies again** on the server |
| Draft a contract | Reservation page → *Draft a contract* (confirmation explains a draft commits nothing) | `POST /sales/contracts` | Idempotent key per page; a reservation with a draft links to it instead |
| Edit the draft | `/contracts/{id}` | `PUT …/parties`, `PUT …/payment-plan` | Snapshots (buyer, unit, price) are immutable; a plan different from the reservation's carries `planChanged` |
| Review and activate | Contract page → *Activate contract* | `GET …/activation-review`, `POST …/activate` | Review from the server; person confirms; idempotency key; one activation |
| After activation | Contract page | `…/installments`, `…/amendments`, `…/cancel`, `…/signing` | Schedule changes only by approved amendment; cancellation refused after collection beyond the deposit (`CONTRACT_HAS_COLLECTIONS`, BMP-2) |

## Contract lifecycle

- **Draft** — snapshots, parties, a proposed schedule (`draftSchedule`). No instalment exists, the unit
  stays `reserved` by the reservation, the opportunity is not won. The reservation records the draft, so
  it can neither expire nor be cancelled underneath it.
- **Plan edit** (`PUT /contracts/{id}/payment-plan`, draft only) — validated by the shared schedule
  builder; the total follows the maintenance deposit (price + deposit); audited
  `sales.contract.planChanged`; stale version refused. The contract total is immutable in the model; the
  one draft-only update sets it explicitly (`overwriteImmutable`, filtered to `state: 'draft'`).
- **Activation review** (`GET /contracts/{id}/activation-review`) — exceptions, `approvalRequired`
  (asks the approval engine the same question activation asks), blockers (`notDraft`,
  `reservationNotConfirmed`, `approvalPending`, `notPermitted`), warnings, the rows activation would
  freeze and the reservation's plan for comparison. Writes nothing.
- **Activation** (`POST /contracts/{id}/activate`) — one transaction: contract active, instalments
  created (reservation money credited earliest first), reservation converted, unit contracted, lead and
  opportunity won, audit records. With a `planChanged` exception governed by a published
  `sales.contract.exception` policy it becomes `pendingApproval` instead, and the approval's outcome
  activates it (or returns it to draft). The optional `idempotencyKey` makes a retry answer with the
  contract; without it a retry is `STALE_VERSION`. Concurrent activations: one wins.
- **Signing** — recorded once, never required for activation until `BD-35` is decided.

## Customer workspace

`/customers/{id}` (`crm.customer.view`). Each section is its own scoped request under its own
permission and is **not requested** without it: opportunities (`crm.opportunity.view`), quotations
(`sales.quotation.view`), reservations (`sales.reservation.view`), contracts and the financial summary
(`sales.contract.view`), overdue and upcoming instalments (`collection.installment.view`), receipts,
cheques/notes and reminders (their `collection.*.view`), leads (`crm.lead.view`), the customer
statement (`document.*`), the timeline and ownership history. Sections show at most ten rows with the
server's scoped total. The identity is shown only when the customer read returned it
(`crm.customer.viewIdentity`, SEC-029); otherwise the page says it is restricted and asks no other
endpoint. Customers have no business code yet (see the numbering runbook).

## Sales settings

Settings → *Sales and commercial operations* (`/settings/sales`, `settings.view` or `numbering.view`).
Commercial rules are catalogued settings shown with the decision they wait for; changing one is the
administrative `settings.manage` with a reason, audited with the version replaced, and applies only to
records created afterwards. Number formats are described in
[numbering-runbook.md](../operations/numbering-runbook.md). Salespeople read the two validity periods
through `GET /sales/defaults` (authentication only), never the settings catalog.

## Authorization matrix (commercial operations)

| Action | Permission | Administrative |
|---|---|---|
| See quotations / manage (create, revise, withdraw) | `sales.quotation.view` / `sales.quotation.manage` | no |
| Convert a lead | `crm.lead.convert` (+ `crm.opportunity.manage` to open an opportunity) | no |
| See / manage / assign opportunities | `crm.opportunity.view` / `.manage` / `.assign` | no |
| See an identity document | `crm.customer.viewIdentity` (field restriction) | no |
| Reserve / confirm / extend / cancel | `sales.reservation.create` / `.confirm` / `.extend` / `.cancel` | no |
| Draft a contract, edit its parties and plan | `sales.contract.create` | no |
| Activate / sign / amend / cancel a contract | `sales.contract.activate` / `.sign` / `.amend` / `.cancel` | no |
| Issue / revoke a PDF | `document.generate` / `document.revoke` | revoke only |
| Change commercial settings | `settings.manage` | yes |
| Configure number formats | `numbering.manage` | yes |

Every permission is enforced again by the API, and data scope is applied inside the query.

## Demonstration role matrix (UAT — not `SD-02`)

Defined in `scripts/seed-demo/roles.ts` (`BMP1_ADDITIONS`), applied to an existing database by
`npm run seed:demo:bmp1`, pinned by `scripts/seed-demo/roles.test.ts`.

| Role (scope) | Commercial permissions |
|---|---|
| Executive (`all`) | read only: opportunities, quotations, reservations, contracts, collections, settings and number formats |
| System administrator (`all`, second factor) | settings and number formats (view and manage); document revoke; no sales operations |
| Sales manager (`branch`) | convert, opportunities (incl. assign), quotations, holds, reservations (confirm, extend, cancel), contracts (draft, **activate, sign, amend, cancel**), identity, exports, document issue, approvals |
| Sales representative (`branch`) | convert, opportunities, quotations, holds, reservations (create), contract view, document issue — **no** activation, cancellation, identity or assignment |
| Collection officer (`all`) | quotation view; receipts, cheques, reminders; document issue |
| Accountant (`all`) | read collections; reverse receipts |
| Marketing manager (`all`) | campaigns; opportunity view |

The product has no separate "customer service" or "contract operations" demonstration role; their
duties sit with the sales manager in this demonstration.
