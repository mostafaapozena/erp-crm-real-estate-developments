import {
  DECISION_KINDS,
  POLICY_STATES,
  REQUEST_STATES,
  RISK_LEVELS,
  STAGE_RULES,
} from '@alola/contracts';
import { Schema, type Connection, type Model } from 'mongoose';

/**
 * Approval storage (`APPROVAL-001` … `APPROVAL-007`).
 *
 * Four collections:
 *
 * - `approvalPolicies` — workflow definitions, versioned. A published version is **immutable**: schema
 *   middleware refuses to modify one, so history cannot be rewritten under requests already bound to it.
 * - `approvalRequests` — one per submission, holding an **opaque** source reference and a sanitized
 *   summary. It never embeds the source document.
 * - `approvalDecisions` — **append-only** (`APPROVAL-006`), enforced the same way the audit trail is: no
 *   mutating operation reaches the collection, and a loaded document cannot be edited and re-saved.
 * - `approvalDelegations` — time-bounded delegation (`APPROVAL-004`), revoked rather than deleted.
 *
 * **No TTL index anywhere.** Approval history is business evidence and is retained; only operational rows
 * elsewhere (sessions, tokens) expire.
 */
export const POLICIES_COLLECTION = 'approvalPolicies';
export const REQUESTS_COLLECTION = 'approvalRequests';
export const DECISIONS_COLLECTION = 'approvalDecisions';
export const DELEGATIONS_COLLECTION = 'approvalDelegations';

export class ApprovalHistoryImmutableError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly operation: string) {
    super(
      `Approval decisions are append-only: "${operation}" is not permitted (APPROVAL-006, ADR-0009).`,
    );
    this.name = 'ApprovalHistoryImmutableError';
  }
}

export class PublishedPolicyImmutableError extends Error {
  readonly code = 'CONFLICT';
  constructor() {
    super('A published approval policy version cannot be modified (APPROVAL-006).');
    this.name = 'PublishedPolicyImmutableError';
  }
}

export interface StoredLocalizedLabel {
  ar: string;
  en: string;
}

export interface StoredCondition {
  field: string;
  operator: string;
  value?: unknown;
}

export interface StoredApproverRule {
  kind: string;
  accountIds?: string[];
  permission?: string;
  scope?: string;
}

export interface StoredStage {
  order: number;
  name: StoredLocalizedLabel;
  approvers: StoredApproverRule;
  rule: (typeof STAGE_RULES)[number];
  quorum?: number;
  slaHours?: number;
}

