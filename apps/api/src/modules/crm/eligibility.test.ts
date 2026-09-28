import {
  ScopeAssignmentSchema,
  normalizeEmail,
  normalizeIdentityNumber,
  type ActorContext,
  type ScopeAssignment,
} from '@alola/contracts';
import { describe, expect, it } from 'vitest';
import { placementInScope } from './service';

const actor = (
  level: ScopeAssignment['level'],
  refs: Readonly<Record<string, readonly string[]>> = {},
): ActorContext => ({
  accountId: 'acc_actor',
  kind: 'account',
  roleKeys: [],
  permissions: [],
  deniedPermissions: [],
  scope: ScopeAssignmentSchema.parse({ level, ...refs }),
  grantVersion: 0,
});

const placement = {
  legalEntityId: 'le_one',
  branchId: 'br_one',
  departmentId: 'dep_one',
  teamId: 'team_one',
};

describe('placementInScope (CRM-ASSIGN-001)', () => {
  it('always lets an actor hand work to themselves', () => {
    expect(placementInScope(actor('self'), 'acc_actor', placement)).toBe(true);
  });

  it.each([
    ['all', {}, true],
    ['legalEntity', { legalEntityIds: ['le_one'] }, true],
    ['legalEntity', { legalEntityIds: ['le_two'] }, false],
    ['branch', { branchIds: ['br_one'] }, true],
    ['branch', { branchIds: ['br_two'] }, false],
    ['department', { departmentIds: ['dep_one'] }, true],
    ['team', { teamIds: ['team_one'] }, true],
    ['team', { teamIds: ['team_two'] }, false],
    // No placement carries a project, and a representative's scope covers only themselves: fail closed.
    ['project', { projectIds: ['prj_one'] }, false],
    ['assigned', {}, false],
    ['self', {}, false],
  ] as const)('%s scope %j → %s', (level, refs, expected) => {
    expect(placementInScope(actor(level, refs), 'acc_colleague', placement)).toBe(expected);
  });

  it('refuses a team-scoped actor a colleague with no team', () => {
    const { teamId: _team, ...noTeam } = placement;
    expect(
      placementInScope(actor('team', { teamIds: ['team_one'] }), 'acc_colleague', noTeam),
    ).toBe(false);
  });
});

describe('duplicate-matching normal forms (CRM-PERSON-006)', () => {
  it('matches identity numbers on letters and digits, ignoring case and separators', () => {
    expect(normalizeIdentityNumber('a12 345-67')).toBe('A1234567');
    expect(normalizeIdentityNumber('DEMO-NID-0001')).toBe('DEMONID0001');
  });

  it('matches e-mail addresses without regard to case or surrounding space', () => {
    expect(normalizeEmail('  Buyer.One@Example.TEST ')).toBe('buyer.one@example.test');
  });
});
