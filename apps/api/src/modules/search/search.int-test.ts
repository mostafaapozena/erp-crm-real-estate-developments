import { ScopeAssignmentSchema, type Permission, type SearchHit } from '@alola/contracts';
import { createLogger } from '@alola/security';
import { serviceGate } from '@alola/testing';
import type { Express } from 'express';
import mongoose, { type Connection } from 'mongoose';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type ApiModule } from '../../app';
import type { ActorResolver } from '../../http/actor';
import { noteAuditWrite } from '../../http/audit-context';
import { ensureIndexes } from '../../platform/indexes';
import { configureMongoose } from '../../platform/mongo';
import { AuditService } from '../audit';
import { CUSTOMERS_COLLECTION, CrmService, LEADS_COLLECTION } from '../crm';
import { InventoryService, PROJECTS_COLLECTION, UNITS_COLLECTION } from '../inventory';
import {
  ACCOUNT_GRANTS_COLLECTION,
  ROLES_COLLECTION,
  SecurityService,
  bootstrapGrant,
  bootstrapRole,
} from '../security';
import { SearchService, searchRouter, type SearchProvider } from './index';

/**
 * Global search against a real MongoDB replica set (CORE-SEARCH-001).
 *
 * The records are written straight into the collections, with the same organization fields the
 * modules store, so each case controls exactly what exists in which branch. Every search then runs
 * through the owning module's own scoped query.
 */
const gate = serviceGate(['mongodb']);
const RUN = `s${Date.now()}`;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const ACCOUNT_HEADER = 'x-test-account';
const label = (en: string) => ({ ar: `عربي ${en}`, en });

