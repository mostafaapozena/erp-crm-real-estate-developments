# Business decision register

The business rules the product needs a client to decide, one entry each. It refines the stakeholder
items in [open-decisions.md](open-decisions.md) (`SD-*`) into the individual choices a
configuration screen or a business module will ask for.

**How the product treats an open entry:** it stores `null` — *not configured* — and either refuses the
operation that needs the rule or leaves it to a person, and says which decision it waits for. It never
substitutes a guessed number. A "recommended default" below is offered only where choosing it cannot
harm a client and is easy to change; a client still approves it before go-live.

**Status values:** `open` (no answer) · `proposed` (a recommendation awaits the owner) · `approved`
(recorded with its date) · `deferred` (explicitly left for a later phase).

Owners are roles at the client, not people; the deployment record names the person.

| ID | Decision | Options | Recommended default | Owner | Blocks | Status | Approved |
|---|---|---|---|---|---|---|---|
| BD-01 | Reservation validity — how long a reserved unit stays held before it returns to sale (`SD-03`) | A fixed number of days; per project; per unit type | None — depends on the sales process | Sales director | Macro Phase 2 | open | — |
| BD-02 | Reservation amount — the deposit a reservation requires (`SD-05`) | Fixed amount; percentage of price; per project | None | Sales director, finance | Macro Phase 2 | open | — |
| BD-03 | Discount thresholds — the discount a role may give without approval (`SD-02`, `SD-05`) | Percentage bands per role; amount bands; per project | None. The demonstration's 10 % is illustrative only | Sales director, finance | Macro Phase 2 | open | — |
| BD-04 | Approval levels — who approves what, in how many stages, with what segregation of duty (`SD-02`) | Per operation: approver role(s), quorum, maker-checker | Maker-checker **on** for every financial approval | Management | Macro Phase 2 | open | — |
| BD-05 | Cancellation — when a reservation or contract may be cancelled, by whom, with what penalty (`SD-05`) | Free within N days; penalty percentage; management approval | None | Management, legal | Macro Phase 2 | open | — |
| BD-06 | Refunds — what is refunded on cancellation, when, through which method (`SD-05`) | Full, less penalty, less costs; timing; method | None | Finance, legal | Macro Phase 2 | open | — |
| BD-07 | Unit replacement — moving a buyer to another unit and how paid money transfers (`SD-05`) | Allowed with approval; price difference handling; schedule rebuild | None | Sales director, finance | Macro Phase 2 | open | — |
| BD-08 | Contract assignment — transfer of a contract to a new buyer, fees, approvals (`SD-05`) | Allowed after N% paid; transfer fee; legal review | None | Legal, finance | Macro Phase 2 | open | — |
| BD-09 | Rescheduling — changing an instalment schedule after signature (`SD-05`) | Allowed with approval; fees; limits per contract | Always requires approval | Finance | Macro Phase 2 | open | — |
| BD-10 | Early settlement — paying off the balance early and any discount (`SD-05`) | No discount; fixed discount; discount by months remaining | None | Finance | Macro Phase 2 | open | — |
| BD-11 | Grace period — days after a due date before an instalment is late (`SD-05`) | 0 days; N days; per contract | None | Finance | Macro Phase 2 | open | — |
| BD-12 | Late fees — whether and how lateness is charged (`SD-05`) | None; fixed; percentage per period; capped | None | Finance, legal | Macro Phase 2 | open | — |
| BD-13 | Payment allocation — how a payment is applied across due instalments (`SD-05`) | Oldest first; nearest due first; penalties first or last; customer's choice | Oldest due first, principal before penalties | Finance | Macro Phase 2 | proposed | — |
| BD-14 | Commission calculation — rates, basis and timing for staff and brokers (`SD-06`) | Percentage of contract value; tiers; on signature or on collection | None | Sales director, finance | Macro Phase 2 | open | — |
| BD-15 | Commission clawback — recovering commission when a contract is cancelled (`SD-06`) | Full; pro-rata to collected; none after N months | None | Finance, HR | Macro Phase 2 | open | — |
| BD-16 | Taxes — which taxes apply to which transactions, rates and effective dates (`SD-08`) | Per tax code; per transaction type | None — no tax rate is seeded | Finance, tax adviser | Macro Phase 2 | open | — |
| BD-17 | Fiscal periods — fiscal-year start, period length, closing rules (`SD-21`, `SD-08`) | January or another month; monthly periods; soft/hard close | None. The product refuses fiscal-year numbering until it is set | Finance | Macro Phase 2 | open | — |
| BD-18 | Posting and reversal — which events post journal entries and how a reversal posts (`SD-08`) | Chart of accounts mapping per event; reversal by contra-entry | Reversal always by contra-entry, never by edit or delete | Finance, auditor | Macro Phase 2 | proposed | — |
| BD-19 | Document numbering — formats and reset rules per document type (`SD-10`) | Prefix, date part, entity/branch/project parts, yearly or never reset | None. The engine exists (CORE-DOC-001); formats are configured per client | Finance, legal | Macro Phase 2 | open | — |
| BD-20 | Data retention — how long each kind of record and document is kept, and archival (`SD-18`) | Legal minimums per record type; archive vs keep online | Keep everything online until decided (the product never deletes business records) | Legal, IT | Macro Phase 4 | proposed | — |
| BD-21 | WhatsApp consent — how consent is captured, worded and withdrawn (`SD-09`, `SD-20`) | At contract signature; separate form; per channel | No external message to a customer without recorded consent (enforced today) | Legal, marketing | Macro Phase 4 | proposed | — |
| BD-22 | Escalation timing — grace before an overdue task or approval escalates, and to whom (`SD-02`) | Immediately; after N hours; per priority | Immediately to the direct manager (the registry's own rule, G-09); `tasks.escalationDelayHours` holds a grace period once decided | Management | Macro Phase 2 | proposed | — |
| BD-23 | Quiet hours — when non-urgent external messages are held (`SD-21`) | None; evenings and nights; per day of week | None — nothing is held until set | Management, marketing | Macro Phase 4 | open | — |
| BD-24 | Working week and holidays — which days count for due dates and escalations (`SD-21`) | Saturday–Thursday; Sunday–Thursday; holiday calendar | None | HR, management | Macro Phase 3 | open | — |

## Recording a decision

1. The owner answers in writing (e-mail or signed minutes) with the option chosen and its effective
   date.
2. Change the entry's status to `approved`, fill the approval date, and link the evidence in the
   deployment record — not in this repository if it names people or the client.
3. Enter the value through the product (settings, approval policies, numbering, reference data), so
   the change itself is audited. A value typed into a database is not an approval.
4. If a decision changes a product default rather than a client's configuration, it becomes an ADR.
