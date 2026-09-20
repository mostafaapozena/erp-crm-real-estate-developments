# ADR-0021 — Audit trail integrity: what the application guarantees, and what it cannot

- Status: Accepted
- Date: 2026-09-21
- Deciders: Implementation team
- Scope: Security

## Context

[ADR-0009](adr-0009-no-hard-delete.md) decided that audit records are append-only and not exempt for any
reason. [ADR-0006](adr-0006-server-side-authorization.md) decided that every mutation, export, and
sensitive read is audited. Neither says **how** that is enforced, or how strong the resulting guarantee
actually is.

Two failure modes follow from leaving it unstated:

1. "Append-only" is easy to claim and easy to lose. A future developer with a legitimate task — fixing a
   typo in a stored reason, purging test data, migrating a field — reaches for `updateMany` and the
   guarantee is gone, silently, with no failing test.
2. "Immutable" is easy to overstate. An application cannot prevent someone with direct database
   credentials from editing a collection. Describing an application control as tamper-proof would mislead
   the reader of an audit report, which is worse than describing it accurately.

The same applies to "every mutation is audited". As a convention it decays: the audit call is the easiest
line to forget in a new endpoint, and its absence is invisible until evidence is needed and missing.

## Decision

### 1. Append-only is enforced in three places, in the application

- **No mutating method exists.** The AUDIT module publishes `record`, `query`, `findByEventId`, and
  `exportEvents`. There is no update or delete path in code, migrations, or tooling.
- **Schema middleware refuses mutation.** Every mutating query operation on the collection
  (`updateOne`, `updateMany`, `replaceOne`, `findOneAndUpdate`, `findOneAndReplace`, `findOneAndDelete`,
  `deleteOne`, `deleteMany`, `bulkWrite`) throws `AuditImmutableError`, and re-saving a loaded document
  throws. Reaching for the model directly fails loudly instead of quietly editing evidence.
- **Every field is immutable, with strict mode set to throw.** Assigning to a stored field is rejected
  before a save is attempted.

### 2. The limit is documented, not implied

This is **application-level** immutability. A principal with direct MongoDB access — a database
administrator, a restore operation, a compromised credential — can still modify or drop the collection.
The application cannot prevent that, and **no cryptographic tamper-proofing is claimed or implemented**:
there is no hash chain and no external notarization today.

Protecting the trail against a privileged operator is an **operational** control, not an application one:
restricted database roles, append-only backup targets, off-host retention, and independent review of
administrative access. Those belong to `SD-18` and Phase 9 hardening. If cryptographic integrity is later
required, it arrives as its own ADR and its own implementation — not as a claim about this one.

Until then, documentation, reports, and commit messages describe the guarantee as *append-only enforced by
the application*, never as *immutable* or *tamper-proof*.

### 3. "Every mutation is audited" is enforced at runtime, not by convention

The request pipeline counts audit writes per request. A request with a mutating method that is about to
return a successful response having recorded **no** audit event is converted to `500 INTERNAL_ERROR` and
logged as `AUDIT_MISSING_FOR_MUTATION`. A missing audit call therefore fails a test the first time it is
written, instead of producing missing evidence months later.

A route that genuinely changes no persistent state opts out explicitly and visibly. The opt-out is the
documented exception; a domain mutation is never exempt.

### 4. A failed audit write fails the operation

`record` logs the failure with its correlation ID and rethrows. Evidence is never silently dropped to let
an operation succeed. Two deliberate exceptions, both of which keep the *safe* outcome:

- An authorization **denial** that cannot be audited is still a denial. A failed audit write must never
  turn a denial into an allow.
- A refused privilege escalation that cannot be audited is still refused.

In both cases the audit failure is already logged by the audit service, so the evidence gap is visible.

### 5. Queries are deterministic and constrained

Audit reads use **keyset pagination** ordered by `occurredAt desc, eventId desc`, with an opaque cursor
carrying the last row's position. Offset pagination is rejected: new events arrive constantly, so offsets
repeat and skip rows. Page size is bounded, exports are bounded by a row limit that reports truncation,
and the actor's data scope is merged into the filter before the database answers — including the total.

### 6. Change summaries are summaries

A stored change is `{ path, from, to }` with values summarized, length-bounded, and depth-bounded. Values
under keys matching the sensitive-key pattern (password, token, secret, credential, bank, IBAN, card,
national ID, and similar) are replaced with a redaction marker rather than stored. Request bodies are
never stored verbatim. An audit trail holding plaintext salaries or bank numbers would be the
least-protected copy of the most sensitive data in the system.

## Consequences

**Accepted benefits**

- The guarantee is testable, and it is tested: refusal of every mutating operation, refusal of a re-save,
  and the runtime assertion that a mutation without an audit record fails.
- The report a stakeholder reads matches what the system actually does.
- A forgotten audit call is a failing test, not a silent gap.

**Accepted costs**

- Correcting a genuinely wrong audit record is impossible by design. The remedy is a new, linked record —
  which is the intended behaviour.
- Test cleanup cannot use the application. Integration tests delete their own records through the raw
  driver, which is exactly the privileged path this ADR documents as the residual risk.
- The per-request audit counter adds a small amount of machinery to the pipeline, and a legitimately
  non-mutating `POST` route must opt out explicitly.
- Keyset pagination cannot answer "jump to page 7". Accepted: audit review is chronological.

## Compliance

Tests must prove, against a real MongoDB instance:

1. Every mutating query operation on the audit collection is refused.
2. A loaded audit document cannot be edited and re-saved.
3. A successful mutating request that records no audit event returns `500`.
4. A failed audit write does not convert a denial into an allow.
5. Pagination returns each record exactly once across pages, with a scoped total.
6. Sensitive values are redacted in stored change summaries, and no whole request body is stored.

## References

- `docs/MASTER-MAPPING.md` §6, §11
- [ADR-0006](adr-0006-server-side-authorization.md) — authorization and what must be audited
- [ADR-0009](adr-0009-no-hard-delete.md) — audit records are never deleted
- [ADR-0022](adr-0022-authorization-resolved-per-request.md) — authorization state is not cached
- [../architecture/security-model.md](../architecture/security-model.md)
- `CLAUDE.md` — "Financial and inventory state changes require transactions, idempotency, audit records";
  "Never log or commit secrets".
