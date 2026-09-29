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

  // Deployment company profile and branding (PLAT-022, PLAT-023, ADR-0027)
  'company.profile.view',
  /** Change the company's identity, contact details, colour or images. Administrative. */
  'company.profile.manage',

  // Settings, reference data and feature flags (PLAT-024 … PLAT-026)
  'settings.view',
  /** Change a business setting or a feature flag. Administrative. */
  'settings.manage',
  /** Add, relabel, reorder, deactivate reference items; add tax rates. Administrative. */
  'referenceData.manage',

  // Number sequences (CORE-DOC-001). Issuing is a module operation, never a route.
  'numbering.view',
  /** Define and activate a document number format. Administrative. */
  'numbering.manage',

  // Documents and templates (CORE-DOC-002, 004, 006). Breadth is the owning record's scope.
  'document.view',
  'document.upload',
  /** Obtain a short-lived link to a document's file. Every issue is audited (CORE-DOC-006). */
  'document.download',
  'document.archive',
  /** Set a document's retention date or legal hold. Administrative. */
  'document.manageRetention',
  'template.view',
  /** Write, publish and retire templates — the wording documents are issued in. Administrative. */
  'template.manage',

  // Notifications (CORE-NOTIFY). A person needs no permission for their own inbox.
  /** See the delivery state of every notification — operations, not content. Administrative. */
  'notification.viewDeliveries',
  /** Run the delivery sweep by hand. Administrative. */
  'notification.dispatch',

  // Tasks (CORE-TASK). A person needs no permission for tasks assigned to, escalated to, or created by them.
  /** See every task inside one's data scope, not only one's own. */
  'task.view',
  'task.create',
  /** Edit, reassign, cancel and reopen tasks inside one's data scope, not only those one created. */
  'task.manage',
  /** Move all of a person's open tasks to someone else, e.g. at offboarding. Administrative. */
  'task.reassign',
  /** Run the reminder and escalation sweep by hand. Administrative. */
  'task.sweep',

  // Integrations (INTEGRATION-001 … 005). All administrative: a provider connection speaks for the
  // whole company, and its health reveals which providers the company uses.
  /** See each provider's state and health — never a credential. */
  'integration.view',
  /** Store credentials, switch a provider off or on, run its check. */
  'integration.manage',
  /** Run the webhook-processing and outbox sweep by hand. */
  'integration.process',

  // Operations (OPS-006). Administrative: it shows how the deployment is built and configured.
  'operations.diagnostics',

  // Security administration
  'security.role.view',
  'security.role.create',
  'security.role.edit',
  'security.grant.view',
  'security.grant.assign',
  /** Grant permissions or scopes the actor does not personally hold. Deliberately separate. */
  'security.grant.assignAny',

  /* ------------------------------------------------------------------------
   * Demonstration-slice permissions (Macro Phase 1, ADR-0025).
   *
   * These name verbs in modules whose engineering phase has not started. They are registered here
   * because authorization is never added retroactively: a route without a permission is a route that
   * ships open. Breadth is still the data scope, never a `viewAny` permission (ADR-0006).
   * ---------------------------------------------------------------------- */

  // Organization (`CORE-ORG`)
  'org.view',
  /** Create or change the hierarchy every data scope resolves against. Administrative. */
  'org.manage',
  'org.placement.view',
  /** Place a person, or change who they report to — which changes where approvals escalate. Administrative. */
  'org.placement.manage',

  // Inventory (`INV-*`)
  'inventory.project.view',
  'inventory.project.manage',
  'inventory.unit.view',
  /** Create units and change their status through the permitted transitions. */
  'inventory.unit.manage',
  /** Reveals a unit's pricing. Someone may need to see availability without seeing the price list. */
  'inventory.unit.viewPricing',
  /** Take units out of the system as a file (CORE-IMPORT-003). Prices only with viewPricing too. */
  'inventory.unit.export',
  /** Propose or cancel a unit price version; it takes effect through approval where a policy applies (INV-PRICE-003). */
  'inventory.price.propose',
  /** Take a timed customer hold on an available unit, and act on one's own holds (INV-HOLD-001). */
  'inventory.hold.create',
  /** Release or extend anyone's hold inside one's scope (INV-HOLD-002). */
  'inventory.hold.manage',
  /** Create and retire payment-plan templates (INV-PLAN-001). */
  'inventory.plan.manage',

  // CRM (`CRM-*`)
  'crm.customer.view',
  'crm.customer.manage',
  /** Reveals identity document numbers (CRM-PERSON-002). Absent without it, never masked. */
  'crm.customer.viewIdentity',
  /** Hand a customer to another owner, or name the owner when creating one (CRM-OWNER-001). */
  'crm.customer.transfer',
  'crm.lead.view',
  /** Turn a lead into a customer — the one path by which a representative creates a customer (CRM-LEAD-005). */
  'crm.lead.convert',
  /** Take leads — names and phone numbers — out of the system as a file (CORE-IMPORT-003). */
  'crm.lead.export',
  /** Bring leads in from a file, previewed and committed as one transaction (CRM-LEAD-006). */
  'crm.lead.import',
  // Opportunities (CRM-OPP). Breadth is the data scope; the owner fields resolve `self`/`assigned`.
  'crm.opportunity.view',
  /** Open, edit and move an opportunity between the open stages, or close it as lost. */
  'crm.opportunity.manage',
  /** Hand an opportunity to another owner, or name the owner when opening one (CRM-OWNER-001). */
  'crm.opportunity.assign',
  'crm.lead.create',
  'crm.lead.edit',
  /** Hand a lead to another sales owner — a manager's action, not an owner's. */
  'crm.lead.assign',
  'crm.activity.create',

  // Sales (`SALE-*`)
  'sales.reservation.view',
  'sales.reservation.create',
  'sales.reservation.confirm',
  'sales.reservation.cancel',
  /** Extend a live reservation's validity; through approval where a policy applies (SALE-RESERVE-003). */
  'sales.reservation.extend',
  'sales.contract.view',
  'sales.contract.create',
  'sales.contract.activate',
  'sales.contract.cancel',

  // Collections (`COL-*`)
  'collection.installment.view',
  'collection.receipt.view',
  'collection.receipt.create',
  /** Reverse a posted receipt. Never an edit: a posted receipt is immutable (ADR-0009). */
  'collection.receipt.cancel',
  'collection.instrument.view',
  'collection.instrument.manage',
  'collection.reminder.view',
  'collection.reminder.manage',

  // Marketing (`MKT-*`). Publication is absent on purpose: no provider is connected (ADR-0026).
  'marketing.campaign.view',
  'marketing.campaign.manage',
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
  /**
   * The company profile is what every document, screen and authenticator label is issued under, so
   * changing it is an administrative act with a second factor (SEC-017).
   */
  'company.profile.manage',
  /** Settings and reference data decide defaults every record is created with (PLAT-024, PLAT-025). */
  'settings.manage',
  'referenceData.manage',
  /** A number format is permanent in every document issued under it (ADR-0009, `SD-10`). */
  'numbering.manage',
  /** Retention and legal hold decide what the organization keeps and for how long. */
  'document.manageRetention',
  /** A published template is the legal wording of every document generated from it. */
  'template.manage',
  'notification.viewDeliveries',
  'notification.dispatch',
  /** Moving someone's whole workload changes who is accountable for it. */
  'task.reassign',
  'task.sweep',
  /** A provider connection acts for the whole company, and its credentials are its keys. */
  'integration.view',
  'integration.manage',
  'integration.process',
  'operations.diagnostics',
  /**
   * Organization structure is administrative because **every data scope resolves against it**
   * (SEC-026) and the reporting line decides where an overdue approval escalates (`APPROVAL-005`).
   * Moving a team between branches silently widens what its members can see, which is an
   * authorization change wearing an org-chart costume.
   */
  'org.manage',
  'org.placement.manage',
];

