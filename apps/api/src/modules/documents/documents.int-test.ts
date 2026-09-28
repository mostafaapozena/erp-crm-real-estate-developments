import {
  ScopeAssignmentSchema,
  type ActorContext,
  type DocumentOwnerType,
  type Permission,
  type ScopeAssignment,
} from '@alola/contracts';
import { LocalDiskFileStore, createLogger, type ScanResult } from '@alola/security';
import { serviceGate } from '@alola/testing';
import type { Express } from 'express';
import mongoose, { type Connection } from 'mongoose';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  DOCUMENTS_COLLECTION,
  DOCUMENT_TEMPLATES_COLLECTION,
  DOCUMENT_VERSIONS_COLLECTION,
  DocumentService,
  TemplateService,
  documentModel,
  documentRouter,
  documentVersionModel,
  fileRouter,
  templateModel,
  templateRouter,
  type OwnerPlacement,
} from './index';

/**
 * Documents and templates against a real MongoDB replica set and a real disk (CORE-DOC-002, 004, 006).
 *
 * The owning records here are fixtures behind the same port production wires to the business
 * modules: a record is visible to an actor exactly when the actor's scope covers its branch. That is
 * the property under test — a document is exactly as visible as the record it belongs to.
 */
const gate = serviceGate(['mongodb']);
const RUN = `it-documents-${Date.now()}`;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const ACCOUNT_HEADER = 'x-test-account';
const BRANCH_A = 'br_docsbranchaaaaaaaaaaaaaaaaaaaaa1';
const BRANCH_B = 'br_docsbranchbbbbbbbbbbbbbbbbbbbbb2';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('fictional content only')]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const label = (en: string) => ({ ar: `عربي ${en}`, en });

/** The fixture records, as their owning modules would describe them. */
const RECORDS: Record<string, OwnerPlacement> = {
  'lead:lead_a': { legalEntityId: 'le_docs', branchId: BRANCH_A, ownerAccountId: `${RUN}-rep` },
  'lead:lead_b': { legalEntityId: 'le_docs', branchId: BRANCH_B },
  'contract:ctr_a': { legalEntityId: 'le_docs', branchId: BRANCH_A, projectId: 'prj_docs' },
};

