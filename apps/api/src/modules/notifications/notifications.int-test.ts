import {
  APPROVAL_AUDIT_ACTIONS,
  ScopeAssignmentSchema,
  type ActorContext,
  type Permission,
  type Reminder,
} from '@alola/contracts';
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
import { NotificationReminderDelivery } from '../../platform/reminder-delivery';
import { ApprovalService } from '../approval';
import { AUDIT_COLLECTION, AuditService } from '../audit';
import {
  ACCOUNT_GRANTS_COLLECTION,
  ROLES_COLLECTION,
  SecurityService,
  bootstrapGrant,
  bootstrapRole,
} from '../security';
import {
  NOTIFICATIONS_COLLECTION,
  NOTIFICATION_ATTEMPTS_COLLECTION,
  NOTIFICATION_PREFERENCES_COLLECTION,
  NotificationService,
  RetryableDeliveryError,
  SimulatedChannelAdapter,
  notificationAttemptModel,
  notificationRouter,
  renderNotification,
  type ChannelAdapter,
  type OutboundMessage,
} from './index';

/**
 * Notifications against a real MongoDB replica set (CORE-NOTIFY-001 … 005).
 *
 * The property that matters most is the last one: whatever fails, restarts or races, a person is told
 * once, and a provider is asked once per notification — with the same idempotency key every time.
 */
const gate = serviceGate(['mongodb']);
const RUN = `it-notify-${Date.now()}`;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const ACCOUNT_HEADER = 'x-test-account';
const label = (en: string) => ({ ar: `عربي ${en}`, en });

/** A connected test provider whose behaviour each test scripts. */
class ScriptedAdapter implements ChannelAdapter {
  readonly name = 'scripted';
  readonly connected = true;
  readonly keys: string[] = [];
  constructor(
    readonly channel: OutboundMessage['channel'],
    private readonly script: (call: number) => 'ok' | 'retry' | 'fail',
  ) {}
  send(message: OutboundMessage) {
    this.keys.push(message.idempotencyKey);
    const step = this.script(this.keys.length);
    if (step === 'retry') return Promise.reject(new RetryableDeliveryError('PROVIDER_BUSY'));
    if (step === 'fail') return Promise.reject(new RetryableDeliveryError('PROVIDER_DOWN'));
    return Promise.resolve({
      status: 'delivered' as const,
      providerReference: `p-${message.notificationId}`,
    });
  }
}

