import type {
  ApprovalCondition,
  ApprovalPolicy,
  ApprovalStage,
  ApproverRule,
  ScopeAssignment,
} from '@alola/contracts';
import { ApprovalPolicySchema, ScopeAssignmentSchema, money } from '@alola/contracts';
import { describe, expect, it } from 'vitest';
import {
  DelegationError,
  InvalidTransitionError,
  MAX_DELEGATION_DAYS,
  SelfApprovalError,
  assertDelegationAllowed,
  assertDistinctStageApprover,
  assertTransition,
  compareDecimalStrings,
  conditionMatches,
  evaluateSelfApproval,
  isDelegationActive,
  isEligibleApprover,
  isTerminal,
  policyApplies,
  selectPolicy,
  stageRequirement,
  validatePolicyStages,
  type ConditionSubject,
} from './rules';

/**
 * Approval rules (`APPROVAL-001` … `APPROVAL-005`). These decide who may approve what, so they are tested
 * exhaustively and without a database.
 */

const label = { ar: 'مرحلة', en: 'stage' };
const scope = (level: ScopeAssignment['level'], overrides: Partial<ScopeAssignment> = {}) =>
  ScopeAssignmentSchema.parse({ level, ...overrides });

const stage = (overrides: Partial<ApprovalStage> = {}): ApprovalStage => ({
  order: 1,
  name: label,
  approvers: { kind: 'accounts', accountIds: ['a-1'] },
  rule: 'any',
  ...overrides,
});

const subject = (overrides: Partial<ConditionSubject> = {}): ConditionSubject => ({
  context: {},
  scope: {},
  requesterRoleKeys: [],
  ...overrides,
});

describe('decimal comparison (ADR-0007)', () => {
  it('orders values without binary floating point', () => {
    expect(compareDecimalStrings('10', '9')).toBe(1);
    expect(compareDecimalStrings('9', '10')).toBe(-1);
    expect(compareDecimalStrings('10.00', '10')).toBe(0);
    expect(compareDecimalStrings('0.1', '0.10')).toBe(0);
    expect(compareDecimalStrings('2.5', '2.45')).toBe(1);
    // 0.1 + 0.2 would not equal 0.3 in binary floating point; here the strings decide.
    expect(compareDecimalStrings('0.3', '0.30')).toBe(0);
  });

  it('orders negatives the right way round', () => {
    expect(compareDecimalStrings('-5', '5')).toBe(-1);
    expect(compareDecimalStrings('-5', '-10')).toBe(1);
    expect(compareDecimalStrings('-10.5', '-10.50')).toBe(0);
  });

  it('ignores leading zeros rather than comparing by length', () => {
    expect(compareDecimalStrings('007', '7')).toBe(0);
    expect(compareDecimalStrings('0012', '9')).toBe(1);
  });
});

