import {
  BusinessDateSchema,
  CRM_AUDIT_ACTIONS,
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
  ACTIVITIES_COLLECTION,
  CUSTOMERS_COLLECTION,
  LEADS_COLLECTION,
  activityModel,
  leadModel,
} from './model';
import { crmRouter } from './router';
import { CrmService } from './service';

/**
 * CRM against a real MongoDB replica set.
 *
 * The properties under test are the three that are easy to get backwards: a duplicate phone number
 * warns rather than refuses, a sales representative cannot assign work to a colleague or see theirs,
 * and every dashboard figure obeys the same scope as the list it summarizes.
 */
const gate = serviceGate(['mongodb']);
const RUN = `it-crm-${Date.now()}`;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const ACCOUNT_HEADER = 'x-test-account';

const scope = (level: ScopeAssignment['level'], overrides: Partial<ScopeAssignment> = {}) =>
  ScopeAssignmentSchema.parse({ level, ...overrides });

const label = (en: string) => ({ ar: `عربي ${en}`, en });

const LEGAL_ENTITY = 'le_crmtestlegalentity00000000000001';
const BRANCH_A = 'br_crmtestbranchaaaaaaaaaaaaaaaa001';
const BRANCH_B = 'br_crmtestbranchbbbbbbbbbbbbbbbb002';
const TEAM_A = 'team_crmtestteamaaaaaaaaaaaaaaa0001';
const PROJECT_A = 'prj_crmtestprojectaaaaaaaaaaaaa0001';

/** A fixed "today", so a follow-up test does not depend on when it runs. */
const TODAY = BusinessDateSchema.parse('2026-09-22');
const YESTERDAY = BusinessDateSchema.parse('2026-09-21');
const TOMORROW = BusinessDateSchema.parse('2026-09-23');

