import { ScopeAssignmentSchema, type Permission } from '@alola/contracts';
import { DevKeyEncryptor, UnconfiguredEncryptor, createLogger } from '@alola/security';
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
  INTEGRATION_CONNECTIONS_COLLECTION,
  INTEGRATION_OUTBOX_COLLECTION,
  IntegrationService,
  RetryableIntegrationError,
  WEBHOOK_INBOX_COLLECTION,
  integrationRouter,
  signHmacSha256,
  verifyHmacSha256,
  webhookRouter,
  type IntegrationAdapter,
} from './index';

/**
 * The integration foundation against a real MongoDB replica set (INTEGRATION-001 … 005).
 *
 * A fake SMS adapter stands in for a provider: it exercises every seam an adapter plugs into and
 * connects to nothing. The properties that matter: a secret never leaves the server or reaches the
 * database in plain text, an unsigned webhook changes nothing, and a provider event or an outbound
 * operation takes effect once however often it arrives or is retried.
 */
const gate = serviceGate(['mongodb']);
const RUN = `g${Date.now()}`;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const ACCOUNT_HEADER = 'x-test-account';
const SECRET = `whsec-${RUN}-do-not-log`;
const TOKEN = `token-${RUN}-do-not-store-plain`;
const label = (en: string) => ({ ar: `عربي ${en}`, en });

