# ADR-0031 — People lookup: account references render as names

- **Status:** Accepted (2026-09-28)
- **Deciders:** Product owner (UI/UX redesign master prompt), engineering
- **Related:** [ADR-0006](adr-0006-server-side-authorization.md),
  [ADR-0019](adr-0019-security-account-organization-employee-boundary.md),
  [ADR-0022](adr-0022-authorization-resolved-per-request.md), `CORE-ORG-004`, `SEC-027`, `SEC-028`

## Context

Business records carry **opaque account references**: a lead's assignee, a reservation's sales owner,
a receipt's collector, a revision's author, the dashboard's per-representative figures. Until now the
screens printed them as they are stored — `acc_…` — which is meaningless to a person and was flagged
as a visible defect in the UI redesign.

The name of a person lives in two places, and neither was reachable by the people who need it:

- the security account's `displayName`, behind the administrative `security.account.view`;
- the organization placement's directory label, behind `org.view` / `org.placement.view` **and** the
  caller's data scope — so a branch-scoped representative cannot see a colleague placed elsewhere,
  even when that colleague owns a lead the representative can see.

Resolving names inside every business module would have each module reach into the organization
module's data, breaking the module boundary (ADR-0001) for a display concern. Widening
`org.view` to every role would expose the whole structure to people who need only a name.

## Decision

1. **One narrow endpoint:** `GET /api/v1/organization/people?ids=a,b,c`, requiring authentication
   only (`requireAuthenticated`), at most 100 references, each matching `^[A-Za-z0-9_:.-]+$`.
2. **It answers only what was asked, and only a directory label.** For each reference with an
   **active** placement: `accountId`, `displayName` (the organization directory label, not the
   security account) and the job title. No contact detail, login identifier, placement, branch,
   department, manager or employee reference is returned. A reference without an active placement is
   simply absent.
3. **Not scope-filtered, on purpose.** The caller already holds the reference — it came from a record
   the caller was authorized to read, through that module's scoped query. Account references are
   random identifiers, so the endpoint cannot be used to enumerate the organization.
4. **The browser batches and remembers.** `PeopleProvider` collects every reference rendered in the
   same frame and resolves them in one request, caching the answers for the session (cleared on sign
   out, when the shell unmounts). Unresolved references render a localized "unavailable user" label,
   system actors (`system:…`) render as "System", and a raw reference is never shown.

## Consequences

- Every list and detail screen can show the person behind a reference without holding organization
  permissions, and without any business module importing the organization module.
- Any signed-in person can learn the directory label and job title of a colleague **whose reference
  they already hold**. That is the information an organization directory exists to share; it is
  documented here as a deliberate, bounded disclosure.
- A person without an active placement (an account with no directory entry, or one whose placement has
  ended) is shown as "unavailable user". Former holders are not named, by design.

## Compliance

- `apps/api/src/modules/organization/organization.int-test.ts` (`people lookup`): a caller with no grant
  gets exactly the directory fields for a colleague outside any scope it holds; unauthenticated is
  `401`; missing, malformed (`$where`) and over-long (101) lists are `400`; an ended placement is
  absent.
- `apps/web/e2e/identity.spec.ts`: no `acc_…` text appears on the leads screen once names resolve.

## References

- WCAG 2.1 SC 1.3.1 (a person is announced by name, not by identifier)
