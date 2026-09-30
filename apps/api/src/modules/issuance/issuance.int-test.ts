import { loadApiConfig } from '@alola/config';
import {
  ActorContextSchema,
  BusinessDateSchema,
  ClientInitFileSchema,
  DecimalStringSchema,
  ISSUED_TEMPLATE_VERSIONS,
  PERMISSIONS,
  ScopeAssignmentSchema,
  money,
  type ActorContext,
  type IssuedDocument,
  type Permission,
  type PublicVerification,
  type ScopeAssignment,
} from '@alola/contracts';
import { createLogger } from '@alola/security';
import { serviceGate } from '@alola/testing';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Express } from 'express';
import mongoose, { type Connection } from 'mongoose';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type ApiModule } from '../../app';
import type { ActorResolver } from '../../http/actor';
import { noteAuditWrite } from '../../http/audit-context';
import { initializeClient } from '../../platform/client-init';
import { createDomainServices, type DomainServices } from '../../platform/domain-services';
import { ensureIndexes } from '../../platform/indexes';
import { configureMongoose } from '../../platform/mongo';
import { decodeQr, extractPages, renderPage } from '../../platform/pdf/test-support';
import { AUDIT_COLLECTION } from '../audit';
import { COMPANY_PROFILES_COLLECTION, COMPANY_PROFILE_REVISIONS_COLLECTION } from '../company';
import { documentRouter, fileRouter } from '../documents';
import { BRANCHES_COLLECTION, LEGAL_ENTITIES_COLLECTION } from '../organization';
import { bootstrapGrant, bootstrapRole } from '../security';
import { ISSUED_DOCUMENTS_COLLECTION } from './model';
import { issuanceRouter, verificationRouter } from './router';

/**
 * Issued documents end to end (CORE-DOC-003, CORE-DOC-005), through the real composition root, real
 * MongoDB and the development file store: every file is fetched back through the audited download
 * link and read — its text, its checksum, its QR code — rather than trusted.
 */
const gate = serviceGate(['mongodb']);
const RUN = String(Date.now()).slice(-8);
const ALLOWED_ORIGIN = 'http://localhost:5173';
const ACCOUNT_HEADER = 'x-test-account';
const context = { correlationId: `it-issuance-${RUN}` };

const MANAGER = `acc_itiss${RUN}manager`;
const VIEWER = `acc_itiss${RUN}viewer`;
const REP = `acc_itiss${RUN}rep`;
const NO_SALES = `acc_itiss${RUN}nosales`;

const egp = (amount: string) => money(amount, 'EGP');
const date = (value: string) => BusinessDateSchema.parse(value);
const scope = (level: ScopeAssignment['level'], extra: Partial<ScopeAssignment> = {}) =>
  ScopeAssignmentSchema.parse({ level, ...extra });

const SYSTEM: ActorContext = ActorContextSchema.parse({
  accountId: 'system:it-issuance',
  kind: 'system',
  roleKeys: [],
  permissions: [],
  scope: { level: 'all' },
});

