import { ScopeAssignmentSchema, type ActorContext, type Permission } from '@alola/contracts';
import { createLogger } from '@alola/security';
import { serviceGate } from '@alola/testing';
import type { Express } from 'express';
import mongoose, { type Connection } from 'mongoose';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type ApiModule } from '../../app';
import type { ActorResolver } from '../../http/actor';
import { noteAuditWrite } from '../../http/audit-context';
import { ensureIndexes } from '../../platform/indexes';
import { configureMongoose } from '../../platform/mongo';
import { AUDIT_COLLECTION, AuditService } from '../audit';
import {
  ACCOUNT_GRANTS_COLLECTION,
  ROLES_COLLECTION,
  SecurityService,
  bootstrapGrant,
  bootstrapRole,
} from '../security';
import { TASKS_COLLECTION, TaskService, taskModel, taskRouter, type TaskNotifier } from './index';

/**
 * Tasks against a real MongoDB replica set (CORE-TASK-001 … 005).
 *
 * The organization is in Cairo (UTC+3 on these dates), so every due moment in these tests is a
 * wall-clock time there, and the assertions check the UTC instant and the Cairo calendar day apart.
 */
const gate = serviceGate(['mongodb']);
const RUN = `t${Date.now()}`;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const ACCOUNT_HEADER = 'x-test-account';
const label = (en: string) => ({ ar: `عربي ${en}`, en });

