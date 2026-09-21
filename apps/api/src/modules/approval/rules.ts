import {
  MoneySchema,
  TERMINAL_REQUEST_STATES,
  canTransitionRequest,
  compareMoney,
  type ApprovalCondition,
  type ApprovalContext,
  type ApprovalDelegation,
  type ApprovalPolicy,
  type ApprovalStage,
  type ApproverRule,
  type ConditionOperator,
  type PolicyIssueCode,
  type RequestScope,
  type RequestState,
  type SelfApprovalMode,
} from '@alola/contracts';

/**
 * Approval rules, as pure functions (`APPROVAL-001` … `APPROVAL-005`).
 *
 * Nothing here touches a database, a clock it was not given, or a request object. That is deliberate: the
 * rules that decide who may approve what are the ones most worth testing exhaustively, and they are
 * testable only if they are separable.
 */

/* ------------------------------------------------------ decimal comparison */

/**
 * Compare two decimal strings without binary floating point (ADR-0007). Used for percentage thresholds;
 * money goes through `compareMoney`, which also checks the currency.
 *
 * Written out rather than pulled from a library because it is a small, closed rule: split on the point,
 * compare the integer parts by length then lexically, then the fractions padded to equal length.
 */
export function compareDecimalStrings(left: string, right: string): -1 | 0 | 1 {
  const parse = (value: string) => {
    const negative = value.startsWith('-');
    const unsigned = negative ? value.slice(1) : value;
    const [whole = '0', fraction = ''] = unsigned.split('.');
    return { negative, whole: whole.replace(/^0+(?=\d)/, ''), fraction };
  };
  const a = parse(left);
  const b = parse(right);
  if (a.negative !== b.negative) return a.negative ? -1 : 1;

  const flip = (result: -1 | 0 | 1): -1 | 0 | 1 =>
    a.negative ? ((result * -1) as -1 | 0 | 1) : result;

  if (a.whole.length !== b.whole.length) return flip(a.whole.length > b.whole.length ? 1 : -1);
  if (a.whole !== b.whole) return flip(a.whole > b.whole ? 1 : -1);

  const width = Math.max(a.fraction.length, b.fraction.length);
  const fractionA = a.fraction.padEnd(width, '0');
  const fractionB = b.fraction.padEnd(width, '0');
  if (fractionA === fractionB) return 0;
  return flip(fractionA > fractionB ? 1 : -1);
}

/* ------------------------------------------------------- policy validation */

const ORDERED_OPERATORS: readonly ConditionOperator[] = ['gte', 'gt', 'lte', 'lt'];
const SET_OPERATORS: readonly ConditionOperator[] = ['in', 'notIn'];

/**
 * Every way a policy can be unusable (`APPROVAL-002`). Returned as codes, so an ambiguous configuration is
 * refused when it is written rather than discovered when somebody tries to approve.
 */
export function validatePolicyStages(
  stages: readonly ApprovalStage[],
  conditions: readonly ApprovalCondition[],
): PolicyIssueCode[] {
  const issues: PolicyIssueCode[] = [];
  const orders = stages.map((stage) => stage.order);

  if (new Set(orders).size !== orders.length) issues.push('STAGE_ORDER_DUPLICATED');
  const sorted = [...new Set(orders)].sort((a, b) => a - b);
  if (sorted.some((order, index) => order !== index + 1)) issues.push('STAGE_ORDER_NOT_CONTIGUOUS');

  for (const stage of stages) {
    const bounded =
      stage.approvers.kind === 'accounts' ? stage.approvers.accountIds.length : undefined;

    if (stage.rule === 'quorum') {
      if (stage.quorum === undefined) issues.push('QUORUM_REQUIRED');
      if (bounded === undefined) issues.push('ALL_REQUIRES_EXPLICIT_APPROVERS');
      else if (stage.quorum !== undefined && stage.quorum > bounded) {
        issues.push('QUORUM_EXCEEDS_APPROVERS');
      }
    } else if (stage.quorum !== undefined) {
      issues.push('QUORUM_NOT_PERMITTED');
    }

    // "All of them" is meaningless unless the set is enumerated: a permission can match any number of
    // accounts, and that number changes as grants change.
    if (stage.rule === 'all' && bounded === undefined)
      issues.push('ALL_REQUIRES_EXPLICIT_APPROVERS');

    if (stage.approvers.kind === 'accounts') {
      const unique = new Set(stage.approvers.accountIds);
      if (unique.size !== stage.approvers.accountIds.length)
        issues.push('DUPLICATE_APPROVER_ACCOUNT');
    }
  }

  for (const condition of conditions) {
    if (condition.operator === 'isTrue') {
      if (condition.value !== undefined) issues.push('CONDITION_VALUE_NOT_PERMITTED');
      if (condition.field !== 'isException') issues.push('CONDITION_OPERATOR_NOT_APPLICABLE');
      continue;
    }
    if (condition.value === undefined) {
      issues.push('CONDITION_VALUE_REQUIRED');
      continue;
    }
    const isSet = SET_OPERATORS.includes(condition.operator);
    if (isSet !== Array.isArray(condition.value)) issues.push('CONDITION_OPERATOR_NOT_APPLICABLE');
    if (ORDERED_OPERATORS.includes(condition.operator)) {
      // Ordered comparison only means something on a number-like field.
      if (condition.field !== 'amount' && condition.field !== 'percentage') {
        issues.push('CONDITION_OPERATOR_NOT_APPLICABLE');
      }
    }
    if (condition.field === 'amount' && !isSet) {
      // An amount threshold must carry its currency, or the comparison is undefined.
      if (!MoneySchema.safeParse(condition.value).success) {
        issues.push('CONDITION_OPERATOR_NOT_APPLICABLE');
      }
    }
  }

  return [...new Set(issues)];
}

