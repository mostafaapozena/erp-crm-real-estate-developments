# Integrations

Implements [ADR-0010](../decisions/adr-0010-integration-adapter-boundary.md) (adapter boundary) and
[ADR-0011](../decisions/adr-0011-meta-operating-boundary.md) (Meta operating boundary).

## 0. Foundation status (F10, 2026-09-28)

The mechanism in this document exists: `apps/api/src/modules/integrations/` — registry with encrypted
credentials, pinned-version recording, health and freshness, `POST /api/v1/webhooks/{provider}` with
raw-body signature verification and a unique provider-event inbox, a leased processing sweep with a
dead letter, and an idempotency-keyed outbox. **No adapter is registered**, so every provider below
reads `noAdapter` and nothing is connected. Each adapter arrives with its business phase and its own
contract tests; the provider-SDK lint rule of ADR-0010 is added with the first SDK.

## 1. Provider registry

| Provider | Purpose | Direction | Phase | Status |
|---|---|---|---|---|
| MongoDB | Primary datastore | — | 1 | Atlas development cluster approved (ADR-0018); not yet provisioned |
| Redis | Locks, cache, rate limits, BullMQ | — | 1 | Adapter for managed or approved local instance (ADR-0018); not yet provisioned |
| AWS S3 | Private file storage | Out | 1 | Not configured |
| AWS KMS / Secrets Manager | Encryption keys, secrets | Out | 1 | Not configured |
| WhatsApp Cloud API | Template messages, status webhooks, inbound | Both | 3 | Not configured (`SD-09`) |
| Meta Marketing API | Campaigns, ad sets, creatives, ads, lead forms, audiences, insights | Both | 3 | Full scope approved (`SD-14`); not configured (`SD-19`) |
| Meta Lead Ads Webhooks | Lead capture | In | 3 | Not configured (`SD-19`) |
| Meta Conversions API | Offline conversion events | Out | 3 | Approved as optional (`SD-15`); **production delivery disabled by default** ([ADR-0017](../decisions/adr-0017-meta-conversions-api-gated-activation.md)) |
| Email | Notifications, documents | Out | 3 | Provider not selected (`SD-20`) |
| SMS | Notifications | Out | 3 | Provider not selected (`SD-20`) |
| Payment gateway | Online collection | Both | 5 | Provider not selected (`SD-20`) |
| Bank statement import | Reconciliation | In | 6 | Import only — no transfer execution |
| Egyptian e-invoice / e-receipt | Tax compliance | Out | 6 | Applicability unconfirmed (`SD-08`, conflict `C-04`) |
| Maps | Address and location | Out | 2+ | Not configured |

Two boundaries that are not negotiable:

- **Banking is import-only.** Transfer execution is out of scope (MASTER-MAPPING §15). Gap `G-01` adds an
  internal request → review → approval → **proof of execution** workflow; the execution itself happens at
  the bank, outside the system, and its evidence is attached.
- **No raw card data, CVV, or banking credentials are ever stored.** Payment references and provider
  tokens only.

## 2. Adapter contract

Every provider is reached only through an adapter. No domain module imports a provider SDK — lint-enforced.

1. **Domain-typed interface.** Provider payload shapes, provider enums, and SDK objects do not cross the
   boundary. Mapping between provider vocabulary and ALOLA vocabulary happens inside the adapter.
2. **Pinned API version**, recorded in configuration and in `../MEMORY.md`. Upgrades are deliberate changes
   with their own testing.
3. **Capability reporting.** The adapter reports what the connected account can actually do. Unavailable
   capabilities are hidden or clearly disabled in the UI — never failing silently, and never offering an
   action the provider will reject.
4. **Secrets are server-side only**: encrypted at rest, minimally scoped, revocable, never sent to the
   frontend, redacted in logs.
5. **Errors are translated** into domain errors carrying a stable code, the provider request ID, whether the
   failure is retryable, and actionable guidance. A raw provider error string is never shown to a user.
6. **Contract tests against recorded fixtures**, refreshed when the provider changes.

## 3. Webhooks

### Inbound pipeline

```
verify signature ──▶ validate shape ──▶ record event ID ──▶ enqueue ──▶ 200 OK
      │ fail              │ fail            │ duplicate
      ▼                   ▼                 ▼
  reject + log       reject + log      ack + discard
```

1. **Signature verification is mandatory and happens first.** An unverified webhook is rejected and logged,
   never processed "just in case".
2. **Provider event IDs are stored with a unique index.** A duplicate is acknowledged with `200` and
   discarded. Providers retry by design — duplicate delivery is expected operation, not an error. Returning
   an error to a duplicate causes the provider to retry harder.