describe('policy validation (APPROVAL-002)', () => {
  it('accepts a minimal single-stage policy', () => {
    expect(validatePolicyStages([stage()], [])).toEqual([]);
  });

  it('refuses stage orders that are duplicated or not contiguous', () => {
    expect(validatePolicyStages([stage({ order: 1 }), stage({ order: 1 })], [])).toContain(
      'STAGE_ORDER_DUPLICATED',
    );
    expect(validatePolicyStages([stage({ order: 1 }), stage({ order: 3 })], [])).toContain(
      'STAGE_ORDER_NOT_CONTIGUOUS',
    );
    expect(validatePolicyStages([stage({ order: 2 })], [])).toContain('STAGE_ORDER_NOT_CONTIGUOUS');
  });

  it('refuses an ambiguous quorum', () => {
    expect(validatePolicyStages([stage({ rule: 'quorum' })], [])).toContain('QUORUM_REQUIRED');
    expect(validatePolicyStages([stage({ rule: 'any', quorum: 2 })], [])).toContain(
      'QUORUM_NOT_PERMITTED',
    );
    expect(
      validatePolicyStages(
        [
          stage({
            rule: 'quorum',
            quorum: 3,
            approvers: { kind: 'accounts', accountIds: ['a', 'b'] },
          }),
        ],
        [],
      ),
    ).toContain('QUORUM_EXCEEDS_APPROVERS');
  });

  it('refuses "all" or a quorum over an unbounded approver set', () => {
    const permissionRule: ApproverRule = {
      kind: 'permission',
      permission: 'approval.request.approve',
      scope: 'any',
    };
    expect(validatePolicyStages([stage({ rule: 'all', approvers: permissionRule })], [])).toContain(
      'ALL_REQUIRES_EXPLICIT_APPROVERS',
    );
    expect(
      validatePolicyStages([stage({ rule: 'quorum', quorum: 2, approvers: permissionRule })], []),
    ).toContain('ALL_REQUIRES_EXPLICIT_APPROVERS');
    expect(
      validatePolicyStages([stage({ rule: 'all', approvers: { kind: 'manager' } })], []),
    ).toContain('ALL_REQUIRES_EXPLICIT_APPROVERS');
  });

  it('refuses a duplicated approver in one stage', () => {
    expect(
      validatePolicyStages(
        [stage({ approvers: { kind: 'accounts', accountIds: ['a', 'a'] } })],
        [],
      ),
    ).toContain('DUPLICATE_APPROVER_ACCOUNT');
  });

  it('refuses malformed conditions', () => {
    const cases: [ApprovalCondition, string][] = [
      [{ field: 'amount', operator: 'gte' }, 'CONDITION_VALUE_REQUIRED'],
      [{ field: 'isException', operator: 'isTrue', value: 'yes' }, 'CONDITION_VALUE_NOT_PERMITTED'],
      [{ field: 'amount', operator: 'isTrue' }, 'CONDITION_OPERATOR_NOT_APPLICABLE'],
      // Ordered comparison on a non-numeric field.
      [{ field: 'riskLevel', operator: 'gte', value: 'high' }, 'CONDITION_OPERATOR_NOT_APPLICABLE'],
      // A set operator needs a list, and a scalar operator does not take one.
      [{ field: 'roleKeys', operator: 'in', value: 'sales' }, 'CONDITION_OPERATOR_NOT_APPLICABLE'],
      [{ field: 'projectId', operator: 'eq', value: ['p-1'] }, 'CONDITION_OPERATOR_NOT_APPLICABLE'],
      // An amount threshold without a currency is not comparable.
      [{ field: 'amount', operator: 'gte', value: '5000' }, 'CONDITION_OPERATOR_NOT_APPLICABLE'],
    ];
    for (const [condition, expected] of cases) {
      expect(validatePolicyStages([stage()], [condition]), JSON.stringify(condition)).toContain(
        expected,
      );
    }
  });

  it('accepts the seven axes Master Mapping names', () => {
    const conditions: ApprovalCondition[] = [
      { field: 'amount', operator: 'gte', value: money('50000.00', 'SAR') },
      { field: 'percentage', operator: 'gt', value: '10' },
      { field: 'roleKeys', operator: 'in', value: ['sales-agent'] },
      { field: 'projectId', operator: 'eq', value: 'project-1' },
      { field: 'departmentId', operator: 'eq', value: 'dept-1' },
      { field: 'riskLevel', operator: 'in', value: ['high', 'critical'] },
      { field: 'isException', operator: 'isTrue' },
    ];
    expect(validatePolicyStages([stage()], conditions)).toEqual([]);
  });
});