describe.skipIf(!gate.available)(`integration foundation — ${gate.reason}`, () => {
  let connection: Connection;
  let security: SecurityService;
  let service: IntegrationService;
  let audit: AuditService;
  let app: Express;
  let clock: Date;
  let checkResult: { ok: boolean; errorCode?: string; tokenValidUntil?: Date };
  let processScript: (call: number) => 'ok' | 'fail';
  let performScript: (call: number) => 'ok' | 'retry';
  const processed: string[] = [];
  const performedKeys: string[] = [];

  const ADMIN = `acc_${RUN}admin`;
  const VIEWER = `acc_${RUN}viewer`;

  const adapter: IntegrationAdapter = {
    provider: 'sms',
    apiVersion: '2026-09-01',
    credentialNames: ['apiToken', 'webhookSecret'],
    staleAfterMinutes: 60,
    check: () => Promise.resolve(checkResult),
    webhook: {
      verify: (rawBody, headers, credentials, now) => {
        const ok = verifyHmacSha256({
          rawBody,
          signature: headers['x-signature'],
          timestamp: headers['x-timestamp'],
          secret: credentials['webhookSecret'],
          now,
        });
        if (!ok) return undefined;
        const parsed = JSON.parse(rawBody.toString('utf8')) as { id: string; type: string };
        return { providerEventId: parsed.id, eventType: parsed.type, payload: parsed };
      },
      process: (event) => {
        processed.push(event.providerEventId);
        return processScript(processed.length) === 'ok'
          ? Promise.resolve()
          : Promise.reject(new RetryableIntegrationError('PROVIDER_BUSY'));
      },
    },
    perform: (_operation, _payload, key) => {
      performedKeys.push(key);
      return performScript(performedKeys.length) === 'ok'
        ? Promise.resolve({ providerReference: `ref-${key}` })
        : Promise.reject(new RetryableIntegrationError('RATE_LIMITED'));
    },
  };

  const as = (accountId: string) => ({
    get: (path: string) => request(app).get(path).set(ACCOUNT_HEADER, accountId),
    post: (path: string, body: object = {}) =>
      request(app)
        .post(path)
        .set(ACCOUNT_HEADER, accountId)
        .set('Origin', ALLOWED_ORIGIN)
        .send(body),
    put: (path: string, body: object) =>
      request(app)
        .put(path)
        .set(ACCOUNT_HEADER, accountId)
        .set('Origin', ALLOWED_ORIGIN)
        .send(body),
  });
  const configure = (expectedVersion = 0) =>
    as(ADMIN).put('/api/v1/integrations/sms/credentials', {
      expectedVersion,
      credentials: { apiToken: TOKEN, webhookSecret: SECRET },
      scopes: ['messages:send'],
    });
  const deliver = (
    event: { id: string; type: string },
    options: { secret?: string; at?: Date; tamper?: boolean } = {},
  ) => {
    const body = Buffer.from(JSON.stringify(event));
    const timestamp = String(Math.floor((options.at ?? clock).getTime() / 1000));
    const signature = signHmacSha256(body, timestamp, options.secret ?? SECRET);
    const sent = options.tamper
      ? Buffer.from(JSON.stringify({ ...event, type: 'tampered' }))
      : body;
    return request(app)
      .post('/api/v1/webhooks/sms')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .set('X-Timestamp', timestamp)
      .send(sent.toString('utf8'));
  };
  const inbox = () => connection.collection(WEBHOOK_INBOX_COLLECTION);
  const sweep = () => as(ADMIN).post('/api/v1/integrations/sweep').expect(200);

  beforeAll(async () => {
    configureMongoose();
    const logger = createLogger({ name: 'it-integrations', level: 'silent' });
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'] as string,
    });
    await connection.asPromise();
    await ensureIndexes(connection, logger);
    audit = new AuditService({ connection, logger, onRecorded: noteAuditWrite });
    security = new SecurityService({ connection, audit, logger });
    service = new IntegrationService({
      connection,
      audit,
      encryptor: new DevKeyEncryptor('test', Buffer.alloc(32, 9).toString('base64')),
      adapters: [adapter],
      logger,
      now: () => clock,
    });
    const grant = async (accountId: string, permissions: Permission[]) => {
      await bootstrapRole(connection, {
        key: `${RUN}-${accountId}`,
        name: label('r'),
        permissions,
      });
      await bootstrapGrant(connection, {
        accountId,
        roleKeys: [`${RUN}-${accountId}`],
        scope: ScopeAssignmentSchema.parse({ level: 'all' }),
        updatedBy: 'test',
      });
    };
    await grant(ADMIN, ['integration.view', 'integration.manage', 'integration.process']);
    await grant(VIEWER, ['integration.view']);
    const actorResolver: ActorResolver = async (req) => {
      const accountId = req.get(ACCOUNT_HEADER);
      return accountId ? security.resolveActor(accountId) : undefined;
    };
    const modules: ApiModule[] = [
      { basePath: '/integrations', router: integrationRouter({ getService: () => service }) },
      { basePath: '/webhooks', router: webhookRouter({ getService: () => service }) },
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
    clock = new Date();
    checkResult = { ok: true };
    processScript = () => 'ok';
    performScript = () => 'ok';
    processed.length = 0;
    performedKeys.length = 0;
    for (const name of [
      INTEGRATION_CONNECTIONS_COLLECTION,
      WEBHOOK_INBOX_COLLECTION,
      INTEGRATION_OUTBOX_COLLECTION,
    ]) {
      await connection.collection(name).deleteMany({});
    }
  });

  afterAll(async () => {
    if (!connection) return;
    for (const name of [
      INTEGRATION_CONNECTIONS_COLLECTION,
      WEBHOOK_INBOX_COLLECTION,
      INTEGRATION_OUTBOX_COLLECTION,
    ]) {
      await connection.collection(name).deleteMany({});
    }
    await connection.collection(ROLES_COLLECTION).deleteMany({ key: { $regex: `^${RUN}` } });
    await connection
      .collection(ACCOUNT_GRANTS_COLLECTION)
      .deleteMany({ accountId: { $regex: `^acc_${RUN}` } });
    await connection.collection(AUDIT_COLLECTION).deleteMany({ 'target.type': 'integration' });
    await connection.collection(AUDIT_COLLECTION).deleteMany({ 'target.type': 'webhookEvent' });
    await connection.close();
  });

  /* ======================================================= INTEGRATION-001 */

  describe('registry with encrypted configuration (INTEGRATION-001)', () => {
    it('lists every provider, and says honestly which have no adapter', async () => {
      const list = await as(VIEWER).get('/api/v1/integrations').expect(200);
      const states = Object.fromEntries(
        (list.body.items as { provider: string; state: string }[]).map((row) => [
          row.provider,
          row.state,
        ]),
      );
      expect(states).toMatchObject({
        sms: 'notConfigured',
        whatsapp: 'noAdapter',
        email: 'noAdapter',
      });
      expect(Object.keys(states)).toHaveLength(9);
    });

    it('stores credentials encrypted, returns none, and audits their names only', async () => {
      await as(VIEWER)
        .put('/api/v1/integrations/sms/credentials', {
          expectedVersion: 0,
          credentials: { apiToken: TOKEN, webhookSecret: SECRET },
        })
        .expect(403);
      const stored = await configure().expect(200);
      expect(stored.body).toMatchObject({
        state: 'configured',
        hasCredentials: true,
        recordedApiVersion: '2026-09-01',
        scopes: ['messages:send'],
        version: 1,
      });
      const everything = JSON.stringify(stored.body);
      expect(everything).not.toContain(TOKEN);
      expect(everything).not.toContain('ciphertext');

      const raw = await connection.collection(INTEGRATION_CONNECTIONS_COLLECTION).findOne({});
      expect(JSON.stringify(raw)).not.toContain(TOKEN);
      expect(JSON.stringify(raw)).not.toContain(SECRET);
      const evidence = await connection
        .collection(AUDIT_COLLECTION)
        .findOne({ action: 'integration.credentialsSet' }, { sort: { occurredAt: -1 } });
      expect(JSON.stringify(evidence)).not.toContain(TOKEN);
      expect(JSON.stringify(evidence)).toContain('apiToken,webhookSecret');

      // A stale version, or a first write racing an existing one, is a conflict.
      await configure(0).expect(409);
      await configure(1).expect(200);
    });

    it('refuses credentials an adapter does not declare, and missing ones', async () => {
      const unknown = await as(ADMIN)
        .put('/api/v1/integrations/sms/credentials', {
          expectedVersion: 0,
          credentials: { apiToken: 'x', webhookSecret: 'y', password: 'z' },
        })
        .expect(400);
      expect(unknown.body.error.issues[0].code).toBe('UNKNOWN_CREDENTIAL');
      const missing = await as(ADMIN)
        .put('/api/v1/integrations/sms/credentials', {
          expectedVersion: 0,
          credentials: { apiToken: 'x' },
        })
        .expect(400);
      expect(missing.body.error.issues[0].code).toBe('MISSING_CREDENTIAL');
      const noAdapter = await as(ADMIN)
        .put('/api/v1/integrations/whatsapp/credentials', {
          expectedVersion: 0,
          credentials: { token: 'x' },
        })
        .expect(409);
      expect(noAdapter.body.error.issues[0].code).toBe('NO_ADAPTER');
    });

    it('stores nothing when no encryption key is configured (SEC-033)', async () => {
      const unkeyed = new IntegrationService({
        connection,
        audit,
        encryptor: new UnconfiguredEncryptor(),
        adapters: [adapter],
      });
      const actor = await security.resolveActor(ADMIN);
      if (!actor) throw new Error('no actor');
      await expect(
        unkeyed.setCredentials(
          actor,
          'sms',
          { expectedVersion: 0, credentials: { apiToken: 'x', webhookSecret: 'y' }, scopes: [] },
          { correlationId: 'test' },
        ),
      ).rejects.toMatchObject({ code: 'SERVICE_NOT_CONFIGURED' });
      expect(await connection.collection(INTEGRATION_CONNECTIONS_COLLECTION).countDocuments()).toBe(
        0,
      );
    });
  });

  /* ============================================= INTEGRATION-002 / 003 */

  describe('pinned version and health (INTEGRATION-002, INTEGRATION-003)', () => {
    it('reports a recorded version the running adapter no longer targets', async () => {
      await configure().expect(200);
      await connection
        .collection(INTEGRATION_CONNECTIONS_COLLECTION)
        .updateOne({ provider: 'sms' }, { $set: { recordedApiVersion: '2025-01-01' } });
      const read = await as(VIEWER).get('/api/v1/integrations/sms').expect(200);
      expect(read.body).toMatchObject({
        adapterApiVersion: '2026-09-01',
        recordedApiVersion: '2025-01-01',
        versionMismatch: true,
      });
    });

    it('records checks, errors, token validity and freshness', async () => {
      await configure().expect(200);
      checkResult = { ok: true, tokenValidUntil: new Date(clock.getTime() + 86_400_000) };
      const good = await as(ADMIN).post('/api/v1/integrations/sms/check').expect(200);
      expect(good.body.state).toBe('configured');
      expect(good.body.health.tokenValidUntil).toBeDefined();
      expect(good.body.health.freshness).toBe('unknown');

      checkResult = { ok: false, errorCode: 'TOKEN_EXPIRED' };
      const bad = await as(ADMIN).post('/api/v1/integrations/sms/check').expect(200);
      expect(bad.body).toMatchObject({
        state: 'error',
        health: { lastErrorCode: 'TOKEN_EXPIRED' },
      });

      await service.recordSync('sms', clock);
      expect(
        (await as(VIEWER).get('/api/v1/integrations/sms').expect(200)).body.health.freshness,
      ).toBe('fresh');
      clock = new Date(clock.getTime() + 61 * 60_000);
      expect(
        (await as(VIEWER).get('/api/v1/integrations/sms').expect(200)).body.health.freshness,
      ).toBe('stale');
    });
  });

  /* ============================================= INTEGRATION-004 / 005 */

  describe('webhooks: signature first, each event once (INTEGRATION-004, INTEGRATION-005)', () => {
    it('refuses what it cannot verify and stores nothing', async () => {
      await configure().expect(200);
      await deliver({ id: 'evt_1', type: 'delivered' }, { secret: 'guessed' }).expect(401);
      await deliver({ id: 'evt_1', type: 'delivered' }, { tamper: true }).expect(401);
      await deliver(
        { id: 'evt_1', type: 'delivered' },
        { at: new Date(clock.getTime() - 10 * 60_000) },
      ).expect(401);
      await request(app)
        .post('/api/v1/webhooks/sms')
        .set('Content-Type', 'application/json')
        .send('{"id":"evt_1","type":"delivered"}')
        .expect(401);
      expect(await inbox().countDocuments()).toBe(0);
      expect(
        await connection
          .collection(AUDIT_COLLECTION)
          .countDocuments({ action: 'integration.webhookRejected', 'target.id': 'sms' }),
      ).toBeGreaterThanOrEqual(4);
    });

    it('accepts a signed event once, and acknowledges a repeat without storing it', async () => {
      await configure().expect(200);
      await deliver({ id: 'evt_2', type: 'delivered' }).expect(202);
      const again = await deliver({ id: 'evt_2', type: 'delivered' }).expect(200);
      expect(again.body).toEqual({ received: true, duplicate: true });
      expect(await inbox().countDocuments({ providerEventId: 'evt_2' })).toBe(1);
      // Processing is later, not inside the provider's request.
      expect(processed).toEqual([]);
    });

    it('has no endpoint for a provider without an adapter, credentials, or while disabled', async () => {
      await request(app).post('/api/v1/webhooks/whatsapp').send({ id: 'x' }).expect(404);
      await deliver({ id: 'evt_3', type: 'delivered' }).expect(404); // not configured yet
      await configure().expect(200);
      await as(ADMIN)
        .post('/api/v1/integrations/sms/disable', {
          expectedVersion: 1,
          reason: 'provider incident',
        })
        .expect(200);
      await deliver({ id: 'evt_3', type: 'delivered' }).expect(404);
      await as(ADMIN)
        .post('/api/v1/integrations/sms/enable', { expectedVersion: 2, reason: 'resolved' })
        .expect(200);
      await deliver({ id: 'evt_3', type: 'delivered' }).expect(202);
    });
  });

  /* =================================================== processing, outbox */

  describe('processing and the outbox', () => {
    it('processes each event once, however often the sweep runs', async () => {
      await configure().expect(200);
      await deliver({ id: 'evt_4', type: 'delivered' }).expect(202);
      await deliver({ id: 'evt_5', type: 'read' }).expect(202);
      const [first, second] = await Promise.all([sweep(), sweep()]);
      expect(first.body.webhooksProcessed + second.body.webhooksProcessed).toBe(2);
      expect((await sweep()).body.webhooksProcessed).toBe(0);
      expect(processed.sort()).toEqual(['evt_4', 'evt_5']);
      const row = await inbox().findOne({ providerEventId: 'evt_4' });
      expect(row).toMatchObject({ state: 'processed' });
      expect(row?.['purgeAfter']).toBeInstanceOf(Date);
    });

    it('retries a failing event with backoff and keeps it as failed after the last attempt', async () => {
      await configure().expect(200);
      processScript = () => 'fail';
      await deliver({ id: 'evt_6', type: 'delivered' }).expect(202);
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await sweep();
        clock = new Date(clock.getTime() + 2 * 3_600_000);
      }
      expect(await inbox().findOne({ providerEventId: 'evt_6' })).toMatchObject({
        state: 'failed',
        attempts: 5,
        lastErrorCode: 'PROVIDER_BUSY',
      });
      await sweep();
      expect(processed).toHaveLength(5);
    });

    it('records an outbound operation once, holds it without a connection, and sends with one key', async () => {
      const first = await service.enqueue({
        provider: 'sms',
        operation: 'send',
        payload: { to: 'synthetic' },
        idempotencyKey: `op-${RUN}-1`,
      });
      const again = await service.enqueue({
        provider: 'sms',
        operation: 'send',
        payload: { to: 'synthetic' },
        idempotencyKey: `op-${RUN}-1`,
      });
      expect(again).toEqual({ outboxId: first.outboxId, duplicate: true });

      // Not configured: held, nothing attempted.
      expect((await sweep()).body.outboxHeld).toBe(1);
      expect(performedKeys).toEqual([]);

      await configure().expect(200);
      performScript = (call) => (call === 1 ? 'retry' : 'ok');
      clock = new Date(clock.getTime() + 20 * 60_000);
      expect((await sweep()).body.outboxRetrying).toBe(1);
      clock = new Date(clock.getTime() + 2 * 3_600_000);
      expect((await sweep()).body.outboxSent).toBe(1);
      expect(performedKeys).toEqual([`op-${RUN}-1`, `op-${RUN}-1`]);
      expect(
        await connection
          .collection(INTEGRATION_OUTBOX_COLLECTION)
          .findOne({ idempotencyKey: `op-${RUN}-1` }),
      ).toMatchObject({ state: 'sent', attempts: 2, providerReference: `ref-op-${RUN}-1` });
    });

    it('lets only the process permission run the sweep', async () => {
      await as(VIEWER).post('/api/v1/integrations/sweep').expect(403);
    });
  });
});
