import { ScopeAssignmentSchema, type Permission } from '@alola/contracts';
import { LocalDiskFileStore, createLogger } from '@alola/security';
import { serviceGate } from '@alola/testing';
import type { Express } from 'express';
import mongoose, { type Connection } from 'mongoose';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type ApiModule } from '../../app';
import type { ActorResolver } from '../../http/actor';
import { noteAuditWrite } from '../../http/audit-context';
import { parseCsv } from '../../platform/csv';
import { ensureIndexes } from '../../platform/indexes';
import { configureMongoose } from '../../platform/mongo';
import { AUDIT_COLLECTION, AuditService } from '../audit';
import { CrmService, LEADS_COLLECTION } from '../crm';
import { InventoryService, UNITS_COLLECTION } from '../inventory';
import {
  ACCOUNT_GRANTS_COLLECTION,
  ROLES_COLLECTION,
  SecurityService,
  bootstrapGrant,
  bootstrapRole,
} from '../security';
import { REFERENCE_ITEMS_COLLECTION, SettingsService, referenceItemImporter } from '../settings';
import {
  EXPORT_RECORDS_COLLECTION,
  IMPORT_BATCHES_COLLECTION,
  ImportService,
  exportRouter,
  importRouter,
  readFirstSheet,
} from './index';

/**
 * Import and export against a real MongoDB replica set and a real disk (CORE-IMPORT-001 … 003).
 *
 * The property that matters most: **an import writes every row or none.** Every refusal below is
 * followed by a count of what was stored, and the count never moves.
 */
const gate = serviceGate(['mongodb']);
const RUN = `i${Date.now()}`;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const ACCOUNT_HEADER = 'x-test-account';
const label = (en: string) => ({ ar: `عربي ${en}`, en });

/* ----------------------------------------------------- a minimal .xlsx file */

