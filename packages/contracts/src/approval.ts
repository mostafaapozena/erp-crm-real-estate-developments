import { z } from 'zod';
import { PermissionSchema } from './authorization';
import { LocalizedLabelSchema } from './localized';
import { MoneySchema } from './money';
import { InstantSchema } from './time';

/**
 * Approval engine contracts (`APPROVAL-001` … `APPROVAL-007`).
 *
 * The engine is **mechanism only**. No role, threshold, approver, or operation type is seeded here: those
 * are `SD-02` (approval authority, thresholds, segregation of duties) and arrive in Phase 2. What Phase 1
 * owns is the shape those answers will be expressed in, and the enforcement around them.
 *
 * Nothing here is specific to one business module. A request references a source aggregate by an **opaque
 * reference** and carries a sanitized summary; it never embeds the source document, and approving a
 * request never executes the underlying operation — the owning module observes the outcome and acts.
 */

/* ------------------------------------------------------------------ policies */

/** Ordered comparison and set operators. Deliberately small: a policy is configuration, not a language. */
export const CONDITION_OPERATORS = [
  'gte',
  'gt',
  'lte',
  'lt',
  'eq',
  'in',
  'notIn',
  'isTrue',
] as const;
export const ConditionOperatorSchema = z.enum(CONDITION_OPERATORS);
export type ConditionOperator = z.infer<typeof ConditionOperatorSchema>;

/**
 * The seven axes Master Mapping §7 names for reusable approvals: amount, percentage, role, project,
 * department, risk, and exception. A condition may only read these, so a policy cannot come to depend on
 * an arbitrary field of some module's document.
 */
export const CONDITION_FIELDS = [
  'amount',
  'percentage',
  'roleKeys',
  'projectId',
  'departmentId',
  'riskLevel',
  'isException',
] as const;
export const ConditionFieldSchema = z.enum(CONDITION_FIELDS);
export type ConditionField = z.infer<typeof ConditionFieldSchema>;

export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export const RiskLevelSchema = z.enum(RISK_LEVELS);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

/**
 * One condition. `amount` and `percentage` are decimal **strings** — a threshold compared with binary
 * floating point is a financial control that rounds the wrong way (ADR-0007).
 */
export const ApprovalConditionSchema = z.strictObject({
  field: ConditionFieldSchema,
  operator: ConditionOperatorSchema,
  /** Absent only for `isTrue`. */
  value: z
    .union([MoneySchema, z.string().min(1).max(200), z.array(z.string().min(1)).max(100)])
    .optional(),
});
export type ApprovalCondition = z.infer<typeof ApprovalConditionSchema>;

/** Who may act on a stage. */
/**
 * How many accounts a permission-based stage may resolve to — the security module lists at most this
 * many holders of a permission, and logs when it had to stop. A request's pending approvers are that
 * list plus, at most, the manager an overdue stage escalates to; the contract must carry every one of
 * them, because the list is what authorizes a decision.
 */
export const APPROVER_CANDIDATE_LIMIT = 200;
export const MAX_PENDING_APPROVERS = APPROVER_CANDIDATE_LIMIT + 1;

export const APPROVER_RULE_KINDS = ['accounts', 'permission', 'manager'] as const;
export const ApproverRuleKindSchema = z.enum(APPROVER_RULE_KINDS);

/**
 * How a permission-based rule is narrowed. `same-*` means "an actor whose data scope covers the request's
 * own organization reference" — the request carries those references, so the narrowing is evaluated
 * against data the engine already holds rather than against a hierarchy it does not own.
 */
export const APPROVER_SCOPES = [
  'any',
  'same-team',
  'same-department',
  'same-branch',
  'same-project',
  'same-legalEntity',
] as const;
export const ApproverScopeSchema = z.enum(APPROVER_SCOPES);
export type ApproverScope = z.infer<typeof ApproverScopeSchema>;

