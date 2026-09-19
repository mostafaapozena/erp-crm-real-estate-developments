# Architecture Documentation

This directory describes **how** ALOLA ERP is built. It is deliberately narrow in purpose:

| Question | Document |
|---|---|
| What is the product and what is in scope? | `../MASTER-MAPPING.md` |
| Why is the implementation shaped this way? | `../decisions/` (ADRs) |
| How is it built? | This directory |
| What is the current state? | `../MEMORY.md` |
| What must stakeholders still decide? | `../decisions/open-decisions.md` |

## Contents

| Document | Covers |
|---|---|
| [overview.md](overview.md) | System context, process topology, module boundaries and dependency direction, request lifecycle |
| [security-model.md](security-model.md) | Identity, sessions, permissions, data scopes, field security, separation of duties, audit |
| [data-model-conventions.md](data-model-conventions.md) | Identifiers, money, dates, status machines, concurrency, transactions, idempotency, indexes, soft state |
| [localization-and-theming.md](localization-and-theming.md) | i18n mechanics, direction handling, typography, the design token contract |
| [integrations.md](integrations.md) | Adapter contract, webhook handling, job reliability, provider registry |
| [environments.md](environments.md) | Configuration contract, local development options, fail-safe startup |

## Rule for these documents

**These documents describe decided design, not aspirations.** If a document here disagrees with the code,
the code is the truth and the document is a defect to be corrected — per `CLAUDE.md`: "When documentation
conflicts with verified code, stop, investigate, and correct the documentation. Never guess."

Nothing in this directory invents a business rule. Business rules, thresholds, and policies are
stakeholder inputs tracked in [../decisions/open-decisions.md](../decisions/open-decisions.md). Where a
document needs a value that has not been confirmed, it names the blocking `SD-` item rather than
supplying a plausible default.

## Status

Written during Phase 1 discovery and updated on 2026-09-19 for the stakeholder decisions `SD-13`–`SD-16`
and `SD-22`. Each document is revised against the implementation as Phase 1 proceeds, and every phase gate
includes a documentation reconciliation step.
