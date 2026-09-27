import { ScopeAssignmentSchema, type ActorContext, type Permission } from '@alola/contracts';
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
import { withTransaction } from '../../platform/transactions';
import { AUDIT_COLLECTION, AuditService } from '../audit';
import {
  ACCOUNT_GRANTS_COLLECTION,
  ROLES_COLLECTION,
  SecurityService,
  bootstrapGrant,
  bootstrapRole,
} from '../security';
import {
  ISSUED_NUMBERS_COLLECTION,
  NUMBER_COUNTERS_COLLECTION,
  NUMBER_SEQUENCES_COLLECTION,
  NumberingService,
  issuedNumberModel,
  numberingRouter,
} from './index';

/**
 * Number sequences against a real MongoDB replica set (CORE-DOC-001).
 *
 * The properties an auditor checks first: numbers are gapless and never duplicated under concurrency,
 * a replayed request gets the same number, a cancelled document's number is never reissued, a failed
 * document leaves no hole, and no format change can produce a number that already exists.
 */
const gate = serviceGate(['mongodb']);
const RUN = `it-numbering-${Date.now()}`;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const ACCOUNT_HEADER = 'x-test-account';

const receiptFormat = {
  type: 'receipt',
  prefix: 'RCT',
  separator: '-',
  dateComponent: 'yyyy',
  branchComponent: true,
  projectComponent: false,
  padding: 5,
  resetPolicy: 'yearly',
  startAt: 1,
  effectiveFrom: '2026-01-01',
} as const;

