# Demonstration runbook

Written for: whoever is going to run the client demonstration on their own machine.

This is the operational half. The presentation script — what to say, in Arabic, in order — is
[`walkthrough-ar.md`](walkthrough-ar.md).

---

## What this demonstration is

A **vertical slice** of the ALOLA real-estate ERP, running entirely on one machine against a real
MongoDB and a real Redis. The primary journey is genuine software, not a prototype:

> dashboard → lead → opportunity → unit → reservation → contract → instalment schedule →
> collection → receipt → upcoming-instalment reminder

Every record it shows was written through the product's own services, with the same validation,
permission checks, data scopes, transactions and audit trail that a live system would apply.

**What it is not**, stated plainly because the client will ask
([ADR-0026](../decisions/adr-0026-demonstration-mode-boundary.md)):

| Area | State in the demonstration |
|---|---|
| Meta / Facebook / Instagram advertising | **Not connected.** Campaigns are local drafts. There is no publish operation, no provider account, and the figures shown are labelled as demonstration figures. |
| WhatsApp delivery | **Not connected.** Reminders are generated, composed in Arabic and English, and stored. Nothing is sent to anyone. The state is `simulated`, never `sent`. |
| Payment providers | **Not connected.** Receipts record money that a person says was received; no gateway is called. |
| Documents and printing | A demonstration contract preview. **It is not legal advice and not an approved company contract.** |
| The rest of the ERP | Human resources, procurement, accounting and the remaining modules are not in this slice. |

Nothing in the demonstration is production-ready, and Phase 1's own gate is still open. See
[`../phases/phase-gates.md`](../phases/phase-gates.md).

---

## Before the meeting

### 1. Prerequisites, once

- Docker Desktop with the WSL 2 backend, running.
- Node.js 24 (`.nvmrc` pins the version).
- `npm install` at the repository root.

### 2. Start the services

```bash
npm run dev:services:up
```

Idempotent. It starts MongoDB (a single-node replica set — transactions need one) and Redis on
localhost only, generates credentials into the ignored `docker/dev.env`, and writes the connection
settings into the ignored `.env`. It prints no passwords.

Check them any time with `npm run dev:services:status`.

### 3. Seed the demonstration data

```bash
npm run seed:demo
```

Takes a few seconds. It creates the organization, eight accounts, two projects with 46 units, twelve
leads across every source and stage, three reservations, two contracts with full instalment
schedules, six receipts, six cheques and promissory notes, four campaign drafts, one approval policy,
and the reminders that fall due in the next fifteen days.

It is **idempotent**: run it again and it changes nothing except the passwords.

> **The passwords are written to `.demo-credentials.md` at the repository root.**
> That file is ignored by Git and is the only place any password appears — nothing is printed to the
> terminal or written to a log. Open it to sign in. Do not paste it into a chat, a ticket, or a
> screen share.

Then, once, give the demonstration roles the issued-document permissions and issue one sample PDF
of each type (contract summary, instalment schedule, reservation, receipt, customer statement):

```bash
npm run seed:demo:documents
```

