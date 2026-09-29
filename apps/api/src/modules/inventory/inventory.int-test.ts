import {
  INVENTORY_AUDIT_ACTIONS,
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
import { MAINTENANCE_ACTOR } from '../../platform/maintenance';
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
import type { InventoryApprovalPort } from './approval-port';
import { HoldService } from './holds';
import { PriceService } from './pricing';
import { PlanTemplateService } from './templates';
import {
  BUILDINGS_COLLECTION,
  HOLDS_COLLECTION,
  PLAN_TEMPLATES_COLLECTION,
  PRICE_VERSIONS_COLLECTION,
  PROJECTS_COLLECTION,
  projectModel,
  UNITS_COLLECTION,
  UNIT_EVENTS_COLLECTION,
  unitEventModel,
  unitModel,
} from './model';
import { inventoryRouter } from './router';
import { InventoryService } from './service';

/**
 * Inventory against a real MongoDB replica set.
 *
 * The test that matters most is the concurrent one: two callers reserve the same available unit at the
 * same moment, and exactly one succeeds. Everything else in this module exists to make that true.
 */
const gate = serviceGate(['mongodb']);
const RUN = `it-inv-${Date.now()}`;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const ACCOUNT_HEADER = 'x-test-account';

const scope = (level: ScopeAssignment['level'], overrides: Partial<ScopeAssignment> = {}) =>
  ScopeAssignmentSchema.parse({ level, ...overrides });

const label = (en: string) => ({ ar: `عربي ${en}`, en });
const egp = (amount: string) => ({ amount, currency: 'EGP' });

/** Two fixed organization references; this suite does not exercise CORE-ORG. */
const LEGAL_ENTITY = 'le_inventorytestlegalentity00000001';
const BRANCH_A = 'br_inventorytestbranchaaaaaaaaaaa01';
const BRANCH_B = 'br_inventorytestbranchbbbbbbbbbbb02';

describe.skipIf(!gate.available)(`inventory module — ${gate.reason}`, () => {
  let connection: Connection;
  let audit: AuditService;
  let security: SecurityService;
  let inventory: InventoryService;
  let prices: PriceService;
  let holds: HoldService;
  let templates: PlanTemplateService;
  let app: Express;

  /** The organization's calendar date and the wall clock, both under the test's control. */
  let today = '2026-10-01';
  let clock = new Date('2026-10-01T09:00:00.000Z');
  /** The configured hold length (BD-29); `null` is not configured. */
  let holdHours: number | null = 48;
  /** Whether an approval policy applies, and the outcome the engine reports per request. */
  let approvalPolicy = false;
  const approvalStates = new Map<string, string>();
  const approvals: InventoryApprovalPort = {
    submit: (_actor, input) => {
      if (!approvalPolicy) return Promise.resolve(undefined);
      const requestId = `apr_${input.idempotencyKey.replace(/[^A-Za-z0-9]/g, '')}`;
      approvalStates.set(requestId, 'pending');
      return Promise.resolve({ requestId, state: 'pending' });
    },
    state: (requestId) => Promise.resolve(approvalStates.get(requestId)),
    applies: () => Promise.resolve(approvalPolicy),
  };

  const R_MANAGER = `${RUN}-r-manager`;
  const R_VIEWER_NO_PRICE = `${RUN}-r-viewer-noprice`;
  const R_VIEWER_PRICE = `${RUN}-r-viewer-price`;

  const MANAGER = `${RUN}-manager`;
  const VIEWER_NO_PRICE = `${RUN}-viewer-noprice`;
  const VIEWER_PRICE = `${RUN}-viewer-price`;
  const PROJECT_SCOPED = `${RUN}-project-scoped`;
  /** A representative scoped to their own work, placed in branch A (SEC-034). */
  const REP_A = `${RUN}-rep-a`;
  const REP_A_TWO = `${RUN}-rep-a-two`;
  const REP_NOWHERE = `${RUN}-rep-nowhere`;
  const R_REP = `${RUN}-r-rep`;
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
  const nextCode = (prefix: string) => {
    counter += 1;
    return `${prefix}${String(counter).padStart(4, '0')}`;
  };

  async function makeProject(branchId = BRANCH_A) {
    const project = await as(MANAGER)
      .post('/api/v1/inventory/projects')
      .send({
        branchId,
        code: nextCode('PRJ'),
        name: label('Project'),
        city: label('Cairo'),
        currency: 'EGP',
        status: 'selling',
      })
      .expect(201);
    const building = await as(MANAGER)
      .post('/api/v1/inventory/buildings')
      .send({
        projectId: project.body.projectId,
        code: nextCode('BLD'),
        name: label('Building'),
        floors: 12,
      })
      .expect(201);
    return { project: project.body, building: building.body };
  }

  async function makeUnit(
    buildingId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{ unitId: string; code: string; version: number }> {
    const response = await as(MANAGER)
      .post('/api/v1/inventory/units')
      .send({
        buildingId,
        code: nextCode('U'),
        floor: 3,
        propertyType: 'apartment',
        usageType: 'residential',
        area: '120.5',
        basePrice: egp('3000000'),
        finishingStatus: 'semiFinished',
        ...overrides,
      })
      .expect(201);
    return response.body as { unitId: string; code: string; version: number };
  }

  beforeAll(async () => {
    configureMongoose();
    const logger = createLogger({ name: 'it-inv', level: 'silent' });
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'] as string,
    });
    await connection.asPromise();
    await ensureIndexes(connection, logger);

    audit = new AuditService({ connection, logger, onRecorded: noteAuditWrite });
    security = new SecurityService({ connection, audit, logger });
    inventory = new InventoryService({
      connection,
      audit,
      // A fixed organization: this suite tests inventory, and CORE-ORG has its own.
      resolveBranch: (branchId) =>
        Promise.resolve(
          branchId === BRANCH_A || branchId === BRANCH_B
            ? { legalEntityId: LEGAL_ENTITY }
            : undefined,
        ),
    });
    prices = new PriceService({
      connection,
      audit,
      logger,
      inventory,
      approvals,
      today: () => today as never,
    });
    holds = new HoldService({
      connection,
      audit,
      logger,
      inventory,
      approvals,
      holdHours: () => Promise.resolve(holdHours),
      now: () => clock,
    });
    templates = new PlanTemplateService({ connection, audit, inventory });

    const manage: Permission[] = [
      'inventory.project.view',
      'inventory.project.manage',
      'inventory.unit.view',
      'inventory.unit.manage',
      'inventory.unit.viewPricing',
      'inventory.price.propose',
      'inventory.hold.create',
      'inventory.hold.manage',
      'inventory.plan.manage',
    ];
    await bootstrapRole(connection, {
      key: R_REP,
      name: label('representative'),
      permissions: [
        'inventory.project.view',
        'inventory.unit.view',
        'inventory.unit.viewPricing',
        'inventory.hold.create',
      ],
    });
    await bootstrapRole(connection, {
      key: R_MANAGER,
      name: label('manager'),
      permissions: manage,
    });
    await bootstrapRole(connection, {
      key: R_VIEWER_NO_PRICE,
      name: label('viewer'),
      permissions: ['inventory.project.view', 'inventory.unit.view'],
    });
    await bootstrapRole(connection, {
      key: R_VIEWER_PRICE,
      name: label('viewer with pricing'),
      permissions: ['inventory.project.view', 'inventory.unit.view', 'inventory.unit.viewPricing'],
    });
    for (const [accountId, roleKey] of [
      [MANAGER, R_MANAGER],
      [VIEWER_NO_PRICE, R_VIEWER_NO_PRICE],
      [VIEWER_PRICE, R_VIEWER_PRICE],
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
      {
        basePath: '/inventory',
        router: inventoryRouter({
          getService: () => inventory,
          getPrices: () => prices,
          getHolds: () => holds,
          getTemplates: () => templates,
        }),
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
      UNIT_EVENTS_COLLECTION,
      UNITS_COLLECTION,
      BUILDINGS_COLLECTION,
      PROJECTS_COLLECTION,
      PRICE_VERSIONS_COLLECTION,
      HOLDS_COLLECTION,
      PLAN_TEMPLATES_COLLECTION,
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
      UNIT_EVENTS_COLLECTION,
      UNITS_COLLECTION,
      PRICE_VERSIONS_COLLECTION,
      HOLDS_COLLECTION,
    ]) {
      await connection.collection(name).deleteMany({});
    }
    today = '2026-10-01';
    clock = new Date('2026-10-01T09:00:00.000Z');
    holdHours = 48;
    approvalPolicy = false;
    approvalStates.clear();
  });

  describe('authorization and validation', () => {
    it('answers 401 without an actor and 403 without the permission', async () => {
      await api().get('/api/v1/inventory/units?limit=5').expect(401);
      await bootstrapGrant(connection, {
        accountId: NO_GRANT,
        roleKeys: [],
        scope: scope('all'),
        updatedBy: 'test',
      });
      await as(NO_GRANT).get('/api/v1/inventory/units?limit=5').expect(403);
    });

    it('rejects an unknown field rather than dropping it', async () => {
      const { building } = await makeProject();
      await as(MANAGER)
        .post('/api/v1/inventory/units')
        .send({
          buildingId: building.buildingId,
          code: nextCode('U'),
          floor: 1,
          propertyType: 'apartment',
          usageType: 'residential',
          area: '100',
          basePrice: egp('1000000'),
          finishingStatus: 'semiFinished',
          // A caller must not be able to create a unit already reserved, or with a derived price.
          status: 'reserved',
        })
        .expect(400);
    });

    it('rejects an operator object in a query parameter', async () => {
      await as(VIEWER_PRICE).get('/api/v1/inventory/units?status[$ne]=sold').expect(400);
    });

    it('rejects a page size above the maximum instead of clamping it', async () => {
      await as(VIEWER_PRICE).get('/api/v1/inventory/units?limit=5000').expect(400);
    });
  });

  describe('unit creation', () => {
    it('derives the price per square metre and never accepts one', async () => {
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId, {
        area: '100',
        basePrice: egp('2500000'),
      });
      const read = await as(VIEWER_PRICE).get(`/api/v1/inventory/units/${unit.unitId}`).expect(200);
      expect(read.body.pricePerSquareMeter).toEqual({ amount: '25000', currency: 'EGP' });
    });

    it('rounds the derived price to two places without binary floating point', async () => {
      const { building } = await makeProject();
      // 1000000 / 3 = 333333.333…; half-even at two places is 333333.33.
      const unit = await makeUnit(building.buildingId, { area: '3', basePrice: egp('1000000') });
      const read = await as(VIEWER_PRICE).get(`/api/v1/inventory/units/${unit.unitId}`).expect(200);
      expect(read.body.pricePerSquareMeter.amount).toBe('333333.33');
    });

    it("refuses a price in a currency other than the project's, rather than converting it", async () => {
      const { building } = await makeProject();
      await as(MANAGER)
        .post('/api/v1/inventory/units')
        .send({
          buildingId: building.buildingId,
          code: nextCode('U'),
          floor: 1,
          propertyType: 'apartment',
          usageType: 'residential',
          area: '100',
          basePrice: { amount: '100000', currency: 'USD' },
          finishingStatus: 'semiFinished',
        })
        .expect(409);
    });

    it('refuses a floor above the building and a duplicate code inside the project', async () => {
      const { building } = await makeProject();
      await as(MANAGER)
        .post('/api/v1/inventory/units')
        .send({
          buildingId: building.buildingId,
          code: nextCode('U'),
          floor: 99,
          propertyType: 'apartment',
          usageType: 'residential',
          area: '100',
          basePrice: egp('1000000'),
          finishingStatus: 'semiFinished',
        })
        .expect(409);

      const unit = await makeUnit(building.buildingId);
      await as(MANAGER)
        .post('/api/v1/inventory/units')
        .send({
          buildingId: building.buildingId,
          code: unit.code,
          floor: 2,
          propertyType: 'apartment',
          usageType: 'residential',
          area: '100',
          basePrice: egp('1000000'),
          finishingStatus: 'semiFinished',
        })
        .expect(409);
    });

    it('writes a created event on the unit timeline', async () => {
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId);
      const history = await as(VIEWER_PRICE)
        .get(`/api/v1/inventory/units/${unit.unitId}/history`)
        .expect(200);
      expect(history.body.items).toHaveLength(1);
      expect(history.body.items[0].kind).toBe('created');
      expect(history.body.items[0].toStatus).toBe('available');
    });
  });

  describe('field restriction on pricing (SEC-029)', () => {
    it('omits price fields entirely for an actor without inventory.unit.viewPricing', async () => {
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId);

      const single = await as(VIEWER_NO_PRICE)
        .get(`/api/v1/inventory/units/${unit.unitId}`)
        .expect(200);
      expect(single.body).not.toHaveProperty('basePrice');
      expect(single.body).not.toHaveProperty('currentPrice');
      expect(single.body).not.toHaveProperty('pricePerSquareMeter');
      // Absent, not null: a null would still tell the client a price exists and was withheld.
      expect(JSON.stringify(single.body)).not.toContain('3000000');
      // Everything else is still there, so the actor can do their job.
      expect(single.body.code).toBe(unit.code);
      expect(single.body.status).toBe('available');

      const list = await as(VIEWER_NO_PRICE).get('/api/v1/inventory/units?limit=50').expect(200);
      for (const item of list.body.items as Record<string, unknown>[]) {
        expect(item).not.toHaveProperty('basePrice');
      }
    });

    it('includes them for an actor who holds it', async () => {
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId);
      const single = await as(VIEWER_PRICE)
        .get(`/api/v1/inventory/units/${unit.unitId}`)
        .expect(200);
      expect(single.body.basePrice).toEqual({ amount: '3000000', currency: 'EGP' });
    });
  });

  describe('the unit state machine', () => {
    it('permits a transition the machine allows and records it on the timeline', async () => {
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId);
      const changed = await as(MANAGER)
        .post(`/api/v1/inventory/units/${unit.unitId}/status`)
        .send({ status: 'unavailable', reason: 'withdrawn for renovation' })
        .expect(200);
      expect(changed.body.status).toBe('unavailable');
      expect(changed.body.version).toBe(unit.version + 1);

      const history = await as(MANAGER)
        .get(`/api/v1/inventory/units/${unit.unitId}/history`)
        .expect(200);
      const statusEvent = (history.body.items as { kind: string; toStatus?: string }[]).find(
        (e) => e.kind === 'statusChanged',
      );
      expect(statusEvent?.toStatus).toBe('unavailable');
    });

    it('refuses a transition the machine forbids, changes nothing, and audits the attempt', async () => {
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId);
      await inventory.applyStatusChange(
        (await security.resolveActor(MANAGER))!,
        { unitId: unit.unitId, from: 'available', to: 'reserved', reason: 'held for test' },
        { correlationId: 'test' },
      );
      // reserved -> held is not in the transition table.
      const refused = await as(MANAGER)
        .post(`/api/v1/inventory/units/${unit.unitId}/status`)
        .send({ status: 'held', reason: 'should be refused' })
        .expect(409);
      expect(refused.body.error.code).toBe('CONFLICT');

      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.status).toBe('reserved');

      const refusals = await connection
        .collection(AUDIT_COLLECTION)
        .find({
          action: INVENTORY_AUDIT_ACTIONS.unitStatusRefused,
          'target.id': unit.unitId,
        })
        .toArray();
      expect(refusals.length).toBeGreaterThan(0);
      expect(refusals[0]?.['outcome']).toBe('denied');
    });

    it('refuses a stale expectedVersion and leaves the unit alone', async () => {
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId);
      await as(MANAGER)
        .post(`/api/v1/inventory/units/${unit.unitId}/status`)
        .send({ status: 'unavailable', reason: 'first change' })
        .expect(200);
      await as(MANAGER)
        .post(`/api/v1/inventory/units/${unit.unitId}/status`)
        .send({ status: 'available', reason: 'stale', expectedVersion: unit.version })
        .expect(409);
      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.status).toBe('unavailable');
    });

    it('lets exactly one of two simultaneous reservation attempts win', async () => {
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId);
      const actor = (await security.resolveActor(MANAGER))!;

      const attempt = (reservationId: string) =>
        inventory.applyStatusChange(
          actor,
          {
            unitId: unit.unitId,
            from: 'available',
            to: 'reserved',
            reason: 'concurrent attempt',
            sourceType: 'reservation',
            sourceId: reservationId,
            reservationId,
          },
          { correlationId: 'test' },
        );

      const results = await Promise.allSettled([
        attempt('rsv_concurrencytestaaaaaaaaaaaaaaa1'),
        attempt('rsv_concurrencytestbbbbbbbbbbbbbbb2'),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.status).toBe('reserved');
      // The unit is held by exactly one of the two, and its version moved exactly once.
      expect(stored?.version).toBe(unit.version + 1);
      expect([
        'rsv_concurrencytestaaaaaaaaaaaaaaa1',
        'rsv_concurrencytestbbbbbbbbbbbbbbb2',
      ]).toContain(stored?.heldByReservationId);
    });
  });

  describe('scope, counts, and pagination', () => {
    it('constrains rows, the total, and the summary with the same filter', async () => {
      const a = await makeProject(BRANCH_A);
      const b = await makeProject(BRANCH_B);
      await makeUnit(a.building.buildingId);
      await makeUnit(a.building.buildingId);
      await makeUnit(b.building.buildingId);

      await bootstrapGrant(connection, {
        accountId: PROJECT_SCOPED,
        roleKeys: [R_VIEWER_PRICE],
        scope: scope('project', { projectIds: [a.project.projectId] }),
        updatedBy: 'test',
      });

      const unscoped = await as(VIEWER_PRICE).get('/api/v1/inventory/units?limit=50').expect(200);
      const scoped = await as(PROJECT_SCOPED).get('/api/v1/inventory/units?limit=50').expect(200);

      expect(unscoped.body.total).toBe(3);
      expect(scoped.body.total).toBe(2);
      expect(scoped.body.items).toHaveLength(2);
      for (const item of scoped.body.items as { projectId: string }[]) {
        expect(item.projectId).toBe(a.project.projectId);
      }

      const summary = await as(PROJECT_SCOPED).get('/api/v1/inventory/units/summary').expect(200);
      expect(summary.body.total).toBe(2);
      expect(summary.body.byStatus.available).toBe(2);
    });

    it('answers 404, not 403, for a unit outside the scope', async () => {
      const a = await makeProject(BRANCH_A);
      const b = await makeProject(BRANCH_B);
      const outside = await makeUnit(b.building.buildingId);
      await bootstrapGrant(connection, {
        accountId: PROJECT_SCOPED,
        roleKeys: [R_VIEWER_PRICE],
        scope: scope('project', { projectIds: [a.project.projectId] }),
        updatedBy: 'test',
      });

      const hidden = await as(PROJECT_SCOPED)
        .get(`/api/v1/inventory/units/${outside.unitId}`)
        .expect(404);
      const absent = await as(PROJECT_SCOPED)
        .get('/api/v1/inventory/units/unit_doesnotexist000000000000000001')
        .expect(404);
      // The two answers are byte-identical apart from the correlation id, so one cannot probe the other.
      expect(hidden.body.error.code).toBe(absent.body.error.code);
      expect(Object.keys(hidden.body.error)).toEqual(Object.keys(absent.body.error));
    });

    it('returns each unit exactly once across keyset pages', async () => {
      const { building } = await makeProject();
      for (let i = 0; i < 7; i += 1) await makeUnit(building.buildingId);

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page += 1) {
        const url = `/api/v1/inventory/units?limit=3${cursor ? `&cursor=${cursor}` : ''}`;
        const response = await as(VIEWER_PRICE).get(url).expect(200);
        seen.push(...(response.body.items as { unitId: string }[]).map((u) => u.unitId));
        cursor = response.body.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
    });

    it('matches a unit code as an anchored prefix, not as a regular expression', async () => {
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId);
      const prefix = unit.code.slice(0, 3);

      const found = await as(VIEWER_PRICE)
        .get(`/api/v1/inventory/units?code=${prefix}`)
        .expect(200);
      expect(found.body.total).toBeGreaterThan(0);

      // A regular expression metacharacter is matched literally, so it finds nothing.
      const literal = await as(VIEWER_PRICE).get('/api/v1/inventory/units?code=.*').expect(200);
      expect(literal.body.total).toBe(0);
    });
  });

  describe('no hard delete, append-only history (ADR-0009, ADR-0021)', () => {
    it('refuses every deletion path on a unit', async () => {
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId);
      const model = unitModel(connection);
      await expect(model.deleteOne({ unitId: unit.unitId })).rejects.toThrow(/never deleted/);
      await expect(model.deleteMany({})).rejects.toThrow(/never deleted/);
      expect(await model.findOne({ unitId: unit.unitId }).lean().exec()).not.toBeNull();
    });

    it('refuses every mutation of the unit timeline', async () => {
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId);
      const events = unitEventModel(connection);
      await expect(
        events.updateOne({ unitId: unit.unitId }, { $set: { reason: 'tampered' } }),
      ).rejects.toThrow(/append-only/);
      await expect(events.deleteMany({ unitId: unit.unitId })).rejects.toThrow(/append-only/);
      const stored = await events.find({ unitId: unit.unitId }).lean().exec();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.reason).toBeUndefined();
    });
  });

  /* ------------------------------------------------------------ BMP-1 package 4 */

  const context = { correlationId: `${RUN}-direct` };

  async function grantRepresentatives(): Promise<void> {
    for (const accountId of [REP_A, REP_A_TWO]) {
      await bootstrapGrant(connection, {
        accountId,
        roleKeys: [R_REP],
        scope: scope('assigned', { branchIds: [BRANCH_A] }),
        updatedBy: 'test',
      });
    }
    await bootstrapGrant(connection, {
      accountId: REP_NOWHERE,
      roleKeys: [R_REP],
      scope: scope('assigned'),
      updatedBy: 'test',
    });
  }

  describe('catalogue scope for representatives (SEC-034)', () => {
    it("lets an assigned-scope representative read their branch's inventory, and only it", async () => {
      await grantRepresentatives();
      const a = await makeProject(BRANCH_A);
      const b = await makeProject(BRANCH_B);
      const inside = await makeUnit(a.building.buildingId);
      const outside = await makeUnit(b.building.buildingId);
      const list = await as(REP_A).get('/api/v1/inventory/units?limit=50').expect(200);
      expect(list.body.total).toBe(1);
      expect(list.body.items[0].unitId).toBe(inside.unitId);
      await as(REP_A).get(`/api/v1/inventory/units/${outside.unitId}`).expect(404);
      const projects = await as(REP_A).get('/api/v1/inventory/projects').expect(200);
      const visible = (projects.body.items as { projectId: string; branchId: string }[]).map(
        (p) => p.projectId,
      );
      expect(visible).toContain(a.project.projectId);
      expect(visible).not.toContain(b.project.projectId);
      for (const item of projects.body.items as { branchId: string }[]) {
        expect(item.branchId).toBe(BRANCH_A);
      }
    });

    it('shows nothing to a narrow scope that names no place — never everything', async () => {
      await grantRepresentatives();
      const a = await makeProject(BRANCH_A);
      await makeUnit(a.building.buildingId);
      const list = await as(REP_NOWHERE).get('/api/v1/inventory/units?limit=50').expect(200);
      expect(list.body.total).toBe(0);
    });
  });

  describe('a person cannot free a committed unit (INV-STATUS-001)', () => {
    it.each(['held', 'reserved'] as const)(
      'refuses to move a %s unit to available by hand, and audits it',
      async (status) => {
        const { building } = await makeProject();
        const unit = await makeUnit(building.buildingId);
        await inventory.applyStatusChange(
          (await security.resolveActor(MANAGER))!,
          {
            unitId: unit.unitId,
            from: 'available',
            to: status,
            reason: 'committed by a workflow',
            reservationId: 'rsv_manualstatustestaaaaaaaaaaaa01',
          },
          context,
        );
        const refused = await as(MANAGER)
          .post(`/api/v1/inventory/units/${unit.unitId}/status`)
          .send({ status: 'available', reason: 'trying to free it' })
          .expect(409);
        expect(refused.body.error.issues[0].code).toBe('STATUS_SET_BY_WORKFLOW');
        const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
        expect(stored).toMatchObject({
          status,
          heldByReservationId: 'rsv_manualstatustestaaaaaaaaaaaa01',
        });
      },
    );
  });

  describe('editing projects, buildings and units (INV-PROJECT-001/002, INV-UNIT-001)', () => {
    it('edits a unit’s attributes with the version read, and records it on the timeline', async () => {
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId, { bedrooms: 2, gardenArea: '40.5' });
      const edited = await as(MANAGER)
        .patch(`/api/v1/inventory/units/${unit.unitId}`)
        .send({ bedrooms: 3, bathrooms: 2, reason: 'plan revised', expectedVersion: unit.version })
        .expect(200);
      expect(edited.body).toMatchObject({ bedrooms: 3, bathrooms: 2, gardenArea: '40.5' });
      await as(MANAGER)
        .patch(`/api/v1/inventory/units/${unit.unitId}`)
        .send({ bedrooms: 4, reason: 'stale', expectedVersion: unit.version })
        .expect(409);
      // Area and price are what a customer signs for: not editable here.
      await as(MANAGER)
        .patch(`/api/v1/inventory/units/${unit.unitId}`)
        .send({ area: '200', reason: 'bigger', expectedVersion: unit.version + 1 })
        .expect(400);
      const history = await as(MANAGER)
        .get(`/api/v1/inventory/units/${unit.unitId}/history`)
        .expect(200);
      expect(history.body.items[0].kind).toBe('attributesChanged');
    });

    it('edits a project written before BMP-1 at version 1, and refuses a stale one', async () => {
      const { project } = await makeProject();
      await projectModel(connection).collection.updateOne(
        { projectId: project.projectId },
        { $unset: { version: '' } },
      );
      const edited = await as(MANAGER)
        .patch(`/api/v1/inventory/projects/${project.projectId}`)
        .send({ status: 'onHold', reason: 'permit review', expectedVersion: 1 })
        .expect(200);
      expect(edited.body).toMatchObject({ status: 'onHold', version: 2 });
      await as(MANAGER)
        .patch(`/api/v1/inventory/projects/${project.projectId}`)
        .send({ status: 'selling', reason: 'stale', expectedVersion: 1 })
        .expect(409);
    });

    it('refuses to lower a building below its highest unit', async () => {
      const { building } = await makeProject();
      await makeUnit(building.buildingId, { floor: 9 });
      const refused = await as(MANAGER)
        .patch(`/api/v1/inventory/buildings/${building.buildingId}`)
        .send({ floors: 5, reason: 'redesign', expectedVersion: 1 })
        .expect(409);
      expect(refused.body.error.issues[0].code).toBe('FLOOR_BELOW_UNITS');
      await as(MANAGER)
        .patch(`/api/v1/inventory/buildings/${building.buildingId}`)
        .send({ floors: 10, reason: 'redesign', expectedVersion: 1 })
        .expect(200);
    });
  });

  describe('search, matrix and comparison (INV-SEARCH-001 … 003)', () => {
    it('filters by area, bedrooms and price, and refuses a price filter to those who may not see prices', async () => {
      const { building } = await makeProject();
      await makeUnit(building.buildingId, { area: '90', bedrooms: 2, basePrice: egp('1800000') });
      await makeUnit(building.buildingId, { area: '140', bedrooms: 3, basePrice: egp('2900000') });
      await makeUnit(building.buildingId, { area: '200', bedrooms: 4, basePrice: egp('4100000') });
      const byArea = await as(VIEWER_NO_PRICE)
        .get('/api/v1/inventory/units?areaMin=100&areaMax=180')
        .expect(200);
      expect(byArea.body.total).toBe(1);
      const byRooms = await as(VIEWER_NO_PRICE)
        .get('/api/v1/inventory/units?bedrooms=4')
        .expect(200);
      expect(byRooms.body.total).toBe(1);
      const byPrice = await as(VIEWER_PRICE)
        .get('/api/v1/inventory/units?priceMin=2000000&priceMax=4100000')
        .expect(200);
      expect(byPrice.body.total).toBe(2);
      const refused = await as(VIEWER_NO_PRICE)
        .get('/api/v1/inventory/units?priceMax=2000000')
        .expect(403);
      expect(refused.body.error.issues[0].code).toBe('PRICE_FILTER_NOT_PERMITTED');
    });

    it('draws the matrix highest floor first, counts by status, and prices only for those who may see them', async () => {
      const { project, building } = await makeProject();
      await makeUnit(building.buildingId, { floor: 1 });
      await makeUnit(building.buildingId, { floor: 7 });
      const withdrawn = await makeUnit(building.buildingId, { floor: 7 });
      await as(MANAGER)
        .post(`/api/v1/inventory/units/${withdrawn.unitId}/status`)
        .send({ status: 'unavailable', reason: 'show unit' })
        .expect(200);
      const matrix = await as(VIEWER_NO_PRICE)
        .get(`/api/v1/inventory/projects/${project.projectId}/matrix`)
        .expect(200);
      const floors = matrix.body.buildings[0].floors as { floor: number; units: object[] }[];
      expect(floors.map((row) => row.floor)).toEqual([7, 1]);
      expect(floors[0]?.units).toHaveLength(2);
      expect(matrix.body.counts).toMatchObject({ available: 2, unavailable: 1 });
      expect(JSON.stringify(matrix.body)).not.toContain('currentPrice');
      const priced = await as(VIEWER_PRICE)
        .get(`/api/v1/inventory/projects/${project.projectId}/matrix`)
        .expect(200);
      expect(priced.body.buildings[0].floors[0].units[0].currentPrice).toEqual(egp('3000000'));
    });

    it('compares units in the order asked, and refuses one outside the scope as not found', async () => {
      await grantRepresentatives();
      const a = await makeProject(BRANCH_A);
      const b = await makeProject(BRANCH_B);
      const first = await makeUnit(a.building.buildingId);
      const second = await makeUnit(a.building.buildingId);
      const foreign = await makeUnit(b.building.buildingId);
      const compared = await as(REP_A)
        .get(`/api/v1/inventory/units/compare?ids=${second.unitId},${first.unitId}`)
        .expect(200);
      expect((compared.body.items as { unitId: string }[]).map((u) => u.unitId)).toEqual([
        second.unitId,
        first.unitId,
      ]);
      await as(REP_A)
        .get(`/api/v1/inventory/units/compare?ids=${first.unitId},${foreign.unitId}`)
        .expect(404);
      await as(REP_A).get(`/api/v1/inventory/units/compare?ids=${first.unitId}`).expect(400);
    });
  });

  describe('price versions (INV-PRICE-001 … 003)', () => {
    const propose = (
      unitId: string,
      price: string,
      effectiveFrom = today,
      key = `${Math.random()}`,
    ) =>
      as(MANAGER)
        .post(`/api/v1/inventory/units/${unitId}/prices`)
        .send({
          price: egp(price),
          effectiveFrom,
          reason: 'quarterly price list',
          idempotencyKey: `price-${key}`.padEnd(12, 'x'),
        });

    it('applies a change effective today when no policy applies, updating price and price per square metre', async () => {
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId, { area: '100', basePrice: egp('3000000') });
      const response = await propose(unit.unitId, '3300000').expect(201);
      expect(response.body).toMatchObject({
        state: 'effective',
        changePercentage: '10',
        previousPrice: egp('3000000'),
      });
      const read = await as(VIEWER_PRICE).get(`/api/v1/inventory/units/${unit.unitId}`).expect(200);
      expect(read.body.currentPrice).toEqual(egp('3300000'));
      expect(read.body.basePrice).toEqual(egp('3000000'));
      expect(read.body.pricePerSquareMeter.amount).toBe('33000');
      const history = await as(VIEWER_PRICE)
        .get(`/api/v1/inventory/units/${unit.unitId}/history`)
        .expect(200);
      expect(history.body.items[0]).toMatchObject({
        kind: 'priceChanged',
        sourceType: 'priceVersion',
      });
    });

    it('refuses a past date, the same price, and a second open change', async () => {
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId);
      const past = await propose(unit.unitId, '3100000', '2026-09-30').expect(400);
      expect(past.body.error.issues[0].code).toBe('PRICE_DATE_IN_PAST');
      await propose(unit.unitId, '3000000').expect(400);
      await propose(unit.unitId, '3200000', '2026-11-01').expect(201);
      const second = await propose(unit.unitId, '3250000', '2026-12-01').expect(409);
      expect(second.body.error.issues[0].code).toBe('PRICE_CHANGE_PENDING');
    });

    it('schedules a future change and applies it when the sweep reaches its date', async () => {
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId);
      const scheduled = await propose(unit.unitId, '2850000', '2026-11-01').expect(201);
      expect(scheduled.body.state).toBe('scheduled');
      expect((await prices.sweep(MAINTENANCE_ACTOR, context)).applied).toBe(0);
      today = '2026-11-01';
      expect((await prices.sweep(MAINTENANCE_ACTOR, context)).applied).toBe(1);
      // Idempotent: a second run applies nothing again.
      expect((await prices.sweep(MAINTENANCE_ACTOR, context)).applied).toBe(0);
      const read = await as(VIEWER_PRICE).get(`/api/v1/inventory/units/${unit.unitId}`).expect(200);
      expect(read.body.currentPrice).toEqual(egp('2850000'));
    });

    it('waits for approval when a policy applies, then applies on approval or ends on rejection', async () => {
      approvalPolicy = true;
      const { building } = await makeProject();
      const approved = await makeUnit(building.buildingId);
      const refused = await makeUnit(building.buildingId);
      const first = await propose(approved.unitId, '2700000').expect(201);
      expect(first.body.state).toBe('pendingApproval');
      const unchanged = await as(VIEWER_PRICE)
        .get(`/api/v1/inventory/units/${approved.unitId}`)
        .expect(200);
      // No price takes effect before its approval.
      expect(unchanged.body.currentPrice).toEqual(egp('3000000'));
      approvalStates.set(first.body.approvalRequestId as string, 'approved');
      expect(
        await prices.syncApproval(
          MAINTENANCE_ACTOR,
          first.body.approvalRequestId as string,
          context,
        ),
      ).toBe('applied');
      const read = await as(VIEWER_PRICE)
        .get(`/api/v1/inventory/units/${approved.unitId}`)
        .expect(200);
      expect(read.body.currentPrice).toEqual(egp('2700000'));

      const second = await propose(refused.unitId, '2500000').expect(201);
      approvalStates.set(second.body.approvalRequestId as string, 'rejected');
      expect((await prices.sweep(MAINTENANCE_ACTOR, context)).settled).toBe(1);
      const versions = await as(VIEWER_PRICE)
        .get(`/api/v1/inventory/units/${refused.unitId}/prices`)
        .expect(200);
      expect(versions.body.items[0].state).toBe('rejected');
    });

    it('replays an idempotent proposal and hides the history from those who may not see prices', async () => {
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId);
      const first = await propose(unit.unitId, '3100000', today, 'replay-one').expect(201);
      const again = await propose(unit.unitId, '3100000', today, 'replay-one').expect(200);
      expect(again.body.priceVersionId).toBe(first.body.priceVersionId);
      await propose(unit.unitId, '3200000', today, 'replay-one').expect(409);
      await as(VIEWER_NO_PRICE).get(`/api/v1/inventory/units/${unit.unitId}/prices`).expect(403);
    });
  });

  describe('timed holds (INV-HOLD-001, 002)', () => {
    const takeHold = (accountId: string, unitId: string, key = `${Math.random()}`) =>
      as(accountId)
        .post('/api/v1/inventory/holds')
        .send({ unitId, idempotencyKey: `hold-${key}`.padEnd(12, 'x') });

    it('refuses every hold while no hold length is configured (BD-29)', async () => {
      holdHours = null;
      await grantRepresentatives();
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId);
      const refused = await takeHold(REP_A, unit.unitId).expect(409);
      expect(refused.body.error.issues[0].code).toBe('HOLD_DURATION_NOT_CONFIGURED');
      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.status).toBe('available');
    });

    it('lets exactly one of two simultaneous holds win', async () => {
      await grantRepresentatives();
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId);
      const results = await Promise.all([
        takeHold(REP_A, unit.unitId),
        takeHold(REP_A_TWO, unit.unitId),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.status).toBe('held');
      expect(
        await connection.collection(HOLDS_COLLECTION).countDocuments({ state: 'active' }),
      ).toBe(1);
    });

    it('lets only the holder or a manager release, and returns the unit', async () => {
      await grantRepresentatives();
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId);
      const hold = await takeHold(REP_A, unit.unitId).expect(201);
      const refused = await as(REP_A_TWO)
        .post(`/api/v1/inventory/holds/${hold.body.holdId as string}/release`)
        .send({ reason: 'not mine to release' })
        .expect(403);
      expect(refused.body.error.issues[0].code).toBe('NOT_HOLDER');
      await as(REP_A)
        .post(`/api/v1/inventory/holds/${hold.body.holdId as string}/release`)
        .send({ reason: 'customer declined' })
        .expect(200);
      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.status).toBe('available');
      expect(stored?.heldByHoldId).toBeUndefined();
    });

    it('expires an overdue hold on the sweep and returns the unit, once', async () => {
      await grantRepresentatives();
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId);
      await takeHold(REP_A, unit.unitId).expect(201);
      clock = new Date('2026-10-03T08:59:00.000Z');
      expect((await holds.sweep(MAINTENANCE_ACTOR, context)).expired).toBe(0);
      clock = new Date('2026-10-03T09:01:00.000Z');
      expect((await holds.sweep(MAINTENANCE_ACTOR, context)).expired).toBe(1);
      expect((await holds.sweep(MAINTENANCE_ACTOR, context)).expired).toBe(0);
      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.status).toBe('available');
    });

    it('extends at once without a policy, and through approval with one', async () => {
      await grantRepresentatives();
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId);
      const hold = await takeHold(REP_A, unit.unitId).expect(201);
      const extended = await as(REP_A)
        .post(`/api/v1/inventory/holds/${hold.body.holdId as string}/extend`)
        .send({ reason: 'customer travelling', expectedVersion: 1 })
        .expect(200);
      expect(extended.body.expiresAt).toBe('2026-10-05T09:00:00.000Z');
      expect(extended.body.extensions).toBe(1);

      approvalPolicy = true;
      const pending = await as(REP_A)
        .post(`/api/v1/inventory/holds/${hold.body.holdId as string}/extend`)
        .send({ reason: 'still travelling', expectedVersion: extended.body.version as number })
        .expect(200);
      expect(pending.body.extensionApprovalRequestId).toBeDefined();
      expect(pending.body.expiresAt).toBe('2026-10-05T09:00:00.000Z');
      approvalStates.set(pending.body.extensionApprovalRequestId as string, 'approved');
      expect((await holds.sweep(MAINTENANCE_ACTOR, context)).extended).toBe(1);
      const read = await as(REP_A)
        .get(`/api/v1/inventory/holds/${hold.body.holdId as string}`)
        .expect(200);
      expect(read.body).toMatchObject({ expiresAt: '2026-10-07T09:00:00.000Z', extensions: 2 });
    });

    it("hands a hold's unit to a reservation inside the reservation's transaction", async () => {
      await grantRepresentatives();
      const { building } = await makeProject();
      const unit = await makeUnit(building.buildingId);
      const hold = await takeHold(REP_A, unit.unitId).expect(201);
      const reservationId = 'rsv_holdconversiontestaaaaaaaaa01';
      await withTransaction(connection, async (session) =>
        holds.convert(
          (await security.resolveActor(REP_A))!,
          hold.body.holdId as string,
          reservationId,
          { unitId: unit.unitId },
          context,
          session,
        ),
      );
      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored).toMatchObject({ status: 'held', heldByReservationId: reservationId });
      expect(stored?.heldByHoldId).toBeUndefined();
      const read = await as(REP_A)
        .get(`/api/v1/inventory/holds/${hold.body.holdId as string}`)
        .expect(200);
      expect(read.body).toMatchObject({ state: 'converted', reservationId });
      // A converted hold neither expires nor releases the unit again.
      clock = new Date('2026-12-01T00:00:00.000Z');
      expect((await holds.sweep(MAINTENANCE_ACTOR, context)).expired).toBe(0);
    });
  });

  describe('payment-plan templates (INV-PLAN-001)', () => {
    it('previews a template on a unit with a schedule that reconciles to the piastre', async () => {
      const { project, building } = await makeProject();
      const unit = await makeUnit(building.buildingId, { basePrice: egp('1000000.01') });
      const created = await as(MANAGER)
        .post('/api/v1/inventory/plan-templates')
        .send({
          code: nextCode('PT'),
          name: label('Ten percent over three years'),
          projectIds: [project.projectId],
          legalEntityId: LEGAL_ENTITY,
          downPaymentPercent: '10',
          installmentCount: 12,
          frequency: 'quarterly',
          firstInstallmentAfterMonths: 3,
        })
        .expect(201);
      const listed = await as(VIEWER_PRICE)
        .get(`/api/v1/inventory/plan-templates?projectId=${project.projectId}`)
        .expect(200);
      expect(listed.body.items).toHaveLength(1);
      const preview = await as(VIEWER_PRICE)
        .post(`/api/v1/inventory/plan-templates/${created.body.templateId as string}/preview`)
        .send({ unitId: unit.unitId, contractDate: '2026-10-01' })
        .expect(200);
      expect(preview.body.plan.downPayment).toEqual(egp('100000'));
      expect(preview.body.plan.firstDueOn).toBe('2027-01-01');
      expect(preview.body.schedule.rows).toHaveLength(13);
      expect(preview.body.schedule.rowsTotal).toEqual(preview.body.schedule.total);
    });

    it('refuses a retired template and one the unit’s project is not eligible for', async () => {
      const first = await makeProject();
      const second = await makeProject();
      const unit = await makeUnit(second.building.buildingId);
      const onlyFirst = await as(MANAGER)
        .post('/api/v1/inventory/plan-templates')
        .send({
          code: nextCode('PT'),
          name: label('First project only'),
          projectIds: [first.project.projectId],
          legalEntityId: LEGAL_ENTITY,
          downPaymentPercent: '20',
          installmentCount: 8,
          frequency: 'semiAnnual',
          firstInstallmentAfterMonths: 6,
        })
        .expect(201);
      const ineligible = await as(VIEWER_PRICE)
        .post(`/api/v1/inventory/plan-templates/${onlyFirst.body.templateId as string}/preview`)
        .send({ unitId: unit.unitId, contractDate: '2026-10-01' })
        .expect(409);
      expect(ineligible.body.error.issues[0].code).toBe('TEMPLATE_NOT_ELIGIBLE');
      await as(MANAGER)
        .post(`/api/v1/inventory/plan-templates/${onlyFirst.body.templateId as string}/retire`)
        .send({ reason: 'replaced by the 2027 plan' })
        .expect(200);
      const firstUnit = await makeUnit(first.building.buildingId);
      await as(VIEWER_PRICE)
        .post(`/api/v1/inventory/plan-templates/${onlyFirst.body.templateId as string}/preview`)
        .send({ unitId: firstUnit.unitId, contractDate: '2026-10-01' })
        .expect(409);
    });

    it('refuses percentages that add up to more than the whole price', async () => {
      const { project } = await makeProject();
      await as(MANAGER)
        .post('/api/v1/inventory/plan-templates')
        .send({
          code: nextCode('PT'),
          name: label('Impossible'),
          projectIds: [project.projectId],
          legalEntityId: LEGAL_ENTITY,
          downPaymentPercent: '60',
          finalPaymentPercent: '50',
          installmentCount: 4,
          frequency: 'annual',
          firstInstallmentAfterMonths: 12,
        })
        .expect(400);
    });
  });
});
