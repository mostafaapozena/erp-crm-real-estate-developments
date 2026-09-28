import {
  ORG_AUDIT_ACTIONS,
  ScopeAssignmentSchema,
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
  TEAMS_COLLECTION,
  placementModel,
} from './model';
import { organizationRouter } from './router';
import { OrganizationService } from './service';

/**
 * `CORE-ORG` demonstration slice against a real MongoDB replica set.
 *
 * The three properties worth proving here are the ones other modules will depend on and cannot check
 * for themselves: the hierarchy is scoped inside the query, a reporting cycle can never be stored, and
 * the reporting line resolves to a manager's **account** so the approval engine can escalate along it.
 */
const gate = serviceGate(['mongodb']);
const RUN = `it-org-${Date.now()}`;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const ACCOUNT_HEADER = 'x-test-account';

const scope = (level: ScopeAssignment['level'], overrides: Partial<ScopeAssignment> = {}) =>
  ScopeAssignmentSchema.parse({ level, ...overrides });

const label = (en: string) => ({ ar: `عربي ${en}`, en });

describe.skipIf(!gate.available)(`organization module — ${gate.reason}`, () => {
  let connection: Connection;
  let audit: AuditService;
  let security: SecurityService;
  let organization: OrganizationService;
  let app: Express;

  const R_ADMIN = `${RUN}-r-admin`;
  const R_VIEWER = `${RUN}-r-viewer`;
  const R_BRANCH_VIEWER = `${RUN}-r-branch-viewer`;
  const R_AUDITOR = `${RUN}-r-auditor`;

  const ADMIN = `${RUN}-admin`;
  const VIEWER = `${RUN}-viewer`;
  const BRANCH_VIEWER = `${RUN}-branch-viewer`;
  const AUDITOR = `${RUN}-auditor`;
  const NO_GRANT = `${RUN}-no-grant`;

  const api = () => request(app);
  const as = (accountId?: string) => {
    const withAccount = <T extends { set: (field: string, value: string) => T }>(call: T): T =>
      accountId ? call.set(ACCOUNT_HEADER, accountId) : call;
    return {
      get: (path: string) => withAccount(api().get(path)),
      post: (path: string) => withAccount(api().post(path).set('Origin', ALLOWED_ORIGIN)),
      patch: (path: string) => withAccount(api().patch(path).set('Origin', ALLOWED_ORIGIN)),
    };
  };

  let codeCounter = 0;
  const nextCode = (prefix: string) => {
    codeCounter += 1;
    return `${prefix}-${codeCounter}`;
  };

  /** A whole tree in one call; most tests care about one property of it, not about building it. */
  async function buildTree() {
    const entity = await as(ADMIN)
      .post('/api/v1/organization/legal-entities')
      .send({
        code: nextCode('LE'),
        name: label('Entity'),
        currency: 'EGP',
        timeZone: 'Africa/Cairo',
      })
      .expect(201);
    const branchA = await as(ADMIN)
      .post('/api/v1/organization/branches')
      .send({
        legalEntityId: entity.body.legalEntityId,
        code: nextCode('BR'),
        name: label('Branch A'),
        city: label('Cairo'),
      })
      .expect(201);
    const branchB = await as(ADMIN)
      .post('/api/v1/organization/branches')
      .send({
        legalEntityId: entity.body.legalEntityId,
        code: nextCode('BR'),
        name: label('Branch B'),
        city: label('Giza'),
      })
      .expect(201);
    const deptA = await as(ADMIN)
      .post('/api/v1/organization/departments')
      .send({ branchId: branchA.body.branchId, code: nextCode('DEP'), name: label('Sales A') })
      .expect(201);
    const deptB = await as(ADMIN)
      .post('/api/v1/organization/departments')
      .send({ branchId: branchB.body.branchId, code: nextCode('DEP'), name: label('Sales B') })
      .expect(201);
    const jobTitle = await as(ADMIN)
      .post('/api/v1/organization/job-titles')
      .send({ code: nextCode('JOB'), name: label('Consultant') })
      .expect(201);
    return {
      entity: entity.body,
      branchA: branchA.body,
      branchB: branchB.body,
      deptA: deptA.body,
      deptB: deptB.body,
      jobTitle: jobTitle.body,
    };
  }

  beforeAll(async () => {
    configureMongoose();
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'] as string,
    });
    await connection.asPromise();
    await ensureIndexes(connection, createLogger({ name: 'it-org', level: 'silent' }));

    const logger = createLogger({ name: 'it-org', level: 'silent' });
    audit = new AuditService({ connection, logger, onRecorded: noteAuditWrite });
    security = new SecurityService({ connection, audit, logger });
    organization = new OrganizationService({ connection, audit });

    const all: Permission[] = [
      'org.view',
      'org.manage',
      'org.placement.view',
      'org.placement.manage',
    ];
    await bootstrapRole(connection, { key: R_ADMIN, name: label('admin'), permissions: all });
    await bootstrapRole(connection, {
      key: R_VIEWER,
      name: label('viewer'),
      permissions: ['org.view', 'org.placement.view'],
    });
    await bootstrapRole(connection, {
      key: R_BRANCH_VIEWER,
      name: label('branch viewer'),
      permissions: ['org.view', 'org.placement.view'],
    });
    await bootstrapGrant(connection, {
      accountId: ADMIN,
      roleKeys: [R_ADMIN],
      scope: scope('all'),
      updatedBy: 'test',
    });
    await bootstrapGrant(connection, {
      accountId: VIEWER,
      roleKeys: [R_VIEWER],
      scope: scope('all'),
      updatedBy: 'test',
    });
    await bootstrapRole(connection, {
      key: R_AUDITOR,
      name: label('auditor'),
      permissions: ['audit.view', 'audit.viewChanges'],
    });
    await bootstrapGrant(connection, {
      accountId: AUDITOR,
      roleKeys: [R_AUDITOR],
      scope: scope('all'),
      updatedBy: 'test',
    });

    // The test resolver reads an account id from a header and resolves grants from the database. It is
    // a fixture for exercising authorization, never authentication; production has no such path.
    const actorResolver: ActorResolver = async (req) => {
      const accountId = req.get(ACCOUNT_HEADER);
      return accountId ? security.resolveActor(accountId) : undefined;
    };

    /** The real denial-audit hook, so a refusal leaves the same evidence it does in production. */
    const guard = {
      onDenied: async (denial: {
        requiredPermission: string;
        actor?: { kind: 'account' | 'system'; accountId: string; roleKeys: string[] } | undefined;
        correlationId: string;
        method: string;
        route: string;
      }) => {
        await audit.record({
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
        });
      },
    };

    const modules: ApiModule[] = [
      {
        basePath: '/organization',
        router: organizationRouter({ getService: () => organization, guard }),
      },
    ];
    app = createApp({
      config: {
        CORS_ALLOWED_ORIGINS: [ALLOWED_ORIGIN],
        TRUST_PROXY_HOPS: 1,
        APP_ENV: 'test',
      },
      logger,
      mongo: { health: () => Promise.resolve({ status: 'up', transactions: true }) },
      redis: { health: () => Promise.resolve({ status: 'up' }) },
      rateLimiter: new RateLimiterMemory({ points: 10_000, duration: 60 }),
      modules,
      actorResolver,
    });
  });

  afterAll(async () => {
    if (!connection) return;
    // Cleanup uses the raw driver: the application has no delete path for these collections (ADR-0009).
    // That is the privileged path ADR-0021 documents as a residual risk, not a loophole.
    await connection.collection(ROLES_COLLECTION).deleteMany({ key: { $regex: `^${RUN}` } });
    await connection
      .collection(ACCOUNT_GRANTS_COLLECTION)
      .deleteMany({ accountId: { $regex: `^${RUN}` } });
    await connection
      .collection(AUDIT_COLLECTION)
      .deleteMany({ 'actor.accountId': { $regex: `^${RUN}` } });
    await connection.collection(LEGAL_ENTITIES_COLLECTION).deleteMany({});
    await connection.collection(BRANCHES_COLLECTION).deleteMany({});
    await connection.collection(DEPARTMENTS_COLLECTION).deleteMany({});
    await connection.collection(TEAMS_COLLECTION).deleteMany({});
    await connection.collection(JOB_TITLES_COLLECTION).deleteMany({});
    await connection.collection(PLACEMENTS_COLLECTION).deleteMany({});
    await connection.close();
  });

  beforeEach(async () => {
    await connection.collection(PLACEMENTS_COLLECTION).deleteMany({});
  });

  describe('authorization', () => {
    it('answers 401 without an actor and 403 without the permission', async () => {
      await api().get('/api/v1/organization/branches').expect(401);
      await bootstrapGrant(connection, {
        accountId: NO_GRANT,
        roleKeys: [],
        scope: scope('all'),
        updatedBy: 'test',
      });
      await as(NO_GRANT).get('/api/v1/organization/branches').expect(403);
    });

    it('refuses a write to an actor holding only the read permission, and stores nothing', async () => {
      const before = await connection.collection(JOB_TITLES_COLLECTION).countDocuments();
      await as(VIEWER)
        .post('/api/v1/organization/job-titles')
        .send({ code: nextCode('JOB'), name: label('Refused') })
        .expect(403);
      expect(await connection.collection(JOB_TITLES_COLLECTION).countDocuments()).toBe(before);
    });

    it('never names the missing permission in the response body', async () => {
      const response = await as(VIEWER)
        .post('/api/v1/organization/job-titles')
        .send({ code: nextCode('JOB'), name: label('Refused') })
        .expect(403);
      expect(JSON.stringify(response.body)).not.toContain('org.manage');
      expect(response.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('hierarchy', () => {
    it('denormalizes the parent chain from the parent, never from the request', async () => {
      const tree = await buildTree();
      const team = await as(ADMIN)
        .post('/api/v1/organization/teams')
        .send({ departmentId: tree.deptA.departmentId, code: nextCode('TM'), name: label('Team') })
        .expect(201);
      expect(team.body.branchId).toBe(tree.branchA.branchId);
      expect(team.body.legalEntityId).toBe(tree.entity.legalEntityId);
    });

    it('rejects an unknown field rather than dropping it (mass assignment)', async () => {
      const response = await as(ADMIN)
        .post('/api/v1/organization/job-titles')
        .send({ code: nextCode('JOB'), name: label('X'), status: 'inactive' })
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a duplicate code within the same parent and keeps the original', async () => {
      const tree = await buildTree();
      const code = nextCode('DEP');
      await as(ADMIN)
        .post('/api/v1/organization/departments')
        .send({ branchId: tree.branchA.branchId, code, name: label('First') })
        .expect(201);
      await as(ADMIN)
        .post('/api/v1/organization/departments')
        .send({ branchId: tree.branchA.branchId, code, name: label('Second') })
        .expect(409);
      const stored = await connection
        .collection(DEPARTMENTS_COLLECTION)
        .find({ branchId: tree.branchA.branchId, code })
        .toArray();
      expect(stored).toHaveLength(1);
      expect((stored[0] as unknown as { name: { en: string } }).name.en).toBe('First');
    });

    it('allows the same code under two different parents', async () => {
      const tree = await buildTree();
      const code = nextCode('DEP');
      await as(ADMIN)
        .post('/api/v1/organization/departments')
        .send({ branchId: tree.branchA.branchId, code, name: label('A') })
        .expect(201);
      await as(ADMIN)
        .post('/api/v1/organization/departments')
        .send({ branchId: tree.branchB.branchId, code, name: label('B') })
        .expect(201);
    });

    it('refuses a child of a parent that does not exist', async () => {
      await as(ADMIN)
        .post('/api/v1/organization/branches')
        .send({
          legalEntityId: 'le_00000000000000000000000000000000',
          code: nextCode('BR'),
          name: label('Orphan'),
          city: label('Nowhere'),
        })
        .expect(404);
    });
  });

  describe('data scope inside the query (SEC-027, SEC-028)', () => {
    it('shows a branch-scoped actor only its own branch, and the counts agree', async () => {
      const tree = await buildTree();
      await bootstrapGrant(connection, {
        accountId: BRANCH_VIEWER,
        roleKeys: [R_BRANCH_VIEWER],
        scope: scope('branch', { branchIds: [tree.branchA.branchId] }),
        updatedBy: 'test',
      });

      const all = await as(VIEWER).get('/api/v1/organization/departments').expect(200);
      const scoped = await as(BRANCH_VIEWER).get('/api/v1/organization/departments').expect(200);
      const scopedItems = scoped.body.items as { departmentId: string; branchId: string }[];
      const scopedIds = scopedItems.map((d) => d.departmentId);

      expect(all.body.items.length).toBeGreaterThan(scoped.body.items.length);
      expect(scopedIds).toContain(tree.deptA.departmentId);
      expect(scopedIds).not.toContain(tree.deptB.departmentId);
      for (const item of scopedItems) {
        expect(item.branchId).toBe(tree.branchA.branchId);
      }
    });

    it('returns nothing, not everything, for a scope that cannot be satisfied', async () => {
      await buildTree();
      const account = `${RUN}-unsatisfiable`;
      await bootstrapGrant(connection, {
        accountId: account,
        roleKeys: [R_VIEWER],
        // A project-level scope with no project references, against records that carry no project.
        scope: scope('project'),
        updatedBy: 'test',
      });
      const response = await as(account).get('/api/v1/organization/departments').expect(200);
      expect(response.body.items).toEqual([]);
    });

    it('rejects an operator object smuggled into a query parameter', async () => {
      await as(VIEWER).get('/api/v1/organization/placements?departmentId[$ne]=x').expect(400);
    });
  });

  describe('placements and the reporting line', () => {
    async function placeTwo() {
      const tree = await buildTree();
      const manager = await as(ADMIN)
        .post('/api/v1/organization/placements')
        .send({
          accountId: `${RUN}-manager-account`,
          displayName: 'Manager One',
          departmentId: tree.deptA.departmentId,
          jobTitleId: tree.jobTitle.jobTitleId,
          startedOn: '2026-01-01',
        })
        .expect(201);
      const report = await as(ADMIN)
        .post('/api/v1/organization/placements')
        .send({
          accountId: `${RUN}-report-account`,
          displayName: 'Report One',
          departmentId: tree.deptA.departmentId,
          jobTitleId: tree.jobTitle.jobTitleId,
          managerPlacementId: manager.body.placementId,
          startedOn: '2026-01-01',
        })
        .expect(201);
      return { tree, manager: manager.body, report: report.body };
    }

    it("resolves a direct manager's account, which is what APPROVAL-005 escalates to", async () => {
      const { report } = await placeTwo();
      expect(report.managerPlacementId).toBeDefined();
      await expect(organization.resolveManagerAccount(`${RUN}-report-account`)).resolves.toBe(
        `${RUN}-manager-account`,
      );
    });

    it('resolves nothing — rather than inventing an approver — when the manager is deactivated', async () => {
      const { manager } = await placeTwo();
      await as(ADMIN)
        .patch(`/api/v1/organization/placements/${manager.placementId}`)
        .send({ status: 'inactive' })
        .expect(200);
      await expect(
        organization.resolveManagerAccount(`${RUN}-report-account`),
      ).resolves.toBeUndefined();
    });

    it('resolves nothing when the placement has no manager at all', async () => {
      await placeTwo();
      await expect(
        organization.resolveManagerAccount(`${RUN}-manager-account`),
      ).resolves.toBeUndefined();
    });

    it('refuses a self-referencing manager and stores nothing', async () => {
      const { report } = await placeTwo();
      await as(ADMIN)
        .patch(`/api/v1/organization/placements/${report.placementId}`)
        .send({ managerPlacementId: report.placementId })
        .expect(400);
      const stored = await placementModel(connection)
        .findOne({ placementId: report.placementId })
        .lean()
        .exec();
      expect(stored?.managerPlacementId).not.toBe(report.placementId);
    });

    it('refuses a reporting cycle and leaves the existing line untouched', async () => {
      const { manager, report } = await placeTwo();
      // manager ← report already. Making the manager report to its own report closes the loop.
      await as(ADMIN)
        .patch(`/api/v1/organization/placements/${manager.placementId}`)
        .send({ managerPlacementId: report.placementId })
        .expect(400);
      const stored = await placementModel(connection)
        .findOne({ placementId: manager.placementId })
        .lean()
        .exec();
      expect(stored?.managerPlacementId).toBeUndefined();
      // And the line that did exist still resolves.
      await expect(organization.resolveManagerAccount(`${RUN}-report-account`)).resolves.toBe(
        `${RUN}-manager-account`,
      );
    });

    it('allows one account only one active placement', async () => {
      const { tree } = await placeTwo();
      await expect(
        placementModel(connection).create({
          placementId: 'plc_duplicateaccounttest00000000000',
          accountId: `${RUN}-manager-account`,
          displayName: 'Duplicate',
          legalEntityId: tree.entity.legalEntityId,
          branchId: tree.branchA.branchId,
          departmentId: tree.deptA.departmentId,
          jobTitleId: tree.jobTitle.jobTitleId,
          status: 'active',
          startedOn: '2026-01-01',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ).rejects.toThrow();
    });
  });

  describe('people lookup (ADR-0031)', () => {
    it('names the references asked about, and nothing else', async () => {
      const tree = await buildTree();
      // Branch B: outside the branch viewer's scope, and the lookup still names the person.
      await as(ADMIN)
        .post('/api/v1/organization/placements')
        .send({
          accountId: `${RUN}-people-b`,
          displayName: 'Colleague In Branch B',
          departmentId: tree.deptB.departmentId,
          jobTitleId: tree.jobTitle.jobTitleId,
          startedOn: '2026-01-01',
        })
        .expect(201);
      await as(ADMIN)
        .post('/api/v1/organization/placements')
        .send({
          accountId: `${RUN}-people-a`,
          displayName: 'Colleague In Branch A',
          departmentId: tree.deptA.departmentId,
          jobTitleId: tree.jobTitle.jobTitleId,
          startedOn: '2026-01-01',
        })
        .expect(201);

      const response = await as(NO_GRANT)
        .get(`/api/v1/organization/people?ids=${RUN}-people-b,${RUN}-unknown`)
        .expect(200);
      expect(response.body.items).toEqual([
        {
          accountId: `${RUN}-people-b`,
          displayName: 'Colleague In Branch B',
          jobTitle: label('Consultant'),
        },
      ]);
      // Only directory fields: no placement, branch, department or employee reference leaks.
      expect(Object.keys(response.body.items[0]).sort()).toEqual([
        'accountId',
        'displayName',
        'jobTitle',
      ]);
    });

    it('requires a signed-in caller and bounded, well-formed references', async () => {
      await as().get(`/api/v1/organization/people?ids=${RUN}-people-a`).expect(401);
      await as(NO_GRANT).get('/api/v1/organization/people').expect(400);
      await as(NO_GRANT).get('/api/v1/organization/people?ids=%24where').expect(400);
      const tooMany = Array.from({ length: 101 }, (_, index) => `acc_${index}`).join(',');
      await as(NO_GRANT).get(`/api/v1/organization/people?ids=${tooMany}`).expect(400);
    });

    it('omits an ended placement rather than naming a former holder', async () => {
      const tree = await buildTree();
      const placement = await as(ADMIN)
        .post('/api/v1/organization/placements')
        .send({
          accountId: `${RUN}-people-ended`,
          displayName: 'Former Colleague',
          departmentId: tree.deptA.departmentId,
          jobTitleId: tree.jobTitle.jobTitleId,
          startedOn: '2026-01-01',
        })
        .expect(201);
      await placementModel(connection)
        .updateOne({ placementId: placement.body.placementId }, { $set: { status: 'inactive' } })
        .exec();
      const response = await as(NO_GRANT)
        .get(`/api/v1/organization/people?ids=${RUN}-people-ended`)
        .expect(200);
      expect(response.body.items).toEqual([]);
    });
  });

  describe('no hard delete (ADR-0009)', () => {
    it('refuses every deletion path on a placement', async () => {
      const tree = await buildTree();
      const created = await as(ADMIN)
        .post('/api/v1/organization/placements')
        .send({
          displayName: 'Undeletable',
          departmentId: tree.deptA.departmentId,
          jobTitleId: tree.jobTitle.jobTitleId,
          startedOn: '2026-01-01',
        })
        .expect(201);

      const model = placementModel(connection);
      await expect(model.deleteOne({ placementId: created.body.placementId })).rejects.toThrow(
        /never deleted/,
      );
      await expect(model.deleteMany({})).rejects.toThrow(/never deleted/);
      await expect(
        model.findOneAndDelete({ placementId: created.body.placementId }),
      ).rejects.toThrow(/never deleted/);

      const still = await model.findOne({ placementId: created.body.placementId }).lean().exec();
      expect(still).not.toBeNull();
    });
  });

  describe('audit (AUDIT-003, AUDIT-005)', () => {
    it('records a create with a summary, visible only to an actor holding audit.viewChanges', async () => {
      const code = nextCode('JOB');
      const created = await as(ADMIN)
        .post('/api/v1/organization/job-titles')
        .send({ code, name: label('Audited') })
        .expect(201);

      const query = {
        limit: 10,
        action: ORG_AUDIT_ACTIONS.jobTitleCreated,
        targetId: created.body.jobTitleId,
      };

      // The auditor holds audit.viewChanges, so the before/after summary is present.
      const auditorActor = await security.resolveActor(AUDITOR);
      const seen = await audit.query(auditorActor!, query);
      expect(seen.items).toHaveLength(1);
      expect(seen.items[0]?.outcome).toBe('succeeded');
      expect(seen.items[0]?.changes?.some((c) => c.path === 'code')).toBe(true);

      // The organization administrator does not hold it, so the field is **absent** for them — not
      // null and not masked (SEC-029). Same record, same query, different serialization.
      const adminActor = await security.resolveActor(ADMIN);
      const restricted = await audit.query(adminActor!, query);
      expect(restricted.items).toHaveLength(1);
      expect(restricted.items[0]).not.toHaveProperty('changes');
    });

    it('records a refused write as a security event, without naming the permission to the client', async () => {
      const response = await as(VIEWER)
        .post('/api/v1/organization/teams')
        .send({
          departmentId: 'dept_00000000000000000000000000000000',
          code: 'XX',
          name: label('X'),
        })
        .expect(403);
      expect(JSON.stringify(response.body)).not.toContain('org.manage');

      const denials = await connection
        .collection(AUDIT_COLLECTION)
        .find({ action: 'security.authorization.denied', 'actor.accountId': VIEWER })
        .toArray();
      expect(denials.length).toBeGreaterThan(0);
      // The evidence names the permission; the answer to the caller never does (SEC-030).
      expect(JSON.stringify(denials)).toContain('org.manage');
    });
  });
});
