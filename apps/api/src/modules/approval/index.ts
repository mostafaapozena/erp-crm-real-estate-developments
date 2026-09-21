/**
 * APPROVAL module published interface (ADR-0001).
 *
 * Owns approval policies, requests, decisions, and delegations. It knows nothing about any business
 * module: a request carries an **opaque** source reference, and approving one records a decision rather
 * than executing anything. The owning module observes the outcome and acts.
 */
export {
  DECISIONS_COLLECTION,
  DELEGATIONS_COLLECTION,
  POLICIES_COLLECTION,
  REQUESTS_COLLECTION,
  ApprovalHistoryImmutableError,
  PublishedPolicyImmutableError,
} from './model';
export {
  APPROVAL_SCOPE_FIELDS,
  ApprovalService,
  ConcurrentDecisionError,
  DelegationNotFoundError,
  DuplicateLiveRequestError,
  IdempotencyConflictError,
  NoApplicablePolicyError,
  NotEligibleApproverError,
  PolicyInvalidError,
  PolicyNotFoundError,
  PolicyStateError,
  RequestNotFoundError,
} from './service';
export type {
  ApprovalAuditRecorder,
  ApprovalEvent,
  ApprovalEventPublisher,
  ApprovalServiceOptions,
  RequestContext,
} from './service';
export {
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
  policyApplies,
  selectPolicy,
  stageRequirement,
  validatePolicyStages,
} from './rules';
export type { ConditionSubject, DelegationWindow, EligibilityActor } from './rules';
export { approvalRouter } from './router';
export type { ApprovalRouterOptions } from './router';
