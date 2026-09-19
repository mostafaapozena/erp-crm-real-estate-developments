# ADR-0009 — No hard deletion of financial, contractual, or audited records

- Status: Accepted
- Date: 2026-09-19
- Deciders: Implementation team, ratified by ALOLA blueprint revision 2.0
- Scope: Data

## Context

Financial and contractual records are evidence. A collected receipt, an activated contract, a posted
journal entry, a check held in custody, a promissory note, and an audit record all serve to prove what
happened and who authorized it. Deleting such a record destroys the evidence, breaks the reconciliation
chain, and makes the audit trail unverifiable — including in disputes where ALOLA needs it.

The supplementary Arabic business scope states the same requirement independently (p19):
"عدم حذف السجلات المالية والعقود والشيكات والكمبيالات؛ يتم الإلغاء أو العكس مع حفظ التاريخ."
("Do not delete financial records, contracts, checks, and promissory notes; cancellation or reversal is
used, with history preserved.")

## Decision

**Hard deletion is prohibited for the following record classes**, in application code, in migrations,
and in administrative tooling:

- financial records — invoices, receipts, payments, journal entries, allocations
- contractual records — quotations, reservations, contracts, amendments
- inventory history — unit status transitions, holds, price versions
- audit records — without exception
- checks and promissory notes — including their custody movements
- approval history

### Use the correct workflow instead

| Intent | Mechanism | Effect |
|---|---|---|
| A posted entry is wrong | **Reversal** | A new, opposite entry referencing the original. Both remain. |
| A document should not proceed | **Cancellation** | Status becomes cancelled, with reason and actor. The record remains. |
| A record is no longer current | **Archival** | Excluded from default views, fully retrievable. |
| A master-data record is no longer in use | **Deactivation** | Cannot be selected for new transactions; historical references stay intact. |

### Rules

1. **Posted financial entries are immutable.** Correction is by reversal only — never by edit, never by
   delete-and-recreate.
2. **Cancellation is not deletion.** A cancelled reservation or contract keeps its number, its history,
   and its documents. Number sequences are never reused.
3. **Deactivation must not orphan history.** A deactivated project, unit type, or employee remains
   resolvable from every record that references it.
4. **Check and note custody history is append-only.** Every movement — received, in treasury, out for
   collection, collected, returned, replaced, returned to customer — is a new record, never an update
   that overwrites the prior state.
5. **Audit records are append-only and are not exempt** for any reason, including data-cleanup work.
6. **Cancelled inventory returns to sale only after required clearances** — never by resetting a status
   field directly.
7. **Retention and privacy.** Where a legal erasure obligation applies to personal data, it is satisfied
   by a documented, audited redaction procedure that preserves the financial record and its references —
   not by deleting the record. Any such procedure requires its own ADR and legal approval.

### What may be deleted

Genuinely transient data: unsaved drafts, expired sessions, cache and queue entries, idempotency keys
past their window, and rows in tables explicitly designated ephemeral. Nothing that has ever been
submitted for approval, posted, or presented to a customer.

## Consequences

**Accepted benefits**

- Complete, provable history for audit, disputes, and reconciliation.
- Reversal-based correction is itself auditable: the mistake and its correction are both visible.

**Accepted costs**

- Data volume grows monotonically. Accepted; mitigated by archival and indexing, not deletion.
- Every list query must exclude cancelled, archived, and inactive records by default, or users will see
  superseded data. Mitigation: repository defaults exclude them; including them is explicit.
- Unique constraints must account for cancelled records — a cancelled reservation must not block a new
  one on the same unit. Mitigation: partial indexes scoped to active states.
- "Undo" cannot be implemented as deletion anywhere in the product. Accepted.

## Compliance

- No `deleteOne`, `deleteMany`, `findOneAndDelete`, or `drop` against a protected collection. Lint-enforced
  and review-enforced.
- Migrations that would remove protected data are rejected.
- Tests assert that cancellation preserves the record and its number, that reversal leaves both entries,
  and that a cancelled reservation does not block a subsequent reservation of the same unit.

## References

- `docs/MASTER-MAPPING.md` §9.8, §15
- `CLAUDE.md` — "Never hard-delete financial, contractual, inventory-history, audit, check, or
  promissory-note records. Use reversal, cancellation, archival, or deactivation workflows."
- Arabic scope document p19
- [ADR-0006](adr-0006-server-side-authorization.md)
