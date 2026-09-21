import {
  ScopeAssignmentSchema,
  type LocalizedLabel,
  type Permission,
  type ScopeAssignment,
} from '@alola/contracts';
import type { Connection } from 'mongoose';
import { accountGrantModel, roleModel } from './model';

/**
 * Unguarded writes of authorization state, for the two situations where no actor can exist yet.
 *
 * `SecurityService` refuses to create a role or a grant without an actor holding the right permissions —
 * which is correct, and which makes the very first grant impossible through it. These functions are the
 * documented exception:
 *
 * - `scripts/bootstrap-admin.ts`, run once by someone who already holds database credentials;
 * - integration-test fixtures, which need authorization state before they can exercise anything.
 *
 * They are **not** reachable over HTTP: no router calls them, and every API path goes through the guarded
 * service. Keeping them here, named for what they are, is why the module's storage stays private.
 */
export interface BootstrapRoleInput {
  key: string;
  name: LocalizedLabel;
  permissions: readonly Permission[];
  isAdministrative?: boolean;
}

export async function bootstrapRole(
  connection: Connection,
  input: BootstrapRoleInput,
): Promise<void> {
  const now = new Date();
  await roleModel(connection)
    .updateOne(
      { key: input.key },
      {
        $set: {
          key: input.key,
          name: input.name,
          permissions: [...new Set(input.permissions)].sort(),
          isAdministrative: input.isAdministrative ?? false,
          version: 1,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    )
    .exec();
}

export interface BootstrapGrantInput {
  accountId: string;
  roleKeys: readonly string[];
  scope?: ScopeAssignment;
  deniedPermissions?: readonly Permission[];
  updatedBy: string;
}

export async function bootstrapGrant(
  connection: Connection,
  input: BootstrapGrantInput,
): Promise<void> {
  await accountGrantModel(connection)
    .updateOne(
      { accountId: input.accountId },
      {
        $set: {
          accountId: input.accountId,
          roleKeys: [...input.roleKeys],
          deniedPermissions: [...(input.deniedPermissions ?? [])],
          scope: input.scope ?? ScopeAssignmentSchema.parse({ level: 'all' }),
          version: 1,
          updatedAt: new Date(),
          updatedBy: input.updatedBy,
        },
      },
      { upsert: true },
    )
    .exec();
}
