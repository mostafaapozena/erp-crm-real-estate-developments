import {
  BusinessDateSchema,
  COLLECTION_AUDIT_ACTIONS,
  DecimalStringSchema,
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
import { CUSTOMERS_COLLECTION, CrmService, LEADS_COLLECTION } from '../crm';
import {
  BUILDINGS_COLLECTION,
  InventoryService,
  PROJECTS_COLLECTION,
  UNITS_COLLECTION,
  UNIT_EVENTS_COLLECTION,
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
  SalesService,
  installmentModel,
} from '../sales';
import { SimulatedDeliveryNotPermittedError, SimulatedReminderDelivery } from './delivery';
import {
  INSTRUMENTS_COLLECTION,
  RECEIPTS_COLLECTION,
  REMINDERS_COLLECTION,
  instrumentModel,
  receiptModel,
} from './model';
import { collectionRouter } from './router';
import { CollectionService } from './service';

/**
 * Collections against a real MongoDB replica set.
 *
 * The properties proven here are the ones that decide whether the money in the system is the money in
 * the bank: a posted receipt cannot be edited, over-allocation is refused rather than absorbed, a
 * reversal restores the schedule exactly, and reminder generation is idempotent.
 */
const gate = serviceGate(['mongodb']);
const RUN = `it-col-${Date.now()}`;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const ACCOUNT_HEADER = 'x-test-account';

const scope = (level: ScopeAssignment['level'], overrides: Partial<ScopeAssignment> = {}) =>
  ScopeAssignmentSchema.parse({ level, ...overrides });

const label = (en: string) => ({ ar: `عربي ${en}`, en });
const egp = (amount: string): Money => money(amount, 'EGP');
const TODAY = BusinessDateSchema.parse('2026-09-22');

const LEGAL_ENTITY = 'le_coltestlegalentity000000000001';
const BRANCH_A = 'br_coltestbranchaaaaaaaaaaaaaa0001';

describe.skipIf(!gate.available)(`collections module — ${gate.reason}`, () => {
  let connection: Connection;
  let audit: AuditService;
  let security: SecurityService;
  let inventory: InventoryService;
  let crm: CrmService;
  let sales: SalesService;
  let collections: CollectionService;
  let app: Express;

  const R_FULL = `${RUN}-r-full`;
  const R_OFFICER = `${RUN}-r-officer`;

  const MANAGER = `${RUN}-manager`;
  const OFFICER = `${RUN}-officer`;
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

  async function actorFor(accountId: string) {
    const actor = await security.resolveActor(accountId);
    if (!actor) throw new Error(`no actor for ${accountId}`);
    return actor;
  }

  /** A contract with a known, simple schedule: no down payment, four monthly installments of 250,000. */
  async function contractWithSchedule(total = '1000000', installmentCount = 4) {
    const actor = await actorFor(MANAGER);
    const context = { correlationId: 'fixture' };
    const project = await inventory.createProject(
      actor,
      {
        branchId: BRANCH_A,
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
      { projectId: project.projectId, code: nextKey('BLD'), name: label('B'), floors: 10 },
      context,
    );
    const unit = await inventory.createUnit(
      actor,
      {
        buildingId: building.buildingId,
        code: nextKey('U'),
        floor: 2,
        propertyType: 'apartment',
        usageType: 'residential',
        area: DecimalStringSchema.parse('120'),
        basePrice: egp(total),
        finishingStatus: 'semiFinished',
      },
      context,
    );
    const customer = await crm.createCustomer(
      actor,
      {
        name: 'عميل التحصيل',
        primaryPhone: `+2012${String(10000000 + counter++).padStart(8, '0')}`,
        branchId: BRANCH_A,
      },
      context,
    );
    const plan: PaymentPlan = {
      downPayment: egp('0'),
      installmentCount,
      frequency: 'monthly',
      firstDueOn: BusinessDateSchema.parse('2026-10-01'),
    };
    const { reservation } = await sales.createReservation(
      actor,
      {
        customerId: customer.customerId,
        unitId: unit.unitId,
        reservationAmount: egp('0'),
        agreedPrice: egp(total),
        paymentPlan: plan,
        idempotencyKey: nextKey('idem-rsv-'),
      },
      context,
    );
    await sales.confirmReservation(actor, reservation.reservationId, context);
    const created = await sales.createContract(
      actor,
      {
        reservationId: reservation.reservationId,
        contractedOn: TODAY,
        idempotencyKey: nextKey('idem-ctr-'),
      },
      context,
    );
    // Drafted, then activated: only an active contract has a collectible schedule.
    const contract = await sales.activateContract(
      actor,
      created.contract.contractId,
      { expectedVersion: created.contract.version },
      context,
    );
    const installments = await sales.listContractInstallments(actor, contract.contractId);
    return { contract, installments, customer, unit };
  }

  beforeAll(async () => {
    configureMongoose();
    const logger = createLogger({ name: 'it-col', level: 'silent' });
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'] as string,
    });
    await connection.asPromise();
    await ensureIndexes(connection, logger);

    const resolveBranch = (branchId: string) =>
      Promise.resolve(branchId === BRANCH_A ? { legalEntityId: LEGAL_ENTITY } : undefined);

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
      },
      // Reservation validity is a configured rule (BD-01); this suite needs one, not a particular one.
      policies: {
        validityDays: () => Promise.resolve(14),
        minimumDeposit: () => Promise.resolve(null),
        maximumDiscountPercent: () => Promise.resolve(null),
      },
      today: () => TODAY,
    });
    collections = new CollectionService({
      connection,
      logger,
      audit,
      sales: {
        findContract: async (contractId, session) => {
          const contract = await sales.findContract(contractId, session);
          return contract
            ? {
                contractId: contract.contractId,
                contractNumber: contract.contractNumber,
                customerId: contract.customerId,
                unitId: contract.unitId,
                projectId: contract.projectId,
                legalEntityId: contract.legalEntityId,
                branchId: contract.branchId,
                ...(contract.teamId ? { teamId: contract.teamId } : {}),
                salesOwnerAccountId: contract.salesOwnerAccountId,
                state: contract.state,
                totalPrice: contract.totalPrice,
              }
            : undefined;
        },
        listOpenInstallments: (contractId, session) =>
          sales.listOpenInstallments(contractId, session),
        applyPaymentToInstallment: (installmentId, amount, session) =>
          sales.applyPaymentToInstallment(installmentId, amount, session),
        reversePaymentOnInstallment: (installmentId, amount, session) =>
          sales.reversePaymentOnInstallment(installmentId, amount, session),
        recomputeContractTotals: (contractId, session) =>
          sales.recomputeContractTotals(contractId, session),
        listInstallmentsDueWithin: (from, to) => sales.listInstallmentsDueWithin(from, to),
      },
      customers: {
        find: async (customerId) => {
          const customer = await crm.findCustomerUnscoped(customerId);
          return customer ? { customerId: customer.customerId, name: customer.name } : undefined;
        },
      },
      units: {
        find: async (unitId) => {
          const unit = await inventory.findUnitForUpdate(unitId);
          return unit ? { unitId: unit.unitId, code: unit.code } : undefined;
        },
      },
      delivery: new SimulatedReminderDelivery('test'),
      today: () => TODAY,
      timeZone: 'Africa/Cairo',
      nextReceiptNumber: (session) => sales.allocateNumber('RCT', session),
    });

    const full: Permission[] = [
      'inventory.project.view',
      'inventory.project.manage',
      'inventory.unit.view',
      'inventory.unit.manage',
      'inventory.unit.viewPricing',
      'crm.customer.view',
      'crm.customer.manage',
      'sales.reservation.view',
      'sales.reservation.create',
      'sales.reservation.confirm',
      'sales.contract.view',
      'sales.contract.create',
      'collection.installment.view',
      'collection.receipt.view',
      'collection.receipt.create',
      'collection.receipt.cancel',
      'collection.instrument.view',
      'collection.instrument.manage',
      'collection.reminder.view',
      'collection.reminder.manage',
    ];
    await bootstrapRole(connection, { key: R_FULL, name: label('full'), permissions: full });
    // An officer may record money but **not** reverse it: that is the separation this role proves.
    await bootstrapRole(connection, {
      key: R_OFFICER,
      name: label('officer'),
      permissions: full.filter((permission) => permission !== 'collection.receipt.cancel'),
    });
    await bootstrapGrant(connection, {
      accountId: MANAGER,
      roleKeys: [R_FULL],
      scope: scope('all'),
      updatedBy: 'test',
    });
    await bootstrapGrant(connection, {
      accountId: OFFICER,
      roleKeys: [R_OFFICER],
      scope: scope('all'),
      updatedBy: 'test',
    });

    const actorResolver: ActorResolver = async (req) => {
      const accountId = req.get(ACCOUNT_HEADER);
      return accountId ? security.resolveActor(accountId) : undefined;
    };

    const modules: ApiModule[] = [
      { basePath: '/collections', router: collectionRouter({ getService: () => collections }) },
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
      REMINDERS_COLLECTION,
      INSTRUMENTS_COLLECTION,
      RECEIPTS_COLLECTION,
      INSTALLMENTS_COLLECTION,
      CONTRACTS_COLLECTION,
      RESERVATIONS_COLLECTION,
      COUNTERS_COLLECTION,
      UNIT_EVENTS_COLLECTION,
      UNITS_COLLECTION,
      BUILDINGS_COLLECTION,
      PROJECTS_COLLECTION,
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
      REMINDERS_COLLECTION,
      INSTRUMENTS_COLLECTION,
      RECEIPTS_COLLECTION,
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
      await api().get('/api/v1/collections/receipts').expect(401);
      await bootstrapGrant(connection, {
        accountId: NO_GRANT,
        roleKeys: [],
        scope: scope('all'),
        updatedBy: 'test',
      });
      await as(NO_GRANT).get('/api/v1/collections/receipts').expect(403);
    });

    it('lets an officer record money but not reverse it', async () => {
      const { contract } = await contractWithSchedule();
      const receipt = await as(OFFICER)
        .post('/api/v1/collections/receipts')
        .send({
          contractId: contract.contractId,
          amount: egp('250000'),
          method: 'cash',
          receivedOn: TODAY,
          idempotencyKey: nextKey('idem-rct-'),
        })
        .expect(201);

      await as(OFFICER)
        .post(`/api/v1/collections/receipts/${receipt.body.receiptId}/reverse`)
        .send({ reason: 'an officer should not be able to do this' })
        .expect(403);

      const stored = await receiptModel(connection)
        .findOne({ receiptId: receipt.body.receiptId })
        .lean()
        .exec();
      expect(stored?.state).toBe('posted');
    });
  });

  describe('recording a collection', () => {
    it('allocates oldest-first and moves the contract balance in the same transaction', async () => {
      const { contract } = await contractWithSchedule();
      const receipt = await as(MANAGER)
        .post('/api/v1/collections/receipts')
        .send({
          contractId: contract.contractId,
          amount: egp('400000'),
          method: 'bankTransfer',
          receivedOn: TODAY,
          depositReference: 'CIB main account',
          idempotencyKey: nextKey('idem-rct-'),
        })
        .expect(201);

      // 250,000 settles the first installment; 150,000 lands partially on the second.
      const allocations = receipt.body.allocations as { sequence: number; amount: Money }[];
      expect(allocations.map((a) => [a.sequence, a.amount.amount])).toEqual([
        [1, '250000'],
        [2, '150000'],
      ]);
      expect(receipt.body.receiptNumber).toMatch(/^RCT-\d{4}-\d{5}$/);

      const rows = await installmentModel(connection)
        .find({ contractId: contract.contractId })
        .sort({ sequence: 1 })
        .lean()
        .exec();
      expect(rows[0]?.state).toBe('paid');
      expect(rows[1]?.state).toBe('partiallyPaid');

      const updated = await sales.findContract(contract.contractId);
      expect(updated?.paidAmount.amount).toBe('400000');
      expect(updated?.outstandingAmount.amount).toBe('600000');
    });

    it('honours explicit allocations that sum to the receipt', async () => {
      const { contract, installments } = await contractWithSchedule();
      const receipt = await as(MANAGER)
        .post('/api/v1/collections/receipts')
        .send({
          contractId: contract.contractId,
          amount: egp('300000'),
          method: 'cash',
          receivedOn: TODAY,
          allocations: [
            { installmentId: installments[2]?.installmentId, amount: egp('250000') },
            { installmentId: installments[3]?.installmentId, amount: egp('50000') },
          ],
          idempotencyKey: nextKey('idem-rct-'),
        })
        .expect(201);
      const allocations = receipt.body.allocations as { sequence: number }[];
      expect(allocations.map((a) => a.sequence)).toEqual([3, 4]);
    });

    it('refuses allocations that do not sum to the receipt, and stores nothing', async () => {
      const { contract, installments } = await contractWithSchedule();
      await as(MANAGER)
        .post('/api/v1/collections/receipts')
        .send({
          contractId: contract.contractId,
          amount: egp('300000'),
          method: 'cash',
          receivedOn: TODAY,
          allocations: [{ installmentId: installments[0]?.installmentId, amount: egp('250000') }],
          idempotencyKey: nextKey('idem-rct-'),
        })
        .expect(400);
      expect(await receiptModel(connection).countDocuments({})).toBe(0);
    });

    it('refuses over-allocation against one installment', async () => {
      const { contract, installments } = await contractWithSchedule();
      await as(MANAGER)
        .post('/api/v1/collections/receipts')
        .send({
          contractId: contract.contractId,
          amount: egp('300000'),
          method: 'cash',
          receivedOn: TODAY,
          allocations: [{ installmentId: installments[0]?.installmentId, amount: egp('300000') }],
          idempotencyKey: nextKey('idem-rct-'),
        })
        .expect(400);
      expect(await receiptModel(connection).countDocuments({})).toBe(0);
    });

    it('refuses more money than the contract still owes, rather than absorbing it', async () => {
      const { contract } = await contractWithSchedule();
      await as(MANAGER)
        .post('/api/v1/collections/receipts')
        .send({
          contractId: contract.contractId,
          amount: egp('1000001'),
          method: 'cash',
          receivedOn: TODAY,
          idempotencyKey: nextKey('idem-rct-'),
        })
        .expect(400);
      const unchanged = await sales.findContract(contract.contractId);
      expect(unchanged?.paidAmount.amount).toBe('0');
    });

    it('completes the contract when the last piastre arrives', async () => {
      const { contract } = await contractWithSchedule();
      await as(MANAGER)
        .post('/api/v1/collections/receipts')
        .send({
          contractId: contract.contractId,
          amount: egp('1000000'),
          method: 'bankTransfer',
          receivedOn: TODAY,
          idempotencyKey: nextKey('idem-rct-'),
        })
        .expect(201);
      const settled = await sales.findContract(contract.contractId);
      expect(settled?.outstandingAmount.amount).toBe('0');
      expect(settled?.state).toBe('completed');
    });

    it('is idempotent: a replay returns the original and collects the money once', async () => {
      const { contract } = await contractWithSchedule();
      const key = nextKey('idem-rct-');
      const body = {
        contractId: contract.contractId,
        amount: egp('250000'),
        method: 'cash',
        receivedOn: TODAY,
        idempotencyKey: key,
      };
      const first = await as(MANAGER).post('/api/v1/collections/receipts').send(body).expect(201);
      const replay = await as(MANAGER).post('/api/v1/collections/receipts').send(body).expect(200);

      expect(replay.body.receiptId).toBe(first.body.receiptId);
      expect(await receiptModel(connection).countDocuments({})).toBe(1);
      const once = await sales.findContract(contract.contractId);
      expect(once?.paidAmount.amount).toBe('250000');
    });

    it('treats a replay carrying a different amount as a conflict', async () => {
      const { contract } = await contractWithSchedule();
      const key = nextKey('idem-rct-');
      await as(MANAGER)
        .post('/api/v1/collections/receipts')
        .send({
          contractId: contract.contractId,
          amount: egp('250000'),
          method: 'cash',
          receivedOn: TODAY,
          idempotencyKey: key,
        })
        .expect(201);
      await as(MANAGER)
        .post('/api/v1/collections/receipts')
        .send({
          contractId: contract.contractId,
          amount: egp('500000'),
          method: 'cash',
          receivedOn: TODAY,
          idempotencyKey: key,
        })
        .expect(409);
    });

    it('sums its allocations to exactly the receipt amount', async () => {
      // A total that does not divide evenly, so allocation has to place odd piastres.
      const { contract } = await contractWithSchedule('1000000', 3);
      const receipt = await as(MANAGER)
        .post('/api/v1/collections/receipts')
        .send({
          contractId: contract.contractId,
          amount: egp('666666.67'),
          method: 'cash',
          receivedOn: TODAY,
          idempotencyKey: nextKey('idem-rct-'),
        })
        .expect(201);
      const allocations = receipt.body.allocations as { amount: Money }[];
      const sum = allocations.reduce<Money>((a, row) => addMoney(a, row.amount), egp('0'));
      expect(compareMoney(sum, egp('666666.67'))).toBe(0);
    });
  });

  describe('a posted receipt is never edited', () => {
    it('refuses every update path except reversal, at the storage layer', async () => {
      const { contract } = await contractWithSchedule();
      const receipt = await as(MANAGER)
        .post('/api/v1/collections/receipts')
        .send({
          contractId: contract.contractId,
          amount: egp('250000'),
          method: 'cash',
          receivedOn: TODAY,
          idempotencyKey: nextKey('idem-rct-'),
        })
        .expect(201);

      const model = receiptModel(connection);
      const id = receipt.body.receiptId as string;
      await expect(
        model.updateOne({ receiptId: id }, { $set: { amount: { amount: '1', currency: 'EGP' } } }),
      ).rejects.toThrow(/never edited or deleted/);
      await expect(
        model.updateOne({ receiptId: id }, { $set: { receiptNumber: 'RCT-FAKE' } }),
      ).rejects.toThrow(/never edited or deleted/);
      await expect(model.deleteOne({ receiptId: id })).rejects.toThrow(/never edited or deleted/);

      const stored = await model.findOne({ receiptId: id }).lean().exec();
      expect(stored?.amount.amount.toString()).toBe('250000');
    });

    it('restores the schedule exactly when a receipt is reversed', async () => {
      const { contract } = await contractWithSchedule();
      const receipt = await as(MANAGER)
        .post('/api/v1/collections/receipts')
        .send({
          contractId: contract.contractId,
          amount: egp('400000'),
          method: 'cash',
          receivedOn: TODAY,
          idempotencyKey: nextKey('idem-rct-'),
        })
        .expect(201);

      await as(MANAGER)
        .post(`/api/v1/collections/receipts/${receipt.body.receiptId}/reverse`)
        .send({ reason: 'cheque bounced' })
        .expect(200);

      const rows = await installmentModel(connection)
        .find({ contractId: contract.contractId })
        .sort({ sequence: 1 })
        .lean()
        .exec();
      for (const row of rows) {
        expect(row.paidAmount.amount.toString()).toBe('0');
        expect(row.remainingAmount.amount.toString()).toBe('250000');
        expect(row.state).toBe('upcoming');
      }
      const restored = await sales.findContract(contract.contractId);
      expect(restored?.paidAmount.amount).toBe('0');
      expect(restored?.outstandingAmount.amount).toBe('1000000');

      // The receipt itself is kept, with its reason.
      const kept = await receiptModel(connection)
        .findOne({ receiptId: receipt.body.receiptId })
        .lean()
        .exec();
      expect(kept?.state).toBe('reversed');
      expect(kept?.reversalReason).toBe('cheque bounced');
    });

    it('refuses to reverse a receipt twice', async () => {
      const { contract } = await contractWithSchedule();
      const receipt = await as(MANAGER)
        .post('/api/v1/collections/receipts')
        .send({
          contractId: contract.contractId,
          amount: egp('250000'),
          method: 'cash',
          receivedOn: TODAY,
          idempotencyKey: nextKey('idem-rct-'),
        })
        .expect(201);
      await as(MANAGER)
        .post(`/api/v1/collections/receipts/${receipt.body.receiptId}/reverse`)
        .send({ reason: 'first' })
        .expect(200);
      await as(MANAGER)
        .post(`/api/v1/collections/receipts/${receipt.body.receiptId}/reverse`)
        .send({ reason: 'second' })
        .expect(409);

      const refusals = await connection
        .collection(AUDIT_COLLECTION)
        .find({
          action: COLLECTION_AUDIT_ACTIONS.receiptRefused,
          'target.id': receipt.body.receiptId,
        })
        .toArray();
      expect(refusals).toHaveLength(1);
    });
  });

  describe('cheques and promissory notes', () => {
    async function makeCheque(overrides: Record<string, unknown> = {}) {
      const { contract } = await contractWithSchedule();
      const response = await as(MANAGER)
        .post('/api/v1/collections/instruments')
        .send({
          kind: 'cheque',
          instrumentNumber: nextKey('CHQ'),
          contractId: contract.contractId,
          amount: egp('250000'),
          issuedOn: '2026-09-01',
          dueOn: '2026-10-01',
          bankName: 'البنك الأهلي',
          drawerName: 'محمود عبد الله',
          custodyLocation: 'خزينة الفرع الرئيسي',
          ...overrides,
        })
        .expect((overrides['expectStatus'] as number) ?? 201);
      return { contract, instrument: response.body as { instrumentId: string; state: string } };
    }

    it('takes custody of a cheque in the received state', async () => {
      const { instrument } = await makeCheque();
      expect(instrument.state).toBe('received');
    });

    it('requires a bank name for a cheque', async () => {
      const { contract } = await contractWithSchedule();
      await as(MANAGER)
        .post('/api/v1/collections/instruments')
        .send({
          kind: 'cheque',
          instrumentNumber: nextKey('CHQ'),
          contractId: contract.contractId,
          amount: egp('250000'),
          issuedOn: '2026-09-01',
          dueOn: '2026-10-01',
          drawerName: 'محمود عبد الله',
        })
        .expect(400);
    });

    it('accepts a promissory note without a bank', async () => {
      const { contract } = await contractWithSchedule();
      await as(MANAGER)
        .post('/api/v1/collections/instruments')
        .send({
          kind: 'promissoryNote',
          instrumentNumber: nextKey('PN'),
          contractId: contract.contractId,
          amount: egp('250000'),
          issuedOn: '2026-09-01',
          dueOn: '2026-11-01',
          drawerName: 'محمود عبد الله',
        })
        .expect(201);
    });

    it('walks received → deposited → cleared', async () => {
      const { instrument } = await makeCheque();
      await as(MANAGER)
        .post(`/api/v1/collections/instruments/${instrument.instrumentId}/state`)
        .send({ state: 'deposited', custodyLocation: 'مودع بالبنك' })
        .expect(200);
      const cleared = await as(MANAGER)
        .post(`/api/v1/collections/instruments/${instrument.instrumentId}/state`)
        .send({ state: 'cleared' })
        .expect(200);
      expect(cleared.body.state).toBe('cleared');
    });

    it('refuses a move the machine forbids, audits it, and changes nothing', async () => {
      const { instrument } = await makeCheque();
      await as(MANAGER)
        .post(`/api/v1/collections/instruments/${instrument.instrumentId}/state`)
        .send({ state: 'cleared' })
        .expect(409);
      const stored = await instrumentModel(connection)
        .findOne({ instrumentId: instrument.instrumentId })
        .lean()
        .exec();
      expect(stored?.state).toBe('received');
      const refusals = await connection
        .collection(AUDIT_COLLECTION)
        .find({
          action: COLLECTION_AUDIT_ACTIONS.instrumentRefused,
          'target.id': instrument.instrumentId,
        })
        .toArray();
      expect(refusals).toHaveLength(1);
    });

    it('requires a reason to return an instrument', async () => {
      const { instrument } = await makeCheque();
      await as(MANAGER)
        .post(`/api/v1/collections/instruments/${instrument.instrumentId}/state`)
        .send({ state: 'returned' })
        .expect(400);
      await as(MANAGER)
        .post(`/api/v1/collections/instruments/${instrument.instrumentId}/state`)
        .send({ state: 'returned', reason: 'insufficient funds' })
        .expect(200);
    });

    it('refuses to delete an instrument', async () => {
      const { instrument } = await makeCheque();
      await expect(
        instrumentModel(connection).deleteOne({ instrumentId: instrument.instrumentId }),
      ).rejects.toThrow(/never deleted/);
    });
  });

  describe('the reminder centre', () => {
    it('creates one reminder per installment inside the window, in both languages', async () => {
      const { contract, customer, unit } = await contractWithSchedule();
      const result = await as(MANAGER)
        .post('/api/v1/collections/reminders/generate')
        .send({ withinDays: 15, channel: 'whatsapp' })
        .expect(200);

      // Only the 1 October installment is inside 15 days of 22 September.
      expect(result.body.created).toBe(1);
      expect(result.body.deliveryConnected).toBe(false);

      const page = await as(MANAGER).get('/api/v1/collections/reminders').expect(200);
      expect(page.body.deliveryConnected).toBe(false);
      const reminder = page.body.items[0] as {
        messageAr: string;
        messageEn: string;
        state: string;
        simulated: boolean;
        contractId: string;
      };
      expect(reminder.state).toBe('ready');
      expect(reminder.simulated).toBe(false);
      expect(reminder.contractId).toBe(contract.contractId);
      // Both languages, always, and each carries the details a customer needs.
      expect(reminder.messageAr).toContain(customer.name);
      expect(reminder.messageAr).toContain(unit.code);
      expect(reminder.messageEn).toContain(unit.code);
      // Western digits in both, per SD-23.
      expect(reminder.messageAr).toMatch(/01\/10\/2026/);
      expect(reminder.messageEn).toMatch(/01\/10\/2026/);
    });

    it('is idempotent: a second sweep creates nothing', async () => {
      await contractWithSchedule();
      const first = await as(MANAGER)
        .post('/api/v1/collections/reminders/generate')
        .send({ withinDays: 15 })
        .expect(200);
      const second = await as(MANAGER)
        .post('/api/v1/collections/reminders/generate')
        .send({ withinDays: 15 })
        .expect(200);
      expect(first.body.created).toBe(1);
      expect(second.body.created).toBe(0);
      expect(second.body.existing).toBe(1);
    });

    it('marks a delivered reminder as simulated, never as sent', async () => {
      await contractWithSchedule();
      await as(MANAGER)
        .post('/api/v1/collections/reminders/generate')
        .send({ withinDays: 15 })
        .expect(200);
      const page = await as(MANAGER).get('/api/v1/collections/reminders').expect(200);
      const reminderId = (page.body.items[0] as { reminderId: string }).reminderId;

      const acted = await as(MANAGER)
        .post(`/api/v1/collections/reminders/${reminderId}/act`)
        .send({ state: 'simulated' })
        .expect(200);
      expect(acted.body.state).toBe('simulated');
      expect(acted.body.simulated).toBe(true);
      // The vocabulary has `sent`; nothing here ever reaches it (ADR-0026).
      expect(acted.body.state).not.toBe('sent');
    });

    it('keeps a simulated reminder simulated when the caller explains why', async () => {
      // A note is a note. This once turned a successful simulation into `failed`, because any
      // supplied reason was treated as a failure reason — a red row for something that worked.
      await contractWithSchedule();
      await as(MANAGER)
        .post('/api/v1/collections/reminders/generate')
        .send({ withinDays: 15 })
        .expect(200);
      const page = await as(MANAGER).get('/api/v1/collections/reminders').expect(200);
      const reminderId = (page.body.items[0] as { reminderId: string }).reminderId;

      const acted = await as(MANAGER)
        .post(`/api/v1/collections/reminders/${reminderId}/act`)
        .send({ state: 'simulated', reason: 'rehearsing the collection run' })
        .expect(200);
      expect(acted.body.state).toBe('simulated');
      expect(acted.body.failureReason).toBeUndefined();
    });

    it('records the reason on a reminder the caller marks failed', async () => {
      await contractWithSchedule();
      await as(MANAGER)
        .post('/api/v1/collections/reminders/generate')
        .send({ withinDays: 15 })
        .expect(200);
      const page = await as(MANAGER).get('/api/v1/collections/reminders').expect(200);
      const reminderId = (page.body.items[0] as { reminderId: string }).reminderId;

      const acted = await as(MANAGER)
        .post(`/api/v1/collections/reminders/${reminderId}/act`)
        .send({ state: 'failed', reason: 'the number is no longer in service' })
        .expect(200);
      expect(acted.body.state).toBe('failed');
      expect(acted.body.failureReason).toBe('the number is no longer in service');
    });

    it('widens the window when asked', async () => {
      await contractWithSchedule();
      const wide = await as(MANAGER)
        .post('/api/v1/collections/reminders/generate')
        .send({ withinDays: 90 })
        .expect(200);
      // October, November and December installments all fall inside 90 days.
      expect(wide.body.created).toBe(3);
    });
  });

  describe('the simulated adapter is development-only (ADR-0026)', () => {
    it('refuses to be constructed in production or staging', () => {
      expect(() => new SimulatedReminderDelivery('production')).toThrow(
        SimulatedDeliveryNotPermittedError,
      );
      expect(() => new SimulatedReminderDelivery('staging')).toThrow(
        SimulatedDeliveryNotPermittedError,
      );
      expect(() => new SimulatedReminderDelivery('development')).not.toThrow();
    });

    it('never reports itself as connected', () => {
      expect(new SimulatedReminderDelivery('test').connected).toBe(false);
    });

    it('still generates and lists reminders with no adapter at all', async () => {
      const withoutDelivery = new CollectionService({
        connection,
        logger: createLogger({ name: 'it-col-nodelivery', level: 'silent' }),
        audit,
        sales: {
          findContract: async (contractId, session) => {
            const contract = await sales.findContract(contractId, session);
            return contract
              ? {
                  contractId: contract.contractId,
                  contractNumber: contract.contractNumber,
                  customerId: contract.customerId,
                  unitId: contract.unitId,
                  projectId: contract.projectId,
                  legalEntityId: contract.legalEntityId,
                  branchId: contract.branchId,
                  salesOwnerAccountId: contract.salesOwnerAccountId,
                  state: contract.state,
                  totalPrice: contract.totalPrice,
                }
              : undefined;
          },
          listOpenInstallments: (contractId, session) =>
            sales.listOpenInstallments(contractId, session),
          applyPaymentToInstallment: (installmentId, amount, session) =>
            sales.applyPaymentToInstallment(installmentId, amount, session),
          reversePaymentOnInstallment: (installmentId, amount, session) =>
            sales.reversePaymentOnInstallment(installmentId, amount, session),
          recomputeContractTotals: (contractId, session) =>
            sales.recomputeContractTotals(contractId, session),
          listInstallmentsDueWithin: (from, to) => sales.listInstallmentsDueWithin(from, to),
        },
        customers: {
          find: async (customerId) => {
            const customer = await crm.findCustomerUnscoped(customerId);
            return customer ? { customerId: customer.customerId, name: customer.name } : undefined;
          },
        },
        units: {
          find: async (unitId) => {
            const unit = await inventory.findUnitForUpdate(unitId);
            return unit ? { unitId: unit.unitId, code: unit.code } : undefined;
          },
        },
        today: () => TODAY,
        timeZone: 'Africa/Cairo',
        nextReceiptNumber: (session) => sales.allocateNumber('RCT', session),
      });

      await contractWithSchedule();
      const actor = await actorFor(MANAGER);
      const result = await withoutDelivery.generateReminders(
        actor,
        { withinDays: 15, channel: 'whatsapp' },
        { correlationId: 'no-adapter' },
      );
      expect(result.created).toBe(1);
      expect(result.deliveryConnected).toBe(false);
      expect(withoutDelivery.deliveryConnected()).toBe(false);

      // And asking for a simulated delivery is refused rather than faked.
      const page = await withoutDelivery.listReminders(actor, { limit: 10 });
      const reminderId = page.items[0]?.reminderId as string;
      await expect(
        withoutDelivery.actOnReminder(
          actor,
          reminderId,
          { state: 'simulated' },
          { correlationId: 'no-adapter' },
        ),
      ).rejects.toThrow();
    });
  });
});
