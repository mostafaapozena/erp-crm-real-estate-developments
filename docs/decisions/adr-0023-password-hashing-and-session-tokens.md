# ADR-0023 — Password hashing, session tokens, and the second factor

- Status: Accepted
- Date: 2026-09-21
- Deciders: Implementation team
- Scope: Security

## Context

`SEC-013` names Argon2id. `SEC-014` names short-lived access tokens with refresh tokens rotated in
`Secure` `HttpOnly` cookies. `SEC-015` names refresh-token reuse detection. `SEC-017` names mandatory MFA
for privileged roles. Master Mapping §4.3 names the libraries: `argon2`, `jose`.

What none of them fixes, and what a later session would otherwise have to guess:

- the Argon2id **parameters**, and what happens when they are raised;
- the **password policy** — `SD-02` covers roles and approval thresholds, not password rules;
- whether a short-lived access token is trusted on its own, which decides whether `SEC-020`
  ("immediate server-side invalidation") is actually true;
- which TOTP implementation, and where an MFA secret lives when `SEC-033` (KMS) does not exist yet;
- the throttling thresholds, and whether a counter can lock an account out permanently.

Each of those is a decision that silently weakens the system if it is made casually, so each is recorded
here with the reason.

## Decision

### 1. Argon2id, at the OWASP minimum, through `@node-rs/argon2`

Parameters default to **m=19456 KiB, t=2, p=1** — OWASP's minimum for Argon2id — and are configurable per
environment (`ARGON2_MEMORY_COST`, `ARGON2_TIME_COST`, `ARGON2_PARALLELISM`). The schema refuses anything
*below* the default, so configuration can only harden it.

The stored value is standard PHC format, which carries the algorithm, version, parameters, and salt with
the digest. A successful login compares the stored parameters with the configured ones and **rehashes
transparently** when they are weaker, so raising the cost is a configuration change rather than a
migration. A stored value that is not Argon2id is also treated as needing a rehash.

**Library choice.** Master Mapping §4.3 names `argon2`. That package's install script is
`cross-env ZERO_AR_DATE=1 node-gyp-build`, and `cross-env`'s generated Windows `.cmd` shim breaks on the
`&` in this repository's path — the same defect that makes every npm script run through `scripts/bin.mjs`.
`@node-rs/argon2` implements the same algorithm (RFC 9106), ships prebuilt platform binaries, has **no
install script**, and needs no native toolchain. It is used instead, and a unit test asserts that what
comes out really begins with `$argon2id$` rather than trusting the library's defaults. If the repository
moves to a path without `&`, either package satisfies this ADR.

### 2. Password policy: length first

- Minimum **12** characters, maximum **200** (a bound, so an enormous body cannot turn hashing into a
  denial of service).
- A small blocklist of very common values, and a refusal of a single repeated character.
- Refused if it contains the account's own login identifier.
- **No composition rules.** Following NIST SP 800-63B: requiring an uppercase letter, a digit, and a
  symbol produces `Password1!`, not entropy.
- The raw password is **never** trimmed, lowercased, or Unicode-normalized. Any of those silently shrinks
  the keyspace and can make a password that worked yesterday fail today.
- The policy returns issue **codes**, never prose and never the password, and the password never appears in
  an error, a log line, an audit record, or a response.

The blocklist is not a breach corpus. When a checked corpus is available (`SD-18` operational scope), it
replaces the list; that is a data change, not a redesign.

### 3. Two kinds of token, deliberately not interchangeable

| | Access token | Refresh token |
|---|---|---|
| Form | Signed JWT (`jose`, HS256) | 256-bit opaque secret from the CSPRNG |
| Lifetime | 10 minutes by default | The session's absolute deadline |
| Where it lives | Response body; the client holds it **in memory** | `HttpOnly` `Secure` `SameSite=Strict` cookie, path-scoped to `/api/v1/auth` |
| Stored server-side | Not stored | **SHA-256 digest only** |
| Readable by page scripts | Yes, by design — it is short-lived | **Never** |

A fast digest is correct for the refresh token and wrong for a password: the refresh token already has full
entropy, so there is nothing to brute-force and nothing for a slow hash to protect.

**`Secure` is not relaxed for staging or production.** Only a development or test environment gets a
cookie without it.

### 4. An access token is never trusted on its own

This is the decision that makes `SEC-020` true rather than aspirational. Every authenticated request:

1. verifies the signature and expiry;
2. loads the **session** and checks that it is not revoked, not idle-expired, and not past its absolute
   deadline;
3. loads the **account** and checks that it is still `active`;
4. compares the token's `credentialVersion` with the account's — a password change increments it, which
   invalidates every access token already issued;
5. refuses a session that never satisfied a second factor if the account now requires one;
6. resolves permissions from stored grants, per ADR-0022.

So a suspension, an offboarding, a password change, or a permission change takes effect on the **next
request**, not when the token expires. The cost is two indexed reads per request, accepted for the same
reason as in ADR-0022.

Sessions are stored in **MongoDB**, not only in Redis: revocation has to be durable and explainable after
the fact. Redis carries throttling counters — the part that may safely evaporate.

### 5. Refresh rotation with family revocation

Every refresh rotates the token and keeps the used row, precisely so that presenting it again is
detectable. A replayed token revokes the **whole session family**, because there is no way to tell a replay
from a stolen copy, and the safe reading is the pessimistic one. The used row is marked before the new one
is issued, so two concurrent replays cannot both succeed.

