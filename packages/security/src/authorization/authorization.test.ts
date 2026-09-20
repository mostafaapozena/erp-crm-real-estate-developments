import {
  ActorContextSchema,
  ScopeAssignmentSchema,
  type ActorContext,
  type Permission,
} from '@alola/contracts';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  PermissionDeniedError,
  PrivilegeEscalationError,
  UnauthenticatedError,
  UnsafeFilterError,
} from './errors';
import {
  assertCanGrantPermissions,
  assertCanGrantScope,
  assertGrantAllowed,
  assertNotSelfGrant,
} from './escalation';
import { assertWritableFields, restrictDocument, restrictedFieldsFor } from './fields';
import { assertPermission, can, canAll, effectivePermissions, resolvePermissions } from './policy';
import { assertSafeFilter } from './sanitize';
import { MATCH_NOTHING, buildScopeFilter, isMatchNothing, withScope } from './scope';

/**
 * Overrides are typed as the schema's **input**, so a scope may be written as `{ level: 'team' }` and the
 * reference lists come from the schema defaults — the same shape a stored grant produces.
 */
function actor(overrides: Partial<z.input<typeof ActorContextSchema>> = {}): ActorContext {
  return ActorContextSchema.parse({
    accountId: 'account-1',
    permissions: [],
    deniedPermissions: [],
    scope: { level: 'self' },
    ...overrides,
  });
}

describe('permission evaluation (SEC-025)', () => {
  it('denies by default: no actor, unknown permission, or empty grant', () => {
    expect(can(undefined, 'audit.view')).toBe(false);
    expect(can(actor(), 'audit.view')).toBe(false);
    // A permission that is not in the actor's list is denied, never implied by another.
    expect(can(actor({ permissions: ['audit.export'] }), 'audit.view')).toBe(false);
  });

  it('grants only what is listed', () => {
    expect(can(actor({ permissions: ['audit.view'] }), 'audit.view')).toBe(true);
    expect(
      canAll(actor({ permissions: ['audit.view', 'audit.export'] }), [
        'audit.view',
        'audit.export',
      ]),
    ).toBe(true);
    expect(canAll(actor({ permissions: ['audit.view'] }), ['audit.view', 'audit.export'])).toBe(
      false,
    );
  });

  it('lets deny win over a grant', () => {
    const denied = actor({ permissions: ['audit.view'], deniedPermissions: ['audit.view'] });
    expect(can(denied, 'audit.view')).toBe(false);
    expect(effectivePermissions(denied)).toEqual([]);
  });

  it('never consults role names', () => {
    // An actor carrying an administrator role but no permissions is denied.
    const roleOnly = actor({ roleKeys: ['administrator', 'security-admin'], permissions: [] });
    expect(can(roleOnly, 'security.grant.assign')).toBe(false);
  });

  it('throws the right error for anonymous versus denied', () => {
    expect(() => assertPermission(undefined, 'audit.view')).toThrow(UnauthenticatedError);
    expect(() => assertPermission(actor(), 'audit.view')).toThrow(PermissionDeniedError);
    expect(() =>
      assertPermission(actor({ permissions: ['audit.view'] }), 'audit.view'),
    ).not.toThrow();
  });

  it('composes role permissions and applies denials (SEC-024)', () => {
    const roles = [
      { key: 'auditor', permissions: ['audit.view', 'audit.export'] as Permission[] },
      { key: 'security-admin', permissions: ['security.grant.assign'] as Permission[] },
      { key: 'unused', permissions: ['security.grant.assignAny'] as Permission[] },
    ];
    expect(resolvePermissions(roles, ['auditor', 'security-admin'])).toEqual([
      'audit.export',
      'audit.view',
      'security.grant.assign',
    ]);
    expect(resolvePermissions(roles, ['auditor'], ['audit.export'])).toEqual(['audit.view']);
    expect(resolvePermissions(roles, [])).toEqual([]);
  });
});