describe.skipIf(!gate.available)(`number sequences — ${gate.reason}`, () => {
  let connection: Connection;
  let security: SecurityService;
  let numbering: NumberingService;
  let app: Express;
  let fiscalMonth: number | null = null;
  let admin: ActorContext;

  const ADMIN = `${RUN}-admin`;
  const VIEWER = `${RUN}-viewer`;
  const context = { correlationId: `${RUN}-context` };

  const as = (accountId: string) => ({
    get: (path: string) => request(app).get(path).set(ACCOUNT_HEADER, accountId),
    post: (path: string) =>
      request(app).post(path).set(ACCOUNT_HEADER, accountId).set('Origin', ALLOWED_ORIGIN),
    patch: (path: string) =>
      request(app).patch(path).set(ACCOUNT_HEADER, accountId).set('Origin', ALLOWED_ORIGIN),
  });

  let keyCounter = 0;
  const key = () => {
    keyCounter += 1;
    return `${RUN}-key-${keyCounter}`;
  };
  const issue = (overrides: Record<string, unknown> = {}) =>
    numbering.issue({ accountId: ADMIN }, {
      type: 'receipt',
      issueDate: '2026-09-27' as never,
      branchCode: 'CAI',
      idempotencyKey: key(),
      source: { type: 'receipt', id: key() },
      ...overrides,
    } as never);

  async function activeFormat(format: Record<string, unknown> = receiptFormat) {
    const created = await as(ADMIN).post('/api/v1/numbering/sequences').send(format);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const body = created.body as { type: string; version: number };
    await as(ADMIN)
      .post(`/api/v1/numbering/sequences/${body.type}/versions/${body.version}/activate`)
      .send({ reason: 'test format' })
      .expect(200);
    return body;
  }

  beforeAll(async () => {
    configureMongoose();
    const logger = createLogger({ name: 'it-numbering', level: 'silent' });
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'] as string,
    });
    await connection.asPromise();
    await ensureIndexes(connection, logger);
    const audit = new AuditService({ connection, logger, onRecorded: noteAuditWrite });
    security = new SecurityService({ connection, audit, logger });
    numbering = new NumberingService({
      connection,
      audit,
      fiscalYearStartMonth: () => Promise.resolve(fiscalMonth),
    });

    const all = ScopeAssignmentSchema.parse({ level: 'all' });
    const grant = async (accountId: string, permissions: Permission[]) => {
      await bootstrapRole(connection, {
        key: `${accountId}-role`,
        name: { ar: 'د', en: 'r' },
        permissions,
      });
      await bootstrapGrant(connection, {
        accountId,
        roleKeys: [`${accountId}-role`],
        scope: all,
        updatedBy: 'test',
      });
    };
    await grant(ADMIN, ['numbering.view', 'numbering.manage']);
    await grant(VIEWER, ['numbering.view']);
    const resolved = await security.resolveActor(ADMIN);
    if (!resolved) throw new Error('no admin actor');
    admin = resolved;

    const actorResolver: ActorResolver = async (req) => {
      const accountId = req.get(ACCOUNT_HEADER);
      return accountId ? security.resolveActor(accountId) : undefined;
    };
    const modules: ApiModule[] = [
      { basePath: '/numbering', router: numberingRouter({ getService: () => numbering }) },
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
    fiscalMonth = null;
    for (const name of [
      NUMBER_SEQUENCES_COLLECTION,
      NUMBER_COUNTERS_COLLECTION,
      ISSUED_NUMBERS_COLLECTION,
    ]) {
      await connection.collection(name).deleteMany({});
    }
  });

  afterAll(async () => {
    if (!connection) return;
    for (const name of [
      NUMBER_SEQUENCES_COLLECTION,
      NUMBER_COUNTERS_COLLECTION,
      ISSUED_NUMBERS_COLLECTION,
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

  it('defines, activates, previews and issues in the configured format', async () => {
    const created = await as(ADMIN)
      .post('/api/v1/numbering/sequences')
      .send(receiptFormat)
      .expect(201);
    expect(created.body).toMatchObject({ state: 'draft', example: 'RCT-BR-2026-00001' });
    await as(ADMIN)
      .post('/api/v1/numbering/preview')
      .send({ type: 'receipt', issueDate: '2026-09-27', branchCode: 'CAI' })
      .expect(409);
    await as(ADMIN)
      .post(`/api/v1/numbering/sequences/receipt/versions/${created.body.version}/activate`)
      .send({ reason: 'first receipt format' })
      .expect(200);
    const preview = await as(VIEWER)
      .post('/api/v1/numbering/preview')
      .send({ type: 'receipt', issueDate: '2026-09-27', branchCode: 'CAI' })
      .expect(200);
    expect(preview.body.next).toBe('RCT-CAI-2026-00001');
    expect((await issue()).number).toBe('RCT-CAI-2026-00001');
    expect((await issue()).number).toBe('RCT-CAI-2026-00002');
  });

  it('issues gapless, distinct numbers under concurrency', async () => {
    await activeFormat();
    const issued = await Promise.all(Array.from({ length: 25 }, () => issue()));
    const values = issued
      .map((entry) => Number(entry.number.split('-').at(-1)))
      .sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: 25 }, (_, index) => index + 1));
    const counter = await connection
      .collection(NUMBER_COUNTERS_COLLECTION)
      .findOne({ type: 'receipt' });
    expect(counter?.['issued']).toBe(25);
  });

  it('answers a replay with the same number, and a conflicting replay with a conflict', async () => {
    await activeFormat();
    const request = {
      type: 'receipt',
      issueDate: '2026-09-27',
      branchCode: 'CAI',
      idempotencyKey: `${RUN}-replayed`,
      source: { type: 'receipt', id: 'rct_1' },
    };
    const first = await numbering.issue({ accountId: ADMIN }, request as never);
    const again = await numbering.issue({ accountId: ADMIN }, request as never);
    expect(again.number).toBe(first.number);
    await expect(
      numbering.issue({ accountId: ADMIN }, {
        ...request,
        source: { type: 'receipt', id: 'rct_2' },
      } as never),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const [parallelA, parallelB] = await Promise.all([
      numbering.issue({ accountId: ADMIN }, {
        ...request,
        idempotencyKey: `${RUN}-parallel`,
      } as never),
      numbering.issue({ accountId: ADMIN }, {
        ...request,
        idempotencyKey: `${RUN}-parallel`,
      } as never),
    ]);
    expect(parallelA.number).toBe(parallelB.number);
    expect(await connection.collection(ISSUED_NUMBERS_COLLECTION).countDocuments()).toBe(2);
  });

  it('never reissues a voided number', async () => {
    await activeFormat();
    const first = await issue();
    await numbering.voidNumber(admin, 'receipt', first.number, 'receipt cancelled', context);
    await expect(
      numbering.voidNumber(admin, 'receipt', first.number, 'again', context),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const next = await issue();
    expect(next.number).toBe('RCT-CAI-2026-00002');
    const voided = await connection
      .collection(ISSUED_NUMBERS_COLLECTION)
      .findOne({ number: first.number });
    expect(voided).toMatchObject({ state: 'voided', voidReason: 'receipt cancelled' });
    await expect(
      issuedNumberModel(connection).deleteOne({ number: first.number }),
    ).rejects.toThrow();
  });

  it('numbers each branch and each year separately', async () => {
    await activeFormat();
    expect((await issue()).number).toBe('RCT-CAI-2026-00001');
    expect((await issue({ branchCode: 'ALX' })).number).toBe('RCT-ALX-2026-00001');
    expect((await issue({ issueDate: '2027-01-02' })).number).toBe('RCT-CAI-2027-00001');
    expect((await issue()).number).toBe('RCT-CAI-2026-00002');
    await expect(issue({ branchCode: undefined })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('numbers each legal entity separately when the format carries the entity', async () => {
    await activeFormat({
      ...receiptFormat,
      type: 'contract',
      prefix: 'CTR',
      entityComponent: true,
      branchComponent: false,
    });
    const first = await issue({ type: 'contract', entityCode: 'LEA', branchCode: undefined });
    const second = await issue({ type: 'contract', entityCode: 'LEB', branchCode: undefined });
    const third = await issue({ type: 'contract', entityCode: 'LEA', branchCode: undefined });
    expect([first.number, second.number, third.number]).toEqual([
      'CTR-LEA-2026-00001',
      'CTR-LEB-2026-00001',
      'CTR-LEA-2026-00002',
    ]);
    await expect(issue({ type: 'contract', branchCode: undefined })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('leaves no gap when the document issuing the number fails', async () => {
    await activeFormat();
    await expect(
      withTransaction(connection, async (session) => {
        await numbering.issue(
          { accountId: ADMIN },
          {
            type: 'receipt',
            issueDate: '2026-09-27' as never,
            branchCode: 'CAI',
            idempotencyKey: key(),
            source: { type: 'receipt', id: 'failed' },
          },
          session,
        );
        throw new Error('the receipt could not be saved');
      }),
    ).rejects.toThrow('the receipt could not be saved');
    expect(await connection.collection(ISSUED_NUMBERS_COLLECTION).countDocuments()).toBe(0);
    expect((await issue()).number).toBe('RCT-CAI-2026-00001');
  });

  it('refuses a fiscal-year format until the fiscal year is configured, then follows it', async () => {
    await activeFormat({
      ...receiptFormat,
      type: 'invoice',
      prefix: 'INV',
      branchComponent: false,
      dateComponent: 'fiscalYear',
      resetPolicy: 'fiscalYearly',
    });
    const refused = await as(ADMIN)
      .post('/api/v1/numbering/preview')
      .send({ type: 'invoice', issueDate: '2026-09-27' })
      .expect(409);
    expect(refused.body.error.issues).toEqual([
      { path: ['type'], code: 'FISCAL_YEAR_NOT_CONFIGURED' },
    ]);
    fiscalMonth = 7;
    expect(
      (await issue({ type: 'invoice', issueDate: '2026-06-30', branchCode: undefined })).number,
    ).toBe('INV-2025-00001');
    expect(
      (await issue({ type: 'invoice', issueDate: '2026-07-01', branchCode: undefined })).number,
    ).toBe('INV-2026-00001');
  });

  it('continues the series across a format change, and refuses one that would collide', async () => {
    const never = {
      ...receiptFormat,
      type: 'payment',
      prefix: 'PAY',
      branchComponent: false,
      dateComponent: 'none',
      resetPolicy: 'never',
      startAt: 100,
    };
    await activeFormat(never);
    expect((await issue({ type: 'payment', branchCode: undefined })).number).toBe('PAY-00100');
    // A new format with a lower start would produce PAY-00100 again.
    await activeFormat({ ...never, startAt: 99 });
    await expect(issue({ type: 'payment', branchCode: undefined })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    // Nothing was consumed by the refusal.
    const counter = await connection
      .collection(NUMBER_COUNTERS_COLLECTION)
      .findOne({ type: 'payment' });
    expect(counter?.['issued']).toBe(1);
    expect(
      await connection.collection(ISSUED_NUMBERS_COLLECTION).countDocuments({ type: 'payment' }),
    ).toBe(1);
  });

  it('refuses a reset the number cannot show, edits only drafts, and activates one format at a time', async () => {
    const invisible = await as(ADMIN)
      .post('/api/v1/numbering/sequences')
      .send({ ...receiptFormat, dateComponent: 'none' })
      .expect(400);
    expect(invisible.body.error.issues).toEqual([
      { path: ['body', 'dateComponent'], code: 'RESET_WITHOUT_DATE_COMPONENT' },
    ]);
    const active = await activeFormat();
    await as(ADMIN)
      .patch(`/api/v1/numbering/sequences/receipt/versions/${active.version}`)
      .send({ ...receiptFormat, prefix: 'REC' })
      .expect(400);
    const { type: _type, ...format } = receiptFormat;
    await as(ADMIN)
      .patch(`/api/v1/numbering/sequences/receipt/versions/${active.version}`)
      .send({ ...format, prefix: 'REC' })
      .expect(409);
    const drafts = await Promise.all(
      [1, 2].map(() => as(ADMIN).post('/api/v1/numbering/sequences').send(receiptFormat)),
    );
    const versions = drafts.map((res) => (res.body as { version: number }).version);
    const activations = await Promise.all(
      versions.map((version) =>
        as(ADMIN)
          .post(`/api/v1/numbering/sequences/receipt/versions/${version}/activate`)
          .send({ reason: 'race' }),
      ),
    );
    expect(activations.map((res) => res.status).sort()).toContain(200);
    expect(
      await connection
        .collection(NUMBER_SEQUENCES_COLLECTION)
        .countDocuments({ type: 'receipt', state: 'active' }),
    ).toBe(1);
  });

  it('offers no route that issues a number, and guards administration', async () => {
    await activeFormat();
    await as(ADMIN).post('/api/v1/numbering/issue').send({}).expect(404);
    await as(VIEWER).post('/api/v1/numbering/sequences').send(receiptFormat).expect(403);
    await as(VIEWER).get('/api/v1/numbering/issued').expect(200);
    const unknown = await as(ADMIN)
      .post('/api/v1/numbering/sequences')
      .send({ ...receiptFormat, prefix: 'rct lower' })
      .expect(400);
    expect(unknown.body.error.code).toBe('VALIDATION_FAILED');
  });
});
