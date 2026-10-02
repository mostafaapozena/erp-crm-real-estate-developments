import { loadApiConfig } from '@alola/config';
import { type ActorContext } from '@alola/contracts';
import { createLogger } from '@alola/security';
import { serviceGate } from '@alola/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDomainServices, type DomainServices } from '../../platform/domain-services';
import { ensureIndexes } from '../../platform/indexes';
import { configureMongoose } from '../../platform/mongo';
import { withTransaction } from '../../platform/transactions';
import { COUNTERS_COLLECTION as SALES_COUNTERS_COLLECTION } from '../sales';
import {
  ISSUED_NUMBERS_COLLECTION,
  NUMBER_COUNTERS_COLLECTION,
  NUMBER_SEQUENCES_COLLECTION,
} from './index';

/**
 * Official numbering continuing the legacy series (SALE-RESERVE-006, CORE-DOC-001), through the real
 * composition root: the numbering engine reads the sales module's legacy counters when a format is
 * activated.
 *
 * Pinned here: a format of the legacy shape starts after the last legacy number of each year, so no
 * number is ever issued twice; a format of another shape starts its own series; the activation audit
 * says which happened; concurrent issues are distinct and consecutive; an issue inside a transaction
 * that aborts leaves no number behind; and statements have a sequence type of their own.
 */
const gate = serviceGate(['mongodb']);
const RUN = `it-continuation-${Date.now()}`;

const legacyShape = {
  prefix: 'RSV',
  separator: '-',
  dateComponent: 'yyyy',
  branchComponent: false,
  projectComponent: false,
  padding: 5,
  resetPolicy: 'yearly',
  startAt: 1,
  effectiveFrom: '2026-01-01',
} as const;

