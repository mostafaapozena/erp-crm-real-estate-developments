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
  BUILDINGS_COLLECTION,
  PROJECTS_COLLECTION,
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
  let app: Express;

  const R_MANAGER = `${RUN}-r-manager`;
  const R_VIEWER_NO_PRICE = `${RUN}-r-viewer-noprice`;
  const R_VIEWER_PRICE = `${RUN}-r-viewer-price`;

  const MANAGER = `${RUN}-manager`;
  const VIEWER_NO_PRICE = `${RUN}-viewer-noprice`;
  const VIEWER_PRICE = `${RUN}-viewer-price`;
  const PROJECT_SCOPED = `${RUN}-project-scoped`;
  const NO_GRANT = `${RUN}-no-grant`;

  const api = () => request(app);
  const as = (accountId?: string) => {
    const withAccount = <T extends { set: (field: string, value: string) => T }>(call: T): T =>
      accountId ? call.set(ACCOUNT_HEADER, accountId) : call;
    return {
      get: (path: string) => withAccount(api().get(path)),
      post: (path: string) => withAccount(api().post(path).set('Origin', ALLOWED_ORIGIN)),
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

    const manage: Permission[] = [
      'inventory.project.view',
      'inventory.project.manage',
      'inventory.unit.view',
      'inventory.unit.manage',
      'inventory.unit.viewPricing',
    ];
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
      { basePath: '/inventory', router: inventoryRouter({ getService: () => inventory }) },
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
    for (const name of [UNIT_EVENTS_COLLECTION, UNITS_COLLECTION]) {
      await connection.collection(name).deleteMany({});
    }
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
});
