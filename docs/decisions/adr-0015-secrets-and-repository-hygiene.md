# ADR-0015 — Secrets and repository hygiene

- Status: Accepted
- Date: 2026-09-19
- Deciders: ALOLA business owner (Git authorization), implementation team
- Scope: Security

## Context

The repository will hold the source for a system that handles bank accounts, salaries, customer identity
documents, signed contracts, checks, promissory notes, and provider access tokens for Meta and WhatsApp.

A committed secret is not undone by a later commit that removes it: Git retains history, and a repository
that is ever pushed or shared has leaked permanently. Likewise, a single real customer document or
payroll export committed as a "test fixture" is a data-protection incident. These controls must exist
**before** the first commit, not after.

## Decision

### Never committed, under any circumstances

- `.env` files and any real configuration values
- passwords, API keys, access tokens, refresh tokens, session secrets, signing keys
- private keys, certificates, keystores, SSH keys
- database connection strings containing credentials
- production personal data — real customers, employees, or their documents
- bank credentials, account numbers, card numbers, CVV
- document contents: identity documents, signed contracts, check or note scans, payslips, bank statements

### Enforcement

1. **`.gitignore` exists before the first commit** and covers environment files, dependencies, build
   output, coverage, logs, temporary files, local database files and dumps, IDE private files, private
   keys and certificates, access tokens, and upload/attachment/document directories. It allow-lists
   `.env.example` only.
2. **`.env.example` is the contract.** Every required variable is listed with a safe placeholder and a
   comment describing it. It never contains a real value. A new required variable is added to
   `.env.example` in the same change that introduces it.
3. **Secrets come from the environment**, and in deployed environments from AWS Secrets Manager. They are
   never defaulted in code, never committed, and never logged.
4. **Logs are redacted at the logger.** Redaction is configured once in the Pino instance covering tokens,
   passwords, authorization headers, cookies, bank fields, salary fields, and identity fields — not
   applied per call site, where it would eventually be forgotten.
5. **Test fixtures are synthetic.** Anonymised or generated data only. Copying production data into
   development is prohibited.
6. **Dependency and secret scanning run in CI.**

### Git authorization for this engagement

Authorized:

- `git init` in the project folder
- a secure `.gitignore` before the first commit
- an initial **local** commit after the documentation foundation is corrected and reviewed

Not authorized — requires explicit approval:

- creating or connecting any remote repository
- pushing anything, anywhere
- deploying anything

### If a secret is ever committed

Treat it as disclosed, not as a mistake to be edited away. Rotate the credential first — immediately and
before anything else. Then remove it from history. Removing it from the working tree alone is not
remediation. Record the incident in `docs/MEMORY.md` **without** including the secret value.

## Consequences

**Accepted benefits**

- Leak prevention is structural rather than dependent on reviewer vigilance.
- `.env.example` doubles as the configuration documentation that new environments need.

**Accepted costs**

- Contributors must configure `.env` locally before first run. Mitigation: startup configuration
  validation names exactly which variables are missing (see [ADR-0012](adr-0012-local-development-infrastructure.md)).
- Broad ignore patterns for `documents/`, `uploads/`, and `data/` could hide a legitimately needed file.
  Accepted deliberately: the failure mode of over-ignoring is an inconvenience, while the failure mode of
  under-ignoring is a data breach. Specific exceptions are added explicitly with `!` when a genuine need
  arises.

## Compliance

- Secret scanning in CI must fail the build on a detected credential.
- Code review rejects any real data in fixtures.
- `.env.example` completeness is checked against the configuration schema in CI.
- No `console.log` of a request body, header, or provider payload.

## References

- `CLAUDE.md` — "Never log or commit secrets, tokens, passwords, private keys, production personal data,
  bank credentials, card data, or document contents."
- User-approved Git authorization for this engagement
- `.gitignore`; [ADR-0012](adr-0012-local-development-infrastructure.md), [ADR-0011](adr-0011-meta-operating-boundary.md)
