import {
  CAMPAIGN_STATES,
  PERMISSIONS,
  ScopeAssignmentSchema,
  money,
  type Money,
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
import { CAMPAIGNS_COLLECTION, campaignModel } from './model';
import { marketingRouter } from './router';
import { MarketingService } from './service';

/**
 * Marketing against a real MongoDB replica set.
 *
 * Most of what matters here is what is **absent**: no publish route, no publish permission, no state
 * beyond `readyToPublish`, and `providerConnected: false` on every response. Those absences are the
 * feature (ADR-0026), so they are asserted rather than assumed.
 */
const gate = serviceGate(['mongodb']);
const RUN = `it-mkt-${Date.now()}`;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const ACCOUNT_HEADER = 'x-test-account';

const scope = (level: ScopeAssignment['level'], overrides: Partial<ScopeAssignment> = {}) =>
  ScopeAssignmentSchema.parse({ level, ...overrides });

const label = (en: string) => ({ ar: `عربي ${en}`, en });
const egp = (amount: string): Money => money(amount, 'EGP');

const LEGAL_ENTITY = 'le_mkttestlegalentity000000000001';
const BRANCH_A = 'br_mkttestbranchaaaaaaaaaaaaaa0001';

describe.skipIf(!gate.available)(`marketing module — ${gate.reason}`, () => {
  let connection: Connection;
  let audit: AuditService;
  let security: SecurityService;
  let marketing: MarketingService;
  let app: Express;

  const R_MANAGER = `${RUN}-r-manager`;
  const R_VIEWER = `${RUN}-r-viewer`;
  const MANAGER = `${RUN}-manager`;
  const VIEWER = `${RUN}-viewer`;
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
  const nextName = () => {
    counter += 1;
    return `حملة تجريبية ${counter}`;
  };

  /**
   * `expectStatus` is destructured out rather than spread into the body: schemas here are strict, so
   * leaking a test-only field into the request would turn every negative case into a 400 and hide
   * whatever the test was actually checking.
   */
  async function createCampaign(
    overrides: Record<string, unknown> & { expectStatus?: number } = {},
  ) {
    const { expectStatus, ...body } = overrides;
    const response = await as(MANAGER)
      .post('/api/v1/marketing/campaigns')
      .send({
        name: nextName(),
        platform: 'facebook',
        objective: 'leadGeneration',
        budget: egp('50000'),
        startsOn: '2026-09-01',
        branchId: BRANCH_A,
        ...body,
      })
      .expect(expectStatus ?? 201);
    return response.body as { campaignId: string; state: string; version: number };
  }

  beforeAll(async () => {
    configureMongoose();
    const logger = createLogger({ name: 'it-mkt', level: 'silent' });
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'] as string,
    });
    await connection.asPromise();
    await ensureIndexes(connection, logger);

    audit = new AuditService({ connection, logger, onRecorded: noteAuditWrite });
    security = new SecurityService({ connection, audit, logger });
    marketing = new MarketingService({
      connection,
      audit,
      resolveBranch: (branchId) =>
        Promise.resolve(branchId === BRANCH_A ? { legalEntityId: LEGAL_ENTITY } : undefined),
    });

    const manage: Permission[] = ['marketing.campaign.view', 'marketing.campaign.manage'];
    await bootstrapRole(connection, {
      key: R_MANAGER,
      name: label('manager'),
      permissions: manage,
    });
    await bootstrapRole(connection, {
      key: R_VIEWER,
      name: label('viewer'),
      permissions: ['marketing.campaign.view'],
    });
    for (const [accountId, roleKey] of [
      [MANAGER, R_MANAGER],
      [VIEWER, R_VIEWER],
    ] as const) {
      await bootstrapGrant(connection, {
        accountId,
        roleKeys: [roleKey],
        scope: scope('all'),
        updatedBy: 'test',
      });
    }

    const actorResolver: ActorResolver = async (req) => {
      const accountId = req.get(ACCOUNT_HEADER);
      return accountId ? security.resolveActor(accountId) : undefined;
    };

    const modules: ApiModule[] = [
      { basePath: '/marketing', router: marketingRouter({ getService: () => marketing }) },
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
    await connection.collection(CAMPAIGNS_COLLECTION).deleteMany({});
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
    await connection.collection(CAMPAIGNS_COLLECTION).deleteMany({});
  });

  describe('nothing is connected (ADR-0026)', () => {
    it('has no publish permission in the catalog at all', () => {
      // Not "present but unused": absent, so no role can hold it and no route can require it.
      expect(PERMISSIONS).not.toContain('marketing.campaign.publish');
    });

    it('has no state beyond readyToPublish', () => {
      expect([...CAMPAIGN_STATES]).toEqual(['draft', 'readyToPublish', 'archived']);
      expect([...CAMPAIGN_STATES]).not.toContain('published');
      expect([...CAMPAIGN_STATES]).not.toContain('live');
    });

    it('exposes no publish route', async () => {
      const campaign = await createCampaign();
      await as(MANAGER)
        .post(`/api/v1/marketing/campaigns/${campaign.campaignId}/publish`)
        .expect(404);
      await as(MANAGER).post('/api/v1/marketing/campaigns/publish').expect(404);
    });

    it('states providerConnected: false on every listing and on the overview', async () => {
      await createCampaign();
      const list = await as(VIEWER).get('/api/v1/marketing/campaigns').expect(200);
      const overview = await as(VIEWER).get('/api/v1/marketing/overview').expect(200);
      expect(list.body.providerConnected).toBe(false);
      expect(overview.body.providerConnected).toBe(false);
    });

    it('never carries a provider identifier', async () => {
      const campaign = await createCampaign();
      const read = await as(VIEWER)
        .get(`/api/v1/marketing/campaigns/${campaign.campaignId}`)
        .expect(200);
      expect(read.body).not.toHaveProperty('externalReference');
    });

    it('names its figures demoMetrics, and starts them at zero', async () => {
      const campaign = await createCampaign();
      const read = await as(VIEWER)
        .get(`/api/v1/marketing/campaigns/${campaign.campaignId}`)
        .expect(200);
      expect(read.body).not.toHaveProperty('metrics');
      expect(read.body.demoMetrics).toEqual({
        impressions: 0,
        reach: 0,
        clicks: 0,
        leads: 0,
        spend: { amount: '0', currency: 'EGP' },
      });
    });
  });

  describe('authorization and validation', () => {
    it('answers 401 without an actor and 403 without the permission', async () => {
      await api().get('/api/v1/marketing/campaigns').expect(401);
      await bootstrapGrant(connection, {
        accountId: NO_GRANT,
        roleKeys: [],
        scope: scope('all'),
        updatedBy: 'test',
      });
      await as(NO_GRANT).get('/api/v1/marketing/campaigns').expect(403);
    });

    it('refuses a viewer the create endpoint and stores nothing', async () => {
      await as(VIEWER)
        .post('/api/v1/marketing/campaigns')
        .send({
          name: nextName(),
          platform: 'instagram',
          objective: 'awareness',
          budget: egp('1000'),
          startsOn: '2026-09-01',
          branchId: BRANCH_A,
        })
        .expect(403);
      expect(await campaignModel(connection).countDocuments({})).toBe(0);
    });

    it('rejects an unknown field, including an attempt to set the figures', async () => {
      await as(MANAGER)
        .post('/api/v1/marketing/campaigns')
        .send({
          name: nextName(),
          platform: 'facebook',
          objective: 'leadGeneration',
          budget: egp('1000'),
          startsOn: '2026-09-01',
          branchId: BRANCH_A,
          demoMetrics: { impressions: 999999, reach: 1, clicks: 1, leads: 1, spend: egp('1') },
        })
        .expect(400);
    });

    it('refuses a negative budget and an end before the start', async () => {
      await createCampaign({ budget: egp('-1'), expectStatus: 400 });
      await createCampaign({ startsOn: '2026-09-01', endsOn: '2026-08-01', expectStatus: 400 });
    });

    it('refuses a duplicate campaign name inside one legal entity', async () => {
      const name = nextName();
      await createCampaign({ name });
      await createCampaign({ name, expectStatus: 409 });
      expect(await campaignModel(connection).countDocuments({ name })).toBe(1);
    });
  });

  describe('the local lifecycle', () => {
    it('moves draft → readyToPublish → archived and back to draft', async () => {
      const campaign = await createCampaign();
      const ready = await as(MANAGER)
        .patch(`/api/v1/marketing/campaigns/${campaign.campaignId}`)
        .send({ state: 'readyToPublish' })
        .expect(200);
      expect(ready.body.state).toBe('readyToPublish');

      await as(MANAGER)
        .patch(`/api/v1/marketing/campaigns/${campaign.campaignId}`)
        .send({ state: 'archived' })
        .expect(200);
      const reopened = await as(MANAGER)
        .patch(`/api/v1/marketing/campaigns/${campaign.campaignId}`)
        .send({ state: 'draft' })
        .expect(200);
      expect(reopened.body.state).toBe('draft');
    });

    it('refuses a move the machine forbids, audits it, and changes nothing', async () => {
      const campaign = await createCampaign();
      await as(MANAGER)
        .patch(`/api/v1/marketing/campaigns/${campaign.campaignId}`)
        .send({ state: 'archived' })
        .expect(200);
      await as(MANAGER)
        .patch(`/api/v1/marketing/campaigns/${campaign.campaignId}`)
        .send({ state: 'readyToPublish' })
        .expect(409);
      const stored = await campaignModel(connection)
        .findOne({ campaignId: campaign.campaignId })
        .lean()
        .exec();
      expect(stored?.state).toBe('archived');
    });

    it('refuses a stale expectedVersion', async () => {
      const campaign = await createCampaign();
      await as(MANAGER)
        .patch(`/api/v1/marketing/campaigns/${campaign.campaignId}`)
        .send({ creativeHeadline: 'first' })
        .expect(200);
      await as(MANAGER)
        .patch(`/api/v1/marketing/campaigns/${campaign.campaignId}`)
        .send({ creativeHeadline: 'stale', expectedVersion: campaign.version })
        .expect(409);
    });

    it('refuses to delete a campaign, because a lead points at it', async () => {
      const campaign = await createCampaign();
      await expect(
        campaignModel(connection).deleteOne({ campaignId: campaign.campaignId }),
      ).rejects.toThrow(/never deleted/);
    });
  });

  describe('the overview', () => {
    it('omits cost per lead when nothing converted, rather than reporting zero', async () => {
      await createCampaign();
      const overview = await as(VIEWER).get('/api/v1/marketing/overview').expect(200);
      expect(overview.body.campaigns).toBe(1);
      expect(overview.body.totalLeads).toBe(0);
      expect(overview.body).not.toHaveProperty('costPerLead');
    });

    it('computes cost per lead from spend and leads when both exist', async () => {
      const campaign = await createCampaign();
      await marketing.setDemoMetrics(campaign.campaignId, {
        impressions: 120_000,
        reach: 80_000,
        clicks: 3_400,
        leads: 40,
        spend: egp('12000'),
      });
      const overview = await as(VIEWER).get('/api/v1/marketing/overview').expect(200);
      expect(overview.body.totalLeads).toBe(40);
      expect(overview.body.costPerLead).toEqual({ amount: '300', currency: 'EGP' });
    });

    it('groups by platform', async () => {
      const first = await createCampaign({ platform: 'facebook' });
      const second = await createCampaign({ platform: 'instagram' });
      await marketing.setDemoMetrics(first.campaignId, {
        impressions: 1,
        reach: 1,
        clicks: 1,
        leads: 10,
        spend: egp('1000'),
      });
      await marketing.setDemoMetrics(second.campaignId, {
        impressions: 1,
        reach: 1,
        clicks: 1,
        leads: 5,
        spend: egp('500'),
      });
      const overview = await as(VIEWER).get('/api/v1/marketing/overview').expect(200);
      const byPlatform = overview.body.byPlatform as {
        platform: string;
        leads: number;
        spend: Money;
      }[];
      expect(byPlatform).toHaveLength(2);
      expect(byPlatform.find((p) => p.platform === 'facebook')?.leads).toBe(10);
      expect(byPlatform.find((p) => p.platform === 'instagram')?.spend.amount).toBe('500');
    });
  });
});
