# ADR-0026 — Demonstration mode: what is real, what is simulated, and how the difference is shown

- Status: Accepted
- Date: 2026-09-22
- Deciders: Implementation team
- Scope: Integration, Governance

## Context

Macro Phase 1 ([ADR-0025](adr-0025-macro-delivery-phases.md)) puts a working system in front of a client.
Parts of the demonstrated journey depend on external providers that are deliberately **not connected**:

- **Meta** — campaign publication, spend, insights. Connecting would need an app review, a business
  account, and real advertising money (ADR-0011, ADR-0017).
- **WhatsApp Business Platform** — installment reminder delivery. Needs a verified business account and
  approved message templates.
- **Payment providers and banks** — settlement and reconciliation. The provider is not even selected
  (`SD-20`), and ALOLA ERP never executes a bank transfer (MASTER-MAPPING §15).

A demonstration is exactly the situation in which a fabricated capability is most tempting and most
damaging: a screen showing "campaign published" or "reminder sent" reads as a commitment, and the client
would reasonably plan around it. ADR-0011 already settled the principle for Meta billing — *never present
a capability the system does not have*. This ADR applies it across the demonstration.

## Decision

### 1. The primary journey is real

Every step of dashboard → lead → opportunity → unit selection → reservation → contract → installment
schedule → collection → receipt → reminder record runs against the real application: real HTTP routes,
real Zod validation, real permission and scope enforcement, real MongoDB persistence, real transactions,
real audit records. Nothing on that path is stubbed, faked, or hard-coded in the client.

### 2. Provider-dependent actions are simulated behind the same adapter interface they will later use

Where a provider would act, the demonstration uses a **simulated adapter** that implements the port the
real adapter will implement (ADR-0010). The simulation:

- records the same domain state the real adapter would produce a result for (a reminder row, a campaign
  draft), so the internal data model is the one the product keeps;
- **never** claims the external effect happened. A reminder reaches the state `simulated` — not `sent`;
- is development-only and is refused outside development, the same way `DevKeyEncryptor` is;
- can be switched off entirely, and the feature must remain correct with nothing behind the port. A
  reminder that no adapter delivers is still a correct, visible, auditable reminder.

### 3. The interface states the boundary in both languages, in place

Every screen and control whose effect depends on an unconnected provider carries a visible marker, next to
the control — not in a footnote, not only in a tooltip:

| Context | Arabic | English |
|---|---|---|
| Section-level | `وضع تجريبي` | `Demo mode` |
| Meta | `منصة Meta غير متصلة` | `Meta not connected` |
| WhatsApp | `محاكاة — واتساب غير متصل` | `Simulation — WhatsApp not connected` |
| Generic provider | `غير متصل` | `Not connected` |

The marker is a translation key like any other text (I18N-002), so it can never appear in one language
only.

### 4. Actions that would spend money or publish externally do not exist

There is no "publish campaign" button that does nothing, and no "send now" that silently no-ops. A control
whose real effect is unavailable is either absent or explicitly labelled as producing a **local draft** or
a **simulated** record. A draft is stored in a field that is clearly separate from any external
publication state, so that connecting the provider later adds a state rather than reinterpreting one.

### 5. Generated documents say what they are

A printable reservation summary, contract summary or receipt produced in the demonstration is labelled as
a **demonstration document**. It is not presented as an approved company template and carries no claim of
legal effect. The final templates are stakeholder input (`SD-10`, `SD-17`) and are not invented here.

## Consequences

Accepted:

- **The demonstration shows less than a connected system would.** That is the point: what it shows is
  true. A client who sees `منصة Meta غير متصلة` learns something accurate about project state, which is
  more useful than a screen that implies an integration exists.
- **Two states per provider-dependent record.** `simulated` alongside `sent`, local draft alongside
  published. Slightly more state than a connected system needs, and it is the state that stops the two
  being confused when the provider does arrive.
- **A simulated adapter is code that will be deleted.** Small, deliberate, and confined to a single file
  per port.

Rejected alternatives:

- **Hard-code demo screens with fixture data.** Fastest, and it proves nothing — the client would be shown
  a picture, not a system, and the code would have no future.
- **Connect the providers for the demonstration.** Needs accounts, app review, approved templates and real
  money, and none of it fits in 48 hours. It would also mean production credentials in a development
  environment, which ADR-0015 forbids.
- **Show the actions unlabelled and explain verbally.** A verbal caveat does not survive the meeting.
  Screenshots do.

## Compliance

- No domain module imports a provider SDK; the port is the only contact surface (ADR-0010).
- The simulated adapter refuses to run outside development, and a test asserts the refusal.
- The demonstration's own tests assert that a reminder with no adapter configured is still created,
  listed and auditable.
- `docs/MEMORY.md` and the demo runbook both list, by name, every capability that is simulated rather
  than connected.

## References

- [ADR-0010](adr-0010-integration-adapter-boundary.md) — all providers behind versioned adapters
- [ADR-0011](adr-0011-meta-operating-boundary.md) — Meta operating boundary and billing honesty
- [ADR-0017](adr-0017-meta-conversions-api-gated-activation.md) — Conversions API gated activation
- [ADR-0025](adr-0025-macro-delivery-phases.md) — macro delivery phases
