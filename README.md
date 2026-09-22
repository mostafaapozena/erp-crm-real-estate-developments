# ALOLA Real Estate CRM & ERP

Implementation control centre for the ALOLA Real Estate CRM & ERP — a secure, Arabic-first modular
monolith connecting marketing, leads, inventory, sales, collections, accounting, procurement,
construction, HR, handover, and after-sales in one auditable platform.

**Current state: Phase 1. Discovery approved; application scaffolding complete and awaiting Phase 1 review.**
See [docs/MEMORY.md](docs/MEMORY.md) for verified status.

## Documentation map

### Start here

| Document | Purpose |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Mandatory instructions. Read first, every session. |
| [docs/MEMORY.md](docs/MEMORY.md) | Live project state, blockers, and the exact next action. |
| [docs/MASTER-MAPPING.md](docs/MASTER-MAPPING.md) | Product scope, architecture, modules, phases, acceptance gates. |
| [docs/PHASE-PROMPTS.md](docs/PHASE-PROMPTS.md) | Execution prompt for each of the nine phases. |

These four, together with the approved ADRs in [docs/decisions/](docs/decisions/), are the **implementation
sources of truth**. Later written stakeholder decisions supersede conflicting statements in the Arabic PDF.

### The client demonstration

| Document | Purpose |
|---|---|
| [docs/demo/runbook.md](docs/demo/runbook.md) | How to run the demonstration: services, seed, accounts, reset, and what to do when something is wrong. |
| [docs/demo/walkthrough-ar.md](docs/demo/walkthrough-ar.md) | The Arabic presentation script — what to say, in order, in ten to fifteen minutes. |

### Requirements and terminology

| Document | Purpose |
|---|---|
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Stable requirement IDs and their status. Phase 1 enumerated in full. |
| [docs/glossary.md](docs/glossary.md) | Approved Arabic/English terminology across 12 domains. |

### Decisions

| Document | Purpose |
|---|---|
| [docs/decisions/](docs/decisions/) | 20 Architecture Decision Records — *why* the implementation is shaped as it is. |
| [docs/decisions/open-decisions.md](docs/decisions/open-decisions.md) | Stakeholder decisions, each assigned to the phase it blocks. **17 open, none blocking Phase 1 scaffolding.** |

### Architecture

| Document | Purpose |
|---|---|
| [docs/architecture/overview.md](docs/architecture/overview.md) | System context, process topology, module boundaries, request lifecycle. |
| [docs/architecture/security-model.md](docs/architecture/security-model.md) | Identity, authorization layers, field security, audit. |
| [docs/architecture/data-model-conventions.md](docs/architecture/data-model-conventions.md) | Identifiers, money, time, concurrency, transactions, idempotency. |
| [docs/architecture/localization-and-theming.md](docs/architecture/localization-and-theming.md) | i18n, direction, typography, design tokens. |
| [docs/architecture/integrations.md](docs/architecture/integrations.md) | Adapter contract, webhooks, job reliability. |
| [docs/architecture/environments.md](docs/architecture/environments.md) | Configuration contract and local development options. |

### Phases and discovery

| Document | Purpose |
|---|---|
| [docs/phases/README.md](docs/phases/README.md) | Phase index, dependencies, client-stage crosswalk. |
| [docs/phases/phase-gates.md](docs/phases/phase-gates.md) | The checklist every phase must pass. |
| [docs/phases/phase-1-discovery-checklist.md](docs/phases/phase-1-discovery-checklist.md) | Phase 1 discovery deliverables and outstanding inputs. |
| [docs/discovery/arabic-scope-review.md](docs/discovery/arabic-scope-review.md) | Arabic business scope reviewed against the Master Mapping. |

### Supplementary

[docs/source/alola-client-business-scope-ar.pdf](docs/source/README.md) (originally `نطاق_أعمال_نظام_شركة_العلا_للتطوير_العقاري.pdf`) — the Arabic
client-facing business scope document, committed byte-for-byte with its SHA-256 recorded. It is
a **supplementary client-facing business document**, not a technical source of truth. See
[ADR-0013](docs/decisions/adr-0013-arabic-scope-document-status.md).