describe.skipIf(!gate.available)(`crm module — ${gate.reason}`, () => {
  let connection: Connection;
  let audit: AuditService;
  let security: SecurityService;
  let crm: CrmService;
  let app: Express;

  const R_MANAGER = `${RUN}-r-manager`;
  const R_REP = `${RUN}-r-rep`;

  const MANAGER = `${RUN}-manager`;
  const REP_ONE = `${RUN}-rep-one`;
  const REP_TWO = `${RUN}-rep-two`;
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

  let counter = 0;
  const nextPhone = () => {
    counter += 1;
    return `+2010${String(counter).padStart(8, '0')}`;
  };

  async function createLead(
    accountId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{
    lead: { leadId: string; stage: string; version: number };
    possibleDuplicate?: unknown;
  }> {
    const response = await as(accountId)
      .post('/api/v1/crm/leads')
      .send({
        name: 'عميل تجريبي',
        primaryPhone: nextPhone(),
        source: 'facebook',
        branchId: BRANCH_A,
        teamId: TEAM_A,
        interestedProjectId: PROJECT_A,
        ...overrides,
      })
      .expect(201);
    return response.body as {
      lead: { leadId: string; stage: string; version: number };
      possibleDuplicate?: unknown;
    };
  }

  beforeAll(async () => {
    configureMongoose();
    const logger = createLogger({ name: 'it-crm', level: 'silent' });
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'] as string,
    });
    await connection.asPromise();
    await ensureIndexes(connection, logger);

    audit = new AuditService({ connection, logger, onRecorded: noteAuditWrite });
    security = new SecurityService({ connection, audit, logger });
    crm = new CrmService({
      connection,
      audit,
      resolveBranch: (branchId) =>
        Promise.resolve(
          branchId === BRANCH_A || branchId === BRANCH_B
            ? { legalEntityId: LEGAL_ENTITY }
            : undefined,
        ),
      today: () => TODAY,
    });

    const managerPermissions: Permission[] = [
      'crm.customer.view',
      'crm.customer.manage',
      'crm.lead.view',
      'crm.lead.create',
      'crm.lead.edit',
      'crm.lead.assign',
      'crm.activity.create',
    ];
    const repPermissions: Permission[] = [
      'crm.customer.view',
      'crm.lead.view',
      'crm.lead.create',
      'crm.lead.edit',
      'crm.activity.create',
    ];
    await bootstrapRole(connection, {
      key: R_MANAGER,
      name: label('sales manager'),
      permissions: managerPermissions,
    });
    await bootstrapRole(connection, {
      key: R_REP,
      name: label('sales representative'),
      permissions: repPermissions,
    });
    await bootstrapGrant(connection, {
      accountId: MANAGER,
      roleKeys: [R_MANAGER],
      scope: scope('all'),
      updatedBy: 'test',
    });
    // Representatives see **their own** leads: the `assigned` scope resolves to assignedToAccountId.
    for (const accountId of [REP_ONE, REP_TWO]) {
      await bootstrapGrant(connection, {
        accountId,
        roleKeys: [R_REP],
        scope: scope('assigned'),
        updatedBy: 'test',
      });
    }

    const actorResolver: ActorResolver = async (req) => {
      const accountId = req.get(ACCOUNT_HEADER);
      return accountId ? security.resolveActor(accountId) : undefined;
    };

    const modules: ApiModule[] = [
      { basePath: '/crm', router: crmRouter({ getService: () => crm }) },
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

  afterAll(async () => {
    if (!connection) return;
    for (const name of [ACTIVITIES_COLLECTION, LEADS_COLLECTION, CUSTOMERS_COLLECTION]) {
      await connection.collection(name).deleteMany({});
    }
    await connection.collection(ROLES_COLLECTION).deleteMany({ key: { $regex: `^${RUN}` } });
    await connection
      .collection(ACCOUNT_GRANTS_COLLECTION)
      .deleteMany({ accountId: { $regex: `^${RUN}` } });
    await connection
      .collection(AUDIT_COLLECTION)
      .deleteMany({ 'actor.accountId': { $regex: `^${RUN}` } });
    await connection.close();
  });

  beforeEach(async () => {
    for (const name of [ACTIVITIES_COLLECTION, LEADS_COLLECTION, CUSTOMERS_COLLECTION]) {
      await connection.collection(name).deleteMany({});
    }
  });

  describe('authorization', () => {
    it('answers 401 without an actor and 403 without the permission', async () => {
      await api().get('/api/v1/crm/leads').expect(401);
      await bootstrapGrant(connection, {
        accountId: NO_GRANT,
        roleKeys: [],
        scope: scope('all'),
        updatedBy: 'test',
      });
      await as(NO_GRANT).get('/api/v1/crm/leads').expect(403);
    });

    it('refuses a representative the assign endpoint and changes nothing', async () => {
      const { lead } = await createLead(REP_ONE);
      await as(REP_ONE)
        .post(`/api/v1/crm/leads/${lead.leadId}/assign`)
        .send({ assignedToAccountId: REP_TWO, reason: 'trying to hand it over' })
        .expect(403);
      const stored = await leadModel(connection).findOne({ leadId: lead.leadId }).lean().exec();
      expect(stored?.assignedToAccountId).toBe(REP_ONE);
    });

    it('ignores assignedToAccountId from a caller who may not assign, rather than erroring', async () => {
      // A representative's client may send the field; the right answer is "the lead is yours".
      const { lead } = await createLead(REP_ONE, { assignedToAccountId: REP_TWO });
      const stored = await leadModel(connection).findOne({ leadId: lead.leadId }).lean().exec();
      expect(stored?.assignedToAccountId).toBe(REP_ONE);
    });

    it('honours it for a manager who holds crm.lead.assign', async () => {
      const { lead } = await createLead(MANAGER, { assignedToAccountId: REP_TWO });
      const stored = await leadModel(connection).findOne({ leadId: lead.leadId }).lean().exec();
      expect(stored?.assignedToAccountId).toBe(REP_TWO);
    });

    it('rejects an unknown field and an operator object', async () => {
      await as(MANAGER)
        .post('/api/v1/crm/leads')
        .send({
          name: 'x y',
          primaryPhone: nextPhone(),
          source: 'walkIn',
          branchId: BRANCH_A,
          stage: 'won',
        })
        .expect(400);
      await as(MANAGER).get('/api/v1/crm/leads?stage[$ne]=lost').expect(400);
    });
  });

  describe('data scope (SEC-027, SEC-028, SEC-030)', () => {
    it('shows a representative only their own leads, with a total that agrees', async () => {
      await createLead(MANAGER, { assignedToAccountId: REP_ONE });
      await createLead(MANAGER, { assignedToAccountId: REP_ONE });
      await createLead(MANAGER, { assignedToAccountId: REP_TWO });

      const all = await as(MANAGER).get('/api/v1/crm/leads?limit=50').expect(200);
      const mine = await as(REP_ONE).get('/api/v1/crm/leads?limit=50').expect(200);

      expect(all.body.total).toBe(3);
      expect(mine.body.total).toBe(2);
      for (const lead of mine.body.items as { assignedToAccountId: string }[]) {
        expect(lead.assignedToAccountId).toBe(REP_ONE);
      }
    });

    it("answers 404 for a colleague's lead, identically to one that does not exist", async () => {
      const { lead } = await createLead(MANAGER, { assignedToAccountId: REP_TWO });
      const hidden = await as(REP_ONE).get(`/api/v1/crm/leads/${lead.leadId}`).expect(404);
      const absent = await as(REP_ONE)
        .get('/api/v1/crm/leads/lead_doesnotexist0000000000000001')
        .expect(404);
      expect(hidden.body.error.code).toBe(absent.body.error.code);
      expect(Object.keys(hidden.body.error)).toEqual(Object.keys(absent.body.error));
    });

    it("refuses to let a representative read a colleague's timeline", async () => {
      const { lead } = await createLead(MANAGER, { assignedToAccountId: REP_TWO });
      await as(REP_ONE).get(`/api/v1/crm/leads/${lead.leadId}/activities`).expect(404);
    });

    it('scopes every dashboard figure the same way as the list', async () => {
      await createLead(MANAGER, { assignedToAccountId: REP_ONE });
      await createLead(MANAGER, { assignedToAccountId: REP_ONE, source: 'referral' });
      await createLead(MANAGER, { assignedToAccountId: REP_TWO, source: 'broker' });

      const managerView = await as(MANAGER).get('/api/v1/crm/dashboard').expect(200);
      const repView = await as(REP_ONE).get('/api/v1/crm/dashboard').expect(200);

      expect(managerView.body.totalLeads).toBe(3);
      expect(repView.body.totalLeads).toBe(2);
      expect(repView.body.bySource.broker).toBeUndefined();
      expect(repView.body.byOwner).toHaveLength(1);
      expect(repView.body.byOwner[0].accountId).toBe(REP_ONE);
    });
  });

  describe('duplicate phone numbers', () => {
    it('creates the lead and reports the earlier one rather than refusing', async () => {
      const phone = nextPhone();
      const first = await createLead(MANAGER, { primaryPhone: phone });
      const second = await createLead(MANAGER, { primaryPhone: phone });

      expect(second.possibleDuplicate).toBeDefined();
      expect((second.possibleDuplicate as { leadId: string }).leadId).toBe(first.lead.leadId);
      expect(await leadModel(connection).countDocuments({ primaryPhoneDigits: /\d/ })).toBe(2);
    });

    it('matches on digits, so formatting differences still find the duplicate', async () => {
      await createLead(MANAGER, { primaryPhone: '+20 100 555 0001' });
      const second = await createLead(MANAGER, { primaryPhone: '(20)100-555-0001' });
      expect(second.possibleDuplicate).toBeDefined();
    });

    it('stores the phone number exactly as entered', async () => {
      const entered = '+20 100 555 0042';
      const { lead } = await createLead(MANAGER, { primaryPhone: entered });
      const read = await as(MANAGER).get(`/api/v1/crm/leads/${lead.leadId}`).expect(200);
      expect(read.body.primaryPhone).toBe(entered);
    });

    it('does not warn about a lead that has already concluded', async () => {
      const phone = nextPhone();
      const first = await createLead(MANAGER, { primaryPhone: phone });
      await as(MANAGER)
        .post(`/api/v1/crm/leads/${first.lead.leadId}/stage`)
        .send({ stage: 'lost', reason: 'bought elsewhere' })
        .expect(200);
      const second = await createLead(MANAGER, { primaryPhone: phone });
      expect(second.possibleDuplicate).toBeUndefined();
    });

    it('refuses a **customer** with a duplicate phone, because that identity must be one record', async () => {
      const phone = nextPhone();
      await as(MANAGER)
        .post('/api/v1/crm/customers')
        .send({ name: 'عميل أول', primaryPhone: phone, branchId: BRANCH_A })
        .expect(201);
      await as(MANAGER)
        .post('/api/v1/crm/customers')
        .send({ name: 'عميل ثانٍ', primaryPhone: phone, branchId: BRANCH_A })
        .expect(409);
    });
  });

  describe('the pipeline', () => {
    it('permits a move the pipeline allows and records it on the timeline', async () => {
      const { lead } = await createLead(MANAGER);
      await as(MANAGER)
        .post(`/api/v1/crm/leads/${lead.leadId}/stage`)
        .send({ stage: 'contacted' })
        .expect(200);
      const activities = await as(MANAGER)
        .get(`/api/v1/crm/leads/${lead.leadId}/activities`)
        .expect(200);
      const moved = (activities.body.items as { kind: string; toStage?: string }[]).find(
        (a) => a.kind === 'stageChanged',
      );
      expect(moved?.toStage).toBe('contacted');
    });

    it('lets a cooling deal move backwards', async () => {
      const { lead } = await createLead(MANAGER);
      for (const stage of ['contacted', 'qualified', 'negotiation', 'qualified']) {
        await as(MANAGER)
          .post(`/api/v1/crm/leads/${lead.leadId}/stage`)
          .send({ stage })
          .expect(200);
      }
      const read = await as(MANAGER).get(`/api/v1/crm/leads/${lead.leadId}`).expect(200);
      expect(read.body.stage).toBe('qualified');
    });

    it('refuses a move the pipeline forbids, audits it, and changes nothing', async () => {
      const { lead } = await createLead(MANAGER);
      await as(MANAGER)
        .post(`/api/v1/crm/leads/${lead.leadId}/stage`)
        .send({ stage: 'won' })
        .expect(409);
      const stored = await leadModel(connection).findOne({ leadId: lead.leadId }).lean().exec();
      expect(stored?.stage).toBe('new');
      const refusals = await connection
        .collection(AUDIT_COLLECTION)
        .find({ action: CRM_AUDIT_ACTIONS.leadStageRefused, 'target.id': lead.leadId })
        .toArray();
      expect(refusals).toHaveLength(1);
    });

    it('refuses to lose a lead without a reason, and keeps it when the reason is given', async () => {
      const { lead } = await createLead(MANAGER);
      await as(MANAGER)
        .post(`/api/v1/crm/leads/${lead.leadId}/stage`)
        .send({ stage: 'lost' })
        .expect(400);
      let stored = await leadModel(connection).findOne({ leadId: lead.leadId }).lean().exec();
      expect(stored?.stage).toBe('new');

      await as(MANAGER)
        .post(`/api/v1/crm/leads/${lead.leadId}/stage`)
        .send({ stage: 'lost', reason: 'price above budget' })
        .expect(200);
      stored = await leadModel(connection).findOne({ leadId: lead.leadId }).lean().exec();
      expect(stored?.stage).toBe('lost');
      expect(stored?.lostReason).toBe('price above budget');
    });

    it('treats won as terminal', async () => {
      const { lead } = await createLead(MANAGER);
      for (const stage of ['contacted', 'negotiation', 'reservation', 'won']) {
        await as(MANAGER)
          .post(`/api/v1/crm/leads/${lead.leadId}/stage`)
          .send({ stage })
          .expect(200);
      }
      await as(MANAGER)
        .post(`/api/v1/crm/leads/${lead.leadId}/stage`)
        .send({ stage: 'lost', reason: 'cannot undo a win this way' })
        .expect(409);
    });

    it('refuses a stale expectedVersion on an edit and leaves the lead alone', async () => {
      const { lead } = await createLead(MANAGER);
      await as(MANAGER)
        .patch(`/api/v1/crm/leads/${lead.leadId}`)
        .send({ notes: 'first edit' })
        .expect(200);
      await as(MANAGER)
        .patch(`/api/v1/crm/leads/${lead.leadId}`)
        .send({ notes: 'stale edit', expectedVersion: lead.version })
        .expect(409);
      const stored = await leadModel(connection).findOne({ leadId: lead.leadId }).lean().exec();
      expect(stored?.notes).toBe('first edit');
    });
  });

  describe('follow-ups', () => {
    it('separates due from overdue against the organization timezone date', async () => {
      await createLead(MANAGER, { assignedToAccountId: REP_ONE, nextFollowUpOn: YESTERDAY });
      await createLead(MANAGER, { assignedToAccountId: REP_ONE, nextFollowUpOn: TODAY });
      await createLead(MANAGER, { assignedToAccountId: REP_ONE, nextFollowUpOn: TOMORROW });

      const due = await as(REP_ONE).get('/api/v1/crm/leads?followUp=due&limit=50').expect(200);
      const overdue = await as(REP_ONE)
        .get('/api/v1/crm/leads?followUp=overdue&limit=50')
        .expect(200);

      // "Due" includes today and everything earlier; "overdue" is strictly earlier.
      expect(due.body.total).toBe(2);
      expect(overdue.body.total).toBe(1);

      const dashboard = await as(REP_ONE).get('/api/v1/crm/dashboard').expect(200);
      expect(dashboard.body.dueFollowUps).toBe(2);
      expect(dashboard.body.overdueFollowUps).toBe(1);
    });

    it('excludes a concluded lead from the follow-up queue', async () => {
      const { lead } = await createLead(MANAGER, {
        assignedToAccountId: REP_ONE,
        nextFollowUpOn: YESTERDAY,
      });
      await as(MANAGER)
        .post(`/api/v1/crm/leads/${lead.leadId}/stage`)
        .send({ stage: 'lost', reason: 'no longer interested' })
        .expect(200);
      const due = await as(REP_ONE).get('/api/v1/crm/leads?followUp=due&limit=50').expect(200);
      expect(due.body.total).toBe(0);
    });

    it("moves the lead's next follow-up when one is scheduled, so the two cannot disagree", async () => {
      const { lead } = await createLead(REP_ONE);
      await as(REP_ONE)
        .post(`/api/v1/crm/leads/${lead.leadId}/activities`)
        .send({ kind: 'followUpScheduled', body: 'اتصال متابعة', dueOn: TOMORROW })
        .expect(201);
      const read = await as(REP_ONE).get(`/api/v1/crm/leads/${lead.leadId}`).expect(200);
      expect(read.body.nextFollowUpOn).toBe(TOMORROW);
    });
  });

  describe('append-only timeline, no hard delete', () => {
    it('refuses every mutation of an activity', async () => {
      const { lead } = await createLead(MANAGER);
      const model = activityModel(connection);
      await expect(
        model.updateOne({ leadId: lead.leadId }, { $set: { body: 'tampered' } }),
      ).rejects.toThrow(/append-only/);
      await expect(model.deleteMany({ leadId: lead.leadId })).rejects.toThrow(/append-only/);
    });

    it('refuses to delete a lead', async () => {
      const { lead } = await createLead(MANAGER);
      await expect(leadModel(connection).deleteOne({ leadId: lead.leadId })).rejects.toThrow(
        /never deleted/,
      );
    });
  });

  describe('search', () => {
    it('matches a name prefix and a phone prefix, and treats metacharacters literally', async () => {
      await createLead(MANAGER, { name: 'محمود عبد الله', primaryPhone: '+201115550001' });
      const byName = await as(MANAGER).get('/api/v1/crm/leads?search=محمود').expect(200);
      expect(byName.body.total).toBe(1);

      const byPhone = await as(MANAGER).get('/api/v1/crm/leads?search=20111555').expect(200);
      expect(byPhone.body.total).toBe(1);

      const literal = await as(MANAGER).get('/api/v1/crm/leads?search=.%2A').expect(200);
      expect(literal.body.total).toBe(0);
    });
  });
});
