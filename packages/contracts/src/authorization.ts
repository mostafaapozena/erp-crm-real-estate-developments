import { z } from 'zod';
import { LocalizedLabelSchema } from './localized';

/**
 * Authorization vocabulary (SEC-023, SEC-024, SEC-026).
 *
 * Permissions are **granular verbs per resource**, never coarse role names: an authorization check
 * evaluates permissions only (SEC-025, ADR-0006), so changing a role's composition cannot silently
 * change what a check means.
 *
 * This catalog covers the resources that exist today. Later phases extend it; nothing here encodes a
 * business role list, which is a stakeholder input (`SD-02`).
 */
export const PERMISSIONS = [
  // Audit (AUDIT-004: reading audit data is itself a sensitive read)
  'audit.view',
  'audit.export',
  /** Reveals the before/after change summary of an audit record. */
  'audit.viewChanges',
  /** Reveals request context (IP, user agent) on an audit record. */
  'audit.viewContext',

  // Approvals (APPROVAL-001 … APPROVAL-007). Breadth comes from the data scope, as everywhere else
  // (ADR-0006): there is deliberately no "viewAny" permission, because a second breadth mechanism
  // alongside scopes is how the two drift apart.
  'approval.policy.view',
  /** Create or edit a **draft** policy. A published version is immutable (APPROVAL-006). */
  'approval.policy.create',
  /** Publish a draft, which makes it the version live requests are bound to. Administrative. */
  'approval.policy.publish',
  'approval.request.create',
  'approval.request.view',
  /** Reveals the monetary and percentage context of a request; financial values are field-controlled. */
  'approval.request.viewAmounts',
  'approval.request.approve',
  'approval.request.reject',
  /** Cancel someone else's request within scope. A requester may always cancel their own. */
  'approval.request.cancel',
  /** Move a pending stage to another approver — the offboarding path (APPROVAL-007). Administrative. */
  'approval.request.reassign',
  /** Escalate overdue stages to the direct manager (APPROVAL-005). Administrative. */
  'approval.request.escalate',
  /** Delegate your own approval authority, time-bounded (APPROVAL-004). */
  'approval.delegation.manage',
  /** Create or revoke a delegation on behalf of another account. Administrative. */
  'approval.delegation.manageAny',

  // Security accounts (SEC-011 … SEC-022). Administration only: a person needs no permission to
  // manage their own sessions or their own second factor.
  'security.account.view',
  'security.account.create',
  'security.account.suspend',
  'security.account.reactivate',
  'security.account.offboard',
  /** Clear another account's second factor — a recovery path, and an obvious escalation route. */
  'security.account.resetMfa',
  /** Issue a password-reset token for another account, to be delivered out of band. */
  'security.account.resetPassword',
  'security.session.viewAny',
  'security.session.revokeAny',

  // Security administration
  'security.role.view',
  'security.role.create',
  'security.role.edit',
  'security.grant.view',
  'security.grant.assign',
  /** Grant permissions or scopes the actor does not personally hold. Deliberately separate. */
  'security.grant.assignAny',
] as const;

export const PermissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof PermissionSchema>;

/**
 * Administrative permissions are explicit: they are never implied by any other permission, and a role
 * carrying one is flagged so that `SD-02` role design can see them at a glance.
 */
export const ADMINISTRATIVE_PERMISSIONS: readonly Permission[] = [
  // Approval controls: publishing a policy, moving someone else's pending decision, escalating, and
  // delegating on another account's behalf all change who may approve what.
  'approval.policy.publish',
  'approval.request.reassign',
  'approval.request.escalate',
  'approval.delegation.manageAny',
  'security.account.create',
  'security.account.suspend',
  'security.account.reactivate',
  'security.account.offboard',
  'security.account.resetMfa',
  'security.account.resetPassword',
  'security.session.revokeAny',
  'security.role.create',
  'security.role.edit',
  'security.grant.assign',
  'security.grant.assignAny',
];

/**
 * Permissions whose holder must complete a second factor to sign in (`SEC-017`).
 *
 * Master Mapping §6 names the privileged categories: system administration, Meta administration,
 * payroll, treasury, banking, and finance approval. Only the first exists today, so this set is the
 * administrative permissions plus the audit export — reading the whole audit trail is privileged even
 * though it changes nothing. Later phases add their own; the concrete business role list is `SD-02`.
 */
export const MFA_REQUIRED_PERMISSIONS: readonly Permission[] = [
  ...ADMINISTRATIVE_PERMISSIONS,
  'audit.export',
];

/** True when any held permission makes a second factor mandatory. */
export function requiresMfa(permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => MFA_REQUIRED_PERMISSIONS.includes(permission));
}

export function isAdministrativePermission(permission: Permission): boolean {
  return ADMINISTRATIVE_PERMISSIONS.includes(permission);
}

/**
 * Data scope levels (SEC-026, MASTER-MAPPING §6), ordered from narrowest to widest. The order is used
 * to stop an actor from granting a scope wider than their own (SEC-031).
 */