### 6. TOTP, with the secret encrypted, and an honest note about KMS

RFC 6238 through `otpauth` — no hand-rolled HMAC construction. 160-bit secrets from the CSPRNG, 6 digits,
30-second period, ±1 step of drift. The **accepted step is stored**, so a code cannot be replayed inside
its own window. Enrolment reveals the secret once and is not active until a code from it is confirmed, so
an abandoned enrolment locks nobody out.

Ten recovery codes, each hashed **independently** with Argon2id and usable once.

The secret is encrypted at rest through the existing `Encryptor` interface. **`SEC-033` (KMS) is not
implemented**, and this ADR does not pretend otherwise:

- Development and test use `DevKeyEncryptor`: AES-256-GCM with a stable key from `DEV_ENCRYPTION_KEY`, so
  an enrolment survives a restart. It refuses to exist when `APP_ENV` is `staging` or `production`, and
  configuration refuses the variable there too.
- With `KMS_KEY_ID` set, the unconfigured encryptor **fails loudly**. Staging and production therefore
  cannot store an MFA secret until the KMS adapter exists. That is a real, stated dependency, not a gap
  discovered later.

`SEC-017` requires a second factor for privileged accounts. Master Mapping §6 names the privileged
categories — system administration, Meta administration, payroll, treasury, banking, finance approval — and
only the first exists today, so the set is the administrative permissions plus `audit.export`. A privileged
account that has not enrolled is sent down an enrolment-before-sign-in path; it cannot reach anything else
with its challenge.

### 7. Throttling that cannot become a permanent lockout

| Rule | Budget |
|---|---|
| Sign-in per address | 120 per 15 minutes, 15-minute block |
| Sign-in per identifier | 8 per 15 minutes, 15-minute block |
| Second factor per account | 6 per 5 minutes, 10-minute block |
| Password reset per address / per identifier | 5 per hour each |

Keyed by the **identifier**, not the account id, because an unknown identifier must be throttled too — or
the throttle itself would answer "does this account exist?".

The per-address budget is deliberately generous: a whole branch office behind one NAT shares an address,
and a tight limit there locks out a floor of honest people. Precision is the per-identifier rule's job.

**Every counter has a TTL**, so no sequence of failed attempts can make an account permanently unusable.
Permanent unavailability is an administrative decision (`suspended`, `SEC-019`). A successful sign-in
clears the counter. When Redis is unavailable the in-memory insurance limiter takes over: throttling
degrades to per-process rather than disappearing.

### 8. No default administrator

There is no seeded account, no default password, and no public self-registration. `scripts/bootstrap-admin.ts`
runs once, refuses if any account exists, creates an `invited` account with **no password**, and prints an
activation token for the operator to use. It writes the first role and grant directly through the models,
because the guarded service needs an actor that does not exist yet; that path requires database
credentials and is never reachable over HTTP.

## Consequences

**Accepted benefits**

- Revocation is immediate and provable, rather than "within ten minutes".
- Raising the password cost is a configuration change with no migration.
- A stolen refresh token is detectable, and its detection costs the attacker the session.
- The KMS dependency is visible in configuration and in this document, instead of surfacing as a surprise.

**Accepted costs**

- Two indexed reads per authenticated request. Measured before any cache is introduced, and a cache would
  need its own ADR (ADR-0022).
- A privileged account must carry an authenticator application. That is the point of `SEC-017`.
- Staging and production cannot use MFA until `SEC-033` lands. Stated, not worked around.
- `@node-rs/argon2` instead of `argon2`, for the path reason above.
- Password reset **delivery** is `CORE-NOTIFY`, not this group. Until it exists, an administrator issues a
  reset token through `POST /api/v1/security/accounts/{accountId}/password-reset` and delivers it out of
  band; the self-service request endpoint answers identically for every identifier and returns nothing.

## Compliance

Tests must prove, against real MongoDB and Redis:

1. A stored password is Argon2id with the configured parameters, and a weaker one is rehashed on login.
2. The policy refuses short, common, repeated, and identifier-containing passwords, and the password never
   appears in any error, log, audit record, or response.
3. A wrong password and an unknown identifier produce the same answer and comparable work.
4. A refresh rotates; a replayed refresh revokes the family.
5. Suspension, offboarding, and a password change end access on the next request, with an unexpired token.
6. A TOTP code cannot be replayed; a recovery code works once; the stored secret is ciphertext.
7. A privileged account cannot sign in without a second factor, and a session created before the account
   became privileged does not gain its authority.
8. Every throttle key has a TTL, and a successful sign-in clears the counter.

## References

- `docs/MASTER-MAPPING.md` §4.3, §6
- [ADR-0006](adr-0006-server-side-authorization.md) — authorization on the server and in query scope
- [ADR-0019](adr-0019-security-account-organization-employee-boundary.md) — the account is not the employee
- [ADR-0021](adr-0021-audit-trail-integrity.md) — what the audit trail guarantees
- [ADR-0022](adr-0022-authorization-resolved-per-request.md) — no permission cache
- [../architecture/security-model.md](../architecture/security-model.md)
- OWASP Password Storage Cheat Sheet (Argon2id parameters); NIST SP 800-63B (length over composition);
  RFC 9106 (Argon2), RFC 6238 (TOTP)