export const ApproverRuleSchema = z.discriminatedUnion('kind', [
  /** A bounded, explicit set. The only kind that makes `all` and `quorum` unambiguous. */
  z.strictObject({
    kind: z.literal('accounts'),
    accountIds: z.array(z.string().min(1).max(200)).min(1).max(50),
  }),
  z.strictObject({
    kind: z.literal('permission'),
    permission: PermissionSchema,
    scope: ApproverScopeSchema.default('any'),
  }),
  /**
   * The requester's direct manager (`APPROVAL-005` escalation, and usable as a stage in its own right).
   * The reporting line belongs to `CORE-ORG` (Phase 2, `SD-01`); the engine resolves it through a port and
   * fails closed when no resolver is configured.
   */
  z.strictObject({ kind: z.literal('manager') }),
]);
export type ApproverRule = z.infer<typeof ApproverRuleSchema>;

/**
 * How many eligible approvers a stage needs.
 *
 * `all` and `quorum` are only meaningful over a bounded set, so policy validation refuses them for a
 * permission- or manager-based rule. An ambiguous configuration is rejected when the policy is written,
 * not discovered when someone tries to approve.
 */
export const STAGE_RULES = ['any', 'all', 'quorum'] as const;
export const StageRuleSchema = z.enum(STAGE_RULES);
export type StageRule = z.infer<typeof StageRuleSchema>;

export const ApprovalStageSchema = z.strictObject({
  /** 1-based, contiguous, and ordered. Validation refuses gaps and duplicates. */
  order: z.number().int().min(1).max(20),
  name: LocalizedLabelSchema,
  approvers: ApproverRuleSchema,
  rule: StageRuleSchema.default('any'),
  /** Required when `rule` is `quorum`, refused otherwise. */
  quorum: z.number().int().min(2).max(50).optional(),
  /**
   * Hours before the stage is overdue and may be escalated (`APPROVAL-005`). Optional: no default
   * service-level target is invented here — that is a business input.
   */
  slaHours: z.number().int().min(1).max(8760).optional(),
});
export type ApprovalStage = z.infer<typeof ApprovalStageSchema>;

/**
 * Maker-checker (`APPROVAL-003`, ADR-0006). Self-approval is **configuration, never a code branch**: a
 * policy either prohibits it or permits it with a recorded reason, and the permitted case is audited as
 * such so a review can find every instance.
 */
export const SELF_APPROVAL_MODES = ['prohibited', 'permittedWithReason'] as const;
export const SelfApprovalModeSchema = z.enum(SELF_APPROVAL_MODES);
export type SelfApprovalMode = z.infer<typeof SelfApprovalModeSchema>;

export const POLICY_STATES = ['draft', 'published', 'retired'] as const;
export const PolicyStateSchema = z.enum(POLICY_STATES);
export type PolicyState = z.infer<typeof PolicyStateSchema>;

export const PolicyKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{2,63}$/, { message: 'POLICY_KEY_EXPECTED' });

/** The business operation a policy governs. An opaque type name owned by the requesting module. */
export const OperationTypeSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,3}$/, { message: 'OPERATION_TYPE_EXPECTED' });

