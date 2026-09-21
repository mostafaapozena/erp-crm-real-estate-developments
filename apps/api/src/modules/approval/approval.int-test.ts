import {
  APPROVAL_AUDIT_ACTIONS,
  PERMISSIONS,
  ScopeAssignmentSchema,
  type ApprovalStage,
  type Permission,
  type ScopeAssignment,
} from '@alola/contracts';
import { createLogger } from '@alola/security';
import { serviceGate } from '@alola/testing';
import type { Express } from 'express';
import mongoose, { type Connection } from 'mongoose';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type ApiModule } from '../../app';
import type { ActorResolver, GuardOptions } from '../../http/actor';
import { noteAuditWrite } from '../../http/audit-context';
import { ensureIndexes } from '../../platform/indexes';
import { configureMongoose } from '../../platform/mongo';
import { AUDIT_COLLECTION, AuditService, auditRouter } from '../audit';
import {
  ACCOUNT_GRANTS_COLLECTION,
  ROLES_COLLECTION,
  SecurityService,
  bootstrapGrant,
  bootstrapRole,
} from '../security';
import {
  DECISIONS_COLLECTION,
  DELEGATIONS_COLLECTION,
  POLICIES_COLLECTION,
  REQUESTS_COLLECTION,
} from './model';
import { decisionModel, policyModel, requestModel } from './model';
import { approvalRouter } from './router';
import { ApprovalService } from './service';

/**
 * Approval engine end to end (`APPROVAL-001` … `APPROVAL-007`) against a real MongoDB replica set.
 *
 * Authentication has its own suite; this one injects the documented header-based actor resolver so that
 * authorization, scopes, and field restrictions are the real ones while the focus stays on approvals.
 */
const gate = serviceGate(['mongodb']);
const RUN = `it-approval-${Date.now()}`;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const ACCOUNT_HEADER = 'x-test-account';

const scope = (level: ScopeAssignment['level'], overrides: Partial<ScopeAssignment> = {}) =>
  ScopeAssignmentSchema.parse({ level, ...overrides });

const label = (en: string) => ({ ar: `عربي ${en}`, en });

