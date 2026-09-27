# ADR-0027 — Single-tenant per deployment, multi-client product

- Status: Accepted
- Date: 2026-09-27
- Deciders: Stakeholder (product owner), recorded by the implementation team
- Scope: Architecture, Deployment, Governance

## Context

The system was specified for one company — the Master Mapping names it, and the first nine phases
were planned around its organization. The stakeholder has now decided to **sell the same product to
several real-estate companies**.

That decision can be implemented in two very different ways, and the difference reaches every
collection, every query and every operational procedure:

| | Multi-tenant SaaS | Single tenant per deployment |
|---|---|---|
| Data | One database shared by all clients, every record carrying a tenant key | One database per client |
| Isolation | Enforced by application code on every query | Enforced by infrastructure: there is nothing of another client to reach |
| Blast radius of an authorization bug | Every client | One client |
| Secrets, keys, backups | Shared infrastructure, per-tenant partitioning | Independent per client |
| Provider accounts (Meta, WhatsApp, e-mail) | Multiplexed through one platform | Each client's own |
| Operations | One upgrade for everyone | One upgrade per deployment |

The product already enforces data scope inside every query (ADR-0006). Adding a tenant key to that
would be a second, orthogonal isolation layer on every collection — and a single missed filter would
disclose one company's customers, contracts and payments to another company. For a system holding
national identifiers, bank references and contractual money, that risk is not worth the operational
convenience of a shared database.

## Decision

### 1. One codebase, one independent deployment per client company

Each client company receives its own deployment of the same product:

- its own MongoDB database and its own Redis instance;
- its own private file storage, secrets and encryption keys;
- its own backups and retention;
- its own domain;
- its own Meta, WhatsApp, e-mail, SMS and payment-provider accounts.

**There is no shared client database, no cross-company administrator, no tenant switcher, no SaaS
subscription or billing engine, and no `tenantId` on any collection.** A deployment is one company;
its first legal entity, branch and user all belong to that company, and nothing in it can refer to
another.

### 2. Differences between clients are configuration, never a fork

The same source serves every client. What differs is held in the deployment's own data and
environment:

| Difference | Where it lives |
|---|---|
| Company identity, legal names, registrations, address, contact | The **company profile** (`PLAT-022`) |
| Logo, compact logo, favicon, brand colour, default and offered languages | The company profile, served at runtime (`PLAT-023`, `THEME-013`) |
| Legal entities, branches, departments, teams, reporting lines | `CORE-ORG` records |
| Business defaults, dictionaries, feature flags | Settings and reference data (Foundation F3) |
| Document numbering formats | Number sequences (`CORE-DOC-001`) |
| Contract, receipt and message wording | Document templates (`CORE-DOC-002`) |
| Approval thresholds and segregation of duties | Approval policies (`APPROVAL-002`) |
| Provider credentials | The deployment's environment or secrets manager — **never** the database |

A permanent per-client source branch is refused. A client need that configuration cannot express is a
product change for every client, decided once, not a private patch.

### 3. No client identity in reusable source

Product source must not contain a client company's name, logo, project, telephone number, address,
tax or registration number, bank account, Meta asset or WhatsApp number. User-facing defaults are
**neutral** (the product's own name) and are replaced by the company profile at runtime.

Development-only demonstration data may use clearly fictional companies, reserved domains
(`demo.invalid`) and synthetic identifiers, and is written by the development seed — never shipped as
product data (ADR-0026).

Two kinds of name are **not** client identity and stay as they are:

- **Internal code namespaces** — the `@alola/*` workspace scope, the `alola_rt` cookie name, queue
  and connection names. They identify the codebase, are never shown as the company's identity, and
  renaming them would be churn with no effect on any client. They may be renamed together, in one
  change, if the product is ever given a different code name.
- **Project documentation** that records the history of the engagement that commissioned the product.

### 4. Exactly one company profile per deployment

The profile is a single document under a unique key, so the database itself refuses a second one
however many requests race to create it. It is versioned: every change — a new legal name, a new
logo — raises the version and writes a complete revision to an append-only history, together with an
audit record, in one transaction. A document issued under version 7 can therefore always be explained
with exactly what version 7 said.

The profile holds **no secret of any kind**; its schema is strict, so a request carrying one is
refused rather than stored.

### 5. Branding is read at runtime, validated twice, and always has a fallback

- A public, read-only endpoint (`GET /api/v1/branding`) returns what a browser needs before sign-in:
  names, languages, the brand colour and image URLs. Registration numbers, contact details and history
  are not part of it.
- The brand colour is validated **by the server** when it is saved — against every contrast pair the
  product uses (`TOKEN_PAIRS_IN_USE`, ADR-0005) — and **again by the browser** before it renders. A
  colour that fails any pair is refused on save and ignored on render. Only the brand states are
  derived from it; text, surfaces, borders and status colours are identical in every deployment.
- With no profile, or any failure reading it, the application renders the neutral product identity
  and the approved palette. It never renders a blank screen and never another company's name.
- The sign-in screen's "demonstration environment" notice follows the deployment: it is shown on
  development and test deployments and never on a client's staging or production deployment.

Light Mode only (ADR-0004), Alexandria for Arabic and Inter for English, and Arabic RTL / English LTR
are unchanged and apply to every deployment. The approved blue (`#2563EB`) remains the product default
and the colour of the deployment that commissioned the product.

## Consequences

Accepted:

- **One upgrade per deployment.** Releases must be deployable independently, with explicit schema
  migrations and a repeatable initialization procedure (Foundation F11). This is the price of
  isolation and is paid in tooling, not in shared infrastructure.
- **Configuration grows.** Anything that differs between clients needs a validated configuration
  surface with an audit trail. That surface is built once and reused by every client.
- **No cross-client reporting.** There is no view across companies. None was asked for; if one ever is,
  it will be a separate, explicitly approved product.

Rejected alternatives:

- **Multi-tenant SaaS with a tenant key on every collection** — rejected for the reasons above: a
  second isolation layer on every query, and one missed filter away from a cross-company disclosure.
- **A source fork per client** — rejected: every fix and every security patch would have to be
  applied N times, and the forks would diverge until they could not be.
- **Branding at build time** (environment variables baked into the web bundle) — rejected: a name or
  logo change would need a rebuild and a redeploy, and one build could not serve two deployments.

## Compliance

- No collection carries a tenant identifier; review rejects one.
- `packages/contracts/src/company.ts` and `apps/api/src/modules/company/` implement the profile;
  `packages/ui/src/brand.ts` implements the colour rule for both server and browser.
- User-facing defaults in source are neutral: the authenticator issuer defaults to the product name and
  is replaced by the profile's short name; the OpenAPI title names the product, not a client.
- `docs/operations/client-deployment-checklist.md` and `docs/operations/client-data-intake.md`
  (Foundation F11) describe what each new client deployment needs.

## References

- [ADR-0004](adr-0004-light-mode-only.md), [ADR-0005](adr-0005-light-mode-design-tokens.md) — theme
- [ADR-0006](adr-0006-server-side-authorization.md) — scope inside the query
- [ADR-0015](adr-0015-secrets-and-repository-hygiene.md) — secrets never in the repository
- [ADR-0026](adr-0026-demonstration-mode-boundary.md) — demonstration data and its labelling