describe('condition matching (APPROVAL-002)', () => {
  it('compares an amount only within the same currency', () => {
    const condition: ApprovalCondition = {
      field: 'amount',
      operator: 'gte',
      value: money('50000.00', 'SAR'),
    };
    expect(
      conditionMatches(condition, subject({ context: { amount: money('50000.00', 'SAR') } })),
    ).toBe(true);
    expect(
      conditionMatches(condition, subject({ context: { amount: money('49999.99', 'SAR') } })),
    ).toBe(false);
    // A different currency is not comparable, so the condition does not hold rather than guessing a rate.
    expect(
      conditionMatches(condition, subject({ context: { amount: money('999999.00', 'USD') } })),
    ).toBe(false);
  });

  it('compares percentages as decimals', () => {
    const condition: ApprovalCondition = { field: 'percentage', operator: 'gt', value: '10' };
    expect(conditionMatches(condition, subject({ context: { percentage: '10.5' } }))).toBe(true);
    expect(conditionMatches(condition, subject({ context: { percentage: '10.0' } }))).toBe(false);
  });

  it('matches roles, project, department, and risk by set membership', () => {
    expect(
      conditionMatches(
        { field: 'roleKeys', operator: 'in', value: ['finance'] },
        subject({ requesterRoleKeys: ['sales', 'finance'] }),
      ),
    ).toBe(true);
    expect(
      conditionMatches(
        { field: 'roleKeys', operator: 'notIn', value: ['finance'] },
        subject({ requesterRoleKeys: ['sales'] }),
      ),
    ).toBe(true);
    expect(
      conditionMatches(
        { field: 'projectId', operator: 'eq', value: 'p-1' },
        subject({ scope: { projectId: 'p-1' } }),
      ),
    ).toBe(true);
    expect(
      conditionMatches(
        { field: 'riskLevel', operator: 'in', value: ['high', 'critical'] },
        subject({ context: { riskLevel: 'critical' } }),
      ),
    ).toBe(true);
  });

  it('fails closed when the value it needs is absent', () => {
    expect(
      conditionMatches(
        { field: 'amount', operator: 'gte', value: money('1.00', 'SAR') },
        subject(),
      ),
    ).toBe(false);
    expect(conditionMatches({ field: 'isException', operator: 'isTrue' }, subject())).toBe(false);
    expect(conditionMatches({ field: 'projectId', operator: 'eq', value: 'p-1' }, subject())).toBe(
      false,
    );
  });

  it('requires every condition to hold', () => {
    const policy = {
      conditions: [
        { field: 'percentage', operator: 'gt', value: '5' },
        { field: 'isException', operator: 'isTrue' },
      ] as ApprovalCondition[],
    };
    expect(
      policyApplies(policy, subject({ context: { percentage: '10', isException: true } })),
    ).toBe(true);
    expect(policyApplies(policy, subject({ context: { percentage: '10' } }))).toBe(false);
    // No conditions means the policy always applies.
    expect(policyApplies({ conditions: [] }, subject())).toBe(true);
  });
});

describe('policy selection (APPROVAL-002)', () => {
  const policy = (overrides: Record<string, unknown>): ApprovalPolicy =>
    ApprovalPolicySchema.parse({
      key: 'discount',
      name: label,
      operationType: 'sales.discount.grant',
      stages: [stage()],
      selfApproval: 'prohibited',
      allowConcurrentRequests: false,
      conditions: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    });
  const now = new Date('2026-09-21T00:00:00.000Z');

  it('ignores drafts, other operations, and future effective dates', () => {
    const policies = [
      policy({ version: 1, state: 'draft' }),
      policy({ version: 2, state: 'published', operationType: 'other.thing' }),
      policy({ version: 3, state: 'published', effectiveFrom: '2027-01-01T00:00:00.000Z' }),
    ];
    expect(selectPolicy(policies, 'sales.discount.grant', subject(), now)).toBeUndefined();
  });

  it('prefers the most specific policy, then the newest version', () => {
    const general = policy({ version: 1, state: 'published' });
    const specific = policy({
      version: 2,
      state: 'published',
      conditions: [{ field: 'percentage', operator: 'gt', value: '10' }],
    });
    const newerGeneral = policy({ version: 3, state: 'published' });

    // A 20% discount matches both; the conditioned one wins because it is the more specific rule.
    expect(
      selectPolicy(
        [general, specific, newerGeneral],
        'sales.discount.grant',
        subject({ context: { percentage: '20' } }),
        now,
      )?.version,
    ).toBe(2);
    // A 5% discount matches only the general ones, and then the newest version wins.
    expect(
      selectPolicy(
        [general, specific, newerGeneral],
        'sales.discount.grant',
        subject({ context: { percentage: '5' } }),
        now,
      )?.version,
    ).toBe(3);
  });
});

