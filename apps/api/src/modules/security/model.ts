import { Schema, type Connection, type Model } from 'mongoose';

/**
 * Authorization storage (SEC-024, SEC-026).
 *
 * Two collections, deliberately small:
 *
 * - `roles` — named permission bundles. Administrative convenience only; checks evaluate permissions
 *   (SEC-025). The business role list is a stakeholder input (`SD-02`), so nothing is seeded here.
 * - `accountGrants` — what one security account is granted: roles, explicit denials, one data scope.
 *   `accountId` is an **opaque reference** to a security account; this collection never holds employee or
 *   organization data (ADR-0019). Records are read on every request, so a change takes effect
 *   immediately (SEC-032) — there is no cache to invalidate.
 *
 * Neither collection is append-only: roles and grants are configuration that legitimately changes. Every
 * change is audited instead (AUDIT-005).
 */
export const ROLES_COLLECTION = 'roles';
export const ACCOUNT_GRANTS_COLLECTION = 'accountGrants';

export interface RoleDocument {
  key: string;
  name: { ar: string; en: string };
  permissions: string[];
  isAdministrative: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountGrantDocument {
  accountId: string;
  roleKeys: string[];
  deniedPermissions: string[];
  scope: {
    level: string;
    teamIds: string[];
    departmentIds: string[];
    branchIds: string[];
    projectIds: string[];
    legalEntityIds: string[];
  };
  version: number;
  updatedAt: Date;
  updatedBy: string;
}

/** Explicit sub-schemas, for the same reason as the audit model. */
const localizedNameSchema = new Schema(
  { ar: { type: String, required: true }, en: { type: String, required: true } },
  { _id: false },
);

const scopeSchema = new Schema(
  {
    level: { type: String, required: true },
    teamIds: { type: [String], required: true },
    departmentIds: { type: [String], required: true },
    branchIds: { type: [String], required: true },
    projectIds: { type: [String], required: true },
    legalEntityIds: { type: [String], required: true },
  },
  { _id: false },
);

function roleSchema(): Schema<RoleDocument> {
  const schema = new Schema<RoleDocument>(
    {
      key: { type: String, required: true },
      name: { type: localizedNameSchema, required: true },
      permissions: { type: [String], required: true },
      isAdministrative: { type: Boolean, required: true },
      version: { type: Number, required: true },
      createdAt: { type: Date, required: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: ROLES_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  schema.index({ key: 1 }, { unique: true, name: 'roles_key_unique' });
  return schema;
}

function accountGrantSchema(): Schema<AccountGrantDocument> {
  const schema = new Schema<AccountGrantDocument>(
    {
      accountId: { type: String, required: true },
      roleKeys: { type: [String], required: true },
      deniedPermissions: { type: [String], required: true },
      scope: { type: scopeSchema, required: true },
      version: { type: Number, required: true },
      updatedAt: { type: Date, required: true },
      updatedBy: { type: String, required: true },
    },
    {
      collection: ACCOUNT_GRANTS_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
    },
  );
  // One grant record per account; the unique index is what makes "read on every request" cheap.
  schema.index({ accountId: 1 }, { unique: true, name: 'accountGrants_accountId_unique' });
  schema.index({ roleKeys: 1 }, { name: 'accountGrants_roleKeys' });
  return schema;
}

export function roleModel(connection: Connection): Model<RoleDocument> {
  return (
    (connection.models[ROLES_COLLECTION] as Model<RoleDocument> | undefined) ??
    connection.model<RoleDocument>(ROLES_COLLECTION, roleSchema())
  );
}

export function accountGrantModel(connection: Connection): Model<AccountGrantDocument> {
  return (
    (connection.models[ACCOUNT_GRANTS_COLLECTION] as Model<AccountGrantDocument> | undefined) ??
    connection.model<AccountGrantDocument>(ACCOUNT_GRANTS_COLLECTION, accountGrantSchema())
  );
}
