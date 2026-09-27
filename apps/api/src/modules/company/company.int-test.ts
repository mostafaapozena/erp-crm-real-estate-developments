import { ScopeAssignmentSchema, type Permission } from '@alola/contracts';
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
  BRAND_ASSETS_COLLECTION,
  COMPANY_PROFILES_COLLECTION,
  COMPANY_PROFILE_REVISIONS_COLLECTION,
  CompanyService,
  brandAssetModel,
  brandingRouter,
  companyProfileModel,
  companyProfileRevisionModel,
  companyRouter,
} from './index';

/**
 * The deployment company profile against a real MongoDB replica set (PLAT-022, PLAT-023, THEME-013).
 *
 * The properties worth proving are the ones a single-tenant-per-deployment product depends on: there
 * is exactly one profile however many requests race to create it, a stale editor cannot overwrite a
 * newer one, no secret-shaped field can be stored, an inaccessible colour never reaches storage, and
 * the public endpoint reveals the identity a sign-in screen needs and nothing more.
 */
const gate = serviceGate(['mongodb']);
const RUN = `it-company-${Date.now()}`;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const ACCOUNT_HEADER = 'x-test-account';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const GIF = Buffer.from('GIF89a-not-allowed', 'latin1');

const profileBody = (overrides: Record<string, unknown> = {}) => ({
  legalName: { ar: 'شركة الاختبار للتطوير العقاري', en: 'Test Real Estate Development Co.' },
  tradeName: { ar: 'اختبار للتطوير', en: 'Test Developments' },
  shortName: { ar: 'اختبار', en: 'Test Dev' },
  commercialRegistration: 'CR-TEST-0001',
  taxRegistration: 'TAX-TEST-0001',
  otherIdentifiers: [],
  address: { ar: 'عنوان تجريبي', en: 'Fictional address' },
  country: 'EG',
  phone: '+20 100 000 0000',
  email: 'info@example.invalid',
  website: 'https://example.invalid',
  defaultLocale: 'ar',
  supportedLocales: ['ar', 'en'],
  timeZone: 'Africa/Cairo',
  baseCurrency: 'EGP',
  documentFooter: { ar: 'تذييل تجريبي', en: 'Fictional footer' },
  ...overrides,
});

