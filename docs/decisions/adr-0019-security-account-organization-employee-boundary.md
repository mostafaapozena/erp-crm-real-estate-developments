# ADR-0019 — Security account, organization, and employee are separate aggregates

- Status: Accepted
- Date: 2026-09-19
- Deciders: ALOLA business owner (Phase 1 scaffolding review decision), implementation team
- Scope: Architecture, security, governance
- Refines: [ADR-0016](adr-0016-phase-1-requirement-namespaces.md) — the `SEC` namespace boundary

## Context

[ADR-0016](adr-0016-phase-1-requirement-namespaces.md) moved the Master Mapping's `CORE-USER` and
`CORE-RBAC` requirements into the `SEC` namespace. MASTER-MAPPING §6 describes "employee-linked accounts",
and `security-model.md` previously said "a user is an employee with system access". Read loosely, that
invites one aggregate holding login credentials, organization placement, and HR data together — which
would put salary-adjacent and identity data behind the authentication model's access rules, and couple
Phase 1 security to Phase 2 organization and Phase 8 HR.

## Decision

Three owners, three aggregates:

| Namespace / module | Owns | Phase |
|---|---|---|
| `SEC` | Authentication; user security accounts; passwords; sessions; devices; MFA; account activation and suspension; roles; permissions; field restrictions; data scopes; authorization policies; security events | 1 |
| `CORE-ORG` | Legal entities; branches; departments; teams; job titles; reporting hierarchy; organization placement references | 2 |
| `HR-EMP` | Employee business profiles; employment contracts; HR documents; attendance identity; payroll identity; employee organization placement | 8 |

Rules:

1. **A user security account may reference an employee record** (`employeeRef`). It never contains
   employee business data — no name history, contract, salary, national ID, placement, or HR document
   lives on the account.
2. The reference is **optional in Phase 1**, because `HR-EMP` is built in Phase 8. When `HR-EMP` exists,
   linking is validated against it. Service and integration accounts, if ever approved, have no employee.
3. **Data scopes** (`SEC-026`) evaluate against organization references owned by `CORE-ORG`; `SEC` stores
   the scope assignment, not the hierarchy.
4. **Employment termination is an HR event; account deactivation is a security event.** Termination in
   `HR-EMP` triggers account offboarding (`SEC-021`); it does not make the account the employee record.
5. **Offboarding is split by owner.** `SEC-021` suspends the account and revokes sessions, devices, and
   delegations. Reassigning the person's open tasks (`CORE-TASK-005`), pending approvals
   (`APPROVAL-007`), and owned customers (`CRM-OWNER`, Phase 3) belongs to those modules.

## Consequences

**Accepted benefits**

- Authentication and authorization can be built and verified in Phase 1 without inventing organization
  or HR data.
- HR data keeps HR field restrictions; a security administrator does not see payroll identity by virtue
  of managing accounts.

**Accepted costs**

- A lookup across two aggregates to show "who is this user" once `HR-EMP` exists. Accepted.

## Compliance

- The user-account schema has no HR or organization business fields; reviewed at each gate.
- Requirement IDs follow the table above ([../REQUIREMENTS.md](../REQUIREMENTS.md)).

## References

- Phase 1 scaffolding review decision, 2026-09-19
- `docs/MASTER-MAPPING.md` §6, §7, §8 (`CORE-ORG`, `HR-EMP`)
- [ADR-0006](adr-0006-server-side-authorization.md), [ADR-0016](adr-0016-phase-1-requirement-namespaces.md)
- [../architecture/security-model.md](../architecture/security-model.md)
