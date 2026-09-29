# ADR-0033 — Issued business documents and public QR verification

- **Status:** Accepted (2026-09-29)
- **Deciders:** Product owner (Business Master Prompt 1, package 7), engineering
- **Related:** [ADR-0003](adr-0003-arabic-first-localization.md),
  [ADR-0006](adr-0006-server-side-authorization.md), [ADR-0009](adr-0009-no-hard-delete.md),
  [ADR-0021](adr-0021-audit-trail-integrity.md), [ADR-0027](adr-0027-single-tenant-per-deployment.md),
  `CORE-DOC-003`, `CORE-DOC-004`, `CORE-DOC-005`, `CORE-DOC-006`, `SEC-029`, `SEC-033`

## Context

Package 7 has the product issue PDFs from business records — quotations, reservations, contract
summaries, instalment schedules, receipts and customer statements — in Arabic and English, each with a
QR code a customer, a bank or a notary can scan to check that the paper in their hand is one the
company issued and that it still stands.

Three things had to be decided: where the PDF is drawn, how an issued file relates to the stored
documents that already exist (CORE-DOC-004), and what a stranger holding a QR code may learn.

## Decision

### 1. Drawn on the server, from the record, never from the screen

PDFs are drawn by the API (`apps/api/src/platform/pdf/`, pdfkit with Alexandria and Inter embedded,
bidirectional layout by `bidi-js`), from the record the caller may read, as that caller. Browser
printing was rejected: its output depends on the browser, its fonts and its print settings, and it
would print what a screen shows rather than what the record says.

A document states what it is. A contract summary is titled and footnoted as an informational summary,
never as the legal contract; a draft carries a watermark; a cancelled, reversed, withdrawn or expired
record says so on the page. **No legal wording is invented**: approved terms appear only when a client
publishes them in the template registry (CORE-DOC-002), and the issued record names that template
version.

### 2. An issued file is an immutable version of an ordinary document

The file is stored as a version of an ordinary business document owned by the source record, so it
inherits private storage, the owner's data scope, versioning, archival instead of deletion, and a
recorded, signed, short-lived download link (CORE-DOC-004, CORE-DOC-006). The issued-document record
(`issuedDocuments`) adds the type, template key and version, company-profile version, language, file
and content checksums, page count, the fingerprint and the verification token. Deletion is refused by
the model.

Regenerating never edits a file. It issues version *n + 1* and, **in the same transaction**, marks
every earlier current issue of that type, source and language `superseded`. Revocation is a separate,
administrative, reasoned and audited act (`document.revoke`). Issue, supersession, revocation, each
download and each verification are audited.

### 3. A PDF never widens what its reader may see

Generating or reading an issued document needs `document.generate` / `document.view` **and** the
permission that reads its source (`ISSUED_DOCUMENT_PERMISSIONS`), inside the query scope of the source.
When the file prints a restricted field — the buyer's identity (`crm.customer.viewIdentity`) — the
stored document carries `requiredPermissions`, and the documents module filters it out of every list,
read, search and download for anyone who does not hold them. An actor without the permission gets a
file without the field and a warning, in a separate stored document.

### 4. The trust model of the QR code

The QR code encodes `<PUBLIC_APP_URL>/verify/<token>` and nothing else.

- **The token** is 256 bits from the operating system's cryptographic generator, base64url-encoded. It
  is not a number, not a hash of the document and not derived from anything, so it cannot be guessed,
  enumerated or recomputed. It is stored as issued, with a unique index, because the only thing it
  protects is the small public answer below. It is not a signature.
- **The public answer** (`GET /api/v1/public/verify/{token}`, no sign-in) is limited to: result
  (`valid`, `superseded`, `revoked`, `expired`, `invalid`), issuing company name, document type,
  business reference, issue date, version, fingerprint and the time of the check. **No customer, amount,
  address, identity, internal identifier or file link** is ever returned. A leaked code discloses
  nothing the printed page's header does not.
- **Enumeration** is prevented by the token's size, a malformed token and an unknown one returning the
  identical bare `invalid`, a per-address budget (`VERIFY_RATE_LIMIT_PER_MINUTE`, default 20) on top of
  the global limit, `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
- **The fingerprint** is the first 64 bits of the SHA-256 of the content the file was drawn from,
  printed on every page footer and returned by verification. A reader compares the two; a forged page
  that copies a real QR code but changes the content cannot match the fingerprint without the company's
  record changing too.
- **Revocation and rotation**: revoking marks the issue `revoked`; reissuing supersedes it. There is no
  separate token rotation, because a token belongs to exactly one issued version: the new version gets
  a new token, and the old one keeps answering `superseded`, which is the honest answer for old paper.
- **Privacy of the check itself**: a verification is audited as an anonymous actor with the result and
  the issue it matched, **without** the address or the user agent.
- **The web page** (`/verify/:token`) is rendered outside the signed-in application: no session is
  probed and no cookie is sent, so everyone sees the same answer.

### 5. What this does not claim

- Verification proves that **this deployment's database** holds a matching issue in the stated state.
  It is not a cryptographic signature: someone with write access to the database could create a
  matching record (ADR-0021 §2). Digitally signed PDFs (PAdES) need a key held in a KMS and a
  certificate the client obtains; both wait on `SEC-033`.
- The verification link is only as durable as the configured `PUBLIC_APP_URL`. Changing the public
  address breaks every printed code, so it is a deployment decision recorded in the client file.
- Production storage fails closed: with no object-storage adapter (`PLAT-017`) staging and production
  refuse to store an issued file, so they cannot issue documents until that adapter exists.

## Consequences

- Six document types exist, each with a built-in layout version (`ISSUED_TEMPLATE_VERSIONS`); a layout
  change raises it so an old file always names the layout that drew it.
- A user who holds the identity permission and one who does not can each issue a version; the latest
  one supersedes all earlier ones of that type, source and language, whichever variant they were.
- Adding a document type means a builder, a source loader in the composition root, a type, a
  permission row, labels in both languages and a test that extracts its text from the rendered PDF.