/* -------------------------------------------------------- condition matching */

/** What a condition may read, assembled by the engine from the request. */
export interface ConditionSubject {
  context: ApprovalContext;
  scope: RequestScope;
  requesterRoleKeys: readonly string[];
}

function compareOrdered(
  field: 'amount' | 'percentage',
  operator: ConditionOperator,
  subject: ConditionSubject,
  value: unknown,
): boolean {
  let comparison: -1 | 0 | 1;
  if (field === 'amount') {
    const actual = subject.context.amount;
    const expected = MoneySchema.safeParse(value);
    if (!actual || !expected.success) return false;
    // Different currencies are not comparable; a policy that does so does not apply rather than guessing.
    if (actual.currency !== expected.data.currency) return false;
    comparison = compareMoney(actual, expected.data);
  } else {
    const actual = subject.context.percentage;
    if (!actual || typeof value !== 'string') return false;
    comparison = compareDecimalStrings(actual, value);
  }
  switch (operator) {
    case 'gte':
      return comparison >= 0;
    case 'gt':
      return comparison > 0;
    case 'lte':
      return comparison <= 0;
    case 'lt':
      return comparison < 0;
    case 'eq':
      return comparison === 0;
    default:
      return false;
  }
}

function actualStrings(field: ApprovalCondition['field'], subject: ConditionSubject): string[] {
  switch (field) {
    case 'roleKeys':
      return [...subject.requesterRoleKeys];
    case 'projectId':
      return subject.scope.projectId ? [subject.scope.projectId] : [];
    case 'departmentId':
      return subject.scope.departmentId ? [subject.scope.departmentId] : [];
    case 'riskLevel':
      return subject.context.riskLevel ? [subject.context.riskLevel] : [];
    default:
      return [];
  }
}

/** True when one condition holds. An unknown or absent value never matches: conditions fail closed. */
export function conditionMatches(condition: ApprovalCondition, subject: ConditionSubject): boolean {
  if (condition.field === 'isException') {
    if (condition.operator === 'isTrue') return subject.context.isException === true;
    if (condition.operator === 'eq')
      return String(subject.context.isException === true) === condition.value;
    return false;
  }
  if (condition.field === 'amount' || condition.field === 'percentage') {
    if (condition.operator === 'in' || condition.operator === 'notIn') return false;
    return compareOrdered(condition.field, condition.operator, subject, condition.value);
  }

  const actual = actualStrings(condition.field, subject);
  const expected = condition.value;
  switch (condition.operator) {
    case 'eq':
      return typeof expected === 'string' && actual.length === 1 && actual[0] === expected;
    case 'in':
      return Array.isArray(expected) && actual.some((value) => expected.includes(value));
    case 'notIn':
      return (
        Array.isArray(expected) && actual.length > 0 && !actual.some((v) => expected.includes(v))
      );
    default:
      return false;
  }
}

/** Every condition must hold. An empty condition list means the policy always applies. */
export function policyApplies(
  policy: Pick<ApprovalPolicy, 'conditions'>,
  subject: ConditionSubject,
): boolean {
  return policy.conditions.every((condition) => conditionMatches(condition, subject));
}

