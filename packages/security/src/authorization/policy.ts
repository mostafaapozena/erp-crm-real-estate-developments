import type { ActorContext, Permission } from '@alola/contracts';
import { PermissionDeniedError, UnauthenticatedError } from './errors';

/**
 * Permission evaluation (SEC-025).
 *
 * - **Default deny.** An unknown, unlisted, or missing permission is denied; nothing is implied.
 * - **Deny wins.** An explicit denial beats any grant, whatever its source.
 * - **Permissions only.** Role names are never consulted — roles exist to compose permissions
 *   (SEC-024), and a check against a role name would silently change meaning when the role changes.
 */
export function can(actor: ActorContext | undefined, permission: Permission): boolean {
  if (!actor) return false;
  if (actor.deniedPermissions.includes(permission)) return false;
  return actor.permissions.includes(permission);
}

export function canAll(
  actor: ActorContext | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.every((permission) => can(actor, permission));
}

/** Throws `UnauthenticatedError` when there is no actor, `PermissionDeniedError` when denied. */
export function assertPermission(
  actor: ActorContext | undefined,
  permission: Permission,
): asserts actor is ActorContext {
  if (!actor) throw new UnauthenticatedError();
  if (!can(actor, permission)) throw new PermissionDeniedError(permission);
}

/**
 * The permissions an actor effectively holds, after denials. Used for privilege-escalation checks
 * (SEC-031) and for audit evidence — never for a shortcut around `can()`.
 */
export function effectivePermissions(actor: ActorContext): Permission[] {
  return actor.permissions.filter((permission) => !actor.deniedPermissions.includes(permission));
}

/** Compose a role's permissions into the flat set an actor holds (SEC-024). */
export function resolvePermissions(
  roles: readonly { key: string; permissions: readonly Permission[] }[],
  assignedRoleKeys: readonly string[],
  deniedPermissions: readonly Permission[] = [],
): Permission[] {
  const assigned = new Set(assignedRoleKeys);
  const denied = new Set(deniedPermissions);
  const granted = new Set<Permission>();
  for (const role of roles) {
    if (!assigned.has(role.key)) continue;
    for (const permission of role.permissions) {
      if (!denied.has(permission)) granted.add(permission);
    }
  }
  return [...granted].sort();
}
