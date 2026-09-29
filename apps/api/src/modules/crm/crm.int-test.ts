import {
  BusinessDateSchema,
  CRM_AUDIT_ACTIONS,
  ScopeAssignmentSchema,
  type Permission,
  type ScopeAssignment,
} from '@alola/contracts';
import { createLogger, effectivePermissions } from '@alola/security';
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
import { withTransaction } from '../../platform/transactions';
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
  CONSENTS_COLLECTION,
  CUSTOMERS_COLLECTION,
  LEADS_COLLECTION,
  OPPORTUNITIES_COLLECTION,
  OWNERSHIP_CHANGES_COLLECTION,
  activityModel,
  customerModel,
  leadModel,
  ownershipChangeModel,
} from './model';
import { crmRouter } from './router';
import { OpportunityService } from './opportunities';
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
const TEAM_B = 'team_crmtestteambbbbbbbbbbbbbbb0002';
const DEPT_A = 'dept_crmtestdepartmentaaaaaaaaa0001';
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
  let opportunities: OpportunityService;
  /** The configured win probabilities (BD-27); 
ull is not configured. */
  let probabilities: Record<string, string> | null = null;
  let app: Express;

  const R_MANAGER = `${RUN}-r-manager`;
  const R_REP = `${RUN}-r-rep`;

  const MANAGER = `${RUN}-manager`;
  const REP_ONE = `${RUN}-rep-one`;
  const REP_TWO = `${RUN}-rep-two`;
  const NO_GRANT = `${RUN}-no-grant`;
  /** A team leader: may assign, but only inside team A. */
  const TEAM_LEADER = `${RUN}-team-leader`;
  const REP_TEAM_B = `${RUN}-rep-team-b`;
  const REP_OTHER_BRANCH = `${RUN}-rep-other-branch`;
  const REP_INACTIVE = `${RUN}-rep-inactive`;
  const REP_UNPLACED = `${RUN}-rep-unplaced`;

  /** Placements as CORE-ORG would report them; an account missing here has none. */
  const PLACEMENTS: Record<
    string,
    { legalEntityId: string; branchId: string; departmentId?: string; teamId?: string }
  > = {};
  const INACTIVE = new Set<string>();
  const ACTIVE_LOSS_REASONS = new Set(['priceTooHigh']);

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
      describeAccount: async (accountId) => {
        const grants = await security.resolveActor(accountId);
        if (!grants) return undefined;
        const placement = PLACEMENTS[accountId];
        return {
          active: !INACTIVE.has(accountId),
          permissions: effectivePermissions(grants),
          ...(placement ? { placement } : {}),
        };
      },
      isActiveReason: (_list, code) => Promise.resolve(ACTIVE_LOSS_REASONS.has(code)),
    });
    opportunities = new OpportunityService({
      connection,
      audit,
      crm,
      probabilities: () => Promise.resolve(probabilities),
      isActiveReason: (_list, code) => Promise.resolve(ACTIVE_LOSS_REASONS.has(code)),
    });

    const managerPermissions: Permission[] = [
      'crm.customer.view',
      'crm.customer.manage',
      'crm.lead.view',
      'crm.lead.create',
      'crm.lead.edit',
      'crm.lead.assign',
      'crm.activity.create',
      'crm.customer.transfer',
      'crm.customer.viewIdentity',
      'crm.lead.convert',
      'crm.opportunity.view',
      'crm.opportunity.manage',
      'crm.opportunity.assign',
    ];
    const repPermissions: Permission[] = [
      'crm.customer.view',
      'crm.lead.view',
      'crm.lead.create',
      'crm.lead.edit',
      'crm.activity.create',
      'crm.lead.convert',
      'crm.opportunity.view',
      'crm.opportunity.manage',
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
    for (const accountId of [
      REP_ONE,
      REP_TWO,
      REP_TEAM_B,
      REP_OTHER_BRANCH,
      REP_INACTIVE,
      REP_UNPLACED,
    ]) {
      await bootstrapGrant(connection, {
        accountId,
        roleKeys: [R_REP],
        scope: scope('assigned'),
        updatedBy: 'test',
      });
    }
    // The team leader holds the manager's permissions over team A only.
    await bootstrapGrant(connection, {
      accountId: TEAM_LEADER,
      roleKeys: [R_MANAGER],
      scope: scope('team', { teamIds: [TEAM_A] }),
      updatedBy: 'test',
    });
    const placed = (branchId: string, teamId?: string) => ({
      legalEntityId: LEGAL_ENTITY,
      branchId,
      departmentId: DEPT_A,
      ...(teamId ? { teamId } : {}),
    });
    PLACEMENTS[MANAGER] = placed(BRANCH_A);
    PLACEMENTS[TEAM_LEADER] = placed(BRANCH_A, TEAM_A);
    PLACEMENTS[REP_ONE] = placed(BRANCH_A, TEAM_A);
    PLACEMENTS[REP_TWO] = placed(BRANCH_A, TEAM_A);
    PLACEMENTS[REP_TEAM_B] = placed(BRANCH_A, TEAM_B);
    PLACEMENTS[REP_OTHER_BRANCH] = placed(BRANCH_B, TEAM_B);
    PLACEMENTS[REP_INACTIVE] = placed(BRANCH_A, TEAM_A);
    INACTIVE.add(REP_INACTIVE);

    const actorResolver: ActorResolver = async (req) => {
      const accountId = req.get(ACCOUNT_HEADER);
      return accountId ? security.resolveActor(accountId) : undefined;
    };

    const modules: ApiModule[] = [
      {
        basePath: '/crm',
        router: crmRouter({ getService: () => crm, getOpportunities: () => opportunities }),
      },
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
    for (const name of [
      ACTIVITIES_COLLECTION,
      LEADS_COLLECTION,
      CUSTOMERS_COLLECTION,
      CONSENTS_COLLECTION,
      OWNERSHIP_CHANGES_COLLECTION,
      OPPORTUNITIES_COLLECTION,
    ]) {
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
    for (const name of [
      ACTIVITIES_COLLECTION,
      LEADS_COLLECTION,
      CUSTOMERS_COLLECTION,
      CONSENTS_COLLECTION,
      OWNERSHIP_CHANGES_COLLECTION,
      OPPORTUNITIES_COLLECTION,
    ]) {
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

  /* ------------------------------------------------------------ BMP-1 additions */

  const context = { correlationId: `${RUN}-direct` };

  async function createCustomer(
    accountId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{ customerId: string; version: number; identity?: unknown }> {
    const response = await as(accountId)
      .post('/api/v1/crm/customers')
      .send({ name: 'عميلة تجريبية', primaryPhone: nextPhone(), branchId: BRANCH_A, ...overrides })
      .expect(201);
    return response.body as { customerId: string; version: number; identity?: unknown };
  }

  describe('lead creation is one transaction (CRM-LEAD-001)', () => {
    it('stores no lead and no activity when the audit write fails', async () => {
      const failing = new CrmService({
        connection,
        audit: { record: () => Promise.reject(new Error('audit store down')) },
        resolveBranch: () => Promise.resolve({ legalEntityId: LEGAL_ENTITY }),
        today: () => TODAY,
      });
      const manager = await security.resolveActor(MANAGER);
      const phone = nextPhone();
      await expect(
        failing.createLead(
          manager!,
          { name: 'لن تُحفظ', primaryPhone: phone, source: 'walkIn', branchId: BRANCH_A },
          context,
          { mayAssign: false },
        ),
      ).rejects.toThrow(/audit store down/);
      expect(await leadModel(connection).countDocuments({ primaryPhone: phone })).toBe(0);
      expect(await activityModel(connection).countDocuments({})).toBe(0);
    });
  });

  describe('assignment eligibility (CRM-ASSIGN-001)', () => {
    const refusals: [string, string][] = [
      ['an inactive account', 'ASSIGNEE_INACTIVE'],
      ['an account that cannot read leads', 'ASSIGNEE_CANNOT_SEE_RECORD'],
      ['an account with no placement', 'ASSIGNEE_NOT_PLACED'],
      ['a colleague in another branch', 'ASSIGNEE_OUTSIDE_BRANCH'],
    ];
    const target = (issue: string) =>
      ({
        ASSIGNEE_INACTIVE: REP_INACTIVE,
        ASSIGNEE_CANNOT_SEE_RECORD: NO_GRANT,
        ASSIGNEE_NOT_PLACED: REP_UNPLACED,
        ASSIGNEE_OUTSIDE_BRANCH: REP_OTHER_BRANCH,
      })[issue] as string;

    it.each(refusals)(
      'refuses to hand a lead to %s, audits it, and leaves the lead alone',
      async (_label, issue) => {
        if (issue === 'ASSIGNEE_CANNOT_SEE_RECORD') {
          PLACEMENTS[NO_GRANT] = { legalEntityId: LEGAL_ENTITY, branchId: BRANCH_A };
          await bootstrapGrant(connection, {
            accountId: NO_GRANT,
            roleKeys: [],
            scope: scope('all'),
            updatedBy: 'test',
          });
        }
        const { lead } = await createLead(MANAGER, { assignedToAccountId: REP_ONE });
        const refused = await as(MANAGER)
          .post(`/api/v1/crm/leads/${lead.leadId}/assign`)
          .send({ assignedToAccountId: target(issue), reason: 'rebalancing the queue' })
          .expect(409);
        expect(refused.body.error.issues[0].code).toBe(issue);
        const stored = await leadModel(connection).findOne({ leadId: lead.leadId }).lean().exec();
        expect(stored?.assignedToAccountId).toBe(REP_ONE);
        const denied = await connection.collection(AUDIT_COLLECTION).countDocuments({
          action: CRM_AUDIT_ACTIONS.ownerAssignmentRefused,
          'target.id': lead.leadId,
        });
        expect(denied).toBe(1);
      },
    );

    it('refuses to name an ineligible owner on creation, storing nothing', async () => {
      const phone = nextPhone();
      const response = await as(MANAGER)
        .post('/api/v1/crm/leads')
        .send({
          name: 'عميل محتمل',
          primaryPhone: phone,
          source: 'walkIn',
          branchId: BRANCH_A,
          assignedToAccountId: REP_INACTIVE,
        })
        .expect(409);
      expect(response.body.error.issues[0].code).toBe('ASSIGNEE_INACTIVE');
      expect(await leadModel(connection).countDocuments({ primaryPhone: phone })).toBe(0);
    });

    it("keeps a team leader's hand-offs inside the team", async () => {
      const { lead } = await createLead(TEAM_LEADER, { assignedToAccountId: REP_ONE });
      const refused = await as(TEAM_LEADER)
        .post(`/api/v1/crm/leads/${lead.leadId}/assign`)
        .send({ assignedToAccountId: REP_TEAM_B, reason: 'moving it to team B' })
        .expect(409);
      expect(refused.body.error.issues[0].code).toBe('ASSIGNEE_OUTSIDE_SCOPE');
      await as(TEAM_LEADER)
        .post(`/api/v1/crm/leads/${lead.leadId}/assign`)
        .send({ assignedToAccountId: REP_TWO, reason: 'REP_ONE is on leave' })
        .expect(200);
    });

    it('moves the lead to the new owner’s team and keeps the ownership history', async () => {
      const { lead } = await createLead(MANAGER, { assignedToAccountId: REP_ONE });
      const moved = await as(MANAGER)
        .post(`/api/v1/crm/leads/${lead.leadId}/assign`)
        .send({ assignedToAccountId: REP_TEAM_B, reason: 'team B covers this project' })
        .expect(200);
      expect(moved.body.teamId).toBe(TEAM_B);
      const history = await as(MANAGER)
        .get(`/api/v1/crm/leads/${lead.leadId}/ownership`)
        .expect(200);
      const changes = history.body.items as { fromAccountId?: string; toAccountId: string }[];
      expect(changes[0]).toMatchObject({ fromAccountId: REP_ONE, toAccountId: REP_TEAM_B });
      expect(changes.at(-1)).toMatchObject({ toAccountId: REP_ONE });
      await expect(
        ownershipChangeModel(connection).updateMany({}, { $set: { reason: 'x' } }),
      ).rejects.toThrow(/append-only/);
    });
  });

  describe('duplicate reporting stays inside the scope (CRM-LEAD-003)', () => {
    it("counts a colleague's lead with the same phone without describing it", async () => {
      const phone = nextPhone();
      await createLead(MANAGER, { primaryPhone: phone, assignedToAccountId: REP_TWO });
      const mine = await createLead(REP_ONE, { primaryPhone: phone });
      expect(mine.possibleDuplicate).toBeUndefined();
      expect((mine as unknown as { outOfScopeMatches: number }).outOfScopeMatches).toBe(1);
    });

    it('matches a lead by e-mail regardless of letter case', async () => {
      await createLead(MANAGER, { email: 'Buyer.One@example.test' });
      const second = (await createLead(MANAGER, {
        email: 'buyer.one@EXAMPLE.test',
      })) as unknown as {
        possibleDuplicate?: { matchedOn: string[] };
      };
      expect(second.possibleDuplicate?.matchedOn).toEqual(['email']);
    });

    it('reports an existing customer with the same phone', async () => {
      const phone = nextPhone();
      const customer = await createCustomer(MANAGER, { primaryPhone: phone });
      const lead = (await createLead(MANAGER, { primaryPhone: phone })) as unknown as {
        existingCustomer?: { customerId: string };
      };
      expect(lead.existingCustomer?.customerId).toBe(customer.customerId);
    });
  });

  describe('customers (CRM-PERSON-001 … 006)', () => {
    it('hides the identity from anyone without crm.customer.viewIdentity, on read and list', async () => {
      const created = await createCustomer(MANAGER, {
        ownerAccountId: REP_ONE,
        identity: { type: 'nationalId', number: '29001011234567' },
      });
      expect(created.identity).toEqual({ type: 'nationalId', number: '29001011234567' });
      const repRead = await as(REP_ONE)
        .get(`/api/v1/crm/customers/${created.customerId}`)
        .expect(200);
      expect(repRead.body).not.toHaveProperty('identity');
      const repList = await as(REP_ONE).get('/api/v1/crm/customers').expect(200);
      for (const item of repList.body.items as Record<string, unknown>[]) {
        expect(item).not.toHaveProperty('identity');
      }
    });

    it('refuses to let someone write an identity they may not read', async () => {
      await bootstrapRole(connection, {
        key: `${RUN}-r-clerk`,
        name: label('customer clerk'),
        permissions: ['crm.customer.view', 'crm.customer.manage'],
      });
      const CLERK = `${RUN}-clerk`;
      await bootstrapGrant(connection, {
        accountId: CLERK,
        roleKeys: [`${RUN}-r-clerk`],
        scope: scope('all'),
        updatedBy: 'test',
      });
      const phone = nextPhone();
      await as(CLERK)
        .post('/api/v1/crm/customers')
        .send({
          name: 'عميل',
          primaryPhone: phone,
          branchId: BRANCH_A,
          identity: { type: 'passport', number: 'A1234567', issuingCountry: 'EG' },
        })
        .expect(403);
      expect(await customerModel(connection).countDocuments({ primaryPhone: phone })).toBe(0);
    });

    it('never writes a phone number or identity into the audit record of a correction', async () => {
      const created = await createCustomer(MANAGER, {
        identity: { type: 'nationalId', number: '29001011234567' },
      });
      const newPhone = '+20 111 222 3334';
      await as(MANAGER)
        .patch(`/api/v1/crm/customers/${created.customerId}`)
        .send({
          primaryPhone: newPhone,
          identity: { type: 'nationalId', number: '29001017654321' },
          reason: 'customer brought a new card',
          expectedVersion: created.version,
        })
        .expect(200);
      const events = await connection
        .collection(AUDIT_COLLECTION)
        .find({ action: CRM_AUDIT_ACTIONS.customerCorrected, 'target.id': created.customerId })
        .toArray();
      expect(events).toHaveLength(1);
      const text = JSON.stringify(events[0]);
      expect(text).not.toContain('2223334');
      expect(text).not.toContain('29001017654321');
      expect(text).not.toContain('29001011234567');
    });

    it('refuses a correction built on a stale version, and one with nothing to change', async () => {
      const created = await createCustomer(MANAGER);
      await as(MANAGER)
        .patch(`/api/v1/crm/customers/${created.customerId}`)
        .send({ city: 'الجيزة', reason: 'moved', expectedVersion: created.version })
        .expect(200);
      const stale = await as(MANAGER)
        .patch(`/api/v1/crm/customers/${created.customerId}`)
        .send({ city: 'طنطا', reason: 'moved again', expectedVersion: created.version })
        .expect(409);
      expect(stale.body.error.issues[0].code).toBe('STALE_VERSION');
      await as(MANAGER)
        .patch(`/api/v1/crm/customers/${created.customerId}`)
        .send({ city: 'الجيزة', reason: 'no change', expectedVersion: created.version + 1 })
        .expect(400);
    });

    it('corrects a record written before BMP-1 (no version, legacy national ID)', async () => {
      const legacyId = 'cus_legacycustomerwithnoversion01';
      await connection.collection(CUSTOMERS_COLLECTION).insertOne({
        customerId: legacyId,
        name: 'عميل قديم',
        primaryPhone: nextPhone(),
        primaryPhoneDigits: `9${Date.now()}`,
        nationalId: 'DEMO-NID-0001',
        legalEntityId: LEGAL_ENTITY,
        branchId: BRANCH_A,
        ownerAccountId: MANAGER,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const read = await as(MANAGER).get(`/api/v1/crm/customers/${legacyId}`).expect(200);
      expect(read.body).toMatchObject({
        kind: 'individual',
        version: 1,
        identity: { type: 'nationalId', number: 'DEMO-NID-0001' },
      });
      const corrected = await as(MANAGER)
        .patch(`/api/v1/crm/customers/${legacyId}`)
        .send({ kind: 'company', reason: 'registered as a company', expectedVersion: 1 })
        .expect(200);
      expect(corrected.body.version).toBe(2);
    });

    it('keeps consent as a history and reports the latest statement per channel', async () => {
      const created = await createCustomer(MANAGER);
      await as(MANAGER)
        .post(`/api/v1/crm/customers/${created.customerId}/consents`)
        .send({ channel: 'whatsapp', granted: true, source: 'writtenForm' })
        .expect(201);
      expect(await crm.hasConsent(created.customerId, 'whatsapp')).toBe(true);
      const withdrawn = await as(MANAGER)
        .post(`/api/v1/crm/customers/${created.customerId}/consents`)
        .send({ channel: 'whatsapp', granted: false, source: 'verbal' })
        .expect(201);
      expect(withdrawn.body.consents).toEqual([
        expect.objectContaining({ channel: 'whatsapp', granted: false, source: 'verbal' }),
      ]);
      expect(await crm.hasConsent(created.customerId, 'whatsapp')).toBe(false);
      expect(await crm.hasConsent(created.customerId, 'sms')).toBe(false);
    });

    it('transfers a customer to an eligible colleague and refuses an ineligible one', async () => {
      const created = await createCustomer(MANAGER, { ownerAccountId: REP_ONE });
      const refused = await as(MANAGER)
        .post(`/api/v1/crm/customers/${created.customerId}/transfer`)
        .send({ toAccountId: REP_OTHER_BRANCH, reason: 'moving branches' })
        .expect(409);
      expect(refused.body.error.issues[0].code).toBe('ASSIGNEE_OUTSIDE_BRANCH');
      const moved = await as(MANAGER)
        .post(`/api/v1/crm/customers/${created.customerId}/transfer`)
        .send({ toAccountId: REP_TEAM_B, reason: 'REP_ONE left the company' })
        .expect(200);
      expect(moved.body).toMatchObject({ ownerAccountId: REP_TEAM_B, teamId: TEAM_B });
      // The previous owner no longer sees the customer; the new one does.
      await as(REP_ONE).get(`/api/v1/crm/customers/${created.customerId}`).expect(404);
      await as(REP_TEAM_B).get(`/api/v1/crm/customers/${created.customerId}`).expect(200);
      const history = await as(MANAGER)
        .get(`/api/v1/crm/customers/${created.customerId}/ownership`)
        .expect(200);
      expect(history.body.items[0]).toMatchObject({
        fromAccountId: REP_ONE,
        toAccountId: REP_TEAM_B,
      });
    });

    it('lists duplicates inside the scope and only counts those outside it', async () => {
      const email = `shared-${Date.now()}@example.test`;
      await createCustomer(MANAGER, { ownerAccountId: REP_ONE, email });
      await createCustomer(MANAGER, { ownerAccountId: REP_TWO, email });
      const check = await as(REP_ONE)
        .post('/api/v1/crm/customers/duplicate-check')
        .send({ email: email.toUpperCase(), branchId: BRANCH_A })
        .expect(200);
      expect(check.body.candidates).toHaveLength(1);
      expect(check.body.outOfScopeMatches).toBe(1);
      const managerCheck = await as(MANAGER)
        .post('/api/v1/crm/customers/duplicate-check')
        .send({ email, branchId: BRANCH_A })
        .expect(200);
      expect(managerCheck.body.candidates).toHaveLength(2);
      expect(managerCheck.body.candidates[0].matchedOn).toEqual(['email']);
    });

    it('pages customers by name with a total that obeys the scope', async () => {
      for (const name of ['أحمد', 'باسم', 'تامر']) {
        await createCustomer(MANAGER, { name: `${name} عميل`, ownerAccountId: REP_ONE });
      }
      await createCustomer(MANAGER, {
        name: 'ثابت عميل',
        ownerAccountId: REP_TWO,
        kind: 'company',
      });
      const first = await as(REP_ONE).get('/api/v1/crm/customers?limit=2').expect(200);
      expect(first.body.total).toBe(3);
      expect(first.body.items).toHaveLength(2);
      const second = await as(REP_ONE)
        .get(`/api/v1/crm/customers?limit=2&cursor=${first.body.nextCursor as string}`)
        .expect(200);
      expect(second.body.items).toHaveLength(1);
      expect(second.body.nextCursor).toBeUndefined();
      const companies = await as(MANAGER).get('/api/v1/crm/customers?kind=company').expect(200);
      expect(companies.body.total).toBe(1);
    });
  });

  describe('qualification and loss (CRM-LEAD-004, CRM-LOSS-001)', () => {
    it('records a qualification and moves a new lead to qualified', async () => {
      const { lead } = await createLead(REP_ONE);
      const qualified = await as(REP_ONE)
        .post(`/api/v1/crm/leads/${lead.leadId}/qualify`)
        .send({
          budgetConfirmed: true,
          timeframe: 'withinThreeMonths',
          purpose: 'residence',
          decisionRole: 'decisionMaker',
        })
        .expect(200);
      expect(qualified.body.stage).toBe('qualified');
      expect(qualified.body.qualification).toMatchObject({
        budgetConfirmed: true,
        qualifiedBy: REP_ONE,
      });
    });

    it('accepts an active loss reason, refuses an unknown one, and keeps a nurture flag', async () => {
      const { lead } = await createLead(REP_ONE);
      const refused = await as(REP_ONE)
        .post(`/api/v1/crm/leads/${lead.leadId}/stage`)
        .send({ stage: 'lost', reason: 'too expensive', reasonCode: 'invented' })
        .expect(400);
      expect(refused.body.error.issues[0].code).toBe('REASON_CODE_UNKNOWN');
      const lost = await as(REP_ONE)
        .post(`/api/v1/crm/leads/${lead.leadId}/stage`)
        .send({ stage: 'lost', reason: 'too expensive', reasonCode: 'priceTooHigh', nurture: true })
        .expect(200);
      expect(lost.body).toMatchObject({ lostReasonCode: 'priceTooHigh', nurture: true });
      const nurture = await as(REP_ONE).get('/api/v1/crm/leads?nurture=true').expect(200);
      expect(nurture.body.total).toBe(1);
    });

    it('keeps the original source and records a re-credit on the timeline', async () => {
      const { lead } = await createLead(REP_ONE, { source: 'facebook' });
      const updated = await as(REP_ONE)
        .patch(`/api/v1/crm/leads/${lead.leadId}`)
        .send({ currentSource: 'referral' })
        .expect(200);
      expect(updated.body).toMatchObject({ source: 'facebook', currentSource: 'referral' });
      const activities = await as(REP_ONE)
        .get(`/api/v1/crm/leads/${lead.leadId}/activities`)
        .expect(200);
      expect(activities.body.items[0]).toMatchObject({
        kind: 'sourceChanged',
        fromStage: 'facebook',
        toStage: 'referral',
      });
    });
  });

  describe('conversion (CRM-LEAD-005)', () => {
    it('lets a representative make their lead a customer they own, idempotently', async () => {
      const { lead } = await createLead(REP_ONE);
      const first = await as(REP_ONE).post(`/api/v1/crm/leads/${lead.leadId}/convert`).expect(200);
      expect(first.body.customerCreated).toBe(true);
      expect(first.body.customer.ownerAccountId).toBe(REP_ONE);
      expect(first.body.lead.customerId).toBe(first.body.customer.customerId);
      const again = await as(REP_ONE).post(`/api/v1/crm/leads/${lead.leadId}/convert`).expect(200);
      expect(again.body.customerCreated).toBe(false);
      expect(again.body.customer.customerId).toBe(first.body.customer.customerId);
      expect(await customerModel(connection).countDocuments({})).toBe(1);
    });

    it('links a lead to the visible customer who already has its phone', async () => {
      const phone = nextPhone();
      const customer = await createCustomer(MANAGER, {
        primaryPhone: phone,
        ownerAccountId: REP_ONE,
      });
      const { lead } = await createLead(REP_ONE, { primaryPhone: phone });
      const converted = await as(REP_ONE)
        .post(`/api/v1/crm/leads/${lead.leadId}/convert`)
        .expect(200);
      expect(converted.body).toMatchObject({ customerCreated: false });
      expect(converted.body.customer.customerId).toBe(customer.customerId);
    });

    it("refuses to link a lead to a customer outside the representative's scope, describing nothing", async () => {
      const phone = nextPhone();
      await createCustomer(MANAGER, { primaryPhone: phone, ownerAccountId: REP_TWO, name: 'سر' });
      const { lead } = await createLead(REP_ONE, { primaryPhone: phone });
      const refused = await as(REP_ONE)
        .post(`/api/v1/crm/leads/${lead.leadId}/convert`)
        .expect(409);
      expect(refused.body.error.issues[0].code).toBe('CUSTOMER_OUTSIDE_SCOPE');
      expect(JSON.stringify(refused.body)).not.toContain('سر');
      const stored = await leadModel(connection).findOne({ leadId: lead.leadId }).lean().exec();
      expect(stored?.customerId).toBeUndefined();
    });

    it('refuses to convert a lost lead', async () => {
      const { lead } = await createLead(REP_ONE);
      await as(REP_ONE)
        .post(`/api/v1/crm/leads/${lead.leadId}/stage`)
        .send({ stage: 'lost', reason: 'bought elsewhere' })
        .expect(200);
      await as(REP_ONE).post(`/api/v1/crm/leads/${lead.leadId}/convert`).expect(409);
    });
  });

  describe('opportunities (CRM-OPP-001, CRM-OPP-002, CRM-PIPE-001)', () => {
    const egp = (amount: string) => ({ amount, currency: 'EGP' });

    async function openOpportunity(accountId: string, overrides: Record<string, unknown> = {}) {
      const customer = await createCustomer(MANAGER, { ownerAccountId: accountId });
      const response = await as(accountId)
        .post('/api/v1/crm/opportunities')
        .send({ customerId: customer.customerId, ...overrides })
        .expect(201);
      return response.body as {
        opportunityId: string;
        version: number;
        stage: string;
        customerId: string;
      };
    }

    const move = (accountId: string, id: string, stage: string, version: number, extra = {}) =>
      as(accountId)
        .post(`/api/v1/crm/opportunities/${id}/stage`)
        .send({ stage, expectedVersion: version, ...extra });

    it('opens an opportunity only on a customer the actor can see', async () => {
      const opportunity = await openOpportunity(REP_ONE, { expectedValue: egp('2500000.00') });
      expect(opportunity).toMatchObject({ stage: 'discovery' });
      const hidden = await createCustomer(MANAGER, { ownerAccountId: REP_TWO });
      await as(REP_ONE)
        .post('/api/v1/crm/opportunities')
        .send({ customerId: hidden.customerId })
        .expect(404);
    });

    it('lets several opportunities run for one customer, each visible to its owner only', async () => {
      const customer = await createCustomer(MANAGER, { ownerAccountId: REP_ONE });
      for (const projectId of [PROJECT_A, 'prj_crmtestprojectbbbbbbbbbbbbb0002']) {
        await as(REP_ONE)
          .post('/api/v1/crm/opportunities')
          .send({ customerId: customer.customerId, projectId })
          .expect(201);
      }
      const mine = await as(REP_ONE)
        .get(`/api/v1/crm/opportunities?customerId=${customer.customerId}`)
        .expect(200);
      expect(mine.body.total).toBe(2);
      const theirs = await as(REP_TWO)
        .get(`/api/v1/crm/opportunities?customerId=${customer.customerId}`)
        .expect(200);
      expect(theirs.body.total).toBe(0);
    });

    it('refuses the stages sales owns, audits the attempt, and changes nothing', async () => {
      const opportunity = await openOpportunity(REP_ONE);
      for (const stage of ['reservation', 'won']) {
        const refused = await move(REP_ONE, opportunity.opportunityId, stage, 1).expect(409);
        expect(refused.body.error.issues[0].code).toBe('STAGE_SET_BY_SALES');
      }
      const refusals = await connection.collection(AUDIT_COLLECTION).countDocuments({
        action: CRM_AUDIT_ACTIONS.opportunityStageRefused,
        'target.id': opportunity.opportunityId,
      });
      expect(refusals).toBe(2);
      const read = await as(REP_ONE)
        .get(`/api/v1/crm/opportunities/${opportunity.opportunityId}`)
        .expect(200);
      expect(read.body).toMatchObject({ stage: 'discovery', version: 1 });
    });

    it('moves between open stages, requires a reason to lose, and reopens a lost one', async () => {
      const { opportunityId } = await openOpportunity(REP_ONE);
      await move(REP_ONE, opportunityId, 'proposal', 1).expect(200);
      await move(REP_ONE, opportunityId, 'lost', 2).expect(400);
      const lost = await move(REP_ONE, opportunityId, 'lost', 2, {
        reason: 'chose another developer',
        reasonCode: 'priceTooHigh',
      }).expect(200);
      expect(lost.body).toMatchObject({ stage: 'lost', lostReasonCode: 'priceTooHigh' });
      expect(lost.body.closedAt).toBeDefined();
      const reopened = await move(REP_ONE, opportunityId, 'discovery', 3).expect(200);
      expect(reopened.body.closedAt).toBeUndefined();
      expect(reopened.body.lostReason).toBeUndefined();
      await move(REP_ONE, opportunityId, 'proposal', 1).expect(409);
      const history = await as(REP_ONE)
        .get(`/api/v1/crm/opportunities/${opportunityId}/activities`)
        .expect(200);
      expect(
        (history.body.items as { toStage?: string }[]).map((item) => item.toStage).reverse(),
      ).toEqual(['discovery', 'proposal', 'lost', 'discovery']);
    });

    it('lets sales take it to reservation and won, and back to negotiation on cancellation', async () => {
      const { opportunityId } = await openOpportunity(REP_ONE);
      const manager = await security.resolveActor(MANAGER);
      const reserveId = 'rsv_crmtestreservationaaaaaaa0001';
      await withTransaction(connection, (session) =>
        opportunities.advanceInternal(
          manager!,
          opportunityId,
          'reservation',
          { reservationId: reserveId },
          'reservation RSV-1',
          context,
          session,
        ),
      );
      // Once a reservation holds it, a person cannot move it; the reservation does.
      const refused = await move(REP_ONE, opportunityId, 'negotiation', 2).expect(409);
      expect(refused.body.error.issues[0].code).toBe('STAGE_SET_BY_SALES');
      const released = await withTransaction(connection, (session) =>
        opportunities.advanceInternal(
          manager!,
          opportunityId,
          'negotiation',
          {},
          'reservation cancelled',
          context,
          session,
        ),
      );
      expect(released.reservationId).toBeUndefined();
      await withTransaction(connection, (session) =>
        opportunities.advanceInternal(
          manager!,
          opportunityId,
          'reservation',
          { reservationId: reserveId },
          'reserved again',
          context,
          session,
        ),
      );
      const won = await withTransaction(connection, (session) =>
        opportunities.advanceInternal(
          manager!,
          opportunityId,
          'won',
          { contractId: 'ctr_crmtestcontractaaaaaaaaaaa0001' },
          'contract activated',
          context,
          session,
        ),
      );
      expect(won).toMatchObject({ stage: 'won', contractId: 'ctr_crmtestcontractaaaaaaaaaaa0001' });
      expect(won.closedAt).toBeDefined();
      await expect(
        withTransaction(connection, (session) =>
          opportunities.advanceInternal(
            manager!,
            opportunityId,
            'reservation',
            {},
            'again',
            context,
            session,
          ),
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('converts a lead into a customer and an opportunity in one step, carrying attribution', async () => {
      const { lead } = await createLead(REP_ONE, {
        source: 'instagram',
        interestedProjectId: PROJECT_A,
        preferredPropertyType: 'apartment',
        budgetMin: egp('1500000.00'),
        budgetMax: egp('2000000.00'),
      });
      const converted = await as(REP_ONE)
        .post(`/api/v1/crm/leads/${lead.leadId}/convert`)
        .send({ opportunity: { expectedValue: egp('1800000.00') } })
        .expect(200);
      expect(converted.body.opportunity).toMatchObject({
        leadId: lead.leadId,
        customerId: converted.body.customer.customerId,
        source: 'instagram',
        projectId: PROJECT_A,
        propertyType: 'apartment',
        budgetMax: egp('2000000.00'),
        expectedValue: egp('1800000.00'),
        ownerAccountId: REP_ONE,
        stage: 'discovery',
      });
    });

    it('refuses to open an opportunity during conversion without the permission, converting nothing', async () => {
      await bootstrapRole(connection, {
        key: `${RUN}-r-converter`,
        name: label('converter'),
        permissions: ['crm.lead.view', 'crm.lead.create', 'crm.lead.convert'],
      });
      const CONVERTER = `${RUN}-converter`;
      await bootstrapGrant(connection, {
        accountId: CONVERTER,
        roleKeys: [`${RUN}-r-converter`],
        scope: scope('assigned'),
        updatedBy: 'test',
      });
      const { lead } = await createLead(CONVERTER);
      await as(CONVERTER)
        .post(`/api/v1/crm/leads/${lead.leadId}/convert`)
        .send({ opportunity: {} })
        .expect(403);
      const stored = await leadModel(connection).findOne({ leadId: lead.leadId }).lean().exec();
      expect(stored?.customerId).toBeUndefined();
      // Without the opportunity, the same person may convert.
      await as(CONVERTER).post(`/api/v1/crm/leads/${lead.leadId}/convert`).expect(200);
    });

    it('hands an opportunity to an eligible colleague with history, and refuses one in another branch', async () => {
      const { opportunityId } = await openOpportunity(REP_ONE);
      const refused = await as(MANAGER)
        .post(`/api/v1/crm/opportunities/${opportunityId}/assign`)
        .send({ toAccountId: REP_OTHER_BRANCH, reason: 'covering the north coast' })
        .expect(409);
      expect(refused.body.error.issues[0].code).toBe('ASSIGNEE_OUTSIDE_BRANCH');
      const moved = await as(MANAGER)
        .post(`/api/v1/crm/opportunities/${opportunityId}/assign`)
        .send({ toAccountId: REP_TEAM_B, reason: 'project specialist' })
        .expect(200);
      expect(moved.body).toMatchObject({ ownerAccountId: REP_TEAM_B, teamId: TEAM_B });
      await as(REP_ONE).get(`/api/v1/crm/opportunities/${opportunityId}`).expect(404);
      const history = await as(MANAGER)
        .get(`/api/v1/crm/opportunities/${opportunityId}/ownership`)
        .expect(200);
      expect(history.body.items[0]).toMatchObject({
        fromAccountId: REP_ONE,
        toAccountId: REP_TEAM_B,
      });
    });

    it('sums the pipeline exactly per stage and currency, and weights it only when configured', async () => {
      const first = await openOpportunity(REP_ONE, { expectedValue: egp('1000000.00') });
      const second = await openOpportunity(REP_ONE, { expectedValue: egp('2000000.10') });
      await openOpportunity(REP_ONE, { expectedValue: { amount: '50000.00', currency: 'USD' } });
      await openOpportunity(REP_ONE);
      await move(REP_ONE, second.opportunityId, 'negotiation', 1).expect(200);

      probabilities = null;
      const plain = await as(REP_ONE).get('/api/v1/crm/opportunities/summary').expect(200);
      expect(plain.body.probabilitiesConfigured).toBe(false);
      expect(plain.body.weightedOpenValue).toBeUndefined();
      const discovery = (
        plain.body.byStage as { stage: string; count: number; expectedValue: unknown[] }[]
      ).find((row) => row.stage === 'discovery');
      expect(discovery).toEqual({
        stage: 'discovery',
        count: 3,
        expectedValue: [egp('1000000.00'), { amount: '50000.00', currency: 'USD' }],
      });
      const read = await as(REP_ONE)
        .get(`/api/v1/crm/opportunities/${first.opportunityId}`)
        .expect(200);
      expect(read.body).not.toHaveProperty('probability');

      probabilities = { discovery: '10', unitSelection: '25', proposal: '50', negotiation: '75' };
      const weighted = await as(REP_ONE).get('/api/v1/crm/opportunities/summary').expect(200);
      // 1,000,000.00 × 10% + 2,000,000.10 × 75% = 100,000.00 + 1,500,000.075 → 1,600,000.08 (half-even, once, at the end)
      expect(weighted.body.weightedOpenValue).toContainEqual(egp('1600000.08'));
      expect(weighted.body.weightedOpenValue).toContainEqual({
        amount: '5000.00',
        currency: 'USD',
      });
      const withProbability = await as(REP_ONE)
        .get(`/api/v1/crm/opportunities/${second.opportunityId}`)
        .expect(200);
      expect(withProbability.body.probability).toBe('75');
      probabilities = null;
    });
  });

  describe('customer timeline and dashboard ageing (CRM-ACTIVITY-001, CRM-REPORT-001)', () => {
    it('records activities on a customer and keeps them to those who can see it', async () => {
      const created = await createCustomer(MANAGER, { ownerAccountId: REP_ONE });
      await as(REP_ONE)
        .post(`/api/v1/crm/customers/${created.customerId}/activities`)
        .send({ kind: 'call', body: 'مكالمة متابعة' })
        .expect(201);
      const timeline = await as(REP_ONE)
        .get(`/api/v1/crm/customers/${created.customerId}/activities`)
        .expect(200);
      expect(timeline.body.items[0]).toMatchObject({
        kind: 'call',
        customerId: created.customerId,
      });
      await as(REP_TWO).get(`/api/v1/crm/customers/${created.customerId}/activities`).expect(404);
    });

    it('bands open leads by age and counts those never touched', async () => {
      const { lead: fresh } = await createLead(REP_ONE);
      const { lead: old } = await createLead(REP_ONE);
      await leadModel(connection).collection.updateOne(
        { leadId: old.leadId },
        {
          $set: {
            createdAt: new Date(Date.now() - 45 * 86_400_000),
            lastActivityAt: new Date(Date.now() - 45 * 86_400_000),
          },
        },
      );
      await as(REP_ONE)
        .post(`/api/v1/crm/leads/${fresh.leadId}/activities`)
        .send({ kind: 'call' })
        .expect(201);
      const dashboard = await as(REP_ONE).get('/api/v1/crm/dashboard').expect(200);
      expect(dashboard.body.openByAge).toEqual({ upTo7: 1, upTo30: 0, upTo90: 1, over90: 0 });
      expect(dashboard.body.untouchedOpenLeads).toBe(1);
    });
  });
});
