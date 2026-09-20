import {
  scopeRank,
  type ActorContext,
  type Permission,
  type ScopeAssignment,
} from '@alola/contracts';
import { can, effectivePermissions } from './policy';
import { PrivilegeEscalationError } from './errors';

/**
 * Privilege-escalation prevention (SEC-031).
 *
 * Three independent rules, each with its own test:
 *
 * 1. **No self-elevation.** An actor may never modify their own grants, whatever permissions they hold.
 *    Reviewing your own authorization is the classic escalation path.
 * 2. **No granting what you do not hold.** Assigning a permission the actor lacks requires the explicit
 *    `security.grant.assignAny` permission — never implied by `security.grant.assign`.
 * 3. **No widening scope beyond your own.** A branch-scoped administrator cannot mint an `all`-scoped
 *    account, again unless they hold `security.grant.assignAny`.
 */

export function assertNotSelfGrant(actor: ActorContext, targetAccountId: string): void {
  if (actor.accountId === targetAccountId) {
    throw new PrivilegeEscalationError('self-grant');
  }
}

export function assertCanGrantPermissions(
  actor: ActorContext,
  requestedPermissions: readonly Permission[],
): void {
  if (can(actor, 'security.grant.assignAny')) return;
  const held = new Set(effectivePermissions(actor));
  const excess = requestedPermissions.filter((permission) => !held.has(permission));
  if (excess.length > 0) {
    throw new PrivilegeEscalationError(`grant-exceeds-own:${excess.join(',')}`);
  }
}

export function assertCanGrantScope(actor: ActorContext, requestedScope: ScopeAssignment): void {
  if (can(actor, 'security.grant.assignAny')) return;
  if (scopeRank(requestedScope.level) > scopeRank(actor.scope.level)) {
    throw new PrivilegeEscalationError(
      `scope-exceeds-own:${requestedScope.level}>${actor.scope.level}`,
    );
  }
}

/** Every rule at once, for the grant-assignment path. */
export function assertGrantAllowed(
  actor: ActorContext,
  targetAccountId: string,
  requestedPermissions: readonly Permission[],
  requestedScope: ScopeAssignment,
): void {
  assertNotSelfGrant(actor, targetAccountId);
  assertCanGrantPermissions(actor, requestedPermissions);
  assertCanGrantScope(actor, requestedScope);
}