export const SCOPE_LEVELS = [
  'self',
  'assigned',
  'team',
  'department',
  'branch',
  'project',
  'legalEntity',
  'all',
] as const;

export const ScopeLevelSchema = z.enum(SCOPE_LEVELS);
export type ScopeLevel = z.infer<typeof ScopeLevelSchema>;

export function scopeRank(level: ScopeLevel): number {
  return SCOPE_LEVELS.indexOf(level);
}

/**
 * Organization references the scope resolves against. The values are owned by `CORE-ORG` (Phase 2) and
 * are opaque identifiers here — `SEC` stores the assignment, never the hierarchy (ADR-0019).
 */
export const ScopeAssignmentSchema = z.strictObject({
  level: ScopeLevelSchema,
  teamIds: z.array(z.string().min(1)).max(200).default([]),
  departmentIds: z.array(z.string().min(1)).max(200).default([]),
  branchIds: z.array(z.string().min(1)).max(200).default([]),
  projectIds: z.array(z.string().min(1)).max(500).default([]),
  legalEntityIds: z.array(z.string().min(1)).max(50).default([]),
});
export type ScopeAssignment = z.infer<typeof ScopeAssignmentSchema>;

/**
 * The actor context is built **on the server** from stored grants on every request. Nothing in it is
 * ever taken from the client: a request that claims roles, permissions, or ownership is ignored.
 */
export const ActorContextSchema = z.strictObject({
  /** Opaque reference to a security account (`SEC-011`). Never an employee record (ADR-0019). */
  accountId: z.string().min(1),
  kind: z.enum(['account', 'system']).default('account'),
  roleKeys: z.array(z.string().min(1)).default([]),
  permissions: z.array(PermissionSchema).default([]),
  /** Explicit denials. Deny always wins over a grant (SEC-025). */
  deniedPermissions: z.array(PermissionSchema).default([]),
  scope: ScopeAssignmentSchema,
  sessionId: z.string().min(1).optional(),
  /** Increments on every grant change, so a change is observable (SEC-032). */
  grantVersion: z.number().int().nonnegative().default(0),
});
export type ActorContext = z.infer<typeof ActorContextSchema>;

/** A role is a named bundle of permissions — administrative convenience only (SEC-024). */
export const RoleSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/, { message: 'ROLE_KEY_EXPECTED' }),
  name: LocalizedLabelSchema,
  permissions: z.array(PermissionSchema).max(PERMISSIONS.length),
  isAdministrative: z.boolean(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Role = z.infer<typeof RoleSchema>;

export const CreateRoleRequestSchema = z.strictObject({
  key: RoleSchema.shape.key,
  name: LocalizedLabelSchema,
  permissions: z.array(PermissionSchema).min(1).max(PERMISSIONS.length),
});
export type CreateRoleRequest = z.infer<typeof CreateRoleRequestSchema>;

export const RoleListResponseSchema = z.strictObject({ items: z.array(RoleSchema) });

/** What an account is granted: roles, explicit denials, and one data scope. */
export const AccountGrantSchema = z.strictObject({
  accountId: z.string().min(1),
  roleKeys: z.array(z.string().min(1)).max(50),
  deniedPermissions: z.array(PermissionSchema).max(PERMISSIONS.length),
  scope: ScopeAssignmentSchema,
  version: z.number().int().positive(),
  updatedAt: z.string(),
  updatedBy: z.string().min(1),
});
export type AccountGrant = z.infer<typeof AccountGrantSchema>;

export const SetAccountGrantRequestSchema = z.strictObject({
  roleKeys: z.array(z.string().min(1)).max(50),
  deniedPermissions: z.array(PermissionSchema).max(PERMISSIONS.length).default([]),
  scope: ScopeAssignmentSchema,
});
export type SetAccountGrantRequest = z.infer<typeof SetAccountGrantRequestSchema>;

/** Resources that carry field-level restrictions (SEC-029). */
export const RESTRICTED_RESOURCES = ['auditEvent', 'accountGrant', 'approvalRequest'] as const;
export type RestrictedResource = (typeof RESTRICTED_RESOURCES)[number];

/**
 * Field → permission required to see it. A field the actor may not see is **absent** from the payload,
 * never `null` and never masked client-side (SEC-029, ADR-0006).
 */
export const FIELD_RESTRICTIONS: Readonly<
  Record<RestrictedResource, Readonly<Record<string, Permission>>>
> = {
  auditEvent: {
    changes: 'audit.viewChanges',
    'context.ip': 'audit.viewContext',
    'context.userAgent': 'audit.viewContext',
  },
  accountGrant: {
    /**
     * The explicit denial list is a policy detail: reading a grant shows which roles and scope an
     * account has, but seeing how the policy was narrowed requires the administrative permission that
     * can change it.
     */
    deniedPermissions: 'security.grant.assign',
  },
  approvalRequest: {
    /**
     * Master Mapping §6 lists financial values among the field-controlled classes. Someone may need to
     * see that an approval is outstanding without seeing the amount that triggered it.
     */
    'context.amount': 'approval.request.viewAmounts',
    'context.percentage': 'approval.request.viewAmounts',
  },
};
