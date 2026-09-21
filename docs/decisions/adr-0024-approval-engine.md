# ADR-0024 — Approval engine: generic, versioned, and append-only

- Status: Accepted
- Date: 2026-09-21
- Deciders: Implementation team
- Scope: Architecture, Security

## Context

`APPROVAL-001`–`APPROVAL-007` register an approval request entity and state machine, rules configurable by
amount, percentage, role, project, department, risk and exception, maker-checker, time-bounded delegation,
escalation of an overdue approval to the direct manager, immutable approval history, and reassignment of an
offboarded approver's pending work.

Master Mapping §7 calls these "reusable approvals". Almost every later phase needs them: discounts, price
changes, refunds, reservations, contract activation, purchase orders, expenses, payroll runs, accounting
posting, and campaign budgets. `SD-02` — who approves what, at which threshold, and which duties may never
meet in one person — is **open** and first blocks Phase 2.

So the question this ADR answers is: what can be built now, and in what shape, such that `SD-02` fills it
in later without the engine being rewritten, and without Phase 1 inventing a financial control.

## Decision

### 1. The engine is mechanism; the policy is data

No role, threshold, approver, operation type, or service-level target is seeded anywhere. A policy is a
stored, versioned document, and `SD-02` supplies its content in Phase 2. Phase 1 owns the **shape** those
answers take and the enforcement around them.

Conditions may read exactly the seven axes Master Mapping §7 names — amount, percentage, role, project,
department, risk, exception — and nothing else. A policy therefore cannot come to depend on some module's
internal field, which is what would make the engine stop being reusable.

Amounts are compared as decimal strings with their currency, never as binary floating point (ADR-0007). A
threshold that rounds the wrong way is a financial control that does not control anything. Two different
currencies are treated as **not comparable**: the policy does not apply, rather than an exchange rate being
guessed.

### 2. A request references its subject and never executes it

An approval request carries an **opaque** `{ type, id }` reference to the aggregate that needs approval and
a sanitized summary for the approver to read. It never embeds the source document, and approving a request
**does not perform the underlying operation**. The owning module observes the outcome and acts.

Two consequences, both intended:

- the engine needs no knowledge of any business module, so one engine serves all of them;
- an approval cannot become a side effect. A module that forgets to act leaves an approved request and no
  change, which is visible; the alternative failure — an engine that half-applies someone else's operation —
  is not.

### 3. A published policy version is immutable, and a request is bound to its version

Editing is possible only while a version is a draft. Publication freezes it, enforced in schema middleware
rather than only in the service, so a caller reaching for the model directly is refused too.

Every request stores the policy **version** it was submitted under. A later edit or a newer version never
changes what an outstanding request requires. Without this, publishing a stricter policy would silently
re-open decisions that were already correctly made, and publishing a laxer one would retroactively approve
work that had not met the bar.

### 4. Ambiguity is refused when the policy is written

A stage says how many of its approvers it needs: any one, all of them, or a quorum. "All" and "quorum" are
meaningful only over a bounded, enumerated set, so a policy that asks for them over a permission-based or
manager-based rule is **rejected at write time**, with a code naming the problem. The alternative — deciding
what "all" means when a grant changes mid-request — is a rule nobody could predict.

### 5. Maker-checker is configuration, never a code branch

`APPROVAL-003` says self-approval is rejected "unless an explicit audited policy permits it", and the
registry adds: *never a code branch*. So the exception is a policy field with two values, and the permitted
case additionally **requires a reason** and is recorded as a self-approval, so a review can find every
instance.

Three properties follow, each tested:

- an administrative permission does not help: the rule is evaluated after authorization has already
  succeeded, and reads only the policy;
- a delegate acting for the requester is still the requester approving their own request;
- one person may not satisfy two different stages of the same request. Stage count is what a threshold
  buys; one signature twice is one signature.

### 6. History is append-only, and concurrency is settled by a unique index

Decisions are inserted and never updated (`APPROVAL-006`), enforced the way the audit trail is
(ADR-0021): every mutating query operation on the collection throws, and a loaded document cannot be
edited and re-saved.