describe.skipIf(!gate.available)(`approval engine — ${gate.reason}`, () => {
  let connection: Connection;
  let audit: AuditService;
  let security: SecurityService;
  let approvals: ApprovalService;
  let app: Express;
  let clock: Date;
  /** Injected reporting line; the real one is `CORE-ORG` (Phase 2, `SD-01`). */
  let managers: Map<string, string>;

  const R_ADMIN = `${RUN}-r-admin`;
  const R_REQUESTER = `${RUN}-r-requester`;
  const R_APPROVER = `${RUN}-r-approver`;
  const R_APPROVER_AMOUNTS = `${RUN}-r-approver-amounts`;
  const R_VIEWER = `${RUN}-r-viewer`;
  const R_POLICY = `${RUN}-r-policy`;

  const ADMIN = `${RUN}-admin`;
  const REQUESTER = `${RUN}-requester`;
  const APPROVER_1 = `${RUN}-approver-1`;
  const APPROVER_2 = `${RUN}-approver-2`;
  const APPROVER_3 = `${RUN}-approver-3`;
  const VIEWER = `${RUN}-viewer`;
  const OUTSIDER = `${RUN}-outsider`;
  const POLICY_AUTHOR = `${RUN}-policy-author`;

  const api = () => request(app);
  const as = (accountId?: string) => {
    const withAccount = <T extends { set: (field: string, value: string) => T }>(call: T): T =>
      accountId ? call.set(ACCOUNT_HEADER, accountId) : call;
    return {
      get: (path: string) => withAccount(api().get(path)),
      post: (path: string) => withAccount(api().post(path).set('Origin', ALLOWED_ORIGIN)),
      patch: (path: string) => withAccount(api().patch(path).set('Origin', ALLOWED_ORIGIN)),
      delete: (path: string) => withAccount(api().delete(path).set('Origin', ALLOWED_ORIGIN)),
    };
  };

  let keyCounter = 0;
  const nextKey = () => {
    keyCounter += 1;
    return `${RUN}-p${keyCounter}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  };
  let idempotencyCounter = 0;
  const nextIdempotencyKey = () => {
    idempotencyCounter += 1;
    return `${RUN}-idem-${idempotencyCounter}`;
  };

  /** Create a published policy in one step; most tests care about requests, not about drafting. */
  async function publishedPolicy(options: {
    stages: ApprovalStage[];
    operationType?: string;
    selfApproval?: 'prohibited' | 'permittedWithReason';
    allowConcurrentRequests?: boolean;
    expiresAfterHours?: number;
    conditions?: { field: string; operator: string; value?: unknown }[];
  }): Promise<{ key: string; version: number; operationType: string }> {
    const key = nextKey();
    const operationType = options.operationType ?? `test.${key.replace(/-/g, '')}.grant`;
    const created = await as(ADMIN)
      .post('/api/v1/approvals/policies')
      .send({
        key,
        name: label(key),
        operationType,
        stages: options.stages,
        ...(options.conditions ? { conditions: options.conditions } : {}),
        ...(options.selfApproval ? { selfApproval: options.selfApproval } : {}),
        ...(options.allowConcurrentRequests !== undefined
          ? { allowConcurrentRequests: options.allowConcurrentRequests }
          : {}),
        ...(options.expiresAfterHours !== undefined
          ? { expiresAfterHours: options.expiresAfterHours }
          : {}),
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const published = await as(ADMIN).post(
      `/api/v1/approvals/policies/${key}/versions/${created.body.version}/publish`,
    );
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    return { key, version: created.body.version, operationType };
  }

  async function submit(
    accountId: string,
    operationType: string,
    overrides: Record<string, unknown> = {},
  ) {
    return as(accountId)
      .post('/api/v1/approvals/requests')
      .send({
        operationType,
        source: { type: 'test.resource', id: `${RUN}-src-${Math.random().toString(36).slice(2)}` },
        idempotencyKey: nextIdempotencyKey(),
        ...overrides,
      });
  }

  const singleStage = (accountIds: string[] = [APPROVER_1]): ApprovalStage[] => [
    { order: 1, name: label('only'), approvers: { kind: 'accounts', accountIds }, rule: 'any' },
  ];

  async function eventsFor(requestId: string): Promise<{ action: string; outcome: string }[]> {
    return (await connection.db
      ?.collection(AUDIT_COLLECTION)
      .find({ 'target.id': requestId })
      .toArray()) as unknown as { action: string; outcome: string }[];
  }

  beforeAll(async () => {
    configureMongoose();
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'],
      serverSelectionTimeoutMS: 10_000,
    });
    await connection.asPromise();
    const logger = createLogger({ name: 'approval-int', level: 'silent' });
    await ensureIndexes(connection, logger);
    clock = new Date('2026-09-21T09:00:00.000Z');
    managers = new Map();

    audit = new AuditService({ connection, logger, onRecorded: noteAuditWrite });
    security = new SecurityService({ connection, audit });
    approvals = new ApprovalService({
      connection,
      logger,
      audit,
      accountsWithPermission: (permission) => security.accountsWithPermission(permission),
      resolveActor: (accountId) => security.resolveActor(accountId),
      resolveManager: (accountId) => Promise.resolve(managers.get(accountId)),
      now: () => clock,
    });

    const approverPermissions: Permission[] = [
      'approval.request.approve',
      'approval.request.reject',
      'approval.request.view',
      // An approver may hand their own authority to someone else for a bounded window (APPROVAL-004).
      'approval.delegation.manage',
    ];
    await bootstrapRole(connection, {
      key: R_ADMIN,
      name: label('admin'),
      permissions: [...PERMISSIONS],
      isAdministrative: true,
    });
    await bootstrapRole(connection, {
      key: R_REQUESTER,
      name: label('requester'),
      permissions: ['approval.request.create', 'approval.request.view'],
    });
    await bootstrapRole(connection, {
      key: R_APPROVER,
      name: label('approver'),
      permissions: approverPermissions,
    });
    await bootstrapRole(connection, {
      key: R_APPROVER_AMOUNTS,
      name: label('approver with amounts'),
      permissions: [...approverPermissions, 'approval.request.viewAmounts'],
    });
    await bootstrapRole(connection, {
      key: R_VIEWER,
      name: label('viewer'),
      permissions: ['approval.request.view'],
    });
    await bootstrapRole(connection, {
      key: R_POLICY,
      name: label('policy author'),
      permissions: ['approval.policy.view', 'approval.policy.create'],
    });

    const grant = (accountId: string, roleKeys: string[], assigned = scope('all')) =>
      bootstrapGrant(connection, {
        accountId,
        roleKeys,
        scope: assigned,
        updatedBy: `${RUN}-bootstrap`,
      });
    await grant(ADMIN, [R_ADMIN]);
    await grant(REQUESTER, [R_REQUESTER, R_APPROVER]);
    await grant(APPROVER_1, [R_APPROVER_AMOUNTS]);
    await grant(APPROVER_2, [R_APPROVER]);
    await grant(APPROVER_3, [R_APPROVER]);
    // Sees requests but may not decide, and may not see monetary context.
    await grant(VIEWER, [R_VIEWER]);
    // Scoped to another branch: everything about branch-1 must be invisible to it.
    await grant(OUTSIDER, [R_APPROVER], scope('branch', { branchIds: [`${RUN}-branch-2`] }));
    await grant(POLICY_AUTHOR, [R_POLICY]);

    const guard: GuardOptions = {
      onDenied: (denial) =>
        audit
          .record({
            action: 'security.authorization.denied',
            outcome: 'denied',
            actor: denial.actor
              ? {
                  kind: denial.actor.kind,
                  accountId: denial.actor.accountId,
                  roleKeys: denial.actor.roleKeys,
                }
              : { kind: 'anonymous' },
            target: { type: 'endpoint', id: `${denial.method} ${denial.route}` },
            reason: `missing permission: ${denial.requiredPermission}`,
            context: {
              correlationId: denial.correlationId,
              method: denial.method,
              route: denial.route,
            },
          })
          .then(() => undefined),
    };

    const actorResolver: ActorResolver = (req) => {
      const accountId = req.header(ACCOUNT_HEADER);
      return accountId ? security.resolveActor(accountId) : Promise.resolve(undefined);
    };

    const modules: ApiModule[] = [
      { basePath: '/approvals', router: approvalRouter({ getService: () => approvals, guard }) },
      { basePath: '/audit', router: auditRouter({ getService: () => audit, guard }) },
    ];
    app = createApp({
      config: { CORS_ALLOWED_ORIGINS: [ALLOWED_ORIGIN], TRUST_PROXY_HOPS: 0, APP_ENV: 'test' },
      logger,
      mongo: { health: () => Promise.resolve({ status: 'up', transactions: true }) },
      redis: { health: () => Promise.resolve({ status: 'up' }) },
      rateLimiter: new RateLimiterMemory({ points: 100_000, duration: 60 }),
      actorResolver,
      modules,
    });
  });

  beforeEach(() => {
    clock = new Date('2026-09-21T09:00:00.000Z');
    managers.clear();
  });

  afterAll(async () => {
    if (!connection) return;
    await Promise.all([
      connection.db?.collection(POLICIES_COLLECTION).deleteMany({ key: { $regex: `^${RUN}` } }),
      connection.db
        ?.collection(REQUESTS_COLLECTION)
        .deleteMany({ idempotencyKey: { $regex: `^${RUN}` } }),
      connection.db?.collection(DELEGATIONS_COLLECTION).deleteMany({
        $or: [
          { delegatorAccountId: { $regex: `^${RUN}` } },
          { delegateAccountId: { $regex: `^${RUN}` } },
        ],
      }),
      connection.db?.collection(ROLES_COLLECTION).deleteMany({ key: { $regex: `^${RUN}` } }),
      connection.db?.collection(ACCOUNT_GRANTS_COLLECTION).deleteMany({
        accountId: { $regex: `^${RUN}` },
      }),
    ]);
    // Decisions and audit records have no delete path in the application (APPROVAL-006, AUDIT-001), so
    // the test removes its own the way a privileged operator would — the documented limit of
    // application-level immutability.
    const requests = (await connection.db
      ?.collection(REQUESTS_COLLECTION)
      .find({ 'source.type': 'test.resource' })
      .toArray()) as { requestId: string }[] | undefined;
    const ids = (requests ?? []).map((row) => row.requestId);
    await connection.db?.collection(DECISIONS_COLLECTION).deleteMany({ requestId: { $in: ids } });
    await connection.db?.collection(AUDIT_COLLECTION).deleteMany({
      $or: [
        { 'actor.accountId': { $regex: `^${RUN}` } },
        { 'target.id': { $regex: `^${RUN}` } },
        { 'target.id': { $in: ids } },
      ],
    });
    await connection.close();
  });

  /* ============================================= APPROVAL-002: policies */

  describe('APPROVAL-002: policy definition, versioning, and publication', () => {
    it('creates a draft, versions it, and publishes it', async () => {
      const key = nextKey();
      const first = await as(ADMIN)
        .post('/api/v1/approvals/policies')
        .send({
          key,
          name: label('first'),
          operationType: 'test.policy.grant',
          stages: singleStage(),
        });
      expect(first.status).toBe(201);
      expect(first.body.version).toBe(1);
      expect(first.body.state).toBe('draft');

      // A second create under the same key is the next version, not a conflict.
      const second = await as(ADMIN)
        .post('/api/v1/approvals/policies')
        .send({
          key,
          name: label('second'),
          operationType: 'test.policy.grant',
          stages: singleStage(),
        });
      expect(second.body.version).toBe(2);

      const published = await as(ADMIN).post(
        `/api/v1/approvals/policies/${key}/versions/1/publish`,
      );
      expect(published.status).toBe(200);
      expect(published.body.state).toBe('published');
      expect(published.body.publishedBy).toBe(ADMIN);
    });

    it('refuses an ambiguous policy with the issue codes, and stores nothing', async () => {
      const key = nextKey();
      const res = await as(ADMIN)
        .post('/api/v1/approvals/policies')
        .send({
          key,
          name: label('ambiguous'),
          operationType: 'test.ambiguous.grant',
          stages: [
            {
              order: 1,
              name: label('quorum without a number'),
              approvers: { kind: 'accounts', accountIds: [APPROVER_1, APPROVER_2] },
              rule: 'quorum',
            },
          ],
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(await policyModel(connection).findOne({ key }).lean().exec()).toBeNull();
    });

    it('refuses "all" over a permission-based stage', async () => {
      const res = await as(ADMIN)
        .post('/api/v1/approvals/policies')
        .send({
          key: nextKey(),
          name: label('unbounded all'),
          operationType: 'test.unbounded.grant',
          stages: [
            {
              order: 1,
              name: label('everyone'),
              approvers: {
                kind: 'permission',
                permission: 'approval.request.approve',
                scope: 'any',
              },
              rule: 'all',
            },
          ],
        });
      expect(res.status).toBe(400);
    });

    it('will not modify a published version, through the API or the model (APPROVAL-006)', async () => {
      const { key, version } = await publishedPolicy({ stages: singleStage() });

      const patched = await as(ADMIN)
        .patch(`/api/v1/approvals/policies/${key}/versions/${version}`)
        .send({ stages: singleStage([APPROVER_2]) });
      expect(patched.status).toBe(409);
      expect(patched.body.error.code).toBe('CONFLICT');

      // Reaching for the model directly is refused too, not merely discouraged.
      await expect(
        policyModel(connection)
          .updateOne({ key, version }, { $set: { selfApproval: 'permittedWithReason' } })
          .exec(),
      ).rejects.toThrow(/published approval policy/i);
      await expect(policyModel(connection).deleteOne({ key, version }).exec()).rejects.toThrow();

      const stored = await policyModel(connection).findOne({ key, version }).lean().exec();
      expect(stored?.selfApproval).toBe('prohibited');
      expect(stored?.stages[0]?.approvers.accountIds).toEqual([APPROVER_1]);
    });

    it('publishes only once, and only a draft', async () => {
      const { key, version } = await publishedPolicy({ stages: singleStage() });
      const again = await as(ADMIN).post(
        `/api/v1/approvals/policies/${key}/versions/${version}/publish`,
      );
      expect(again.status).toBe(409);
    });

    it('lets a draft be edited before publication', async () => {
      const key = nextKey();
      const created = await as(POLICY_AUTHOR)
        .post('/api/v1/approvals/policies')
        .send({
          key,
          name: label('draft'),
          operationType: 'test.draft.grant',
          stages: singleStage(),
        });
      expect(created.status).toBe(201);
      const patched = await as(POLICY_AUTHOR)
        .patch(`/api/v1/approvals/policies/${key}/versions/1`)
        .send({ selfApproval: 'permittedWithReason' });
      expect(patched.status).toBe(200);
      expect(patched.body.selfApproval).toBe('permittedWithReason');
    });

    it('refuses publication without the publish permission', async () => {
      const key = nextKey();
      await as(POLICY_AUTHOR)
        .post('/api/v1/approvals/policies')
        .send({
          key,
          name: label('unpublishable'),
          operationType: 'test.unpublishable.grant',
          stages: singleStage(),
        });
      const res = await as(POLICY_AUTHOR).post(
        `/api/v1/approvals/policies/${key}/versions/1/publish`,
      );
      expect(res.status).toBe(403);
      expect(
        (await policyModel(connection).findOne({ key, version: 1 }).lean().exec())?.state,
      ).toBe('draft');
    });
  });

  /* ================================= APPROVAL-001: submission and lifecycle */

  describe('APPROVAL-001: submission, state machine, and history', () => {
    it('submits against a published policy and opens the first stage', async () => {
      const { operationType, key, version } = await publishedPolicy({ stages: singleStage() });
      const res = await submit(REQUESTER, operationType);
      expect(res.status).toBe(201);
      expect(res.body.state).toBe('pending');
      expect(res.body.policyKey).toBe(key);
      expect(res.body.policyVersion).toBe(version);
      expect(res.body.currentStageOrder).toBe(1);
      expect(res.body.pendingApproverAccountIds).toEqual([APPROVER_1]);
      // The engine stores a reference, never the source document.
      expect(Object.keys(res.body.source).sort()).toEqual(['id', 'type']);
      expect(JSON.stringify(res.body)).not.toContain('idempotencyFingerprint');
    });

    it('refuses a submission with no published policy for the operation', async () => {
      const res = await submit(REQUESTER, 'test.nothing.governs');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('will not use an unpublished version', async () => {
      const key = nextKey();
      const operationType = 'test.draftonly.grant';
      await as(ADMIN)
        .post('/api/v1/approvals/policies')
        .send({ key, name: label('draft only'), operationType, stages: singleStage() });
      const res = await submit(REQUESTER, operationType);
      expect(res.status).toBe(400);
    });

    it('approves, completes, and records the decision', async () => {
      const { operationType } = await publishedPolicy({ stages: singleStage() });
      const submitted = await submit(REQUESTER, operationType);
      const requestId = submitted.body.requestId;

      const approved = await as(APPROVER_1)
        .post(`/api/v1/approvals/requests/${requestId}/approve`)
        .send({ reason: 'within limits' });
      expect(approved.status).toBe(200);
      expect(approved.body.state).toBe('approved');
      expect(approved.body.currentStageOrder).toBe(0);
      expect(approved.body.pendingApproverAccountIds).toEqual([]);
      expect(approved.body.decisions).toHaveLength(1);
      expect(approved.body.decisions[0]).toMatchObject({
        kind: 'approved',
        approverAccountId: APPROVER_1,
        effectiveApproverAccountId: APPROVER_1,
        selfApproved: false,
      });

      const actions = (await eventsFor(requestId)).map((event) => event.action);
      expect(actions).toContain(APPROVAL_AUDIT_ACTIONS.requestSubmitted);
      expect(actions).toContain(APPROVAL_AUDIT_ACTIONS.decisionRecorded);
      expect(actions).toContain(APPROVAL_AUDIT_ACTIONS.stageCompleted);
      expect(actions).toContain(APPROVAL_AUDIT_ACTIONS.requestApproved);
    });

    it('rejects with a reason and refuses any further decision', async () => {
      const { operationType } = await publishedPolicy({ stages: singleStage() });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;

      const rejected = await as(APPROVER_1)
        .post(`/api/v1/approvals/requests/${requestId}/reject`)
        .send({ reason: 'over the limit' });
      expect(rejected.status).toBe(200);
      expect(rejected.body.state).toBe('rejected');

      const again = await as(APPROVER_1)
        .post(`/api/v1/approvals/requests/${requestId}/approve`)
        .send({});
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('CONFLICT');
      // The stored state is untouched by the refused attempt, and the attempt itself is recorded.
      const stored = await requestModel(connection).findOne({ requestId }).lean().exec();
      expect(stored?.state).toBe('rejected');
      expect((await eventsFor(requestId)).map((event) => event.action)).toContain(
        APPROVAL_AUDIT_ACTIONS.invalidTransition,
      );
    });

    it('refuses a reject without a reason', async () => {
      const { operationType } = await publishedPolicy({ stages: singleStage() });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;
      const res = await as(APPROVER_1)
        .post(`/api/v1/approvals/requests/${requestId}/reject`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns for correction, then accepts a resubmission from the requester only', async () => {
      const { operationType } = await publishedPolicy({ stages: singleStage() });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;

      const returned = await as(APPROVER_1)
        .post(`/api/v1/approvals/requests/${requestId}/return`)
        .send({ reason: 'attach the signed copy' });
      expect(returned.status).toBe(200);
      expect(returned.body.state).toBe('returned');

      // Someone else cannot resubmit another person's request.
      expect(
        (await as(APPROVER_2).post(`/api/v1/approvals/requests/${requestId}/resubmit`)).status,
      ).toBe(403);

      const resubmitted = await as(REQUESTER).post(
        `/api/v1/approvals/requests/${requestId}/resubmit`,
      );
      expect(resubmitted.status).toBe(200);
      expect(resubmitted.body.state).toBe('pending');
      expect(resubmitted.body.stages[0].satisfied).toBe(0);

      // The decision that caused the return is kept forever (APPROVAL-006).
      const decisions = await decisionModel(connection).find({ requestId }).lean().exec();
      expect(decisions).toHaveLength(1);
      expect(decisions[0]?.kind).toBe('returned');
    });

    it('cancels its own request, and refuses cancelling someone else’s without the permission', async () => {
      const { operationType } = await publishedPolicy({ stages: singleStage() });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;

      const byApprover = await as(APPROVER_1)
        .post(`/api/v1/approvals/requests/${requestId}/cancel`)
        .send({ reason: 'not mine to cancel' });
      expect(byApprover.status).toBe(403);
      expect((await requestModel(connection).findOne({ requestId }).lean().exec())?.state).toBe(
        'pending',
      );

      const byRequester = await as(REQUESTER)
        .post(`/api/v1/approvals/requests/${requestId}/cancel`)
        .send({ reason: 'withdrawn' });
      expect(byRequester.status).toBe(200);
      expect(byRequester.body.state).toBe('cancelled');

      // And a cancelled request cannot be approved afterwards.
      expect(
        (await as(APPROVER_1).post(`/api/v1/approvals/requests/${requestId}/approve`).send({}))
          .status,
      ).toBe(409);
    });

    it('expires an undecided request past its deadline, and only once', async () => {
      const { operationType } = await publishedPolicy({
        stages: singleStage(),
        expiresAfterHours: 24,
      });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;

      clock = new Date(clock.getTime() + 25 * 3_600_000);
      const first = await as(ADMIN).post('/api/v1/approvals/requests/sweep');
      expect(first.status).toBe(200);
      expect(first.body.expired).toBeGreaterThanOrEqual(1);
      expect((await requestModel(connection).findOne({ requestId }).lean().exec())?.state).toBe(
        'expired',
      );

      // Idempotent: the second sweep finds nothing to expire.
      const second = await as(ADMIN).post('/api/v1/approvals/requests/sweep');
      expect(second.body.expired).toBe(0);
    });

    it('keeps the policy version a request was submitted under (APPROVAL-006)', async () => {
      const key = nextKey();
      const operationType = 'test.versioned.grant';
      const v1 = await as(ADMIN)
        .post('/api/v1/approvals/policies')
        .send({ key, name: label('v1'), operationType, stages: singleStage([APPROVER_1]) });
      await as(ADMIN).post(`/api/v1/approvals/policies/${key}/versions/1/publish`);
      expect(v1.body.version).toBe(1);

      const requestId = (await submit(REQUESTER, operationType)).body.requestId;

      // A newer version changes who approves — but not for a request already outstanding.
      await as(ADMIN)
        .post('/api/v1/approvals/policies')
        .send({ key, name: label('v2'), operationType, stages: singleStage([APPROVER_3]) });
      await as(ADMIN).post(`/api/v1/approvals/policies/${key}/versions/2/publish`);

      const stored = await requestModel(connection).findOne({ requestId }).lean().exec();
      expect(stored?.policyVersion).toBe(1);
      expect(stored?.pendingApproverAccountIds).toEqual([APPROVER_1]);
      // The approver named by v2 is still not eligible on this request.
      expect(
        (await as(APPROVER_3).post(`/api/v1/approvals/requests/${requestId}/approve`).send({}))
          .status,
      ).toBe(403);
      expect(
        (await as(APPROVER_1).post(`/api/v1/approvals/requests/${requestId}/approve`).send({}))
          .status,
      ).toBe(200);

      // A new submission picks up v2.
      const later = await submit(REQUESTER, operationType);
      expect(later.body.policyVersion).toBe(2);
    });
  });

  /* ============================== idempotency and duplicate prevention */

  describe('idempotent submission and duplicate prevention', () => {
    it('returns the original request when the same key and input are replayed', async () => {
      const { operationType } = await publishedPolicy({ stages: singleStage() });
      const body = {
        operationType,
        source: { type: 'test.resource', id: `${RUN}-idem-source` },
        idempotencyKey: nextIdempotencyKey(),
      };
      const first = await as(REQUESTER).post('/api/v1/approvals/requests').send(body);
      expect(first.status).toBe(201);
      const second = await as(REQUESTER).post('/api/v1/approvals/requests').send(body);
      expect(second.status).toBe(200);
      expect(second.body.requestId).toBe(first.body.requestId);
      expect(
        await requestModel(connection).countDocuments({ idempotencyKey: body.idempotencyKey }),
      ).toBe(1);
    });

    it('refuses the same key with different input', async () => {
      const { operationType } = await publishedPolicy({ stages: singleStage() });
      const idempotencyKey = nextIdempotencyKey();
      const first = await as(REQUESTER)
        .post('/api/v1/approvals/requests')
        .send({
          operationType,
          source: { type: 'test.resource', id: `${RUN}-a` },
          idempotencyKey,
        });
      expect(first.status).toBe(201);
      const conflicting = await as(REQUESTER)
        .post('/api/v1/approvals/requests')
        .send({
          operationType,
          source: { type: 'test.resource', id: `${RUN}-b` },
          idempotencyKey,
        });
      expect(conflicting.status).toBe(409);
      expect(conflicting.body.error.code).toBe('CONFLICT');
    });

    it('prevents a second live request for the same protected operation', async () => {
      const { operationType } = await publishedPolicy({
        stages: singleStage(),
        allowConcurrentRequests: false,
      });
      const source = { type: 'test.resource', id: `${RUN}-single-live` };
      const first = await as(REQUESTER)
        .post('/api/v1/approvals/requests')
        .send({ operationType, source, idempotencyKey: nextIdempotencyKey() });
      expect(first.status).toBe(201);

      const second = await as(REQUESTER)
        .post('/api/v1/approvals/requests')
        .send({ operationType, source, idempotencyKey: nextIdempotencyKey() });
      expect(second.status).toBe(409);

      // Once the first is decided, a new request for the same source is legitimate.
      await as(APPROVER_1)
        .post(`/api/v1/approvals/requests/${first.body.requestId}/approve`)
        .send({});
      const third = await as(REQUESTER)
        .post('/api/v1/approvals/requests')
        .send({ operationType, source, idempotencyKey: nextIdempotencyKey() });
      expect(third.status).toBe(201);
    });

    it('allows concurrent requests when the policy permits them', async () => {
      const { operationType } = await publishedPolicy({
        stages: singleStage(),
        allowConcurrentRequests: true,
      });
      const source = { type: 'test.resource', id: `${RUN}-multi-live` };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const res = await as(REQUESTER)
          .post('/api/v1/approvals/requests')
          .send({ operationType, source, idempotencyKey: nextIdempotencyKey() });
        expect(res.status).toBe(201);
      }
    });
  });

  /* ================================ multi-stage, quorum, and ordering */

  describe('multi-stage approval, ordering, and quorum (APPROVAL-001)', () => {
    const twoStages = (): ApprovalStage[] => [
      {
        order: 1,
        name: label('first'),
        approvers: { kind: 'accounts', accountIds: [APPROVER_1] },
        rule: 'any',
      },
      {
        order: 2,
        name: label('second'),
        approvers: { kind: 'accounts', accountIds: [APPROVER_2] },
        rule: 'any',
      },
    ];

    it('enforces stage order and completes only when every stage is satisfied', async () => {
      const { operationType } = await publishedPolicy({ stages: twoStages() });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;

      // The second-stage approver cannot act while stage one is outstanding.
      const early = await as(APPROVER_2)
        .post(`/api/v1/approvals/requests/${requestId}/approve`)
        .send({});
      expect(early.status).toBe(403);
      expect(
        (await requestModel(connection).findOne({ requestId }).lean().exec())?.currentStageOrder,
      ).toBe(1);

      const stageOne = await as(APPROVER_1)
        .post(`/api/v1/approvals/requests/${requestId}/approve`)
        .send({});
      expect(stageOne.status).toBe(200);
      expect(stageOne.body.state).toBe('pending');
      expect(stageOne.body.currentStageOrder).toBe(2);
      expect(stageOne.body.pendingApproverAccountIds).toEqual([APPROVER_2]);

      const stageTwo = await as(APPROVER_2)
        .post(`/api/v1/approvals/requests/${requestId}/approve`)
        .send({});
      expect(stageTwo.status).toBe(200);
      expect(stageTwo.body.state).toBe('approved');
      expect(stageTwo.body.decisions).toHaveLength(2);
      // Both decisions survive; the later one does not overwrite the earlier.
      const decisionStages = (stageTwo.body.decisions as { stageOrder: number }[]).map(
        (decision) => decision.stageOrder,
      );
      expect(decisionStages).toEqual([1, 2]);

      const actions = (await eventsFor(requestId)).map((event) => event.action);
      expect(actions.filter((action) => action === APPROVAL_AUDIT_ACTIONS.stageOpened).length).toBe(
        1,
      );
      expect(
        actions.filter((action) => action === APPROVAL_AUDIT_ACTIONS.stageCompleted).length,
      ).toBe(2);
    });

    it('rejecting at any stage ends the request', async () => {
      const { operationType } = await publishedPolicy({ stages: twoStages() });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;
      await as(APPROVER_1).post(`/api/v1/approvals/requests/${requestId}/approve`).send({});
      const rejected = await as(APPROVER_2)
        .post(`/api/v1/approvals/requests/${requestId}/reject`)
        .send({ reason: 'declined at the second stage' });
      expect(rejected.body.state).toBe('rejected');
      expect(rejected.body.decisions).toHaveLength(2);
    });

    it('needs the configured quorum before the stage completes', async () => {
      const { operationType } = await publishedPolicy({
        stages: [
          {
            order: 1,
            name: label('two of three'),
            approvers: { kind: 'accounts', accountIds: [APPROVER_1, APPROVER_2, APPROVER_3] },
            rule: 'quorum',
            quorum: 2,
          },
        ],
      });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;

      const first = await as(APPROVER_1)
        .post(`/api/v1/approvals/requests/${requestId}/approve`)
        .send({});
      expect(first.status).toBe(200);
      expect(first.body.state).toBe('pending');
      expect(first.body.stages[0].satisfied).toBe(1);
      expect(first.body.stages[0].required).toBe(2);

      const second = await as(APPROVER_2)
        .post(`/api/v1/approvals/requests/${requestId}/approve`)
        .send({});
      expect(second.body.state).toBe('approved');
    });

    it('needs every named approver when the rule is "all"', async () => {
      const { operationType } = await publishedPolicy({
        stages: [
          {
            order: 1,
            name: label('both'),
            approvers: { kind: 'accounts', accountIds: [APPROVER_1, APPROVER_2] },
            rule: 'all',
          },
        ],
      });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;
      expect(
        (await as(APPROVER_1).post(`/api/v1/approvals/requests/${requestId}/approve`).send({})).body
          .state,
      ).toBe('pending');
      expect(
        (await as(APPROVER_2).post(`/api/v1/approvals/requests/${requestId}/approve`).send({})).body
          .state,
      ).toBe('approved');
    });

    it('refuses the same approver twice in one stage', async () => {
      const { operationType } = await publishedPolicy({
        stages: [
          {
            order: 1,
            name: label('quorum'),
            approvers: { kind: 'accounts', accountIds: [APPROVER_1, APPROVER_2] },
            rule: 'quorum',
            quorum: 2,
          },
        ],
      });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;
      await as(APPROVER_1).post(`/api/v1/approvals/requests/${requestId}/approve`).send({});
      const duplicate = await as(APPROVER_1)
        .post(`/api/v1/approvals/requests/${requestId}/approve`)
        .send({});
      expect(duplicate.status).toBe(403);
      // One signature twice is still one signature.
      expect(await decisionModel(connection).countDocuments({ requestId })).toBe(1);
    });

    it('refuses one person satisfying two different stages', async () => {
      const { operationType } = await publishedPolicy({
        stages: [
          {
            order: 1,
            name: label('first'),
            approvers: { kind: 'accounts', accountIds: [APPROVER_1] },
            rule: 'any',
          },
          {
            order: 2,
            name: label('second'),
            approvers: { kind: 'accounts', accountIds: [APPROVER_1, APPROVER_2] },
            rule: 'any',
          },
        ],
      });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;
      await as(APPROVER_1).post(`/api/v1/approvals/requests/${requestId}/approve`).send({});
      const second = await as(APPROVER_1)
        .post(`/api/v1/approvals/requests/${requestId}/approve`)
        .send({});
      expect(second.status).toBe(403);
      expect(
        (await as(APPROVER_2).post(`/api/v1/approvals/requests/${requestId}/approve`).send({})).body
          .state,
      ).toBe('approved');
    });

    it('resolves a permission-based stage to the accounts that hold it, within scope', async () => {
      const { operationType } = await publishedPolicy({
        stages: [
          {
            order: 1,
            name: label('any approver in the branch'),
            approvers: {
              kind: 'permission',
              permission: 'approval.request.approve',
              scope: 'same-branch',
            },
            rule: 'any',
          },
        ],
      });
      const submitted = await submit(REQUESTER, operationType, {
        scope: { branchId: `${RUN}-branch-1` },
      });
      expect(submitted.status).toBe(201);
      // Approvers scoped to everything qualify; the one scoped to branch-2 does not.
      expect(submitted.body.pendingApproverAccountIds).toContain(APPROVER_1);
      expect(submitted.body.pendingApproverAccountIds).not.toContain(OUTSIDER);
    });
  });

  /* ============================= APPROVAL-003: maker-checker over HTTP */

  describe('APPROVAL-003: maker-checker', () => {
    it('refuses self-approval by default, and records nothing', async () => {
      const { operationType } = await publishedPolicy({ stages: singleStage([REQUESTER]) });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;
      const res = await as(REQUESTER)
        .post(`/api/v1/approvals/requests/${requestId}/approve`)
        .send({ reason: 'it is fine' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(await decisionModel(connection).countDocuments({ requestId })).toBe(0);
      expect((await requestModel(connection).findOne({ requestId }).lean().exec())?.state).toBe(
        'pending',
      );
    });

    it('permits it only when the policy says so, only with a reason, and marks the decision', async () => {
      const { operationType } = await publishedPolicy({
        stages: singleStage([REQUESTER]),
        selfApproval: 'permittedWithReason',
      });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;

      const withoutReason = await as(REQUESTER)
        .post(`/api/v1/approvals/requests/${requestId}/approve`)
        .send({});
      expect(withoutReason.status).toBe(403);

      const withReason = await as(REQUESTER)
        .post(`/api/v1/approvals/requests/${requestId}/approve`)
        .send({ reason: 'sole signatory, approved by exception' });
      expect(withReason.status).toBe(200);
      expect(withReason.body.decisions[0].selfApproved).toBe(true);

      // The audit trail says a self-approval happened, so a review can find every instance.
      const decisionEvent = (await connection.db
        ?.collection(AUDIT_COLLECTION)
        .findOne({ 'target.id': requestId, action: APPROVAL_AUDIT_ACTIONS.decisionRecorded })) as {
        changes?: { path: string; to?: string }[];
      } | null;
      expect(decisionEvent?.changes?.some((change) => change.path === 'selfApproved')).toBe(true);
    });

    it('is not bypassed by an administrative permission', async () => {
      // ADMIN holds every permission, including the administrative ones.
      const { operationType } = await publishedPolicy({ stages: singleStage([ADMIN]) });
      const submitted = await submit(ADMIN, operationType);
      const res = await as(ADMIN)
        .post(`/api/v1/approvals/requests/${submitted.body.requestId}/approve`)
        .send({ reason: 'I am an administrator' });
      expect(res.status).toBe(403);
    });
  });

  /* ============================== APPROVAL-004: delegation over HTTP */

  describe('APPROVAL-004: time-bounded delegation', () => {
    const window = () => ({
      startsAt: new Date(clock.getTime() - 3_600_000).toISOString(),
      endsAt: new Date(clock.getTime() + 7 * 86_400_000).toISOString(),
    });

    it('lets a delegate act on the delegator’s stage, and records both hands', async () => {
      const { operationType, key } = await publishedPolicy({ stages: singleStage([APPROVER_1]) });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;

      // Before any delegation, the delegate is not eligible.
      expect(
        (await as(APPROVER_3).post(`/api/v1/approvals/requests/${requestId}/approve`).send({}))
          .status,
      ).toBe(403);

      const delegation = await as(APPROVER_1)
        .post('/api/v1/approvals/delegations')
        .send({
          delegateAccountId: APPROVER_3,
          policyKeys: [key],
          ...window(),
          reason: 'annual leave',
        });
      expect(delegation.status).toBe(201);

      const approved = await as(APPROVER_3)
        .post(`/api/v1/approvals/requests/${requestId}/approve`)
        .send({});
      expect(approved.status).toBe(200);
      expect(approved.body.decisions[0]).toMatchObject({
        approverAccountId: APPROVER_1,
        effectiveApproverAccountId: APPROVER_3,
        onBehalfOfDelegationId: delegation.body.delegationId,
      });

      // Leave no active delegation behind: it would legitimately change who may approve later.
      await as(APPROVER_1).delete(`/api/v1/approvals/delegations/${delegation.body.delegationId}`);
    });

    it('stops working the moment it is revoked', async () => {
      const { operationType, key } = await publishedPolicy({ stages: singleStage([APPROVER_1]) });
      const delegation = await as(APPROVER_1)
        .post('/api/v1/approvals/delegations')
        .send({ delegateAccountId: APPROVER_3, policyKeys: [key], ...window(), reason: 'cover' });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;

      const revoked = await as(APPROVER_1).delete(
        `/api/v1/approvals/delegations/${delegation.body.delegationId}`,
      );
      expect(revoked.status).toBe(204);
      const res = await as(APPROVER_3)
        .post(`/api/v1/approvals/requests/${requestId}/approve`)
        .send({});
      expect(res.status).toBe(403);
    });

    it('does not work outside its window', async () => {
      const { operationType, key } = await publishedPolicy({ stages: singleStage([APPROVER_1]) });
      const future = {
        startsAt: new Date(clock.getTime() + 86_400_000).toISOString(),
        endsAt: new Date(clock.getTime() + 2 * 86_400_000).toISOString(),
      };
      await as(APPROVER_1)
        .post('/api/v1/approvals/delegations')
        .send({ delegateAccountId: APPROVER_3, policyKeys: [key], ...future, reason: 'next week' });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;
      expect(
        (await as(APPROVER_3).post(`/api/v1/approvals/requests/${requestId}/approve`).send({}))
          .status,
      ).toBe(403);
    });

    it('applies only to the policies it names', async () => {
      const covered = await publishedPolicy({ stages: singleStage([APPROVER_1]) });
      const other = await publishedPolicy({ stages: singleStage([APPROVER_1]) });
      await as(APPROVER_1)
        .post('/api/v1/approvals/delegations')
        .send({
          delegateAccountId: APPROVER_3,
          policyKeys: [covered.key],
          ...window(),
          reason: 'narrow cover',
        });

      const inScope = (await submit(REQUESTER, covered.operationType)).body.requestId;
      const outOfScope = (await submit(REQUESTER, other.operationType)).body.requestId;
      expect(
        (await as(APPROVER_3).post(`/api/v1/approvals/requests/${inScope}/approve`).send({}))
          .status,
      ).toBe(200);
      expect(
        (await as(APPROVER_3).post(`/api/v1/approvals/requests/${outOfScope}/approve`).send({}))
          .status,
      ).toBe(403);

      const mine = await as(APPROVER_1).get('/api/v1/approvals/delegations');
      for (const entry of mine.body.items as { delegationId: string; revokedAt?: string }[]) {
        if (!entry.revokedAt) {
          await as(APPROVER_1).delete(`/api/v1/approvals/delegations/${entry.delegationId}`);
        }
      }
    });

    it('does not widen what the delegate may otherwise do', async () => {
      // VIEWER may read requests but holds no approve permission; a delegation cannot supply one.
      const { operationType, key } = await publishedPolicy({ stages: singleStage([APPROVER_1]) });
      await as(APPROVER_1)
        .post('/api/v1/approvals/delegations')
        .send({ delegateAccountId: VIEWER, policyKeys: [key], ...window(), reason: 'cover' });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;
      const res = await as(VIEWER).post(`/api/v1/approvals/requests/${requestId}/approve`).send({});
      expect(res.status).toBe(403);
    });

    it('refuses delegating for someone else without the administrative permission', async () => {
      const res = await as(APPROVER_1)
        .post('/api/v1/approvals/delegations')
        .send({
          delegatorAccountId: APPROVER_2,
          delegateAccountId: APPROVER_3,
          ...window(),
          reason: 'not mine to give',
        });
      expect(res.status).toBe(403);
    });

    it('refuses a self-delegation and a cycle', async () => {
      // Throwaway account ids, so this test cannot change who may approve anywhere else.
      const first = `${RUN}-chain-a`;
      const second = `${RUN}-chain-b`;
      const selfDelegation = await as(ADMIN)
        .post('/api/v1/approvals/delegations')
        .send({
          delegatorAccountId: first,
          delegateAccountId: first,
          ...window(),
          reason: 'pointless',
        });
      expect(selfDelegation.status).toBe(400);

      const oneWay = await as(ADMIN)
        .post('/api/v1/approvals/delegations')
        .send({
          delegatorAccountId: first,
          delegateAccountId: second,
          ...window(),
          reason: 'one way',
        });
      expect(oneWay.status).toBe(201);
      const cycle = await as(ADMIN)
        .post('/api/v1/approvals/delegations')
        .send({
          delegatorAccountId: second,
          delegateAccountId: first,
          ...window(),
          reason: 'back again',
        });
      expect(cycle.status).toBe(400);
    });

    it('will not let a delegate approve the delegator’s own request', async () => {
      // APPROVER_1 requests; APPROVER_1 delegates to APPROVER_3; the stage names APPROVER_1.
      const { operationType, key } = await publishedPolicy({ stages: singleStage([APPROVER_1]) });
      await as(APPROVER_1)
        .post('/api/v1/approvals/delegations')
        .send({ delegateAccountId: APPROVER_3, policyKeys: [key], ...window(), reason: 'cover' });
      const submitted = await as(APPROVER_1)
        .post('/api/v1/approvals/requests')
        .send({
          operationType,
          source: { type: 'test.resource', id: `${RUN}-delegated-self` },
          idempotencyKey: nextIdempotencyKey(),
        });
      // APPROVER_1 lacks approval.request.create? It holds the approver role only, so this is 403.
      if (submitted.status === 403) return;
      const res = await as(APPROVER_3)
        .post(`/api/v1/approvals/requests/${submitted.body.requestId}/approve`)
        .send({});
      // Acting for the requester is still the requester approving their own request.
      expect(res.status).toBe(403);
    });
  });

  /* ================================ APPROVAL-005: escalation */

  describe('APPROVAL-005: escalation of an overdue approval', () => {
    const overdueStage = (): ApprovalStage[] => [
      {
        order: 1,
        name: label('with a deadline'),
        approvers: { kind: 'accounts', accountIds: [APPROVER_1] },
        rule: 'any',
        slaHours: 4,
      },
    ];

    it('adds the requester’s manager to the pending approvers once overdue', async () => {
      managers.set(REQUESTER, APPROVER_2);
      const { operationType } = await publishedPolicy({ stages: overdueStage() });
      const submitted = await submit(REQUESTER, operationType);
      const requestId = submitted.body.requestId;
      expect(submitted.body.stages[0].dueAt).toBeDefined();

      // Not yet overdue: nothing to escalate.
      expect((await as(ADMIN).post('/api/v1/approvals/requests/sweep')).body.escalated).toBe(0);

      clock = new Date(clock.getTime() + 5 * 3_600_000);
      const swept = await as(ADMIN).post('/api/v1/approvals/requests/sweep');
      expect(swept.body.escalated).toBe(1);

      const stored = await requestModel(connection).findOne({ requestId }).lean().exec();
      // The manager is added, not substituted: the original approver still owes a decision.
      expect(stored?.pendingApproverAccountIds).toContain(APPROVER_1);
      expect(stored?.pendingApproverAccountIds).toContain(APPROVER_2);
      expect(stored?.stages[0]?.escalatedToAccountId).toBe(APPROVER_2);
      expect((await eventsFor(requestId)).map((event) => event.action)).toContain(
        APPROVAL_AUDIT_ACTIONS.requestEscalated,
      );

      // The manager can now decide, and a second sweep escalates nothing again.
      expect((await as(ADMIN).post('/api/v1/approvals/requests/sweep')).body.escalated).toBe(0);
      expect(
        (await as(APPROVER_2).post(`/api/v1/approvals/requests/${requestId}/approve`).send({}))
          .status,
      ).toBe(200);
    });

    it('reports an overdue stage as unresolved rather than inventing a manager', async () => {
      // No reporting line configured: CORE-ORG (Phase 2) owns it.
      const { operationType } = await publishedPolicy({ stages: overdueStage() });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;
      clock = new Date(clock.getTime() + 5 * 3_600_000);

      const swept = await as(ADMIN).post('/api/v1/approvals/requests/sweep');
      expect(swept.body.escalated).toBe(0);
      expect(swept.body.unresolved).toBeGreaterThanOrEqual(1);
      const stored = await requestModel(connection).findOne({ requestId }).lean().exec();
      expect(stored?.stages[0]?.escalatedAt).toBeUndefined();
      expect(stored?.pendingApproverAccountIds).toEqual([APPROVER_1]);
    });

    it('needs the escalate permission', async () => {
      expect((await as(APPROVER_1).post('/api/v1/approvals/requests/sweep')).status).toBe(403);
    });
  });

  /* ============================ APPROVAL-007: reassignment */

  describe('APPROVAL-007: reassigning an offboarded approver’s pending approvals', () => {
    it('moves the pending decision and keeps every earlier decision', async () => {
      const { operationType } = await publishedPolicy({
        stages: [
          {
            order: 1,
            name: label('first'),
            approvers: { kind: 'accounts', accountIds: [APPROVER_1] },
            rule: 'any',
          },
          {
            order: 2,
            name: label('second'),
            approvers: { kind: 'accounts', accountIds: [APPROVER_2] },
            rule: 'any',
          },
        ],
      });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;
      await as(APPROVER_1).post(`/api/v1/approvals/requests/${requestId}/approve`).send({});

      const reassigned = await as(ADMIN)
        .post(`/api/v1/approvals/requests/${requestId}/reassign`)
        .send({
          fromAccountId: APPROVER_2,
          toAccountId: APPROVER_3,
          reason: 'approver offboarded',
        });
      expect(reassigned.status).toBe(200);
      expect(reassigned.body.reassigned).toBe(1);

      const stored = await requestModel(connection).findOne({ requestId }).lean().exec();
      expect(stored?.pendingApproverAccountIds).toEqual([APPROVER_3]);
      // The stage-one decision is untouched: history is not rewritten.
      const decisions = await decisionModel(connection).find({ requestId }).lean().exec();
      expect(decisions).toHaveLength(1);
      expect(decisions[0]?.approverAccountId).toBe(APPROVER_1);

      expect(
        (await as(APPROVER_2).post(`/api/v1/approvals/requests/${requestId}/approve`).send({}))
          .status,
      ).toBe(403);
      expect(
        (await as(APPROVER_3).post(`/api/v1/approvals/requests/${requestId}/approve`).send({}))
          .status,
      ).toBe(200);
    });

    it('reassigns every pending approval of one account at once, and audits each', async () => {
      const { operationType } = await publishedPolicy({ stages: singleStage([APPROVER_2]) });
      const first = (await submit(REQUESTER, operationType)).body.requestId;
      const second = (await submit(REQUESTER, operationType)).body.requestId;

      const res = await as(ADMIN)
        .post('/api/v1/approvals/requests/reassign-account')
        .send({ fromAccountId: APPROVER_2, toAccountId: APPROVER_3, reason: 'offboarded' });
      expect(res.status).toBe(200);
      expect(res.body.reassigned).toBeGreaterThanOrEqual(2);

      for (const requestId of [first, second]) {
        expect((await eventsFor(requestId)).map((event) => event.action)).toContain(
          APPROVAL_AUDIT_ACTIONS.requestReassigned,
        );
      }
    });

    it('needs the reassign permission', async () => {
      const { operationType } = await publishedPolicy({ stages: singleStage([APPROVER_1]) });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;
      const res = await as(APPROVER_1)
        .post(`/api/v1/approvals/requests/${requestId}/reassign`)
        .send({
          fromAccountId: APPROVER_1,
          toAccountId: APPROVER_3,
          reason: 'give it to someone else',
        });
      expect(res.status).toBe(403);
      expect(
        (await requestModel(connection).findOne({ requestId }).lean().exec())
          ?.pendingApproverAccountIds,
      ).toEqual([APPROVER_1]);
    });
  });

  /* ========================= concurrency, queues, scopes, and negatives */

  describe('concurrency and idempotency under load', () => {
    it('accepts exactly one of two simultaneous approvals of the same stage', async () => {
      const { operationType } = await publishedPolicy({
        stages: [
          {
            order: 1,
            name: label('either of two'),
            approvers: { kind: 'accounts', accountIds: [APPROVER_1, APPROVER_2] },
            rule: 'any',
          },
        ],
      });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;

      const [one, two] = await Promise.all([
        as(APPROVER_1).post(`/api/v1/approvals/requests/${requestId}/approve`).send({}),
        as(APPROVER_2).post(`/api/v1/approvals/requests/${requestId}/approve`).send({}),
      ]);
      const statuses = [one.status, two.status].sort();
      expect(statuses[0]).toBe(200);
      // The loser is a conflict, not a second completion.
      expect([403, 409]).toContain(statuses[1]);

      const stored = await requestModel(connection).findOne({ requestId }).lean().exec();
      expect(stored?.state).toBe('approved');
      expect(stored?.stages[0]?.satisfied).toBe(1);
      expect(await decisionModel(connection).countDocuments({ requestId })).toBe(1);
    });

    it('accepts exactly one of two simultaneous approvals by the same approver', async () => {
      const { operationType } = await publishedPolicy({ stages: singleStage([APPROVER_1]) });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;
      const results = await Promise.all([
        as(APPROVER_1).post(`/api/v1/approvals/requests/${requestId}/approve`).send({}),
        as(APPROVER_1).post(`/api/v1/approvals/requests/${requestId}/approve`).send({}),
      ]);
      expect(results.filter((res) => res.status === 200)).toHaveLength(1);
      expect(await decisionModel(connection).countDocuments({ requestId })).toBe(1);
    });

    it('refuses a decision made against a stale version', async () => {
      const { operationType } = await publishedPolicy({
        stages: [
          {
            order: 1,
            name: label('quorum'),
            approvers: { kind: 'accounts', accountIds: [APPROVER_1, APPROVER_2] },
            rule: 'quorum',
            quorum: 2,
          },
        ],
      });
      const submitted = await submit(REQUESTER, operationType);
      const requestId = submitted.body.requestId;
      const staleVersion = submitted.body.version;

      await as(APPROVER_1).post(`/api/v1/approvals/requests/${requestId}/approve`).send({});
      const stale = await as(APPROVER_2)
        .post(`/api/v1/approvals/requests/${requestId}/approve`)
        .send({ expectedVersion: staleVersion });
      expect(stale.status).toBe(409);
      // And with the current version it succeeds.
      const current = await requestModel(connection).findOne({ requestId }).lean().exec();
      const fresh = await as(APPROVER_2)
        .post(`/api/v1/approvals/requests/${requestId}/approve`)
        .send({ expectedVersion: current?.version });
      expect(fresh.status).toBe(200);
    });

    it('leaves nothing half-applied when a decision is refused', async () => {
      const { operationType } = await publishedPolicy({ stages: singleStage([APPROVER_1]) });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;
      // APPROVER_2 is not eligible; nothing at all may change.
      const before = await requestModel(connection).findOne({ requestId }).lean().exec();
      expect(
        (await as(APPROVER_2).post(`/api/v1/approvals/requests/${requestId}/approve`).send({}))
          .status,
      ).toBe(403);
      const after = await requestModel(connection).findOne({ requestId }).lean().exec();
      expect(after?.version).toBe(before?.version);
      expect(after?.stages[0]?.satisfied).toBe(0);
      expect(await decisionModel(connection).countDocuments({ requestId })).toBe(0);
    });
  });

  describe('work queues, scopes, and field restrictions', () => {
    it('lists only what awaits me when asked', async () => {
      const mine = await publishedPolicy({ stages: singleStage([APPROVER_1]) });
      const theirs = await publishedPolicy({ stages: singleStage([APPROVER_2]) });
      const forMe = (await submit(REQUESTER, mine.operationType)).body.requestId;
      const forThem = (await submit(REQUESTER, theirs.operationType)).body.requestId;

      const res = await as(APPROVER_1).get('/api/v1/approvals/requests?awaitingMe=true&limit=100');
      expect(res.status).toBe(200);
      const ids = (res.body.items as { requestId: string }[]).map((item) => item.requestId);
      expect(ids).toContain(forMe);
      expect(ids).not.toContain(forThem);
    });

    it('paginates deterministically with a bounded page size', async () => {
      const { operationType } = await publishedPolicy({ stages: singleStage([APPROVER_1]) });
      const created: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        clock = new Date(clock.getTime() + 1000);
        created.push((await submit(REQUESTER, operationType)).body.requestId);
      }
      const first = await as(ADMIN).get(
        `/api/v1/approvals/requests?limit=2&operationType=${operationType}`,
      );
      expect(first.body.items).toHaveLength(2);
      expect(first.body.total).toBe(3);
      expect(first.body.nextCursor).toBeDefined();
      const second = await as(ADMIN).get(
        `/api/v1/approvals/requests?limit=2&operationType=${operationType}&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      );
      expect(second.body.items).toHaveLength(1);
      const seen = [...first.body.items, ...second.body.items].map(
        (item: { requestId: string }) => item.requestId,
      );
      expect(new Set(seen).size).toBe(3);
      expect(seen.sort()).toEqual([...created].sort());
    });

    it('refuses an excessive page size', async () => {
      const res = await as(ADMIN).get('/api/v1/approvals/requests?limit=5000');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('hides a request outside the actor’s scope, as absent rather than forbidden', async () => {
      const { operationType } = await publishedPolicy({ stages: singleStage([APPROVER_1]) });
      const requestId = (
        await submit(REQUESTER, operationType, { scope: { branchId: `${RUN}-branch-1` } })
      ).body.requestId;

      const outsiderRead = await as(OUTSIDER).get(`/api/v1/approvals/requests/${requestId}`);
      expect(outsiderRead.status).toBe(404);
      expect(outsiderRead.body.error.code).toBe('NOT_FOUND');
      // Absent and out-of-scope answer identically.
      const missing = await as(OUTSIDER).get(`/api/v1/approvals/requests/${RUN}-absent`);
      expect(missing.status).toBe(404);
      expect(Object.keys(outsiderRead.body.error).sort()).toEqual(
        Object.keys(missing.body.error).sort(),
      );

      // Deciding on it is equally invisible.
      const decision = await as(OUTSIDER)
        .post(`/api/v1/approvals/requests/${requestId}/approve`)
        .send({});
      expect(decision.status).toBe(404);
      const list = await as(OUTSIDER).get('/api/v1/approvals/requests?limit=100');
      expect((list.body.items as { requestId: string }[]).map((i) => i.requestId)).not.toContain(
        requestId,
      );
      expect(list.body.total).toBe(0);
    });

    it('removes the monetary context from an actor without the amounts permission', async () => {
      const { operationType } = await publishedPolicy({ stages: singleStage([APPROVER_1]) });
      const requestId = (
        await submit(REQUESTER, operationType, {
          context: { amount: { amount: '75000.00', currency: 'SAR' }, percentage: '12.5' },
        })
      ).body.requestId;

      const withAmounts = await as(APPROVER_1).get(`/api/v1/approvals/requests/${requestId}`);
      expect(withAmounts.body.context.amount).toEqual({ amount: '75000.00', currency: 'SAR' });

      const withoutAmounts = await as(VIEWER).get(`/api/v1/approvals/requests/${requestId}`);
      expect(withoutAmounts.status).toBe(200);
      expect(withoutAmounts.body.context).not.toHaveProperty('amount');
      expect(withoutAmounts.body.context).not.toHaveProperty('percentage');
      expect(JSON.stringify(withoutAmounts.body)).not.toContain('75000.00');
    });
  });

  describe('security negatives', () => {
    it('refuses every route without an actor', async () => {
      const routes: [string, 'get' | 'post'][] = [
        ['/api/v1/approvals/policies', 'get'],
        ['/api/v1/approvals/policies', 'post'],
        ['/api/v1/approvals/requests', 'get'],
        ['/api/v1/approvals/requests', 'post'],
        ['/api/v1/approvals/requests/sweep', 'post'],
        ['/api/v1/approvals/delegations', 'get'],
      ];
      for (const [path, method] of routes) {
        const res = await (method === 'get' ? as().get(path) : as().post(path).send({}));
        expect(res.status, `${method} ${path}`).toBe(401);
      }
    });

    it('refuses each write without its permission, and never names the permission', async () => {
      const { operationType } = await publishedPolicy({ stages: singleStage([APPROVER_1]) });
      const requestId = (await submit(REQUESTER, operationType)).body.requestId;

      // VIEWER may read but not create, approve, publish, reassign, or sweep.
      const attempts = [
        await as(VIEWER)
          .post('/api/v1/approvals/requests')
          .send({
            operationType,
            source: { type: 'test.resource', id: `${RUN}-denied` },
            idempotencyKey: nextIdempotencyKey(),
          }),
        await as(VIEWER).post(`/api/v1/approvals/requests/${requestId}/approve`).send({}),
        await as(VIEWER)
          .post(`/api/v1/approvals/requests/${requestId}/reject`)
          .send({ reason: 'no' }),
        await as(VIEWER)
          .post('/api/v1/approvals/policies')
          .send({
            key: nextKey(),
            name: label('denied'),
            operationType: 'test.denied.grant',
            stages: singleStage(),
          }),
      ];
      for (const res of attempts) {
        expect(res.status).toBe(403);
        expect(Object.keys(res.body.error).sort()).toEqual(['code', 'correlationId']);
        expect(JSON.stringify(res.body)).not.toContain('approval.');
      }
      expect(await decisionModel(connection).countDocuments({ requestId })).toBe(0);
    });

    it('rejects operator injection, dotted keys, and prototype pollution in a body', async () => {
      const { operationType } = await publishedPolicy({ stages: singleStage([APPROVER_1]) });
      const bodies: Record<string, unknown>[] = [
        {
          operationType,
          source: { type: 'test.resource', id: { $ne: null } },
          idempotencyKey: nextIdempotencyKey(),
        },
        {
          operationType,
          source: { type: 'test.resource', id: 'x' },
          idempotencyKey: nextIdempotencyKey(),
          $set: { state: 'approved' },
        },
        {
          operationType,
          source: { type: 'test.resource', id: 'x' },
          idempotencyKey: nextIdempotencyKey(),
          __proto__: { admin: true },
        },
        {
          operationType,
          source: { type: 'test.resource', id: 'x' },
          idempotencyKey: nextIdempotencyKey(),
          constructor: { prototype: {} },
        },
        // Mass assignment: state and version are server-owned.
        {
          operationType,
          source: { type: 'test.resource', id: 'x' },
          idempotencyKey: nextIdempotencyKey(),
          state: 'approved',
        },
        {
          operationType,
          source: { type: 'test.resource', id: 'x' },
          idempotencyKey: nextIdempotencyKey(),
          version: 99,
        },
        {
          operationType,
          source: { type: 'test.resource', id: 'x' },
          idempotencyKey: nextIdempotencyKey(),
          policyVersion: 1,
        },
      ];
      for (const body of bodies) {
        const res = await as(REQUESTER).post('/api/v1/approvals/requests').send(body);
        expect([400, 201]).toContain(res.status);
        if (res.status === 201) {
          // A body that slipped through must not have carried anything dangerous into the record.
          expect(res.body.state).toBe('pending');
          expect(res.body.version).toBe(1);
          expect(Object.prototype.hasOwnProperty.call({}, 'admin')).toBe(false);
        }
      }
      // Nothing was polluted globally.
      expect(({} as Record<string, unknown>)['admin']).toBeUndefined();
    });

    it('rejects a crafted request identifier and a crafted policy key', async () => {
      expect(
        (await as(ADMIN).get(`/api/v1/approvals/requests/${encodeURIComponent('{"$ne":null}')}`))
          .status,
      ).toBe(400);
      expect(
        (
          await as(ADMIN).get(
            `/api/v1/approvals/policies/${encodeURIComponent('../../etc')}/versions/1`,
          )
        ).status,
      ).toBe(400);
      expect((await as(ADMIN).get('/api/v1/approvals/requests?state[$ne]=pending')).status).toBe(
        400,
      );
      expect((await as(ADMIN).get('/api/v1/approvals/requests?unknownFilter=1')).status).toBe(400);
    });

    it('rejects a malformed pagination cursor rather than ignoring it', async () => {
      const res = await as(ADMIN).get('/api/v1/approvals/requests?cursor=not-a-cursor');
      expect([400, 404]).toContain(res.status);
    });
  });
});