describe.skipIf(!gate.available)(`notifications — ${gate.reason}`, () => {
  let connection: Connection;
  let audit: AuditService;
  let security: SecurityService;
  let service: NotificationService;
  let app: Express;
  let clock: Date;
  let externalEnabled: boolean;
  let quiet: { start: string; end: string } | null;
  let consent: boolean;
  const inactive = new Set<string>();
  const adapters: Partial<Record<'email' | 'sms' | 'whatsapp', ChannelAdapter>> = {};

  const ALICE = `${RUN}-alice`;
  const BOB = `${RUN}-bob`;
  const OPERATOR = `${RUN}-operator`;
  const GONE = `${RUN}-gone`;

  const as = (accountId: string) => ({
    get: (path: string) => request(app).get(path).set(ACCOUNT_HEADER, accountId),
    post: (path: string) =>
      request(app).post(path).set(ACCOUNT_HEADER, accountId).set('Origin', ALLOWED_ORIGIN),
    put: (path: string) =>
      request(app).put(path).set(ACCOUNT_HEADER, accountId).set('Origin', ALLOWED_ORIGIN),
  });
  const rows = () => connection.collection(NOTIFICATIONS_COLLECTION);
  let key = 0;
  const dedupe = () => {
    key += 1;
    return `${RUN}-event-${key}`;
  };

  beforeAll(async () => {
    configureMongoose();
    const logger = createLogger({ name: 'it-notify', level: 'silent' });
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'] as string,
    });
    await connection.asPromise();
    await ensureIndexes(connection, logger);
    audit = new AuditService({ connection, logger, onRecorded: noteAuditWrite });
    security = new SecurityService({ connection, audit, logger });
    service = new NotificationService({
      connection,
      audit,
      logger,
      timeZone: 'Africa/Cairo',
      defaultLocale: 'ar',
      adapters,
      isActiveAccount: (accountId) => Promise.resolve(!inactive.has(accountId)),
      externalDeliveryEnabled: () => Promise.resolve(externalEnabled),
      quietHours: () => Promise.resolve(quiet),
      hasConsent: () => Promise.resolve(consent),
      now: () => clock,
    });
    const all = ScopeAssignmentSchema.parse({ level: 'all' });
    const grant = async (accountId: string, permissions: Permission[]) => {
      await bootstrapRole(connection, { key: `${accountId}-role`, name: label('r'), permissions });
      await bootstrapGrant(connection, {
        accountId,
        roleKeys: permissions.length ? [`${accountId}-role`] : [],
        scope: all,
        updatedBy: 'test',
      });
    };
    await grant(ALICE, []);
    await grant(BOB, []);
    await grant(OPERATOR, ['notification.viewDeliveries', 'notification.dispatch']);
    const actorResolver: ActorResolver = async (req) => {
      const accountId = req.get(ACCOUNT_HEADER);
      return accountId ? security.resolveActor(accountId) : undefined;
    };
    const modules: ApiModule[] = [
      { basePath: '/notifications', router: notificationRouter({ getService: () => service }) },
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
    clock = new Date('2026-09-28T10:00:00.000Z'); // 13:00 in Cairo
    externalEnabled = false;
    quiet = null;
    consent = false;
    inactive.clear();
    inactive.add(GONE);
    for (const channel of ['email', 'sms', 'whatsapp'] as const) delete adapters[channel];
    for (const name of [
      NOTIFICATIONS_COLLECTION,
      NOTIFICATION_ATTEMPTS_COLLECTION,
      NOTIFICATION_PREFERENCES_COLLECTION,
    ]) {
      await connection.collection(name).deleteMany({});
    }
  });

  afterAll(async () => {
    if (!connection) return;
    for (const name of [
      NOTIFICATIONS_COLLECTION,
      NOTIFICATION_ATTEMPTS_COLLECTION,
      NOTIFICATION_PREFERENCES_COLLECTION,
    ]) {
      await connection.collection(name).deleteMany({});
    }
    for (const name of ['approvalPolicies', 'approvalRequests', 'approvalDecisions']) {
      await connection.collection(name).deleteMany({
        $or: [{ key: { $regex: `^${RUN}` } }, { requesterAccountId: { $regex: `^${RUN}` } }],
      });
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

  /* ======================================================= CORE-NOTIFY-001 / 005 */

  it('delivers in-app notices at once, and never twice for one event', async () => {
    const event = dedupe();
    const input = {
      type: 'task.assigned' as const,
      recipients: { accountIds: [ALICE, BOB, GONE] },
      params: { title: 'Call the customer' },
      dedupeKey: event,
    };
    expect(await service.notify(input)).toEqual({ created: 2, duplicates: 0, skipped: 1 });
    expect(await service.notify(input)).toEqual({ created: 0, duplicates: 2, skipped: 1 });
    const alice = await as(ALICE).get('/api/v1/notifications/inbox').expect(200);
    expect(alice.body).toMatchObject({
      unread: 1,
      items: [{ type: 'task.assigned', state: 'delivered', read: false }],
    });
  });

  it("keeps each inbox to its owner: another person's notice is absent", async () => {
    await service.notify({
      type: 'task.overdue',
      recipients: { accountIds: [ALICE] },
      params: { title: 'x' },
      dedupeKey: dedupe(),
    });
    const [notice] = (await as(ALICE).get('/api/v1/notifications/inbox').expect(200)).body
      .items as { notificationId: string }[];
    await as(BOB).post(`/api/v1/notifications/${notice?.notificationId}/read`).expect(404);
    expect((await as(BOB).get('/api/v1/notifications/inbox').expect(200)).body.items).toEqual([]);
    const read = await as(ALICE)
      .post(`/api/v1/notifications/${notice?.notificationId}/read`)
      .expect(200);
    expect(read.body.read).toBe(true);
    expect(
      (await as(ALICE).get('/api/v1/notifications/unread-count').expect(200)).body.unread,
    ).toBe(0);
    await request(app).get('/api/v1/notifications/inbox').expect(401);
  });

  it('marks everything read in one audited action', async () => {
    for (let index = 0; index < 3; index += 1) {
      await service.notify({
        type: 'task.dueSoon',
        recipients: { accountIds: [ALICE] },
        params: { title: 't', dueOn: '01/10/2026' },
        dedupeKey: dedupe(),
      });
    }
    expect((await as(ALICE).post('/api/v1/notifications/read-all').expect(200)).body).toEqual({
      updated: 3,
    });
    expect(
      await connection
        .collection(AUDIT_COLLECTION)
        .countDocuments({ action: 'notification.readAll', 'actor.accountId': ALICE }),
    ).toBeGreaterThanOrEqual(1);
  });

  /* ========================================================== CORE-NOTIFY-002 / 003 */

  it('sends external messages only to people who opted in, in their language, and simulates them in test', async () => {
    const email = new SimulatedChannelAdapter('email', 'test');
    adapters.email = email;
    const notifyEmail = (event: string) =>
      service.notify({
        type: 'approval.pending',
        recipients: { accountIds: [ALICE] },
        params: { requestId: 'R-1' },
        dedupeKey: event,
        channels: ['inApp', 'email'],
      });
    expect(await notifyEmail(dedupe())).toMatchObject({ created: 1, skipped: 1 });

    await as(ALICE)
      .put('/api/v1/notifications/preferences')
      .send({ locale: 'en', channels: { email: true, sms: false, whatsapp: false } })
      .expect(200);
    await as(ALICE)
      .put('/api/v1/notifications/preferences')
      .send({ locale: 'fr', channels: { email: true, sms: false, whatsapp: false } })
      .expect(400);
    expect(await notifyEmail(dedupe())).toMatchObject({ created: 2, skipped: 0 });

    const swept = await as(OPERATOR).post('/api/v1/notifications/dispatch').expect(200);
    expect(swept.body).toMatchObject({ claimed: 1, simulated: 1, delivered: 0 });
    const external = await rows().findOne({ channel: 'email' });
    expect(external).toMatchObject({ state: 'simulated', locale: 'en' });
    const deliveries = await as(OPERATOR)
      .get('/api/v1/notifications/deliveries?channel=email')
      .expect(200);
    expect(deliveries.body.items[0]).toMatchObject({ state: 'simulated', attempts: 1 });
    await as(ALICE).get('/api/v1/notifications/deliveries').expect(403);
    await as(ALICE).post('/api/v1/notifications/dispatch').expect(403);
  });

  it('marks a channel with no provider undeliverable instead of losing the message', async () => {
    await service.notify({
      type: 'reminder.installmentDue',
      recipients: { customerIds: ['cus_1'] },
      text: { ar: 'نص', en: 'Text' },
      dedupeKey: dedupe(),
      channels: ['whatsapp'],
    });
    expect(await service.dispatchDue()).toMatchObject({ claimed: 1, undeliverable: 1 });
    expect(await rows().findOne({})).toMatchObject({
      state: 'undeliverable',
      lastErrorCode: 'CHANNEL_NOT_CONNECTED',
    });
  });

  it('never lets a real provider send while external delivery is off, or to a customer without consent', async () => {
    const provider = new ScriptedAdapter('sms', () => 'ok');
    adapters.sms = provider;
    await service.notify({
      type: 'reminder.installmentDue',
      recipients: { customerIds: ['cus_2'] },
      text: { ar: 'نص', en: 'Text' },
      dedupeKey: dedupe(),
      channels: ['sms'],
    });
    await service.dispatchDue();
    expect(await rows().findOne({})).toMatchObject({
      state: 'undeliverable',
      lastErrorCode: 'EXTERNAL_DELIVERY_DISABLED',
    });

    externalEnabled = true;
    await service.notify({
      type: 'reminder.installmentDue',
      recipients: { customerIds: ['cus_3'] },
      text: { ar: 'نص', en: 'Text' },
      dedupeKey: dedupe(),
      channels: ['sms'],
    });
    await service.dispatchDue();
    expect(await rows().findOne({ 'recipient.id': 'cus_3' })).toMatchObject({
      state: 'undeliverable',
      lastErrorCode: 'CONSENT_NOT_RECORDED',
    });
    expect(provider.keys).toEqual([]);

    consent = true;
    await service.notify({
      type: 'reminder.installmentDue',
      recipients: { customerIds: ['cus_4'] },
      text: { ar: 'نص', en: 'Text' },
      dedupeKey: dedupe(),
      channels: ['sms'],
    });
    await service.dispatchDue();
    expect(await rows().findOne({ 'recipient.id': 'cus_4' })).toMatchObject({ state: 'delivered' });
  });

  /* ================================================================ CORE-NOTIFY-004 */

  it('holds a non-urgent message for quiet hours in the organization timezone', async () => {
    quiet = { start: '22:00', end: '07:00' };
    clock = new Date('2026-09-28T21:30:00.000Z'); // 00:30 in Cairo (UTC+3)
    adapters.email = new SimulatedChannelAdapter('email', 'test');
    await as(ALICE)
      .put('/api/v1/notifications/preferences')
      .send({ locale: 'ar', channels: { email: true, sms: false, whatsapp: false } })
      .expect(200);
    await service.notify({
      type: 'task.overdue',
      recipients: { accountIds: [ALICE] },
      params: { title: 't' },
      dedupeKey: dedupe(),
      channels: ['email'],
    });
    const held = await rows().findOne({ channel: 'email' });
    expect(held?.['state']).toBe('deferred');
    expect((held?.['nextAttemptAt'] as Date).toISOString()).toBe('2026-09-29T04:00:00.000Z'); // 07:00 Cairo
    expect((await service.dispatchDue()).claimed).toBe(0);

    await service.notify({
      type: 'task.escalated',
      recipients: { accountIds: [ALICE] },
      params: { title: 'u' },
      dedupeKey: dedupe(),
      channels: ['email'],
      urgent: true,
    });
    expect((await service.dispatchDue()).claimed).toBe(1);

    clock = new Date('2026-09-29T04:00:30.000Z');
    expect(await service.dispatchDue()).toMatchObject({ claimed: 1, simulated: 1 });
  });

  /* ================================================================ CORE-NOTIFY-005 */

  it('retries with backoff and the same idempotency key, and delivers once', async () => {
    externalEnabled = true;
    consent = true;
    const provider = new ScriptedAdapter('email', (call) => (call < 3 ? 'retry' : 'ok'));
    adapters.email = provider;
    await service.notify({
      type: 'reminder.installmentDue',
      recipients: { customerIds: ['cus_5'] },
      text: { ar: 'نص', en: 'Text' },
      dedupeKey: dedupe(),
      channels: ['email'],
    });
    expect(await service.dispatchDue()).toMatchObject({ retrying: 1 });
    // Not yet due again: backoff holds it.
    expect((await service.dispatchDue()).claimed).toBe(0);
    clock = new Date(clock.getTime() + 61_000);
    expect(await service.dispatchDue()).toMatchObject({ retrying: 1 });
    clock = new Date(clock.getTime() + 121_000);
    expect(await service.dispatchDue()).toMatchObject({ delivered: 1 });
    expect(new Set(provider.keys).size).toBe(1);
    expect(provider.keys).toHaveLength(3);
    const stored = await rows().findOne({ 'recipient.id': 'cus_5' });
    expect(
      await connection
        .collection(NOTIFICATION_ATTEMPTS_COLLECTION)
        .countDocuments({ notificationId: stored?.['notificationId'] }),
    ).toBe(3);
  });

  it('gives up after the last attempt and keeps the message as failed', async () => {
    externalEnabled = true;
    consent = true;
    adapters.email = new ScriptedAdapter('email', () => 'fail');
    await service.notify({
      type: 'reminder.installmentDue',
      recipients: { customerIds: ['cus_6'] },
      text: { ar: 'نص', en: 'Text' },
      dedupeKey: dedupe(),
      channels: ['email'],
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await service.dispatchDue();
      clock = new Date(clock.getTime() + 60 * 60_000);
    }
    expect(await rows().findOne({})).toMatchObject({
      state: 'failed',
      attempts: 5,
      lastErrorCode: 'PROVIDER_DOWN',
    });
    expect((await service.dispatchDue()).claimed).toBe(0);
  });

  it('recovers a message whose dispatcher died mid-send, with the same key', async () => {
    const email = new SimulatedChannelAdapter('email', 'test');
    adapters.email = email;
    await service.notify({
      type: 'reminder.installmentDue',
      recipients: { customerIds: ['cus_7'] },
      text: { ar: 'نص', en: 'Text' },
      dedupeKey: dedupe(),
      channels: ['email'],
    });
    // A dispatcher claimed it and vanished.
    await rows().updateOne(
      {},
      { $set: { state: 'sending', attempts: 1, leaseUntil: new Date(clock.getTime() + 60_000) } },
    );
    expect((await service.dispatchDue()).claimed).toBe(0);
    clock = new Date(clock.getTime() + 61_000);
    expect(await service.dispatchDue()).toMatchObject({ claimed: 1, simulated: 1 });
    expect(email.distinctMessages).toBe(1);
  });

  it('lets parallel dispatchers attempt each message exactly once', async () => {
    const email = new SimulatedChannelAdapter('email', 'test');
    adapters.email = email;
    for (let index = 0; index < 12; index += 1) {
      await service.notify({
        type: 'reminder.installmentDue',
        recipients: { customerIds: [`cus_p${index}`] },
        text: { ar: 'نص', en: 'Text' },
        dedupeKey: dedupe(),
        channels: ['email'],
      });
    }
    const results = await Promise.all([
      service.dispatchDue(),
      service.dispatchDue(),
      service.dispatchDue(),
    ]);
    expect(results.reduce((sum, result) => sum + result.claimed, 0)).toBe(12);
    expect(await connection.collection(NOTIFICATION_ATTEMPTS_COLLECTION).countDocuments()).toBe(12);
    expect(email.distinctMessages).toBe(12);
    await expect(notificationAttemptModel(connection).deleteMany({})).rejects.toThrow();
  });

  /* ======================================================================= wiring */

  it("renders a notice in the recipient's language", () => {
    expect(renderNotification('approval.pending', 'en', { requestId: 'R-9' })).toEqual({
      title: 'An approval awaits you',
      body: 'Request R-9 is waiting for your decision.',
    });
    expect(renderNotification('approval.pending', 'ar', { requestId: 'R-9' }).body).toContain(
      'R-9',
    );
  });

  it('delivers reminders through the foundation — simulated, deduplicated, never sent', async () => {
    const whatsapp = new SimulatedChannelAdapter('whatsapp', 'test');
    adapters.whatsapp = whatsapp;
    const delivery = new NotificationReminderDelivery(
      () => service,
      () => false,
    );
    const reminder = {
      reminderId: 'rem_00000000000000000000000000000001',
      customerId: 'cus_00000000000000000000000000000001',
      channel: 'whatsapp',
      messageAr: 'تذكير',
      messageEn: 'Reminder',
    } as Reminder;
    const first = await delivery.deliver(reminder);
    const second = await delivery.deliver(reminder);
    expect(first).toMatchObject({ accepted: true });
    expect(second.reference).toBe(first.reference);
    expect(delivery.connected).toBe(false);
    expect(await rows().countDocuments({ type: 'reminder.installmentDue' })).toBe(1);
    expect(await rows().findOne({})).toMatchObject({ state: 'simulated', channel: 'whatsapp' });
    expect(whatsapp.distinctMessages).toBe(1);
  });

  it('tells the approver when an approval opens, and the requester when it is decided', async () => {
    await bootstrapRole(connection, {
      key: `${RUN}-r-approval`,
      name: label('approval'),
      permissions: [
        'approval.policy.create',
        'approval.policy.publish',
        'approval.request.create',
        'approval.request.view',
        'approval.request.approve',
      ],
    });
    for (const accountId of [ALICE, BOB]) {
      await bootstrapGrant(connection, {
        accountId,
        roleKeys: [`${RUN}-r-approval`],
        scope: ScopeAssignmentSchema.parse({ level: 'all' }),
        updatedBy: 'test',
      });
    }
    const approvals = new ApprovalService({
      connection,
      logger: createLogger({ name: 'it-notify-approval', level: 'silent' }),
      audit,
      accountsWithPermission: (permission) => security.accountsWithPermission(permission),
      resolveActor: (accountId) => security.resolveActor(accountId),
      events: {
        publish: async (event) => {
          if (event.state === 'pending') {
            await service.notify({
              type: 'approval.pending',
              recipients: { accountIds: event.pendingApproverAccountIds },
              params: { requestId: event.requestId },
              dedupeKey: `approval:${event.requestId}:${event.stageOrder}:pending`,
            });
          } else if (
            event.requesterAccountId &&
            event.action !== APPROVAL_AUDIT_ACTIONS.requestEscalated
          ) {
            await service.notify({
              type: 'approval.decided',
              recipients: { accountIds: [event.requesterAccountId] },
              params: { requestId: event.requestId },
              dedupeKey: `approval:${event.requestId}:decided:${event.state}`,
            });
          }
        },
      },
    });
    const actorOf = async (accountId: string): Promise<ActorContext> => {
      const actor = await security.resolveActor(accountId);
      if (!actor) throw new Error('no actor');
      return actor;
    };
    const context = { correlationId: `${RUN}-approval` };
    const operationType = `test.${RUN.replace(/[^a-z0-9]/g, '')}.notify`;
    const policy = await approvals.createPolicy(
      await actorOf(BOB),
      {
        key: `${RUN}-policy`,
        name: label('p'),
        operationType,
        stages: [
          {
            order: 1,
            name: label('s'),
            approvers: { kind: 'accounts', accountIds: [BOB] },
            rule: 'any',
          },
        ],
      } as never,
      context,
    );
    await approvals.publishPolicy(await actorOf(BOB), `${RUN}-policy`, policy.version, context);
    const submitted = await approvals.submit(
      await actorOf(ALICE),
      {
        operationType,
        source: { type: 'test', id: `${RUN}-src` },
        scope: {},
        context: {},
        summary: [],
        idempotencyKey: `${RUN}-submit`,
      },
      context,
    );
    expect(await rows().findOne({ type: 'approval.pending' })).toMatchObject({
      recipient: { id: BOB },
    });
    await approvals.decide(
      await actorOf(BOB),
      submitted.request.requestId,
      'approved',
      {},
      context,
    );
    expect(await rows().findOne({ type: 'approval.decided' })).toMatchObject({
      recipient: { id: ALICE },
    });
  });
});