/** A stored (uncompressed) zip — enough for a workbook, and no writer dependency. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const nameBytes = Buffer.from(name, 'utf8');
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function xlsx(rows: string[][]): Buffer {
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const pkg = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const column = (index: number) => String.fromCharCode(65 + index);
  const sheetRows = rows
    .map(
      (cells, r) =>
        `<row r="${String(r + 1)}">${cells
          .map(
            (cell, c) =>
              `<c r="${column(c)}${String(r + 1)}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`,
          )
          .join('')}</row>`,
    )
    .join('');
  return zip({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>',
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${pkg}"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${pkg}"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${main}"><sheetData>${sheetRows}</sheetData></worksheet>`,
  });
}

describe.skipIf(!gate.available)(`import and export — ${gate.reason}`, () => {
  let connection: Connection;
  let security: SecurityService;
  let store: LocalDiskFileStore;
  let root: string;
  let app: Express;
  let clock: Date;
  let importsOn: boolean;
  let exportsOn: boolean;

  const BRANCH_A = `brn_${RUN}a`;
  const BRANCH_B = `brn_${RUN}b`;
  const ADMIN = `acc_${RUN}admin`; // reference data, all scope
  const OTHER = `acc_${RUN}other`; // reference data too, but not the uploader
  const PLAIN = `acc_${RUN}plain`; // no import permission
  const EXPORTER_A = `acc_${RUN}expa`; // lead and unit export, branch A, no pricing
  const PRICER_A = `acc_${RUN}pricea`; // unit export with pricing, branch A

  const header = 'list,code,label_ar,label_en,description_ar,description_en,sort_order';
  const code = (suffix: string) => `R${RUN}${suffix}`;
  const items = () => connection.collection(REFERENCE_ITEMS_COLLECTION);
  const ours = () => items().countDocuments({ code: { $regex: `^R${RUN}` } });

  const upload = (accountId: string, body: Buffer | string, fileName = 'items.csv') =>
    request(app)
      .post('/api/v1/imports')
      .query({ kind: 'referenceItems', fileName })
      .set(ACCOUNT_HEADER, accountId)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8'));
  const post = (accountId: string, path: string, body: object = {}) =>
    request(app).post(path).set(ACCOUNT_HEADER, accountId).set('Origin', ALLOWED_ORIGIN).send(body);
  const commit = (accountId: string, batchId: string, expectedVersion = 1) =>
    post(accountId, `/api/v1/imports/${batchId}/commit`, { expectedVersion });
  const codes = (response: {
    body: { issues: { row: number; column?: string; code: string }[] };
  }) =>
    response.body.issues.map((issue) => `${String(issue.row)}:${issue.column ?? ''}:${issue.code}`);

  /** Follow an export link to its bytes, the way the file route would. */
  const exported = async (url: string) => {
    const token = url.split('/').pop() ?? '';
    const grant = store.verify(token);
    if (!grant) throw new Error('export link did not verify');
    return parseCsv(new TextDecoder().decode(await store.read(grant.key)));
  };

  beforeAll(async () => {
    configureMongoose();
    const logger = createLogger({ name: 'it-imports', level: 'silent' });
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'] as string,
    });
    await connection.asPromise();
    await ensureIndexes(connection, logger);
    const audit = new AuditService({ connection, logger, onRecorded: noteAuditWrite });
    security = new SecurityService({ connection, audit, logger });
    root = await mkdtemp(join(tmpdir(), 'alola-imports-'));
    clock = new Date();
    store = new LocalDiskFileStore('test', root, '/api/v1/files', () => clock);
    const settings = new SettingsService({ connection, audit });
    const noBranch = () => Promise.resolve(undefined);
    const crm = new CrmService({
      connection,
      audit,
      resolveBranch: noBranch,
      today: () => '2026-10-01' as never,
    });
    const inventory = new InventoryService({ connection, audit, resolveBranch: noBranch });
    const service = new ImportService({
      connection,
      audit,
      store,
      importers: [referenceItemImporter(() => settings)],
      exporters: [
        { kind: 'leads', permission: 'crm.lead.export', rows: (a, l) => crm.exportLeads(a, l) },
        {
          kind: 'units',
          permission: 'inventory.unit.export',
          rows: (a, l) => inventory.exportUnits(a, l),
        },
      ],
      readXlsx: readFirstSheet,
      importsEnabled: () => Promise.resolve(importsOn),
      exportsEnabled: () => Promise.resolve(exportsOn),
      now: () => clock,
    });

    const grant = async (
      accountId: string,
      permissions: Permission[],
      scope: Record<string, unknown> = { level: 'all' },
    ) => {
      await bootstrapRole(connection, {
        key: `${RUN}-${accountId}`,
        name: label('r'),
        permissions,
      });
      await bootstrapGrant(connection, {
        accountId,
        roleKeys: permissions.length ? [`${RUN}-${accountId}`] : [],
        scope: ScopeAssignmentSchema.parse(scope),
        updatedBy: 'test',
      });
    };
    await grant(ADMIN, ['referenceData.manage']);
    await grant(OTHER, ['referenceData.manage']);
    await grant(PLAIN, []);
    await grant(EXPORTER_A, ['crm.lead.export', 'inventory.unit.export'], {
      level: 'branch',
      branchIds: [BRANCH_A],
    });
    await grant(PRICER_A, ['inventory.unit.export', 'inventory.unit.viewPricing'], {
      level: 'branch',
      branchIds: [BRANCH_A],
    });

    const now = new Date('2026-10-01T09:00:00.000Z');
    const lead = (id: string, branchId: string, name: string) => ({
      leadId: id,
      name,
      primaryPhone: '+20 100 000 0000',
      primaryPhoneDigits: '201000000000',
      source: 'referral',
      stage: 'new',
      legalEntityId: `le_${RUN}`,
      branchId,
      assignedToAccountId: EXPORTER_A,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await connection
      .collection(LEADS_COLLECTION)
      .insertMany([
        lead(`lead_${RUN}a1`, BRANCH_A, 'Amal'),
        lead(`lead_${RUN}a2`, BRANCH_A, '=HYPERLINK("http://x.invalid","click")'),
        lead(`lead_${RUN}b1`, BRANCH_B, 'Basma'),
      ]);
    const money = (amount: string) => ({
      amount: mongoose.mongo.Decimal128.fromString(amount),
      currency: 'EGP',
    });
    await connection.collection(UNITS_COLLECTION).insertOne({
      unitId: `unit_${RUN}a1`,
      projectId: `prj_${RUN}a`,
      buildingId: `bld_${RUN}a`,
      legalEntityId: `le_${RUN}`,
      branchId: BRANCH_A,
      code: `U${RUN.toUpperCase()}-101`,
      floor: 1,
      propertyType: 'apartment',
      usageType: 'residential',
      area: mongoose.mongo.Decimal128.fromString('120.5'),
      basePrice: money('2400000'),
      currentPrice: money('2500000'),
      pricePerSquareMeter: money('20746.89'),
      status: 'available',
      finishingStatus: 'fullyFinished',
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    const actorResolver: ActorResolver = async (req) => {
      const accountId = req.get(ACCOUNT_HEADER);
      return accountId ? security.resolveActor(accountId) : undefined;
    };
    const modules: ApiModule[] = [
      { basePath: '/imports', router: importRouter({ getService: () => service }) },
      { basePath: '/exports', router: exportRouter({ getService: () => service }) },
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
    importsOn = true;
    exportsOn = true;
    await items().deleteMany({ code: { $regex: `^R${RUN}` } });
  });

  afterAll(async () => {
    if (!connection) return;
    await items().deleteMany({ code: { $regex: `^R${RUN}` } });
    await connection
      .collection(IMPORT_BATCHES_COLLECTION)
      .deleteMany({ createdBy: { $regex: `^acc_${RUN}` } });
    await connection
      .collection(EXPORT_RECORDS_COLLECTION)
      .deleteMany({ createdBy: { $regex: `^acc_${RUN}` } });
    await connection.collection(LEADS_COLLECTION).deleteMany({ leadId: { $regex: `_${RUN}` } });
    await connection.collection(UNITS_COLLECTION).deleteMany({ unitId: { $regex: `_${RUN}` } });
    await connection.collection(ROLES_COLLECTION).deleteMany({ key: { $regex: `^${RUN}` } });
    await connection
      .collection(ACCOUNT_GRANTS_COLLECTION)
      .deleteMany({ accountId: { $regex: `^acc_${RUN}` } });
    await connection
      .collection(AUDIT_COLLECTION)
      .deleteMany({ 'actor.accountId': { $regex: `^acc_${RUN}` } });
    await connection.close();
    await rm(root, { recursive: true, force: true });
  });

  /* ======================================================= CORE-IMPORT-001 */

  describe('preview before commit (CORE-IMPORT-001)', () => {
    it('previews a clean file without writing, then commits every row once, audited', async () => {
      const csv = [
        header,
        `lossReasons,${code('a')},السعر,Price,,,10`,
        `lossReasons,${code('b')},"الموقع، بعيد","Location, too far",وصف,Description,20`,
      ].join('\r\n');
      const preview = await upload(ADMIN, csv).expect(201);
      expect(preview.body).toMatchObject({
        state: 'previewed',
        format: 'csv',
        totalRows: 2,
        validRows: 2,
        invalidRows: 0,
        issues: [],
      });
      expect(preview.body.preview[1]).toMatchObject({ label_en: 'Location, too far' });
      expect(await ours()).toBe(0);

      const committed = await commit(ADMIN, preview.body.batchId as string).expect(200);
      expect(committed.body).toMatchObject({ state: 'committed', version: 2 });
      expect(await ours()).toBe(2);
      const again = await commit(ADMIN, preview.body.batchId as string, 2).expect(409);
      expect(again.body.error.issues[0].code).toBe('IMPORT_NOT_PENDING');
      expect(await ours()).toBe(2);
      const audit = connection.collection(AUDIT_COLLECTION);
      expect(
        await audit.countDocuments({
          action: 'import.committed',
          'target.id': preview.body.batchId,
        }),
      ).toBe(1);
      expect(
        await audit.countDocuments({ action: 'referenceData.created', 'target.id': code('b') }),
      ).toBe(1);
    });

    it('reads an .xlsx workbook the same way, Arabic included', async () => {
      const workbook = xlsx([
        header.split(','),
        ['lossReasons', code('x'), 'التمويل', 'Financing', '', '', '5'],
      ]);
      const preview = await upload(ADMIN, workbook, 'items.xlsx').expect(201);
      expect(preview.body).toMatchObject({ format: 'xlsx', validRows: 1, issues: [] });
      expect(preview.body.preview[0]).toMatchObject({ label_ar: 'التمويل', sort_order: '5' });
      await commit(ADMIN, preview.body.batchId as string).expect(200);
      expect(await items().findOne({ code: code('x') })).toMatchObject({
        label: { ar: 'التمويل', en: 'Financing' },
        sortOrder: 5,
      });
    });

    it('refuses what it cannot read exactly', async () => {
      const latin1 = Buffer.from([0x6c, 0x69, 0x73, 0x74, 0x0a, 0xe9, 0xe0]);
      expect((await upload(ADMIN, latin1).expect(400)).body.error.issues[0].code).toBe(
        'CSV_NOT_UTF8',
      );
      expect((await upload(ADMIN, 'list,"open\n').expect(400)).body.error.issues[0].code).toBe(
        'CSV_MALFORMED',
      );
      const broken = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]);
      expect((await upload(ADMIN, broken, 'x.xlsx').expect(400)).body.error.issues[0].code).toBe(
        'XLSX_UNREADABLE',
      );
      const huge = [
        header,
        ...Array.from({ length: 5001 }, (_v, i) => `lossReasons,c${String(i)},a,b,,,`),
      ];
      expect((await upload(ADMIN, huge.join('\n')).expect(400)).body.error.issues[0].code).toBe(
        'TOO_MANY_ROWS',
      );
    });
  });

  /* ======================================================= CORE-IMPORT-002 */

  describe('every error by row and column; no partial import (CORE-IMPORT-002)', () => {
    it('reports each problem where it is, and refuses to commit any of the file', async () => {
      await items().insertOne({
        list: 'lossReasons',
        code: code('taken'),
        label: { ar: 'أ', en: 'A' },
        sortOrder: 1,
        active: true,
        version: 1,
        createdAt: new Date(),
        createdBy: 'test',
        updatedAt: new Date(),
        updatedBy: 'test',
      });
      const csv = [
        header,
        `lossReasons,${code('ok')},جيد,Good,,,`,
        `payroll,${code('c')},أ,A,,,`,
        `leadSources,${code('d')},أ,A,,,`,
        `lossReasons,bad code!,أ,A,,,`,
        `lossReasons,${code('e')},,A,,,`,
        `lossReasons,${code('f')},أ,A,وصف,,`,
        `lossReasons,${code('g')},أ,A,,,-3`,
        `lossReasons,${code('ok')},مكرر,Again,,,`,
        `lossReasons,${code('taken')},أ,A,,,`,
      ].join('\n');
      const preview = await upload(ADMIN, csv).expect(201);
      expect(preview.body).toMatchObject({ totalRows: 9, invalidRows: 8, issueCount: 8 });
      expect(codes(preview)).toEqual([
        '3:list:UNKNOWN_LIST',
        '4:list:LIST_BOUND_TO_PRODUCT',
        '5:code:REFERENCE_CODE_EXPECTED',
        '6:label_ar:REQUIRED',
        '7:description_en:BOTH_LANGUAGES_REQUIRED',
        '8:sort_order:SORT_ORDER_EXPECTED',
        '9:code:DUPLICATE_IN_FILE',
        '10:code:CODE_TAKEN',
      ]);
      const refused = await commit(ADMIN, preview.body.batchId as string).expect(409);
      expect(refused.body.error.issues[0].code).toBe('IMPORT_HAS_ERRORS');
      expect(await ours()).toBe(1); // only the pre-existing item

      const report = await request(app)
        .get(`/api/v1/imports/${String(preview.body.batchId)}/issues.csv`)
        .set(ACCOUNT_HEADER, ADMIN)
        .expect(200)
        .expect('Content-Type', /text\/csv/);
      const rows = parseCsv(report.text);
      expect(rows[0]).toEqual(['row', 'column', 'code']);
      expect(rows).toHaveLength(9);
    });

    it('checks the header first: unknown and missing columns are row 1', async () => {
      const preview = await upload(ADMIN, 'list,code,label_en,colour\nlossReasons,x,A,red').expect(
        201,
      );
      expect(codes(preview)).toEqual(['1:colour:UNKNOWN_COLUMN', '1:label_ar:MISSING_COLUMN']);
      expect(preview.body.invalidRows).toBe(1);
    });

    it('rolls the whole import back when a code is taken between preview and commit', async () => {
      const csv = [header, `lossReasons,${code('r1')},أ,A,,,`, `lossReasons,${code('r2')},ب,B,,,`];
      const preview = await upload(ADMIN, csv.join('\n')).expect(201);
      // Someone else creates the second code in the meantime.
      await items().insertOne({
        list: 'lossReasons',
        code: code('r2'),
        label: { ar: 'ب', en: 'B' },
        sortOrder: 1,
        active: true,
        version: 1,
        createdAt: new Date(),
        createdBy: 'test',
        updatedAt: new Date(),
        updatedBy: 'test',
      });
      const refused = await commit(ADMIN, preview.body.batchId as string).expect(409);
      expect(refused.body.error.issues[0].code).toBe('CODE_TAKEN');
      expect(await items().countDocuments({ code: code('r1') })).toBe(0);
      const still = await request(app)
        .get(`/api/v1/imports/${String(preview.body.batchId)}`)
        .set(ACCOUNT_HEADER, ADMIN)
        .expect(200);
      expect(still.body).toMatchObject({ state: 'previewed', version: 1 });
    });

    it('expires an old preview, and keeps a batch to the person who uploaded it', async () => {
      const preview = await upload(ADMIN, `${header}\nlossReasons,${code('t')},أ,A,,,`).expect(201);
      const id = preview.body.batchId as string;
      await request(app).get(`/api/v1/imports/${id}`).set(ACCOUNT_HEADER, OTHER).expect(404);
      await commit(OTHER, id).expect(404);
      clock = new Date(clock.getTime() + 25 * 3_600_000);
      expect((await commit(ADMIN, id).expect(409)).body.error.issues[0].code).toBe(
        'IMPORT_EXPIRED',
      );
      expect(await ours()).toBe(0);
    });

    it('needs the importer’s permission and the feature flag', async () => {
      await upload(PLAIN, `${header}\nlossReasons,${code('p')},أ,A,,,`).expect(403);
      importsOn = false;
      expect(
        (await upload(ADMIN, `${header}\nlossReasons,${code('p')},أ,A,,,`).expect(409)).body.error
          .issues[0].code,
      ).toBe('FEATURE_DISABLED');
    });
  });

  /* ======================================================= CORE-IMPORT-003 */

  describe('controlled export (CORE-IMPORT-003)', () => {
    it('exports only the scope, neutralizes formulas, audits, and expires the link', async () => {
      const created = await post(EXPORTER_A, '/api/v1/exports', { kind: 'leads' }).expect(201);
      const rows = await exported(created.body.url as string);
      const ids = rows.slice(1).map((row) => row[0]);
      expect(ids).toContain(`lead_${RUN}a1`);
      expect(ids).not.toContain(`lead_${RUN}b1`);
      const formula = rows.find((row) => row[0] === `lead_${RUN}a2`);
      expect(formula?.[1]).toBe('\'=HYPERLINK("http://x.invalid","click")');
      expect(
        await connection
          .collection(AUDIT_COLLECTION)
          .countDocuments({ action: 'export.created', 'target.id': created.body.exportId }),
      ).toBe(1);
      // The link is signed and short-lived.
      clock = new Date(clock.getTime() + 10 * 60_000);
      expect(store.verify((created.body.url as string).split('/').pop() ?? '')).toBeUndefined();
    });

    it('leaves restricted columns out of the file for someone who may not see them', async () => {
      const plain = await post(EXPORTER_A, '/api/v1/exports', { kind: 'units' }).expect(201);
      expect(plain.body.columns).not.toContain('base_price');
      const plainRows = await exported(plain.body.url as string);
      expect(plainRows[0]).not.toContain('base_price');
      expect(plainRows.flat().join(',')).not.toContain('2400000');

      const priced = await post(PRICER_A, '/api/v1/exports', { kind: 'units' }).expect(201);
      const pricedRows = await exported(priced.body.url as string);
      expect(pricedRows[0]).toContain('base_price');
      expect(pricedRows.find((row) => row[0] === `U${RUN.toUpperCase()}-101`)).toContain('2400000');
    });

    it('needs the export permission and the feature flag', async () => {
      await post(PRICER_A, '/api/v1/exports', { kind: 'leads' }).expect(403);
      exportsOn = false;
      expect(
        (await post(EXPORTER_A, '/api/v1/exports', { kind: 'leads' }).expect(409)).body.error
          .issues[0].code,
      ).toBe('FEATURE_DISABLED');
    });
  });
});
