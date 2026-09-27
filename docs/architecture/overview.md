# Architecture Overview

## 1. System context

A real-estate CRM and ERP used internally by one company's staff across sales, marketing,
collections, finance, procurement, construction, HR, and customer service. It is not a public product.

**Deployment model — single tenant per deployment, multi-client product**
([ADR-0027](../decisions/adr-0027-single-tenant-per-deployment.md)). The same codebase is sold to
several real-estate companies, and **each company runs its own deployment**: its own database, Redis,
file storage, secrets, keys, backups, domain and provider accounts. There is no shared client
database, no tenant identifier on any record, no cross-company administrator and no tenant switcher.
Everything that differs between companies is configuration held by the deployment — the company
profile and branding, organization, settings and reference data, numbering, templates, approval
policies — never a source fork. The product was commissioned by ALOLA Developments, whose deployment
is the first.

| Actor | Interaction |
|---|---|
| The company's employees | Authenticated web application, permission-scoped |
| Customers | Receive WhatsApp reminders, documents, and PDFs. Optionally, a customer portal (PORTAL-CUSTOMER) if separately approved. |
| Meta | Full campaign management from the ERP, lead webhooks, insights, spend, attribution (`SD-14` approved); Conversions API optional with production delivery gated (ADR-0017) |
| WhatsApp Business Platform | Template messages, delivery status webhooks, inbound messages |
| Banks | Statement import only. No transfer execution — see `../decisions/adr-0011-meta-operating-boundary.md` for the analogous honesty principle, and MASTER-MAPPING §15. |
| Payment gateway, email, SMS, e-invoicing, maps | Behind adapters; providers not yet selected (`SD-20`) |

## 2. Process topology

Three deployable processes over shared infrastructure:

```
                    ┌──────────────────────┐
   Browser ────────▶│  apps/web            │  React + Vite + Material UI
   (Arabic RTL /    │  static SPA          │  Consumes packages/ui, packages/i18n
    English LTR)    └──────────┬───────────┘
                               │ REST + JSON (Zod-validated both ends)
                    ┌──────────▼───────────┐
                    │  apps/api            │  Express, OpenAPI-documented
                    │  authorization,      │  Enforces every permission, scope,
                    │  validation, domain  │  and field restriction (ADR-0006)
                    └──┬────────┬───────┬──┘
                       │        │       │ enqueue
        ┌──────────────▼┐  ┌────▼────┐ ┌▼────────────────┐
        │ MongoDB       │  │ Redis   │ │ apps/worker     │
        │ replica set   │  │ locks,  │ │ BullMQ consumer │
        │ transactions  │  │ queues, │ │ reminders, sync,│
        │ Decimal128    │  │ limits  │ │ webhooks, docs  │
        └───────────────┘  └─────────┘ └────┬────────────┘
                                            │ adapters only
                              ┌─────────────▼──────────────┐
                              │ Meta · WhatsApp · S3 · KMS │
                              │ email · SMS · bank import  │
                              └────────────────────────────┘
```

Why the worker is a separate process: provider calls, PDF generation, and reminder fan-out are slow and
failure-prone. Running them in the API process would couple request latency to provider latency and make
a provider outage look like an application outage. The separation also means webhook endpoints can
acknowledge immediately and process asynchronously, which is what prevents provider retry storms
(`adr-0010-integration-adapter-boundary.md`).

## 3. Repository layout

Per MASTER-MAPPING §4.2 and [ADR-0002](../decisions/adr-0002-technology-stack.md):

```
apps/
  web/          React + Vite SPA
  api/          Express REST API
  worker/       BullMQ job consumer
packages/
  contracts/    Zod schemas + types shared by web, api, worker — one definition per concept
  i18n/         Locale resources, direction, formatters
  ui/           Design system over the Light Mode token set
  config/       Validated environment configuration
  security/     Authorization primitives, scoped repositories, redaction
  testing/      Factories, fixtures, harnesses
docs/
  MEMORY.md, MASTER-MAPPING.md, PHASE-PROMPTS.md, REQUIREMENTS.md, glossary.md
  architecture/  decisions/  phases/  discovery/
```

The Phase 1 scaffolding of all nine workspaces exists as of 2026-09-19; see `../MEMORY.md` for verified
status. `packages/security/` currently holds logging redaction, encryption, private-file, and upload
foundations; authorization primitives and scoped repositories arrive with `SEC-023`–`SEC-032`.

## 4. Module boundaries

The application is a modular monolith ([ADR-0001](../decisions/adr-0001-modular-monolith.md)). The
module catalog is authoritative in MASTER-MAPPING §8 and is not duplicated here.

### Dependency direction

Dependencies point **inward and downward only**. There are no cycles.

```
  Layer 4  Orchestration    cross-module workflows (contract activation, cancellation,
                            campaign publish, payroll run)
              │ may call ▼
  Layer 3  Domain modules   CORE-* · INV-* · CRM-* · MKT-* · SALE-* · COL-* · FIN-*
                            PROC-* · WH-* · CONST-* · HR-* · HAND-* · CS-*
              │ may call ▼
  Layer 2  Shared packages  security · contracts · config · i18n · ui · testing
              │ may call ▼
  Layer 1  Infrastructure   MongoDB · Redis · S3 · KMS · provider adapters
```