describe.skipIf(!gate.available)(`global search — ${gate.reason}`, () => {
  let connection: Connection;
  let security: SecurityService;
  let app: Express;

  const BRANCH_A = `brn_${RUN}a`;
  const BRANCH_B = `brn_${RUN}b`;
  const AGENT_A = `acc_${RUN}agenta`; // leads and customers, branch A
  const STOCK_A = `acc_${RUN}stocka`; // units only, branch A, no pricing permission
  const NOBODY = `acc_${RUN}nobody`; // signed in, no read permission at all
  const NAME = `Zafer${RUN}`; // a prefix no other record in the database shares

  const search = (accountId: string, q: string, types?: string) =>
    request(app)
      .get('/api/v1/search')
      .query({ q, ...(types ? { types } : {}) })
      .set(ACCOUNT_HEADER, accountId);
  const ids = (items: SearchHit[]) => items.map((hit) => hit.id).sort();

  beforeAll(async () => {
    configureMongoose();
    const logger = createLogger({ name: 'it-search', level: 'silent' });
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'] as string,
    });
    await connection.asPromise();
    await ensureIndexes(connection, logger);
    const audit = new AuditService({ connection, logger, onRecorded: noteAuditWrite });
    security = new SecurityService({ connection, audit, logger });
    const noBranch = () => Promise.resolve(undefined);
    const crm = new CrmService({
      connection,
      audit,
      resolveBranch: noBranch,
      today: () => '2026-10-01' as never,
    });
    const inventory = new InventoryService({ connection, audit, resolveBranch: noBranch });

    const providers: SearchProvider[] = [
      {
        type: 'lead',
        permission: 'crm.lead.view',
        search: async (actor, term, limit) =>
          (await crm.searchLeads(actor, term, limit)).map((hit) => ({ type: 'lead', ...hit })),
      },
      {
        type: 'customer',
        permission: 'crm.customer.view',
        search: async (actor, term, limit) =>
          (await crm.searchCustomers(actor, term, limit)).map((hit) => ({
            type: 'customer',
            ...hit,
          })),
      },
      {
        type: 'project',
        permission: 'inventory.project.view',
        search: async (actor, term, limit) =>
          (await inventory.searchProjects(actor, term, limit)).map((hit) => ({
            type: 'project',
            ...hit,
          })),
      },
      {
        type: 'unit',
        permission: 'inventory.unit.view',
        search: async (actor, term, limit) =>
          (await inventory.searchUnits(actor, term, limit)).map((hit) => ({
            type: 'unit',
            ...hit,
          })),
      },
    ];
    const service = new SearchService({ providers, logger });

    const grant = async (accountId: string, permissions: Permission[], branchIds: string[]) => {
      await bootstrapRole(connection, {
        key: `${RUN}-${accountId}`,
        name: label('r'),
        permissions,
      });
      await bootstrapGrant(connection, {
        accountId,
        roleKeys: permissions.length ? [`${RUN}-${accountId}`] : [],
        scope: ScopeAssignmentSchema.parse({ level: 'branch', branchIds }),
        updatedBy: 'test',
      });
    };
    await grant(AGENT_A, ['crm.lead.view', 'crm.customer.view'], [BRANCH_A]);
    await grant(STOCK_A, ['inventory.unit.view', 'inventory.project.view'], [BRANCH_A]);
    await grant(NOBODY, [], [BRANCH_A]);

    const now = new Date('2026-10-01T09:00:00.000Z');
    const lead = (id: string, branchId: string, name: string, phone: string) => ({
      leadId: id,
      name,
      primaryPhone: phone,
      primaryPhoneDigits: phone.replace(/\D/g, ''),
      source: 'referral',
      stage: 'new',
      legalEntityId: `le_${RUN}`,
      branchId,
      assignedToAccountId: AGENT_A,
      createdAt: now,
      updatedAt: now,
    });
    await connection.collection(LEADS_COLLECTION).insertMany([
      lead(`lead_${RUN}a1`, BRANCH_A, `${NAME} Ahmed`, '+20 100 555 0001'),
      lead(`lead_${RUN}b1`, BRANCH_B, `${NAME} Bassem`, '+20 100 555 0002'),
      // A name that a raw regular expression would match on `.*` — escaping must prevent it.
      lead(`lead_${RUN}a2`, BRANCH_A, `Plain${RUN}`, '+20 100 777 0003'),
    ]);
    await connection.collection(CUSTOMERS_COLLECTION).insertMany([
      {
        customerId: `cust_${RUN}a1`,
        name: `${NAME} Customer`,
        primaryPhone: '+20 122 000 0001',
        primaryPhoneDigits: '201220000001',
        legalEntityId: `le_${RUN}`,
        branchId: BRANCH_A,
        ownerAccountId: AGENT_A,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await connection.collection(PROJECTS_COLLECTION).insertOne({
      projectId: `prj_${RUN}a`,
      code: `P${RUN.toUpperCase()}`,
      name: { ar: `مشروع ${RUN}`, en: `Project ${RUN}` },
      status: 'active',
      legalEntityId: `le_${RUN}`,
      branchId: BRANCH_A,
      createdAt: now,
      updatedAt: now,
    });
    await connection.collection(UNITS_COLLECTION).insertMany([
      {
        unitId: `unit_${RUN}a1`,
        projectId: `prj_${RUN}a`,
        code: `U${RUN.toUpperCase()}-101`,
        status: 'available',
        legalEntityId: `le_${RUN}`,
        branchId: BRANCH_A,
        // A restricted field whose value is also a plausible search term.
        basePrice: mongoose.mongo.Decimal128.fromString('7654321'),
        currentPrice: mongoose.mongo.Decimal128.fromString('7654321'),
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const actorResolver: ActorResolver = async (req) => {
      const accountId = req.get(ACCOUNT_HEADER);
      return accountId ? security.resolveActor(accountId) : undefined;
    };
    const modules: ApiModule[] = [
      { basePath: '/search', router: searchRouter({ getService: () => service }) },
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
    await connection.collection(LEADS_COLLECTION).deleteMany({ leadId: { $regex: `_${RUN}` } });
    await connection
      .collection(CUSTOMERS_COLLECTION)
      .deleteMany({ customerId: { $regex: `_${RUN}` } });
    await connection
      .collection(PROJECTS_COLLECTION)
      .deleteMany({ projectId: { $regex: `_${RUN}` } });
    await connection.collection(UNITS_COLLECTION).deleteMany({ unitId: { $regex: `_${RUN}` } });
    await connection.collection(ROLES_COLLECTION).deleteMany({ key: { $regex: `^${RUN}` } });
    await connection
      .collection(ACCOUNT_GRANTS_COLLECTION)
      .deleteMany({ accountId: { $regex: `^acc_${RUN}` } });
    await connection.close();
  });

  it('finds only what the caller’s scope reaches, across the types it may read', async () => {
    const found = await search(AGENT_A, NAME).expect(200);
    expect(found.body.searched).toEqual(['lead', 'customer']);
    expect(ids(found.body.items)).toEqual([`cust_${RUN}a1`, `lead_${RUN}a1`]);
    // The branch-B lead with the same name prefix is not there — not hidden, simply not matched.
    expect(JSON.stringify(found.body)).not.toContain(`lead_${RUN}b1`);
  });

  it('matches a phone number without echoing it', async () => {
    const found = await search(AGENT_A, '20100555').expect(200);
    expect(ids(found.body.items)).toEqual([`lead_${RUN}a1`]);
    expect(found.body.items[0]).toEqual({
      type: 'lead',
      id: `lead_${RUN}a1`,
      label: `${NAME} Ahmed`,
      status: 'new',
    });
  });

  it('never matches or returns a restricted field', async () => {
    // The caller cannot see unit prices; searching for the price finds nothing.
    expect((await search(STOCK_A, '7654321').expect(200)).body.items).toEqual([]);
    const byCode = await search(STOCK_A, `U${RUN.toUpperCase()}`).expect(200);
    expect(byCode.body.items).toEqual([
      {
        type: 'unit',
        id: `unit_${RUN}a1`,
        label: `U${RUN.toUpperCase()}-101`,
        status: 'available',
      },
    ]);
    const byName = await search(STOCK_A, `Project ${RUN}`).expect(200);
    expect(byName.body.items).toEqual([
      expect.objectContaining({
        type: 'project',
        name: { ar: `مشروع ${RUN}`, en: `Project ${RUN}` },
      }),
    ]);
  });

  it('searches nothing for a caller without read permissions', async () => {
    const found = await search(NOBODY, NAME).expect(200);
    expect(found.body).toEqual({ items: [], searched: [] });
    await request(app).get('/api/v1/search').query({ q: NAME }).expect(401);
  });

  it('treats the term as text, never as a pattern', async () => {
    expect((await search(AGENT_A, '.*').expect(200)).body.items).toEqual([]);
    expect((await search(AGENT_A, '^P').expect(200)).body.items).toEqual([]);
  });

  it('validates the term and the types', async () => {
    const short = await search(AGENT_A, 'Z').expect(400);
    expect(short.body.error.issues[0]).toMatchObject({ path: ['query', 'q'], code: 'too_small' });
    await search(AGENT_A, NAME, 'lead,payroll').expect(400);
    const narrowed = await search(AGENT_A, NAME, 'customer').expect(200);
    expect(narrowed.body.searched).toEqual(['customer']);
  });
});