describe('stage satisfaction (APPROVAL-001)', () => {
  it('counts one approval for "any", every approver for "all", and the quorum otherwise', () => {
    expect(stageRequirement(stage({ rule: 'any' }))).toBe(1);
    expect(
      stageRequirement(
        stage({ rule: 'all', approvers: { kind: 'accounts', accountIds: ['a', 'b', 'c'] } }),
      ),
    ).toBe(3);
    expect(
      stageRequirement(
        stage({
          rule: 'quorum',
          quorum: 2,
          approvers: { kind: 'accounts', accountIds: ['a', 'b', 'c'] },
        }),
      ),
    ).toBe(2);
  });
});

describe('state transitions (APPROVAL-001)', () => {
  it('permits only the transitions the registry describes', () => {
    for (const target of ['approved', 'rejected', 'cancelled', 'expired', 'returned'] as const) {
      expect(() => assertTransition('pending', target)).not.toThrow();
    }
    expect(() => assertTransition('returned', 'pending')).not.toThrow();
  });

  it('refuses every transition out of a terminal state', () => {
    for (const from of ['approved', 'rejected', 'cancelled', 'expired'] as const) {
      expect(isTerminal(from)).toBe(true);
      for (const to of ['approved', 'rejected', 'cancelled', 'pending'] as const) {
        expect(() => assertTransition(from, to), `${from} -> ${to}`).toThrow(
          InvalidTransitionError,
        );
      }
    }
  });

  it('refuses approving a returned request without a resubmission', () => {
    expect(() => assertTransition('returned', 'approved')).toThrow(InvalidTransitionError);
    expect(() => assertTransition('returned', 'rejected')).toThrow(InvalidTransitionError);
  });
});

describe('maker-checker (APPROVAL-003, ADR-0006)', () => {
  it('refuses self-approval when the policy prohibits it', () => {
    expect(() =>
      evaluateSelfApproval({
        mode: 'prohibited',
        requesterAccountId: 'a-1',
        approverAccountId: 'a-1',
        effectiveApproverAccountId: 'a-1',
      }),
    ).toThrow(SelfApprovalError);
  });

  it('permits it only with a reason, and records that it happened', () => {
    expect(() =>
      evaluateSelfApproval({
        mode: 'permittedWithReason',
        requesterAccountId: 'a-1',
        approverAccountId: 'a-1',
        effectiveApproverAccountId: 'a-1',
      }),
    ).toThrow(SelfApprovalError);
    expect(
      evaluateSelfApproval({
        mode: 'permittedWithReason',
        requesterAccountId: 'a-1',
        approverAccountId: 'a-1',
        effectiveApproverAccountId: 'a-1',
        reason: 'sole signatory on site',
      }),
    ).toEqual({ selfApproved: true });
  });

  it('is not fooled by a delegate acting for the requester', () => {
    // The delegator is someone else, but the hand on the keyboard is the requester's.
    expect(() =>
      evaluateSelfApproval({
        mode: 'prohibited',
        requesterAccountId: 'a-1',
        approverAccountId: 'manager-1',
        effectiveApproverAccountId: 'a-1',
      }),
    ).toThrow(SelfApprovalError);
  });

  it('leaves an ordinary approval alone', () => {
    expect(
      evaluateSelfApproval({
        mode: 'prohibited',
        requesterAccountId: 'a-1',
        approverAccountId: 'a-2',
        effectiveApproverAccountId: 'a-2',
      }),
    ).toEqual({ selfApproved: false });
  });

  it('refuses one person satisfying two stages of the same request', () => {
    expect(() =>
      assertDistinctStageApprover({
        mode: 'prohibited',
        stageOrder: 2,
        effectiveApproverAccountId: 'a-2',
        earlierDecisions: [{ stageOrder: 1, effectiveApproverAccountId: 'a-2' }],
      }),
    ).toThrow(SelfApprovalError);
    // A different person at each stage is the point of having two stages.
    expect(() =>
      assertDistinctStageApprover({
        mode: 'prohibited',
        stageOrder: 2,
        effectiveApproverAccountId: 'a-3',
        earlierDecisions: [{ stageOrder: 1, effectiveApproverAccountId: 'a-2' }],
      }),
    ).not.toThrow();
  });

  it('allows repeated decisions within one stage, which a quorum needs', () => {
    expect(() =>
      assertDistinctStageApprover({
        mode: 'prohibited',
        stageOrder: 1,
        effectiveApproverAccountId: 'a-2',
        earlierDecisions: [{ stageOrder: 1, effectiveApproverAccountId: 'a-3' }],
      }),
    ).not.toThrow();
  });
});