/**
 * Permissions whose holder must complete a second factor to sign in (`SEC-017`).
 *
 * Master Mapping §6 names the privileged categories: system administration, Meta administration,
 * payroll, treasury, banking, and finance approval. Only system administration exists today —
 * including the organization structure that scopes resolve against — so this set is the administrative
 * permissions plus the audit export, since reading the whole audit trail is privileged even though it
 * changes nothing.
 *
 * The demonstration slice's **business** verbs are deliberately not here. Cancelling a reservation or
 * reversing a receipt is controlled by maker-checker and the approval engine, which is the control the
 * domain actually needs; a second factor in front of a sales representative's daily work buys no
 * security and trains people to treat the prompt as noise. Meta administration is likewise absent
 * because no provider is connected and nothing can be published (ADR-0026) — when Macro Phase 4
 * connects it, `marketing.campaign.publish` arrives administrative. Treasury, banking, and payroll
 * arrive with Phases 6 and 8 and join this set then. The concrete business role list is `SD-02`.
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
export const RESTRICTED_RESOURCES = [
  'auditEvent',
  'accountGrant',
  'approvalRequest',
  'unit',
  'customer',
] as const;
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
  unit: {
    /**
     * Availability and pricing are different questions. A receptionist confirming that a unit is free
     * does not need the price list, and a price list is the most commercially sensitive thing inventory
     * holds. Absent, never masked — a masked price is still serialized (SEC-029).
     */
    basePrice: 'inventory.unit.viewPricing',
    currentPrice: 'inventory.unit.viewPricing',
    pricePerSquareMeter: 'inventory.unit.viewPricing',
  },
  customer: {
    /**
     * Master Mapping §6 names identity among the protected classes. A representative confirming an
     * appointment needs the phone number, not the national ID (CRM-PERSON-002).
     */
    identity: 'crm.customer.viewIdentity',
  },
};