A unique index on `(requestId, stageOrder, approverAccountId)` is the concurrency control. Two simultaneous
approvals therefore produce **exactly one** accepted decision — the loser fails on the index rather than
silently overwriting a counter — and a retried request cannot append a second decision.

The state change is additionally guarded by a compare-and-set on `(requestId, version, state)`, so a
decision made against a stale view is refused rather than applied.

### 7. A decision and its evidence commit together

The decision row, the stage counter, the request state, and the audit records are written in **one
transaction**. Anything less leaves either an unexplained state or evidence nobody can find. This is why
`AuditService.record` now accepts a session: joining a caller's transaction changes when the record becomes
visible, never whether it can later be altered.

The local development deployment is a single-node replica set precisely so this works (ADR-0020); a
deployment without transactions fails loudly rather than degrading silently.

### 8. Escalation resolves the manager through a port

`APPROVAL-005` escalates an overdue approval to the **direct manager**. The reporting line belongs to
`CORE-ORG` (Phase 2, `SD-01`), so the engine resolves it through an injected port. Until that exists, no
resolver is configured and an overdue stage is reported as **unresolved** — counted and visible — rather
than escalated to an invented manager.

Escalation **adds** the manager to the pending approvers rather than replacing them: escalating must not
discard the decision that is still owed. It is idempotent per stage.

### 9. Delegation is bounded and never widens authority

A delegation lets the delegate act on the delegator's stages, for a bounded window, optionally narrowed to
named policies. It is refused if it would delegate to oneself or close a cycle, and it is revoked rather
than deleted.

It grants nothing else: the delegate's own permissions and data scope still apply to every read and write,
so a delegation cannot become a route to more authority. Every decision records both the authority used and
the hand that acted.

### 10. Notifications are a port, not a dependency

`CORE-NOTIFY` and `CORE-TASK` are separate groups. The engine publishes a domain event **after** the
transaction commits, and a failure to publish is logged and swallowed. An approval must be correct whether
or not anything is listening.

## Consequences

**Accepted benefits**

- One engine serves every module that needs approval, and `SD-02` fills it in without code changes.
- Nothing about a decided request can be rewritten, including by publishing a new policy.
- Concurrency is settled by the database rather than by application-level locking.

**Accepted costs**

- The owning module must observe the outcome and act. That is deliberate (§2) but it is real work for each
  module, and a module that skips it leaves approvals that achieve nothing.
- A permission-based stage enumerates candidate approvers to build the work queue, which is bounded and
  logged when it truncates. A permission held by thousands of accounts is not a work queue, and the bound
  makes that visible rather than silently partial.
- Escalation does nothing useful until `CORE-ORG` provides a reporting line.
- A state-changing approval operation requires a replica set.

## Compliance

Tests must prove, against a real MongoDB replica set:

1. A published version cannot be edited through the API or the model, and an outstanding request keeps the
   version it was submitted under.
2. An ambiguous policy is refused at write time and stored nowhere.
3. Stage order is enforced, and a request completes only when every stage is satisfied.
4. Self-approval is refused by default, permitted only with a reason when the policy says so, and not
   bypassed by an administrative permission.
5. Two concurrent approvals yield exactly one decision, and a stale version is refused.
6. A delegate acts only within the window, only for the named policies, and never beyond their own
   authority; a cycle is refused.
7. An overdue stage escalates to the manager when one is resolvable and is reported as unresolved when not.
8. Reassignment moves who is awaiting a decision and never alters a decision already recorded.
9. A refused or invalid action leaves the stored state unchanged.

## References

- `docs/MASTER-MAPPING.md` §6, §7, §13
- [ADR-0006](adr-0006-server-side-authorization.md) — authorization, and separation of duties as policy
- [ADR-0007](adr-0007-decimal-safe-money.md) — decimal-safe comparison of thresholds
- [ADR-0009](adr-0009-no-hard-delete.md) — immutable approval history
- [ADR-0021](adr-0021-audit-trail-integrity.md) — how append-only is enforced, and its limits
- [ADR-0022](adr-0022-authorization-resolved-per-request.md) — authorization resolved per request
- [../architecture/security-model.md](../architecture/security-model.md) §4, §9
- `SD-02` in [open-decisions.md](open-decisions.md) — the policy content this engine waits for