describe('data scope filters (SEC-026, SEC-027)', () => {
  const fields = {
    owner: 'ownerId',
    assignee: 'assigneeId',
    team: 'teamId',
    department: 'departmentId',
    branch: 'branchId',
    project: 'projectId',
    legalEntity: 'legalEntityId',
  };

  it('returns an unrestricted filter only for scope "all"', () => {
    expect(buildScopeFilter(actor({ scope: { level: 'all' } }), fields)).toEqual({});
  });

  it('constrains by ownership and assignment', () => {
    expect(buildScopeFilter(actor({ scope: { level: 'self' } }), fields)).toEqual({
      ownerId: 'account-1',
    });
    expect(buildScopeFilter(actor({ scope: { level: 'assigned' } }), fields)).toEqual({
      assigneeId: 'account-1',
    });
  });

  it.each([
    ['team', 'teamIds', 'teamId'],
    ['department', 'departmentIds', 'departmentId'],
    ['branch', 'branchIds', 'branchId'],
    ['project', 'projectIds', 'projectId'],
    ['legalEntity', 'legalEntityIds', 'legalEntityId'],
  ])('constrains by %s references', (level, idsKey, field) => {
    const filter = buildScopeFilter(
      actor({ scope: { level: level as 'team', [idsKey]: ['a', 'b'] } }),
      fields,
    );
    expect(filter).toEqual({ [field]: { $in: ['a', 'b'] } });
  });

  it('fails closed when the scope cannot be satisfied', () => {
    // No branch references granted.
    expect(isMatchNothing(buildScopeFilter(actor({ scope: { level: 'branch' } }), fields))).toBe(
      true,
    );
    // Resource has no branch field to resolve against.
    expect(
      isMatchNothing(
        buildScopeFilter(actor({ scope: { level: 'branch', branchIds: ['b1'] } }), {
          owner: 'ownerId',
        }),
      ),
    ).toBe(true);
    // A failed scope becomes an impossible query, never an open one.
    expect(withScope(MATCH_NOTHING, { action: 'x' })).toEqual({ _id: { $in: [] } });
  });

  it('merges the scope with a query filter instead of replacing it', () => {
    expect(withScope({ ownerId: 'account-1' }, { action: 'audit.events.read' })).toEqual({
      $and: [{ action: 'audit.events.read' }, { ownerId: 'account-1' }],
    });
    expect(withScope({}, { action: 'x' })).toEqual({ action: 'x' });
    expect(withScope({ ownerId: 'account-1' }, {})).toEqual({ ownerId: 'account-1' });
  });
});

describe('field restrictions (SEC-029)', () => {
  const event = {
    eventId: 'e1',
    action: 'security.grant.updated',
    changes: [{ path: 'roleKeys', from: 'a', to: 'b' }],
    context: { correlationId: 'c1', ip: '203.0.113.9', userAgent: 'agent', method: 'PUT' },
  };

  it('removes fields the actor may not see — absent, not null', () => {
    const restricted = restrictDocument(
      'auditEvent',
      actor({ permissions: ['audit.view'] }),
      event,
    );
    expect('changes' in restricted).toBe(false);
    expect(restricted.context && 'ip' in restricted.context).toBe(false);
    expect(restricted.context && 'userAgent' in restricted.context).toBe(false);
    // Unrestricted fields survive untouched.
    expect(restricted.context?.correlationId).toBe('c1');
    expect(restricted.context?.method).toBe('PUT');
    expect(JSON.stringify(restricted)).not.toContain('203.0.113.9');
  });

  it('keeps fields the actor is entitled to', () => {
    const permitted = actor({
      permissions: ['audit.view', 'audit.viewChanges', 'audit.viewContext'],
    });
    const restricted = restrictDocument('auditEvent', permitted, event);
    expect(restricted.changes).toHaveLength(1);
    expect(restricted.context?.ip).toBe('203.0.113.9');
    expect(restrictedFieldsFor('auditEvent', permitted)).toEqual([]);
  });

  it('does not mutate the source document', () => {
    restrictDocument('auditEvent', actor({ permissions: ['audit.view'] }), event);
    expect(event.changes).toHaveLength(1);
    expect(event.context.ip).toBe('203.0.113.9');
  });

  it('refuses writes to fields the actor may not see', () => {
    // A grant's denial list requires the administrative permission that can change it.
    expect(() =>
      assertWritableFields('accountGrant', actor({ permissions: ['security.grant.view'] }), {
        deniedPermissions: ['audit.view'],
      }),
    ).toThrow(PermissionDeniedError);
    expect(() =>
      assertWritableFields('accountGrant', actor({ permissions: ['security.grant.assign'] }), {
        deniedPermissions: ['audit.view'],
      }),
    ).not.toThrow();
  });

  it('removes a grant denial list from an actor who may only view grants', () => {
    const grant = { accountId: 'a-1', roleKeys: ['viewer'], deniedPermissions: ['audit.export'] };
    const viewer = actor({ permissions: ['security.grant.view'] });
    expect(restrictDocument('accountGrant', viewer, grant)).not.toHaveProperty('deniedPermissions');
    expect(restrictDocument('accountGrant', viewer, grant).roleKeys).toEqual(['viewer']);
    const assigner = actor({ permissions: ['security.grant.view', 'security.grant.assign'] });
    expect(restrictDocument('accountGrant', assigner, grant).deniedPermissions).toEqual([
      'audit.export',
    ]);
  });
});