export interface ApprovalPolicyDocument {
  key: string;
  version: number;
  name: StoredLocalizedLabel;
  operationType: string;
  state: (typeof POLICY_STATES)[number];
  conditions: StoredCondition[];
  stages: StoredStage[];
  selfApproval: string;
  allowConcurrentRequests: boolean;
  expiresAfterHours?: number;
  effectiveFrom?: Date;
  publishedAt?: Date;
  publishedBy?: string;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

export interface StoredStageState {
  order: number;
  name: StoredLocalizedLabel;
  rule: (typeof STAGE_RULES)[number];
  required: number;
  satisfied: number;
  openedAt: Date;
  dueAt?: Date;
  escalatedAt?: Date;
  escalatedToAccountId?: string;
  completedAt?: Date;
}

export interface ApprovalRequestDocument {
  requestId: string;
  state: (typeof REQUEST_STATES)[number];
  operationType: string;
  source: { type: string; id: string };
  requesterAccountId: string;
  requesterRoleKeys: string[];
  scope: {
    teamId?: string;
    departmentId?: string;
    branchId?: string;
    projectId?: string;
    legalEntityId?: string;
  };
  context: {
    amount?: { amount: string; currency: string };
    percentage?: string;
    riskLevel?: (typeof RISK_LEVELS)[number];
    isException?: boolean;
  };
  summary: { label: StoredLocalizedLabel; value: string }[];
  policyKey: string;
  policyVersion: number;
  /** 0 once every stage is complete. */
  currentStageOrder: number;
  stages: StoredStageState[];
  pendingApproverAccountIds: string[];
  /**
   * Set when the applied policy forbids a second live request for the same source. The partial unique
   * index below then makes the database, not a read-then-write check, the thing that enforces it.
   */
  blocksConcurrent?: boolean;
  idempotencyKey: string;
  /** Digest of the submission input; a replay with different input is a conflict, not a silent no-op. */
  idempotencyFingerprint: string;
  submittedAt: Date;
  expiresAt?: Date;
  decidedAt?: Date;
  version: number;
  updatedAt: Date;
}

export interface ApprovalDecisionDocument {
  decisionId: string;
  requestId: string;
  stageOrder: number;
  kind: (typeof DECISION_KINDS)[number];
  approverAccountId: string;
  effectiveApproverAccountId: string;
  onBehalfOfDelegationId?: string;
  reason?: string;
  selfApproved: boolean;
  decidedAt: Date;
}

export interface ApprovalDelegationDocument {
  delegationId: string;
  delegatorAccountId: string;
  delegateAccountId: string;
  policyKeys: string[];
  startsAt: Date;
  endsAt: Date;
  reason: string;
  revokedAt?: Date;
  revokedBy?: string;
  createdAt: Date;
  createdBy: string;
}

const MUTATING_QUERY_OPS = [
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
] as const;

const localizedLabel = new Schema(
  { ar: { type: String, required: true }, en: { type: String, required: true } },
  { _id: false },
);

const conditionSchema = new Schema(
  {
    field: { type: String, required: true },
    operator: { type: String, required: true },
    value: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const approverRuleSchema = new Schema(
  {
    kind: { type: String, required: true },
    accountIds: { type: [String], default: undefined },
    permission: { type: String },
    scope: { type: String },
  },
  { _id: false },
);

const stageSchema = new Schema(
  {
    order: { type: Number, required: true },
    name: { type: localizedLabel, required: true },
    approvers: { type: approverRuleSchema, required: true },
    rule: { type: String, required: true, enum: [...STAGE_RULES] },
    quorum: { type: Number },
    slaHours: { type: Number },
  },
  { _id: false },
);

function policySchema(): Schema<ApprovalPolicyDocument> {
  const schema = new Schema<ApprovalPolicyDocument>(
    {
      key: { type: String, required: true, immutable: true },
      version: { type: Number, required: true, immutable: true },
      name: { type: localizedLabel, required: true },
      operationType: { type: String, required: true },
      state: { type: String, required: true, enum: [...POLICY_STATES] },
      conditions: { type: [conditionSchema], required: true },
      stages: { type: [stageSchema], required: true },
      selfApproval: { type: String, required: true },
      allowConcurrentRequests: { type: Boolean, required: true },
      expiresAfterHours: { type: Number },
      effectiveFrom: { type: Date },
      publishedAt: { type: Date },
      publishedBy: { type: String },
      createdAt: { type: Date, required: true, immutable: true },
      createdBy: { type: String, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
      updatedBy: { type: String, required: true },
    },
    { collection: POLICIES_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );

  /**
   * A published version is immutable (`APPROVAL-006`). The guard lives in the schema rather than in the
   * service so that a future caller reaching for the model directly cannot edit a version that live
   * requests are already bound to. Publishing itself is the one permitted transition, and it is applied
   * with an explicit `state: 'draft'` filter, which this guard allows through.
   */
  for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'] as const) {
    schema.pre(operation, function rejectPublishedEdit() {
      const filter = this.getFilter() as { state?: unknown };
      const update = this.getUpdate() as { $set?: Record<string, unknown> } | null;
      const targetsDraftOnly = filter.state === 'draft';
      const publishing = update?.$set?.['state'] === 'published';
      if (!targetsDraftOnly && !publishing) throw new PublishedPolicyImmutableError();
      if (publishing && !targetsDraftOnly) throw new PublishedPolicyImmutableError();
    });
  }
  for (const operation of ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
    schema.pre(operation, function rejectDelete() {
      throw new PublishedPolicyImmutableError();
    });
  }

  schema.index(
    { key: 1, version: 1 },
    { unique: true, name: 'approvalPolicies_key_version_unique' },
  );
  // Policy selection at submission: published, for this operation, effective now.
  schema.index(
    { operationType: 1, state: 1, effectiveFrom: 1 },
    { name: 'approvalPolicies_operation_state_effective' },
  );
  schema.index({ state: 1, updatedAt: -1 }, { name: 'approvalPolicies_state_updatedAt' });
  return schema;
}

const stageStateSchema = new Schema(
  {
    order: { type: Number, required: true },
    name: { type: localizedLabel, required: true },
    rule: { type: String, required: true, enum: [...STAGE_RULES] },
    required: { type: Number, required: true },
    satisfied: { type: Number, required: true },
    openedAt: { type: Date, required: true },
    dueAt: { type: Date },
    escalatedAt: { type: Date },
    escalatedToAccountId: { type: String },
    completedAt: { type: Date },
  },
  { _id: false },
);

const moneySchema = new Schema(
  { amount: { type: String, required: true }, currency: { type: String, required: true } },
  { _id: false },
);

const contextSchema = new Schema(
  {
    amount: { type: moneySchema },
    percentage: { type: String },
    riskLevel: { type: String, enum: [...RISK_LEVELS] },
    isException: { type: Boolean },
  },
  { _id: false },
);

const requestScopeSchema = new Schema(
  {
    teamId: { type: String },
    departmentId: { type: String },
    branchId: { type: String },
    projectId: { type: String },
    legalEntityId: { type: String },
  },
  { _id: false },
);

const summaryEntrySchema = new Schema(
  { label: { type: localizedLabel, required: true }, value: { type: String, required: true } },
  { _id: false },
);

function requestSchema(): Schema<ApprovalRequestDocument> {
  const schema = new Schema<ApprovalRequestDocument>(
    {
      requestId: { type: String, required: true, immutable: true },
      state: { type: String, required: true, enum: [...REQUEST_STATES] },
      operationType: { type: String, required: true, immutable: true },
      source: {
        type: new Schema(
          { type: { type: String, required: true }, id: { type: String, required: true } },
          { _id: false },
        ),
        required: true,
        immutable: true,
      },
      requesterAccountId: { type: String, required: true, immutable: true },
      requesterRoleKeys: { type: [String], required: true },
      scope: { type: requestScopeSchema, required: true },
      context: { type: contextSchema, required: true },
      summary: { type: [summaryEntrySchema], required: true },
      // The version applied at submission never changes, so a later policy edit cannot move the goalposts.
      policyKey: { type: String, required: true, immutable: true },
      policyVersion: { type: Number, required: true, immutable: true },
      currentStageOrder: { type: Number, required: true },
      stages: { type: [stageStateSchema], required: true },
      pendingApproverAccountIds: { type: [String], required: true },
      blocksConcurrent: { type: Boolean },
      idempotencyKey: { type: String, required: true, immutable: true },
      idempotencyFingerprint: { type: String, required: true, immutable: true },
      submittedAt: { type: Date, required: true },
      expiresAt: { type: Date },
      decidedAt: { type: Date },
      version: { type: Number, required: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: REQUESTS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );

  schema.index({ requestId: 1 }, { unique: true, name: 'approvalRequests_requestId_unique' });
  // Idempotent submission: the database rejects the second insert rather than a read-then-write race.
  schema.index(
    { idempotencyKey: 1 },
    { unique: true, name: 'approvalRequests_idempotencyKey_unique' },
  );
  /**
   * One live request per protected operation, when the policy forbids concurrency. Partial, so terminal
   * requests never block a legitimate new one — and so nothing has to be deleted to make room.
   */
  schema.index(
    { 'source.type': 1, 'source.id': 1, operationType: 1 },
    {
      unique: true,
      name: 'approvalRequests_liveSource_unique',
      partialFilterExpression: {
        blocksConcurrent: true,
        state: { $in: ['pending', 'returned'] },
      },
    },
  );
  // The approver work queue.
  schema.index(
    { pendingApproverAccountIds: 1, state: 1, submittedAt: -1 },
    { name: 'approvalRequests_queue' },
  );
  schema.index(
    { requesterAccountId: 1, submittedAt: -1 },
    { name: 'approvalRequests_requester_submittedAt' },
  );
  schema.index(
    { state: 1, submittedAt: -1, requestId: -1 },
    { name: 'approvalRequests_state_keyset' },
  );
  schema.index({ 'source.type': 1, 'source.id': 1 }, { name: 'approvalRequests_source' });
  // Organization scope, for scoped queues (SEC-026 … SEC-028).
  schema.index({ 'scope.teamId': 1, state: 1 }, { name: 'approvalRequests_scope_team' });
  schema.index(
    { 'scope.departmentId': 1, state: 1 },
    { name: 'approvalRequests_scope_department' },
  );
  schema.index({ 'scope.branchId': 1, state: 1 }, { name: 'approvalRequests_scope_branch' });
  schema.index({ 'scope.projectId': 1, state: 1 }, { name: 'approvalRequests_scope_project' });
  schema.index(
    { 'scope.legalEntityId': 1, state: 1 },
    { name: 'approvalRequests_scope_legalEntity' },
  );
  // Expiry and escalation sweeps read these; neither deletes anything.
  schema.index({ state: 1, expiresAt: 1 }, { name: 'approvalRequests_expiry' });
  schema.index({ state: 1, 'stages.dueAt': 1 }, { name: 'approvalRequests_overdue' });
  return schema;
}

function decisionSchema(): Schema<ApprovalDecisionDocument> {
  const schema = new Schema<ApprovalDecisionDocument>(
    {
      decisionId: { type: String, required: true, immutable: true },
      requestId: { type: String, required: true, immutable: true },
      stageOrder: { type: Number, required: true, immutable: true },
      kind: { type: String, required: true, immutable: true, enum: [...DECISION_KINDS] },
      approverAccountId: { type: String, required: true, immutable: true },
      effectiveApproverAccountId: { type: String, required: true, immutable: true },
      onBehalfOfDelegationId: { type: String, immutable: true },
      reason: { type: String, immutable: true },
      selfApproved: { type: Boolean, required: true, immutable: true },
      decidedAt: { type: Date, required: true, immutable: true },
    },
    { collection: DECISIONS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );

  // APPROVAL-006: the same three layers the audit trail uses (ADR-0021).
  for (const operation of MUTATING_QUERY_OPS) {
    schema.pre(operation, function rejectMutation() {
      throw new ApprovalHistoryImmutableError(operation);
    });
  }
  schema.pre('bulkWrite', function rejectBulkWrite() {
    throw new ApprovalHistoryImmutableError('bulkWrite');
  });
  schema.pre('save', function rejectResave() {
    if (!this.isNew) throw new ApprovalHistoryImmutableError('save (existing document)');
  });

  schema.index({ decisionId: 1 }, { unique: true, name: 'approvalDecisions_decisionId_unique' });
  schema.index(
    { requestId: 1, stageOrder: 1, decidedAt: 1 },
    { name: 'approvalDecisions_request_stage' },
  );
  /**
   * One decision per approver per stage. Two concurrent approvals therefore produce exactly one accepted
   * decision: the loser hits this index, not a lost update.
   */
  schema.index(
    { requestId: 1, stageOrder: 1, approverAccountId: 1 },
    { unique: true, name: 'approvalDecisions_request_stage_approver_unique' },
  );
  schema.index(
    { effectiveApproverAccountId: 1, decidedAt: -1 },
    { name: 'approvalDecisions_approver_decidedAt' },
  );
  return schema;
}

function delegationSchema(): Schema<ApprovalDelegationDocument> {
  const schema = new Schema<ApprovalDelegationDocument>(
    {
      delegationId: { type: String, required: true, immutable: true },
      delegatorAccountId: { type: String, required: true, immutable: true },
      delegateAccountId: { type: String, required: true, immutable: true },
      policyKeys: { type: [String], required: true },
      startsAt: { type: Date, required: true, immutable: true },
      endsAt: { type: Date, required: true, immutable: true },
      reason: { type: String, required: true, immutable: true },
      revokedAt: { type: Date },
      revokedBy: { type: String },
      createdAt: { type: Date, required: true, immutable: true },
      createdBy: { type: String, required: true, immutable: true },
    },
    { collection: DELEGATIONS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );

  // Revocation is an update; deletion is not, because a delegation that was once live is history.
  for (const operation of ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
    schema.pre(operation, function rejectDelete() {
      throw new ApprovalHistoryImmutableError(operation);
    });
  }

  schema.index(
    { delegationId: 1 },
    { unique: true, name: 'approvalDelegations_delegationId_unique' },
  );
  schema.index(
    { delegatorAccountId: 1, startsAt: 1, endsAt: 1 },
    { name: 'approvalDelegations_delegator_window' },
  );
  schema.index(
    { delegateAccountId: 1, startsAt: 1, endsAt: 1 },
    { name: 'approvalDelegations_delegate_window' },
  );
  return schema;
}

function model<T>(connection: Connection, name: string, build: () => Schema<T>): Model<T> {
  return (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, build());
}

export function policyModel(connection: Connection): Model<ApprovalPolicyDocument> {
  return model(connection, POLICIES_COLLECTION, policySchema);
}

export function requestModel(connection: Connection): Model<ApprovalRequestDocument> {
  return model(connection, REQUESTS_COLLECTION, requestSchema);
}

export function decisionModel(connection: Connection): Model<ApprovalDecisionDocument> {
  return model(connection, DECISIONS_COLLECTION, decisionSchema);
}

export function delegationModel(connection: Connection): Model<ApprovalDelegationDocument> {
  return model(connection, DELEGATIONS_COLLECTION, delegationSchema);
}
