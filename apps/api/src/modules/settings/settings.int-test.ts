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
  REFERENCE_ITEMS_COLLECTION,
  SETTING_REVISIONS_COLLECTION,
  SETTING_VALUES_COLLECTION,
  SettingsService,
  referenceDataRouter,
  settingRevisionModel,
  settingValueModel,
  settingsRouter,
} from './index';

/**
 * Settings, reference data and feature flags against a real MongoDB replica set (PLAT-024 … 026).
 *
 * What matters here is that configuration cannot become a hazard: only catalogued keys exist, a value
 * is checked against its own setting's schema, undecided business values stay "not configured", a
 * stale editor changes nothing, a locked feature cannot be switched on, and a code once used keeps its
 * meaning whatever happens to its label.
 */
const gate = serviceGate(['mongodb']);
const RUN = `it-settings-${Date.now()}`;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const ACCOUNT_HEADER = 'x-test-account';
const label = (en: string) => ({ ar: `عربي ${en}`, en });

describe.skipIf(!gate.available)(`settings and reference data — ${gate.reason}`, () => {
  let connection: Connection;
  let security: SecurityService;
  let settings: SettingsService;
  let app: Express;

  const ADMIN = `${RUN}-admin`;
  const VIEWER = `${RUN}-viewer`;
  const MEMBER = `${RUN}-member`;

  const as = (accountId?: string) => {
    const withAccount = <T extends { set: (field: string, value: string) => T }>(call: T): T =>
      accountId ? call.set(ACCOUNT_HEADER, accountId) : call;
    return {
      get: (path: string) => withAccount(request(app).get(path)),
      post: (path: string) => withAccount(request(app).post(path).set('Origin', ALLOWED_ORIGIN)),
      put: (path: string) => withAccount(request(app).put(path).set('Origin', ALLOWED_ORIGIN)),
      patch: (path: string) => withAccount(request(app).patch(path).set('Origin', ALLOWED_ORIGIN)),
    };
  };
  const put = (key: string, body: Record<string, unknown>, actor = ADMIN) =>
    as(actor).put(`/api/v1/settings/${key}`).send(body);

  beforeAll(async () => {
    configureMongoose();
    const logger = createLogger({ name: 'it-settings', level: 'silent' });
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'] as string,
    });
    await connection.asPromise();
    await ensureIndexes(connection, logger);
    const audit = new AuditService({ connection, logger, onRecorded: noteAuditWrite });
    security = new SecurityService({ connection, audit, logger });
    settings = new SettingsService({ connection, audit });

    const all = ScopeAssignmentSchema.parse({ level: 'all' });
    const grant = async (accountId: string, permissions: Permission[]) => {
      await bootstrapRole(connection, { key: `${accountId}-role`, name: label('r'), permissions });
      await bootstrapGrant(connection, {
        accountId,
        roleKeys: permissions.length > 0 ? [`${accountId}-role`] : [],
        scope: all,
        updatedBy: 'test',
      });
    };
    await grant(ADMIN, ['settings.view', 'settings.manage', 'referenceData.manage']);
    await grant(VIEWER, ['settings.view']);
    await grant(MEMBER, []);

    const actorResolver: ActorResolver = async (req) => {
      const accountId = req.get(ACCOUNT_HEADER);
      return accountId ? security.resolveActor(accountId) : undefined;
    };
    const modules: ApiModule[] = [
      { basePath: '/settings', router: settingsRouter({ getService: () => settings }) },
      { basePath: '/reference-data', router: referenceDataRouter({ getService: () => settings }) },
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
      SETTING_VALUES_COLLECTION,
      SETTING_REVISIONS_COLLECTION,
      REFERENCE_ITEMS_COLLECTION,
    ]) {
      await connection.collection(name).deleteMany({});
    }
  });

  afterAll(async () => {
    if (!connection) return;
    for (const name of [
      SETTING_VALUES_COLLECTION,
      SETTING_REVISIONS_COLLECTION,
      REFERENCE_ITEMS_COLLECTION,
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

  /* ============================================================ PLAT-024 */

  describe('settings', () => {
    it('lists every catalogued setting, leaving undecided business values not configured', async () => {
      const res = await as(VIEWER).get('/api/v1/settings').expect(200);
      const byKey = new Map(
        (
          res.body.items as {
            key: string;
            value: unknown;
            configured: boolean;
            decision?: string;
          }[]
        ).map((item) => [item.key, item]),
      );
      expect(byKey.get('finance.fiscalYearStartMonth')).toMatchObject({
        value: null,
        configured: false,
        decision: 'SD-21',
      });
      expect(byKey.get('sales.reservationValidityDays')).toMatchObject({
        value: null,
        decision: 'BD-01',
      });
      expect(byKey.get('collections.reminderWindowsDays')).toMatchObject({ value: [15] });
      expect(byKey.get('display.dateFormat')).toMatchObject({ value: 'dd/MM/yyyy' });
    });

    it('stores only catalogued keys — a secret has nowhere to go', async () => {
      for (const key of ['smtp.password', 'meta.accessToken', '__proto__', 'constructor']) {
        await put(key, { value: 'x', expectedVersion: 0, reason: 'attempt' }).expect(400);
      }
      await put('display.dateFormat', {
        value: 'yyyy-MM-dd',
        expectedVersion: 0,
        reason: 'r',
        extra: 1,
      }).expect(400);
      expect(await connection.collection(SETTING_VALUES_COLLECTION).countDocuments()).toBe(0);
    });

    it("validates a value against the setting's own schema", async () => {
      const bad = [
        ['display.dateFormat', 'MM/dd/yyyy'],
        ['finance.fiscalYearStartMonth', 13],
        ['finance.currencyScale', 2.5],
        ['collections.reminderWindowsDays', [7, 3]],
        ['collections.reminderWindowsDays', [15, 15]],
        ['notifications.quietHours', { start: '22:00', end: '25:00' }],
        ['notifications.quietHours', { start: '22:00', end: '07:00', extra: true }],
        ['feature.imports', 'yes'],
        ['finance.fiscalYearStartMonth', { $gt: 0 }],
      ] as const;
      for (const [key, value] of bad) {
        await put(key, { value, expectedVersion: 0, reason: 'invalid' }).expect(400);
      }
      const mandatory = await put('collections.reminderWindowsDays', {
        value: [7, 3],
        expectedVersion: 0,
        reason: 'drop the 15-day reminder',
      }).expect(400);
      expect(mandatory.body.error.issues).toEqual([
        { path: ['value'], code: 'FIFTEEN_DAY_REMINDER_MANDATORY' },
      ]);
      expect(await connection.collection(SETTING_VALUES_COLLECTION).countDocuments()).toBe(0);
    });

    it('versions every change, records it append-only with its reason, and audits it', async () => {
      const first = await put('finance.fiscalYearStartMonth', {
        value: 7,
        expectedVersion: 0,
        reason: 'fiscal year begins in July',
      }).expect(200);
      expect(first.body).toMatchObject({ value: 7, configured: true, version: 1 });
      const reset = await put('finance.fiscalYearStartMonth', {
        value: null,
        expectedVersion: 1,
        reason: 'back to not configured',
      }).expect(200);
      expect(reset.body).toMatchObject({ value: null, configured: false, version: 2 });

      const history = await as(VIEWER)
        .get('/api/v1/settings/finance.fiscalYearStartMonth/history')
        .expect(200);
      expect(
        (history.body.items as { version: number; value: unknown }[]).map((item) => [
          item.version,
          item.value,
        ]),
      ).toEqual([
        [2, null],
        [1, 7],
      ]);
      const audited = await connection
        .collection(AUDIT_COLLECTION)
        .find({ action: 'settings.changed', 'target.id': 'finance.fiscalYearStartMonth' })
        .toArray();
      expect(audited.map((event) => String(event['reason'])).sort()).toEqual([
        'back to not configured',
        'fiscal year begins in July',
      ]);
      await expect(settingRevisionModel(connection).deleteMany({})).rejects.toThrow();
      await expect(
        settingRevisionModel(connection).updateOne({}, { $set: { value: 1 } }),
      ).rejects.toThrow();
      await expect(settingValueModel(connection).deleteOne({})).rejects.toThrow();
    });

    it('refuses a stale editor and lets exactly one of two simultaneous first edits win', async () => {
      const results = await Promise.all(
        [1, 2, 3].map((month) =>
          put('finance.fiscalYearStartMonth', { value: month, expectedVersion: 0, reason: 'race' }),
        ),
      );
      expect(results.map((res) => res.status).sort()).toEqual([200, 409, 409]);
      await put('finance.fiscalYearStartMonth', {
        value: 9,
        expectedVersion: 0,
        reason: 'stale',
      }).expect(409);
      expect(await connection.collection(SETTING_REVISIONS_COLLECTION).countDocuments()).toBe(1);
    });

    it('refuses to switch on a feature gated by an ADR', async () => {
      const locked = await put('feature.meta.conversionsApiDelivery', {
        value: true,
        expectedVersion: 0,
        reason: 'try',
      }).expect(409);
      expect(locked.body.error.issues).toEqual([{ path: ['value'], code: 'FEATURE_LOCKED' }]);
      expect(await settings.isEnabled('feature.meta.conversionsApiDelivery')).toBe(false);

      await put('feature.imports', {
        value: false,
        expectedVersion: 0,
        reason: 'pause imports',
      }).expect(200);
      expect(await settings.isEnabled('feature.imports')).toBe(false);
    });

    it('validates the quotation validity (BD-36): not configured, refused when invalid, audited when set', async () => {
      const listed = await as(VIEWER)
        .get('/api/v1/settings/sales.quotationValidityDays')
        .expect(200);
      expect(listed.body).toMatchObject({ value: null, configured: false, decision: 'BD-36' });
      for (const value of [0, 366, 2.5, '30']) {
        await put(
          'sales.quotationValidityDays',
          { value, expectedVersion: 0, reason: 'invalid value' },
          ADMIN,
        ).expect(400);
      }
      await put(
        'sales.quotationValidityDays',
        { value: 30, expectedVersion: 0, reason: 'a configured validity' },
        VIEWER,
      ).expect(403);
      const saved = await put(
        'sales.quotationValidityDays',
        { value: 30, expectedVersion: 0, reason: 'client decision' },
        ADMIN,
      ).expect(200);
      expect(saved.body).toMatchObject({ value: 30, configured: true, version: 1 });
      const history = await as(VIEWER)
        .get('/api/v1/settings/sales.quotationValidityDays/history')
        .expect(200);
      expect(history.body.items[0]).toMatchObject({ value: 30, reason: 'client decision' });
    });

    it('needs settings.view to read and settings.manage to change', async () => {
      await as().get('/api/v1/settings').expect(401);
      await as(MEMBER).get('/api/v1/settings').expect(403);
      await put(
        'display.dateFormat',
        { value: 'yyyy-MM-dd', expectedVersion: 0, reason: 'r' },
        VIEWER,
      ).expect(403);
      expect(await connection.collection(SETTING_VALUES_COLLECTION).countDocuments()).toBe(0);
    });
  });

  /* ============================================================ PLAT-025 */

  describe('reference data', () => {
    it('serves a bound list with every product code and its bilingual label', async () => {
      const res = await as(MEMBER).get('/api/v1/reference-data/leadSources').expect(200);
      const codes = (res.body.items as { code: string }[]).map((item) => item.code);
      expect(codes).toContain('facebook');
      expect(res.body.bound).toBe(true);
      const facebook = (
        res.body.items as { code: string; label: { ar: string; en: string } }[]
      ).find((item) => item.code === 'facebook');
      expect(facebook?.label.en).not.toBe('facebook');
      expect(facebook?.label.ar).toMatch(/[؀-ۿ]|Facebook/);
    });

    it('relabels a bound code without changing it, and refuses to add or recode one', async () => {
      const relabelled = await as(ADMIN)
        .patch('/api/v1/reference-data/unitTypes/villa')
        .send({ label: label('Standalone villa'), expectedVersion: 0 })
        .expect(200);
      expect(relabelled.body).toMatchObject({
        code: 'villa',
        label: { en: 'Standalone villa' },
        version: 1,
      });
      await as(ADMIN)
        .post('/api/v1/reference-data/unitTypes')
        .send({ code: 'castle', label: label('Castle') })
        .expect(409);
      await as(ADMIN)
        .patch('/api/v1/reference-data/unitTypes/castle')
        .send({ label: label('Castle'), expectedVersion: 0 })
        .expect(404);
      await as(ADMIN)
        .patch('/api/v1/reference-data/unitTypes/villa')
        .send({ code: 'VILLA', expectedVersion: 1 })
        .expect(400);
    });

    it('keeps the pipeline-stage list complete: no stage may be withdrawn', async () => {
      const refused = await as(ADMIN)
        .post('/api/v1/reference-data/pipelineStages/new/deactivate')
        .send({ reason: 'not used' })
        .expect(409);
      expect(refused.body.error.issues).toEqual([{ path: ['code'], code: 'ITEM_LOCKED' }]);
    });

    it('extends an open list, withdraws an item from new use, and shows retired items only to administrators', async () => {
      await as(ADMIN)
        .post('/api/v1/reference-data/lossReasons')
        .send({ code: 'PRICE', label: label('Price too high'), sortOrder: 10 })
        .expect(201);
      await as(ADMIN)
        .post('/api/v1/reference-data/lossReasons')
        .send({ code: 'PRICE', label: label('Duplicate') })
        .expect(409);
      await as(ADMIN)
        .post('/api/v1/reference-data/lossReasons/PRICE/deactivate')
        .send({ reason: 'merged into another reason' })
        .expect(200);
      const visible = await as(MEMBER).get('/api/v1/reference-data/lossReasons').expect(200);
      expect(visible.body.items).toEqual([]);
      await as(MEMBER).get('/api/v1/reference-data/lossReasons?includeInactive=true').expect(403);
      const all = await as(ADMIN)
        .get('/api/v1/reference-data/lossReasons?includeInactive=true')
        .expect(200);
      expect(all.body.items).toEqual([expect.objectContaining({ code: 'PRICE', active: false })]);
      // Still stored: a lost lead recorded against PRICE keeps its meaning.
      expect(
        await connection.collection(REFERENCE_ITEMS_COLLECTION).countDocuments({ code: 'PRICE' }),
      ).toBe(1);
    });

    it('refuses a label in one language only, and a stale version', async () => {
      await as(ADMIN)
        .post('/api/v1/reference-data/lossReasons')
        .send({ code: 'TIMING', label: { en: 'Timing' } })
        .expect(400);
      await as(ADMIN)
        .post('/api/v1/reference-data/lossReasons')
        .send({ code: 'TIMING', label: label('Timing') })
        .expect(201);
      await as(ADMIN)
        .patch('/api/v1/reference-data/lossReasons/TIMING')
        .send({ label: label('Bad timing'), expectedVersion: 1 })
        .expect(200);
      await as(ADMIN)
        .patch('/api/v1/reference-data/lossReasons/TIMING')
        .send({ label: label('Stale'), expectedVersion: 1 })
        .expect(409);
    });

    it('adds tax rates forward only, and answers the rate in force on a date', async () => {
      await as(ADMIN)
        .post('/api/v1/reference-data/taxCodes')
        .send({ code: 'VAT', label: label('Value added tax') })
        .expect(201);
      await as(ADMIN)
        .post('/api/v1/reference-data/taxCodes/VAT/rates')
        .send({ ratePercent: '14', effectiveFrom: '2026-01-01' })
        .expect(200);
      await as(ADMIN)
        .post('/api/v1/reference-data/taxCodes/VAT/rates')
        .send({ ratePercent: '15.5', effectiveFrom: '2027-01-01' })
        .expect(200);
      const backdated = await as(ADMIN)
        .post('/api/v1/reference-data/taxCodes/VAT/rates')
        .send({ ratePercent: '10', effectiveFrom: '2026-06-01' })
        .expect(409);
      expect(backdated.body.error.issues).toEqual([
        { path: ['effectiveFrom'], code: 'RATE_NOT_FORWARD' },
      ]);
      for (const ratePercent of ['-1', '100.01', '1e2', 'abc']) {
        await as(ADMIN)
          .post('/api/v1/reference-data/taxCodes/VAT/rates')
          .send({ ratePercent, effectiveFrom: '2028-01-01' })
          .expect(400);
      }
      expect(await settings.effectiveTaxRate('VAT', '2025-12-31' as never)).toBeUndefined();
      expect(await settings.effectiveTaxRate('VAT', '2026-07-01' as never)).toBe('14');
      expect(await settings.effectiveTaxRate('VAT', '2027-01-01' as never)).toBe('15.5');
    });

    it('needs authentication to read and the manage permission to change', async () => {
      await as().get('/api/v1/reference-data/leadSources').expect(401);
      await as(MEMBER)
        .post('/api/v1/reference-data/lossReasons')
        .send({ code: 'X', label: label('X') })
        .expect(403);
      await as(VIEWER)
        .patch('/api/v1/reference-data/unitTypes/villa')
        .send({ label: label('V'), expectedVersion: 0 })
        .expect(403);
      await as(ADMIN).get('/api/v1/reference-data/notAList').expect(400);
      expect(await connection.collection(REFERENCE_ITEMS_COLLECTION).countDocuments()).toBe(0);
    });
  });
});
