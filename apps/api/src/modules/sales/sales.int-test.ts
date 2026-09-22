import {
  BusinessDateSchema,
  DecimalStringSchema,
  SALES_AUDIT_ACTIONS,
  ScopeAssignmentSchema,
  addMoney,
  compareMoney,
  money,
  type Money,
  type PaymentPlan,
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
import { ACTIVITIES_COLLECTION, CUSTOMERS_COLLECTION, CrmService, LEADS_COLLECTION } from '../crm';
import {
  BUILDINGS_COLLECTION,
  InventoryService,
  PROJECTS_COLLECTION,
  UNITS_COLLECTION,
  UNIT_EVENTS_COLLECTION,
  unitModel,
} from '../inventory';
import {
  ACCOUNT_GRANTS_COLLECTION,
  ROLES_COLLECTION,
  SecurityService,
  bootstrapGrant,
  bootstrapRole,
} from '../security';
import {
  CONTRACTS_COLLECTION,
  COUNTERS_COLLECTION,
  INSTALLMENTS_COLLECTION,
  RESERVATIONS_COLLECTION,
  contractModel,
  installmentModel,
  reservationModel,
} from './model';
import { salesRouter } from './router';
import { SalesService } from './service';

/**
 * The demonstration journey end to end, against a real MongoDB replica set.
 *
 * This suite is where the two expensive invariants are proven: **a unit cannot be sold twice**, and
 * **a stored schedule reconciles exactly to the contract total**. Everything else here exists so those
 * two can be exercised through the real routes rather than against a fixture.
 */
const gate = serviceGate(['mongodb']);
const RUN = `it-sales-${Date.now()}`;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const ACCOUNT_HEADER = 'x-test-account';

const scope = (level: ScopeAssignment['level'], overrides: Partial<ScopeAssignment> = {}) =>
  ScopeAssignmentSchema.parse({ level, ...overrides });

const label = (en: string) => ({ ar: `عربي ${en}`, en });
const egp = (amount: string): Money => money(amount, 'EGP');
const TODAY = BusinessDateSchema.parse('2026-09-22');

const LEGAL_ENTITY = 'le_salestestlegalentity0000000001';
const BRANCH_A = 'br_salestestbranchaaaaaaaaaaaa0001';
const BRANCH_B = 'br_salestestbranchbbbbbbbbbbbb0002';

describe.skipIf(!gate.available)(`sales module — ${gate.reason}`, () => {
  let connection: Connection;
  let audit: AuditService;
  let security: SecurityService;
  let inventory: InventoryService;
  let crm: CrmService;
  let sales: SalesService;
  let app: Express;

  const R_SALES = `${RUN}-r-sales`;
  const R_REP = `${RUN}-r-rep`;
  const R_VIEWER = `${RUN}-r-viewer`;

  const MANAGER = `${RUN}-manager`;
  const REP_ONE = `${RUN}-rep-one`;
  const REP_TWO = `${RUN}-rep-two`;
  const VIEWER = `${RUN}-viewer`;
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
  const nextKey = (prefix: string) => {
    counter += 1;
    return `${prefix}${String(counter).padStart(5, '0')}`;
  };

  const resolveBranch = (branchId: string) =>
    Promise.resolve(
      branchId === BRANCH_A || branchId === BRANCH_B ? { legalEntityId: LEGAL_ENTITY } : undefined,
    );

  async function actorFor(accountId: string) {
    const actor = await security.resolveActor(accountId);
    if (!actor) throw new Error(`no actor for ${accountId}`);
    return actor;
  }

  /** A project, a building and one available unit, created straight through the services. */
  async function makeUnit(price = '3000000', branchId = BRANCH_A) {
    const actor = await actorFor(MANAGER);
    const context = { correlationId: 'fixture' };
    const project = await inventory.createProject(
      actor,
      {
        branchId,
        code: nextKey('PRJ'),
        name: label('Project'),
        city: label('Cairo'),
        currency: 'EGP',
        status: 'selling',
      },
      context,
    );
    const building = await inventory.createBuilding(
      actor,
      { projectId: project.projectId, code: nextKey('BLD'), name: label('Building'), floors: 20 },
      context,
    );
    const unit = await inventory.createUnit(
      actor,
      {
        buildingId: building.buildingId,
        code: nextKey('U'),
        floor: 5,
        propertyType: 'apartment',
        usageType: 'residential',
        area: DecimalStringSchema.parse('150'),
        basePrice: egp(price),
        finishingStatus: 'semiFinished',
      },
      context,
    );
    return { project, building, unit };
  }

  async function makeCustomer(ownerAccountId = REP_ONE, branchId = BRANCH_A) {
    const actor = await actorFor(MANAGER);
    return crm.createCustomer(
      actor,
      {
        name: 'عميل تجريبي',
        primaryPhone: `+2011${String(1000000 + counter++).padStart(8, '0')}`,
        branchId,
        ownerAccountId,
      },
      { correlationId: 'fixture' },
    );
  }

  const defaultPlan: PaymentPlan = {
    downPayment: egp('600000'),
    installmentCount: 12,
    frequency: 'monthly',
    firstDueOn: BusinessDateSchema.parse('2026-10-01'),
  };

  interface ReserveOptions {
    unitId: string;
    customerId: string;
    reservationAmount?: Money;
    agreedPrice?: Money;
    paymentPlan?: PaymentPlan;
    idempotencyKey?: string;
    expectStatus?: number;
  }

  interface ReservationBody {
    reservationId: string;
    reservationNumber: string;
    state: string;
    version: number;
  }

  async function reserve(accountId: string, options: ReserveOptions): Promise<ReservationBody> {
    const response = await as(accountId)
      .post('/api/v1/sales/reservations')
      .send({
        customerId: options.customerId,
        unitId: options.unitId,
        reservationAmount: options.reservationAmount ?? egp('100000'),
        agreedPrice: options.agreedPrice ?? egp('3000000'),
        paymentPlan: options.paymentPlan ?? defaultPlan,
        idempotencyKey: options.idempotencyKey ?? nextKey('idem-rsv-'),
      })
      .expect(options.expectStatus ?? 201);
    return response.body as ReservationBody;
  }

  beforeAll(async () => {
    configureMongoose();
    const logger = createLogger({ name: 'it-sales', level: 'silent' });
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'] as string,
    });
    await connection.asPromise();
    await ensureIndexes(connection, logger);

    audit = new AuditService({ connection, logger, onRecorded: noteAuditWrite });
    security = new SecurityService({ connection, audit, logger });
    inventory = new InventoryService({ connection, audit, resolveBranch });
    crm = new CrmService({ connection, audit, resolveBranch, today: () => TODAY });
    sales = new SalesService({
      connection,
      logger,
      audit,
      units: {
        find: async (unitId, session) => {
          const unit = await inventory.findUnitForUpdate(unitId, session);
          return unit
            ? {
                unitId: unit.unitId,
                projectId: unit.projectId,
                legalEntityId: unit.legalEntityId,
                branchId: unit.branchId,
                code: unit.code,
                status: unit.status,
                ...(unit.currentPrice ? { currentPrice: unit.currentPrice } : {}),
              }
            : undefined;
        },
        changeStatus: (actor, change, context, session) =>
          inventory.applyStatusChange(
            actor,
            change as Parameters<InventoryService['applyStatusChange']>[1],
            context,
            session,
          ),
      },
      crm: {
        findCustomer: async (customerId, session) => {
          const customer = await crm.findCustomerUnscoped(customerId, session);
          return customer
            ? { customerId: customer.customerId, legalEntityId: customer.legalEntityId }
            : undefined;
        },
        advanceLead: (actor, leadId, to, reason, context, session) =>
          crm.advanceStageInternal(actor, leadId, to, reason, context, session),
      },
      // No approval port: this suite proves the sales mechanics. The approval path has its own test.
      today: () => TODAY,
    });

    const full: Permission[] = [
      'inventory.project.view',
      'inventory.project.manage',
      'inventory.unit.view',
      'inventory.unit.manage',
      'inventory.unit.viewPricing',
      'crm.customer.view',
      'crm.customer.manage',
      'crm.lead.view',
      'crm.lead.create',
      'crm.lead.edit',
      'sales.reservation.view',
      'sales.reservation.create',
      'sales.reservation.confirm',
      'sales.reservation.cancel',
      'sales.contract.view',
      'sales.contract.create',
      'sales.contract.cancel',
      'collection.installment.view',
    ];
    await bootstrapRole(connection, { key: R_SALES, name: label('sales'), permissions: full });
    await bootstrapRole(connection, {
      key: R_REP,
      name: label('rep'),
      permissions: full.filter(
        (permission) =>
          permission !== 'sales.contract.cancel' && permission !== 'sales.reservation.confirm',
      ),
    });
    await bootstrapRole(connection, {
      key: R_VIEWER,
      name: label('viewer'),
      permissions: ['sales.reservation.view', 'sales.contract.view'],
    });
    await bootstrapGrant(connection, {
      accountId: MANAGER,
      roleKeys: [R_SALES],
      scope: scope('all'),
      updatedBy: 'test',
    });
    for (const accountId of [REP_ONE, REP_TWO]) {
      await bootstrapGrant(connection, {
        accountId,
        roleKeys: [R_SALES],
        // Representatives see their own reservations and contracts.
        scope: scope('assigned'),
        updatedBy: 'test',
      });
    }
    await bootstrapGrant(connection, {
      accountId: VIEWER,
      roleKeys: [R_VIEWER],
      scope: scope('all'),
      updatedBy: 'test',
    });

    const actorResolver: ActorResolver = async (req) => {
      const accountId = req.get(ACCOUNT_HEADER);
      return accountId ? security.resolveActor(accountId) : undefined;
    };

    const modules: ApiModule[] = [
      { basePath: '/sales', router: salesRouter({ getService: () => sales }) },
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
      INSTALLMENTS_COLLECTION,
      CONTRACTS_COLLECTION,
      RESERVATIONS_COLLECTION,
      COUNTERS_COLLECTION,
      UNIT_EVENTS_COLLECTION,
      UNITS_COLLECTION,
      BUILDINGS_COLLECTION,
      PROJECTS_COLLECTION,
      ACTIVITIES_COLLECTION,
      LEADS_COLLECTION,
      CUSTOMERS_COLLECTION,
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
      INSTALLMENTS_COLLECTION,
      CONTRACTS_COLLECTION,
      RESERVATIONS_COLLECTION,
      UNIT_EVENTS_COLLECTION,
      UNITS_COLLECTION,
      BUILDINGS_COLLECTION,
      PROJECTS_COLLECTION,
      CUSTOMERS_COLLECTION,
    ]) {
      await connection.collection(name).deleteMany({});
    }
  });

  describe('authorization', () => {
    it('answers 401 without an actor and 403 without the permission', async () => {
      await api().get('/api/v1/sales/reservations').expect(401);
      await bootstrapGrant(connection, {
        accountId: NO_GRANT,
        roleKeys: [],
        scope: scope('all'),
        updatedBy: 'test',
      });
      await as(NO_GRANT).get('/api/v1/sales/reservations').expect(403);
    });

    it('refuses a viewer the create endpoint and stores nothing', async () => {
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      await as(VIEWER)
        .post('/api/v1/sales/reservations')
        .send({
          customerId: customer.customerId,
          unitId: unit.unitId,
          reservationAmount: egp('100000'),
          agreedPrice: egp('3000000'),
          paymentPlan: defaultPlan,
          idempotencyKey: nextKey('idem-'),
        })
        .expect(403);
      expect(await reservationModel(connection).countDocuments({})).toBe(0);
      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.status).toBe('available');
    });

    it('rejects an unknown field and an operator object', async () => {
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      await as(MANAGER)
        .post('/api/v1/sales/reservations')
        .send({
          customerId: customer.customerId,
          unitId: unit.unitId,
          reservationAmount: egp('100000'),
          agreedPrice: egp('3000000'),
          paymentPlan: defaultPlan,
          idempotencyKey: nextKey('idem-'),
          state: 'confirmed',
        })
        .expect(400);
      await as(MANAGER).get('/api/v1/sales/reservations?state[$ne]=cancelled').expect(400);
    });
  });

  describe('the reservation hold', () => {
    it('takes the hold and the reservation in one transaction', async () => {
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      const reservation = await reserve(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
      });
      expect(reservation.state).toBe('draft');
      expect(reservation.reservationNumber).toMatch(/^RSV-\d{4}-\d{5}$/);

      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.status).toBe('held');
      expect(stored?.heldByReservationId).toBe(reservation.reservationId);
    });

    it('refuses a second reservation on a unit that is already held', async () => {
      const { unit } = await makeUnit();
      const first = await makeCustomer();
      const second = await makeCustomer(REP_TWO);
      await reserve(MANAGER, { unitId: unit.unitId, customerId: first.customerId });
      await as(MANAGER)
        .post('/api/v1/sales/reservations')
        .send({
          customerId: second.customerId,
          unitId: unit.unitId,
          reservationAmount: egp('100000'),
          agreedPrice: egp('3000000'),
          paymentPlan: defaultPlan,
          idempotencyKey: nextKey('idem-'),
        })
        .expect(409);
      expect(await reservationModel(connection).countDocuments({ unitId: unit.unitId })).toBe(1);
    });

    it('lets exactly one of two simultaneous reservations win, and leaves one hold', async () => {
      const { unit } = await makeUnit();
      const a = await makeCustomer();
      const b = await makeCustomer(REP_TWO);
      const managerActor = await actorFor(MANAGER);

      const attempt = (customerId: string, key: string) =>
        sales.createReservation(
          managerActor,
          {
            customerId,
            unitId: unit.unitId,
            reservationAmount: egp('100000'),
            agreedPrice: egp('3000000'),
            paymentPlan: defaultPlan,
            holdDays: 14,
            idempotencyKey: key,
          },
          { correlationId: 'concurrency' },
        );

      const results = await Promise.allSettled([
        attempt(a.customerId, nextKey('idem-a-')),
        attempt(b.customerId, nextKey('idem-b-')),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

      // Exactly one live reservation, and the unit is held by it.
      const live = await reservationModel(connection)
        .find({ unitId: unit.unitId, state: { $in: ['draft', 'pendingApproval', 'confirmed'] } })
        .lean()
        .exec();
      expect(live).toHaveLength(1);
      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.status).toBe('held');
      expect(stored?.heldByReservationId).toBe(live[0]?.reservationId);
    });

    it('returns the original on an idempotent replay without taking a second hold', async () => {
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      const key = nextKey('idem-replay-');
      const first = await reserve(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
        idempotencyKey: key,
      });
      const replay = await reserve(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
        idempotencyKey: key,
        expectStatus: 200,
      });
      expect(replay.reservationId).toBe(first.reservationId);
      expect(await reservationModel(connection).countDocuments({})).toBe(1);
      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.version).toBe(2);
    });

    it('treats a replay carrying different input as a conflict', async () => {
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      const key = nextKey('idem-differs-');
      await reserve(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
        idempotencyKey: key,
      });
      await as(MANAGER)
        .post('/api/v1/sales/reservations')
        .send({
          customerId: customer.customerId,
          unitId: unit.unitId,
          reservationAmount: egp('250000'),
          agreedPrice: egp('3000000'),
          paymentPlan: defaultPlan,
          idempotencyKey: key,
        })
        .expect(409);
    });

    it('refuses a customer of one legal entity reserving another entity’s unit', async () => {
      const { unit } = await makeUnit('3000000', BRANCH_A);
      const customer = await makeCustomer(REP_ONE, BRANCH_B);
      // Both branches map to the same legal entity in this fixture, so force the mismatch directly.
      await connection
        .collection(CUSTOMERS_COLLECTION)
        .updateOne(
          { customerId: customer.customerId },
          { $set: { legalEntityId: 'le_anotherentity000000000000000001' } },
        );
      await as(MANAGER)
        .post('/api/v1/sales/reservations')
        .send({
          customerId: customer.customerId,
          unitId: unit.unitId,
          reservationAmount: egp('100000'),
          agreedPrice: egp('3000000'),
          paymentPlan: defaultPlan,
          idempotencyKey: nextKey('idem-'),
        })
        .expect(400);
      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.status).toBe('available');
    });

    it('refuses a plan that cannot reconcile, before touching the unit', async () => {
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      await as(MANAGER)
        .post('/api/v1/sales/reservations')
        .send({
          customerId: customer.customerId,
          unitId: unit.unitId,
          reservationAmount: egp('100000'),
          agreedPrice: egp('3000000'),
          // A down payment larger than the price.
          paymentPlan: { ...defaultPlan, downPayment: egp('4000000') },
          idempotencyKey: nextKey('idem-'),
        })
        .expect(400);
      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.status).toBe('available');
      expect(await reservationModel(connection).countDocuments({})).toBe(0);
    });

    it('releases the unit on cancellation and keeps the reservation with its reason', async () => {
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      const reservation = await reserve(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
      });
      await as(MANAGER)
        .post(`/api/v1/sales/reservations/${reservation.reservationId}/cancel`)
        .send({ reason: 'customer withdrew' })
        .expect(200);

      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.status).toBe('available');
      expect(stored?.heldByReservationId).toBeUndefined();
      const kept = await reservationModel(connection)
        .findOne({ reservationId: reservation.reservationId })
        .lean()
        .exec();
      expect(kept?.state).toBe('cancelled');
      expect(kept?.cancellationReason).toBe('customer withdrew');
    });

    it('lets a new reservation take a unit a cancelled one released', async () => {
      const { unit } = await makeUnit();
      const first = await makeCustomer();
      const reservation = await reserve(MANAGER, {
        unitId: unit.unitId,
        customerId: first.customerId,
      });
      await as(MANAGER)
        .post(`/api/v1/sales/reservations/${reservation.reservationId}/cancel`)
        .send({ reason: 'released' })
        .expect(200);
      const second = await makeCustomer(REP_TWO);
      await reserve(MANAGER, { unitId: unit.unitId, customerId: second.customerId });
      // The partial unique index let a second live reservation exist only because the first is terminal.
      expect(await reservationModel(connection).countDocuments({ unitId: unit.unitId })).toBe(2);
    });

    it('expires a hold past its deadline, idempotently', async () => {
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      const reservation = await reserve(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
      });
      await connection
        .collection(RESERVATIONS_COLLECTION)
        .updateOne(
          { reservationId: reservation.reservationId },
          { $set: { expiresOn: '2026-01-01' } },
        );

      const first = await as(MANAGER).post('/api/v1/sales/reservations/expire').expect(200);
      expect(first.body.expired).toBe(1);
      const second = await as(MANAGER).post('/api/v1/sales/reservations/expire').expect(200);
      expect(second.body.expired).toBe(0);

      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.status).toBe('available');
    });
  });

  describe('confirmation', () => {
    it('moves the unit from held to reserved', async () => {
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      const reservation = await reserve(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
      });
      const confirmed = await as(MANAGER)
        .post(`/api/v1/sales/reservations/${reservation.reservationId}/confirm`)
        .expect(200);
      expect(confirmed.body.state).toBe('confirmed');
      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.status).toBe('reserved');
    });

    it('refuses to confirm a cancelled reservation and audits the refusal', async () => {
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      const reservation = await reserve(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
      });
      await as(MANAGER)
        .post(`/api/v1/sales/reservations/${reservation.reservationId}/cancel`)
        .send({ reason: 'gone' })
        .expect(200);
      await as(MANAGER)
        .post(`/api/v1/sales/reservations/${reservation.reservationId}/confirm`)
        .expect(409);
      const stored = await reservationModel(connection)
        .findOne({ reservationId: reservation.reservationId })
        .lean()
        .exec();
      expect(stored?.state).toBe('cancelled');
    });
  });

  describe('the contract and its schedule', () => {
    async function confirmedReservation(price = '3000000', plan = defaultPlan) {
      const { unit } = await makeUnit(price);
      const customer = await makeCustomer();
      const reservation = await reserve(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
        agreedPrice: egp(price),
        paymentPlan: plan,
      });
      await as(MANAGER)
        .post(`/api/v1/sales/reservations/${reservation.reservationId}/confirm`)
        .expect(200);
      return { unit, customer, reservation };
    }

    it('stores a schedule that reconciles exactly to the contract total', async () => {
      // A total that does not divide evenly, so the allocation has to place odd piastres.
      const { reservation } = await confirmedReservation('1000000', {
        downPayment: egp('0'),
        installmentCount: 3,
        frequency: 'monthly',
        firstDueOn: BusinessDateSchema.parse('2026-10-01'),
      });
      const created = await as(MANAGER)
        .post('/api/v1/sales/contracts')
        .send({
          reservationId: reservation.reservationId,
          contractedOn: '2026-09-22',
          idempotencyKey: nextKey('idem-ctr-'),
        })
        .expect(201);

      const rows = created.body.installments as { amount: Money }[];
      const total = rows.reduce<Money>((running, row) => addMoney(running, row.amount), egp('0'));
      expect(compareMoney(total, egp('1000000'))).toBe(0);
      expect(rows.map((row) => row.amount.amount)).toEqual(['333333.34', '333333.33', '333333.33']);
      expect(created.body.contract.contractNumber).toMatch(/^CTR-\d{4}-\d{5}$/);
    });

    it('credits the reservation amount against the earliest rows', async () => {
      const { reservation } = await confirmedReservation('3000000');
      const created = await as(MANAGER)
        .post('/api/v1/sales/contracts')
        .send({
          reservationId: reservation.reservationId,
          contractedOn: '2026-09-22',
          idempotencyKey: nextKey('idem-ctr-'),
        })
        .expect(201);

      const rows = created.body.installments as {
        kind: string;
        paidAmount: Money;
        state: string;
      }[];
      // The 100,000 reservation lands on the 600,000 down payment, leaving it partially paid.
      expect(rows[0]?.kind).toBe('downPayment');
      expect(rows[0]?.paidAmount.amount).toBe('100000');
      expect(rows[0]?.state).toBe('partiallyPaid');
      expect(rows[1]?.paidAmount.amount).toBe('0');
      expect(created.body.contract.paidAmount.amount).toBe('100000');
      expect(created.body.contract.outstandingAmount.amount).toBe('2900000');
    });

    it('moves the unit to contracted and the reservation to converted, in one transaction', async () => {
      const { unit, reservation } = await confirmedReservation();
      await as(MANAGER)
        .post('/api/v1/sales/contracts')
        .send({
          reservationId: reservation.reservationId,
          contractedOn: '2026-09-22',
          idempotencyKey: nextKey('idem-ctr-'),
        })
        .expect(201);

      const storedUnit = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(storedUnit?.status).toBe('contracted');
      expect(storedUnit?.heldByReservationId).toBeUndefined();
      const storedReservation = await reservationModel(connection)
        .findOne({ reservationId: reservation.reservationId })
        .lean()
        .exec();
      expect(storedReservation?.state).toBe('converted');
    });

    it('refuses a contract from a reservation that is not confirmed', async () => {
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      const reservation = await reserve(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
      });
      await as(MANAGER)
        .post('/api/v1/sales/contracts')
        .send({
          reservationId: reservation.reservationId,
          contractedOn: '2026-09-22',
          idempotencyKey: nextKey('idem-ctr-'),
        })
        .expect(409);
      expect(await contractModel(connection).countDocuments({})).toBe(0);
    });

    it('is idempotent: a replay returns the original contract and one schedule', async () => {
      const { reservation } = await confirmedReservation();
      const key = nextKey('idem-ctr-');
      const first = await as(MANAGER)
        .post('/api/v1/sales/contracts')
        .send({
          reservationId: reservation.reservationId,
          contractedOn: '2026-09-22',
          idempotencyKey: key,
        })
        .expect(201);
      const replay = await as(MANAGER)
        .post('/api/v1/sales/contracts')
        .send({
          reservationId: reservation.reservationId,
          contractedOn: '2026-09-22',
          idempotencyKey: key,
        })
        .expect(200);

      expect(replay.body.contract.contractId).toBe(first.body.contract.contractId);
      expect(await contractModel(connection).countDocuments({})).toBe(1);
      expect(
        await installmentModel(connection).countDocuments({
          contractId: first.body.contract.contractId,
        }),
      ).toBe(13);
    });

    it('never issues the same contract number twice', async () => {
      const numbers = new Set<string>();
      for (let i = 0; i < 3; i += 1) {
        const { reservation } = await confirmedReservation();
        const created = await as(MANAGER)
          .post('/api/v1/sales/contracts')
          .send({
            reservationId: reservation.reservationId,
            contractedOn: '2026-09-22',
            idempotencyKey: nextKey('idem-ctr-'),
          })
          .expect(201);
        numbers.add(created.body.contract.contractNumber as string);
      }
      expect(numbers.size).toBe(3);
    });

    it('refuses to cancel a contract that has money against it', async () => {
      const { reservation } = await confirmedReservation();
      const created = await as(MANAGER)
        .post('/api/v1/sales/contracts')
        .send({
          reservationId: reservation.reservationId,
          contractedOn: '2026-09-22',
          idempotencyKey: nextKey('idem-ctr-'),
        })
        .expect(201);
      // The reservation amount is already credited, so paidAmount is above zero.
      const refused = await as(MANAGER)
        .post(`/api/v1/sales/contracts/${created.body.contract.contractId}/cancel`)
        .send({ reason: 'trying to cancel a paid contract' })
        .expect(409);
      expect(refused.body.error.code).toBe('CONFLICT');
      const stored = await contractModel(connection)
        .findOne({ contractId: created.body.contract.contractId })
        .lean()
        .exec();
      expect(stored?.state).toBe('active');
    });

    it('cancels an unpaid contract, cancels its installments, and returns the unit', async () => {
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      const reservation = await reserve(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
        // Nothing paid on the reservation, so the contract starts at zero collected.
        reservationAmount: egp('0'),
      });
      await as(MANAGER)
        .post(`/api/v1/sales/reservations/${reservation.reservationId}/confirm`)
        .expect(200);
      const created = await as(MANAGER)
        .post('/api/v1/sales/contracts')
        .send({
          reservationId: reservation.reservationId,
          contractedOn: '2026-09-22',
          idempotencyKey: nextKey('idem-ctr-'),
        })
        .expect(201);

      await as(MANAGER)
        .post(`/api/v1/sales/contracts/${created.body.contract.contractId}/cancel`)
        .send({ reason: 'customer defaulted before paying', releaseUnit: true })
        .expect(200);

      const storedUnit = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(storedUnit?.status).toBe('available');
      const installments = await installmentModel(connection)
        .find({ contractId: created.body.contract.contractId })
        .lean()
        .exec();
      // Cancelled, never deleted: the schedule that existed is part of the history (ADR-0009).
      expect(installments.length).toBeGreaterThan(0);
      expect(installments.every((row) => row.state === 'cancelled')).toBe(true);
    });

    it('audits the contract creation and the schedule generation', async () => {
      const { reservation } = await confirmedReservation();
      const created = await as(MANAGER)
        .post('/api/v1/sales/contracts')
        .send({
          reservationId: reservation.reservationId,
          contractedOn: '2026-09-22',
          idempotencyKey: nextKey('idem-ctr-'),
        })
        .expect(201);
      const events = await connection
        .collection(AUDIT_COLLECTION)
        .find({ 'target.id': created.body.contract.contractId })
        .toArray();
      const actions = events.map((event) => event['action'] as string);
      expect(actions).toContain(SALES_AUDIT_ACTIONS.contractCreated);
      expect(actions).toContain(SALES_AUDIT_ACTIONS.scheduleGenerated);
    });
  });

  describe('the schedule preview', () => {
    it('produces the same rows the contract will store', async () => {
      const preview = await as(MANAGER)
        .post('/api/v1/sales/schedule/preview')
        .send({
          total: egp('1000000'),
          paymentPlan: {
            downPayment: egp('0'),
            installmentCount: 3,
            frequency: 'monthly',
            firstDueOn: '2026-10-01',
          },
        })
        .expect(200);
      const previewRows = preview.body.rows as { amount: Money }[];
      expect(previewRows.map((row) => row.amount.amount)).toEqual([
        '333333.34',
        '333333.33',
        '333333.33',
      ]);
      expect(preview.body.rowsTotal).toEqual(preview.body.total);
    });

    it('refuses a plan that cannot reconcile, and stores nothing', async () => {
      await as(MANAGER)
        .post('/api/v1/sales/schedule/preview')
        .send({
          total: egp('100000'),
          paymentPlan: {
            downPayment: egp('10000'),
            installmentCount: 0,
            frequency: 'monthly',
            firstDueOn: BusinessDateSchema.parse('2026-10-01'),
          },
        })
        .expect(400);
    });
  });

  describe('installment queues and scope', () => {
    async function contractWithSchedule() {
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      const reservation = await reserve(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
        reservationAmount: egp('0'),
      });
      await as(MANAGER)
        .post(`/api/v1/sales/reservations/${reservation.reservationId}/confirm`)
        .expect(200);
      const created = await as(MANAGER)
        .post('/api/v1/sales/contracts')
        .send({
          reservationId: reservation.reservationId,
          contractedOn: '2026-09-22',
          idempotencyKey: nextKey('idem-ctr-'),
        })
        .expect(201);
      return created.body as { contract: { contractId: string; customerId: string } };
    }

    it('separates overdue, due and upcoming against the organization date', async () => {
      const { contract } = await contractWithSchedule();
      // Push two rows into the past so the buckets have something to separate.
      await connection
        .collection(INSTALLMENTS_COLLECTION)
        .updateOne(
          { contractId: contract.contractId, sequence: 1 },
          { $set: { dueOn: '2026-08-01' } },
        );
      await connection
        .collection(INSTALLMENTS_COLLECTION)
        .updateOne(
          { contractId: contract.contractId, sequence: 2 },
          { $set: { dueOn: '2026-09-22' } },
        );

      const overdue = await as(MANAGER)
        .get('/api/v1/sales/installments?bucket=overdue&limit=100')
        .expect(200);
      const due = await as(MANAGER)
        .get('/api/v1/sales/installments?bucket=due&limit=100')
        .expect(200);
      const upcoming = await as(MANAGER)
        .get('/api/v1/sales/installments?bucket=upcoming&withinDays=15&limit=100')
        .expect(200);

      expect(overdue.body.total).toBe(1);
      // "Due" includes today and everything earlier.
      expect(due.body.total).toBe(2);
      // The first regular installment falls on 1 October, within 15 days of 22 September.
      expect(upcoming.body.total).toBeGreaterThanOrEqual(1);
    });

    it('moves rows into due and overdue idempotently', async () => {
      const { contract } = await contractWithSchedule();
      await connection
        .collection(INSTALLMENTS_COLLECTION)
        .updateOne(
          { contractId: contract.contractId, sequence: 1 },
          { $set: { dueOn: '2026-08-01' } },
        );

      const first = await as(MANAGER).post('/api/v1/sales/installments/refresh').expect(200);
      expect(first.body.due + first.body.overdue).toBeGreaterThan(0);
      const second = await as(MANAGER).post('/api/v1/sales/installments/refresh').expect(200);
      expect(second.body.due).toBe(0);
      expect(second.body.overdue).toBe(0);
    });

    it("hides another representative's reservation behind a 404", async () => {
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      const reservation = await reserve(REP_ONE, {
        unitId: unit.unitId,
        customerId: customer.customerId,
      });
      const hidden = await as(REP_TWO)
        .get(`/api/v1/sales/reservations/${reservation.reservationId}`)
        .expect(404);
      const absent = await as(REP_TWO)
        .get('/api/v1/sales/reservations/rsv_doesnotexist00000000000000001')
        .expect(404);
      expect(Object.keys(hidden.body.error)).toEqual(Object.keys(absent.body.error));
    });

    it('agrees between the reservation list total and its rows, per scope', async () => {
      for (const owner of [REP_ONE, REP_ONE, REP_TWO]) {
        const { unit } = await makeUnit();
        const customer = await makeCustomer(owner);
        await reserve(owner, { unitId: unit.unitId, customerId: customer.customerId });
      }
      const all = await as(MANAGER).get('/api/v1/sales/reservations?limit=50').expect(200);
      const mine = await as(REP_ONE).get('/api/v1/sales/reservations?limit=50').expect(200);
      expect(all.body.total).toBe(3);
      expect(mine.body.total).toBe(2);
      expect(mine.body.items).toHaveLength(2);
    });
  });

  describe('no hard delete (ADR-0009)', () => {
    it('refuses to delete a reservation, a contract, or an installment', async () => {
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      await reserve(MANAGER, { unitId: unit.unitId, customerId: customer.customerId });
      await expect(reservationModel(connection).deleteMany({})).rejects.toThrow(/never deleted/);
      await expect(contractModel(connection).deleteMany({})).rejects.toThrow(/never deleted/);
      await expect(installmentModel(connection).deleteMany({})).rejects.toThrow(/never deleted/);
    });
  });
});
