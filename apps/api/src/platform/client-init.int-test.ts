import { loadApiConfig } from '@alola/config';
import { ClientInitFileSchema, type ClientInitFile } from '@alola/contracts';
import { createLogger } from '@alola/security';
import { serviceGate } from '@alola/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  COMPANY_PROFILES_COLLECTION,
  COMPANY_PROFILE_REVISIONS_COLLECTION,
} from '../modules/company';
import { BRANCHES_COLLECTION, LEGAL_ENTITIES_COLLECTION } from '../modules/organization';
import { ClientInitRefused, DEMO_LEDGER_COLLECTION, initializeClient } from './client-init';
import { createDomainServices, type DomainServices } from './domain-services';
import { ensureIndexes } from './indexes';
import { configureMongoose } from './mongo';

/**
 * Client initialization against a real MongoDB replica set, through the real composition root
 * (OPS-005). The property that matters: running it again changes nothing, and it never overwrites.
 */
const gate = serviceGate(['mongodb']);
const RUN = String(Date.now()).slice(-8);
const context = { correlationId: `it-client-init-${RUN}` };

const file = (): ClientInitFile =>
  ClientInitFileSchema.parse({
    schemaVersion: 1,
    company: {
      legalName: { ar: 'شركة تجريبية للتطوير العقاري', en: 'Test Real Estate Development Co.' },
      tradeName: { ar: 'تجريبية', en: 'Test Estates' },
      shortName: { ar: 'تجريبية', en: 'Test' },
      country: 'EG',
      defaultLocale: 'ar',
      supportedLocales: ['ar', 'en'],
      timeZone: 'Africa/Cairo',
      baseCurrency: 'EGP',
    },
    legalEntities: [
      {
        code: `LE${RUN}`,
        name: { ar: 'الكيان الرئيسي', en: 'Main entity' },
        currency: 'EGP',
        timeZone: 'Africa/Cairo',
        branches: [
          {
            code: `BR${RUN}A`,
            name: { ar: 'الفرع أ', en: 'Branch A' },
            city: { ar: 'القاهرة', en: 'Cairo' },
          },
          {
            code: `BR${RUN}B`,
            name: { ar: 'الفرع ب', en: 'Branch B' },
            city: { ar: 'الإسكندرية', en: 'Alexandria' },
          },
        ],
      },
    ],
  });

describe.skipIf(!gate.available)(`client initialization — ${gate.reason}`, () => {
  let connection: Connection;
  let services: DomainServices;
  let pending: string[];

  const run = (input: ClientInitFile = file()) =>
    initializeClient(
      {
        connection,
        company: services.company(),
        organization: services.organization(),
        pendingMigrations: () => Promise.resolve(pending),
      },
      input,
      context,
    );
  const clean = async () => {
    await connection.collection(COMPANY_PROFILES_COLLECTION).deleteMany({});
    await connection.collection(COMPANY_PROFILE_REVISIONS_COLLECTION).deleteMany({});
    await connection.collection(BRANCHES_COLLECTION).deleteMany({ code: { $regex: `^BR${RUN}` } });
    await connection
      .collection(LEGAL_ENTITIES_COLLECTION)
      .deleteMany({ code: { $regex: `^LE${RUN}` } });
    await connection.collection(DEMO_LEDGER_COLLECTION).deleteMany({ marker: RUN });
  };

  beforeAll(async () => {
    configureMongoose();
    const logger = createLogger({ name: 'it-client-init', level: 'silent' });
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'] as string,
    });
    await connection.asPromise();
    await ensureIndexes(connection, logger);
    services = createDomainServices({
      config: loadApiConfig(),
      logger,
      requireConnection: () => connection,
    });
  });

  beforeEach(async () => {
    pending = [];
    await clean();
  });

  afterAll(async () => {
    if (!connection) return;
    await clean();
    await connection.close();
  });

  it('creates what is missing, then finds everything on a second run', async () => {
    expect(await run()).toEqual([
      { item: 'company profile', outcome: 'created' },
      { item: `legal entity LE${RUN}`, outcome: 'created' },
      { item: `branch LE${RUN}/BR${RUN}A`, outcome: 'created' },
      { item: `branch LE${RUN}/BR${RUN}B`, outcome: 'created' },
    ]);
    const again = await run();
    expect(again.every((step) => step.outcome === 'exists')).toBe(true);
    expect(
      await connection
        .collection(BRANCHES_COLLECTION)
        .countDocuments({ code: { $regex: `^BR${RUN}` } }),
    ).toBe(2);
  });

  it('reports a difference and overwrites nothing', async () => {
    await run();
    const changed = file();
    changed.company.tradeName = { ar: 'اسم آخر', en: 'Another name' };
    const firstEntity = changed.legalEntities[0];
    if (!firstEntity) throw new Error('fixture');
    firstEntity.name = { ar: 'اسم مختلف', en: 'Different' };
    const steps = await run(changed);
    expect(steps).toContainEqual({
      item: 'company profile',
      outcome: 'differs',
      fields: ['tradeName'],
    });
    expect(steps).toContainEqual({
      item: `legal entity LE${RUN}`,
      outcome: 'differs',
      fields: ['name'],
    });
    expect(await services.company().getProfile()).toMatchObject({
      tradeName: { en: 'Test Estates' },
    });
  });

  it('refuses a demonstration database, and a database with pending migrations', async () => {
    await connection.collection(DEMO_LEDGER_COLLECTION).insertOne({ marker: RUN });
    await expect(run()).rejects.toBeInstanceOf(ClientInitRefused);
    await connection.collection(DEMO_LEDGER_COLLECTION).deleteMany({ marker: RUN });
    pending = ['0002-something'];
    await expect(run()).rejects.toMatchObject({ code: 'MIGRATIONS_PENDING' });
    expect(await services.company().getProfile()).toBeUndefined();
  });

  it('refuses an invalid file before touching anything', () => {
    const bad = { ...file(), legalEntities: [...file().legalEntities, ...file().legalEntities] };
    const result = ClientInitFileSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      'DUPLICATE_LEGAL_ENTITY_CODE',
    );
  });
});
