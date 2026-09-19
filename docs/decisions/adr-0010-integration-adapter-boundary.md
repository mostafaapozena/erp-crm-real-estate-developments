# ADR-0010 — All external providers behind versioned adapters

- Status: Accepted
- Date: 2026-09-19
- Deciders: Implementation team, ratified by ALOLA blueprint revision 2.0
- Scope: Integration

## Context

The product integrates WhatsApp Business Platform, Meta Marketing and Lead APIs, Meta Conversions API,
email, SMS, a payment gateway, Egyptian e-invoicing, bank statement import, and maps. These providers
change their API versions, deprecate fields, rate-limit unpredictably, and fail partially. Provider
concepts also do not match ALOLA's domain: Meta's campaign objective taxonomy is not ALOLA's, and a
WhatsApp template status is not an ALOLA notification status.

If provider SDK types and provider vocabulary leak into domain modules, a provider version bump becomes
a change across the whole codebase, and provider downtime becomes domain-logic failure.

## Decision

Every external provider is reached **only** through an adapter in a dedicated integration module.

### Adapter contract

1. **Domain-typed interface.** The adapter accepts and returns ALOLA domain types. Provider payload
   shapes, provider enums, and SDK objects do not cross the adapter boundary. No domain module imports a
   provider SDK.
2. **Explicit API version.** Each adapter pins the provider API version it targets and records it in
   configuration and in `docs/MEMORY.md`. Version upgrades are deliberate changes with their own testing,
   never implicit.
3. **Capability reporting.** An adapter reports what the connected account can actually do. Where a
   capability is unavailable, the UI hides or clearly disables the control — it never fails silently and
   never presents a feature the provider will reject. See [ADR-0011](adr-0011-meta-operating-boundary.md).
4. **Official APIs only.** No browser automation, no scraping, no credential sharing, no
   provider-password storage.
5. **Secrets server-side only.** Tokens are encrypted at rest, minimally scoped, revocable, and never
   sent to the frontend. Logs are redacted.
6. **Errors are translated.** Provider errors become domain errors carrying a stable code, the provider
   request ID, whether the failure is retryable, and actionable guidance. A raw provider error string is
   never shown to a user.

### Webhooks

1. **Signature verification is mandatory** before any processing. An unverified webhook is rejected and
   logged, never processed "just in case".
2. **Provider event IDs are stored and enforced unique.** A replayed or duplicated delivery is
   acknowledged and discarded — never processed twice. Providers retry by design, so duplicate delivery
   is expected, not exceptional.
3. **Acknowledge fast, process asynchronously.** The endpoint validates, records, enqueues, and returns.
   Business processing happens in the worker so a slow domain operation cannot cause provider retry
   storms.

### Jobs and reliability

1. **Every retryable job is idempotent.** Re-running it must not double-send a message, double-create a
   lead, double-post an entry, or double-charge anything.
2. **Exponential backoff with jitter**, a bounded retry count, and a dead-letter queue for exhausted
   jobs. Dead letters are visible to operators and replayable.
3. **Rate limits are handled as normal operation**, not as errors — respect provider retry hints.
4. **Scheduled reconciliation complements webhooks.** Webhooks are not a reliable delivery guarantee;
   periodic incremental reconciliation detects missed events and provider/internal divergence, and
   reports it.
5. **Health and freshness are visible.** Each integration exposes connection state, token validity, last
   successful sync, last error, and data-freshness indicators. Stale data must be labelled stale in the
   UI rather than presented as current.

## Consequences

**Accepted benefits**

- A provider version change is contained in one module.
- Provider outages degrade a feature instead of breaking the domain.
- Duplicate-delivery and replay defects — the most common and most damaging webhook bugs — are prevented
  structurally rather than case by case.

**Accepted costs**

- An adapter plus mapping layer is more code than calling an SDK directly from a service. Accepted.
- Adapters need contract tests against recorded provider fixtures, which must be refreshed when the
  provider changes. Accepted as the cost of not discovering breakage in production.
- Mapping provider capabilities to UI state adds complexity to campaign screens. Accepted: the
  alternative is offering users actions the provider will reject.

## Compliance

- A provider SDK import outside its adapter module fails lint.
- Every webhook endpoint has tests for invalid signature, replayed event ID, and duplicate delivery.
- Every job has an idempotency test that runs it twice and asserts a single effect.
- Integration registry entries record pinned API version, scopes, health, and last sync.

## References

- `docs/MASTER-MAPPING.md` §4, §9.10, §10
- `CLAUDE.md` — "All integrations must use adapters, webhooks must verify signatures, and retryable jobs
  must be idempotent."
- [../architecture/integrations.md](../architecture/integrations.md)
- [ADR-0011](adr-0011-meta-operating-boundary.md)