describe.skipIf(!gate.available)(`legacy series continuation — ${gate.reason}`, () => {
  let connection: Connection;
  let services: DomainServices;
  const admin: ActorContext = {
    kind: 'account',
    accountId: `${RUN}-admin`,
    roleKeys: [],
    permissions: ['numbering.view', 'numbering.manage'],
    scope: {
      level: 'all',
      teamIds: [],
      departmentIds: [],
      branchIds: [],
      projectIds: [],
      legalEntityIds: [],
    },
  } as unknown as ActorContext;
  const context = { correlationId: `${RUN}-context` };
  let keyCounter = 0;
  const key = () => `${RUN}-${(keyCounter += 1)}`;

  const clean = async () => {
    for (const name of [
      NUMBER_SEQUENCES_COLLECTION,
      NUMBER_COUNTERS_COLLECTION,
      ISSUED_NUMBERS_COLLECTION,
      SALES_COUNTERS_COLLECTION,
    ]) {
      await connection.collection(name).deleteMany({});
    }
  };

  beforeAll(async () => {
    configureMongoose();
    const logger = createLogger({ name: 'it-continuation', level: 'silent' });
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
  }, 60_000);

  beforeEach(clean);

  afterAll(async () => {
    if (!connection) return;
    await clean();
    await connection.close();
  });

  const issue = (type: 'reservation' | 'contract' | 'customerStatement') =>
    services
      .numbering()
      .issue(
        { accountId: admin.accountId },
        {
          type,
          issueDate: '2026-10-01' as never,
          idempotencyKey: key(),
          source: { type, id: key() },
        },
      )
      .then((issued) => issued.number);

  it('continues the legacy series when the format reproduces its shape', async () => {
    // The legacy series has issued up to RSV-2026-00041, and 2025 up to RSV-2025-00007.
    await connection.collection(SALES_COUNTERS_COLLECTION).insertMany([
      { key: 'RSV-2026', value: 41 },
      { key: 'RSV-2025', value: 7 },
      { key: 'CTR-2026', value: 3 },
    ]);
    const draft = await services
      .numbering()
      .createDraft(admin, { type: 'reservation', ...legacyShape } as never, context);
    expect(draft).toMatchObject({ continuesLegacySeries: true, example: 'RSV-2026-00001' });
    await services
      .numbering()
      .activate(admin, 'reservation', draft.version, 'adopt the official series', context);

    const preview = await services
      .numbering()
      .preview({ type: 'reservation', issueDate: '2026-10-01' as never });
    expect(preview.next).toBe('RSV-2026-00042');
    expect(await issue('reservation')).toBe('RSV-2026-00042');
    expect(await issue('reservation')).toBe('RSV-2026-00043');
    const lastYear = await services
      .numbering()
      .preview({ type: 'reservation', issueDate: '2025-12-31' as never })
      .catch((error: unknown) => error);
    // The format is effective from 2026; the earlier year is not numbered by it at all.
    expect(lastYear).toBeInstanceOf(Error);

    const audit = await connection
      .collection('auditEvents')
      .find({ 'target.id': `reservation@${draft.version}`, action: 'numbering.sequence.activated' })
      .toArray();
    expect(JSON.stringify(audit[0]?.['changes'])).toContain('2026:41');
  });

  it('starts its own series when the format cannot render a legacy number', async () => {
    await connection.collection(SALES_COUNTERS_COLLECTION).insertOne({ key: 'CTR-2026', value: 9 });
    const draft = await services.numbering().createDraft(
      admin,
      {
        type: 'contract',
        ...legacyShape,
        prefix: 'CTR',
        separator: '/',
        padding: 6,
      } as never,
      context,
    );
    expect(draft.continuesLegacySeries).toBe(false);
    await services.numbering().activate(admin, 'contract', draft.version, 'new series', context);
    expect(await issue('contract')).toBe('CTR/2026/000001');
  });

  it('tells salespeople the configured validity periods, and nothing assumed when unset', async () => {
    const settings = services.settings();
    const current = await settings.getSetting('sales.quotationValidityDays');
    expect((await services.salesDefaults()).quotationValidityDays).toBe(current.value);
    try {
      const saved = await settings.updateSetting(
        admin,
        'sales.quotationValidityDays',
        { value: 21, expectedVersion: current.version, reason: 'integration fixture' },
        context,
      );
      expect(await services.salesDefaults()).toMatchObject({
        quotationValidityDays: 21,
        decisions: { reservationValidityDays: 'BD-01', quotationValidityDays: 'BD-36' },
      });
      await settings.updateSetting(
        admin,
        'sales.quotationValidityDays',
        { value: null, expectedVersion: saved.version, reason: 'integration fixture restored' },
        context,
      );
    } finally {
      expect((await services.salesDefaults()).quotationValidityDays).toBeNull();
    }
  });

  it('issues distinct consecutive numbers under concurrency, and none for an aborted document', async () => {
    await connection
      .collection(SALES_COUNTERS_COLLECTION)
      .insertOne({ key: 'STM-2026', value: 12 });
    const draft = await services
      .numbering()
      .createDraft(
        admin,
        { type: 'customerStatement', ...legacyShape, prefix: 'STM' } as never,
        context,
      );
    expect(draft.continuesLegacySeries).toBe(true);
    await services
      .numbering()
      .activate(
        admin,
        'customerStatement',
        draft.version,
        'statements numbered officially',
        context,
      );

    const numbers = await Promise.all(Array.from({ length: 6 }, () => issue('customerStatement')));
    expect(new Set(numbers).size).toBe(6);
    expect([...numbers].sort()).toEqual([
      'STM-2026-00013',
      'STM-2026-00014',
      'STM-2026-00015',
      'STM-2026-00016',
      'STM-2026-00017',
      'STM-2026-00018',
    ]);

    // A document that fails inside its transaction takes its number with it.
    await expect(
      withTransaction(connection, async (session) => {
        await services.numbering().issue(
          { accountId: admin.accountId },
          {
            type: 'customerStatement',
            issueDate: '2026-10-01' as never,
            idempotencyKey: key(),
            source: { type: 'customerStatement', id: key() },
          },
          session,
        );
        throw new Error('document failed');
      }),
    ).rejects.toThrow('document failed');
    expect(await issue('customerStatement')).toBe('STM-2026-00019');
  });
});