describe.skipIf(!gate.available)(`tasks — ${gate.reason}`, () => {
  let connection: Connection;
  let audit: AuditService;
  let security: SecurityService;
  let service: TaskService;
  let app: Express;
  let clock: Date;
  let escalationDelay: number | null;
  const inactive = new Set<string>();
  const managers = new Map<string, string>();
  const sent: {
    type: string;
    to: readonly string[];
    key: string;
    params: Record<string, string>;
  }[] = [];

  // Accounts. Branch A and branch B each have a manager who can create, view and manage.
  const MANAGER_A = `acc_${RUN}mgra`;
  const AGENT_A = `acc_${RUN}agenta`;
  const VIEWER_A = `acc_${RUN}viewa`;
  const MANAGER_B = `acc_${RUN}mgrb`;
  const HEAD = `acc_${RUN}head`;
  const ADMIN = `acc_${RUN}admin`;
  const GONE = `acc_${RUN}gone`;
  const LEAD_A = `lead_${RUN}a`;
  const LEAD_B = `lead_${RUN}b`;
  const BRANCH_A = `brn_${RUN}a`;
  const BRANCH_B = `brn_${RUN}b`;

  const notifier: TaskNotifier = {
    notify: (input) => {
      // Mirrors CORE-NOTIFY's guarantee: one key, one notice.
      if (!sent.some((row) => row.key === input.dedupeKey)) {
        sent.push({
          type: input.type,
          to: input.recipients.accountIds,
          key: input.dedupeKey,
          params: input.params,
        });
      }
      return Promise.resolve();
    },
  };

  const as = (accountId: string) => ({
    get: (path: string) => request(app).get(path).set(ACCOUNT_HEADER, accountId),
    post: (path: string) =>
      request(app).post(path).set(ACCOUNT_HEADER, accountId).set('Origin', ALLOWED_ORIGIN),
    patch: (path: string) =>
      request(app).patch(path).set(ACCOUNT_HEADER, accountId).set('Origin', ALLOWED_ORIGIN),
  });
  const create = (actor: string, body: Record<string, unknown>) =>
    as(actor)
      .post('/api/v1/tasks')
      .send({
        title: 'Call back the customer',
        assigneeAccountId: AGENT_A,
        due: { date: '2026-10-05', time: '17:00' },
        ...body,
      });
  const ids = (body: { items: { taskId: string }[] }) => body.items.map((item) => item.taskId);
  const sweep = () => as(ADMIN).post('/api/v1/tasks/sweep').expect(200);

  beforeAll(async () => {
    configureMongoose();
    const logger = createLogger({ name: 'it-tasks', level: 'silent' });
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'] as string,
    });
    await connection.asPromise();
    await ensureIndexes(connection, logger);
    audit = new AuditService({ connection, logger, onRecorded: noteAuditWrite });
    security = new SecurityService({ connection, audit, logger });
    // A lead resolves only for an actor whose scope reaches its branch — as the CRM's scoped getter does.
    const leads = new Map([
      [LEAD_A, BRANCH_A],
      [LEAD_B, BRANCH_B],
    ]);
    service = new TaskService({
      connection,
      audit,
      timeZone: 'Africa/Cairo',
      resolveLink: (actor: ActorContext, _type, id) => {
        const branchId = leads.get(id);
        if (!branchId) return Promise.resolve(undefined);
        const reaches = actor.scope.level === 'all' || actor.scope.branchIds.includes(branchId);
        return Promise.resolve(reaches ? { legalEntityId: `le_${RUN}`, branchId } : undefined);
      },
      isActiveAccount: (accountId) => Promise.resolve(!inactive.has(accountId)),
      resolveManager: (accountId) => Promise.resolve(managers.get(accountId)),
      escalationDelayHours: () => Promise.resolve(escalationDelay),
      notifier,
      now: () => clock,
    });

    const grant = async (
      accountId: string,
      permissions: Permission[],
      scope: Record<string, unknown> = { level: 'all' },
    ) => {
      await bootstrapRole(connection, {
        key: `${RUN}-${accountId}`,
        name: label('r'),
        permissions,
      });
      await bootstrapGrant(connection, {
        accountId,
        roleKeys: permissions.length ? [`${RUN}-${accountId}`] : [],
        scope: ScopeAssignmentSchema.parse(scope),
        updatedBy: 'test',
      });
    };
    const managerPermissions: Permission[] = ['task.create', 'task.view', 'task.manage'];
    await grant(MANAGER_A, managerPermissions, { level: 'branch', branchIds: [BRANCH_A] });
    await grant(MANAGER_B, managerPermissions, { level: 'branch', branchIds: [BRANCH_B] });
    await grant(VIEWER_A, ['task.view'], { level: 'branch', branchIds: [BRANCH_A] });
    await grant(AGENT_A, [], { level: 'self' });
    await grant(HEAD, [], { level: 'self' });
    await grant(ADMIN, ['task.create', 'task.reassign', 'task.sweep']);

    const actorResolver: ActorResolver = async (req) => {
      const accountId = req.get(ACCOUNT_HEADER);
      return accountId ? security.resolveActor(accountId) : undefined;
    };
    const modules: ApiModule[] = [
      { basePath: '/tasks', router: taskRouter({ getService: () => service }) },
    ];
    app = createApp({
      config: { CORS_ALLOWED_ORIGINS: [ALLOWED_ORIGIN], TRUST_PROXY_HOPS: 1, APP_ENV: 'test' },
      logger,
      mongo: { health: () => Promise.resolve({ status: 'up', transactions: true }) },
      redis: { health: () => Promise.resolve({ status: 'up' }) },
      rateLimiter: new RateLimiterMemory({ points: 10_000, duration: 60 }),
      modules,
      actorResolver,
    });
  });

  beforeEach(async () => {
    clock = new Date('2026-10-01T09:00:00.000Z'); // 12:00 in Cairo
    escalationDelay = null;
    sent.length = 0;
    inactive.clear();
    inactive.add(GONE);
    managers.clear();
    managers.set(AGENT_A, HEAD);
    await connection.collection(TASKS_COLLECTION).deleteMany({});
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.collection(TASKS_COLLECTION).deleteMany({});
    await connection.collection(ROLES_COLLECTION).deleteMany({ key: { $regex: `^${RUN}` } });
    await connection
      .collection(ACCOUNT_GRANTS_COLLECTION)
      .deleteMany({ accountId: { $regex: `^acc_${RUN}` } });
    await connection
      .collection(AUDIT_COLLECTION)
      .deleteMany({ 'actor.accountId': { $regex: `^acc_${RUN}` } });
    await connection.close();
  });

  /* =========================================================== CORE-TASK-001 */

  describe('tasks with an owner, a due moment, a priority and a link (CORE-TASK-001)', () => {
    it('creates an audited task and tells the assignee', async () => {
      const created = await create(MANAGER_A, {
        priority: 'high',
        link: { type: 'lead', id: LEAD_A },
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        state: 'open',
        priority: 'high',
        assigneeAccountId: AGENT_A,
        createdBy: MANAGER_A,
        link: { type: 'lead', id: LEAD_A },
        version: 1,
        overdue: false,
      });
      expect(sent).toEqual([
        expect.objectContaining({
          type: 'task.assigned',
          to: [AGENT_A],
          params: expect.objectContaining({ dueOn: '05/10/2026' }),
        }),
      ]);
      const evidence = await connection
        .collection(AUDIT_COLLECTION)
        .findOne({ action: 'task.created', 'target.id': created.body.taskId });
      expect(evidence).toMatchObject({ outcome: 'succeeded', actor: { accountId: MANAGER_A } });
    });

    it('refuses an inactive assignee, a record outside the creator’s scope, and a creator without permission', async () => {
      const inactiveAssignee = await create(MANAGER_A, { assigneeAccountId: GONE }).expect(400);
      expect(inactiveAssignee.body.error.issues[0].code).toBe('ASSIGNEE_INACTIVE');
      await create(MANAGER_A, { link: { type: 'lead', id: LEAD_B } }).expect(404);
      await create(AGENT_A, {}).expect(403);
      expect(await connection.collection(TASKS_COLLECTION).countDocuments()).toBe(0);
    });

    it('keeps each task to the people it belongs to and the scope that reaches it', async () => {
      const linked = (await create(MANAGER_A, { link: { type: 'lead', id: LEAD_A } }).expect(201))
        .body.taskId as string;
      const personal = (await create(ADMIN, { assigneeAccountId: HEAD }).expect(201)).body
        .taskId as string;

      // Mine: assignee and creator.
      expect(ids((await as(AGENT_A).get('/api/v1/tasks').expect(200)).body)).toEqual([linked]);
      expect(ids((await as(HEAD).get('/api/v1/tasks').expect(200)).body)).toEqual([personal]);
      // Scope: the branch-A viewer sees the branch-A task and not the personal one.
      expect(ids((await as(VIEWER_A).get('/api/v1/tasks?view=scope').expect(200)).body)).toEqual([
        linked,
      ]);
      // Branch B sees neither, and an out-of-scope read is absent rather than forbidden.
      expect((await as(MANAGER_B).get('/api/v1/tasks?view=scope').expect(200)).body.items).toEqual(
        [],
      );
      await as(MANAGER_B).get(`/api/v1/tasks/${linked}`).expect(404);
      await as(VIEWER_A).get(`/api/v1/tasks/${personal}`).expect(404);
      // A scope-wide list needs task.view.
      await as(AGENT_A).get('/api/v1/tasks?view=scope').expect(403);
    });

    it('cannot be deleted through the model', async () => {
      await create(MANAGER_A, {}).expect(201);
      await expect(taskModel(connection).deleteMany({}).exec()).rejects.toThrow(/never deleted/);
      expect(await connection.collection(TASKS_COLLECTION).countDocuments()).toBe(1);
    });
  });

  /* =========================================================== CORE-TASK-002 */

  describe('times in the organization calendar, stored in UTC (CORE-TASK-002)', () => {
    it('stores the due moment in UTC and files it on the organization’s day', async () => {
      const late = await create(MANAGER_A, {
        due: { date: '2026-10-06', time: '01:30' },
        reminder: { date: '2026-10-05', time: '21:00' },
      }).expect(201);
      // 01:30 in Cairo on the 6th is 22:30 UTC on the 5th — and it is still the 6th's task.
      expect(late.body).toMatchObject({
        dueAt: '2026-10-05T22:30:00.000Z',
        dueOn: '2026-10-06',
        remindAt: '2026-10-05T18:00:00.000Z',
      });
      const day = await as(AGENT_A)
        .get('/api/v1/tasks/calendar?from=2026-10-06&to=2026-10-06')
        .expect(200);
      expect(ids(day.body)).toEqual([late.body.taskId]);
      expect(
        (await as(AGENT_A).get('/api/v1/tasks/calendar?from=2026-10-05&to=2026-10-05').expect(200))
          .body.items,
      ).toEqual([]);
    });

    it('refuses a reminder after the due moment', async () => {
      const refused = await create(MANAGER_A, {
        reminder: { date: '2026-10-05', time: '18:00' },
      }).expect(400);
      expect(refused.body.error.issues[0].code).toBe('REMINDER_AFTER_DUE');
    });

    it('sends a due reminder once, however often the sweep runs', async () => {
      await create(MANAGER_A, { reminder: { date: '2026-10-01', time: '11:00' } }).expect(201);
      sent.length = 0;
      expect((await sweep()).body).toMatchObject({ reminded: 1 });
      expect((await sweep()).body).toMatchObject({ reminded: 0 });
      expect(sent.filter((row) => row.type === 'task.dueSoon')).toHaveLength(1);
    });
  });

  /* =========================================================== CORE-TASK-003 */

  describe('escalation on overdue (CORE-TASK-003)', () => {
    it('tells the assignee and escalates to their manager once, audited', async () => {
      const task = (
        await create(MANAGER_A, { due: { date: '2026-10-01', time: '11:00' } }).expect(201)
      ).body;
      sent.length = 0;
      expect((await sweep()).body).toEqual({
        reminded: 0,
        overdueNotified: 1,
        escalated: 1,
        unresolved: 0,
      });
      expect((await sweep()).body).toEqual({
        reminded: 0,
        overdueNotified: 0,
        escalated: 0,
        unresolved: 0,
      });
      expect(sent.map((row) => [row.type, row.to[0]])).toEqual([
        ['task.overdue', AGENT_A],
        ['task.escalated', HEAD],
      ]);
      // The manager now sees it among their own tasks.
      const mine = await as(HEAD).get('/api/v1/tasks?overdueOnly=true').expect(200);
      expect(mine.body.items).toEqual([
        expect.objectContaining({ taskId: task.taskId, overdue: true, escalatedToAccountId: HEAD }),
      ]);
      expect(
        await connection
          .collection(AUDIT_COLLECTION)
          .countDocuments({ action: 'task.escalated', 'target.id': task.taskId }),
      ).toBe(1);
    });

    it('reports an assignee with no manager as unresolved instead of guessing', async () => {
      managers.clear();
      await create(MANAGER_A, { due: { date: '2026-10-01', time: '11:00' } }).expect(201);
      expect((await sweep()).body).toMatchObject({ escalated: 0, unresolved: 1 });
      // The next run tries again: a manager placed later is still found.
      managers.set(AGENT_A, HEAD);
      expect((await sweep()).body).toMatchObject({ escalated: 1, unresolved: 0 });
    });

    it('waits for the configured grace period, and starts afresh when the due moment moves', async () => {
      escalationDelay = 4;
      const task = (
        await create(MANAGER_A, { due: { date: '2026-10-01', time: '11:00' } }).expect(201)
      ).body;
      expect((await sweep()).body).toMatchObject({ overdueNotified: 1, escalated: 0 });
      clock = new Date('2026-10-01T12:00:01.000Z'); // four hours and a second after 11:00 Cairo
      expect((await sweep()).body).toMatchObject({ escalated: 1 });

      const current = (await as(MANAGER_A).get(`/api/v1/tasks/${task.taskId}`).expect(200)).body;
      const moved = await as(MANAGER_A)
        .patch(`/api/v1/tasks/${task.taskId}`)
        .send({ expectedVersion: current.version, due: { date: '2026-10-09', time: '10:00' } })
        .expect(200);
      expect(moved.body.escalatedToAccountId).toBeUndefined();
      expect(moved.body.overdue).toBe(false);
    });

    it('lets only a sweep permission run the sweep', async () => {
      await as(MANAGER_A).post('/api/v1/tasks/sweep').expect(403);
    });
  });

  /* ============================================================ lifecycle */

  describe('who may change a task', () => {
    it('lets the assignee move it along, and keeps cancelling and reopening for the creator, with a reason', async () => {
      const id = (await create(MANAGER_A, {}).expect(201)).body.taskId as string;
      const move = (actor: string, body: Record<string, unknown>) =>
        as(actor).post(`/api/v1/tasks/${id}/transition`).send(body);

      await move(AGENT_A, { expectedVersion: 1, state: 'inProgress' }).expect(200);
      await move(AGENT_A, { expectedVersion: 1, state: 'done' }).expect(409); // stale
      await move(AGENT_A, {
        expectedVersion: 2,
        state: 'cancelled',
        reason: 'no longer needed',
      }).expect(403);
      const done = await move(AGENT_A, { expectedVersion: 2, state: 'done' }).expect(200);
      expect(done.body.completedAt).toBeDefined();
      await move(AGENT_A, { expectedVersion: 3, state: 'open', reason: 'not finished' }).expect(
        403,
      );
      const noReason = await move(MANAGER_A, { expectedVersion: 3, state: 'open' }).expect(400);
      expect(noReason.body.error.issues[0].code).toBe('REASON_REQUIRED');
      await move(MANAGER_A, { expectedVersion: 3, state: 'open', reason: 'not finished' }).expect(
        200,
      );
      await move(MANAGER_A, { expectedVersion: 4, state: 'cancelled', reason: 'duplicate' }).expect(
        200,
      );
      const reopen = await move(MANAGER_A, {
        expectedVersion: 5,
        state: 'open',
        reason: 'again',
      }).expect(409);
      expect(reopen.body.error.issues[0].code).toBe('TRANSITION_NOT_ALLOWED');
    });

    it('refuses edits from someone who can only view, and from the assignee', async () => {
      const id = (await create(MANAGER_A, { link: { type: 'lead', id: LEAD_A } }).expect(201)).body
        .taskId as string;
      await as(VIEWER_A)
        .patch(`/api/v1/tasks/${id}`)
        .send({ expectedVersion: 1, title: 'x' })
        .expect(403);
      await as(AGENT_A)
        .patch(`/api/v1/tasks/${id}`)
        .send({ expectedVersion: 1, title: 'x' })
        .expect(403);
      const renamed = await as(MANAGER_A)
        .patch(`/api/v1/tasks/${id}`)
        .send({ expectedVersion: 1, title: 'Visit the site' })
        .expect(200);
      expect(renamed.body).toMatchObject({ title: 'Visit the site', version: 2 });
    });

    it('assigns to another active person, telling them', async () => {
      const id = (await create(MANAGER_A, {}).expect(201)).body.taskId as string;
      sent.length = 0;
      await as(MANAGER_A)
        .post(`/api/v1/tasks/${id}/assign`)
        .send({ expectedVersion: 1, assigneeAccountId: GONE, reason: 'cover' })
        .expect(400);
      const moved = await as(MANAGER_A)
        .post(`/api/v1/tasks/${id}/assign`)
        .send({ expectedVersion: 1, assigneeAccountId: HEAD, reason: 'cover for leave' })
        .expect(200);
      expect(moved.body.assigneeAccountId).toBe(HEAD);
      expect(sent).toEqual([expect.objectContaining({ type: 'task.assigned', to: [HEAD] })]);
    });
  });

  /* =========================================================== CORE-TASK-005 */

  describe('moving an offboarded person’s work (CORE-TASK-005)', () => {
    it('moves open tasks and escalations, leaves finished ones, and audits each', async () => {
      const open = (
        await create(MANAGER_A, { due: { date: '2026-10-01', time: '11:00' } }).expect(201)
      ).body.taskId as string;
      const finished = (await create(MANAGER_A, {}).expect(201)).body.taskId as string;
      await as(AGENT_A)
        .post(`/api/v1/tasks/${finished}/transition`)
        .send({ expectedVersion: 1, state: 'done' })
        .expect(200);
      await sweep(); // escalates `open` to HEAD

      // AGENT_A leaves; HEAD leaves too. Both are handed to MANAGER_A.
      const reassign = (from: string) =>
        as(ADMIN)
          .post('/api/v1/tasks/reassign')
          .send({ fromAccountId: from, toAccountId: MANAGER_A, reason: 'offboarded' });
      await as(MANAGER_A)
        .post('/api/v1/tasks/reassign')
        .send({ fromAccountId: AGENT_A, toAccountId: MANAGER_A, reason: 'offboarded' })
        .expect(403);
      expect((await reassign(AGENT_A).expect(200)).body).toEqual({ reassigned: 1 });
      expect((await reassign(HEAD).expect(200)).body).toEqual({ reassigned: 1 });

      const moved = (await as(MANAGER_A).get(`/api/v1/tasks/${open}`).expect(200)).body;
      expect(moved).toMatchObject({
        assigneeAccountId: MANAGER_A,
        escalatedToAccountId: MANAGER_A,
      });
      const kept = (await as(MANAGER_A).get(`/api/v1/tasks/${finished}`).expect(200)).body;
      expect(kept.assigneeAccountId).toBe(AGENT_A);
      expect(
        await connection
          .collection(AUDIT_COLLECTION)
          .countDocuments({ action: 'task.reassigned', 'target.id': open }),
      ).toBe(2);

      const refused = await as(ADMIN)
        .post('/api/v1/tasks/reassign')
        .send({ fromAccountId: MANAGER_A, toAccountId: GONE, reason: 'offboarded' })
        .expect(400);
      expect(refused.body.error.issues[0].code).toBe('ASSIGNEE_INACTIVE');
    });
  });
});