describe.skipIf(!gate.available)(`issued documents — ${gate.reason}`, () => {
  let connection: Connection;
  let services: DomainServices;
  let app: Express;
  let branchId: string;
  let today: string;
  const created: { contractId?: string; draftContractId?: string; receiptId?: string } = {};
  let quotationId = '';
  let customerId = '';

  const api = () => request(app);
  const as = (accountId: string) => ({
    get: (path: string) => api().get(path).set(ACCOUNT_HEADER, accountId),
    post: (path: string) =>
      api().post(path).set(ACCOUNT_HEADER, accountId).set('Origin', ALLOWED_ORIGIN),
  });
  const actor = async (accountId: string) => {
    const resolved = await services.security().resolveActor(accountId);
    if (!resolved) throw new Error(`no actor ${accountId}`);
    return resolved;
  };

  const issue = async (
    accountId: string,
    type: string,
    sourceId: string,
    locale: 'ar' | 'en',
    status = 201,
  ) => {
    const response = await as(accountId)
      .post('/api/v1/issued-documents')
      .send({ type, sourceId, locale });
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    return response.body as IssuedDocument;
  };

  /** Fetch a file the way a person does: an audited, short-lived link, then the link. */
  const download = async (accountId: string, issued: IssuedDocument) => {
    const link = await as(accountId)
      .post(`/api/v1/documents/${issued.documentId}/download`)
      .send({ version: issued.documentVersion });
    expect(link.status, JSON.stringify(link.body)).toBe(200);
    const file = await api()
      .get((link.body as { url: string }).url)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const bytes = file.body as Buffer;
    // Visual review: `PDF_QA_DIR=scratch/pdf-qa` keeps every downloaded file (an ignored folder).
    const qa = process.env['PDF_QA_DIR'];
    if (qa) {
      mkdirSync(qa, { recursive: true });
      writeFileSync(
        join(
          qa,
          `${issued.type}-${issued.locale}-v${issued.version}-${issued.issueId.slice(-4)}.pdf`,
        ),
        bytes,
      );
    }
    return bytes;
  };

  const textOf = async (bytes: Buffer) =>
    (await extractPages(bytes)).map((page) => page.text).join('\n');

  const clean = async () => {
    for (const name of [
      COMPANY_PROFILES_COLLECTION,
      COMPANY_PROFILE_REVISIONS_COLLECTION,
      ISSUED_DOCUMENTS_COLLECTION,
    ]) {
      await connection.collection(name).deleteMany({});
    }
    await connection.collection(BRANCHES_COLLECTION).deleteMany({ code: { $regex: `^IB${RUN}` } });
    await connection
      .collection(LEGAL_ENTITIES_COLLECTION)
      .deleteMany({ code: { $regex: `^IL${RUN}` } });
  };

  beforeAll(async () => {
    configureMongoose();
    const logger = createLogger({ name: 'it-issuance', level: 'silent' });
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'] as string,
    });
    await connection.asPromise();
    await ensureIndexes(connection, logger);
    await clean();
    const config = loadApiConfig();
    services = createDomainServices({
      config,
      logger,
      requireConnection: () => connection,
      onAuditRecorded: noteAuditWrite,
    });
    today = new Intl.DateTimeFormat('en-CA', { timeZone: config.ORG_TIMEZONE }).format(new Date());

    // The company and its organization, exactly as a client deployment is initialized (OPS-005).
    await initializeClient(
      {
        connection,
        company: services.company(),
        organization: services.organization(),
        pendingMigrations: () => Promise.resolve([]),
      },
      ClientInitFileSchema.parse({
        schemaVersion: 1,
        company: {
          legalName: {
            ar: 'شركة الاختبار للتطوير العقاري',
            en: 'Test Real Estate Development Co.',
          },
          tradeName: { ar: 'تطوير الاختبار', en: 'Test Developments' },
          shortName: { ar: 'الاختبار', en: 'Test' },
          country: 'EG',
          defaultLocale: 'ar',
          supportedLocales: ['ar', 'en'],
          timeZone: config.ORG_TIMEZONE,
          baseCurrency: 'EGP',
        },
        legalEntities: [
          {
            code: `IL${RUN}`,
            name: { ar: 'الكيان', en: 'Entity' },
            currency: 'EGP',
            timeZone: config.ORG_TIMEZONE,
            branches: [
              {
                code: `IB${RUN}A`,
                name: { ar: 'فرع', en: 'Branch' },
                city: { ar: 'القاهرة', en: 'Cairo' },
              },
            ],
          },
        ],
      }),
      context,
    );
    const branch = await connection.collection(BRANCHES_COLLECTION).findOne({ code: `IB${RUN}A` });
    branchId = branch?.['branchId'] as string;

    const all = [...PERMISSIONS] as Permission[];
    await bootstrapRole(connection, {
      key: `it-iss-${RUN}-all`,
      name: { ar: 'كل', en: 'All' },
      permissions: all,
    });
    await bootstrapRole(connection, {
      key: `it-iss-${RUN}-viewer`,
      name: { ar: 'مشاهد', en: 'Viewer' },
      permissions: all.filter((p) => p !== 'crm.customer.viewIdentity' && p !== 'document.revoke'),
    });
    await bootstrapRole(connection, {
      key: `it-iss-${RUN}-docs`,
      name: { ar: 'مستندات', en: 'Docs' },
      permissions: ['document.view', 'document.generate', 'document.download'],
    });
    const grant = (accountId: string, role: string, assignment: ScopeAssignment) =>
      bootstrapGrant(connection, {
        accountId,
        roleKeys: [role],
        scope: assignment,
        updatedBy: 'test',
      });
    await grant(MANAGER, `it-iss-${RUN}-all`, scope('all'));
    await grant(VIEWER, `it-iss-${RUN}-viewer`, scope('all'));
    await grant(REP, `it-iss-${RUN}-all`, scope('assigned', { branchIds: [branchId] }));
    await grant(NO_SALES, `it-iss-${RUN}-docs`, scope('all'));

    // Reservation validity is a configured rule (BD-01); the suite sets it and restores it after.
    const validity = await services.settings().getSetting('sales.reservationValidityDays');
    await services
      .settings()
      .updateSetting(
        SYSTEM,
        'sales.reservationValidityDays',
        { value: 14, expectedVersion: validity.version, reason: 'integration fixture' },
        context,
      );

    const manager = await actor(MANAGER);
    const inventory = services.inventory();
    const project = await inventory.createProject(
      manager,
      {
        branchId,
        code: `IP${RUN}`,
        name: { ar: 'واحة الاختبار', en: 'Test Oasis' },
        city: { ar: 'القاهرة', en: 'Cairo' },
        currency: 'EGP',
        status: 'selling',
      },
      context,
    );
    const building = await inventory.createBuilding(
      manager,
      {
        projectId: project.projectId,
        code: `IX${RUN}`,
        name: { ar: 'مبنى', en: 'Building' },
        floors: 12,
      },
      context,
    );
    const unitFor = (suffix: string) =>
      inventory.createUnit(
        manager,
        {
          buildingId: building.buildingId,
          code: `IU${RUN}${suffix}`,
          floor: 4,
          propertyType: 'apartment',
          usageType: 'residential',
          area: DecimalStringSchema.parse('150'),
          basePrice: egp('3000000'),
          finishingStatus: 'semiFinished',
        },
        context,
      );
    const unitA = await unitFor('A');
    const unitB = await unitFor('B');
    const unitQ = await unitFor('Q');

    // A buyer with an identity, recorded by someone allowed to see it; a co-buyer.
    const crm = services.crm();
    const buyer = await crm.createCustomer(
      manager,
      {
        name: 'أحمد عبد الله',
        primaryPhone: `+2011${RUN}`,
        branchId,
        identity: { type: 'nationalId', number: '29001011234567' },
      },
      context,
    );
    customerId = buyer.customerId;
    const coBuyer = await crm.createCustomer(
      manager,
      { name: 'Sara El-Sayed', primaryPhone: `+2012${RUN}`, branchId },
      context,
    );

    const sales = services.sales();
    const reserveAndConfirm = async (unitId: string, key: string) => {
      const { reservation } = await sales.createReservation(
        manager,
        {
          customerId: buyer.customerId,
          unitId,
          reservationAmount: egp('100000'),
          agreedPrice: egp('2850000'),
          paymentPlan: {
            downPayment: egp('600000'),
            downPaymentDueOn: date(today),
            installmentCount: 12,
            frequency: 'monthly',
            firstDueOn: date(`${Number(today.slice(0, 4)) + 1}${today.slice(4)}`),
            maintenanceDeposit: {
              amount: egp('142500'),
              dueOn: date(`${Number(today.slice(0, 4)) + 2}${today.slice(4)}`),
            },
          },
          idempotencyKey: `it-iss-${RUN}-${key}`,
        },
        context,
      );
      await sales.confirmReservation(manager, reservation.reservationId, context);
      return reservation;
    };
    const reservationA = await reserveAndConfirm(unitA.unitId, 'rsv-a');
    const draft = await sales.createContract(
      manager,
      {
        reservationId: reservationA.reservationId,
        contractedOn: date(today),
        parties: [
          { role: 'buyer', customerId: buyer.customerId, sharePercent: '60' },
          { role: 'coBuyer', customerId: coBuyer.customerId, sharePercent: '40' },
        ],
        idempotencyKey: `it-iss-${RUN}-ctr-a`,
      },
      context,
    );
    created.draftContractId = draft.contract.contractId;

    const reservationB = await reserveAndConfirm(unitB.unitId, 'rsv-b');
    const second = await sales.createContract(
      manager,
      {
        reservationId: reservationB.reservationId,
        contractedOn: date(today),
        idempotencyKey: `it-iss-${RUN}-ctr-b`,
      },
      context,
    );
    const active = await sales.activateContract(
      manager,
      second.contract.contractId,
      { expectedVersion: second.contract.version },
      context,
    );
    created.contractId = active.contractId;
    const receipt = await services.collections().recordReceipt(
      manager,
      {
        contractId: active.contractId,
        amount: egp('250000'),
        method: 'bankTransfer',
        receivedOn: date(today),
        transactionReference: 'TRX-778812',
        idempotencyKey: `it-iss-${RUN}-rcp`,
      },
      context,
    );
    created.receiptId = receipt.receipt.receiptId;

    const quotation = await services.quotations().create(
      manager,
      {
        customerId: buyer.customerId,
        unitId: unitQ.unitId,
        agreedPrice: egp('2900000'),
        paymentPlan: {
          downPayment: egp('580000'),
          installmentCount: 8,
          frequency: 'quarterly',
          firstDueOn: date(`${Number(today.slice(0, 4)) + 1}${today.slice(4)}`),
        },
        validUntil: date(`${Number(today.slice(0, 4)) + 1}${today.slice(4)}`),
        idempotencyKey: `it-iss-${RUN}-quo`,
      },
      context,
    );
    quotationId = quotation.quotation.quotationId;

    const actorResolver: ActorResolver = async (req) => {
      const accountId = req.get(ACCOUNT_HEADER);
      return accountId ? services.security().resolveActor(accountId) : undefined;
    };
    const modules: ApiModule[] = [
      { basePath: '/issued-documents', router: issuanceRouter({ getService: services.issuance }) },
      {
        basePath: '/public',
        router: verificationRouter({
          getService: services.issuance,
          limiter: new RateLimiterMemory({ points: 10_000, duration: 60 }),
        }),
      },
      {
        basePath: '/documents',
        router: documentRouter({
          getDocuments: services.documents,
          getTemplates: services.templates,
        }),
      },
      { basePath: '/files', router: fileRouter({ store: services.fileStore as never }) },
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
  }, 120_000);

  afterAll(async () => {
    if (!connection) return;
    const validity = await services.settings().getSetting('sales.reservationValidityDays');
    await services
      .settings()
      .updateSetting(
        SYSTEM,
        'sales.reservationValidityDays',
        { value: null, expectedVersion: validity.version, reason: 'integration fixture restored' },
        context,
      );
    await clean();
    await connection.close();
  });

  describe('generation (CORE-DOC-003)', () => {
    it('issues a draft contract summary in Arabic that says what it is and what it is not', async () => {
      const issued = await issue(MANAGER, 'contractSummary', created.draftContractId ?? '', 'ar');
      expect(issued).toMatchObject({
        type: 'contractSummary',
        locale: 'ar',
        version: 1,
        state: 'issued',
        template: {
          key: 'builtin:contractSummary',
          version: ISSUED_TEMPLATE_VERSIONS.contractSummary,
        },
        restricted: ['crm.customer.viewIdentity'],
      });
      const bytes = await download(MANAGER, issued);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(issued.fileSha256);
      const text = await textOf(bytes);
      expect(text).toContain('ملخص العقد');
      expect(text).toContain('مسودة');
      expect(text).toContain(issued.businessReference);
      expect(text).toContain('أحمد عبد الله');
      expect(text).toContain('Sara El-Sayed');
      expect(text).toContain('60%');
      expect(text).toContain('40%');
      // The buyer's identity, printed because the generator may see it — and the file is restricted.
      expect(text).toContain('29001011234567');
      expect(text).toContain('وديعة الصيانة');
      expect(text).toContain(issued.fingerprint);
      const page = await renderPage(bytes, (await extractPages(bytes)).length, 2.5);
      expect(decodeQr(page)).toBe(issued.verificationUrl);
    });

    it('issues every document type in both languages', async () => {
      const sources: [string, string][] = [
        ['quotation', quotationId],
        ['contractSummary', created.contractId ?? ''],
        ['installmentSchedule', created.contractId ?? ''],
        ['receipt', created.receiptId ?? ''],
        ['customerStatement', customerId],
      ];
      for (const [type, sourceId] of sources) {
        for (const locale of ['ar', 'en'] as const) {
          const issued = await issue(MANAGER, type, sourceId, locale);
          const text = await textOf(await download(MANAGER, issued));
          expect(text.length).toBeGreaterThan(200);
          expect(text).toContain(issued.businessReference);
        }
      }
      const quotationText = await textOf(
        await download(MANAGER, await issue(MANAGER, 'quotation', quotationId, 'en')),
      );
      expect(quotationText).toContain('does not reserve the unit');
      const receipts = await as(MANAGER).get(
        `/api/v1/issued-documents?sourceType=receipt&sourceId=${created.receiptId ?? ''}`,
      );
      const receiptIssue = (receipts.body as { items: IssuedDocument[] }).items.find(
        (item) => item.locale === 'en',
      );
      const receiptText = await textOf(await download(MANAGER, receiptIssue as IssuedDocument));
      expect(receiptText).toContain('TRX-778812');
      expect(receiptText).toContain('250,000.00');
    });

    it('refuses to issue before a company profile exists', async () => {
      const profiles = await connection.collection(COMPANY_PROFILES_COLLECTION).find().toArray();
      await connection.collection(COMPANY_PROFILES_COLLECTION).deleteMany({});
      try {
        const refused = await as(MANAGER)
          .post('/api/v1/issued-documents')
          .send({ type: 'quotation', sourceId: quotationId, locale: 'ar' })
          .expect(409);
        expect(refused.body.error.issues[0].code).toBe('COMPANY_PROFILE_REQUIRED');
      } finally {
        if (profiles.length > 0)
          await connection.collection(COMPANY_PROFILES_COLLECTION).insertMany(profiles);
      }
    });

    it('shows safe metadata before generating, and warns about a draft and missing wording', async () => {
      const preview = await as(MANAGER)
        .get(
          `/api/v1/issued-documents/preview?type=contractSummary&sourceId=${created.draftContractId ?? ''}`,
        )
        .expect(200);
      expect(preview.body.warnings).toEqual(expect.arrayContaining(['draft', 'noApprovedWording']));
      expect(preview.body.restricted).toEqual(['crm.customer.viewIdentity']);
      expect(preview.body.nextVersion.ar).toBeGreaterThan(1);
      expect(JSON.stringify(preview.body)).not.toContain('29001011234567');
    });
  });

  describe('versions and immutability', () => {
    it('supersedes the previous issue and never changes an issued file', async () => {
      const first = await issue(MANAGER, 'installmentSchedule', created.contractId ?? '', 'ar');
      const firstBytes = await download(MANAGER, first);
      // The company renames itself; the issued file must not change, the next one must.
      const profile = await services.company().requireProfile();
      const {
        version: _version,
        createdAt: _created,
        updatedAt: _updated,
        assets: _assets,
        ...fields
      } = profile;
      await services.company().updateProfile(
        SYSTEM,
        {
          ...fields,
          tradeName: { ar: 'اسم تجاري جديد', en: 'Renamed Developments' },
          expectedVersion: profile.version,
        },
        context,
      );
      const second = await issue(MANAGER, 'installmentSchedule', created.contractId ?? '', 'ar');
      expect(second.version).toBe(first.version + 1);
      expect(second.companyVersion).toBe(profile.version + 1);
      const again = await download(MANAGER, first);
      expect(again.equals(firstBytes)).toBe(true);
      expect(await textOf(await download(MANAGER, second))).toContain('اسم تجاري جديد');
      const list = await as(MANAGER)
        .get(`/api/v1/issued-documents?sourceType=contract&sourceId=${created.contractId ?? ''}`)
        .expect(200);
      const firstNow = (list.body as { items: IssuedDocument[] }).items.find(
        (item) => item.issueId === first.issueId,
      );
      expect(firstNow).toMatchObject({ state: 'superseded', supersededByIssueId: second.issueId });
      // The superseded file's verification still names the company as it was when issued.
      const verified = await api().get(
        new URL(first.verificationUrl ?? '').pathname.replace('/verify/', '/api/v1/public/verify/'),
      );
      expect(verified.body).toMatchObject({ result: 'superseded', version: first.version });
      expect(verified.body.company.ar).not.toBe('اسم تجاري جديد');
    });
  });

  describe('authorization, scope and restricted fields', () => {
    it('never lets a PDF reveal an identity the reader may not see', async () => {
      const withIdentity = await issue(
        MANAGER,
        'contractSummary',
        created.draftContractId ?? '',
        'en',
      );
      expect(withIdentity.restricted).toEqual(['crm.customer.viewIdentity']);
      // The viewer holds everything except identity: the restricted issue and its file are absent.
      const listed = await as(VIEWER)
        .get(
          `/api/v1/issued-documents?sourceType=contract&sourceId=${created.draftContractId ?? ''}`,
        )
        .expect(200);
      expect(
        (listed.body as { items: IssuedDocument[] }).items.map((item) => item.issueId),
      ).not.toContain(withIdentity.issueId);
      await as(VIEWER).get(`/api/v1/issued-documents/${withIdentity.issueId}`).expect(404);
      await as(VIEWER)
        .post(`/api/v1/documents/${withIdentity.documentId}/download`)
        .send({ version: withIdentity.documentVersion })
        .expect(404);
      // What the viewer generates carries no identity, and is not restricted.
      const own = await issue(VIEWER, 'contractSummary', created.draftContractId ?? '', 'en');
      expect(own.restricted).toEqual([]);
      const text = await textOf(await download(VIEWER, own));
      expect(text).not.toContain('29001011234567');
      expect(text).toContain('Sara El-Sayed');
    });

    it('answers out of scope as not found and refuses a type without its source permission', async () => {
      await as(REP)
        .get(
          `/api/v1/issued-documents/preview?type=contractSummary&sourceId=${created.contractId ?? ''}`,
        )
        .expect(404);
      await as(REP)
        .post('/api/v1/issued-documents')
        .send({ type: 'contractSummary', sourceId: created.contractId, locale: 'ar' })
        .expect(404);
      const listed = await as(REP).get(
        `/api/v1/issued-documents?sourceType=contract&sourceId=${created.contractId ?? ''}`,
      );
      expect(listed.status, JSON.stringify(listed.body)).toBe(200);
      expect(listed.body.items).toEqual([]);
      await as(NO_SALES)
        .post('/api/v1/issued-documents')
        .send({ type: 'contractSummary', sourceId: created.contractId, locale: 'ar' })
        .expect(403);
      await as(VIEWER)
        .post(`/api/v1/issued-documents/${'iss_' + 'x'.repeat(26)}/revoke`)
        .send({ reason: 'not allowed' })
        .expect(403);
    });
  });

  describe('public verification (CORE-DOC-005)', () => {
    const verifyPath = (issued: IssuedDocument) =>
      `/api/v1/public/verify/${(issued.verificationUrl ?? '').split('/verify/')[1] ?? ''}`;

    it('reveals only the approved fields, with no sign-in', async () => {
      const issued = await issue(MANAGER, 'receipt', created.receiptId ?? '', 'ar');
      const response = await api().get(verifyPath(issued)).expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const body = response.body as PublicVerification;
      expect(Object.keys(body).sort()).toEqual(
        [
          'businessReference',
          'checkedAt',
          'company',
          'documentType',
          'fingerprint',
          'issuedOn',
          'result',
          'version',
        ].sort(),
      );
      expect(body).toMatchObject({
        result: 'valid',
        documentType: 'receipt',
        businessReference: issued.businessReference,
        fingerprint: issued.fingerprint,
        issuedOn: today,
      });
      const raw = JSON.stringify(body);
      for (const secret of [
        'أحمد عبد الله',
        '29001011234567',
        '250',
        'TRX-778812',
        issued.issueId,
        issued.documentId,
        created.receiptId ?? 'x',
        customerId,
      ]) {
        expect(raw).not.toContain(secret);
      }
    });

    it('answers a guessed, forged or malformed token with the same bare invalid', async () => {
      const guessed = await api()
        .get(`/api/v1/public/verify/${'A'.repeat(43)}`)
        .expect(200);
      const malformed = await api().get('/api/v1/public/verify/not-a-token').expect(200);
      for (const answer of [guessed.body, malformed.body] as PublicVerification[]) {
        expect(Object.keys(answer).sort()).toEqual(['checkedAt', 'result']);
        expect(answer.result).toBe('invalid');
      }
    });

    it('reports revoked and expired documents, and keeps the audit trail', async () => {
      const issued = await issue(MANAGER, 'quotation', quotationId, 'ar');
      await as(VIEWER)
        .post(`/api/v1/issued-documents/${issued.issueId}/revoke`)
        .send({ reason: 'no' })
        .expect(403);
      const revoked = await as(MANAGER)
        .post(`/api/v1/issued-documents/${issued.issueId}/revoke`)
        .send({ reason: 'issued in error' })
        .expect(200);
      expect(revoked.body).toMatchObject({ state: 'revoked', revocationReason: 'issued in error' });
      expect((await api().get(verifyPath(issued))).body.result).toBe('revoked');

      const fresh = await issue(MANAGER, 'quotation', quotationId, 'en');
      await connection
        .collection(ISSUED_DOCUMENTS_COLLECTION)
        .updateOne({ issueId: fresh.issueId }, { $set: { validUntil: '2020-01-01' } });
      expect((await api().get(verifyPath(fresh))).body.result).toBe('expired');

      const events = await connection
        .collection(AUDIT_COLLECTION)
        .find({ 'target.id': { $in: [issued.issueId, fresh.issueId] } })
        .toArray();
      const actions = events.map((event) => event['action'] as string);
      expect(actions).toEqual(
        expect.arrayContaining(['document.issued', 'document.revoked', 'document.verified']),
      );
      // A verification records no address and no browser.
      const verification = events.find((event) => event['action'] === 'document.verified');
      expect(verification?.['context']?.['ip']).toBeUndefined();
      expect(verification?.['context']?.['userAgent']).toBeUndefined();
    });

    it('limits verifications per address', async () => {
      const limited = createApp({
        config: { CORS_ALLOWED_ORIGINS: [ALLOWED_ORIGIN], TRUST_PROXY_HOPS: 1, APP_ENV: 'test' },
        logger: createLogger({ name: 'it-issuance-limit', level: 'silent' }),
        mongo: { health: () => Promise.resolve({ status: 'up', transactions: true }) },
        redis: { health: () => Promise.resolve({ status: 'up' }) },
        rateLimiter: new RateLimiterMemory({ points: 10_000, duration: 60 }),
        modules: [
          {
            basePath: '/public',
            router: verificationRouter({
              getService: services.issuance,
              limiter: new RateLimiterMemory({ points: 3, duration: 60 }),
            }),
          },
        ],
        actorResolver: () => Promise.resolve(undefined),
      });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await request(limited)
          .get(`/api/v1/public/verify/${'B'.repeat(43)}`)
          .expect(200);
      }
      const refused = await request(limited)
        .get(`/api/v1/public/verify/${'B'.repeat(43)}`)
        .expect(429);
      expect(refused.headers['retry-after']).toBeDefined();
    });
  });
});
