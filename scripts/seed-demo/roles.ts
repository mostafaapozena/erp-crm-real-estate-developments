import type { Permission, ScopeLevel } from '@alola/contracts';

/**
 * The seven demonstration roles.
 *
 * **These are not `SD-02`.** The business role list — who may approve what, at which threshold, and
 * which duties may never meet in one person — is an open stakeholder decision. What is here is a
 * plausible set for showing the product, chosen so the demonstration can prove that authorization is
 * real: each role sees a genuinely different system, and the differences are enforced by the server.
 *
 * Three things are deliberate and worth not "fixing" later:
 *
 * - **Only the system administrator holds administrative permissions**, which is why only that
 *   account needs a second factor (`SEC-017`). Giving the business roles administrative permissions
 *   to avoid the MFA prompt would be weakening a control for convenience.
 * - **The sales roles are scoped to one branch.** That is the scope this demonstration shows being
 *   enforced: the Cairo sales manager and representatives cannot see the Alexandria project at all,
 *   and the server — not the interface — is what withholds it.
 * - **The sales representatives are *not* scoped to `assigned`**, although per-representative lead
 *   privacy is what a sales floor usually wants. A scope level applies to an account, not to a
 *   resource, and a unit has no assignee — so an `assigned` representative would correctly resolve to
 *   "no inventory" and could never reach the unit they are trying to reserve. Narrowing leads per
 *   representative while leaving inventory readable needs **per-resource scope**, which the product
 *   does not have yet. It is recorded as technical debt rather than papered over by giving units a
 *   fake owner.
 */
export interface DemoRole {
  key: string;
  name: { ar: string; en: string };
  scope: ScopeLevel;
  permissions: Permission[];
}

const INVENTORY_READ: Permission[] = ['inventory.project.view', 'inventory.unit.view'];
const INVENTORY_PRICING: Permission[] = [...INVENTORY_READ, 'inventory.unit.viewPricing'];

const SALES_READ: Permission[] = ['sales.reservation.view', 'sales.contract.view'];

/**
 * Issued PDFs (CORE-DOC-003, CORE-DOC-005), added for package 7's user-acceptance testing. Reading
 * one also needs the permission that reads its source record, which each role already has or lacks.
 * `npm run seed:demo:documents` adds these to an already-seeded database without re-seeding.
 */
export const DOCUMENT_READ: Permission[] = ['document.view', 'document.download'];
export const DOCUMENT_ISSUE: Permission[] = [...DOCUMENT_READ, 'document.generate'];

const COLLECTION_READ: Permission[] = [
  'collection.installment.view',
  'collection.receipt.view',
  'collection.instrument.view',
  'collection.reminder.view',
];

/** What the administrator reads so it can revoke an issued PDF: the sources of every type. */
export const ADMIN_DOCUMENT_SOURCES: Permission[] = [
  ...SALES_READ,
  ...COLLECTION_READ,
  'crm.customer.view',
];

/**
 * The BMP-1 commercial permissions per demonstration role (BMP-1 package 8), added for user-acceptance
 * testing of the full sales journey. **Demonstration configuration, not `SD-02`.** The separations are
 * deliberate and are what the matrix test pins:
 *
 * - **Activating, cancelling, amending and signing a contract are the manager's**, never the
 *   representative's. The representative raises; the manager commits.
 * - **Seeing an identity document is the manager's** (`crm.customer.viewIdentity`); a representative
 *   works without it and the contract says so (`identityMissing`).
 * - **Configuration stays administrative**: commercial settings and number formats are the system
 *   administrator's (`settings.manage`, `numbering.manage`), behind the second factor.
 * - **The executive reads everything and changes nothing.**
 *
 * `npm run seed:demo:bmp1` adds these to an already-seeded database; a fresh seed creates the roles
 * with them.
 */
export const BMP1_ADDITIONS: Record<string, Permission[]> = {
  'demo-executive': [
    'crm.opportunity.view',
    'sales.quotation.view',
    'settings.view',
    'numbering.view',
  ],
  'demo-system-administrator': [
    'settings.view',
    'settings.manage',
    'numbering.view',
    'numbering.manage',
  ],
  'demo-sales-manager': [
    'crm.lead.convert',
    'crm.customer.viewIdentity',
    'crm.customer.transfer',
    'crm.opportunity.view',
    'crm.opportunity.manage',
    'crm.opportunity.assign',
    'crm.lead.export',
    'inventory.unit.export',
    'inventory.hold.create',
    'inventory.hold.manage',
    'sales.quotation.view',
    'sales.quotation.manage',
    'sales.reservation.extend',
    'sales.contract.activate',
    'sales.contract.sign',
    'sales.contract.amend',
    'sales.contract.cancel',
  ],
  'demo-sales-representative': [
    'crm.lead.convert',
    'crm.opportunity.view',
    'crm.opportunity.manage',
    'inventory.hold.create',
    'sales.quotation.view',
    'sales.quotation.manage',
  ],
  'demo-collection-officer': ['sales.quotation.view'],
  'demo-accountant': [],
  'demo-marketing-manager': ['crm.opportunity.view'],
};

