# ADR-0007 — Decimal-safe money handling; no binary floating point

- Status: Accepted
- Date: 2026-09-19
- Deciders: Implementation team, ratified by ALOLA blueprint revision 2.0
- Scope: Data

## Context

The product computes installment schedules, down payments, discounts, maintenance charges, penalties,
commissions, tax, depreciation, payroll, retention, and contractor progress deductions. These values
appear in contracts, receipts, statements, and accounting entries that must reconcile exactly.

IEEE-754 binary floating point cannot represent decimal fractions exactly. `0.1 + 0.2 === 0.30000000000000004`
in JavaScript. Spread across a 96-month installment schedule with percentage-based discounts and
penalties, this produces schedules whose instalments do not sum to the contract value, trial balances
that do not balance, and receipts that disagree with statements by piastres. These defects are
undetectable in small tests and unfixable after the data exists.

## Decision

**No monetary value is ever stored, transported, or computed as a JavaScript `number`.**

1. **Storage.** Monetary amounts are stored as MongoDB `Decimal128`, together with an explicit ISO-4217
   currency code. An amount without a currency is invalid.
2. **Computation.** All arithmetic uses an arbitrary-precision decimal library. Direct `+`, `-`, `*`, `/`
   on monetary values is prohibited.
3. **Transport.** Money crosses the API as a string, not a JSON number — JSON numbers are parsed as
   doubles by every standard client, reintroducing the defect at the boundary. The shared contract type
   is `{ amount: string, currency: string }`.
4. **Rounding is explicit and declared.** Every calculation that rounds states its scale and mode. The
   default is half-up at the currency's minor-unit precision. Rounding is never implicit and never left
   to a formatter.
5. **Allocation must be exact.** When a total is split — instalments from a contract value, a payment
   across multiple dues, commission across a team, tax across lines — the parts must sum exactly to the
   total. The final part absorbs the rounding remainder, and this is asserted by test. Distributing a
   remainder silently is prohibited.
6. **Percentages are decimals too.** Discount rates, penalty rates, tax rates, retention rates, and
   commission rates are decimal values, not floats.
7. **Currency precision is configured per currency**, not hard-coded to two places.
8. **Display formatting is locale-aware and separate from storage.** Formatting never mutates the
   stored value, and a formatted string is never parsed back into a calculation.

## Consequences

**Accepted benefits**

- Schedules sum to contract values. Trial balances balance. Receipts agree with statements.
- Rounding behaviour is auditable, because it is declared rather than emergent.

**Accepted costs**

- Money arithmetic is verbose: `a.plus(b)` rather than `a + b`. Accepted without exception.
- `Decimal128` values need conversion at the Mongoose boundary. Mitigation: a money type in
  `packages/contracts/` handles the conversion in one place.
- Money cannot be sorted or aggregated with naive MongoDB operators in all cases; aggregation pipelines
  must be written for `Decimal128`. Accepted.

## Compliance

- Lint must reject arithmetic operators applied to money-typed values.
- A monetary field typed as `number` in a schema or contract is a defect.
- Every allocation function has a test asserting the parts sum exactly to the total, including cases
  that do not divide evenly (for example a value split across 7, 11, and 96 instalments).
- Every rounding site states its scale and mode explicitly.

## References

- `docs/MASTER-MAPPING.md` §7, §9
- `CLAUDE.md` — "Use decimal-safe money handling; never use binary floating point for financial
  calculations."
- [../architecture/data-model-conventions.md](../architecture/data-model-conventions.md)
