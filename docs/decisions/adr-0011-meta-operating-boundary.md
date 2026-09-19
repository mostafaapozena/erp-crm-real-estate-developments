# ADR-0011 — Meta operating boundary and billing honesty

- Status: Accepted · Scope conflict `SD-14` closed; `SD-15` approved with gated activation (see status update)
- Date: 2026-09-19
- Deciders: ALOLA business owner (approved decision), implementation team
- Scope: Integration

## Context

The product intends authorized staff to manage Meta advertising from the ERP without routine access to
Ads Manager. This creates a specific and serious risk: presenting ERP capabilities that Meta does not
actually grant. The most dangerous version is billing. An ERP screen showing a "wallet balance" or an
"Add Funds" button that Meta does not expose via API would be a fabricated capability — users would
believe a campaign is funded when it is not, campaigns would stop delivering, and the ERP would be the
proximate cause.

There is also a legitimate internal need that must not be confused with provider billing: ALOLA must
control which campaigns are authorized to spend how much, against which project and cost center.

## Decision

### Two separate concepts, never conflated in code, UI, or documentation

| Concept | Owner | What it is |
|---|---|---|
| **Internal budget authorization** | ALOLA, in the ERP | An approval that a campaign may spend up to an amount, allocated to a project and cost center. Purely internal. |
| **Provider payment configuration** | Meta, configured by an authorized owner | The payment method and funds Meta actually charges. Outside the ERP. |

The ERP action "Fund / Approve Campaign" means **internal authorization only**. Publishing applies the
approved budget to the Meta campaign; Meta then charges its own previously configured payment method or
balance. This distinction must be explicit in the UI label, the help text, and both locales.

### Prohibited without a separately approved, verified official capability

- storing Meta account passwords, card numbers, CVV, or online banking credentials — **prohibited absolutely**
- generic "add payment method" or "top up Available Funds" actions
- displaying a wallet balance, available funds, or credit figure that Meta does not officially expose
  for that exact account
- implying monthly invoicing or extended credit
- any representation that ALOLA can bypass Meta policy review, delivery decisions, billing controls,
  permissions, or rate limits

### One-time owner setup stays outside the ERP

A Meta administrator initially owns and configures the Business Portfolio, ad account, Page, Instagram
account, app, asset access, and payment method. These steps are documented as one-time external
prerequisites, not modelled as ERP features.

### Publishing preconditions

A campaign may be published from the ERP only when all of the following hold: valid mapped assets,
passing preflight validation of objective/destination/optimization/creative/form/audience combinations,
content approval, budget approval, and the actor holding publish permission. A creator cannot approve
their own budget or publish unless an explicit authorized policy permits it.

### Spend control

Actual spend may not exceed the internal approved amount without reapproval, **even if Meta would
permit it**. Consumption thresholds, overrun, billing failure, disabled accounts, and stale sync all
raise alerts.

### Honest reporting

Meta remains authoritative for policy review, delivery, billing failure, and API limitations. The ERP
displays those outcomes accurately, including rejections and errors, with actionable guidance. Where the
connected account or current API version does not support a control, the ERP hides or clearly disables
it rather than failing silently.

### Scope note

The breadth of Meta campaign authoring in the Master Mapping substantially exceeds what the client-facing
Arabic business scope requests, which asks for campaign linkage and measurement only. That difference is
recorded as conflict **C-02** and is an open stakeholder item (`SD-14`). This ADR governs *how* Meta is
integrated whatever scope is approved; it does not itself approve the broader scope.

Similarly, the Conversions API (MKT-CAPI) is not requested by the client document and carries
data-protection obligations. It stays out of the baseline until legal basis and consent language are
approved — conflict **C-03**, open item `SD-15`.

### Status update — 2026-09-19

The scope note above is historical. Stakeholder decisions:

- **`SD-14` approved and closed.** The full Meta scope in `docs/MASTER-MAPPING.md` is the current
  requirement and supersedes the narrower scope in the Arabic PDF. Through official Meta APIs where
  officially available, the ERP supports: Meta asset connection; campaign, ad-set, creative, and
  advertisement creation; supported Lead Form creation and selection; supported audience management;
  content review; campaign-budget approval; publishing approval; publish, pause, resume, edit, duplicate,
  and archive; lead capture; campaign insights; spend monitoring; attribution through opportunity,
  reservation, contract, collection, and revenue; and finance reconciliation. Employees do not need
  routine access to Meta Ads Manager. Meta payment methods remain configured by an authorized account
  owner using Meta-supported billing tools. Everything in the Decision section above — no card/CVV
  storage, no unsupported Add Funds, internal authorization kept separate from provider payment — is
  unchanged and applies to the full scope.
- **`SD-15` approved as an optional, controlled integration**, with production delivery disabled by
  default. Governed by [ADR-0017](adr-0017-meta-conversions-api-gated-activation.md).

## Consequences

**Accepted benefits**

- Users are never misled about whether a campaign can actually spend.
- The internal approval trail is complete and auditable independently of Meta.
- Capability-driven UI prevents users from attempting actions the provider will reject.

**Accepted costs**

- Some funding steps remain manual and outside the ERP. Accepted: this is honest rather than convenient.
- Capability detection adds complexity to every campaign screen. Accepted.
- Two budget concepts require careful bilingual wording so Arabic and English both make the distinction
  clear. Accepted as a localization requirement, tracked in the glossary.

## Compliance

- No field in any schema may store a card number, CVV, or provider password. Reviewed at every gate.
- Tests assert that publishing is blocked without each precondition independently.
- Tests assert spend overrun requires reapproval.
- Every provider mutation writes an audit record with the provider request ID.
- UI copy review at each gate verifies that no screen implies a funding capability the adapter does not
  report.

## References

- `docs/MASTER-MAPPING.md` §2.9, §8 Meta operating boundary, §9.12–9.15, §14, §15
- `CLAUDE.md`; user-approved decisions on Meta billing
- [ADR-0010](adr-0010-integration-adapter-boundary.md)
- [../discovery/arabic-scope-review.md](../discovery/arabic-scope-review.md) — C-02, C-03