describe('delegation (APPROVAL-004)', () => {
  const now = new Date('2026-09-21T12:00:00.000Z');
  const window = {
    startsAt: '2026-09-21T00:00:00.000Z',
    endsAt: '2026-09-28T00:00:00.000Z',
  };

  it('is active only inside its window and only until revoked', () => {
    expect(isDelegationActive(window, now)).toBe(true);
    expect(isDelegationActive(window, new Date('2026-09-20T00:00:00.000Z'))).toBe(false);
    expect(isDelegationActive(window, new Date('2026-09-29T00:00:00.000Z'))).toBe(false);
    expect(isDelegationActive({ ...window, revokedAt: '2026-09-21T06:00:00.000Z' }, now)).toBe(
      false,
    );
  });

  it('refuses delegating to oneself', () => {
    expect(() =>
      assertDelegationAllowed({
        delegatorAccountId: 'a-1',
        delegateAccountId: 'a-1',
        startsAt: new Date(window.startsAt),
        endsAt: new Date(window.endsAt),
        now,
        active: [],
      }),
    ).toThrow(DelegationError);
  });

  it('refuses an inverted, past, or unbounded window', () => {
    const attempt = (startsAt: string, endsAt: string) =>
      assertDelegationAllowed({
        delegatorAccountId: 'a-1',
        delegateAccountId: 'a-2',
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        now,
        active: [],
      });
    expect(() => attempt('2026-09-28T00:00:00.000Z', '2026-09-21T00:00:00.000Z')).toThrow(
      DelegationError,
    );
    expect(() => attempt('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')).toThrow(
      DelegationError,
    );
    // Longer than the maximum: a delegation that never ends is a permanent silent grant.
    const tooLong = new Date(
      new Date(window.startsAt).getTime() + (MAX_DELEGATION_DAYS + 1) * 86_400_000,
    );
    expect(() => attempt(window.startsAt, tooLong.toISOString())).toThrow(DelegationError);
  });

  it('refuses a chain that would close a cycle', () => {
    // b already delegates to a; a delegating to b would make the pair decide for each other.
    expect(() =>
      assertDelegationAllowed({
        delegatorAccountId: 'a',
        delegateAccountId: 'b',
        startsAt: new Date(window.startsAt),
        endsAt: new Date(window.endsAt),
        now,
        active: [{ delegatorAccountId: 'b', delegateAccountId: 'a' }],
      }),
    ).toThrow(DelegationError);

    // A longer cycle is caught too: a -> b, b -> c, c -> a.
    expect(() =>
      assertDelegationAllowed({
        delegatorAccountId: 'a',
        delegateAccountId: 'b',
        startsAt: new Date(window.startsAt),
        endsAt: new Date(window.endsAt),
        now,
        active: [
          { delegatorAccountId: 'b', delegateAccountId: 'c' },
          { delegatorAccountId: 'c', delegateAccountId: 'a' },
        ],
      }),
    ).toThrow(DelegationError);
  });

  it('accepts a chain that does not close', () => {
    expect(() =>
      assertDelegationAllowed({
        delegatorAccountId: 'a',
        delegateAccountId: 'b',
        startsAt: new Date(window.startsAt),
        endsAt: new Date(window.endsAt),
        now,
        active: [{ delegatorAccountId: 'b', delegateAccountId: 'c' }],
      }),
    ).not.toThrow();
  });
});