describe('privilege escalation prevention (SEC-031)', () => {
  const admin = actor({
    accountId: 'admin-1',
    permissions: ['security.grant.assign', 'audit.view'],
    scope: { level: 'branch', branchIds: ['b1'] },
  });

  it('refuses to let an actor edit their own grants', () => {
    expect(() => assertNotSelfGrant(admin, 'admin-1')).toThrow(PrivilegeEscalationError);
    expect(() => assertNotSelfGrant(admin, 'other-1')).not.toThrow();
  });

  it('refuses to grant a permission the actor does not hold', () => {
    expect(() => assertCanGrantPermissions(admin, ['audit.view'])).not.toThrow();
    expect(() => assertCanGrantPermissions(admin, ['security.grant.assignAny'])).toThrow(
      PrivilegeEscalationError,
    );
  });

  it('refuses to widen the scope beyond the actor’s own', () => {
    expect(() =>
      assertCanGrantScope(admin, {
        level: 'team',
        teamIds: [],
        departmentIds: [],
        branchIds: [],
        projectIds: [],
        legalEntityIds: [],
      }),
    ).not.toThrow();
    expect(() =>
      assertCanGrantScope(admin, {
        level: 'all',
        teamIds: [],
        departmentIds: [],
        branchIds: [],
        projectIds: [],
        legalEntityIds: [],
      }),
    ).toThrow(PrivilegeEscalationError);
  });

  it('allows an explicit assignAny holder to exceed their own grants — and still not self-grant', () => {
    const superAdmin = actor({
      accountId: 'root-1',
      permissions: ['security.grant.assign', 'security.grant.assignAny'],
      scope: { level: 'branch', branchIds: ['b1'] },
    });
    const wideScope = ScopeAssignmentSchema.parse({ level: 'all' });
    expect(() =>
      assertGrantAllowed(superAdmin, 'other-1', ['audit.export'], wideScope),
    ).not.toThrow();
    expect(() => assertGrantAllowed(superAdmin, 'root-1', ['audit.export'], wideScope)).toThrow(
      PrivilegeEscalationError,
    );
  });
});

describe('operator injection guard', () => {
  it('accepts primitive equality filters', () => {
    expect(() =>
      assertSafeFilter({ action: 'audit.events.read', outcome: 'succeeded' }),
    ).not.toThrow();
    expect(() => assertSafeFilter({ count: 3, flag: true, nothing: null })).not.toThrow();
  });

  it('rejects operator objects, operator keys, and dotted keys from client input', () => {
    expect(() => assertSafeFilter({ actorAccountId: { $ne: null } })).toThrow(UnsafeFilterError);
    expect(() => assertSafeFilter({ $where: '1 == 1' })).toThrow(UnsafeFilterError);
    expect(() => assertSafeFilter({ 'actor.accountId': 'x' })).toThrow(UnsafeFilterError);
    expect(() => assertSafeFilter({ action: { $regex: '.*' } })).toThrow(UnsafeFilterError);
  });
});