describe.skipIf(!gate.available)(`documents and templates — ${gate.reason}`, () => {
  let connection: Connection;
  let security: SecurityService;
  let documents: DocumentService;
  let templates: TemplateService;
  let app: Express;
  let root: string;
  let store: LocalDiskFileStore;
  let clock: Date;
  let scanVerdict: ScanResult;

  const ADMIN = `${RUN}-admin`;
  const BRANCH_A_USER = `${RUN}-branch-a`;
  const BRANCH_B_USER = `${RUN}-branch-b`;
  const READER = `${RUN}-reader`;

  const as = (accountId: string) => ({
    get: (path: string) => request(app).get(path).set(ACCOUNT_HEADER, accountId),
    post: (path: string) =>
      request(app).post(path).set(ACCOUNT_HEADER, accountId).set('Origin', ALLOWED_ORIGIN),
    put: (path: string) =>
      request(app).put(path).set(ACCOUNT_HEADER, accountId).set('Origin', ALLOWED_ORIGIN),
  });

  const uploadPath = (owner: string, fileName = 'contract.pdf', category = 'ID-COPY') => {
    const [ownerType, ownerId] = owner.split(':');
    return `/api/v1/documents/uploads?ownerType=${ownerType}&ownerId=${ownerId}&category=${category}&title=${encodeURIComponent('Signed form')}&fileName=${encodeURIComponent(fileName)}`;
  };
  const upload = (
    actor: string,
    owner = 'lead:lead_a',
    body: Buffer = PDF,
    type = 'application/pdf',
    fileName?: string,
  ) => as(actor).post(uploadPath(owner, fileName)).set('Content-Type', type).send(body);

  const storedFiles = async (): Promise<number> => {
    const count = async (directory: string): Promise<number> => {
      let total = 0;
      for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
        total += entry.isDirectory() ? await count(join(directory, entry.name)) : 1;
      }
      return total;
    };
    return count(root);
  };

  beforeAll(async () => {
    configureMongoose();
    const logger = createLogger({ name: 'it-documents', level: 'silent' });
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'] as string,
    });
    await connection.asPromise();
    await ensureIndexes(connection, logger);
    const audit = new AuditService({ connection, logger, onRecorded: noteAuditWrite });
    security = new SecurityService({ connection, audit, logger });
    root = await mkdtemp(join(tmpdir(), 'alola-docs-'));
    clock = new Date();
    store = new LocalDiskFileStore('test', root, '/api/v1/files', () => clock);
    scanVerdict = { status: 'not_scanned' };

    const sees = (actor: ActorContext, placement: OwnerPlacement): boolean => {
      const scope: ScopeAssignment = actor.scope;
      if (scope.level === 'all') return true;
      if (scope.level === 'branch') return scope.branchIds.includes(placement.branchId ?? '');
      return false;
    };
    documents = new DocumentService({
      connection,
      audit,
      store,
      scanner: { scan: () => Promise.resolve(scanVerdict) },
      resolveOwner: (actor, type: DocumentOwnerType, id) => {
        const record = RECORDS[`${type}:${id}`];
        return Promise.resolve(record && sees(actor, record) ? record : undefined);
      },
      maxBytes: 10 * 1024 * 1024,
      now: () => clock,
    });
    templates = new TemplateService({ connection, audit });

    const grant = async (accountId: string, permissions: Permission[], scope: ScopeAssignment) => {
      await bootstrapRole(connection, { key: `${accountId}-role`, name: label('r'), permissions });
      await bootstrapGrant(connection, {
        accountId,
        roleKeys: [`${accountId}-role`],
        scope,
        updatedBy: 'test',
      });
    };
    const everything: Permission[] = [
      'document.view',
      'document.upload',
      'document.download',
      'document.archive',
      'document.manageRetention',
      'template.view',
      'template.manage',
    ];
    const worker: Permission[] = [
      'document.view',
      'document.upload',
      'document.download',
      'document.archive',
    ];
    await grant(ADMIN, everything, ScopeAssignmentSchema.parse({ level: 'all' }));
    await grant(
      BRANCH_A_USER,
      worker,
      ScopeAssignmentSchema.parse({ level: 'branch', branchIds: [BRANCH_A] }),
    );
    await grant(
      BRANCH_B_USER,
      worker,
      ScopeAssignmentSchema.parse({ level: 'branch', branchIds: [BRANCH_B] }),
    );
    await grant(
      READER,
      ['document.view', 'template.view'],
      ScopeAssignmentSchema.parse({ level: 'all' }),
    );

    const actorResolver: ActorResolver = async (req) => {
      const accountId = req.get(ACCOUNT_HEADER);
      return accountId ? security.resolveActor(accountId) : undefined;
    };
    const options = { getDocuments: () => documents, getTemplates: () => templates };
    const modules: ApiModule[] = [
      { basePath: '/documents', router: documentRouter(options) },
      { basePath: '/templates', router: templateRouter(options) },
      { basePath: '/files', router: fileRouter({ store }) },
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
    scanVerdict = { status: 'not_scanned' };
    for (const name of [
      DOCUMENTS_COLLECTION,
      DOCUMENT_VERSIONS_COLLECTION,
      DOCUMENT_TEMPLATES_COLLECTION,
    ]) {
      await connection.collection(name).deleteMany({});
    }
    await rm(root, { recursive: true, force: true });
  });

  afterAll(async () => {
    if (!connection) return;
    for (const name of [
      DOCUMENTS_COLLECTION,
      DOCUMENT_VERSIONS_COLLECTION,
      DOCUMENT_TEMPLATES_COLLECTION,
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
    await rm(root, { recursive: true, force: true });
  });

  /* ======================================================== upload and scope */

  describe('upload', () => {
    it('attaches a file to a record the actor can see, inheriting its scope', async () => {
      const res = await upload(BRANCH_A_USER).expect(201);
      expect(res.body).toMatchObject({
        owner: { type: 'lead', id: 'lead_a' },
        currentVersion: 1,
        state: 'active',
        versions: [
          {
            version: 1,
            fileName: 'contract.pdf',
            contentType: 'application/pdf',
            scanStatus: 'not_scanned',
          },
        ],
      });
      const stored = await connection
        .collection(DOCUMENTS_COLLECTION)
        .findOne({ documentId: res.body.documentId });
      expect(stored).toMatchObject({
        branchId: BRANCH_A,
        legalEntityId: 'le_docs',
        createdBy: BRANCH_A_USER,
      });
      expect(await storedFiles()).toBe(1);
    });

    it('answers 404 for a record outside the scope, storing no row and no file', async () => {
      const hidden = await upload(BRANCH_A_USER, 'lead:lead_b').expect(404);
      const absent = await upload(BRANCH_A_USER, 'lead:lead_zzz').expect(404);
      expect(Object.keys(hidden.body.error)).toEqual(Object.keys(absent.body.error));
      expect(await connection.collection(DOCUMENTS_COLLECTION).countDocuments()).toBe(0);
      expect(await storedFiles()).toBe(0);
    });

    it('decides the type by the bytes, and refuses everything outside the allow-list', async () => {
      const mismatch = await upload(ADMIN, 'lead:lead_a', PNG, 'application/pdf').expect(400);
      expect(mismatch.body.error.issues).toEqual([
        { path: ['file'], code: 'CONTENT_TYPE_MISMATCH' },
      ]);
      await upload(
        ADMIN,
        'lead:lead_a',
        Buffer.from('<html><script>x</script>'),
        'text/html',
      ).expect(400);
      await upload(
        ADMIN,
        'lead:lead_a',
        Buffer.from('MZ-executable'),
        'application/octet-stream',
      ).expect(400);
      await upload(ADMIN, 'lead:lead_a', Buffer.alloc(0), 'application/pdf').expect(400);
      await upload(
        ADMIN,
        'lead:lead_a',
        Buffer.concat([PDF, Buffer.alloc(11 * 1024 * 1024)]),
      ).expect(413);
      expect(await connection.collection(DOCUMENTS_COLLECTION).countDocuments()).toBe(0);
      expect(await storedFiles()).toBe(0);
    });

    it('sanitizes the file name — traversal, bidirectional tricks and a lying extension', async () => {
      const name = `../../secret/invoice${String.fromCharCode(0x202e)}fdp.exe`;
      const res = await upload(ADMIN, 'lead:lead_a', PDF, 'application/pdf', name).expect(201);
      expect(res.body.versions[0].fileName).toBe('invoicefdp.pdf');
      const key = (await connection.collection(DOCUMENT_VERSIONS_COLLECTION).findOne({}))?.[
        'storageKey'
      ];
      expect(String(key)).toMatch(/^documents\/doc_[0-9a-f]{32}\/v1-[0-9a-f]{16}$/);
    });

    it('refuses a file the scanner reports as infected, storing nothing and recording the refusal', async () => {
      scanVerdict = { status: 'infected', signature: 'EICAR-Test' };
      const res = await upload(ADMIN).expect(400);
      expect(res.body.error.issues).toEqual([{ path: ['file'], code: 'FILE_INFECTED' }]);
      expect(await storedFiles()).toBe(0);
      expect(
        await connection.collection(AUDIT_COLLECTION).countDocuments({
          action: 'document.quarantined',
          outcome: 'denied',
          'actor.accountId': ADMIN,
        }),
      ).toBeGreaterThanOrEqual(1);
    });

    it('refuses metadata it does not know and a malformed owner id', async () => {
      await as(ADMIN)
        .post(`${uploadPath('lead:lead_a')}&extra=1`)
        .set('Content-Type', 'application/pdf')
        .send(PDF)
        .expect(400);
      await as(ADMIN)
        .post(uploadPath('lead:lead_a').replace('ownerId=lead_a', 'ownerId=%7B%22%24ne%22%3A1%7D'))
        .set('Content-Type', 'application/pdf')
        .send(PDF)
        .expect(400);
      await as(READER)
        .post(uploadPath('lead:lead_a'))
        .set('Content-Type', 'application/pdf')
        .send(PDF)
        .expect(403);
    });
  });

  /* ============================================================ reads, versions */

  describe('reads and versions (CORE-DOC-004)', () => {
    it('lists and reads only inside the scope, with totals to match', async () => {
      const mine = (await upload(BRANCH_A_USER).expect(201)).body.documentId as string;
      await upload(ADMIN, 'lead:lead_b').expect(201);
      const a = await as(BRANCH_A_USER).get('/api/v1/documents').expect(200);
      expect((a.body.items as { documentId: string }[]).map((item) => item.documentId)).toEqual([
        mine,
      ]);
      const b = await as(BRANCH_B_USER)
        .get('/api/v1/documents?ownerType=lead&ownerId=lead_a')
        .expect(200);
      expect(b.body.items).toEqual([]);
      await as(BRANCH_B_USER).get(`/api/v1/documents/${mine}`).expect(404);
      expect((await as(ADMIN).get('/api/v1/documents').expect(200)).body.items).toHaveLength(2);
    });

    it('adds versions without overwriting, refusing a stale uploader', async () => {
      const id = (await upload(ADMIN).expect(201)).body.documentId as string;
      const v2 = await as(ADMIN)
        .post(`/api/v1/documents/${id}/versions?fileName=v2.png&expectedVersion=1`)
        .set('Content-Type', 'image/png')
        .send(PNG)
        .expect(201);
      expect(v2.body.currentVersion).toBe(2);
      expect((v2.body.versions as { version: number }[]).map((version) => version.version)).toEqual(
        [2, 1],
      );
      await as(ADMIN)
        .post(`/api/v1/documents/${id}/versions?fileName=late.pdf&expectedVersion=1`)
        .set('Content-Type', 'application/pdf')
        .send(PDF)
        .expect(409);
      const racing = await Promise.all(
        [1, 2].map(() =>
          as(ADMIN)
            .post(`/api/v1/documents/${id}/versions?fileName=race.pdf&expectedVersion=2`)
            .set('Content-Type', 'application/pdf')
            .send(PDF),
        ),
      );
      expect(racing.map((res) => res.status).sort()).toEqual([201, 409]);
      expect(
        await connection
          .collection(DOCUMENT_VERSIONS_COLLECTION)
          .countDocuments({ documentId: id }),
      ).toBe(3);
      await expect(
        documentVersionModel(connection).deleteMany({ documentId: id }),
      ).rejects.toThrow();
      await expect(documentModel(connection).deleteOne({ documentId: id })).rejects.toThrow();
    });
  });

  /* ======================================================= download (CORE-DOC-006) */

  describe('download and print', () => {
    it('records who obtained which version before handing out a short-lived link', async () => {
      const id = (await upload(BRANCH_A_USER).expect(201)).body.documentId as string;
      const link = await as(BRANCH_A_USER)
        .post(`/api/v1/documents/${id}/download`)
        .send({})
        .expect(200);
      expect(link.body).toMatchObject({
        fileName: 'contract.pdf',
        contentType: 'application/pdf',
        scanStatus: 'not_scanned',
      });
      const file = await request(app)
        .get(link.body.url as string)
        .expect(200);
      expect(file.headers['content-type']).toBe('application/pdf');
      expect(file.headers['content-disposition']).toContain('attachment');
      expect(file.headers['x-content-type-options']).toBe('nosniff');
      expect(file.headers['cache-control']).toBe('no-store');
      expect(Buffer.compare(file.body as Buffer, PDF)).toBe(0);

      await as(BRANCH_A_USER)
        .post(`/api/v1/documents/${id}/download`)
        .send({ purpose: 'print' })
        .expect(200);
      const events = await connection
        .collection(AUDIT_COLLECTION)
        .find({ 'target.id': id, action: { $in: ['document.downloaded', 'document.printed'] } })
        .toArray();
      expect(events.map((event) => String(event['action'])).sort()).toEqual([
        'document.downloaded',
        'document.printed',
      ]);
      expect(
        events.every(
          (event) => (event['actor'] as { accountId: string }).accountId === BRANCH_A_USER,
        ),
      ).toBe(true);
    });

    it('answers 404 outside the scope, and records no download that did not happen', async () => {
      const id = (await upload(ADMIN, 'lead:lead_b').expect(201)).body.documentId as string;
      await as(BRANCH_A_USER).post(`/api/v1/documents/${id}/download`).send({}).expect(404);
      expect(
        await connection
          .collection(AUDIT_COLLECTION)
          .countDocuments({ 'target.id': id, action: 'document.downloaded' }),
      ).toBe(0);
      await as(READER).post(`/api/v1/documents/${id}/download`).send({}).expect(403);
    });

    it('refuses a tampered or expired link', async () => {
      const id = (await upload(ADMIN).expect(201)).body.documentId as string;
      const url = (await as(ADMIN).post(`/api/v1/documents/${id}/download`).send({}).expect(200))
        .body.url as string;
      await request(app)
        .get(`${url.slice(0, -3)}abc`)
        .expect(404);
      await request(app).get('/api/v1/files/not-a-token-at-all').expect(404);
      clock = new Date(clock.getTime() + 10 * 60_000);
      await request(app).get(url).expect(404);
    });
  });

  /* ========================================================== archive, retention */

  describe('archive and retention', () => {
    it('withdraws a document from lists without deleting it', async () => {
      const id = (await upload(ADMIN).expect(201)).body.documentId as string;
      await as(ADMIN)
        .post(`/api/v1/documents/${id}/archive`)
        .send({ reason: 'superseded by a new scan' })
        .expect(200);
      await as(ADMIN).post(`/api/v1/documents/${id}/archive`).send({ reason: 'again' }).expect(409);
      expect((await as(ADMIN).get('/api/v1/documents').expect(200)).body.items).toEqual([]);
      expect(
        (await as(ADMIN).get('/api/v1/documents?includeArchived=true').expect(200)).body.items,
      ).toHaveLength(1);
      expect(await storedFiles()).toBe(1);
    });

    it('lets only an administrator set a legal hold', async () => {
      const id = (await upload(BRANCH_A_USER).expect(201)).body.documentId as string;
      await as(BRANCH_A_USER)
        .put(`/api/v1/documents/${id}/retention`)
        .send({ legalHold: true, reason: 'dispute' })
        .expect(403);
      const held = await as(ADMIN)
        .put(`/api/v1/documents/${id}/retention`)
        .send({ legalHold: true, retainUntil: '2036-12-31', reason: 'contract dispute' })
        .expect(200);
      expect(held.body).toMatchObject({ legalHold: true, retainUntil: '2036-12-31' });
    });
  });

  /* ================================================== templates (CORE-DOC-002) */

  describe('templates', () => {
    const draft = (overrides: Record<string, unknown> = {}) => ({
      templateKey: 'receipt-standard',
      kind: 'receipt',
      name: label('Standard receipt'),
      bodies: {
        ar: 'استلمنا من {{customer.name}} مبلغ {{receipt.amount}} — {{company.legalName}}',
        en: 'Received from {{customer.name}} the sum of {{receipt.amount}} — {{company.legalName}}',
      },
      effectiveFrom: '2026-01-01',
      ...overrides,
    });

    it('publishes a bilingual draft, after which it can never change', async () => {
      const created = await as(ADMIN).post('/api/v1/templates').send(draft()).expect(201);
      expect(created.body).toMatchObject({
        version: 1,
        state: 'draft',
        placeholders: ['customer.name', 'receipt.amount', 'company.legalName'],
      });
      await as(ADMIN)
        .put('/api/v1/templates/receipt-standard/versions/1')
        .send({ ...draft(), templateKey: undefined, kind: undefined, name: label('Renamed') })
        .expect(200);
      await as(ADMIN)
        .post('/api/v1/templates/receipt-standard/versions/1/publish')
        .send({ reason: 'approved' })
        .expect(200);
      await as(ADMIN)
        .put('/api/v1/templates/receipt-standard/versions/1')
        .send({
          name: label('Changed after use'),
          bodies: draft().bodies,
          effectiveFrom: '2026-01-01',
        })
        .expect(409);
      // The database refuses too, whatever code path tries.
      await expect(
        templateModel(connection).updateOne(
          { templateKey: 'receipt-standard', version: 1 },
          { $set: { 'bodies.en': 'silently changed' } },
        ),
      ).rejects.toThrow();
      const stored = await templates.getTemplate('receipt-standard', 1);
      expect(stored.bodies.en).toContain('Received from');
    });

    it('refuses an unknown placeholder, and placeholders that differ between languages', async () => {
      await as(ADMIN)
        .post('/api/v1/templates')
        .send(
          draft({
            templateKey: 'receipt-typo',
            bodies: { ar: 'مبلغ {{receipt.amout}}', en: 'Sum {{receipt.amout}}' },
          }),
        )
        .expect(201);
      const typo = await as(ADMIN)
        .post('/api/v1/templates/receipt-typo/versions/1/publish')
        .send({ reason: 'try' })
        .expect(400);
      expect(typo.body.error.issues).toEqual([
        { path: ['bodies', 'ar', 'receipt.amout'], code: 'UNKNOWN_PLACEHOLDER' },
      ]);
      await as(ADMIN)
        .post('/api/v1/templates')
        .send(
          draft({
            templateKey: 'receipt-mismatch',
            bodies: {
              ar: 'مبلغ {{receipt.amount}}',
              en: 'Sum {{receipt.amount}} for {{customer.name}}',
            },
          }),
        )
        .expect(201);
      const mismatch = await as(ADMIN)
        .post('/api/v1/templates/receipt-mismatch/versions/1/publish')
        .send({ reason: 'try' })
        .expect(400);
      expect(mismatch.body.error.issues).toEqual([
        { path: ['bodies'], code: 'PLACEHOLDERS_DIFFER_BY_LANGUAGE' },
      ]);
      // A placeholder of another kind is unknown here too.
      await as(ADMIN)
        .post('/api/v1/templates')
        .send(
          draft({
            templateKey: 'receipt-foreign',
            bodies: { ar: '{{contract.totalPrice}}', en: '{{contract.totalPrice}}' },
          }),
        )
        .expect(201);
      await as(ADMIN)
        .post('/api/v1/templates/receipt-foreign/versions/1/publish')
        .send({ reason: 'try' })
        .expect(400);
    });

    it('requires both languages, and keeps a key to one kind', async () => {
      await as(ADMIN)
        .post('/api/v1/templates')
        .send(draft({ bodies: { ar: 'نص' } }))
        .expect(400);
      await as(ADMIN).post('/api/v1/templates').send(draft()).expect(201);
      const mismatch = await as(ADMIN)
        .post('/api/v1/templates')
        .send(draft({ kind: 'invoice' }))
        .expect(409);
      expect(mismatch.body.error.issues).toEqual([
        { path: ['kind'], code: 'TEMPLATE_KIND_MISMATCH' },
      ]);
    });

    it('selects the most specific version in force, and previews with synthetic values only', async () => {
      const publish = async (key: string, overrides: Record<string, unknown>) => {
        await as(ADMIN)
          .post('/api/v1/templates')
          .send(draft({ templateKey: key, ...overrides }))
          .expect(201);
        await as(ADMIN)
          .post(`/api/v1/templates/${key}/versions/1/publish`)
          .send({ reason: 'approved' })
          .expect(200);
      };
      await publish('receipt-general', {});
      await publish('receipt-project', {
        selectors: { projectId: 'prj_docs0000000000000000000000000001' },
      });
      await publish('receipt-future', {
        effectiveFrom: '2030-01-01',
        selectors: { projectId: 'prj_docs0000000000000000000000000001' },
      });

      expect((await templates.select('receipt', { on: '2026-09-27' as never }))?.templateKey).toBe(
        'receipt-general',
      );
      expect(
        (
          await templates.select('receipt', {
            on: '2026-09-27' as never,
            projectId: 'prj_docs0000000000000000000000000001',
          })
        )?.templateKey,
      ).toBe('receipt-project');
      expect(await templates.select('invoice', { on: '2026-09-27' as never })).toBeUndefined();

      const preview = await as(READER)
        .post('/api/v1/templates/receipt-general/versions/1/preview')
        .send({ locale: 'ar' })
        .expect(200);
      expect(preview.body.text).toBe('استلمنا من نص تجريبي مبلغ 1,000,000.00 XXX — نص تجريبي');
      await as(READER)
        .post('/api/v1/templates')
        .send(draft({ templateKey: 'reader-attempt' }))
        .expect(403);
    });
  });
});
