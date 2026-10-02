# Official document numbering — runbook

Audience: the deployment administrator who configures how commercial documents are numbered, and the
engineer who supports them. Requirement IDs: `CORE-DOC-001`, `SALE-RESERVE-006`. Decision: `BD-19`
(open — the client decides the final formats).

## What numbers what

| Document | Numbered when | Official format type | Legacy series (no format active) |
|---|---|---|---|
| Reservation | the reservation is created | `reservation` | `RSV-yyyy-00001` |
| Contract | the **draft** is created (Package 6 design; a withdrawn draft keeps its number, which is never reused) | `contract` | `CTR-yyyy-00001` |
| Quotation | the first revision is created; later revisions keep the number | `quotation` | `QUO-yyyy-00001` |
| Receipt | inside the receipt's own transaction | `receipt` | `RCT-yyyy-00001` |
| Customer statement | when the statement PDF is issued | `customerStatement` | `STM-yyyy-00001` |

Customers, leads and opportunities carry no business number today. A customer code needs a format
decision (`BD-19`) and a backfill of existing customers, so it is recorded as a gap, not invented.

Every number is issued inside the transaction that creates its document, so a document that fails
leaves no number behind (tested: an aborted transaction's number is issued again to the next document).
Concurrent issues are distinct and consecutive (tested). An issued number is never reused; voiding
keeps it in the ledger (`issuedNumbers`).

## Configuring a format

Settings → **Sales and commercial operations** → *Official document numbering* (needs
`numbering.view`; changing needs the administrative `numbering.manage`, so a second factor).

1. **New format** creates a **draft**. A draft numbers nothing. Its *example* shows what a number will
   look like.
2. **Use the current series' shape** fills the legacy shape for the type (`RSV`, `-`, year, yearly,
   five digits, no branch or project code). This is a *proposed* shape only — the final format is the
   client's decision.
3. **Activate** asks for a reason, is audited (`numbering.sequence.activated`) and states before you
   confirm whether the format **continues** the current series or **starts a new one**.

### Continuing the legacy series

A format that reproduces the legacy shape exactly — same prefix, `-` separator, `yyyy`, yearly reset,
five digits, no entity/branch/project code, no suffix — **continues** it: on activation, each year's
counter is set to start after the last number the legacy series issued that year (read from
`salesCounters` inside the activating transaction). The activation audit records what was continued,
e.g. `2026:41`. The next reservation after `RSV-2026-00041` is `RSV-2026-00042`.

A format of **any other shape** cannot render a legacy number (a different prefix, separator, digit
count or date part produces different strings), so it starts its own series at *Start at*. Numbers
already issued keep their old shape forever.

### Safety notes

- Activate a format during a quiet period. A legacy number drawn in the instant between the activation's
  read of the legacy counter and its commit could collide with the first official number; the unique
  index on the document number refuses the second document rather than storing a duplicate, and that
  request fails and can be retried.
- Activating is not reversible in effect: numbers issued under a format stay. To change a format,
  create and activate a new version; the counter continues by type and period.
- A fiscal-year format refuses to issue until `finance.fiscalYearStartMonth` is configured.
- A format with a branch or project code needs that code on every document; the preview button on the
  settings page shows the next number only for formats that need no code.

## Verifying

- `GET /api/v1/numbering/sequences` — the formats, with `continuesLegacySeries`.
- `POST /api/v1/numbering/preview` — the next number (reserves nothing).
- `GET /api/v1/numbering/issued?type=reservation` — the ledger.
- Integration tests: `apps/api/src/modules/numbering/numbering.int-test.ts` (engine) and
  `continuation.int-test.ts` (legacy continuation, non-legacy formats, concurrency, rollback).