/**
 * Choose the policy version for a submission: published, effective now, matching the operation type, whose
 * conditions hold — and among those, the **most specific** (most conditions), then the newest version.
 * Ties on specificity are broken deterministically so two submissions never pick different versions.
 */
export function selectPolicy<T extends ApprovalPolicy>(
  policies: readonly T[],
  operationType: string,
  subject: ConditionSubject,
  now: Date,
): T | undefined {
  const eligible = policies.filter(
    (policy) =>
      policy.state === 'published' &&
      policy.operationType === operationType &&
      (!policy.effectiveFrom || new Date(policy.effectiveFrom) <= now) &&
      policyApplies(policy, subject),
  );
  return [...eligible].sort(
    (a, b) => b.conditions.length - a.conditions.length || b.version - a.version,
  )[0];
}

/* --------------------------------------------------------------- stage rules */

/** How many distinct approvals satisfy a stage (`APPROVAL-001`). */
export function stageRequirement(stage: ApprovalStage): number {
  switch (stage.rule) {
    case 'all':
      return stage.approvers.kind === 'accounts' ? stage.approvers.accountIds.length : 1;
    case 'quorum':
      return stage.quorum ?? 1;
    default:
      return 1;
  }
}

/* ------------------------------------------------------------- transitions */

export class InvalidTransitionError extends Error {
  readonly code = 'CONFLICT';
  constructor(
    readonly from: RequestState,
    readonly to: RequestState,
  ) {
    super('CONFLICT');
    this.name = 'InvalidTransitionError';
  }
}

/** Throws rather than returning false: an illegal transition must not be a value a caller can ignore. */
export function assertTransition(from: RequestState, to: RequestState): void {
  if (!canTransitionRequest(from, to)) throw new InvalidTransitionError(from, to);
}

export function isTerminal(state: RequestState): boolean {
  return TERMINAL_REQUEST_STATES.includes(state);
}

/* ------------------------------------------------------------ maker-checker */

export class SelfApprovalError extends Error {
  readonly code = 'FORBIDDEN';
  constructor() {
    super('FORBIDDEN');
    this.name = 'SelfApprovalError';
  }
}

/**
 * Maker-checker (`APPROVAL-003`, ADR-0006).
 *
 * The exception is **policy, not a code branch**: this function reads the policy's mode and nothing else,
 * so there is no permission and no role that quietly bypasses it. An administrative permission does not
 * help — the rule is evaluated after authorization has already succeeded.
 *
 * Returns whether the decision is a *recorded* self-approval, so the audit trail can say so.
 */
export function evaluateSelfApproval(options: {
  mode: SelfApprovalMode;
  requesterAccountId: string;
  /** The authority being exercised — the delegator when a delegate acts. */
  approverAccountId: string;
  /** The account actually acting. */
  effectiveApproverAccountId: string;
  reason?: string | undefined;
}): { selfApproved: boolean } {
  const isSelf =
    options.approverAccountId === options.requesterAccountId ||
    // A delegate acting for the requester is still the requester approving their own request.
    options.effectiveApproverAccountId === options.requesterAccountId;
  if (!isSelf) return { selfApproved: false };
  if (options.mode !== 'permittedWithReason') throw new SelfApprovalError();
  // The permitted case is only permitted *with* a reason; otherwise there is nothing to review later.
  if (!options.reason || options.reason.trim().length < 3) throw new SelfApprovalError();
  return { selfApproved: true };
}

/**
 * Separation of duties across stages: one person must not satisfy two different stages of the same
 * request unless the policy permits self-approval. Stage counts are what a threshold buys — one signature
 * twice is one signature.
 */
export function assertDistinctStageApprover(options: {
  mode: SelfApprovalMode;
  stageOrder: number;
  effectiveApproverAccountId: string;
  earlierDecisions: readonly { stageOrder: number; effectiveApproverAccountId: string }[];
}): void {
  if (options.mode === 'permittedWithReason') return;
  const actedEarlier = options.earlierDecisions.some(
    (decision) =>
      decision.stageOrder !== options.stageOrder &&
      decision.effectiveApproverAccountId === options.effectiveApproverAccountId,
  );
  if (actedEarlier) throw new SelfApprovalError();
}

/* -------------------------------------------------------------- delegation */

