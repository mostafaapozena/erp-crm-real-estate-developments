import {
  BusinessDateSchema,
  ContractHistorySchema,
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
import { MAINTENANCE_ACTOR } from '../../platform/maintenance';
import { configureMongoose } from '../../platform/mongo';
import { AUDIT_COLLECTION, AuditService } from '../audit';
import {
  ACTIVITIES_COLLECTION,
  CUSTOMERS_COLLECTION,
  CrmService,
  LEADS_COLLECTION,
  OPPORTUNITIES_COLLECTION,
  OpportunityService,
} from '../crm';
import {
  BUILDINGS_COLLECTION,
  HOLDS_COLLECTION,
  HoldService,
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
  QUOTATIONS_COLLECTION,
  RESERVATIONS_COLLECTION,
  contractModel,
  installmentModel,
  reservationModel,
} from './model';
import { QuotationService } from './quotations';
import { salesRouter } from './router';
import type { DepositRule } from './reservation-rules';
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
  let holds: HoldService;
  let opportunities: OpportunityService;
  let quotations: QuotationService;
  let app: Express;
  /** Which record owns each signed-copy document the fake document port knows. */
  const signedCopyOwners = new Map<string, { type: string; id: string }>();

  /** The configured commercial rules (BD-01 … BD-03); `null` is not configured. */
  let validityDays: number | null = 14;
  let minimumDeposit: DepositRule | null = null;
  let maximumDiscountPercent: string | null = null;
  /** Operations a published policy governs, and each request's outcome as the engine reports it. */
  const governed = new Set<string>();
  const approvalStates = new Map<string, string>();
  const submitted: { operationType: string; sourceId: string }[] = [];
  /** The official number the numbering engine would issue; `undefined` is no active format. */
  let officialNumber: string | undefined;

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
      put: (path: string) => withAccount(api().put(path).set('Origin', ALLOWED_ORIGIN)),
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
    // Created by its owner: naming another owner needs `crm.customer.transfer` (CRM-OWNER-001).
    const actor = await actorFor(ownerAccountId);
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

  interface ContractBody {
    contractId: string;
    contractNumber: string;
    customerId: string;
    state: string;
    version: number;
    paidAmount: Money;
    outstandingAmount: Money;
    totalPrice: Money;
  }

  interface InstallmentBody {
    installmentId: string;
    sequence: number;
    kind: string;
    dueOn: string;
    amount: Money;
    paidAmount: Money;
    remainingAmount: Money;
    state: string;
  }

  /** Draft a contract from a confirmed reservation; the body of the create call. */
  async function draftFor(
    accountId: string,
    reservationId: string,
    extra: Record<string, unknown> = {},
  ): Promise<ContractBody> {
    const response = await as(accountId)
      .post('/api/v1/sales/contracts')
      .send({
        reservationId,
        contractedOn: '2026-09-22',
        idempotencyKey: nextKey('idem-ctr-'),
        ...extra,
      });
    // The body names the issue when a draft is refused, which a bare status would not.
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return (response.body as { contract: ContractBody }).contract;
  }

  /**
   * Draft and activate — the two steps every active contract takes (SALE-CONTRACT-003). Returns the
   * active contract and its frozen schedule.
   */
  async function contractFor(
    accountId: string,
    reservationId: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ contract: ContractBody; installments: InstallmentBody[] }> {
    const draft = await draftFor(accountId, reservationId, extra);
    const activated = await as(accountId)
      .post(`/api/v1/sales/contracts/${draft.contractId}/activate`)
      .send({ expectedVersion: draft.version })
      .expect(200);
    const rows = await as(accountId)
      .get(`/api/v1/sales/contracts/${draft.contractId}/installments`)
      .expect(200);
    return {
      contract: activated.body as ContractBody,
      installments: (rows.body as { items: InstallmentBody[] }).items,
    };
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
                ...(unit.heldByHoldId ? { heldByHoldId: unit.heldByHoldId } : {}),
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
      approvals: {
        submit: (_actor, input) => {
          if (!governed.has(input.operationType)) return Promise.resolve(undefined);
          const requestId = `apr_${input.idempotencyKey.replace(/[^A-Za-z0-9]/g, '')}`;
          approvalStates.set(requestId, 'pending');
          submitted.push({ operationType: input.operationType, sourceId: input.source.id });
          return Promise.resolve({ requestId, state: 'pending' });
        },
        state: (requestId) => Promise.resolve(approvalStates.get(requestId)),
        applies: (_actor, input) => Promise.resolve(governed.has(input.operationType)),
      },
      holds: {
        find: async (holdId, session) => {
          const hold = await holds.findUnscoped(holdId, session);
          return hold
            ? {
                holdId: hold.holdId,
                unitId: hold.unitId,
                state: hold.state,
                holderAccountId: hold.holderAccountId,
              }
            : undefined;
        },
        convert: (actor, holdId, reservationId, expected, context, session) =>
          holds.convert(actor, holdId, reservationId, expected, context, session),
      },
      opportunities: {
        find: async (actor, opportunityId) => {
          const opportunity = await opportunities.get(actor, opportunityId);
          return {
            opportunityId: opportunity.opportunityId,
            customerId: opportunity.customerId,
            stage: opportunity.stage,
          };
        },
        advance: async (actor, opportunityId, to, links, reason, context, session) => {
          await opportunities.advanceInternal(
            actor,
            opportunityId,
            to,
            links,
            reason,
            context,
            session,
          );
        },
      },
      policies: {
        validityDays: () => Promise.resolve(validityDays),
        minimumDeposit: () => Promise.resolve(minimumDeposit),
        maximumDiscountPercent: () => Promise.resolve(maximumDiscountPercent),
      },
      numbers: { issue: () => Promise.resolve(officialNumber) },
      unitSnapshots: {
        snapshot: async (unitId, session) => {
          const unit = await inventory.findUnitForUpdate(unitId, session);
          return unit
            ? {
                unitId: unit.unitId,
                code: unit.code,
                projectId: unit.projectId,
                buildingId: unit.buildingId,
                floor: unit.floor,
                propertyType: unit.propertyType,
                area: unit.area,
              }
            : undefined;
        },
      },
      customers: {
        snapshot: async (actor, customerId) => {
          const customer = await crm.customerForSnapshot(actor, customerId).catch(() => undefined);
          return customer
            ? {
                customerId: customer.customerId,
                kind: customer.kind,
                name: customer.name,
                primaryPhone: customer.primaryPhone,
                ...(customer.identity
                  ? { identity: { type: customer.identity.type, number: customer.identity.number } }
                  : {}),
              }
            : undefined;
        },
        inScope: async (actor, customerId) => {
          try {
            return { name: (await crm.getCustomer(actor, customerId)).name };
          } catch {
            return undefined;
          }
        },
      },
      signedCopies: {
        ownerOf: (_actor, documentId) =>
          Promise.resolve(signedCopyOwners.get(documentId)),
      },
      history: {
        targetHistory: async (target, limit) =>
          ContractHistorySchema.shape.items.parse(await audit.targetHistory(target, limit)),
      },
      today: () => TODAY,
    });
    quotations = new QuotationService({
      connection,
      audit,
      units: {
        priced: async (actor, unitId) => {
          const unit = await inventory.getUnit(actor, unitId);
          return {
            unitId: unit.unitId,
            code: unit.code,
            projectId: unit.projectId,
            legalEntityId: unit.legalEntityId,
            branchId: unit.branchId,
            ...(unit.currentPrice ? { currentPrice: unit.currentPrice } : {}),
          };
        },
      },
      recipients: {
        customerInScope: async (actor, customerId) => {
          try {
            await crm.getCustomer(actor, customerId);
            return true;
          } catch {
            return false;
          }
        },
        leadInScope: async (actor, leadId) => {
          try {
            await crm.getLead(actor, leadId);
            return true;
          } catch {
            return false;
          }
        },
        opportunity: async (actor, opportunityId) => {
          try {
            return { customerId: (await opportunities.get(actor, opportunityId)).customerId };
          } catch {
            return undefined;
          }
        },
      },
      legacyNumber: (prefix, session) => sales.allocateNumber(prefix, session),
      today: () => TODAY,
    });
    holds = new HoldService({
      connection,
      audit,
      logger,
      inventory,
      holdHours: () => Promise.resolve(48),
    });
    opportunities = new OpportunityService({
      connection,
      audit,
      crm,
      probabilities: () => Promise.resolve(null),
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
      'sales.reservation.extend',
      'inventory.hold.create',
      'crm.opportunity.view',
      'crm.opportunity.manage',
      'sales.contract.view',
      'sales.contract.create',
      'sales.contract.activate',
      'sales.contract.sign',
      'sales.contract.amend',
      'sales.contract.cancel',
      'sales.quotation.view',
      'sales.quotation.manage',
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
        // Representatives see their own reservations and contracts, and their branch's inventory
        // through the catalogue scope (SEC-034).
        scope: scope('assigned', { branchIds: [BRANCH_A] }),
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
      {
        basePath: '/sales',
        router: salesRouter({ getService: () => sales, getQuotations: () => quotations }),
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
      INSTALLMENTS_COLLECTION,
      CONTRACTS_COLLECTION,
      QUOTATIONS_COLLECTION,
      RESERVATIONS_COLLECTION,
      COUNTERS_COLLECTION,
      HOLDS_COLLECTION,
      OPPORTUNITIES_COLLECTION,
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
    signedCopyOwners.clear();
    for (const name of [
      INSTALLMENTS_COLLECTION,
      CONTRACTS_COLLECTION,
      QUOTATIONS_COLLECTION,
      RESERVATIONS_COLLECTION,
      HOLDS_COLLECTION,
      OPPORTUNITIES_COLLECTION,
      UNIT_EVENTS_COLLECTION,
      UNITS_COLLECTION,
      BUILDINGS_COLLECTION,
      PROJECTS_COLLECTION,
      CUSTOMERS_COLLECTION,
    ]) {
      await connection.collection(name).deleteMany({});
    }
    validityDays = 14;
    minimumDeposit = null;
    maximumDiscountPercent = null;
    governed.clear();
    approvalStates.clear();
    submitted.length = 0;
    officialNumber = undefined;
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
      const created = await contractFor(MANAGER, reservation.reservationId);

      const rows = created.installments;
      const total = rows.reduce<Money>((running, row) => addMoney(running, row.amount), egp('0'));
      expect(compareMoney(total, egp('1000000'))).toBe(0);
      expect(rows.map((row) => row.amount.amount)).toEqual(['333333.34', '333333.33', '333333.33']);
      expect(created.contract.contractNumber).toMatch(/^CTR-\d{4}-\d{5}$/);
    });

    it('credits the reservation amount against the earliest rows', async () => {
      const { reservation } = await confirmedReservation('3000000');
      const created = await contractFor(MANAGER, reservation.reservationId);

      const rows = created.installments;
      // The 100,000 reservation lands on the 600,000 down payment, leaving it partially paid.
      expect(rows[0]?.kind).toBe('downPayment');
      expect(rows[0]?.paidAmount.amount).toBe('100000');
      expect(rows[0]?.state).toBe('partiallyPaid');
      expect(rows[1]?.paidAmount.amount).toBe('0');
      expect(created.contract.paidAmount.amount).toBe('100000');
      expect(created.contract.outstandingAmount.amount).toBe('2900000');
    });

    it('moves the unit to contracted and the reservation to converted, in one transaction', async () => {
      const { unit, reservation } = await confirmedReservation();
      await contractFor(MANAGER, reservation.reservationId);

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
      expect(replay.body.contract.state).toBe('draft');
      expect(await contractModel(connection).countDocuments({})).toBe(1);
      // A draft freezes nothing: no instalment exists until activation.
      expect(
        await installmentModel(connection).countDocuments({
          contractId: first.body.contract.contractId,
        }),
      ).toBe(0);
      await as(MANAGER)
        .post(`/api/v1/sales/contracts/${first.body.contract.contractId}/activate`)
        .send({ expectedVersion: first.body.contract.version })
        .expect(200);
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

    it('refuses to cancel a contract with money collected beyond the reservation (BMP-2)', async () => {
      const { reservation } = await confirmedReservation();
      const { contract } = await contractFor(MANAGER, reservation.reservationId);
      // A receipt, as the collections module would record it: paid now exceeds the reservation's own.
      await connection
        .collection(CONTRACTS_COLLECTION)
        .updateOne(
          { contractId: contract.contractId },
          { $set: { 'paidAmount.amount': new mongoose.Types.Decimal128('150000') } },
        );
      const refused = await as(MANAGER)
        .post(`/api/v1/sales/contracts/${contract.contractId}/cancel`)
        .send({ reason: 'trying to cancel a paid contract' })
        .expect(409);
      expect(refused.body.error.code).toBe('CONFLICT');
      const stored = await contractModel(connection)
        .findOne({ contractId: contract.contractId })
        .lean()
        .exec();
      expect(stored?.state).toBe('active');
    });

    it('cancels with only the reservation money on it, and hands the refund to finance', async () => {
      const { unit, reservation } = await confirmedReservation();
      const { contract } = await contractFor(MANAGER, reservation.reservationId);
      const cancelled = await as(MANAGER)
        .post(`/api/v1/sales/contracts/${contract.contractId}/cancel`)
        .send({ reason: 'customer withdrew before paying more' })
        .expect(200);
      expect(cancelled.body).toMatchObject({ state: 'cancelled', refundHandoff: 'pending' });
      const rows = await installmentModel(connection)
        .find({ contractId: contract.contractId })
        .lean()
        .exec();
      // Every row is cancelled, none deleted; the money taken stays on the contract for the refund.
      expect(rows).toHaveLength(13);
      expect(rows.every((row) => row.state === 'cancelled')).toBe(true);
      const stored = await contractModel(connection)
        .findOne({ contractId: contract.contractId })
        .lean()
        .exec();
      expect(stored?.paidAmount.amount.toString()).toBe('100000');
      const storedUnit = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(storedUnit?.status).toBe('available');
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
      const created = await contractFor(MANAGER, reservation.reservationId);

      const cancelled = await as(MANAGER)
        .post(`/api/v1/sales/contracts/${created.contract.contractId}/cancel`)
        .send({ reason: 'customer defaulted before paying', releaseUnit: true })
        .expect(200);
      expect(cancelled.body.refundHandoff).toBe('notApplicable');

      const storedUnit = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(storedUnit?.status).toBe('available');
      const installments = await installmentModel(connection)
        .find({ contractId: created.contract.contractId })
        .lean()
        .exec();
      // Cancelled, never deleted: the schedule that existed is part of the history (ADR-0009).
      expect(installments.length).toBeGreaterThan(0);
      expect(installments.every((row) => row.state === 'cancelled')).toBe(true);
    });

    it('audits the draft, the activation and the schedule generation', async () => {
      const { reservation } = await confirmedReservation();
      const created = await contractFor(MANAGER, reservation.reservationId);
      const events = await connection
        .collection(AUDIT_COLLECTION)
        .find({ 'target.id': created.contract.contractId })
        .toArray();
      const actions = events.map((event) => event['action'] as string);
      expect(actions).toContain(SALES_AUDIT_ACTIONS.contractCreated);
      expect(actions).toContain(SALES_AUDIT_ACTIONS.contractActivated);
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
      return contractFor(MANAGER, reservation.reservationId);
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

    it('totals the contract portfolio in the database, exactly and inside the scope', async () => {
      async function contractAs(owner: string, price: string) {
        const { unit } = await makeUnit(price);
        const customer = await makeCustomer(owner);
        const reservation = await reserve(owner, {
          unitId: unit.unitId,
          customerId: customer.customerId,
          agreedPrice: egp(price),
          reservationAmount: egp('0'),
        });
        await as(owner)
          .post(`/api/v1/sales/reservations/${reservation.reservationId}/confirm`)
          .expect(200);
        await contractFor(owner, reservation.reservationId);
      }
      // Amounts whose float sum is not exact: 0.1 + 0.2 style values at contract scale.
      await contractAs(REP_ONE, '1000000.10');
      await contractAs(REP_ONE, '2000000.20');
      await contractAs(REP_TWO, '3000000.30');

      const all = await as(MANAGER).get('/api/v1/sales/contracts/summary?state=active').expect(200);
      expect(all.body.contracts).toBe(3);
      expect(all.body.byCurrency).toHaveLength(1);
      const [row] = all.body.byCurrency as {
        currency: string;
        contracts: number;
        totalContracted: Money;
        totalPaid: Money;
        totalOutstanding: Money;
      }[];
      expect(row?.currency).toBe('EGP');
      expect(row?.contracts).toBe(3);
      // Decimal128 keeps the stored scale ("6000000.60"); the value is what must be exact.
      expect(compareMoney(row!.totalContracted, egp('6000000.6'))).toBe(0);
      expect(compareMoney(row!.totalPaid, egp('0'))).toBe(0);
      expect(compareMoney(row!.totalOutstanding, egp('6000000.6'))).toBe(0);

      // The representative's total is their own contracts only — the scope is in the $match.
      const mine = await as(REP_ONE).get('/api/v1/sales/contracts/summary').expect(200);
      expect(mine.body.contracts).toBe(2);
      expect(compareMoney(mine.body.byCurrency[0].totalContracted, egp('3000000.3'))).toBe(0);

      // No contracts in scope is an empty portfolio, not an error and not someone else's figures.
      const none = await as(MANAGER).get('/api/v1/sales/contracts/summary?state=cancelled');
      expect(none.status).toBe(200);
      expect(none.body).toEqual({ contracts: 0, byCurrency: [] });

      await as().get('/api/v1/sales/contracts/summary').expect(401);
      await as(NO_GRANT).get('/api/v1/sales/contracts/summary').expect(403);
      await as(MANAGER).get('/api/v1/sales/contracts/summary?state=bogus').expect(400);
      await as(MANAGER).get('/api/v1/sales/contracts/summary?extra=1').expect(400);
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

  /* ------------------------------------------------------------ BMP-1 package 5 */

  const context = { correlationId: `${RUN}-direct` };

  function reserveRaw(accountId: string, body: Record<string, unknown>) {
    return as(accountId)
      .post('/api/v1/sales/reservations')
      .send({
        reservationAmount: egp('100000'),
        agreedPrice: egp('3000000'),
        paymentPlan: defaultPlan,
        idempotencyKey: nextKey('idem-rsv-'),
        ...body,
      });
  }

  describe('validity from configuration (SALE-RESERVE-003, BD-01)', () => {
    it('refuses every reservation while no validity is configured, touching nothing', async () => {
      validityDays = null;
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      const refused = await reserveRaw(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
      }).expect(409);
      expect(refused.body.error.issues[0].code).toBe('RESERVATION_VALIDITY_NOT_CONFIGURED');
      expect(await reservationModel(connection).countDocuments({})).toBe(0);
      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.status).toBe('available');
    });

    it('holds for the configured days, and refuses a caller-chosen period', async () => {
      validityDays = 21;
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      await reserveRaw(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
        holdDays: 30,
      }).expect(400);
      const made = await reserveRaw(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
      }).expect(201);
      expect(made.body.expiresOn).toBe('2026-10-13');
    });
  });

  describe('competing requests (SALE-RESERVE-002, BD-30)', () => {
    it('lets exactly one of five simultaneous reservations win, leaving one hold and one record', async () => {
      const { unit } = await makeUnit();
      const customers = await Promise.all([0, 1, 2, 3, 4].map(() => makeCustomer(MANAGER)));
      const results = await Promise.all(
        customers.map((customer) =>
          reserveRaw(MANAGER, { unitId: unit.unitId, customerId: customer.customerId }),
        ),
      );
      const statuses = results.map((result) => result.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409]);
      for (const loser of results.filter((result) => result.status === 409)) {
        expect(loser.body.error.issues[0].code).toBe('UNIT_NOT_AVAILABLE');
      }
      const winner = results.find((result) => result.status === 201);
      expect(await reservationModel(connection).countDocuments({ unitId: unit.unitId })).toBe(1);
      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored).toMatchObject({
        status: 'held',
        heldByReservationId: winner?.body.reservationId as string,
      });
    });
  });

  describe('discounts and exceptions (SALE-DISCOUNT-001, 002, SALE-RESERVE-004)', () => {
    it('waits for the discount approval, refuses confirmation meanwhile, and confirms once approved', async () => {
      governed.add('sales.reservation.discount');
      const { unit } = await makeUnit('3000000');
      const customer = await makeCustomer();
      const made = await reserveRaw(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
        agreedPrice: egp('2850000'),
      }).expect(201);
      expect(made.body).toMatchObject({ state: 'pendingApproval', discountPercentage: '5' });
      expect(made.body.listPrice).toEqual(egp('3000000'));
      const reservationId = made.body.reservationId as string;
      await as(MANAGER).post(`/api/v1/sales/reservations/${reservationId}/confirm`).expect(409);
      approvalStates.set(made.body.approvals[0].requestId as string, 'approved');
      expect(
        await sales.syncApproval(
          MAINTENANCE_ACTOR,
          made.body.approvals[0].requestId as string,
          context,
        ),
      ).toBe('approved');
      const confirmed = await as(MANAGER)
        .post(`/api/v1/sales/reservations/${reservationId}/confirm`)
        .expect(200);
      expect(confirmed.body.state).toBe('confirmed');
    });

    it('rejects the reservation when the approval is refused, returning the unit and handing off the deposit', async () => {
      governed.add('sales.reservation.discount');
      const { unit } = await makeUnit('3000000');
      const customer = await makeCustomer();
      const made = await reserveRaw(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
        agreedPrice: egp('2700000'),
      }).expect(201);
      approvalStates.set(made.body.approvals[0].requestId as string, 'rejected');
      expect((await sales.sweep(MAINTENANCE_ACTOR, context)).settled).toBe(1);
      const read = await as(MANAGER)
        .get(`/api/v1/sales/reservations/${made.body.reservationId as string}`)
        .expect(200);
      expect(read.body).toMatchObject({ state: 'rejected', refundHandoff: 'pending' });
      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.status).toBe('available');
    });

    it('refuses a discount above the maximum when no override policy exists, consuming nothing', async () => {
      maximumDiscountPercent = '10';
      const { unit } = await makeUnit('3000000');
      const customer = await makeCustomer();
      const countersBefore = await connection.collection(COUNTERS_COLLECTION).find({}).toArray();
      const refused = await reserveRaw(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
        agreedPrice: egp('2640000'),
      }).expect(409);
      expect(refused.body.error.issues[0].code).toBe('DISCOUNT_ABOVE_MAXIMUM');
      expect(await reservationModel(connection).countDocuments({})).toBe(0);
      expect(await connection.collection(COUNTERS_COLLECTION).find({}).toArray()).toEqual(
        countersBefore,
      );
      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.status).toBe('available');
    });

    it('asks for the discount and the override together, and approves only when both are granted', async () => {
      maximumDiscountPercent = '10';
      governed.add('sales.reservation.discount');
      governed.add('sales.reservation.priceOverride');
      const { unit } = await makeUnit('3000000');
      const customer = await makeCustomer();
      const made = await reserveRaw(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
        agreedPrice: egp('2640000'),
      }).expect(201);
      expect(made.body.exceptions).toEqual(['discountAboveMaximum']);
      const approvals = made.body.approvals as { operationType: string; requestId: string }[];
      expect(approvals.map((entry) => entry.operationType)).toEqual([
        'sales.reservation.discount',
        'sales.reservation.priceOverride',
      ]);
      approvalStates.set(approvals[0]!.requestId, 'approved');
      expect(await sales.syncApproval(MAINTENANCE_ACTOR, approvals[0]!.requestId, context)).toBe(
        'unchanged',
      );
      approvalStates.set(approvals[1]!.requestId, 'approved');
      expect(await sales.syncApproval(MAINTENANCE_ACTOR, approvals[1]!.requestId, context)).toBe(
        'approved',
      );
    });

    it('requires an exception approval for a deposit below the configured minimum', async () => {
      minimumDeposit = { kind: 'percentage', percent: '5' };
      const { unit } = await makeUnit('3000000');
      const customer = await makeCustomer();
      const refused = await reserveRaw(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
        reservationAmount: egp('149999.99'),
      }).expect(409);
      expect(refused.body.error.issues[0].code).toBe('DEPOSIT_BELOW_MINIMUM');
      governed.add('sales.reservation.exception');
      const made = await reserveRaw(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
        reservationAmount: egp('149999.99'),
      }).expect(201);
      expect(made.body).toMatchObject({
        state: 'pendingApproval',
        exceptions: ['depositBelowMinimum'],
        minimumDeposit: egp('150000'),
      });
      // At the minimum there is no exception and nothing to approve.
      const { unit: other } = await makeUnit('3000000');
      const exact = await reserveRaw(MANAGER, {
        unitId: other.unitId,
        customerId: customer.customerId,
        reservationAmount: egp('150000'),
      }).expect(201);
      expect(exact.body).toMatchObject({ state: 'draft', exceptions: [] });
    });
  });

  describe('extension and cancellation (SALE-RESERVE-003, 005)', () => {
    it('extends at once without a policy, and through approval with one', async () => {
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      const made = await reserveRaw(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
      }).expect(201);
      const reservationId = made.body.reservationId as string;
      const extended = await as(MANAGER)
        .post(`/api/v1/sales/reservations/${reservationId}/extend`)
        .send({
          days: 7,
          reason: 'customer awaiting a transfer',
          expectedVersion: made.body.version as number,
        })
        .expect(200);
      expect(extended.body).toMatchObject({ expiresOn: '2026-10-13', extensions: 1 });

      governed.add('sales.reservation.extension');
      const pending = await as(MANAGER)
        .post(`/api/v1/sales/reservations/${reservationId}/extend`)
        .send({
          days: 5,
          reason: 'still waiting',
          expectedVersion: extended.body.version as number,
        })
        .expect(200);
      expect(pending.body.pendingExtension).toMatchObject({ days: 5 });
      expect(pending.body.expiresOn).toBe('2026-10-13');
      approvalStates.set(pending.body.pendingExtension.requestId as string, 'approved');
      expect((await sales.sweep(MAINTENANCE_ACTOR, context)).settled).toBe(1);
      const read = await as(MANAGER).get(`/api/v1/sales/reservations/${reservationId}`).expect(200);
      expect(read.body).toMatchObject({ expiresOn: '2026-10-18', extensions: 2 });
      expect(read.body.pendingExtension).toBeUndefined();
    });

    it('waits for a governed cancellation, then releases the unit and hands off the deposit', async () => {
      governed.add('sales.reservation.cancellation');
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      const made = await reserveRaw(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
      }).expect(201);
      const reservationId = made.body.reservationId as string;
      const waiting = await as(MANAGER)
        .post(`/api/v1/sales/reservations/${reservationId}/cancel`)
        .send({ reason: 'customer withdrew' })
        .expect(200);
      expect(waiting.body.state).toBe('draft');
      expect(waiting.body.pendingCancellation).toMatchObject({ reason: 'customer withdrew' });
      let stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.status).toBe('held');
      approvalStates.set(waiting.body.pendingCancellation.requestId as string, 'approved');
      expect(
        await sales.syncApproval(
          MAINTENANCE_ACTOR,
          waiting.body.pendingCancellation.requestId as string,
          context,
        ),
      ).toBe('cancelled');
      stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored?.status).toBe('available');
      const read = await as(MANAGER).get(`/api/v1/sales/reservations/${reservationId}`).expect(200);
      expect(read.body).toMatchObject({ state: 'cancelled', refundHandoff: 'pending' });
    });
  });

  describe('holds, opportunities and numbering (INV-HOLD-001, CRM-OPP-002, SALE-RESERVE-006)', () => {
    it("converts the representative's own hold, and refuses a colleague's", async () => {
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      const { hold } = await holds.create(
        await actorFor(REP_ONE),
        { unitId: unit.unitId, idempotencyKey: nextKey('idem-hold-') },
        context,
      );
      const refused = await reserveRaw(REP_TWO, {
        unitId: unit.unitId,
        customerId: customer.customerId,
        holdId: hold.holdId,
      }).expect(403);
      expect(refused.body.error.issues[0].code).toBe('NOT_HOLDER');
      const made = await reserveRaw(REP_ONE, {
        unitId: unit.unitId,
        customerId: customer.customerId,
        holdId: hold.holdId,
      }).expect(201);
      const stored = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(stored).toMatchObject({
        status: 'held',
        heldByReservationId: made.body.reservationId as string,
      });
      expect((await holds.findUnscoped(hold.holdId))?.state).toBe('converted');
    });

    it('moves the opportunity to reservation, back on cancellation, and to won with the contract', async () => {
      const customer = await makeCustomer(MANAGER);
      const opportunity = await opportunities.create(
        await actorFor(MANAGER),
        { customerId: customer.customerId },
        context,
      );
      const other = await makeCustomer(MANAGER);
      const { unit } = await makeUnit();
      await reserveRaw(MANAGER, {
        unitId: unit.unitId,
        customerId: other.customerId,
        opportunityId: opportunity.opportunityId,
      }).expect(400);
      const first = await reserveRaw(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
        opportunityId: opportunity.opportunityId,
      }).expect(201);
      expect((await opportunities.findUnscoped(opportunity.opportunityId))?.stage).toBe(
        'reservation',
      );
      await as(MANAGER)
        .post(`/api/v1/sales/reservations/${first.body.reservationId as string}/cancel`)
        .send({ reason: 'changed floor' })
        .expect(200);
      expect((await opportunities.findUnscoped(opportunity.opportunityId))?.stage).toBe(
        'negotiation',
      );
      const second = await reserveRaw(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
        opportunityId: opportunity.opportunityId,
      }).expect(201);
      const reservationId = second.body.reservationId as string;
      await as(MANAGER).post(`/api/v1/sales/reservations/${reservationId}/confirm`).expect(200);
      // A draft wins nothing: the opportunity is won when the contract is activated (CRM-OPP-002).
      const draft = await draftFor(MANAGER, reservationId);
      expect((await opportunities.findUnscoped(opportunity.opportunityId))?.stage).toBe(
        'reservation',
      );
      await as(MANAGER)
        .post(`/api/v1/sales/contracts/${draft.contractId}/activate`)
        .send({ expectedVersion: draft.version })
        .expect(200);
      const won = await opportunities.findUnscoped(opportunity.opportunityId);
      expect(won?.stage).toBe('won');
      expect(won?.contractId).toBe(draft.contractId);
    });

    it('takes the official number when a format is active, and the legacy series otherwise', async () => {
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      officialNumber = 'RES/CAI/2026/000001';
      const official = await reserveRaw(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
      }).expect(201);
      expect(official.body.reservationNumber).toBe('RES/CAI/2026/000001');
      officialNumber = undefined;
      const { unit: other } = await makeUnit();
      const legacy = await reserveRaw(MANAGER, {
        unitId: other.unitId,
        customerId: customer.customerId,
      }).expect(201);
      // The year is the organization's calendar year, not the server's UTC clock.
      expect(legacy.body.reservationNumber).toMatch(/^RSV-2026-\d{5}$/);
    });
  });

  describe('the down payment date survives into the contract (discovery defect)', () => {
    it('dates the deposit on its own due date, not on the first instalment date', async () => {
      const { unit } = await makeUnit();
      const customer = await makeCustomer();
      const made = await reserveRaw(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
        paymentPlan: {
          ...defaultPlan,
          downPaymentDueOn: BusinessDateSchema.parse('2026-09-22'),
          firstDueOn: BusinessDateSchema.parse('2026-10-22'),
        },
      }).expect(201);
      const reservationId = made.body.reservationId as string;
      expect(made.body.paymentPlan.downPaymentDueOn).toBe('2026-09-22');
      await as(MANAGER).post(`/api/v1/sales/reservations/${reservationId}/confirm`).expect(200);
      const { installments: rows } = await contractFor(MANAGER, reservationId);
      expect(rows[0]).toMatchObject({ kind: 'downPayment', dueOn: '2026-09-22' });
      expect(rows[1]).toMatchObject({ kind: 'installment', dueOn: '2026-10-22' });
    });
  });

  /* ------------------------------------------------ BMP-1 package 6: contracts */

  const contractsContext = { correlationId: 'it-sales-contracts' };

  async function confirmed(options: { plan?: PaymentPlan; price?: string; amount?: string } = {}) {
    const price = options.price ?? '3000000';
    const { unit } = await makeUnit(price);
    const customer = await makeCustomer();
    const reservation = await reserve(MANAGER, {
      unitId: unit.unitId,
      customerId: customer.customerId,
      agreedPrice: egp(price),
      reservationAmount: egp(options.amount ?? '100000'),
      paymentPlan: options.plan ?? defaultPlan,
    });
    await as(MANAGER)
      .post(`/api/v1/sales/reservations/${reservation.reservationId}/confirm`)
      .expect(200);
    return { unit, customer, reservation };
  }

  const latestRequest = async (contractId: string) => {
    const stored = await contractModel(connection).findOne({ contractId }).lean().exec();
    return stored?.approvals?.at(-1)?.requestId ?? '';
  };

  describe('contract drafts (SALE-CONTRACT-001, 002)', () => {
    it('drafts with snapshots and a proposed schedule, and commits nothing', async () => {
      const { unit, reservation } = await confirmed();
      const draft = await as(MANAGER)
        .post('/api/v1/sales/contracts')
        .send({
          reservationId: reservation.reservationId,
          contractedOn: '2026-09-22',
          idempotencyKey: nextKey('idem-ctr-'),
        })
        .expect(201);
      const contract = draft.body.contract;
      expect(contract).toMatchObject({
        state: 'draft',
        exceptions: [],
        parties: [{ role: 'buyer', sharePercent: '100' }],
        signing: { state: 'unsigned' },
        pricing: { agreedPrice: egp('3000000'), reservationAmount: egp('100000') },
        unitSnapshot: { unitId: unit.unitId, code: unit.code },
      });
      expect(contract.warnings).toEqual(expect.arrayContaining(['identityMissing', 'notSigned']));
      expect(contract.draftSchedule).toHaveLength(13);
      expect(draft.body.installments).toEqual([]);
      // The unit is still the reservation's, and the reservation now points at its draft.
      const storedUnit = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(storedUnit?.status).toBe('reserved');
      const storedReservation = await reservationModel(connection)
        .findOne({ reservationId: reservation.reservationId })
        .lean()
        .exec();
      expect(storedReservation).toMatchObject({
        state: 'confirmed',
        contractId: contract.contractId,
      });
      // A draft is not portfolio: the summary counts only committed contracts.
      const summary = await as(MANAGER).get('/api/v1/sales/contracts/summary').expect(200);
      expect(summary.body.contracts).toBe(0);
    });

    it("records the buyer's identity but shows it only to someone who may see identities", async () => {
      const { unit } = await makeUnit();
      const manager = await actorFor(MANAGER);
      // A fixture-only actor who may record an identity; the manager themself may not read one.
      const actor = {
        ...manager,
        permissions: [...manager.permissions, 'crm.customer.viewIdentity' as const],
      };
      const customer = await crm.createCustomer(
        actor,
        {
          name: 'مشتري بهوية',
          primaryPhone: `+2012${String(20000000 + counter++).padStart(8, '0')}`,
          branchId: BRANCH_A,
          ownerAccountId: REP_ONE,
          identity: { type: 'nationalId', number: '29001011234567' },
        },
        contractsContext,
      );
      const reservation = await reserve(MANAGER, {
        unitId: unit.unitId,
        customerId: customer.customerId,
      });
      await as(MANAGER)
        .post(`/api/v1/sales/reservations/${reservation.reservationId}/confirm`)
        .expect(200);
      // Drafted by someone who may see identities: the snapshot records it (SALE-CONTRACT-001).
      const { contract: draft } = await sales.createContract(
        actor,
        {
          reservationId: reservation.reservationId,
          contractedOn: TODAY,
          idempotencyKey: nextKey('idem-ctr-'),
        },
        contractsContext,
      );
      const stored = await contractModel(connection)
        .findOne({ contractId: draft.contractId })
        .lean()
        .exec();
      expect(stored?.customerSnapshot?.['identity']).toMatchObject({ number: '29001011234567' });
      // The manager holds no `crm.customer.viewIdentity`: absent, not masked (SEC-029).
      const read = await as(MANAGER).get(`/api/v1/sales/contracts/${draft.contractId}`).expect(200);
      expect(read.body.customerSnapshot.name).toBe('مشتري بهوية');
      expect(read.body.customerSnapshot.identity).toBeUndefined();
      expect(read.body.warnings).not.toContain('identityMissing');
    });

    it('validates parties exactly, and refuses a person the actor cannot see', async () => {
      const { reservation, customer } = await confirmed();
      const coBuyer = await makeCustomer();
      const refused = await as(MANAGER)
        .post('/api/v1/sales/contracts')
        .send({
          reservationId: reservation.reservationId,
          contractedOn: '2026-09-22',
          idempotencyKey: nextKey('idem-ctr-'),
          parties: [
            { role: 'buyer', customerId: customer.customerId, sharePercent: '66.6666' },
            { role: 'coBuyer', customerId: coBuyer.customerId, sharePercent: '33.3333' },
          ],
        })
        .expect(400);
      expect(refused.body.error.issues[0].code).toBe('SHARES_MUST_TOTAL_100');
      expect(await contractModel(connection).countDocuments({})).toBe(0);

      const draft = await draftFor(MANAGER, reservation.reservationId, {
        parties: [
          { role: 'buyer', customerId: customer.customerId, sharePercent: '66.6667' },
          { role: 'coBuyer', customerId: coBuyer.customerId, sharePercent: '33.3333' },
        ],
      });
      const changed = await as(MANAGER)
        .put(`/api/v1/sales/contracts/${draft.contractId}/parties`)
        .send({
          expectedVersion: draft.version,
          parties: [
            { role: 'buyer', customerId: customer.customerId, sharePercent: '100' },
            { role: 'guarantor', customerId: coBuyer.customerId },
          ],
        })
        .expect(200);
      expect(changed.body.parties).toHaveLength(2);
      expect(changed.body.parties[1]).toMatchObject({ role: 'guarantor', name: 'عميل تجريبي' });
    });

    it('refuses a party the drafting representative cannot see', async () => {
      const { unit } = await makeUnit();
      const own = await makeCustomer(REP_TWO);
      const hidden = await makeCustomer(REP_ONE);
      const reservation = await reserve(REP_TWO, { unitId: unit.unitId, customerId: own.customerId });
      await as(REP_TWO)
        .post(`/api/v1/sales/reservations/${reservation.reservationId}/confirm`)
        .expect(200);
      const refused = await as(REP_TWO)
        .post('/api/v1/sales/contracts')
        .send({
          reservationId: reservation.reservationId,
          contractedOn: '2026-09-22',
          idempotencyKey: nextKey('idem-ctr-'),
          parties: [
            { role: 'buyer', customerId: own.customerId, sharePercent: '100' },
            { role: 'guarantor', customerId: hidden.customerId },
          ],
        })
        .expect(400);
      expect(refused.body.error.issues[0].code).toBe('PARTY_NOT_FOUND');
    });

    it('holds the reservation while a draft exists, and frees it when the draft is withdrawn', async () => {
      const { reservation } = await confirmed();
      const draft = await draftFor(MANAGER, reservation.reservationId);
      const blocked = await as(MANAGER)
        .post(`/api/v1/sales/reservations/${reservation.reservationId}/cancel`)
        .send({ reason: 'changed mind' })
        .expect(409);
      expect(blocked.body.error.issues[0].code).toBe('CONTRACT_IN_PROGRESS');
      // A second draft for the same sale is refused while the first is live.
      await as(MANAGER)
        .post('/api/v1/sales/contracts')
        .send({
          reservationId: reservation.reservationId,
          contractedOn: '2026-09-22',
          idempotencyKey: nextKey('idem-ctr-'),
        })
        .expect(409);
      // Expiry leaves it alone too.
      await reservationModel(connection).updateOne(
        { reservationId: reservation.reservationId },
        { $set: { expiresOn: '2026-01-01' } },
      );
      await sales.sweep(MAINTENANCE_ACTOR, contractsContext);
      expect(
        (await reservationModel(connection)
          .findOne({ reservationId: reservation.reservationId })
          .lean()
          .exec())?.state,
      ).toBe('confirmed');

      const withdrawn = await as(MANAGER)
        .post(`/api/v1/sales/contracts/${draft.contractId}/cancel`)
        .send({ reason: 'redraft with a co-buyer' })
        .expect(200);
      expect(withdrawn.body.state).toBe('cancelled');
      await reservationModel(connection).updateOne(
        { reservationId: reservation.reservationId },
        { $set: { expiresOn: '2026-12-01' } },
      );
      await draftFor(MANAGER, reservation.reservationId);
    });
  });

  describe('activation and signing (SALE-CONTRACT-003, 004)', () => {
    it('activates at once when no exception applies, freezing the schedule', async () => {
      const { unit, reservation } = await confirmed();
      const { contract, installments } = await contractFor(MANAGER, reservation.reservationId);
      expect(contract.state).toBe('active');
      expect(installments).toHaveLength(13);
      const storedUnit = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(storedUnit?.status).toBe('contracted');
      // Activating twice is a conflict, not a second schedule.
      await as(MANAGER)
        .post(`/api/v1/sales/contracts/${contract.contractId}/activate`)
        .send({ expectedVersion: contract.version })
        .expect(409);
      expect(
        await installmentModel(connection).countDocuments({ contractId: contract.contractId }),
      ).toBe(13);
    });

    it('sends a changed plan through the exception approval where a policy governs it', async () => {
      governed.add('sales.contract.exception');
      const { reservation } = await confirmed();
      const draft = await draftFor(MANAGER, reservation.reservationId, {
        paymentPlan: { ...defaultPlan, installmentCount: 24 },
      });
      const waiting = await as(MANAGER)
        .post(`/api/v1/sales/contracts/${draft.contractId}/activate`)
        .send({ expectedVersion: draft.version })
        .expect(200);
      expect(waiting.body).toMatchObject({ state: 'pendingApproval', exceptions: ['planChanged'] });
      expect(
        await installmentModel(connection).countDocuments({ contractId: draft.contractId }),
      ).toBe(0);

      // Refused: back to a draft that can be corrected.
      const requestId = await latestRequest(draft.contractId);
      approvalStates.set(requestId, 'rejected');
      await sales.syncApproval(MAINTENANCE_ACTOR, requestId, contractsContext);
      const again = await as(MANAGER).get(`/api/v1/sales/contracts/${draft.contractId}`).expect(200);
      expect(again.body.state).toBe('draft');

      // Asked again and granted: the engine's outcome activates it.
      await as(MANAGER)
        .post(`/api/v1/sales/contracts/${draft.contractId}/activate`)
        .send({ expectedVersion: again.body.version as number })
        .expect(200);
      const second = await latestRequest(draft.contractId);
      expect(second).not.toBe(requestId);
      approvalStates.set(second, 'approved');
      await sales.sweep(MAINTENANCE_ACTOR, contractsContext);
      const active = await as(MANAGER).get(`/api/v1/sales/contracts/${draft.contractId}`).expect(200);
      expect(active.body.state).toBe('active');
      expect(
        await installmentModel(connection).countDocuments({ contractId: draft.contractId }),
      ).toBe(25);
    });

    it('activates a changed plan by permission alone where no policy governs it', async () => {
      const { reservation } = await confirmed();
      const { contract } = await contractFor(MANAGER, reservation.reservationId, {
        paymentPlan: { ...defaultPlan, installmentCount: 6 },
      });
      expect(contract.state).toBe('active');
    });

    it('records signing once, with a signed copy the contract owns', async () => {
      const { reservation } = await confirmed();
      const { contract } = await contractFor(MANAGER, reservation.reservationId);
      signedCopyOwners.set('doc_signedcopy00000000000000000001', {
        type: 'contract',
        id: contract.contractId,
      });
      signedCopyOwners.set('doc_othercopy000000000000000000001', {
        type: 'contract',
        id: 'ctr_someotherone0000000000000000001',
      });
      const foreign = await as(MANAGER)
        .post(`/api/v1/sales/contracts/${contract.contractId}/signing`)
        .send({
          signedOn: '2026-09-22',
          documentId: 'doc_othercopy000000000000000000001',
          expectedVersion: contract.version,
        })
        .expect(400);
      expect(foreign.body.error.issues[0].code).toBe('DOCUMENT_NOT_OWNED_BY_CONTRACT');
      await as(MANAGER)
        .post(`/api/v1/sales/contracts/${contract.contractId}/signing`)
        .send({ signedOn: '2026-09-30', expectedVersion: contract.version })
        .expect(400);
      const signed = await as(MANAGER)
        .post(`/api/v1/sales/contracts/${contract.contractId}/signing`)
        .send({
          signedOn: '2026-09-22',
          documentId: 'doc_signedcopy00000000000000000001',
          expectedVersion: contract.version,
        })
        .expect(200);
      expect(signed.body.signing).toMatchObject({ state: 'signed', signedOn: '2026-09-22' });
      expect(signed.body.warnings).not.toContain('notSigned');
      const twice = await as(MANAGER)
        .post(`/api/v1/sales/contracts/${contract.contractId}/signing`)
        .send({ signedOn: '2026-09-22', expectedVersion: signed.body.version as number })
        .expect(409);
      expect(twice.body.error.issues[0].code).toBe('ALREADY_SIGNED');
    });

    it("shows the contract's trail to a contract viewer, without change details", async () => {
      const { reservation } = await confirmed();
      const { contract } = await contractFor(MANAGER, reservation.reservationId);
      const history = await as(VIEWER)
        .get(`/api/v1/sales/contracts/${contract.contractId}/history`)
        .expect(200);
      const actions = (history.body.items as { action: string }[]).map((entry) => entry.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          SALES_AUDIT_ACTIONS.contractCreated,
          SALES_AUDIT_ACTIONS.contractActivated,
        ]),
      );
      expect(history.body.items[0].changes).toBeUndefined();
      await as(REP_TWO).get(`/api/v1/sales/contracts/${contract.contractId}/history`).expect(404);
    });
  });

  describe('milestones and the maintenance deposit (COL-SCHEDULE-001)', () => {
    it('adds the maintenance deposit to the contract total and freezes both into the schedule', async () => {
      const plan: PaymentPlan = {
        ...defaultPlan,
        milestones: [
          {
            dueOn: BusinessDateSchema.parse('2027-03-15'),
            amount: egp('300000'),
            label: { ar: 'استلام الهيكل', en: 'Structure complete' },
          },
        ],
        maintenanceDeposit: { amount: egp('150000'), dueOn: BusinessDateSchema.parse('2027-12-01') },
      };
      const { reservation } = await confirmed({ plan });
      const { contract, installments } = await contractFor(MANAGER, reservation.reservationId);
      expect(contract.totalPrice).toEqual(egp('3150000'));
      expect(contract.outstandingAmount).toEqual(egp('3050000'));
      expect(installments.map((row) => row.kind)).toEqual(
        expect.arrayContaining(['milestone', 'maintenanceDeposit']),
      );
      const sum = installments.reduce<Money>((running, row) => addMoney(running, row.amount), egp('0'));
      expect(compareMoney(sum, egp('3150000'))).toBe(0);
      // Rows in date order, numbered from one.
      const dates = installments.map((row) => row.dueOn);
      expect([...dates].sort()).toEqual(dates);
    });
  });

  describe('amendments (SALE-CHANGE-001, COL-SCHEDULE-002)', () => {
    const newPlan = { installmentCount: 6, frequency: 'quarterly', firstDueOn: '2026-12-01' };

    it('refuses an amendment no policy can approve: a confirmed schedule is immutable', async () => {
      const { reservation } = await confirmed();
      const { contract } = await contractFor(MANAGER, reservation.reservationId);
      const refused = await as(MANAGER)
        .post(`/api/v1/sales/contracts/${contract.contractId}/amendments`)
        .send({ plan: newPlan, reason: 'customer asked for quarterly', expectedVersion: contract.version })
        .expect(409);
      expect(refused.body.error.issues[0].code).toBe('AMENDMENT_NEEDS_POLICY');
      expect(
        await installmentModel(connection).countDocuments({
          contractId: contract.contractId,
          state: 'rescheduled',
        }),
      ).toBe(0);
    });

    it('replaces only unpaid rows, keeps them as rescheduled, and reconciles to the piastre', async () => {
      governed.add('sales.contract.amendment');
      const { reservation } = await confirmed();
      const { contract, installments } = await contractFor(MANAGER, reservation.reservationId);
      const requested = await as(MANAGER)
        .post(`/api/v1/sales/contracts/${contract.contractId}/amendments`)
        .send({ plan: newPlan, reason: 'customer asked for quarterly', expectedVersion: contract.version })
        .expect(200);
      const amendment = requested.body.amendments[0];
      // The part-paid down payment stays; the twelve unpaid instalments are replaced.
      expect(amendment).toMatchObject({ state: 'pending', amount: egp('2400000') });
      expect(amendment.replacedInstallmentIds).toHaveLength(12);
      expect(amendment.rows).toHaveLength(6);
      expect(amendment.rows[0].sequence).toBe(installments.length + 1);

      approvalStates.set(amendment.requestId as string, 'approved');
      await sales.syncApproval(MAINTENANCE_ACTOR, amendment.requestId as string, contractsContext);

      const rows = await installmentModel(connection)
        .find({ contractId: contract.contractId })
        .lean()
        .exec();
      expect(rows.filter((row) => row.state === 'rescheduled')).toHaveLength(12);
      const live = rows.filter((row) => row.state !== 'rescheduled' && row.state !== 'cancelled');
      expect(live).toHaveLength(7);
      const sum = live.reduce<Money>(
        (running, row) => addMoney(running, { amount: row.amount.amount.toString() as Money['amount'], currency: 'EGP' }),
        egp('0'),
      );
      expect(compareMoney(sum, egp('3000000'))).toBe(0);
      const after = await as(MANAGER).get(`/api/v1/sales/contracts/${contract.contractId}`).expect(200);
      expect(after.body.amendments[0].state).toBe('applied');
      expect(after.body.outstandingAmount).toEqual(contract.outstandingAmount);
    });

    it('marks an amendment stale when a replaced row takes money before the approval', async () => {
      governed.add('sales.contract.amendment');
      const { reservation } = await confirmed();
      const { contract } = await contractFor(MANAGER, reservation.reservationId);
      const requested = await as(MANAGER)
        .post(`/api/v1/sales/contracts/${contract.contractId}/amendments`)
        .send({ plan: newPlan, reason: 'customer asked for quarterly', expectedVersion: contract.version })
        .expect(200);
      const amendment = requested.body.amendments[0];
      // A receipt lands on one of the replaced rows meanwhile.
      await connection.collection(INSTALLMENTS_COLLECTION).updateOne(
        { installmentId: amendment.replacedInstallmentIds[0] },
        {
          $set: {
            state: 'partiallyPaid',
            'paidAmount.amount': new mongoose.Types.Decimal128('1000'),
          },
        },
      );
      approvalStates.set(amendment.requestId as string, 'approved');
      await sales.syncApproval(MAINTENANCE_ACTOR, amendment.requestId as string, contractsContext);
      const after = await as(MANAGER).get(`/api/v1/sales/contracts/${contract.contractId}`).expect(200);
      expect(after.body.amendments[0].state).toBe('stale');
      expect(
        await installmentModel(connection).countDocuments({
          contractId: contract.contractId,
          state: 'rescheduled',
        }),
      ).toBe(0);
    });
  });

  describe('contract cancellation through approval (SALE-CANCEL-001)', () => {
    it('waits for the approval, then cancels and releases the unit', async () => {
      governed.add('sales.contract.cancellation');
      const { unit, reservation } = await confirmed({ amount: '0' });
      const { contract } = await contractFor(MANAGER, reservation.reservationId);
      const waiting = await as(MANAGER)
        .post(`/api/v1/sales/contracts/${contract.contractId}/cancel`)
        .send({ reason: 'customer withdrew' })
        .expect(200);
      expect(waiting.body.state).toBe('active');
      expect(waiting.body.pendingCancellation.reason).toBe('customer withdrew');
      await as(MANAGER)
        .post(`/api/v1/sales/contracts/${contract.contractId}/cancel`)
        .send({ reason: 'again' })
        .expect(409);
      approvalStates.set(waiting.body.pendingCancellation.requestId as string, 'approved');
      await sales.sweep(MAINTENANCE_ACTOR, contractsContext);
      const cancelled = await as(MANAGER)
        .get(`/api/v1/sales/contracts/${contract.contractId}`)
        .expect(200);
      expect(cancelled.body).toMatchObject({ state: 'cancelled', refundHandoff: 'notApplicable' });
      const storedUnit = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(storedUnit?.status).toBe('available');
    });
  });

  describe('quotations (SALE-QUOTE-001)', () => {
    async function quote(accountId = REP_ONE) {
      const { unit } = await makeUnit();
      const customer = await makeCustomer(accountId);
      const created = await as(accountId)
        .post('/api/v1/sales/quotations')
        .send({
          customerId: customer.customerId,
          unitId: unit.unitId,
          agreedPrice: egp('2850000'),
          paymentPlan: defaultPlan,
          validUntil: '2026-10-06',
          idempotencyKey: nextKey('idem-quo-'),
        });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      return { unit, customer, quotation: created.body };
    }

    it('prices a unit without reserving it', async () => {
      const { unit, quotation } = await quote();
      expect(quotation).toMatchObject({
        revision: 1,
        state: 'active',
        listPrice: egp('3000000'),
        agreedPrice: egp('2850000'),
        discountPercentage: '5',
        total: egp('2850000'),
      });
      expect(quotation.quotationNumber).toMatch(/^QUO-2026-\d{5}$/);
      expect(quotation.rows).toHaveLength(13);
      const storedUnit = await unitModel(connection).findOne({ unitId: unit.unitId }).lean().exec();
      expect(storedUnit?.status).toBe('available');
      expect(storedUnit?.heldByReservationId).toBeUndefined();
      expect(storedUnit?.heldByHoldId).toBeUndefined();
      // Anyone may still reserve it the next minute.
      const customer = await makeCustomer();
      await reserve(MANAGER, { unitId: unit.unitId, customerId: customer.customerId });
    });

    it('revises into a new revision and supersedes the old one; a stale revision loses', async () => {
      const { quotation } = await quote();
      const revised = await as(REP_ONE)
        .post(`/api/v1/sales/quotations/${quotation.quotationId}/revisions`)
        .send({
          agreedPrice: egp('2800000'),
          paymentPlan: defaultPlan,
          validUntil: '2026-10-10',
          expectedRevision: 1,
        })
        .expect(201);
      expect(revised.body).toMatchObject({ revision: 2, state: 'active' });
      await as(REP_ONE)
        .post(`/api/v1/sales/quotations/${quotation.quotationId}/revisions`)
        .send({
          agreedPrice: egp('2700000'),
          paymentPlan: defaultPlan,
          validUntil: '2026-10-10',
          expectedRevision: 1,
        })
        .expect(409);
      const history = await as(REP_ONE)
        .get(`/api/v1/sales/quotations/${quotation.quotationId}`)
        .expect(200);
      expect(
        (history.body.items as { revision: number; state: string }[]).map((item) => [
          item.revision,
          item.state,
        ]),
      ).toEqual([
        [2, 'active'],
        [1, 'superseded'],
      ]);
      const list = await as(REP_ONE).get('/api/v1/sales/quotations').expect(200);
      expect(list.body.total).toBe(1);
    });

    it('reads as expired after its stated validity, and can be withdrawn', async () => {
      const { quotation } = await quote();
      await connection
        .collection(QUOTATIONS_COLLECTION)
        .updateOne({ quotationId: quotation.quotationId }, { $set: { validUntil: '2026-09-01' } });
      const expired = await as(REP_ONE).get(`/api/v1/sales/quotations/${quotation.quotationId}`).expect(200);
      expect(expired.body.items[0].state).toBe('expired');

      const { quotation: other } = await quote();
      const withdrawn = await as(REP_ONE)
        .post(`/api/v1/sales/quotations/${other.quotationId}/withdraw`)
        .send({ reason: 'customer chose another unit', expectedRevision: 1 })
        .expect(200);
      expect(withdrawn.body).toMatchObject({ state: 'withdrawn' });
    });

    it("keeps one representative's quotations from another, and refuses a validity in the past", async () => {
      const { quotation, unit, customer } = await quote(REP_ONE);
      await as(REP_TWO).get(`/api/v1/sales/quotations/${quotation.quotationId}`).expect(404);
      await as(VIEWER).get('/api/v1/sales/quotations').expect(403);
      const past = await as(REP_ONE)
        .post('/api/v1/sales/quotations')
        .send({
          customerId: customer.customerId,
          unitId: unit.unitId,
          agreedPrice: egp('2850000'),
          paymentPlan: defaultPlan,
          validUntil: '2026-09-01',
          idempotencyKey: nextKey('idem-quo-'),
        })
        .expect(400);
      expect(past.body.error.issues[0].code).toBe('VALIDITY_IN_PAST');
    });
  });
});
