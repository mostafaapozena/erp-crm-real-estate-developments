# Architecture Decision Records

This directory holds the Architecture Decision Records (ADRs) for ALOLA ERP. An ADR captures one
decision, the context that forced it, and the consequences the team accepted. ADRs are append-only:
a decision that changes is **superseded** by a new ADR, never edited in place.

## Why ADRs exist here

`docs/MASTER-MAPPING.md` states *what* the product is. ADRs state *why* the implementation is shaped
the way it is, so that a later reader — or a later session — does not reopen a settled question or
silently violate a constraint whose reason was never written down.

## Status values

| Status | Meaning |
|---|---|
| `Proposed` | Drafted, not yet approved. Do not build against it. |
| `Accepted` | Approved and binding. Code must comply. |
| `Superseded by ADR-NNNN` | Historical. Kept for the record. |
| `Rejected` | Considered and declined. Kept so it is not re-proposed. |

## Index

| ID | Title | Status | Scope |
|---|---|---|---|
| [ADR-0001](adr-0001-modular-monolith.md) | Modular monolith before microservices | Accepted | Architecture |
| [ADR-0002](adr-0002-technology-stack.md) | TypeScript MERN stack and monorepo layout | Accepted | Architecture |
| [ADR-0003](adr-0003-arabic-first-localization.md) | Arabic-first localization with Arabic and English shipped together | Accepted (digits: `SD-23`) | Localization |
| [ADR-0004](adr-0004-light-mode-only.md) | Light Mode only; no Dark Mode, System Mode, or theme switcher | Accepted (`SD-13` closed) | Design |
| [ADR-0005](adr-0005-light-mode-design-tokens.md) | Extended Light Mode semantic token set | Accepted | Design |
| [ADR-0006](adr-0006-server-side-authorization.md) | Authorization enforced on the server and in query scope | Accepted | Security |
| [ADR-0007](adr-0007-decimal-safe-money.md) | Decimal-safe money handling; no binary floating point | Accepted | Data |
| [ADR-0008](adr-0008-utc-storage-and-display-timezone.md) | UTC storage, organization timezone for display | Accepted | Data |
| [ADR-0009](adr-0009-no-hard-delete.md) | No hard deletion of financial, contractual, or audited records | Accepted | Data |
| [ADR-0010](adr-0010-integration-adapter-boundary.md) | All external providers behind versioned adapters | Accepted | Integration |
| [ADR-0011](adr-0011-meta-operating-boundary.md) | Meta operating boundary and billing honesty | Accepted (`SD-14` closed) | Integration |
| [ADR-0012](adr-0012-local-development-infrastructure.md) | Local development without mandatory Docker | Accepted (development topology: ADR-0020) | Environment |
| [ADR-0013](adr-0013-arabic-scope-document-status.md) | Arabic PDF is supplementary, not a technical source of truth | Accepted (extended 2026-09-19) | Governance |
| [ADR-0014](adr-0014-requirement-id-scheme.md) | Stable requirement ID scheme | Accepted (amended by ADR-0016) | Governance |
| [ADR-0015](adr-0015-secrets-and-repository-hygiene.md) | Secrets and repository hygiene | Accepted | Security |
| [ADR-0016](adr-0016-phase-1-requirement-namespaces.md) | Approved Phase 1 requirement namespaces | Accepted (`SEC` boundary: ADR-0019) | Governance |
| [ADR-0017](adr-0017-meta-conversions-api-gated-activation.md) | Meta Conversions API: optional, production delivery gated | Accepted | Integration |
| [ADR-0018](adr-0018-development-infrastructure-selection.md) | Development infrastructure: MongoDB Atlas and a Redis adapter | Accepted (staging/production only since ADR-0020) | Environment |
| [ADR-0019](adr-0019-security-account-organization-employee-boundary.md) | Security account, organization, and employee are separate aggregates | Accepted | Architecture |
| [ADR-0020](adr-0020-local-docker-development-services.md) | Local Docker services for development; managed services for staging and production | Accepted | Environment |
| [ADR-0021](adr-0021-audit-trail-integrity.md) | Audit trail integrity: what the application guarantees, and what it cannot | Accepted | Security |
| [ADR-0022](adr-0022-authorization-resolved-per-request.md) | Authorization state is resolved per request, with no permission cache | Accepted | Security |
| [ADR-0023](adr-0023-password-hashing-and-session-tokens.md) | Password hashing, session tokens, and the second factor | Accepted | Security |
| [ADR-0023](adr-0023-password-hashing-and-session-tokens.md) | Password hashing, session tokens, and the second factor | Accepted | Security |

## Open items

Decisions that are **not** the implementation team's to make — business rules, thresholds, legal
entities, accounting policy, brand assets — are tracked separately in
[open-decisions.md](open-decisions.md). No ADR may assume an answer to an open item.

## Writing a new ADR

1. Copy the structure of any existing ADR: Context, Decision, Consequences, Compliance, References.
2. Number it with the next free integer. Never reuse a number.
3. Add a row to the index above.
4. If it replaces an earlier decision, set the earlier ADR's status to `Superseded by ADR-NNNN` and
   explain the change in the new ADR's Context.
5. Record it in `docs/MEMORY.md` under approved decisions.

## Status updates

The **Decision** section of an accepted ADR is never rewritten. When a linked stakeholder item closes, or a
later ADR selects an option or amends one rule, a dated **Status update** section is appended and the
status line notes it. The original text stays, so the reasoning at the time remains readable.
