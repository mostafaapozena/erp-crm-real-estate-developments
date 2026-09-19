# ALOLA ERP — Project Memory

Last updated: 2026-09-19
Blueprint documents: `MASTER-MAPPING.md` v2.0, `PHASE-PROMPTS.md` v2.0
Repository: local Git · Branch: `main` · **No remote, nothing pushed, nothing deployed**
Latest commit: initial documentation baseline (this commit)

## Project identity

- Product: ALOLA Real Estate CRM & ERP
- Architecture: TypeScript MERN modular monolith
- Frontend: React, Vite, Material UI · Backend: Node.js, Express · Database: MongoDB
- Jobs: BullMQ + Redis · Files: private AWS S3 · Encryption: AWS KMS
- Default language: Arabic. Supported: Arabic (RTL) and English (LTR)
- Theme: **Light Mode only**
- Fonts: Alexandria (Arabic), Inter (English)

## Current phase

- Phase: **1 — Discovery, architecture, core, security, localization, Light Mode**
- Sub-stage: Discovery **approved** 2026-09-19 → build half (scaffolding) authorized
- Requirements `verified`: **0**

## Phase status

- [ ] Phase 1 — Discovery, architecture, core, security, localization, Light Mode — *in progress (build half)*
- [ ] Phase 2 — Organization, projects, units, pricing, plans, inventory
- [ ] Phase 3 — CRM, WhatsApp, Meta campaigns, leads, insights, attribution
- [ ] Phase 4 — Quotations, reservations, contracts, amendments, cancellations
- [ ] Phase 5 — Installments, collections, reminders, checks, promissory notes
- [ ] Phase 6 — Accounting, invoices, treasury, banks, tax, assets, budgets
- [ ] Phase 7 — Procurement, vendors, stores, contractors, construction
- [ ] Phase 8 — HR, attendance, payroll, commissions, advances, custody, performance
- [ ] Phase 9 — Handover, after-sales, analytics, migration, hardening, UAT, launch

## Recently completed — 2026-09-19

### Stakeholder decisions applied to the documentation

| Decision | Outcome | Recorded in |
|---|---|---|
| `SD-13` Theme | **Approved, closed.** Light Mode only | ADR-0004 status update |
| `SD-14` Meta scope | **Approved, closed.** Full Master Mapping scope supersedes the PDF | ADR-0011 status update |
| `SD-15` Conversions API | **Approved, production delivery gated** (off by default, 10 preconditions) | New ADR-0017 |
| `SD-16` Dev infrastructure | **Approved.** Atlas dev cluster + Redis adapter, no Docker | New ADR-0018 |
| `SD-22` Requirement codes | **Approved.** Nine Phase 1 namespaces | New ADR-0016; REQUIREMENTS.md re-keyed |
| PDF authority | Supplementary; sources of truth include approved ADRs; later written decisions supersede the PDF | ADR-0013 status update |
| `SD-17` Logo | **Open, non-blocking.** Text placeholder in development only | open-decisions, localization-and-theming |
| Remaining open decisions | Each assigned to the phase it blocks; **none blocks Phase 1 scaffolding** | open-decisions.md |

### Requirement re-keying (ADR-0016)

Old `CORE-USER-*` → `SEC-011`…`022`; `CORE-RBAC-*` → `SEC-023`…`032`; `PLAT-018` → `SEC-033`;
`CORE-AUDIT-*` → `AUDIT-*`; `CORE-APPROVAL-*` → `APPROVAL-*`; `CORE-INTEGRATION-*` → `INTEGRATION-*`;
`PLAT-004/005/009` → `OPS-001/002/003`; `PLAT-019/020` → `TEST-001/002`; new `TEST-003` (bilingual E2E
smoke). Full table in `docs/REQUIREMENTS.md`. Gap references: G-08 → `SEC-021`, G-09 → `CORE-TASK-003` +
`APPROVAL-005`, G-10 → `SEC-022`. **111** Phase 1 requirements.

### Verification actually performed

- **Disk preflight:** `C:` ~21 GB free, `D:` ~181 GB free (was 0 on `C:`). `D1` resolved.
- WCAG contrast of the approved palette computed earlier (ADR-0005): `primary` on `primarySoftStrong`
  4.24:1 fails AA normal text; `borderSubtle` 1.48 and `disabled` 2.56 are usage-restricted; chart palette
  lacks luminance separation.
- `.gitignore` verified with `git check-ignore`.
- Documentation internal links checked before commit.

## Next exact task

Phase 1 application scaffolding (authorized). Do not start Phase 2.

## Approved decisions

- Arabic-first UX; Arabic and English implemented together. Alexandria / Inter, self-hosted.
- **Light Mode only.** No Dark Mode, System Mode, theme switcher, or per-user theme preference (`SD-13` closed).
- Extended Light Mode semantic token set approved and contrast-verified (ADR-0005).
- Primary blue `#2563EB`; hover `#1D4ED8`; pressed `#1E40AF`; soft `#EFF6FF`; soft-strong `#DBEAFE`;
  on-primary `#FFFFFF`; focus ring `#1D4ED8`.
- Modular monolith with lint-enforced module boundaries.
- Server-side RBAC, permissions, and data scopes enforced **inside queries**.
- Decimal-safe money (`Decimal128` storage, string transport). UTC storage, organization timezone for
  display; `Instant` and `BusinessDate` distinct types.
- No hard deletion of financial, contractual, inventory-history, audit, check, or note records.
- Official provider APIs only, behind versioned adapters with signature verification and idempotent jobs.
- **Meta: full Master Mapping scope** (`SD-14`). Internal budget authorization separate from provider payment
  configuration; never store card/CVV; no unsupported Add Funds.
- **Conversions API:** optional; production delivery disabled by default (ADR-0017).
- **Dev infrastructure:** MongoDB Atlas development cluster; Redis adapter (managed or approved local);
  no Docker; no production credentials; fail safely (ADR-0012, ADR-0018).
- Arabic PDF is supplementary; implementation sources of truth are `CLAUDE.md`, `docs/MEMORY.md`,
  `docs/MASTER-MAPPING.md`, `docs/PHASE-PROMPTS.md`, and approved ADRs.
- Git: local commits authorized. **No remote, no push, no deploy.**

## Database state

- Schema version: Not initialized · Migrations: None · Seed data: None · Indexes: None
- MongoDB transactions require a replica set — Atlas provides one once provisioned.

## Integration state

| Integration | Status | Notes |
|---|---|---|
| MongoDB | Not provisioned | Atlas dev cluster approved (ADR-0018) |
| Redis | Not provisioned | Managed or approved local instance |
| AWS S3 / KMS | Not configured | |
| WhatsApp Cloud API | Not configured | `SD-09` (Phase 3) |
| Meta Marketing / Lead APIs | Not configured | Scope approved; `SD-19` (Phase 3) |
| Meta Conversions API | Not configured | Optional; production delivery gated (ADR-0017) |
| Email / SMS / payment gateway | Not selected | `SD-20` |
| Bank integration | Statement import only | |
| E-invoicing | Not configured | `SD-08` |

## Blockers

| ID | Blocker | Blocks |
|---|---|---|
| `D2` | Atlas dev cluster and Redis not provisioned | Integration tests; transaction verification; Phase 1 gate |
| `SD-01`–`SD-12`, `SD-17`–`SD-21` | Open business decisions | Their assigned phases (see open-decisions.md) — none blocks Phase 1 scaffolding |

## Handoff summary

Documentation foundation approved and updated with the 2026-09-19 stakeholder decisions. Next: Phase 1
scaffolding.
