import {
  ScopeAssignmentSchema,
  type ActorContext,
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
import type { ActorResolver } from '../../http/actor';
import { noteAuditWrite } from '../../http/audit-context';
import { ensureIndexes } from '../../platform/indexes';
import { configureMongoose } from '../../platform/mongo';
import { ApprovalService } from '../approval';
import { AUDIT_COLLECTION, AuditService } from '../audit';
import {
  ACCOUNT_GRANTS_COLLECTION,
  ROLES_COLLECTION,
  SecurityService,
  bootstrapGrant,
  bootstrapRole,
} from '../security';
import {
  BRANCHES_COLLECTION,
  DEPARTMENTS_COLLECTION,
  JOB_TITLES_COLLECTION,
  LEGAL_ENTITIES_COLLECTION,
  PLACEMENTS_COLLECTION,
  PLACEMENT_HISTORY_COLLECTION,
  TEAMS_COLLECTION,
  OrganizationService,
  organizationRouter,
  placementHistoryModel,
} from './index';

/**
 * The organization foundation (CORE-ORG-001 … 006) against a real MongoDB replica set.
 *
 * The demonstration slice could create a hierarchy; this suite proves the foundation can **maintain**
 * one: units change and retire without breaking what hangs beneath them, a deactivation and a
 * concurrent creation can never both win, an administrator's writes are confined to their scope, a
 * placement's past is kept, and an overdue approval really escalates along the reporting line.
 */
const gate = serviceGate(['mongodb']);
const RUN = `it-orgf-${Date.now()}`;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const ACCOUNT_HEADER = 'x-test-account';

const scope = (level: ScopeAssignment['level'], overrides: Partial<ScopeAssignment> = {}) =>
  ScopeAssignmentSchema.parse({ level, ...overrides });
const label = (en: string) => ({ ar: `عربي ${en}`, en });
const TODAY = '2026-09-27';

describe.skipIf(!gate.available)(`organization foundation — ${gate.reason}`, () => {
  let connection: Connection;
  let audit: AuditService;
  let security: SecurityService;
  let organization: OrganizationService;
  let app: Express;
  let today = TODAY;

  const ADMIN = `${RUN}-admin`;
  const BRANCH_ADMIN = `${RUN}-branch-admin`;
  const ENTITY_ADMIN = `${RUN}-entity-admin`;
  const REQUESTER = `${RUN}-requester`;
  const MANAGER = `${RUN}-manager`;
  const APPROVER = `${RUN}-approver`;

  const as = (accountId: string) => ({
    get: (path: string) => request(app).get(path).set(ACCOUNT_HEADER, accountId),
    post: (path: string) =>
      request(app).post(path).set(ACCOUNT_HEADER, accountId).set('Origin', ALLOWED_ORIGIN),
    patch: (path: string) =>
      request(app).patch(path).set(ACCOUNT_HEADER, accountId).set('Origin', ALLOWED_ORIGIN),
  });
  const ORG = '/api/v1/organization';

  let counter = 0;
  const code = (prefix: string) => {
    counter += 1;
    return `${prefix}-${counter}`;
  };

  async function tree() {
    const entity = (
      await as(ADMIN)
        .post(`${ORG}/legal-entities`)
        .send({
          code: code('LE'),
          name: label('Entity'),
          currency: 'EGP',
          timeZone: 'Africa/Cairo',
        })
        .expect(201)
    ).body as { legalEntityId: string };
    const branch = async (name: string) =>
      (
        await as(ADMIN)
          .post(`${ORG}/branches`)
          .send({
            legalEntityId: entity.legalEntityId,
            code: code('BR'),
            name: label(name),
            city: label('City'),
          })
          .expect(201)
      ).body as { branchId: string };
    const branchA = await branch('A');
    const branchB = await branch('B');
    const department = async (branchId: string) =>
      (
        await as(ADMIN)
          .post(`${ORG}/departments`)
          .send({ branchId, code: code('DEP'), name: label('Department') })
          .expect(201)
      ).body as { departmentId: string; branchId: string; legalEntityId: string };
    const deptA = await department(branchA.branchId);
    const deptA2 = await department(branchA.branchId);
    const deptB = await department(branchB.branchId);
    const jobTitle = (
      await as(ADMIN)
        .post(`${ORG}/job-titles`)
        .send({ code: code('JOB'), name: label('Consultant') })
        .expect(201)
    ).body as { jobTitleId: string };
    return { entity, branchA, branchB, deptA, deptA2, deptB, jobTitle };
  }

  async function team(departmentId: string, actor = ADMIN) {
    return (
      await as(actor)
        .post(`${ORG}/teams`)
        .send({ departmentId, code: code('TEAM'), name: label('Team') })
        .expect(201)
    ).body as { teamId: string };
  }

  async function place(
    departmentId: string,
    jobTitleId: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ placementId: string }> {
    const res = await as(ADMIN)
      .post(`${ORG}/placements`)
      .send({
        displayName: `Person ${code('P')}`,
        departmentId,
        jobTitleId,
        startedOn: '2026-01-01',
        ...extra,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { placementId: string };
  }

  beforeAll(async () => {
    configureMongoose();
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'] as string,
    });
    await connection.asPromise();
    const logger = createLogger({ name: 'it-orgf', level: 'silent' });
    await ensureIndexes(connection, logger);
    audit = new AuditService({ connection, logger, onRecorded: noteAuditWrite });
    security = new SecurityService({ connection, audit, logger });
    organization = new OrganizationService({ connection, audit, today: () => today as never });

    const manage: Permission[] = [
      'org.view',
      'org.manage',
      'org.placement.view',
      'org.placement.manage',
    ];
    await bootstrapRole(connection, {
      key: `${RUN}-r-admin`,
      name: label('a'),
      permissions: manage,
    });
    await bootstrapGrant(connection, {
      accountId: ADMIN,
      roleKeys: [`${RUN}-r-admin`],
      scope: scope('all'),
      updatedBy: 'test',
    });

    const actorResolver: ActorResolver = async (req) => {
      const accountId = req.get(ACCOUNT_HEADER);
      return accountId ? security.resolveActor(accountId) : undefined;
    };
    const modules: ApiModule[] = [
      { basePath: '/organization', router: organizationRouter({ getService: () => organization }) },
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

  beforeEach(() => {
    today = TODAY;
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.collection(ROLES_COLLECTION).deleteMany({ key: { $regex: `^${RUN}` } });
    await connection
      .collection(ACCOUNT_GRANTS_COLLECTION)
      .deleteMany({ accountId: { $regex: `^${RUN}` } });
    await connection
      .collection(AUDIT_COLLECTION)
      .deleteMany({ 'actor.accountId': { $regex: `^${RUN}` } });
    for (const name of [
      LEGAL_ENTITIES_COLLECTION,
      BRANCHES_COLLECTION,
      DEPARTMENTS_COLLECTION,
      TEAMS_COLLECTION,
      JOB_TITLES_COLLECTION,
      PLACEMENTS_COLLECTION,
      PLACEMENT_HISTORY_COLLECTION,
    ]) {
      await connection.collection(name).deleteMany({});
    }
    for (const name of ['approvalPolicies', 'approvalRequests', 'approvalDecisions']) {
      await connection.collection(name).deleteMany({
        $or: [
          { key: { $regex: `^${RUN}` } },
          { requesterAccountId: { $regex: `^${RUN}` } },
          { approverAccountId: { $regex: `^${RUN}` } },
        ],
      });
    }
    await connection.close();
  });

  /* ======================================== CORE-ORG-001 / 002: lifecycle */

  describe('unit lifecycle and hierarchy validation', () => {
    it('changes editable fields only — never the code, the parent or the currency', async () => {
      const { entity, branchA } = await tree();
      const res = await as(ADMIN)
        .patch(`${ORG}/branches/${branchA.branchId}`)
        .send({ name: label('Renamed'), costCenterCode: 'CC-100' })
        .expect(200);
      expect(res.body).toMatchObject({ name: { en: 'Renamed' }, costCenterCode: 'CC-100' });
      await as(ADMIN)
        .patch(`${ORG}/branches/${branchA.branchId}`)
        .send({ code: 'NEW' })
        .expect(400);
      await as(ADMIN)
        .patch(`${ORG}/branches/${branchA.branchId}`)
        .send({ legalEntityId: entity.legalEntityId })
        .expect(400);
      await as(ADMIN)
        .patch(`${ORG}/legal-entities/${entity.legalEntityId}`)
        .send({ currency: 'USD' })
        .expect(400);
      await as(ADMIN).patch(`${ORG}/branches/${branchA.branchId}`).send({}).expect(400);
    });

    it('refuses to deactivate a unit while anything active hangs beneath it', async () => {
      const { branchA, deptA, deptA2, jobTitle } = await tree();
      const refused = await as(ADMIN)
        .post(`${ORG}/branches/${branchA.branchId}/deactivate`)
        .send({ reason: 'closing the branch' })
        .expect(409);
      expect(refused.body.error.issues).toEqual([{ path: ['status'], code: 'ACTIVE_CHILDREN' }]);

      await place(deptA.departmentId, jobTitle.jobTitleId);
      await as(ADMIN)
        .post(`${ORG}/departments/${deptA.departmentId}/deactivate`)
        .send({ reason: 'merging' })
        .expect(409);
      await as(ADMIN)
        .post(`${ORG}/job-titles/${jobTitle.jobTitleId}/deactivate`)
        .send({ reason: 'title retired' })
        .expect(409);

      // An empty department retires, and stays in storage.
      const retired = await as(ADMIN)
        .post(`${ORG}/departments/${deptA2.departmentId}/deactivate`)
        .send({ reason: 'no longer used' })
        .expect(200);
      expect(retired.body.status).toBe('inactive');
      await as(ADMIN)
        .post(`${ORG}/departments/${deptA2.departmentId}/deactivate`)
        .send({ reason: 'again' })
        .expect(409);
      const reasons = await connection
        .collection(AUDIT_COLLECTION)
        .find({ action: 'org.department.deactivated', 'target.id': deptA2.departmentId })
        .toArray();
      expect(reasons.map((event) => String(event['reason']))).toEqual(['no longer used']);
    });

    it('creates nothing beneath an inactive parent, and reactivates only under an active one', async () => {
      const { branchB, deptB } = await tree();
      await as(ADMIN)
        .post(`${ORG}/departments/${deptB.departmentId}/deactivate`)
        .send({ reason: 'closing' })
        .expect(200);
      const blocked = await as(ADMIN)
        .post(`${ORG}/teams`)
        .send({ departmentId: deptB.departmentId, code: code('TEAM'), name: label('Late') })
        .expect(409);
      expect(blocked.body.error.issues).toEqual([
        { path: ['departmentId'], code: 'PARENT_INACTIVE' },
      ]);
      expect(
        await connection
          .collection(TEAMS_COLLECTION)
          .countDocuments({ departmentId: deptB.departmentId }),
      ).toBe(0);

      await as(ADMIN)
        .post(`${ORG}/branches/${branchB.branchId}/deactivate`)
        .send({ reason: 'closing' })
        .expect(200);
      await as(ADMIN)
        .post(`${ORG}/departments/${deptB.departmentId}/reactivate`)
        .send({ reason: 'reopening' })
        .expect(409);
      await as(ADMIN)
        .post(`${ORG}/branches/${branchB.branchId}/reactivate`)
        .send({ reason: 'reopening' })
        .expect(200);
      await as(ADMIN)
        .post(`${ORG}/departments/${deptB.departmentId}/reactivate`)
        .send({ reason: 'reopening' })
        .expect(200);
    });

    it('never lets a deactivation and a concurrent creation beneath it both succeed', async () => {
      const { branchA, jobTitle } = await tree();
      for (let round = 0; round < 6; round += 1) {
        const department = (
          await as(ADMIN)
            .post(`${ORG}/departments`)
            .send({ branchId: branchA.branchId, code: code('RACE'), name: label('Race') })
            .expect(201)
        ).body as { departmentId: string };
        const [deactivation, creation, placement] = await Promise.all([
          as(ADMIN)
            .post(`${ORG}/departments/${department.departmentId}/deactivate`)
            .send({ reason: 'race' }),
          as(ADMIN)
            .post(`${ORG}/teams`)
            .send({ departmentId: department.departmentId, code: code('RT'), name: label('T') }),
          as(ADMIN).post(`${ORG}/placements`).send({
            displayName: 'Racer',
            departmentId: department.departmentId,
            jobTitleId: jobTitle.jobTitleId,
            startedOn: '2026-01-01',
          }),
        ]);
        const stored = await connection
          .collection(DEPARTMENTS_COLLECTION)
          .findOne({ departmentId: department.departmentId });
        const activeChildren =
          (await connection
            .collection(TEAMS_COLLECTION)
            .countDocuments({ departmentId: department.departmentId, status: 'active' })) +
          (await connection
            .collection(PLACEMENTS_COLLECTION)
            .countDocuments({ departmentId: department.departmentId, status: 'active' }));
        // The invariant: an inactive department never has anything active beneath it.
        if (stored?.['status'] === 'inactive') expect(activeChildren).toBe(0);
        // And every request got a definite answer.
        for (const res of [deactivation, creation, placement]) {
          expect([200, 201, 409]).toContain(res.status);
        }
      }
    });
  });

  /* ============================================== CORE-ORG-004: scoped writes */

  describe('writes are confined to the data scope', () => {
    it('lets a branch administrator change their branch and nothing else, answering 404 outside it', async () => {
      const { entity, branchA, branchB, deptA, deptB, jobTitle } = await tree();
      await bootstrapRole(connection, {
        key: `${RUN}-r-branch-admin`,
        name: label('b'),
        permissions: ['org.view', 'org.manage', 'org.placement.view', 'org.placement.manage'],
      });
      await bootstrapGrant(connection, {
        accountId: BRANCH_ADMIN,
        roleKeys: [`${RUN}-r-branch-admin`],
        scope: scope('branch', { branchIds: [branchA.branchId] }),
        updatedBy: 'test',
      });

      await as(BRANCH_ADMIN)
        .patch(`${ORG}/branches/${branchA.branchId}`)
        .send({ name: label('Mine') })
        .expect(200);
      const hidden = await as(BRANCH_ADMIN)
        .patch(`${ORG}/branches/${branchB.branchId}`)
        .send({ name: label('Not mine') })
        .expect(404);
      const absent = await as(BRANCH_ADMIN)
        .patch(`${ORG}/branches/br_00000000000000000000000000000000`)
        .send({ name: label('Nobody') })
        .expect(404);
      expect(Object.keys(hidden.body.error)).toEqual(Object.keys(absent.body.error));

      await as(BRANCH_ADMIN)
        .post(`${ORG}/departments`)
        .send({ branchId: branchB.branchId, code: code('DEP'), name: label('Intrusion') })
        .expect(404);
      await as(BRANCH_ADMIN)
        .post(`${ORG}/departments/${deptB.departmentId}/deactivate`)
        .send({ reason: 'not mine' })
        .expect(404);
      await as(BRANCH_ADMIN)
        .post(`${ORG}/placements`)
        .send({
          displayName: 'Intruder',
          departmentId: deptB.departmentId,
          jobTitleId: jobTitle.jobTitleId,
          startedOn: '2026-01-01',
        })
        .expect(404);
      // Deployment-wide vocabulary needs the all scope.
      await as(BRANCH_ADMIN)
        .post(`${ORG}/legal-entities`)
        .send({ code: code('LE'), name: label('Mine'), currency: 'EGP', timeZone: 'UTC' })
        .expect(403);
      await as(BRANCH_ADMIN)
        .post(`${ORG}/job-titles`)
        .send({ code: code('JOB'), name: label('Mine') })
        .expect(403);
      await as(BRANCH_ADMIN)
        .patch(`${ORG}/job-titles/${jobTitle.jobTitleId}`)
        .send({ name: label('Renamed') })
        .expect(403);

      // Nothing outside the scope changed.
      const stored = await connection
        .collection(BRANCHES_COLLECTION)
        .findOne({ branchId: branchB.branchId });
      expect((stored?.['name'] as { en: string }).en).toBe('B');
      expect(
        await connection
          .collection(DEPARTMENTS_COLLECTION)
          .countDocuments({ branchId: branchB.branchId }),
      ).toBe(1);

      // Inside the scope, a placement and a transfer within the branch both work…
      const placement = (
        await as(BRANCH_ADMIN)
          .post(`${ORG}/placements`)
          .send({
            displayName: 'Local',
            departmentId: deptA.departmentId,
            jobTitleId: jobTitle.jobTitleId,
            startedOn: '2026-01-01',
          })
          .expect(201)
      ).body as { placementId: string };
      // …but a transfer out of it is refused, and the placement stays where it was.
      await as(BRANCH_ADMIN)
        .post(`${ORG}/placements/${placement.placementId}/transfer`)
        .send({ departmentId: deptB.departmentId, effectiveOn: TODAY, reason: 'moving out' })
        .expect(404);
      const after = await connection
        .collection(PLACEMENTS_COLLECTION)
        .findOne({ placementId: placement.placementId });
      expect(after?.['branchId']).toBe(branchA.branchId);
      expect(entity.legalEntityId).toBeDefined();
    });

    it('lets a legal-entity administrator open branches in their entity only', async () => {
      const first = await tree();
      const second = await tree();
      await bootstrapRole(connection, {
        key: `${RUN}-r-entity-admin`,
        name: label('e'),
        permissions: ['org.view', 'org.manage'],
      });
      await bootstrapGrant(connection, {
        accountId: ENTITY_ADMIN,
        roleKeys: [`${RUN}-r-entity-admin`],
        scope: scope('legalEntity', { legalEntityIds: [first.entity.legalEntityId] }),
        updatedBy: 'test',
      });
      await as(ENTITY_ADMIN)
        .post(`${ORG}/branches`)
        .send({
          legalEntityId: first.entity.legalEntityId,
          code: code('BR'),
          name: label('New'),
          city: label('C'),
        })
        .expect(201);
      await as(ENTITY_ADMIN)
        .post(`${ORG}/branches`)
        .send({
          legalEntityId: second.entity.legalEntityId,
          code: code('BR'),
          name: label('New'),
          city: label('C'),
        })
        .expect(404);
    });
  });

  /* ================================================ CORE-ORG-003: placements */

  describe('effective-dated placements and their history', () => {
    it('transfers from a date, taking the branch and entity from the new department', async () => {
      const { branchB, deptA, deptB, jobTitle } = await tree();
      const oldTeam = await team(deptA.departmentId);
      const newTeam = await team(deptB.departmentId);
      const { placementId } = await place(deptA.departmentId, jobTitle.jobTitleId, {
        teamId: oldTeam.teamId,
      });

      // A team from another department is refused — on transfer and on update alike.
      const wrongTeam = await as(ADMIN)
        .post(`${ORG}/placements/${placementId}/transfer`)
        .send({
          departmentId: deptB.departmentId,
          teamId: oldTeam.teamId,
          effectiveOn: TODAY,
          reason: 'move',
        })
        .expect(409);
      expect(wrongTeam.body.error.issues).toEqual([
        { path: ['teamId'], code: 'TEAM_NOT_IN_DEPARTMENT' },
      ]);
      await as(ADMIN)
        .patch(`${ORG}/placements/${placementId}`)
        .send({ teamId: newTeam.teamId })
        .expect(409);
      await as(ADMIN)
        .post(`${ORG}/placements/${placementId}/transfer`)
        .send({ departmentId: deptB.departmentId, effectiveOn: '2025-12-31', reason: 'backdated' })
        .expect(409);

      const moved = await as(ADMIN)
        .post(`${ORG}/placements/${placementId}/transfer`)
        .send({
          departmentId: deptB.departmentId,
          teamId: newTeam.teamId,
          effectiveOn: TODAY,
          reason: 'reorganisation',
        })
        .expect(200);
      expect(moved.body).toMatchObject({
        departmentId: deptB.departmentId,
        branchId: branchB.branchId,
        teamId: newTeam.teamId,
      });

      const history = await as(ADMIN).get(`${ORG}/placements/${placementId}/history`).expect(200);
      const entries = history.body.items as {
        change: string;
        effectiveOn: string;
        reason?: string;
        before?: Record<string, string>;
        after: Record<string, string>;
      }[];
      expect(entries.map((entry) => entry.change)).toEqual(['transferred', 'created']);
      expect(entries[0]).toMatchObject({ effectiveOn: TODAY, reason: 'reorganisation' });
      expect(entries[0]?.before?.['departmentId']).toBe(deptA.departmentId);
      expect(entries[0]?.after['departmentId']).toBe(deptB.departmentId);
      // History holds organization references only — never a name.
      expect(JSON.stringify(entries)).not.toContain('Person');
    });

    it('ends and resumes a placement, keeping one active placement per account', async () => {
      const { deptA, jobTitle } = await tree();
      const account = `${RUN}-account-${code('A')}`;
      const { placementId } = await place(deptA.departmentId, jobTitle.jobTitleId, {
        accountId: account,
      });
      const ended = await as(ADMIN)
        .post(`${ORG}/placements/${placementId}/deactivate`)
        .send({ effectiveOn: '2026-09-30', reason: 'left the company' })
        .expect(200);
      expect(ended.body).toMatchObject({ status: 'inactive', endedOn: '2026-09-30' });

      // The same person is placed again elsewhere; the old placement cannot come back beside it.
      await place(deptA.departmentId, jobTitle.jobTitleId, { accountId: account });
      const clash = await as(ADMIN)
        .post(`${ORG}/placements/${placementId}/reactivate`)
        .send({ reason: 'mistake' })
        .expect(409);
      expect(clash.body.error.issues).toEqual([
        { path: ['accountId'], code: 'ACCOUNT_ALREADY_PLACED' },
      ]);
      const second = await as(ADMIN)
        .post(`${ORG}/placements`)
        .send({
          displayName: 'Duplicate',
          accountId: account,
          departmentId: deptA.departmentId,
          jobTitleId: jobTitle.jobTitleId,
          startedOn: '2026-01-01',
        })
        .expect(409);
      expect(second.body.error.issues).toEqual([
        { path: ['accountId'], code: 'ACCOUNT_ALREADY_PLACED' },
      ]);
    });

    it('refuses an inactive manager and a reporting cycle', async () => {
      const { deptA, jobTitle } = await tree();
      const boss = await place(deptA.departmentId, jobTitle.jobTitleId);
      const report = await place(deptA.departmentId, jobTitle.jobTitleId, {
        managerPlacementId: boss.placementId,
      });
      await as(ADMIN)
        .patch(`${ORG}/placements/${boss.placementId}`)
        .send({ managerPlacementId: report.placementId })
        .expect(400);
      await as(ADMIN)
        .post(`${ORG}/placements/${boss.placementId}/deactivate`)
        .send({ reason: 'left' })
        .expect(200);
      const refused = await as(ADMIN)
        .post(`${ORG}/placements`)
        .send({
          displayName: 'New report',
          departmentId: deptA.departmentId,
          jobTitleId: jobTitle.jobTitleId,
          managerPlacementId: boss.placementId,
          startedOn: '2026-01-01',
        })
        .expect(409);
      expect(refused.body.error.issues).toEqual([
        { path: ['managerPlacementId'], code: 'MANAGER_INACTIVE' },
      ]);
    });

    it('keeps the history append-only in the model itself', async () => {
      const { deptA, jobTitle } = await tree();
      await place(deptA.departmentId, jobTitle.jobTitleId);
      const history = placementHistoryModel(connection);
      await expect(history.updateMany({}, { $set: { reason: 'rewritten' } })).rejects.toThrow();
      await expect(history.deleteMany({})).rejects.toThrow();
      expect(await history.countDocuments({ reason: 'rewritten' })).toBe(0);
    });
  });

  /* ================================= CORE-ORG-005 and APPROVAL-005: managers */

  describe('manager resolution and escalation', () => {
    it('resolves only an effective manager — never a future, ended or skipped-over one', async () => {
      const { deptA, jobTitle } = await tree();
      const managerAccount = `${RUN}-m-${code('M')}`;
      const reportAccount = `${RUN}-r-${code('R')}`;
      const boss = await place(deptA.departmentId, jobTitle.jobTitleId, {
        accountId: managerAccount,
        startedOn: '2026-10-01',
      });
      await place(deptA.departmentId, jobTitle.jobTitleId, {
        accountId: reportAccount,
        managerPlacementId: boss.placementId,
      });

      today = '2026-09-27';
      expect(await organization.resolveManagerAccount(reportAccount)).toBeUndefined();
      today = '2026-10-01';
      expect(await organization.resolveManagerAccount(reportAccount)).toBe(managerAccount);
      await as(ADMIN)
        .post(`${ORG}/placements/${boss.placementId}/deactivate`)
        .send({ effectiveOn: '2026-10-01', reason: 'left' })
        .expect(200);
      today = '2026-10-02';
      expect(await organization.resolveManagerAccount(reportAccount)).toBeUndefined();
    });

    it('walks the reporting line and stops where the actor may not see', async () => {
      const { deptA, deptB, jobTitle, branchA } = await tree();
      const top = await place(deptB.departmentId, jobTitle.jobTitleId);
      const middle = await place(deptA.departmentId, jobTitle.jobTitleId, {
        managerPlacementId: top.placementId,
      });
      const bottom = await place(deptA.departmentId, jobTitle.jobTitleId, {
        managerPlacementId: middle.placementId,
      });
      const full = await as(ADMIN)
        .get(`${ORG}/placements/${bottom.placementId}/reporting-line`)
        .expect(200);
      expect(
        (full.body.items as { placementId: string }[]).map((item) => item.placementId),
      ).toEqual([bottom.placementId, middle.placementId, top.placementId]);
      expect(full.body.interrupted).toBe(false);

      const viewer = `${RUN}-viewer-${code('V')}`;
      await bootstrapRole(connection, {
        key: `${viewer}-role`,
        name: label('v'),
        permissions: ['org.placement.view'],
      });
      await bootstrapGrant(connection, {
        accountId: viewer,
        roleKeys: [`${viewer}-role`],
        scope: scope('branch', { branchIds: [branchA.branchId] }),
        updatedBy: 'test',
      });
      const partial = await as(viewer)
        .get(`${ORG}/placements/${bottom.placementId}/reporting-line`)
        .expect(200);
      expect(partial.body.items).toHaveLength(2);
      expect(partial.body.interrupted).toBe(true);
    });

    it('escalates an overdue approval to the requester’s manager through the real reporting line', async () => {
      const { deptA, jobTitle } = await tree();
      const managerPlacement = await place(deptA.departmentId, jobTitle.jobTitleId, {
        accountId: MANAGER,
      });
      await place(deptA.departmentId, jobTitle.jobTitleId, {
        accountId: REQUESTER,
        managerPlacementId: managerPlacement.placementId,
      });

      await bootstrapRole(connection, {
        key: `${RUN}-r-approval`,
        name: label('approval'),
        permissions: [
          'approval.policy.create',
          'approval.policy.publish',
          'approval.request.create',
          'approval.request.view',
          'approval.request.approve',
          'approval.request.escalate',
        ],
      });
      for (const accountId of [REQUESTER, MANAGER, APPROVER]) {
        await bootstrapGrant(connection, {
          accountId,
          roleKeys: [`${RUN}-r-approval`],
          scope: scope('all'),
          updatedBy: 'test',
        });
      }
      let clock = new Date('2026-09-27T08:00:00.000Z');
      const approvals = new ApprovalService({
        connection,
        logger: createLogger({ name: 'it-orgf-approval', level: 'silent' }),
        audit,
        accountsWithPermission: (permission) => security.accountsWithPermission(permission),
        resolveActor: (accountId) => security.resolveActor(accountId),
        // The production wiring: CORE-ORG supplies the reporting line (domain-services.ts).
        resolveManager: (accountId) => organization.resolveManagerAccount(accountId),
        now: () => clock,
      });
      const actorOf = async (accountId: string): Promise<ActorContext> => {
        const actor = await security.resolveActor(accountId);
        if (!actor) throw new Error('no actor');
        return actor;
      };
      const context = { correlationId: `${RUN}-escalation` };
      const key = `${RUN}-policy`;
      const operationType = `test.${RUN.replace(/[^a-z0-9]/g, '')}.escalation`;
      const policy = await approvals.createPolicy(
        await actorOf(APPROVER),
        {
          key,
          name: label('Escalation'),
          operationType,
          stages: [
            {
              order: 1,
              name: label('Approver'),
              approvers: { kind: 'accounts', accountIds: [APPROVER] },
              rule: 'any',
              slaHours: 4,
            },
          ],
        } as never,
        context,
      );
      await approvals.publishPolicy(await actorOf(APPROVER), key, policy.version, context);
      const submitted = await approvals.submit(
        await actorOf(REQUESTER),
        {
          operationType,
          source: { type: 'test.resource', id: `${RUN}-source` },
          scope: {},
          context: {},
          summary: [],
          idempotencyKey: `${RUN}-idempotency`,
        },
        context,
      );

      clock = new Date(clock.getTime() + 5 * 3_600_000);
      const swept = await approvals.escalateOverdue(await actorOf(APPROVER), context);
      expect(swept).toMatchObject({ escalated: 1, unresolved: 0 });
      const stored = await connection
        .collection('approvalRequests')
        .findOne({ requestId: submitted.request.requestId });
      expect(stored?.['pendingApproverAccountIds']).toEqual(
        expect.arrayContaining([APPROVER, MANAGER]),
      );
    });
  });
});
