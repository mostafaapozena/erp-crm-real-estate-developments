import { createHash, randomUUID } from 'node:crypto';
import {
  APPROVAL_AUDIT_ACTIONS,
  ApprovalDelegationSchema,
  ApprovalPolicySchema,
  ApprovalRequestSchema,
  CreatePolicyRequestSchema,
  type ActorContext,
  type ApprovalDecision,
  type ApprovalDelegation,
  type ApprovalPolicy,
  type ApprovalRequest,
  type ApproverRule,
  type CreatePolicyRequest,
  type DecisionKind,
  type Permission,
  type PolicyIssueCode,
  type RequestQuery,
  type RequestScope,
  type RequestState,
} from '@alola/contracts';
import {
  assertSafeFilter,
  buildScopeFilter,
  restrictDocument,
  restrictDocuments,
  withScope,
  type Logger,
  type ScopeFieldMap,
} from '@alola/security';
import type { ClientSession, Connection } from 'mongoose';
import { withTransaction } from '../../platform/transactions';
import {
  decisionModel,
  delegationModel,
  policyModel,
  requestModel,
  type ApprovalDecisionDocument,
  type ApprovalDelegationDocument,
  type ApprovalPolicyDocument,
  type ApprovalRequestDocument,
} from './model';
import {
  assertDelegationAllowed,
  assertDistinctStageApprover,
  assertTransition,
  evaluateSelfApproval,
  isDelegationActive,
  isEligibleApprover,
  selectPolicy,
  stageRequirement,
  validatePolicyStages,
  type ConditionSubject,
} from './rules';

/**
 * Approval engine (`APPROVAL-001` … `APPROVAL-007`).
 *
 * Three properties hold everywhere below:
 *
 * 1. **A request never executes anything.** It records that an operation was approved; the owning module
 *    observes the outcome and acts. The engine therefore needs no knowledge of any business module, and
 *    an approval cannot become a side effect.
 * 2. **History is append-only.** Decisions are inserted, never updated; an earlier decision is never
 *    overwritten by a later one (`APPROVAL-006`).
 * 3. **A decision, the stage counter it moves, and its audit record commit together**, inside one
 *    transaction. Anything less leaves either an unexplained state or evidence nobody can find.
 */

/** What this module needs from the audit subsystem; it never imports that module (ADR-0001). */
export interface ApprovalAuditRecorder {
  record(
    input: {
      action: string;
      outcome: 'succeeded' | 'denied' | 'failed';
      actor: {
        kind: 'account' | 'system' | 'anonymous';
        accountId?: string;
        roleKeys?: string[];
        sessionId?: string;
      };
      target: { type: string; id?: string };
      changes?: { path: string; from?: string; to?: string }[];
      reason?: string;
      context: {
        correlationId: string;
        ip?: string;
        userAgent?: string;
        method?: string;
        route?: string;
      };
    },
    options?: { session?: ClientSession },
  ): Promise<unknown>;
}

export interface RequestContext {
  correlationId: string;
  ip?: string;
  userAgent?: string;
  method?: string;
  route?: string;
}

/**
 * A domain event for whoever cares that an approval moved. `CORE-NOTIFY` and `CORE-TASK` are **not** part
 * of this group: this is the port they will implement. Publication happens **after** the transaction
 * commits and its failure is logged and swallowed — the approval must be correct whether or not anything
 * is listening.
 */
export interface ApprovalEvent {
  action: string;
  requestId: string;
  state: RequestState;
  stageOrder: number;
  /** Accounts that now owe a decision, so a notifier knows whom to tell. */
  pendingApproverAccountIds: readonly string[];
  /** Who asked, so a notifier can tell them how it ended. */
  requesterAccountId?: string;
  occurredAt: Date;
}

export interface ApprovalEventPublisher {
  publish(event: ApprovalEvent): Promise<void>;
}

export interface ApprovalServiceOptions {
  connection: Connection;
  logger: Logger;
  audit: ApprovalAuditRecorder;
  /** Candidate accounts holding a permission, for permission-based stages. */
  accountsWithPermission: (
    permission: Permission,
  ) => Promise<{ accountIds: string[]; truncated: boolean }>;
  /** Resolve one account's actor, to test its own scope against the request's. */
  resolveActor: (accountId: string) => Promise<ActorContext | undefined>;
  /**
   * The requester's direct manager (`APPROVAL-005`). The reporting line belongs to `CORE-ORG`
   * (Phase 2, `SD-01`); until that exists no resolver is configured and escalation reports the stage as
   * unresolved rather than inventing a manager.
   */
  resolveManager?: (accountId: string) => Promise<string | undefined>;
  events?: ApprovalEventPublisher;
  now?: () => Date;
}

/* ------------------------------------------------------------------ errors */

export class PolicyInvalidError extends Error {
  readonly code = 'VALIDATION_FAILED';
  constructor(readonly issues: PolicyIssueCode[]) {
    super('VALIDATION_FAILED');
    this.name = 'PolicyInvalidError';
  }
}

export class PolicyNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('NOT_FOUND');
    this.name = 'PolicyNotFoundError';
  }
}

export class PolicyStateError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly detail: 'not-draft' | 'already-published' | 'duplicate-key-version') {
    super('CONFLICT');
    this.name = 'PolicyStateError';
  }
}

export class NoApplicablePolicyError extends Error {
  readonly code = 'VALIDATION_FAILED';
  constructor(readonly operationType: string) {
    super('VALIDATION_FAILED');
    this.name = 'NoApplicablePolicyError';
  }
}

export class RequestNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('NOT_FOUND');
    this.name = 'RequestNotFoundError';
  }
}

export class IdempotencyConflictError extends Error {
  readonly code = 'CONFLICT';
  constructor() {
    super('CONFLICT');
    this.name = 'IdempotencyConflictError';
  }
}

export class DuplicateLiveRequestError extends Error {
  readonly code = 'CONFLICT';
  constructor() {
    super('CONFLICT');
    this.name = 'DuplicateLiveRequestError';
  }
}

export class NotEligibleApproverError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(readonly detail: 'not-eligible' | 'stage-not-current' | 'already-decided') {
    super('FORBIDDEN');
    this.name = 'NotEligibleApproverError';
  }
}

export class ConcurrentDecisionError extends Error {
  readonly code = 'CONFLICT';
  constructor() {
    super('CONFLICT');
    this.name = 'ConcurrentDecisionError';
  }
}

export class DelegationNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('NOT_FOUND');
    this.name = 'DelegationNotFoundError';
  }
}

/* ------------------------------------------------------------------ helpers */

/**
 * Scope mapping for requests (SEC-026 … SEC-028). This is the first module whose records carry
 * organization references, so team, department, branch, project, and legal-entity scopes resolve to a real
 * filter here rather than failing closed.
 */
export const APPROVAL_SCOPE_FIELDS: ScopeFieldMap = {
  owner: 'requesterAccountId',
  assignee: 'pendingApproverAccountIds',
  team: 'scope.teamId',
  department: 'scope.departmentId',
  branch: 'scope.branchId',
  project: 'scope.projectId',
  legalEntity: 'scope.legalEntityId',
};