Rules that keep this real rather than decorative:

1. A domain module exposes a **published interface**. Other modules import only that interface — never
   another module's models, schemas, repositories, or internal helpers.
2. **Cross-module workflows live in the orchestration layer.** A domain module does not orchestrate
   another. Contract activation touches SALE, INV, COL, and FIN — it belongs in orchestration, not inside
   SALE reaching into the others.
3. **No cycles.** If two modules need each other, either the dependency belongs in orchestration, or the
   shared concept belongs in `packages/`.
4. **CORE-\* modules are foundational** and may be depended on by any module; they depend on no business
   module. A CORE module importing INV or CRM is a boundary violation.
5. **Transactions may span modules.** This is a deliberate benefit of the monolith, not a violation —
   contract activation must be atomic across SALE, INV, COL, and FIN.
6. Enforced by a lint import-boundary rule that fails CI, plus contract tests per published interface.
   Without enforcement, module isolation degrades silently — which is the known failure mode of this
   architecture.

## 5. Request lifecycle

Every API request passes the same ordered pipeline. The order matters: each step assumes the previous one
succeeded.

| # | Step | Failure result |
|---|---|---|
| 1 | Assign or propagate correlation ID | — |
| 2 | Security headers, CORS, rate limit | `429` / rejected |
| 3 | Authenticate session; rotate refresh token where applicable | `401` |
| 4 | **Validate input** against the `packages/contracts/` Zod schema | `400` with field errors |
| 5 | **Authorize the action** — permission for verb + entity type | `403` |
| 6 | Resolve the actor's **data scope** | — |
| 7 | Execute domain logic, with the scope applied **inside every query** | `404` for out-of-scope records — indistinguishable from nonexistent |
| 8 | For mutations: open a transaction; check idempotency key; apply; write audit | `409` on conflict or duplicate |
| 9 | **Strip protected fields** for this actor | — |
| 10 | Serialize; emit structured log with redaction | — |

Validation precedes authorization deliberately: an authorization decision made on unvalidated input can
be made against a value the domain will later coerce differently.

Step 7 is the step most often got wrong. Scope belongs in the query, never as a post-filter — a post-filter
leaks through counts, aggregates, pagination totals, and exports even when the returned rows look correct.

## 6. Cross-cutting concerns

| Concern | Where it lives | Reference |
|---|---|---|
| Authorization, scopes, field security | `packages/security/` | [ADR-0006](../decisions/adr-0006-server-side-authorization.md) |
| Money | `packages/contracts/` money type, `Decimal128` storage | [ADR-0007](../decisions/adr-0007-decimal-safe-money.md) |
| Time | UTC storage, organization timezone for display | [ADR-0008](../decisions/adr-0008-utc-storage-and-display-timezone.md) |
| Record lifecycle | Reversal, cancellation, archival, deactivation | [ADR-0009](../decisions/adr-0009-no-hard-delete.md) |
| Localization and direction | `packages/i18n/` | [ADR-0003](../decisions/adr-0003-arabic-first-localization.md) |
| Theme tokens | `packages/ui/` | [ADR-0005](../decisions/adr-0005-light-mode-design-tokens.md) |
| Providers | Adapters in integration modules | [ADR-0010](../decisions/adr-0010-integration-adapter-boundary.md) |
| Configuration | `packages/config/`, validated at startup | [ADR-0012](../decisions/adr-0012-local-development-infrastructure.md) |
| Observability | Pino with redaction, correlation IDs, Sentry, CloudWatch | [environments.md](environments.md) |

## 7. Known architectural risks

Recorded so they are monitored rather than rediscovered.

| Risk | Consequence | Mitigation |
|---|---|---|
| Module isolation is a convention, not a runtime boundary | Boundaries erode into a tangle; extraction becomes impossible | Lint-enforced import rules from Phase 1, before there is anything to untangle |
| Data-scope enforcement depends on every query being scoped | One unscoped query is a data leak that tests may not catch | Scoped-repository helper makes the safe path the default; unscoped access requires explicit justification |
| MongoDB transactions require a replica set | Core invariants cannot be verified locally without one | Atlas development cluster approved ([ADR-0018](../decisions/adr-0018-development-infrastructure-selection.md)); provisioning pending |
| No integration coverage until the Atlas cluster exists | Phase gates cannot pass on unit tests alone | Reported honestly in `../MEMORY.md`; skipped tests never counted as passes |
| Full Meta authoring scope approved (`SD-14`) | Broader Meta write permissions lengthen app review | App review is a Phase 3 lead-time item under `SD-19`; start it early |
| Single deployable unit | One failure affects all domains | Separate worker process, per-dependency health checks, idempotent retryable jobs |

## 8. Out of scope for the initial release

Microservices, native mobile applications, multi-region active-active deployment, direct bank transfer
execution, and Dark Mode. See MASTER-MAPPING §15. Each would require a new ADR and explicit approval.