/** A delegation window, as either stored dates or contract strings. */
export interface DelegationWindow {
  startsAt: Date | string;
  endsAt: Date | string;
  revokedAt?: Date | string | undefined;
}

/** A delegation is usable only inside its window, and only until it is revoked (`APPROVAL-004`). */
export function isDelegationActive(delegation: DelegationWindow, now: Date): boolean {
  if (delegation.revokedAt) return false;
  return new Date(delegation.startsAt) <= now && now < new Date(delegation.endsAt);
}

export class DelegationError extends Error {
  readonly code = 'VALIDATION_FAILED';
  constructor(readonly detail: 'window' | 'self' | 'cycle' | 'duration') {
    super('VALIDATION_FAILED');
    this.name = 'DelegationError';
  }
}

/** Longest permitted delegation. A delegation that never ends is a permanent silent grant. */
export const MAX_DELEGATION_DAYS = 90;

/**
 * Validate a new delegation against the existing ones. Refuses an inverted or over-long window, a
 * delegation to oneself, and any chain that would close a cycle — A→B→A hides who is really deciding.
 */
export function assertDelegationAllowed(options: {
  delegatorAccountId: string;
  delegateAccountId: string;
  startsAt: Date;
  endsAt: Date;
  now: Date;
  /** Active delegations, used to walk the chain forward from the proposed delegate. */
  active: readonly Pick<ApprovalDelegation, 'delegatorAccountId' | 'delegateAccountId'>[];
}): void {
  if (options.delegatorAccountId === options.delegateAccountId) throw new DelegationError('self');
  if (options.endsAt <= options.startsAt) throw new DelegationError('window');
  if (options.endsAt <= options.now) throw new DelegationError('window');
  const days = (options.endsAt.getTime() - options.startsAt.getTime()) / 86_400_000;
  if (days > MAX_DELEGATION_DAYS) throw new DelegationError('duration');

  // Follow the chain from the delegate: if it reaches the delegator, this edge would close a cycle.
  const edges = new Map<string, string[]>();
  for (const edge of options.active) {
    edges.set(edge.delegatorAccountId, [
      ...(edges.get(edge.delegatorAccountId) ?? []),
      edge.delegateAccountId,
    ]);
  }
  const seen = new Set<string>();
  const queue = [options.delegateAccountId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === options.delegatorAccountId) throw new DelegationError('cycle');
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...(edges.get(current) ?? []));
  }
}

/* ------------------------------------------------------------- eligibility */

export interface EligibilityActor {
  accountId: string;
  permissions: readonly string[];
  scope: {
    level: string;
    teamIds: readonly string[];
    departmentIds: readonly string[];
    branchIds: readonly string[];
    projectIds: readonly string[];
    legalEntityIds: readonly string[];
  };
}

const SCOPE_FIELD: Record<string, keyof RequestScope> = {
  'same-team': 'teamId',
  'same-department': 'departmentId',
  'same-branch': 'branchId',
  'same-project': 'projectId',
  'same-legalEntity': 'legalEntityId',
};

const SCOPE_LIST: Record<string, keyof EligibilityActor['scope']> = {
  'same-team': 'teamIds',
  'same-department': 'departmentIds',
  'same-branch': 'branchIds',
  'same-project': 'projectIds',
  'same-legalEntity': 'legalEntityIds',
};

/**
 * Whether an actor may act on a stage.
 *
 * A permission-based rule also requires the actor's **data scope** to cover the request's own organization
 * reference, so "any manager with the permission" cannot reach another branch's request. An unresolvable
 * narrowing fails closed, exactly as `buildScopeFilter` does.
 */
export function isEligibleApprover(options: {
  rule: ApproverRule;
  actor: EligibilityActor;
  requestScope: RequestScope;
  /** The requester's direct manager, when a resolver supplied one. */
  managerAccountId?: string | undefined;
}): boolean {
  const { rule, actor } = options;
  if (rule.kind === 'accounts') return rule.accountIds.includes(actor.accountId);
  if (rule.kind === 'manager') {
    return options.managerAccountId !== undefined && options.managerAccountId === actor.accountId;
  }
  if (!actor.permissions.includes(rule.permission)) return false;
  if (rule.scope === 'any') return true;
  if (actor.scope.level === 'all') return true;
  const field = SCOPE_FIELD[rule.scope];
  const list = SCOPE_LIST[rule.scope];
  if (!field || !list) return false;
  const required = options.requestScope[field];
  if (!required) return false;
  return actor.scope[list].includes(required);
}