export const ApprovalPolicySchema = z.strictObject({
  key: PolicyKeySchema,
  version: z.number().int().min(1),
  name: LocalizedLabelSchema,
  operationType: OperationTypeSchema,
  state: PolicyStateSchema,
  /** Every condition must hold for the policy to apply. An empty list means "always applies". */
  conditions: z.array(ApprovalConditionSchema).max(20),
  stages: z.array(ApprovalStageSchema).min(1).max(20),
  selfApproval: SelfApprovalModeSchema,
  /** Whether a second live request may exist for the same source reference and operation. */
  allowConcurrentRequests: z.boolean(),
  /** Hours after submission at which an undecided request expires. Optional; no default is invented. */
  expiresAfterHours: z.number().int().min(1).max(8760).optional(),
  effectiveFrom: InstantSchema.optional(),
  publishedAt: InstantSchema.optional(),
  publishedBy: z.string().min(1).optional(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;

export const CreatePolicyRequestSchema = z.strictObject({
  key: PolicyKeySchema,
  name: LocalizedLabelSchema,
  operationType: OperationTypeSchema,
  conditions: z.array(ApprovalConditionSchema).max(20).default([]),
  stages: z.array(ApprovalStageSchema).min(1).max(20),
  selfApproval: SelfApprovalModeSchema.default('prohibited'),
  allowConcurrentRequests: z.boolean().default(false),
  expiresAfterHours: z.number().int().min(1).max(8760).optional(),
  effectiveFrom: InstantSchema.optional(),
});
export type CreatePolicyRequest = z.infer<typeof CreatePolicyRequestSchema>;

export const UpdatePolicyRequestSchema = CreatePolicyRequestSchema.omit({ key: true }).partial();

export const PolicyListResponseSchema = z.strictObject({ items: z.array(ApprovalPolicySchema) });

/** Problems that make a policy unusable. Codes, never prose, so the client localizes them. */
export const POLICY_ISSUE_CODES = [
  'STAGE_ORDER_NOT_CONTIGUOUS',
  'STAGE_ORDER_DUPLICATED',
  'QUORUM_REQUIRED',
  'QUORUM_NOT_PERMITTED',
  'QUORUM_EXCEEDS_APPROVERS',
  'ALL_REQUIRES_EXPLICIT_APPROVERS',
  'CONDITION_VALUE_REQUIRED',
  'CONDITION_VALUE_NOT_PERMITTED',
  'CONDITION_OPERATOR_NOT_APPLICABLE',
  'DUPLICATE_APPROVER_ACCOUNT',
] as const;
export type PolicyIssueCode = (typeof POLICY_ISSUE_CODES)[number];

/* ------------------------------------------------------------------ requests */

/**
 * Request lifecycle (`APPROVAL-001`).
 *
 * `escalation` is deliberately **not** a state: an overdue stage stays pending and gains an escalation
 * record, because escalating must not discard the decision that is still owed (`APPROVAL-005`).
 */
export const REQUEST_STATES = [
  'pending',
  'returned',
  'approved',
  'rejected',
  'cancelled',
  'expired',
] as const;
export const RequestStateSchema = z.enum(REQUEST_STATES);
export type RequestState = z.infer<typeof RequestStateSchema>;

/** Terminal states keep their decisions forever (`APPROVAL-006`). */
export const TERMINAL_REQUEST_STATES: readonly RequestState[] = [
  'approved',
  'rejected',
  'cancelled',
  'expired',
];

export const REQUEST_TRANSITIONS: Readonly<Record<RequestState, readonly RequestState[]>> = {
  pending: ['approved', 'rejected', 'cancelled', 'expired', 'returned'],
  // A returned request is corrected and resubmitted, or abandoned.
  returned: ['pending', 'cancelled', 'expired'],
  approved: [],
  rejected: [],
  cancelled: [],
  expired: [],
};

export function canTransitionRequest(from: RequestState, to: RequestState): boolean {
  return REQUEST_TRANSITIONS[from].includes(to);
}

/** The organization references a request is scoped by. Values are owned by `CORE-ORG` and opaque here. */
export const RequestScopeSchema = z.strictObject({
  teamId: z.string().min(1).max(200).optional(),
  departmentId: z.string().min(1).max(200).optional(),
  branchId: z.string().min(1).max(200).optional(),
  projectId: z.string().min(1).max(200).optional(),
  legalEntityId: z.string().min(1).max(200).optional(),
});
export type RequestScope = z.infer<typeof RequestScopeSchema>;

/** What the policy conditions are evaluated against. Supplied by the requesting module. */
export const ApprovalContextSchema = z.strictObject({
  amount: MoneySchema.optional(),
  percentage: z
    .string()
    .regex(/^-?\d{1,3}(\.\d{1,4})?$/, { message: 'PERCENTAGE_EXPECTED' })
    .optional(),
  riskLevel: RiskLevelSchema.optional(),
  isException: z.boolean().optional(),
});
export type ApprovalContext = z.infer<typeof ApprovalContextSchema>;

/** An opaque pointer to the aggregate that needs approval. The engine never dereferences it. */
export const SourceReferenceSchema = z.strictObject({
  type: z.string().min(1).max(64),
  id: z.string().min(1).max(200),
});

/** One line of the sanitized summary shown to an approver. Values are strings, already redacted. */
export const SummaryEntrySchema = z.strictObject({
  label: LocalizedLabelSchema,
  value: z.string().min(1).max(200),
});

export const DECISION_KINDS = ['approved', 'rejected', 'returned'] as const;
export const DecisionKindSchema = z.enum(DECISION_KINDS);
export type DecisionKind = z.infer<typeof DecisionKindSchema>;

/**
 * One decision, appended and never altered (`APPROVAL-006`). `effectiveApproverAccountId` records who
 * actually acted when a delegate acted for someone else, so delegation never hides the real hand.
 */
export const ApprovalDecisionSchema = z.strictObject({
  decisionId: z.string().min(1),
  requestId: z.string().min(1),
  stageOrder: z.number().int().min(1),
  kind: DecisionKindSchema,
  /** The approver whose authority was used. */
  approverAccountId: z.string().min(1),
  /** The account that actually acted: the delegate, when one did. */
  effectiveApproverAccountId: z.string().min(1),
  onBehalfOfDelegationId: z.string().min(1).optional(),
  reason: z.string().max(500).optional(),
  /** True when the policy permitted the requester to approve their own request (`APPROVAL-003`). */
  selfApproved: z.boolean(),
  decidedAt: InstantSchema,
});
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const StageStateSchema = z.strictObject({
  order: z.number().int().min(1),
  name: LocalizedLabelSchema,
  rule: StageRuleSchema,
  required: z.number().int().min(1),
  satisfied: z.number().int().min(0),
  openedAt: InstantSchema,
  dueAt: InstantSchema.optional(),
  escalatedAt: InstantSchema.optional(),
  escalatedToAccountId: z.string().min(1).optional(),
  completedAt: InstantSchema.optional(),
});

export const ApprovalRequestSchema = z.strictObject({
  requestId: z.string().min(1),
  state: RequestStateSchema,
  operationType: OperationTypeSchema,
  source: SourceReferenceSchema,
  requesterAccountId: z.string().min(1),
  scope: RequestScopeSchema,
  context: ApprovalContextSchema,
  summary: z.array(SummaryEntrySchema).max(30),
  /** The policy **version** applied at submission. Historical requests never follow a newer policy. */
  policyKey: PolicyKeySchema,
  policyVersion: z.number().int().min(1),
  currentStageOrder: z.number().int().min(0),
  stages: z.array(StageStateSchema).min(1),
  /**
   * Accounts that may act on the current stage; the approver work queue is indexed on it. Bounded by
   * what a stage can resolve to (`MAX_PENDING_APPROVERS`). It was once 50 while a permission-based
   * stage could resolve to 200, so a permission held by more than 50 eligible accounts made the
   * request impossible to return — a 500 on submission and on every queue that listed it.
   */
  pendingApproverAccountIds: z.array(z.string().min(1)).max(MAX_PENDING_APPROVERS),
  decisions: z.array(ApprovalDecisionSchema).optional(),
  submittedAt: InstantSchema,
  expiresAt: InstantSchema.optional(),
  decidedAt: InstantSchema.optional(),
  version: z.number().int().min(1),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const SubmitRequestSchema = z.strictObject({
  operationType: OperationTypeSchema,
  source: SourceReferenceSchema,
  scope: RequestScopeSchema.default({}),
  context: ApprovalContextSchema.default({}),
  summary: z.array(SummaryEntrySchema).max(30).default([]),
  /**
   * Idempotency key supplied by the calling module. Replaying the same key with the same input returns
   * the original request; replaying it with different input is a conflict.
   */
  idempotencyKey: z.string().min(8).max(200),
});
export type SubmitRequest = z.infer<typeof SubmitRequestSchema>;

export const DecisionRequestSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500).optional(),
  /** The request version the approver saw. A mismatch is a conflict, never a silent overwrite. */
  expectedVersion: z.number().int().min(1).optional(),
});

/** Rejecting and returning both need a reason: a refusal without one cannot be acted on. */
export const RejectRequestSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
  expectedVersion: z.number().int().min(1).optional(),
});