describe('approver eligibility (APPROVAL-002)', () => {
  const actor = (
    overrides: Partial<{ accountId: string; permissions: string[]; scope: ScopeAssignment }> = {},
  ) => ({
    accountId: overrides.accountId ?? 'a-1',
    permissions: overrides.permissions ?? [],
    scope: overrides.scope ?? scope('self'),
  });

  it('matches an explicit account list exactly', () => {
    const rule: ApproverRule = { kind: 'accounts', accountIds: ['a-1', 'a-2'] };
    expect(isEligibleApprover({ rule, actor: actor({ accountId: 'a-2' }), requestScope: {} })).toBe(
      true,
    );
    expect(isEligibleApprover({ rule, actor: actor({ accountId: 'a-9' }), requestScope: {} })).toBe(
      false,
    );
  });

  it('needs the permission, and then the scope must cover the request', () => {
    const rule: ApproverRule = {
      kind: 'permission',
      permission: 'approval.request.approve',
      scope: 'same-branch',
    };
    // Holds the permission but is scoped to another branch.
    expect(
      isEligibleApprover({
        rule,
        actor: actor({
          permissions: ['approval.request.approve'],
          scope: scope('branch', { branchIds: ['branch-2'] }),
        }),
        requestScope: { branchId: 'branch-1' },
      }),
    ).toBe(false);
    expect(
      isEligibleApprover({
        rule,
        actor: actor({
          permissions: ['approval.request.approve'],
          scope: scope('branch', { branchIds: ['branch-1'] }),
        }),
        requestScope: { branchId: 'branch-1' },
      }),
    ).toBe(true);
    // No permission, no eligibility, whatever the scope.
    expect(
      isEligibleApprover({
        rule,
        actor: actor({ scope: scope('all') }),
        requestScope: { branchId: 'branch-1' },
      }),
    ).toBe(false);
  });

  it('fails closed when the request carries no reference to narrow by', () => {
    const rule: ApproverRule = {
      kind: 'permission',
      permission: 'approval.request.approve',
      scope: 'same-project',
    };
    expect(
      isEligibleApprover({
        rule,
        actor: actor({
          permissions: ['approval.request.approve'],
          scope: scope('project', { projectIds: ['p-1'] }),
        }),
        requestScope: {},
      }),
    ).toBe(false);
  });

  it('lets an "all" scope through, and ignores narrowing for "any"', () => {
    const narrowed: ApproverRule = {
      kind: 'permission',
      permission: 'approval.request.approve',
      scope: 'same-team',
    };
    expect(
      isEligibleApprover({
        rule: narrowed,
        actor: actor({ permissions: ['approval.request.approve'], scope: scope('all') }),
        requestScope: { teamId: 't-1' },
      }),
    ).toBe(true);
    expect(
      isEligibleApprover({
        rule: { kind: 'permission', permission: 'approval.request.approve', scope: 'any' },
        actor: actor({ permissions: ['approval.request.approve'], scope: scope('self') }),
        requestScope: {},
      }),
    ).toBe(true);
  });

  it('matches the manager only when a resolver supplied one', () => {
    const rule: ApproverRule = { kind: 'manager' };
    expect(
      isEligibleApprover({
        rule,
        actor: actor({ accountId: 'm-1' }),
        requestScope: {},
        managerAccountId: 'm-1',
      }),
    ).toBe(true);
    // No reporting line configured yet (CORE-ORG, Phase 2): nobody is the manager.
    expect(isEligibleApprover({ rule, actor: actor({ accountId: 'm-1' }), requestScope: {} })).toBe(
      false,
    );
  });
});