const withBmp1 = (role: DemoRole): DemoRole => ({
  ...role,
  permissions: [
    ...role.permissions,
    ...(BMP1_ADDITIONS[role.key] ?? []).filter(
      (permission) => !role.permissions.includes(permission),
    ),
  ],
});

const BASE_ROLES: DemoRole[] = [
  {
    key: 'demo-executive',
    name: { ar: 'الإدارة التنفيذية', en: 'Executive management' },
    scope: 'all',
    permissions: [
      ...INVENTORY_PRICING,
      ...SALES_READ,
      ...COLLECTION_READ,
      'crm.customer.view',
      'crm.lead.view',
      'marketing.campaign.view',
      'org.view',
      'org.placement.view',
      'approval.request.view',
      'approval.request.viewAmounts',
      ...DOCUMENT_READ,
    ],
  },
  {
    key: 'demo-system-administrator',
    name: { ar: 'مسؤول النظام', en: 'System administrator' },
    scope: 'all',
    permissions: [
      // The deployment's identity: Settings → Company identity (PLAT-022). Administrative, so it sits
      // with the one role that already carries a second factor.
      'company.profile.view',
      'company.profile.manage',
      'org.view',
      'org.manage',
      'org.placement.view',
      'org.placement.manage',
      // Inventory setup is administration in a developer this size: the catalogue of projects,
      // buildings and units is reference data, not something a sales team edits mid-negotiation.
      ...INVENTORY_PRICING,
      'inventory.project.manage',
      'inventory.unit.manage',
      'security.account.view',
      'security.account.create',
      'security.account.suspend',
      'security.account.reactivate',
      'security.role.view',
      'security.role.create',
      'security.grant.view',
      'security.grant.assign',
      'security.session.viewAny',
      'security.session.revokeAny',
      'audit.view',
      'audit.viewChanges',
      'approval.policy.view',
      'approval.policy.create',
      'approval.policy.publish',
      'approval.request.view',
      // Revoking an issued PDF is administrative (a second factor), and revoking one needs to read it:
      // hence the read permissions of every document source, and nothing that changes a record.
      ...ADMIN_DOCUMENT_SOURCES,
      ...DOCUMENT_READ,
      'document.revoke',
    ],
  },
  {
    key: 'demo-sales-manager',
    name: { ar: 'مدير المبيعات', en: 'Sales manager' },
    scope: 'branch',
    permissions: [
      ...INVENTORY_PRICING,
      'crm.customer.view',
      'crm.customer.manage',
      'crm.lead.view',
      'crm.lead.create',
      'crm.lead.edit',
      'crm.lead.assign',
      'crm.activity.create',
      'sales.reservation.view',
      'sales.reservation.create',
      // The manager confirms; the representative raises. That separation is the point of the role.
      'sales.reservation.confirm',
      'sales.reservation.cancel',
      'sales.contract.view',
      'sales.contract.create',
      'collection.installment.view',
      'approval.request.view',
      'approval.request.viewAmounts',
      'approval.request.approve',
      'approval.request.reject',
      'org.view',
      'org.placement.view',
      ...DOCUMENT_ISSUE,
    ],
  },
  {
    key: 'demo-sales-representative',
    name: { ar: 'مندوب مبيعات', en: 'Sales representative' },
    scope: 'branch',
    permissions: [
      ...INVENTORY_PRICING,
      'crm.customer.view',
      'crm.customer.manage',
      'crm.lead.view',
      'crm.lead.create',
      'crm.lead.edit',
      'crm.activity.create',
      'sales.reservation.view',
      'sales.reservation.create',
      'sales.contract.view',
      'collection.installment.view',
      ...DOCUMENT_ISSUE,
    ],
  },
  {
    key: 'demo-collection-officer',
    name: { ar: 'مسؤول التحصيل', en: 'Collection officer' },
    scope: 'all',
    permissions: [
      ...INVENTORY_READ,
      ...COLLECTION_READ,
      'crm.customer.view',
      'sales.contract.view',
      'collection.receipt.create',
      'collection.instrument.manage',
      'collection.reminder.manage',
      ...DOCUMENT_ISSUE,
    ],
  },
  {
    key: 'demo-accountant',
    name: { ar: 'محاسب', en: 'Accountant' },
    scope: 'all',
    permissions: [
      ...COLLECTION_READ,
      'crm.customer.view',
      'sales.contract.view',
      'inventory.project.view',
      'inventory.unit.view',
      'inventory.unit.viewPricing',
      // An accountant may reverse a receipt; a collection officer may not. Maker and checker.
      'collection.receipt.cancel',
      ...DOCUMENT_READ,
    ],
  },
  {
    key: 'demo-marketing-manager',
    name: { ar: 'مدير التسويق', en: 'Marketing manager' },
    scope: 'all',
    permissions: [
      'marketing.campaign.view',
      'marketing.campaign.manage',
      'crm.lead.view',
      'inventory.project.view',
    ],
  },
];

export const DEMO_ROLES: DemoRole[] = BASE_ROLES.map(withBmp1);