/** Canonical JSON, so an idempotency fingerprint does not depend on key order. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('base64url');
}

function identifier(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

function plusHours(from: Date, hours: number): Date {
  return new Date(from.getTime() + hours * 3_600_000);
}

const CURSOR_SEPARATOR = '|';

export class ApprovalService {
  private readonly policies;
  private readonly requests;
  private readonly decisions;
  private readonly delegations;
  private readonly now: () => Date;

  constructor(private readonly options: ApprovalServiceOptions) {
    this.policies = policyModel(options.connection);
    this.requests = requestModel(options.connection);
    this.decisions = decisionModel(options.connection);
    this.delegations = delegationModel(options.connection);
    this.now = options.now ?? (() => new Date());
  }

  /* --------------------------------------------------------- serialization */

  private toPolicy(document: ApprovalPolicyDocument): ApprovalPolicy {
    return ApprovalPolicySchema.parse({
      key: document.key,
      version: document.version,
      name: document.name,
      operationType: document.operationType,
      state: document.state,
      conditions: document.conditions,
      stages: document.stages,
      selfApproval: document.selfApproval,
      allowConcurrentRequests: document.allowConcurrentRequests,
      ...(document.expiresAfterHours !== undefined
        ? { expiresAfterHours: document.expiresAfterHours }
        : {}),
      ...(document.effectiveFrom ? { effectiveFrom: document.effectiveFrom.toISOString() } : {}),
      ...(document.publishedAt ? { publishedAt: document.publishedAt.toISOString() } : {}),
      ...(document.publishedBy ? { publishedBy: document.publishedBy } : {}),
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    });
  }

  private toDecision(document: ApprovalDecisionDocument): ApprovalDecision {
    return {
      decisionId: document.decisionId,
      requestId: document.requestId,
      stageOrder: document.stageOrder,
      kind: document.kind,
      approverAccountId: document.approverAccountId,
      effectiveApproverAccountId: document.effectiveApproverAccountId,
      ...(document.onBehalfOfDelegationId
        ? { onBehalfOfDelegationId: document.onBehalfOfDelegationId }
        : {}),
      ...(document.reason ? { reason: document.reason } : {}),
      selfApproved: document.selfApproved,
      decidedAt: document.decidedAt.toISOString(),
    } as ApprovalDecision;
  }

  /**
   * The only way a request leaves this module. Built field by field, so an internal field added later —
   * the idempotency fingerprint, for instance — cannot reach a response by being picked up automatically.
   */
  private toRequest(
    document: ApprovalRequestDocument,
    decisions: readonly ApprovalDecisionDocument[] = [],
  ): ApprovalRequest {
    return ApprovalRequestSchema.parse({
      requestId: document.requestId,
      state: document.state,
      operationType: document.operationType,
      source: document.source,
      requesterAccountId: document.requesterAccountId,
      scope: document.scope,
      context: document.context,
      summary: document.summary,
      policyKey: document.policyKey,
      policyVersion: document.policyVersion,
      currentStageOrder: document.currentStageOrder,
      stages: document.stages.map((stage) => ({
        order: stage.order,
        name: stage.name,
        rule: stage.rule,
        required: stage.required,
        satisfied: stage.satisfied,
        openedAt: stage.openedAt.toISOString(),
        ...(stage.dueAt ? { dueAt: stage.dueAt.toISOString() } : {}),
        ...(stage.escalatedAt ? { escalatedAt: stage.escalatedAt.toISOString() } : {}),
        ...(stage.escalatedToAccountId ? { escalatedToAccountId: stage.escalatedToAccountId } : {}),
        ...(stage.completedAt ? { completedAt: stage.completedAt.toISOString() } : {}),
      })),
      pendingApproverAccountIds: document.pendingApproverAccountIds,
      ...(decisions.length > 0
        ? { decisions: decisions.map((decision) => this.toDecision(decision)) }
        : {}),
      submittedAt: document.submittedAt.toISOString(),
      ...(document.expiresAt ? { expiresAt: document.expiresAt.toISOString() } : {}),
      ...(document.decidedAt ? { decidedAt: document.decidedAt.toISOString() } : {}),
      version: document.version,
    });
  }

  private auditActor(actor: ActorContext) {
    return {
      kind: actor.kind,
      accountId: actor.accountId,
      roleKeys: [...actor.roleKeys],
      ...(actor.sessionId ? { sessionId: actor.sessionId } : {}),
    };
  }

  /* ------------------------------------------------------------- policies */

  /** Create a draft version (`APPROVAL-002`). Validation runs before anything is stored. */
  async createPolicy(
    actor: ActorContext,
    input: CreatePolicyRequest,
    context: RequestContext,
  ): Promise<ApprovalPolicy> {
    const parsed = CreatePolicyRequestSchema.parse(input);
    const issues = validatePolicyStages(parsed.stages, parsed.conditions);
    if (issues.length > 0) throw new PolicyInvalidError(issues);

    const latest = await this.policies
      .findOne({ key: parsed.key })
      .sort({ version: -1 })
      .lean<ApprovalPolicyDocument>()
      .exec();
    const version = (latest?.version ?? 0) + 1;
    const now = this.now();

    const document: ApprovalPolicyDocument = {
      key: parsed.key,
      version,
      name: parsed.name,
      operationType: parsed.operationType,
      state: 'draft',
      conditions: parsed.conditions,
      stages: parsed.stages,
      selfApproval: parsed.selfApproval,
      allowConcurrentRequests: parsed.allowConcurrentRequests,
      ...(parsed.expiresAfterHours !== undefined
        ? { expiresAfterHours: parsed.expiresAfterHours }
        : {}),
      ...(parsed.effectiveFrom ? { effectiveFrom: new Date(parsed.effectiveFrom) } : {}),
      createdAt: now,
      createdBy: actor.accountId,
      updatedAt: now,
      updatedBy: actor.accountId,
    };

    try {
      await this.policies.create(document);
    } catch (error) {
      if (/E11000/.test(error instanceof Error ? error.message : '')) {
        throw new PolicyStateError('duplicate-key-version');
      }
      throw error;
    }

    await this.options.audit.record({
      action: APPROVAL_AUDIT_ACTIONS.policyCreated,
      outcome: 'succeeded',
      actor: this.auditActor(actor),
      target: { type: 'approvalPolicy', id: `${parsed.key}@${version}` },
      changes: [
        { path: 'state', to: 'draft' },
        { path: 'operationType', to: parsed.operationType },
        { path: 'stages', to: String(parsed.stages.length) },
        { path: 'selfApproval', to: parsed.selfApproval },
      ],
      context,
    });
    return this.toPolicy(document);
  }

  /**
   * Edit a draft. The schema refuses an update that does not target `state: 'draft'`, so a published
   * version cannot be edited even by a caller reaching for the model directly (`APPROVAL-006`).
   */
  async updateDraftPolicy(
    actor: ActorContext,
    key: string,
    version: number,
    input: Partial<CreatePolicyRequest>,
    context: RequestContext,
  ): Promise<ApprovalPolicy> {
    const existing = await this.policies
      .findOne({ key, version })
      .lean<ApprovalPolicyDocument>()
      .exec();
    if (!existing) throw new PolicyNotFoundError();
    if (existing.state !== 'draft') throw new PolicyStateError('not-draft');

    const stages = input.stages ?? existing.stages;
    const conditions = input.conditions ?? existing.conditions;
    const issues = validatePolicyStages(
      stages as CreatePolicyRequest['stages'],
      conditions as CreatePolicyRequest['conditions'],
    );
    if (issues.length > 0) throw new PolicyInvalidError(issues);

    const now = this.now();
    const updated = await this.policies
      .findOneAndUpdate(
        { key, version, state: 'draft' },
        {
          $set: {
            ...(input.name ? { name: input.name } : {}),
            ...(input.operationType ? { operationType: input.operationType } : {}),
            ...(input.stages ? { stages: input.stages } : {}),
            ...(input.conditions ? { conditions: input.conditions } : {}),
            ...(input.selfApproval ? { selfApproval: input.selfApproval } : {}),
            ...(input.allowConcurrentRequests !== undefined
              ? { allowConcurrentRequests: input.allowConcurrentRequests }
              : {}),
            ...(input.expiresAfterHours !== undefined
              ? { expiresAfterHours: input.expiresAfterHours }
              : {}),
            ...(input.effectiveFrom ? { effectiveFrom: new Date(input.effectiveFrom) } : {}),
            updatedAt: now,
            updatedBy: actor.accountId,
          },
        },
        { new: true },
      )
      .lean<ApprovalPolicyDocument>()
      .exec();
    if (!updated) throw new PolicyStateError('not-draft');

    await this.options.audit.record({
      action: APPROVAL_AUDIT_ACTIONS.policyUpdated,
      outcome: 'succeeded',
      actor: this.auditActor(actor),
      target: { type: 'approvalPolicy', id: `${key}@${version}` },
      changes: Object.keys(input).map((field) => ({ path: field, to: 'changed' })),
      context,
    });
    return this.toPolicy(updated);
  }

  /** Publish a draft. From here the version is immutable and requests bind to it. */
  async publishPolicy(
    actor: ActorContext,
    key: string,
    version: number,
    context: RequestContext,
  ): Promise<ApprovalPolicy> {
    const existing = await this.policies
      .findOne({ key, version })
      .lean<ApprovalPolicyDocument>()
      .exec();
    if (!existing) throw new PolicyNotFoundError();
    if (existing.state === 'published') throw new PolicyStateError('already-published');
    if (existing.state !== 'draft') throw new PolicyStateError('not-draft');

    // Validate again at the gate: a draft may have been written before a rule tightened.
    const issues = validatePolicyStages(
      existing.stages as CreatePolicyRequest['stages'],
      existing.conditions as CreatePolicyRequest['conditions'],
    );
    if (issues.length > 0) throw new PolicyInvalidError(issues);

    const now = this.now();
    const published = await this.policies
      .findOneAndUpdate(
        { key, version, state: 'draft' },
        {
          $set: {
            state: 'published',
            publishedAt: now,
            publishedBy: actor.accountId,
            updatedAt: now,
            updatedBy: actor.accountId,
          },
        },
        { new: true },
      )
      .lean<ApprovalPolicyDocument>()
      .exec();
    if (!published) throw new PolicyStateError('not-draft');

    await this.options.audit.record({
      action: APPROVAL_AUDIT_ACTIONS.policyPublished,
      outcome: 'succeeded',
      actor: this.auditActor(actor),
      target: { type: 'approvalPolicy', id: `${key}@${version}` },
      changes: [{ path: 'state', from: 'draft', to: 'published' }],
      context,
    });
    return this.toPolicy(published);
  }

  async listPolicies(filter: { key?: string; state?: string }): Promise<ApprovalPolicy[]> {
    const query: Record<string, unknown> = {};
    if (filter.key) query['key'] = filter.key;
    if (filter.state) query['state'] = filter.state;
    const documents = await this.policies
      .find(query)
      .sort({ key: 1, version: -1 })
      .limit(200)
      .lean<ApprovalPolicyDocument[]>()
      .exec();
    return documents.map((document) => this.toPolicy(document));
  }

  async getPolicy(key: string, version: number): Promise<ApprovalPolicy> {
    const document = await this.policies
      .findOne({ key, version })
      .lean<ApprovalPolicyDocument>()
      .exec();
    if (!document) throw new PolicyNotFoundError();
    return this.toPolicy(document);
  }

  /* -------------------------------------------------------- approver sets */

  /**
   * Accounts that may act on a stage right now.
   *
   * For a bounded rule this is the configured list. For a permission-based rule the candidates come from
   * the authorization module and are then filtered by **their own** data scope against the request's
   * organization references, so holding the permission is not the same as reaching every request.
   */
  private async resolveStageApprovers(
    rule: ApproverRule,
    requestScope: RequestScope,
    requesterAccountId: string,
  ): Promise<string[]> {
    if (rule.kind === 'accounts') return [...new Set(rule.accountIds)];
    if (rule.kind === 'manager') {
      const manager = await this.options.resolveManager?.(requesterAccountId);
      return manager ? [manager] : [];
    }
    const candidates = await this.options.accountsWithPermission(rule.permission);
    if (candidates.truncated) {
      this.options.logger.warn(
        { code: 'APPROVER_CANDIDATES_TRUNCATED', permission: rule.permission },
        'More accounts hold this permission than the approver queue will list; narrow the stage rule.',
      );
    }
    const eligible: string[] = [];
    for (const accountId of candidates.accountIds) {
      const actor = await this.options.resolveActor(accountId);
      if (!actor) continue;
      if (
        isEligibleApprover({
          rule,
          actor: {
            accountId: actor.accountId,
            permissions: actor.permissions,
            scope: actor.scope,
          },
          requestScope,
        })
      ) {
        eligible.push(accountId);
      }
    }
    return eligible;
  }

  /* -------------------------------------------------------------- requests */

  /**
   * Whether a published policy would govern this operation — the question `submit` answers first,
   * asked without submitting. A module uses it to refuse an exception **before** it writes anything:
   * an exception no policy can approve must not become a record waiting for an approval that can never
   * come (ADR-0024). Reads only; records nothing.
   */
  async hasApplicablePolicy(
    actor: ActorContext,
    input: { operationType: string; scope: RequestScope; context: ApprovalRequest['context'] },
  ): Promise<boolean> {
    const candidates = await this.policies
      .find({ operationType: input.operationType, state: 'published' })
      .lean<ApprovalPolicyDocument[]>()
      .exec();
    const policy = selectPolicy(
      candidates.map((document) => this.toPolicy(document)),
      input.operationType,
      { context: input.context, scope: input.scope, requesterRoleKeys: actor.roleKeys },
      this.now(),
    );
    return policy !== undefined && policy.stages.length > 0;
  }

  /**
   * Submit a request (`APPROVAL-001`).
   *
   * The applied policy **version** is stored, so a later edit or a newer version never changes what an
   * outstanding request requires. Submission is idempotent on the caller's key: the same key with the same
   * input returns the original request, and with different input it is a conflict rather than a second
   * request nobody expected.
   */
  async submit(
    actor: ActorContext,
    input: {
      operationType: string;
      source: { type: string; id: string };
      scope: RequestScope;
      context: ApprovalRequest['context'];
      summary: ApprovalRequest['summary'];
      idempotencyKey: string;
    },
    context: RequestContext,
  ): Promise<{ request: ApprovalRequest; replayed: boolean }> {
    const print = fingerprint({
      operationType: input.operationType,
      source: input.source,
      scope: input.scope,
      context: input.context,
      summary: input.summary,
      requesterAccountId: actor.accountId,
    });

    const existing = await this.requests
      .findOne({ idempotencyKey: input.idempotencyKey })
      .lean<ApprovalRequestDocument>()
      .exec();
    if (existing) {
      if (existing.idempotencyFingerprint !== print) throw new IdempotencyConflictError();
      return { request: this.toRequest(existing), replayed: true };
    }

    const subject: ConditionSubject = {
      context: input.context,
      scope: input.scope,
      requesterRoleKeys: actor.roleKeys,
    };
    const now = this.now();
    const candidates = await this.policies
      .find({ operationType: input.operationType, state: 'published' })
      .lean<ApprovalPolicyDocument[]>()
      .exec();
    const policy = selectPolicy(
      candidates.map((document) => this.toPolicy(document)),
      input.operationType,
      subject,
      now,
    );
    if (!policy) throw new NoApplicablePolicyError(input.operationType);

    const firstStage = [...policy.stages].sort((a, b) => a.order - b.order)[0];
    if (!firstStage) throw new NoApplicablePolicyError(input.operationType);
    const approvers = await this.resolveStageApprovers(
      firstStage.approvers,
      input.scope,
      actor.accountId,
    );

    const document: ApprovalRequestDocument = {
      requestId: identifier('apr'),
      state: 'pending',
      operationType: input.operationType,
      source: input.source,
      requesterAccountId: actor.accountId,
      requesterRoleKeys: [...actor.roleKeys],
      scope: input.scope,
      context: input.context,
      summary: input.summary,
      policyKey: policy.key,
      policyVersion: policy.version,
      currentStageOrder: firstStage.order,
      stages: policy.stages
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((stage) => ({
          order: stage.order,
          name: stage.name,
          rule: stage.rule,
          required: stageRequirement(stage),
          satisfied: 0,
          openedAt: now,
          ...(stage.order === firstStage.order && stage.slaHours
            ? { dueAt: plusHours(now, stage.slaHours) }
            : {}),
        })),
      pendingApproverAccountIds: approvers,
      ...(policy.allowConcurrentRequests ? {} : { blocksConcurrent: true }),
      idempotencyKey: input.idempotencyKey,
      idempotencyFingerprint: print,
      submittedAt: now,
      ...(policy.expiresAfterHours ? { expiresAt: plusHours(now, policy.expiresAfterHours) } : {}),
      version: 1,
      updatedAt: now,
    };

    try {
      await this.requests.create(document);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/E11000/.test(message)) {
        // Which uniqueness rule was hit decides the answer: the idempotency key or the live-source rule.
        if (/idempotencyKey/.test(message)) throw new IdempotencyConflictError();
        throw new DuplicateLiveRequestError();
      }
      throw error;
    }

    await this.options.audit.record({
      action: APPROVAL_AUDIT_ACTIONS.requestSubmitted,
      outcome: 'succeeded',
      actor: this.auditActor(actor),
      target: { type: 'approvalRequest', id: document.requestId },
      changes: [
        { path: 'state', to: 'pending' },
        { path: 'policy', to: `${policy.key}@${policy.version}` },
        { path: 'source', to: `${input.source.type}:${input.source.id}` },
        { path: 'currentStageOrder', to: String(firstStage.order) },
      ],
      context,
    });
    await this.emit({
      action: APPROVAL_AUDIT_ACTIONS.stageOpened,
      requestId: document.requestId,
      state: 'pending',
      stageOrder: firstStage.order,
      pendingApproverAccountIds: approvers,
      requesterAccountId: document.requesterAccountId,
      occurredAt: now,
    });

    return { request: this.toRequest(document), replayed: false };
  }

  /** Publication is best-effort by design: nothing about an approval depends on a listener existing. */
  private async emit(event: ApprovalEvent): Promise<void> {
    if (!this.options.events) return;
    try {
      await this.options.events.publish(event);
    } catch (error) {
      this.options.logger.warn(
        { err: error, code: 'APPROVAL_EVENT_NOT_PUBLISHED', requestId: event.requestId },
        'An approval event could not be published; the approval itself is unaffected.',
      );
    }
  }

  private scopedFilter(actor: ActorContext, extra: Record<string, unknown> = {}) {
    return withScope(buildScopeFilter(actor, APPROVAL_SCOPE_FIELDS), extra);
  }

  /** A request outside the actor's scope is reported as absent, never as forbidden (SEC-030). */
  async getRequest(actor: ActorContext, requestId: string): Promise<Partial<ApprovalRequest>> {
    const document = await this.requests
      .findOne(this.scopedFilter(actor, { requestId }))
      .lean<ApprovalRequestDocument>()
      .exec();
    if (!document) throw new RequestNotFoundError();
    const decisions = await this.decisions
      .find({ requestId })
      .sort({ stageOrder: 1, decidedAt: 1 })
      .lean<ApprovalDecisionDocument[]>()
      .exec();
    return restrictDocument('approvalRequest', actor, this.toRequest(document, decisions));
  }

  /**
   * The outcome of one request, with no actor and no scope.
   *
   * For the **owning module**, which has already authorized its own operation and now needs to know
   * whether the control it raised was satisfied. Deliberately narrow: it returns the state and the
   * source reference and nothing else, so it cannot become a way around `getRequest`'s scoping or
   * its field restrictions (SEC-029).
   */
  async findRequestOutcome(
    requestId: string,
  ): Promise<{ state: string; source: { type: string; id: string } } | undefined> {
    assertSafeFilter({ requestId });
    const document = await this.requests
      .findOne({ requestId })
      .select({ state: 1, source: 1 })
      .lean<ApprovalRequestDocument>()
      .exec();
    return document
      ? { state: document.state, source: { type: document.source.type, id: document.source.id } }
      : undefined;
  }

  /** Deterministic keyset pagination: `submittedAt desc, requestId desc`. */
  async listRequests(
    actor: ActorContext,
    query: RequestQuery,
  ): Promise<{
    items: Partial<ApprovalRequest>[];
    total: number;
    limit: number;
    nextCursor?: string;
  }> {
    const filter: Record<string, unknown> = {};
    if (query.state) filter['state'] = query.state;
    if (query.operationType) filter['operationType'] = query.operationType;
    if (query.policyKey) filter['policyKey'] = query.policyKey;
    if (query.sourceType) filter['source.type'] = query.sourceType;
    if (query.sourceId) filter['source.id'] = query.sourceId;
    if (query.requesterAccountId) filter['requesterAccountId'] = query.requesterAccountId;
    if (query.awaitingMe) {
      filter['pendingApproverAccountIds'] = actor.accountId;
      filter['state'] = query.state ?? 'pending';
    }
    if (query.overdueOnly) {
      filter['stages'] = {
        $elemMatch: { completedAt: { $exists: false }, dueAt: { $lte: this.now() } },
      };
    }

    const scoped = this.scopedFilter(actor, filter);
    const total = await this.requests.countDocuments(scoped).exec();

    const paged: Record<string, unknown> = { ...scoped };
    if (query.cursor) {
      const [iso, requestId] = Buffer.from(query.cursor, 'base64url')
        .toString('utf8')
        .split(CURSOR_SEPARATOR);
      const submittedAt = iso ? new Date(iso) : undefined;
      if (!submittedAt || Number.isNaN(submittedAt.getTime()) || !requestId) {
        throw new RequestNotFoundError();
      }
      const after = {
        $or: [
          { submittedAt: { $lt: submittedAt } },
          { submittedAt, requestId: { $lt: requestId } },
        ],
      };
      paged['$and'] = [...((scoped['$and'] as unknown[]) ?? []), after];
    }

    const documents = await this.requests
      .find(paged)
      .sort({ submittedAt: -1, requestId: -1 })
      .limit(query.limit)
      .lean<ApprovalRequestDocument[]>()
      .exec();

    const last = documents[documents.length - 1];
    const nextCursor =
      documents.length === query.limit && last
        ? Buffer.from(
            `${last.submittedAt.toISOString()}${CURSOR_SEPARATOR}${last.requestId}`,
            'utf8',
          ).toString('base64url')
        : undefined;

    return {
      items: restrictDocuments(
        'approvalRequest',
        actor,
        documents.map((document) => this.toRequest(document)),
      ),
      total,
      limit: query.limit,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  /* ------------------------------------------------------------- decisions */

  /**
   * Which authority the actor is exercising: their own, or a delegator's through an active delegation
   * (`APPROVAL-004`). A delegation is only consulted for stages its delegator could act on, and it never
   * grants the delegate anything beyond that.
   */
  private async resolveAuthority(
    actor: ActorContext,
    request: ApprovalRequestDocument,
    stageApprovers: readonly string[],
  ): Promise<{ approverAccountId: string; delegationId?: string }> {
    if (stageApprovers.includes(actor.accountId)) return { approverAccountId: actor.accountId };

    const now = this.now();
    const delegations = await this.delegations
      .find({ delegateAccountId: actor.accountId, revokedAt: { $exists: false } })
      .lean<ApprovalDelegationDocument[]>()
      .exec();
    for (const delegation of delegations) {
      if (!isDelegationActive(delegation, now)) continue;
      if (delegation.policyKeys.length > 0 && !delegation.policyKeys.includes(request.policyKey)) {
        continue;
      }
      if (stageApprovers.includes(delegation.delegatorAccountId)) {
        return {
          approverAccountId: delegation.delegatorAccountId,
          delegationId: delegation.delegationId,
        };
      }
    }
    throw new NotEligibleApproverError('not-eligible');
  }

  /**
   * Record a decision (`APPROVAL-001`, `APPROVAL-003`, `APPROVAL-006`).
   *
   * Everything that changes state happens in one transaction: the decision row, the stage counter, the
   * request state, and the audit records. The decision row carries a unique index on
   * `(requestId, stageOrder, approverAccountId)`, so two concurrent approvals produce exactly one accepted
   * decision — the loser fails on the index rather than silently overwriting a counter.
   */
  async decide(
    actor: ActorContext,
    requestId: string,
    kind: DecisionKind,
    input: { reason?: string | undefined; expectedVersion?: number | undefined },
    context: RequestContext,
  ): Promise<Partial<ApprovalRequest>> {
    const current = await this.requests
      .findOne(this.scopedFilter(actor, { requestId }))
      .lean<ApprovalRequestDocument>()
      .exec();
    if (!current) throw new RequestNotFoundError();

    if (current.state !== 'pending') {
      // Approving something already decided, cancelled, expired, or returned is an illegal transition, and
      // the attempt is evidence: it is recorded before the refusal.
      await this.recordInvalidTransition(actor, current, kind, context);
      const target: RequestState =
        kind === 'approved' ? 'approved' : kind === 'rejected' ? 'rejected' : 'returned';
      assertTransition(current.state, target);
      // Unreachable: no non-pending state permits a decision. Kept so the compiler sees a total function.
      throw new ConcurrentDecisionError();
    }
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      throw new ConcurrentDecisionError();
    }

    const stage = current.stages.find((entry) => entry.order === current.currentStageOrder);
    if (!stage) throw new ConcurrentDecisionError();

    const policy = await this.policies
      .findOne({ key: current.policyKey, version: current.policyVersion })
      .lean<ApprovalPolicyDocument>()
      .exec();
    if (!policy) throw new PolicyNotFoundError();
    const policyStage = policy.stages.find((entry) => entry.order === stage.order);
    if (!policyStage) throw new ConcurrentDecisionError();

    // Stage ordering: the pending list belongs to the current stage only, so a later-stage approver
    // simply is not eligible yet.
    const stageApprovers = current.pendingApproverAccountIds;
    const authority = await this.resolveAuthority(actor, current, stageApprovers);

    const earlier = await this.decisions
      .find({ requestId })
      .lean<ApprovalDecisionDocument[]>()
      .exec();

    const { selfApproved } = evaluateSelfApproval({
      mode: policy.selfApproval as 'prohibited' | 'permittedWithReason',
      requesterAccountId: current.requesterAccountId,
      approverAccountId: authority.approverAccountId,
      effectiveApproverAccountId: actor.accountId,
      reason: input.reason,
    });
    assertDistinctStageApprover({
      mode: policy.selfApproval as 'prohibited' | 'permittedWithReason',
      stageOrder: stage.order,
      effectiveApproverAccountId: actor.accountId,
      earlierDecisions: earlier,
    });

    const now = this.now();
    const nextPolicyStage = policy.stages
      .filter((entry) => entry.order > stage.order)
      .sort((a, b) => a.order - b.order)[0];

    const outcome = await withTransaction(this.options.connection, async (session) => {
      const decision: ApprovalDecisionDocument = {
        decisionId: identifier('apd'),
        requestId,
        stageOrder: stage.order,
        kind,
        approverAccountId: authority.approverAccountId,
        effectiveApproverAccountId: actor.accountId,
        ...(authority.delegationId ? { onBehalfOfDelegationId: authority.delegationId } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
        selfApproved,
        decidedAt: now,
      };
      try {
        await this.decisions.create([decision], { session });
      } catch (error) {
        if (/E11000/.test(error instanceof Error ? error.message : '')) {
          // This approver already decided this stage.
          throw new NotEligibleApproverError('already-decided');
        }
        throw error;
      }

      const satisfied = kind === 'approved' ? stage.satisfied + 1 : stage.satisfied;
      const stageComplete = kind === 'approved' && satisfied >= stage.required;
      const requestComplete = stageComplete && !nextPolicyStage;

      let nextState: RequestState = current.state;
      let nextStageOrder = current.currentStageOrder;
      let pending = current.pendingApproverAccountIds;

      if (kind === 'rejected') {
        nextState = 'rejected';
        nextStageOrder = 0;
        pending = [];
      } else if (kind === 'returned') {
        nextState = 'returned';
        nextStageOrder = 0;
        pending = [];
      } else if (requestComplete) {
        nextState = 'approved';
        nextStageOrder = 0;
        pending = [];
      } else if (stageComplete && nextPolicyStage) {
        nextStageOrder = nextPolicyStage.order;
        pending = await this.resolveStageApprovers(
          nextPolicyStage.approvers as ApproverRule,
          current.scope,
          current.requesterAccountId,
        );
      }
      // A partial approval leaves the request pending: there is no transition to assert, and asserting
      // "pending -> pending" would refuse the second approval of a quorum stage.
      if (nextState !== current.state) assertTransition(current.state, nextState);

      const set: Record<string, unknown> = {
        state: nextState,
        currentStageOrder: nextStageOrder,
        pendingApproverAccountIds: pending,
        updatedAt: now,
        [`stages.${stage.order - 1}.satisfied`]: satisfied,
      };
      if (stageComplete || kind !== 'approved') {
        set[`stages.${stage.order - 1}.completedAt`] = now;
      }
      if (stageComplete && nextPolicyStage) {
        set[`stages.${nextPolicyStage.order - 1}.openedAt`] = now;
        if (nextPolicyStage.slaHours) {
          set[`stages.${nextPolicyStage.order - 1}.dueAt`] = plusHours(
            now,
            nextPolicyStage.slaHours,
          );
        }
      }
      if (nextState !== 'pending') set['decidedAt'] = now;

      // Compare-and-set: the version and the state the decision was made against must still hold.
      const updated = await this.requests
        .findOneAndUpdate(
          { requestId, version: current.version, state: 'pending' },
          { $set: set, $inc: { version: 1 } },
          { new: true, session },
        )
        .lean<ApprovalRequestDocument>()
        .exec();
      if (!updated) throw new ConcurrentDecisionError();

      const auditBase = {
        actor: this.auditActor(actor),
        target: { type: 'approvalRequest' as const, id: requestId },
        context,
      };
      await this.options.audit.record(
        {
          ...auditBase,
          action: APPROVAL_AUDIT_ACTIONS.decisionRecorded,
          outcome: 'succeeded',
          changes: [
            { path: 'stage', to: String(stage.order) },
            { path: 'decision', to: kind },
            { path: 'approverAccountId', to: authority.approverAccountId },
            ...(authority.delegationId
              ? [{ path: 'onBehalfOfDelegationId', to: authority.delegationId }]
              : []),
            ...(selfApproved ? [{ path: 'selfApproved', to: 'true' }] : []),
          ],
          ...(input.reason ? { reason: input.reason } : {}),
        },
        { session },
      );
      if (stageComplete) {
        await this.options.audit.record(
          {
            ...auditBase,
            action: APPROVAL_AUDIT_ACTIONS.stageCompleted,
            outcome: 'succeeded',
            changes: [{ path: 'stage', to: String(stage.order) }],
          },
          { session },
        );
      }
      if (stageComplete && nextPolicyStage) {
        await this.options.audit.record(
          {
            ...auditBase,
            action: APPROVAL_AUDIT_ACTIONS.stageOpened,
            outcome: 'succeeded',
            changes: [{ path: 'stage', to: String(nextPolicyStage.order) }],
          },
          { session },
        );
      }
      if (nextState !== 'pending') {
        const action =
          nextState === 'approved'
            ? APPROVAL_AUDIT_ACTIONS.requestApproved
            : nextState === 'rejected'
              ? APPROVAL_AUDIT_ACTIONS.requestRejected
              : APPROVAL_AUDIT_ACTIONS.requestReturned;
        await this.options.audit.record(
          {
            ...auditBase,
            action,
            outcome: 'succeeded',
            changes: [{ path: 'state', from: current.state, to: nextState }],
            ...(input.reason ? { reason: input.reason } : {}),
          },
          { session },
        );
      }

      return { updated, nextState, nextStageOrder, pending };
    });

    await this.emit({
      action: kind,
      requestId,
      state: outcome.nextState,
      stageOrder: outcome.nextStageOrder,
      pendingApproverAccountIds: outcome.pending,
      ...(outcome.updated?.requesterAccountId
        ? { requesterAccountId: outcome.updated.requesterAccountId }
        : {}),
      occurredAt: now,
    });

    const decisions = await this.decisions
      .find({ requestId })
      .sort({ stageOrder: 1, decidedAt: 1 })
      .lean<ApprovalDecisionDocument[]>()
      .exec();
    return restrictDocument('approvalRequest', actor, this.toRequest(outcome.updated, decisions));
  }

  /** An attempt against a terminal request is evidence too: it says someone tried. */
  private async recordInvalidTransition(
    actor: ActorContext,
    request: ApprovalRequestDocument,
    kind: DecisionKind,
    context: RequestContext,
  ): Promise<void> {
    await this.options.audit.record({
      action: APPROVAL_AUDIT_ACTIONS.invalidTransition,
      outcome: 'denied',
      actor: this.auditActor(actor),
      target: { type: 'approvalRequest', id: request.requestId },
      reason: `attempted ${kind} on a request in state ${request.state}`,
      context,
    });
  }

  /**
   * Cancel a request. The requester may always cancel their own; anyone else needs
   * `approval.request.cancel`, which the router checks before this runs.
   */
  async cancel(
    actor: ActorContext,
    requestId: string,
    reason: string,
    context: RequestContext,
  ): Promise<Partial<ApprovalRequest>> {
    const current = await this.requests
      .findOne(this.scopedFilter(actor, { requestId }))
      .lean<ApprovalRequestDocument>()
      .exec();
    if (!current) throw new RequestNotFoundError();
    if (current.state !== 'pending' && current.state !== 'returned') {
      await this.options.audit.record({
        action: APPROVAL_AUDIT_ACTIONS.invalidTransition,
        outcome: 'denied',
        actor: this.auditActor(actor),
        target: { type: 'approvalRequest', id: requestId },
        reason: `attempted cancel on a request in state ${current.state}`,
        context,
      });
      assertTransition(current.state, 'cancelled');
    }

    const now = this.now();
    const updated = await withTransaction(this.options.connection, async (session) => {
      const result = await this.requests
        .findOneAndUpdate(
          { requestId, version: current.version, state: current.state },
          {
            $set: {
              state: 'cancelled',
              currentStageOrder: 0,
              pendingApproverAccountIds: [],
              decidedAt: now,
              updatedAt: now,
            },
            $inc: { version: 1 },
          },
          { new: true, session },
        )
        .lean<ApprovalRequestDocument>()
        .exec();
      if (!result) throw new ConcurrentDecisionError();
      await this.options.audit.record(
        {
          action: APPROVAL_AUDIT_ACTIONS.requestCancelled,
          outcome: 'succeeded',
          actor: this.auditActor(actor),
          target: { type: 'approvalRequest', id: requestId },
          changes: [{ path: 'state', from: current.state, to: 'cancelled' }],
          reason,
          context,
        },
        { session },
      );
      return result;
    });

    await this.emit({
      action: APPROVAL_AUDIT_ACTIONS.requestCancelled,
      requestId,
      state: 'cancelled',
      stageOrder: 0,
      pendingApproverAccountIds: [],
      occurredAt: now,
    });
    return restrictDocument('approvalRequest', actor, this.toRequest(updated));
  }

  /** Resubmit a returned request unchanged, reopening the first stage. */
  async resubmit(
    actor: ActorContext,
    requestId: string,
    context: RequestContext,
  ): Promise<Partial<ApprovalRequest>> {
    const current = await this.requests
      .findOne(this.scopedFilter(actor, { requestId }))
      .lean<ApprovalRequestDocument>()
      .exec();
    if (!current) throw new RequestNotFoundError();
    if (current.requesterAccountId !== actor.accountId)
      throw new NotEligibleApproverError('not-eligible');
    assertTransition(current.state, 'pending');

    const policy = await this.policies
      .findOne({ key: current.policyKey, version: current.policyVersion })
      .lean<ApprovalPolicyDocument>()
      .exec();
    if (!policy) throw new PolicyNotFoundError();
    const firstStage = [...policy.stages].sort((a, b) => a.order - b.order)[0];
    if (!firstStage) throw new PolicyNotFoundError();

    const now = this.now();
    const approvers = await this.resolveStageApprovers(
      firstStage.approvers as ApproverRule,
      current.scope,
      current.requesterAccountId,
    );
    const updated = await withTransaction(this.options.connection, async (session) => {
      const result = await this.requests
        .findOneAndUpdate(
          { requestId, version: current.version, state: 'returned' },
          {
            $set: {
              state: 'pending',
              currentStageOrder: firstStage.order,
              pendingApproverAccountIds: approvers,
              // Earlier stages start again; the decisions that produced the return are kept forever.
              stages: current.stages.map((entry) => ({
                ...entry,
                satisfied: 0,
                openedAt: entry.order === firstStage.order ? now : entry.openedAt,
                ...(entry.order === firstStage.order && firstStage.slaHours
                  ? { dueAt: plusHours(now, firstStage.slaHours) }
                  : {}),
                completedAt: undefined,
                escalatedAt: undefined,
                escalatedToAccountId: undefined,
              })),
              updatedAt: now,
            },
            $unset: { decidedAt: '' },
            $inc: { version: 1 },
          },
          { new: true, session },
        )
        .lean<ApprovalRequestDocument>()
        .exec();
      if (!result) throw new ConcurrentDecisionError();
      await this.options.audit.record(
        {
          action: APPROVAL_AUDIT_ACTIONS.requestResubmitted,
          outcome: 'succeeded',
          actor: this.auditActor(actor),
          target: { type: 'approvalRequest', id: requestId },
          changes: [{ path: 'state', from: 'returned', to: 'pending' }],
          context,
        },
        { session },
      );
      return result;
    });
    return restrictDocument('approvalRequest', actor, this.toRequest(updated));
  }

  /* -------------------------------------------------- expiry and escalation */

  /** Expire undecided requests past their deadline. Idempotent: an expired request is skipped. */
  async expireOverdue(context: RequestContext, limit = 200): Promise<number> {
    const now = this.now();
    const due = await this.requests
      .find({ state: { $in: ['pending', 'returned'] }, expiresAt: { $lte: now } })
      .limit(limit)
      .lean<ApprovalRequestDocument[]>()
      .exec();

    let expired = 0;
    for (const request of due) {
      const changed = await withTransaction(this.options.connection, async (session) => {
        const result = await this.requests
          .findOneAndUpdate(
            { requestId: request.requestId, version: request.version, state: request.state },
            {
              $set: {
                state: 'expired',
                currentStageOrder: 0,
                pendingApproverAccountIds: [],
                decidedAt: now,
                updatedAt: now,
              },
              $inc: { version: 1 },
            },
            { new: true, session },
          )
          .lean<ApprovalRequestDocument>()
          .exec();
        if (!result) return false;
        await this.options.audit.record(
          {
            action: APPROVAL_AUDIT_ACTIONS.requestExpired,
            outcome: 'succeeded',
            actor: { kind: 'system', accountId: 'system:approval-expiry' },
            target: { type: 'approvalRequest', id: request.requestId },
            changes: [{ path: 'state', from: request.state, to: 'expired' }],
            context,
          },
          { session },
        );
        return true;
      });
      if (changed) expired += 1;
    }
    return expired;
  }

  /**
   * Escalate overdue stages to the requester's direct manager (`APPROVAL-005`).
   *
   * The manager is added to the pending approvers — **not** substituted for them: escalating must not
   * discard the decision that is still owed. Idempotent per stage: an already-escalated stage is skipped.
   *
   * With no manager resolver configured — the reporting line is `CORE-ORG`, Phase 2 — nothing is invented;
   * the stage is counted as unresolved and reported.
   */
  async escalateOverdue(
    actor: ActorContext,
    context: RequestContext,
    limit = 200,
  ): Promise<{ escalated: number; unresolved: number }> {
    const now = this.now();
    const overdue = await this.requests
      .find({
        state: 'pending',
        stages: {
          $elemMatch: {
            completedAt: { $exists: false },
            escalatedAt: { $exists: false },
            dueAt: { $lte: now },
          },
        },
      })
      .limit(limit)
      .lean<ApprovalRequestDocument[]>()
      .exec();

    let escalated = 0;
    let unresolved = 0;
    for (const request of overdue) {
      const stage = request.stages.find(
        (entry) =>
          entry.order === request.currentStageOrder &&
          !entry.completedAt &&
          !entry.escalatedAt &&
          entry.dueAt !== undefined &&
          entry.dueAt <= now,
      );
      if (!stage) continue;
      const manager = await this.options.resolveManager?.(request.requesterAccountId);
      if (!manager) {
        unresolved += 1;
        continue;
      }
      const changed = await withTransaction(this.options.connection, async (session) => {
        const result = await this.requests
          .findOneAndUpdate(
            { requestId: request.requestId, version: request.version, state: 'pending' },
            {
              $set: {
                [`stages.${stage.order - 1}.escalatedAt`]: now,
                [`stages.${stage.order - 1}.escalatedToAccountId`]: manager,
                updatedAt: now,
              },
              $addToSet: { pendingApproverAccountIds: manager },
              $inc: { version: 1 },
            },
            { new: true, session },
          )
          .lean<ApprovalRequestDocument>()
          .exec();
        if (!result) return false;
        await this.options.audit.record(
          {
            action: APPROVAL_AUDIT_ACTIONS.requestEscalated,
            outcome: 'succeeded',
            actor: this.auditActor(actor),
            target: { type: 'approvalRequest', id: request.requestId },
            changes: [
              { path: 'stage', to: String(stage.order) },
              { path: 'escalatedToAccountId', to: manager },
            ],
            reason: 'stage overdue',
            context,
          },
          { session },
        );
        return true;
      });
      if (changed) {
        escalated += 1;
        // Tell the manager, after the commit — the escalation stands whether or not anyone listens.
        await this.emit({
          action: APPROVAL_AUDIT_ACTIONS.requestEscalated,
          requestId: request.requestId,
          state: 'pending',
          stageOrder: stage.order,
          pendingApproverAccountIds: [manager],
          requesterAccountId: request.requesterAccountId,
          occurredAt: now,
        });
      }
    }
    return { escalated, unresolved };
  }

  /* ----------------------------------------------------------- reassignment */

  /**
   * Move a pending decision from one approver to another (`APPROVAL-007`).
   *
   * Used when an account is offboarded: its pending approvals must not stall. Decisions already recorded
   * are never touched — only who is *awaiting* — so history stays exactly as it happened.
   */
  async reassign(
    actor: ActorContext,
    options: { requestId?: string; fromAccountId: string; toAccountId: string; reason: string },
    context: RequestContext,
  ): Promise<{ reassigned: number }> {
    const filter: Record<string, unknown> = {
      state: 'pending',
      pendingApproverAccountIds: options.fromAccountId,
    };
    if (options.requestId) filter['requestId'] = options.requestId;

    const affected = await this.requests
      .find(this.scopedFilter(actor, filter))
      .lean<ApprovalRequestDocument[]>()
      .exec();
    if (options.requestId && affected.length === 0) throw new RequestNotFoundError();

    const now = this.now();
    let reassigned = 0;
    for (const request of affected) {
      const next = [
        ...new Set(
          request.pendingApproverAccountIds
            .filter((accountId) => accountId !== options.fromAccountId)
            .concat(options.toAccountId),
        ),
      ];
      const changed = await withTransaction(this.options.connection, async (session) => {
        const result = await this.requests
          .findOneAndUpdate(
            { requestId: request.requestId, version: request.version, state: 'pending' },
            { $set: { pendingApproverAccountIds: next, updatedAt: now }, $inc: { version: 1 } },
            { new: true, session },
          )
          .lean<ApprovalRequestDocument>()
          .exec();
        if (!result) return false;
        await this.options.audit.record(
          {
            action: APPROVAL_AUDIT_ACTIONS.requestReassigned,
            outcome: 'succeeded',
            actor: this.auditActor(actor),
            target: { type: 'approvalRequest', id: request.requestId },
            changes: [
              { path: 'pendingApprover', from: options.fromAccountId, to: options.toAccountId },
              { path: 'stage', to: String(request.currentStageOrder) },
            ],
            reason: options.reason,
            context,
          },
          { session },
        );
        return true;
      });
      if (changed) reassigned += 1;
    }
    return { reassigned };
  }

  /* -------------------------------------------------------------- delegation */

  /** Create a time-bounded delegation (`APPROVAL-004`). */
  async createDelegation(
    actor: ActorContext,
    input: {
      delegatorAccountId: string;
      delegateAccountId: string;
      policyKeys: string[];
      startsAt: string;
      endsAt: string;
      reason: string;
    },
    context: RequestContext,
  ): Promise<ApprovalDelegation> {
    const now = this.now();
    const active = await this.delegations
      .find({ revokedAt: { $exists: false }, endsAt: { $gt: now } })
      .lean<ApprovalDelegationDocument[]>()
      .exec();

    assertDelegationAllowed({
      delegatorAccountId: input.delegatorAccountId,
      delegateAccountId: input.delegateAccountId,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      now,
      active,
    });

    const document: ApprovalDelegationDocument = {
      delegationId: identifier('apg'),
      delegatorAccountId: input.delegatorAccountId,
      delegateAccountId: input.delegateAccountId,
      policyKeys: [...new Set(input.policyKeys)],
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      reason: input.reason,
      createdAt: now,
      createdBy: actor.accountId,
    };
    await this.delegations.create(document);

    await this.options.audit.record({
      action: APPROVAL_AUDIT_ACTIONS.delegationCreated,
      outcome: 'succeeded',
      actor: this.auditActor(actor),
      target: { type: 'approvalDelegation', id: document.delegationId },
      changes: [
        { path: 'delegatorAccountId', to: input.delegatorAccountId },
        { path: 'delegateAccountId', to: input.delegateAccountId },
        { path: 'endsAt', to: document.endsAt.toISOString() },
      ],
      reason: input.reason,
      context,
    });
    return this.toDelegation(document);
  }

  private toDelegation(document: ApprovalDelegationDocument): ApprovalDelegation {
    return ApprovalDelegationSchema.parse({
      delegationId: document.delegationId,
      delegatorAccountId: document.delegatorAccountId,
      delegateAccountId: document.delegateAccountId,
      policyKeys: document.policyKeys,
      startsAt: document.startsAt.toISOString(),
      endsAt: document.endsAt.toISOString(),
      reason: document.reason,
      ...(document.revokedAt ? { revokedAt: document.revokedAt.toISOString() } : {}),
      ...(document.revokedBy ? { revokedBy: document.revokedBy } : {}),
      createdAt: document.createdAt.toISOString(),
      createdBy: document.createdBy,
    });
  }

  /** Revoking takes effect immediately: the next decision attempt no longer finds an active delegation. */
  async revokeDelegation(
    actor: ActorContext,
    delegationId: string,
    context: RequestContext,
    options: { ownerAccountId?: string } = {},
  ): Promise<void> {
    const filter: Record<string, unknown> = { delegationId, revokedAt: { $exists: false } };
    if (options.ownerAccountId) filter['delegatorAccountId'] = options.ownerAccountId;
    const now = this.now();
    const revoked = await this.delegations
      .findOneAndUpdate(
        filter,
        { $set: { revokedAt: now, revokedBy: actor.accountId } },
        { new: true },
      )
      .lean<ApprovalDelegationDocument>()
      .exec();
    if (!revoked) throw new DelegationNotFoundError();

    await this.options.audit.record({
      action: APPROVAL_AUDIT_ACTIONS.delegationRevoked,
      outcome: 'succeeded',
      actor: this.auditActor(actor),
      target: { type: 'approvalDelegation', id: delegationId },
      changes: [{ path: 'revokedAt', to: now.toISOString() }],
      context,
    });
  }

  async listDelegations(filter: {
    delegatorAccountId?: string;
    delegateAccountId?: string;
  }): Promise<ApprovalDelegation[]> {
    const query: Record<string, unknown> = {};
    if (filter.delegatorAccountId) query['delegatorAccountId'] = filter.delegatorAccountId;
    if (filter.delegateAccountId) query['delegateAccountId'] = filter.delegateAccountId;
    const documents = await this.delegations
      .find(query)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean<ApprovalDelegationDocument[]>()
      .exec();
    return documents.map((document) => this.toDelegation(document));
  }
}