describe.skipIf(!gate.available)(`company profile — ${gate.reason}`, () => {
  let connection: Connection;
  let security: SecurityService;
  let company: CompanyService;
  let app: Express;

  const ADMIN = `${RUN}-admin`;
  const VIEWER = `${RUN}-viewer`;
  const NOBODY = `${RUN}-nobody`;

  const as = (accountId?: string) => {
    const withAccount = <T extends { set: (field: string, value: string) => T }>(call: T): T =>
      accountId ? call.set(ACCOUNT_HEADER, accountId) : call;
    return {
      get: (path: string) => withAccount(request(app).get(path)),
      post: (path: string) => withAccount(request(app).post(path).set('Origin', ALLOWED_ORIGIN)),
      put: (path: string) => withAccount(request(app).put(path).set('Origin', ALLOWED_ORIGIN)),
    };
  };

  const create = (body = profileBody()) => as(ADMIN).post('/api/v1/company/profile').send(body);
  const profileCount = () => connection.collection(COMPANY_PROFILES_COLLECTION).countDocuments();

  beforeAll(async () => {
    configureMongoose();
    const logger = createLogger({ name: 'it-company', level: 'silent' });
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'] as string,
    });
    await connection.asPromise();
    await ensureIndexes(connection, logger);

    const audit = new AuditService({ connection, logger, onRecorded: noteAuditWrite });
    security = new SecurityService({ connection, audit, logger });
    company = new CompanyService({ connection, audit });

    const manage: Permission[] = ['company.profile.view', 'company.profile.manage'];
    await bootstrapRole(connection, {
      key: `${RUN}-r-admin`,
      name: { ar: 'م', en: 'a' },
      permissions: manage,
    });
    await bootstrapRole(connection, {
      key: `${RUN}-r-viewer`,
      name: { ar: 'ع', en: 'v' },
      permissions: ['company.profile.view'],
    });
    const all = ScopeAssignmentSchema.parse({ level: 'all' });
    await bootstrapGrant(connection, {
      accountId: ADMIN,
      roleKeys: [`${RUN}-r-admin`],
      scope: all,
      updatedBy: 'test',
    });
    await bootstrapGrant(connection, {
      accountId: VIEWER,
      roleKeys: [`${RUN}-r-viewer`],
      scope: all,
      updatedBy: 'test',
    });

    // An account whose grant carries no role: authenticated, holding nothing.
    await bootstrapGrant(connection, {
      accountId: NOBODY,
      roleKeys: [],
      scope: all,
      updatedBy: 'test',
    });

    const actorResolver: ActorResolver = async (req) => {
      const accountId = req.get(ACCOUNT_HEADER);
      return accountId ? security.resolveActor(accountId) : undefined;
    };
    const modules: ApiModule[] = [
      { basePath: '/company', router: companyRouter({ getService: () => company }) },
      { basePath: '/branding', router: brandingRouter({ getService: () => company }) },
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

  beforeEach(async () => {
    for (const name of [
      COMPANY_PROFILES_COLLECTION,
      COMPANY_PROFILE_REVISIONS_COLLECTION,
      BRAND_ASSETS_COLLECTION,
    ]) {
      await connection.collection(name).deleteMany({});
    }
  });

  afterAll(async () => {
    if (!connection) return;
    for (const name of [
      COMPANY_PROFILES_COLLECTION,
      COMPANY_PROFILE_REVISIONS_COLLECTION,
      BRAND_ASSETS_COLLECTION,
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

  describe('public branding', () => {
    it('answers the neutral identity, without authentication, before any profile exists', async () => {
      const res = await as().get('/api/v1/branding').expect(200);
      expect(res.body).toEqual({
        configured: false,
        demonstration: false,
        defaultLocale: 'ar',
        supportedLocales: ['ar', 'en'],
        assets: {},
        version: 0,
      });
    });

    it('reveals the sign-in identity and nothing registered, contact or historical', async () => {
      await create(profileBody({ primaryColor: '#0F766E' })).expect(201);
      const res = await as().get('/api/v1/branding').expect(200);
      expect(res.body).toMatchObject({
        configured: true,
        shortName: { ar: 'اختبار', en: 'Test Dev' },
        primaryColor: '#0F766E',
        version: 1,
      });
      const text = JSON.stringify(res.body);
      for (const secretish of ['CR-TEST-0001', 'TAX-TEST-0001', '+20', 'info@', 'Fictional']) {
        expect(text).not.toContain(secretish);
      }
      expect(Object.keys(res.body).sort()).toEqual(
        [
          'assets',
          'configured',
          'defaultLocale',
          'demonstration',
          'primaryColor',
          'shortName',
          'supportedLocales',
          'tradeName',
          'version',
        ].sort(),
      );
    });
  });

  describe('authorization', () => {
    it('answers 401 without an actor and 403 without the permission, storing nothing', async () => {
      await as().post('/api/v1/company/profile').send(profileBody()).expect(401);
      await as(NOBODY).post('/api/v1/company/profile').send(profileBody()).expect(403);
      await as(VIEWER).post('/api/v1/company/profile').send(profileBody()).expect(403);
      await as(NOBODY).get('/api/v1/company/profile').expect(403);
      expect(await profileCount()).toBe(0);
    });

    it('lets a viewer read but not change the profile', async () => {
      await create().expect(201);
      await as(VIEWER).get('/api/v1/company/profile').expect(200);
      await as(VIEWER)
        .put('/api/v1/company/profile')
        .send({ ...profileBody(), expectedVersion: 1 })
        .expect(403);
      await as(VIEWER)
        .put('/api/v1/company/profile/assets/logo')
        .set('Content-Type', 'image/png')
        .send(PNG)
        .expect(403);
    });
  });

  describe('creation', () => {
    it('creates version 1 with a revision and an audit record', async () => {
      const res = await create().expect(201);
      expect(res.body.version).toBe(1);
      expect(res.body.assets).toEqual({});
      expect(
        await connection.collection(COMPANY_PROFILE_REVISIONS_COLLECTION).countDocuments(),
      ).toBe(1);
      const audited = await connection
        .collection(AUDIT_COLLECTION)
        .countDocuments({ action: 'company.profile.created', 'actor.accountId': ADMIN });
      expect(audited).toBeGreaterThanOrEqual(1);
    });

    it('holds exactly one profile per deployment, however many creations race', async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => create()));
      const statuses = results.map((res) => res.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409]);
      expect(await profileCount()).toBe(1);
      expect(
        await connection.collection(COMPANY_PROFILE_REVISIONS_COLLECTION).countDocuments(),
      ).toBe(1);
    });

    it('refuses a secret-shaped or unknown field, and stores nothing (mass assignment)', async () => {
      for (const extra of [
        { whatsappAccessToken: 'x' },
        { smtpPassword: 'x' },
        { tenantId: 'other-company' },
        { version: 99 },
        { assets: { logo: { assetId: 'forged' } } },
      ]) {
        await create({ ...profileBody(), ...extra }).expect(400);
      }
      expect(await profileCount()).toBe(0);
    });

    it('refuses a default language that is not supported, and duplicated languages', async () => {
      await create(profileBody({ defaultLocale: 'en', supportedLocales: ['ar'] })).expect(400);
      await create(profileBody({ supportedLocales: ['ar', 'ar'] })).expect(400);
      expect(await profileCount()).toBe(0);
    });

    it('refuses a brand colour that fails WCAG AA anywhere it is used', async () => {
      const res = await create(profileBody({ primaryColor: '#FACC15' })).expect(400);
      expect(res.body.error.issues).toEqual([
        { path: ['primaryColor'], code: 'BRAND_COLOR_CONTRAST' },
      ]);
      await create(profileBody({ primaryColor: 'blue' })).expect(400);
      expect(await profileCount()).toBe(0);
    });

    it('refuses an operator object and a malformed timezone, currency or country', async () => {
      await create(profileBody({ country: { $ne: 'EG' } })).expect(400);
      await create(profileBody({ timeZone: 'Mars/Olympus' })).expect(400);
      await create(profileBody({ baseCurrency: 'egp' })).expect(400);
      await create(profileBody({ country: 'EGY' })).expect(400);
      await create(profileBody({ website: 'http://insecure.invalid' })).expect(400);
      expect(await profileCount()).toBe(0);
    });
  });

  describe('update', () => {
    it('refuses a stale version and leaves the newer profile untouched', async () => {
      await create().expect(201);
      await as(ADMIN)
        .put('/api/v1/company/profile')
        .send({ ...profileBody({ shortName: { ar: 'ثاني', en: 'Second' } }), expectedVersion: 1 })
        .expect(200);
      const stale = await as(ADMIN)
        .put('/api/v1/company/profile')
        .send({ ...profileBody({ shortName: { ar: 'قديم', en: 'Stale' } }), expectedVersion: 1 })
        .expect(409);
      expect(stale.body.error.issues).toEqual([
        { path: ['expectedVersion'], code: 'STALE_VERSION' },
      ]);
      const current = await as(ADMIN).get('/api/v1/company/profile').expect(200);
      expect(current.body.shortName.en).toBe('Second');
      expect(current.body.version).toBe(2);
    });

    it('lets exactly one of two simultaneous edits of the same version win', async () => {
      await create().expect(201);
      const edits = await Promise.all(
        ['One', 'Two'].map((name) =>
          as(ADMIN)
            .put('/api/v1/company/profile')
            .send({ ...profileBody({ shortName: { ar: name, en: name } }), expectedVersion: 1 }),
        ),
      );
      expect(edits.map((res) => res.status).sort()).toEqual([200, 409]);
      expect(
        await connection.collection(COMPANY_PROFILE_REVISIONS_COLLECTION).countDocuments(),
      ).toBe(2);
    });

    it('removes an optional field the replacement omits, and keeps every revision', async () => {
      await create().expect(201);
      const { taxRegistration: _omitted, ...withoutTax } = profileBody();
      const res = await as(ADMIN)
        .put('/api/v1/company/profile')
        .send({ ...withoutTax, expectedVersion: 1 })
        .expect(200);
      expect(res.body.taxRegistration).toBeUndefined();
      const revisions = await as(ADMIN).get('/api/v1/company/profile/revisions').expect(200);
      const items = revisions.body.items as {
        version: number;
        profile: { taxRegistration?: string };
      }[];
      expect(items.map((item) => item.version)).toEqual([2, 1]);
      expect(items[1]?.profile.taxRegistration).toBe('TAX-TEST-0001');
    });

    it('answers 404 to an update before any profile exists', async () => {
      await as(ADMIN)
        .put('/api/v1/company/profile')
        .send({ ...profileBody(), expectedVersion: 1 })
        .expect(404);
    });
  });

  describe('brand images', () => {
    it('stores a PNG, serves it publicly with its verified type, and versions the profile', async () => {
      await create().expect(201);
      const res = await as(ADMIN)
        .put('/api/v1/company/profile/assets/logo')
        .set('Content-Type', 'image/png')
        .send(PNG)
        .expect(200);
      expect(res.body.version).toBe(2);
      expect(res.body.assets.logo.contentType).toBe('image/png');

      const branding = await as().get('/api/v1/branding').expect(200);
      const url: string = branding.body.assets.logo.url;
      expect(url).toMatch(/^\/api\/v1\/branding\/assets\/logo\?v=[0-9a-f]{16}$/);

      const image = await as().get(url).expect(200);
      expect(image.headers['content-type']).toBe('image/png');
      expect(image.headers['x-content-type-options']).toBe('nosniff');
      expect(image.headers['cache-control']).toContain('immutable');
      expect(Buffer.compare(image.body as Buffer, PNG)).toBe(0);
    });

    it('supersedes the previous image instead of deleting it', async () => {
      await create().expect(201);
      for (const [type, bytes] of [
        ['image/png', PNG],
        ['image/jpeg', JPEG],
      ] as const) {
        await as(ADMIN)
          .put('/api/v1/company/profile/assets/favicon')
          .set('Content-Type', type)
          .send(bytes)
          .expect(200);
      }
      const rows = await connection
        .collection(BRAND_ASSETS_COLLECTION)
        .find({ slot: 'favicon' })
        .toArray();
      expect(rows.map((row) => String(row['state'])).sort()).toEqual(['active', 'superseded']);
      const served = await as().get('/api/v1/branding/assets/favicon').expect(200);
      expect(served.headers['content-type']).toBe('image/jpeg');
    });

    it('refuses bytes that do not match their declared type, and types outside the allow-list', async () => {
      await create().expect(201);
      const mismatch = await as(ADMIN)
        .put('/api/v1/company/profile/assets/logo')
        .set('Content-Type', 'image/png')
        .send(JPEG)
        .expect(400);
      expect(mismatch.body.error.issues).toEqual([
        { path: ['file'], code: 'CONTENT_TYPE_MISMATCH' },
      ]);
      await as(ADMIN)
        .put('/api/v1/company/profile/assets/logo')
        .set('Content-Type', 'image/gif')
        .send(GIF)
        .expect(400);
      await as(ADMIN)
        .put('/api/v1/company/profile/assets/logo')
        .set('Content-Type', 'image/svg+xml')
        .send(Buffer.from('<svg onload="alert(1)"/>'))
        .expect(400);
      await as(ADMIN)
        .put('/api/v1/company/profile/assets/../evil')
        .set('Content-Type', 'image/png')
        .send(PNG)
        .expect(404);
      await as(ADMIN)
        .put('/api/v1/company/profile/assets/banner')
        .set('Content-Type', 'image/png')
        .send(PNG)
        .expect(400);
      expect(await connection.collection(BRAND_ASSETS_COLLECTION).countDocuments()).toBe(0);
    });

    it('refuses an image over the size limit with 413', async () => {
      await create().expect(201);
      const large = Buffer.concat([PNG, Buffer.alloc(600 * 1024)]);
      await as(ADMIN)
        .put('/api/v1/company/profile/assets/logo')
        .set('Content-Type', 'image/png')
        .send(large)
        .expect(413);
      expect(await connection.collection(BRAND_ASSETS_COLLECTION).countDocuments()).toBe(0);
    });

    it('answers 404 for a slot with no image, and for an upload before the profile exists', async () => {
      await as().get('/api/v1/branding/assets/logo').expect(404);
      await as(ADMIN)
        .put('/api/v1/company/profile/assets/logo')
        .set('Content-Type', 'image/png')
        .send(PNG)
        .expect(404);
    });
  });

  describe('integrity', () => {
    it('refuses deletion of a profile, a revision or an image through the models (ADR-0009)', async () => {
      await create().expect(201);
      await expect(companyProfileModel(connection).deleteOne({})).rejects.toThrow();
      await expect(companyProfileRevisionModel(connection).deleteMany({})).rejects.toThrow();
      await expect(
        companyProfileRevisionModel(connection).updateOne({}, { $set: { version: 9 } }),
      ).rejects.toThrow();
      await expect(brandAssetModel(connection).deleteMany({})).rejects.toThrow();
      expect(await profileCount()).toBe(1);
    });

    it('names the authenticator issuer after the configured short name', async () => {
      expect(await company.authenticatorIssuer()).toBeUndefined();
      await create().expect(201);
      expect(await company.authenticatorIssuer()).toBe('Test Dev');
    });

    it('exposes the document identity with the version it came from', async () => {
      await create().expect(201);
      const identity = await company.documentIdentity();
      expect(identity).toMatchObject({
        version: 1,
        legalName: { en: 'Test Real Estate Development Co.' },
        taxRegistration: 'TAX-TEST-0001',
        documentFooter: { en: 'Fictional footer' },
      });
    });
  });
});