export const CancelRequestSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});

export const ReassignRequestSchema = z.strictObject({
  fromAccountId: z.string().min(1).max(200),
  toAccountId: z.string().min(1).max(200),
  reason: z.string().trim().min(3).max(500),
});

export const RequestQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(200).optional(),
  state: RequestStateSchema.optional(),
  operationType: OperationTypeSchema.optional(),
  policyKey: PolicyKeySchema.optional(),
  sourceType: z.string().min(1).max(64).optional(),
  sourceId: z.string().min(1).max(200).optional(),
  requesterAccountId: z.string().min(1).max(200).optional(),
  /** Only requests awaiting this account's decision on the current stage. */
  awaitingMe: z.coerce.boolean().optional(),
  overdueOnly: z.coerce.boolean().optional(),
});
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

export const RequestPageSchema = z.strictObject({
  items: z.array(ApprovalRequestSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  nextCursor: z.string().optional(),
});

/* --------------------------------------------------------------- delegation */

/**
 * Time-bounded delegation (`APPROVAL-004`).
 *
 * A delegation lets the delegate act **on the delegator's stages**. It never widens what the delegate may
 * see or do elsewhere: the delegate's own permissions and data scope still apply to every read and write,
 * so a delegation cannot become a route to more authority.
 */
export const ApprovalDelegationSchema = z.strictObject({
  delegationId: z.string().min(1),
  delegatorAccountId: z.string().min(1),
  delegateAccountId: z.string().min(1),
  /** Empty means every policy the delegator is an approver for. */
  policyKeys: z.array(PolicyKeySchema).max(50),
  startsAt: InstantSchema,
  endsAt: InstantSchema,
  reason: z.string().max(500),
  revokedAt: InstantSchema.optional(),
  revokedBy: z.string().min(1).optional(),
  createdAt: InstantSchema,
  createdBy: z.string().min(1),
});
export type ApprovalDelegation = z.infer<typeof ApprovalDelegationSchema>;

export const CreateDelegationRequestSchema = z.strictObject({
  delegateAccountId: z.string().min(1).max(200),
  policyKeys: z.array(PolicyKeySchema).max(50).default([]),
  startsAt: InstantSchema,
  endsAt: InstantSchema,
  reason: z.string().trim().min(3).max(500),
});

export const DelegationListResponseSchema = z.strictObject({
  items: z.array(ApprovalDelegationSchema),
});

export const EscalationResultSchema = z.strictObject({
  escalated: z.number().int().nonnegative(),
  /** Overdue stages whose manager could not be resolved; reported rather than silently skipped. */
  unresolved: z.number().int().nonnegative(),
});

/* ------------------------------------------------------------------- audit */

export const APPROVAL_AUDIT_ACTIONS = {
  policyCreated: 'approval.policy.created',
  policyUpdated: 'approval.policy.updated',
  policyPublished: 'approval.policy.published',
  policyRetired: 'approval.policy.retired',
  requestSubmitted: 'approval.request.submitted',
  requestResubmitted: 'approval.request.resubmitted',
  stageOpened: 'approval.stage.opened',
  stageCompleted: 'approval.stage.completed',
  requestApproved: 'approval.request.approved',
  requestRejected: 'approval.request.rejected',
  requestReturned: 'approval.request.returned',
  requestCancelled: 'approval.request.cancelled',
  requestExpired: 'approval.request.expired',
  requestEscalated: 'approval.request.escalated',
  requestReassigned: 'approval.request.reassigned',
  decisionRecorded: 'approval.decision.recorded',
  invalidTransition: 'approval.request.invalidTransition',
  delegationCreated: 'approval.delegation.created',
  delegationRevoked: 'approval.delegation.revoked',
} as const;