## Non-negotiable constraints

These are settled. Each has an ADR; none is a preference.

- **Arabic is the default language.** Arabic and English ship together in the same change; a missing key
  in either locale fails CI. Arabic RTL and English LTR from the first component.
- **Light Mode only.** No Dark Mode, System Mode, theme switcher, or per-user theme preference.
- **Semantic design tokens only.** Components never hard-code a colour value.
- **Authorization on the server and inside the query.** Never only in the UI. Fetch-then-filter is prohibited.
- **Decimal-safe money.** Never binary floating point for financial calculations.
- **UTC storage**, organization timezone for display.
- **No hard deletion** of financial, contractual, inventory-history, audit, check, or note records.
- **Official provider APIs only**, behind versioned adapters. Webhooks verify signatures; retryable jobs
  are idempotent.
- **Never commit or log** secrets, tokens, credentials, production personal data, card data, or document
  contents.

## Working in this repository

1. Read [CLAUDE.md](CLAUDE.md) and [docs/MEMORY.md](docs/MEMORY.md) completely before planning anything.
2. Read the relevant Master Mapping sections and the current phase prompt.
3. Inspect the actual repository — code, tests, configuration, Git status — before trusting any document.
   **When documentation conflicts with verified code, the code wins and the document is corrected.**
4. Work one bounded requirement group at a time, referencing requirement IDs.
5. Do not begin the next phase until the current gate is verified and explicitly approved.
6. Update [docs/MEMORY.md](docs/MEMORY.md) and [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) after every
   completed feature, fix, migration, or material decision.

## Getting started

Requires Node.js 24 (see `.nvmrc`). No database, Redis, or Docker is needed to build and test.

```sh
npm install
npm run verify      # lint, format, typecheck, i18n keys, secret scan, unit tests, production build, bundle budget
npm run dev:web     # http://localhost:5173 — Arabic RTL by default
npm run dev:api     # http://localhost:4000
```

For the database, Redis, and the integration tier (needs Docker Desktop with WSL 2):

```sh
npm run dev:services:up        # MongoDB replica set + Redis in Docker; writes .env for you
npm run test:integration:gate  # fails rather than skips when the services are missing
npm run dev:services:down     # stop containers, keep the data volumes
```

## Running the demonstration

```sh
npm run dev:services:up
npm run seed:demo              # fictional organization, accounts, inventory, contracts, collections
npm run dev:api                # then, in another terminal:
npm run dev:web                # http://localhost:5173
```

The generated passwords are written to `.demo-credentials.md`, which is **ignored by Git**; nothing is
printed to the terminal or written to a log. Open that file to sign in. `npm run seed:demo` is
idempotent, refuses to run against anything that is not a local development database, and
`npm run seed:demo:reset -- --confirm` removes exactly what it created.

[docs/demo/runbook.md](docs/demo/runbook.md) is the operational guide — accounts, resets, and what to
do when something is wrong. [docs/demo/walkthrough-ar.md](docs/demo/walkthrough-ar.md) is the Arabic
presentation script for the client demonstration.

**The demonstration is a vertical slice, not a finished product.** Meta advertising, WhatsApp delivery
and payment providers are **not connected**, and the screens say so
([ADR-0026](docs/decisions/adr-0026-demonstration-mode-boundary.md)).

The full command list, test tiers, and service setup are in
[docs/architecture/environments.md](docs/architecture/environments.md). Pinned dependency versions and
the reasons for them are in [docs/architecture/dependencies.md](docs/architecture/dependencies.md).

## Repository status

- Local Git repository on branch `main`. **No remote configured. Nothing has been pushed or deployed.**
- `.gitignore` in place and verified with `git check-ignore`.
- See [docs/MEMORY.md](docs/MEMORY.md) for what is installed, configured, and verified.