3. **Acknowledge fast, process asynchronously.** The endpoint validates, records, enqueues, and returns.
   Business processing happens in the worker, so a slow domain operation cannot trigger a provider retry
   storm or a delivery-disable.
4. **Replay protection:** timestamp tolerance in addition to the event ID check.
5. Webhook endpoints are rate-limited and exempt from session authentication — they authenticate by
   signature, which is why signature verification cannot be optional.

### Lead capture specifics (Phase 3)

Verify signature → store provider event ID → fetch permitted lead data **server-side** → normalize →
deduplicate against existing customers → create or update CRM records → attach campaign, ad set, ad, and
form attribution → assign per rules (`SD-04`) → notify.

Deduplication uses normalized phone numbers. A duplicate lead must update and attribute, never create a
second customer — MASTER-MAPPING §9.2 requires controlled matching to prevent silent duplicates.

## 4. Jobs and reliability

| Concern | Rule |
|---|---|
| Idempotency | Every retryable job is safe to run twice. No double-send, double-create, double-post, double-charge. |
| Retries | Exponential backoff with jitter, bounded attempts |
| Dead letters | Exhausted jobs land in a dead-letter queue, visible to operators and replayable |
| Rate limits | Handled as normal operation; provider retry hints respected |
| Reconciliation | Scheduled incremental reconciliation detects missed webhooks and provider/internal divergence, and reports it |
| Visibility | Connection state, token validity, last successful sync, last error, and **data freshness** exposed per integration |

**Webhooks are not a delivery guarantee.** Reconciliation is not a redundant belt-and-braces measure — it
is the mechanism that catches events lost during an outage, a token expiry, or a delivery-disable. Stale
data must be **labelled stale** in the UI rather than presented as current.

## 5. Messaging (WhatsApp)

- Official Cloud API only. Approved templates only.
- **Consent is checked before every send.** An opt-out suppresses sends immediately.
- Language selected per customer preference.
- Quiet hours respected, in the organization timezone
  ([ADR-0008](../decisions/adr-0008-utc-storage-and-display-timezone.md)).
- Delivery status — sent, delivered, read, failed — recorded per message and surfaced in the timeline. The
  Arabic scope document requires exactly these four states (p8).
- **One send per installment per reminder type.** Reminders stop as soon as confirmed allocation satisfies
  the due amount, and reschedule safely after an approved schedule change.
- Manual resend is a distinct permission and is audited.
- The mandatory reminder is **15 days before the due date**; additional reminders are configurable and
  blocked on `SD-09`.

## 6. Meta boundary summary

Governed in full by [ADR-0011](../decisions/adr-0011-meta-operating-boundary.md). The essentials:

- **Internal budget authorization** (ERP) and **provider payment configuration** (Meta) are separate
  concepts and must never be conflated in code, UI, or either language's copy.
- "Fund / Approve Campaign" means internal authorization only. Meta charges its own configured method.
- Never store Meta passwords, card numbers, or CVV. Never display a wallet balance or funds figure Meta
  does not officially expose. Never imply top-up, invoicing, or credit that is not verified for that exact
  account.
- Publishing requires: valid mapped assets, passing preflight validation, content approval, budget
  approval, and publish permission — each independently tested.
- Spend may not exceed the internal approved amount without reapproval, even if Meta would permit it.
- **Scope (`SD-14`, approved):** through official Meta APIs where officially available — asset connection;
  campaign, ad-set, creative, and advertisement creation; supported Lead Form creation and selection;
  supported audience management; content review; campaign-budget approval; publishing approval; publish,
  pause, resume, edit, duplicate, and archive; lead capture; insights; spend monitoring; attribution through
  opportunity, reservation, contract, collection, and revenue; and finance reconciliation. Employees do not
  need routine Ads Manager access. Payment methods stay with an authorized account owner in Meta's billing
  tools.
- **Conversions API (`SD-15`, approved, gated):** adapter built; production delivery off by default until
  ten recorded preconditions are met ([ADR-0017](../decisions/adr-0017-meta-conversions-api-gated-activation.md)).

## 7. Required tests per integration

1. Invalid signature rejected.
2. Replayed event ID acknowledged and discarded — exactly one effect.
3. Duplicate delivery produces one effect.
4. Job run twice produces one effect.
5. Provider error mapped to a domain error with a stable code and the provider request ID.
6. Rate-limit response handled without data loss.
7. Revoked or expired token surfaces an actionable error, not a crash.
8. Reconciliation detects an event deliberately dropped from the webhook path.
9. Partial provider failure leaves no half-applied internal state.
10. No secret appears in any log line.