It only **adds** permissions and issues each sample once; a second run reports `unchanged` for
everything. The samples carry real QR codes: open a contract or receipt, then the shield icon in
"Issued documents", in a private window, and the verification page answers without signing in. The
QR codes point at the first `CORS_ALLOWED_ORIGINS` entry (usually <http://localhost:5173>) unless
`PUBLIC_APP_URL` is set.

Then, once, give the demonstration roles the BMP-1 commercial permissions (quotations, opportunities,
lead conversion, contract activation for the manager, settings and number formats for the
administrator) and configure the demonstration reservation validity if none is configured:

```bash
npm run seed:demo:bmp1
```

It only **adds** permissions and sets `sales.reservationValidityDays` to 14 **only when not
configured**, as the system actor, with a reason saying `BD-01` is still open; a second run reports
`unchanged` for everything. The role matrix is in
[architecture/commercial-workflow.md](../architecture/commercial-workflow.md). No number format is
activated — the official formats are the client's decision (`BD-19`); see
[operations/numbering-runbook.md](../operations/numbering-runbook.md).

### 4. Start the application

Two terminals:

```bash
npm run dev:api     # http://localhost:4000
npm run dev:web     # http://localhost:5173
```

Open <http://localhost:5173>. It starts in Arabic, right-to-left.

### 5. Rehearse

Walk [`walkthrough-ar.md`](walkthrough-ar.md) once, end to end. It takes ten to fifteen minutes.

---

## The accounts

Eight, for seven roles. The passwords are in `.demo-credentials.md`; the logins are listed here so the
runbook is useful without opening it.

| Login | Role | What it demonstrates |
|---|---|---|
| `sales.manager@demo.invalid` | Sales manager | The main journey. Scoped to the New Cairo branch, so Alexandria is invisible to it. Confirms reservations, approves discounts. |
| `sales.one@demo.invalid` | Sales representative | A smaller menu and a smaller system. Use it for the authorization demonstration. |
| `sales.two@demo.invalid` | Sales representative | A second owner, so the pipeline has more than one name in it. |
| `collections@demo.invalid` | Collection officer | Receipts, cheques and promissory notes, the reminder centre. |
| `accounting@demo.invalid` | Accountant | May reverse a receipt; may **not** record one. Separation of duties, visible. |
| `marketing@demo.invalid` | Marketing manager | The marketing centre, and its "not connected" notice. |
| `executive@demo.invalid` | Executive management | Read-only across the whole organization, including Alexandria. |
| `admin@demo.invalid` | System administrator | Security, roles, grants, audit, approval policy, the unit catalogue. |

### The administrator needs an authenticator app

`admin@demo.invalid` holds administrative permissions, and this product refuses to let such an account
sign in with a password alone (`SEC-017`). The control is **not** relaxed for the demonstration.

`.demo-credentials.md` therefore carries that account's authenticator secret and an `otpauth://` URI.
Add it to any authenticator application before the meeting, or plan not to use that account. Ten
single-use recovery codes are in the same file.

The other seven accounts hold no administrative permission and sign in with a password alone.

---

## Resetting

```bash
npm run seed:demo:reset            # shows what would be removed, removes nothing
npm run seed:demo:reset -- --confirm
npm run seed:demo                  # seed again, numbering restarts at 00001
```

The reset removes **only** the records the seed wrote down while creating them, plus their children.
Anything else in the database — a record entered by hand, data left by an integration run — is left
alone.

It does **not** delete the audit trail. `auditEvents` is append-only by design
([ADR-0021](../decisions/adr-0021-audit-trail-integrity.md)) and no part of this product can remove a
row from it; the reset does not invent a way. After a reset the audit trail still records that the
demonstration data was created and removed.

---

## Refusals, and why they exist

The seed and the reset both refuse to run unless **all three** of these hold:

1. `APP_ENV` is `development` or `test`.
2. The database name carries a development marker (`dev`, `development`, `demo`, `local`, `test`).
3. The connection points at the local machine.

A production database would have to be named like a development one *and* be reachable on localhost
*and* be configured as development before any of this could touch it. The refusals are unit-tested
(`scripts/seed-demo/guard.test.ts`).

---

## If something is wrong

| Symptom | Cause and fix |
|---|---|
| `Refused to seed` | One of the three checks failed; the message says which. Confirm `.env` really points at the local development database. |
| `MONGODB_URI and MONGODB_DB_NAME must be set` | The services were never started. `npm run dev:services:up`. |
| `DEV_ENCRYPTION_KEY must be set` | `.env` is missing that key. It is in `.env.example`; the administrator account's second factor is stored encrypted and the seed will not store it in the clear. |
| Screens are empty after signing in | The data was removed — most often by an integration-test run against the wrong database. Re-run `npm run seed:demo`. |
| Sign-in is refused | `.demo-credentials.md` is older than the last seed. Every run replaces the passwords; re-read the file. |
| The API answers `503` | MongoDB is not up. `npm run dev:services:status`. |
| `npm run seed:demo:reset` reports nothing to remove | There is no seed ledger, so nothing was seeded into this database. |

---

## The end-to-end tests run against exactly this

```bash
npm run seed:demo
npm run test:e2e
```

The suite signs in as the seeded accounts with the generated passwords, walks the same journey, and
asserts the same things a reviewer would check by hand — including that a sales representative is
refused the marketing API when the request is made from outside the browser with their own access
token. If the demonstration is broken, that suite fails first.

---

## Related documents

- [`walkthrough-ar.md`](walkthrough-ar.md) — the Arabic presentation script.
- [ADR-0025](../decisions/adr-0025-macro-delivery-phases.md) — why the delivery plan has four macro phases.
- [ADR-0026](../decisions/adr-0026-demonstration-mode-boundary.md) — what is real, what is simulated, and how each is labelled.
- [`../architecture/environments.md`](../architecture/environments.md) — environment variables and local services.
