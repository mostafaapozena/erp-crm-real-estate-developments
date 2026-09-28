import {
  DEFAULT_LOCALE,
  NOTIFICATION_AUDIT_ACTIONS,
  NOTIFICATION_MAX_ATTEMPTS,
  NotificationSchema,
  type ActorContext,
  type DispatchResult,
  type Locale,
  type Notification,
  type NotificationChannel,
  type NotificationPreferences,
  type NotificationState,
  type NotificationType,
} from '@alola/contracts';
import { resources, type ResourceTree } from '@alola/i18n';
import { assertSafeFilter, type Logger } from '@alola/security';
import type { Connection } from 'mongoose';
import {
  auditActor,
  invalid,
  isDuplicateKeyError,
  notFound,
  type AuditRecorder,
  type RequestContext,
} from '../../platform/audit-port';
import { newId } from '../../platform/ids';
import {
  ChannelNotConnectedError,
  PermanentDeliveryError,
  RetryableDeliveryError,
  UnconfiguredChannelAdapter,
  quietHoursRelease,
  type ChannelAdapter,
  type DeliveryOutcome,
  type OutboundMessage,
} from './adapters';
import {
  notificationAttemptModel,
  notificationModel,
  notificationPreferencesModel,
  type NotificationDocument,
  type NotificationPreferencesDocument,
} from './model';

/**
 * Notifications (CORE-NOTIFY-001 … 005).
 *
 * `notify` records what should reach whom; `dispatchDue` delivers what is due. In-app notices are
 * delivered the moment they are created — the row is the inbox. External messages wait for the
 * dispatcher, respect quiet hours unless urgent, retry with backoff, and end `delivered`, `simulated`,
 * `failed` or `undeliverable` — never silently lost, and never sent twice.
 */
export interface NotificationServiceOptions {
  connection: Connection;
  audit: AuditRecorder;
  logger?: Logger;
  /** Organization timezone, for quiet hours (ADR-0008). */
  timeZone: string;
  defaultLocale?: Locale;
  adapters?: Partial<Record<'email' | 'sms' | 'whatsapp', ChannelAdapter>>;
  /** Only an active account receives anything; an offboarded one is skipped. */
  isActiveAccount?: (accountId: string) => Promise<boolean>;
  /** The `feature.notifications.externalDelivery` flag. A real provider sends nothing while it is off. */
  externalDeliveryEnabled?: () => Promise<boolean>;
  /** The `notifications.quietHours` setting (`SD-21`). */
  quietHours?: () => Promise<{ start: string; end: string } | null>;
  /**
   * Whether a customer consented to a channel. Absent means consent is not recorded anywhere yet
   * (`SD-09`), so a **real** provider never messages a customer.
   */
  hasConsent?: (customerId: string, channel: 'email' | 'sms' | 'whatsapp') => Promise<boolean>;
  now?: () => Date;
}

export interface NotifyInput {
  type: NotificationType;
  recipients: { accountIds?: readonly string[]; customerIds?: readonly string[] };
  params?: Record<string, string>;
  /** Caller-composed text in both languages, for messages whose words are the caller's. */
  text?: { ar: string; en: string };
  source?: { type: string; id: string };
  /** One logical event. The same key never notifies the same recipient on the same channel twice. */
  dedupeKey: string;
  channels?: readonly NotificationChannel[];
  urgent?: boolean;
  correlationId?: string;
}

const LEASE_MS = 60_000;
const iso = (date: Date) => date.toISOString();

function toNotification(document: NotificationDocument): Notification {
  return NotificationSchema.parse({
    notificationId: document.notificationId,
    type: document.type,
    channel: document.channel,
    locale: document.locale,
    params: document.params ?? {},
    ...(document.source ? { source: { type: document.source.type, id: document.source.id } } : {}),
    state: document.state,
    read: document.readAt !== undefined,
    createdAt: iso(document.createdAt),
    ...(document.readAt ? { readAt: iso(document.readAt) } : {}),
  });
}

/** The type's words in a language, with `{{param}}` filled in — the same resource the web reads. */
export function renderNotification(
  type: NotificationType,
  locale: Locale,
  params: Record<string, string>,
): { title: string; body: string } {
  const common = resources[locale].common as unknown as Record<string, ResourceTree | undefined>;
  const lookup = (group: string) => {
    let node: ResourceTree | string | undefined = common[group];
    for (const part of type.split('.')) node = typeof node === 'object' ? node[part] : undefined;
    return typeof node === 'string' ? node : type;
  };
  const fill = (text: string) =>
    text.replace(/\{\{\s*([a-zA-Z0-9]+)\s*\}\}/g, (_match, key: string) => params[key] ?? '');
  return { title: fill(lookup('notificationTitle')), body: fill(lookup('notificationBody')) };
}

export class NotificationService {
  private readonly notifications;
  private readonly attempts;
  private readonly preferences;
  private readonly now: () => Date;

  constructor(private readonly options: NotificationServiceOptions) {
    this.notifications = notificationModel(options.connection);
    this.attempts = notificationAttemptModel(options.connection);
    this.preferences = notificationPreferencesModel(options.connection);
    this.now = options.now ?? (() => new Date());
  }

  private adapterFor(channel: 'email' | 'sms' | 'whatsapp'): ChannelAdapter {
    return this.options.adapters?.[channel] ?? new UnconfiguredChannelAdapter(channel);
  }

  private async preferencesOf(accountId: string): Promise<NotificationPreferences> {
    const stored = await this.preferences
      .findOne({ accountId })
      .lean<NotificationPreferencesDocument>()
      .exec();
    return stored
      ? { locale: stored.locale, channels: { ...stored.channels } }
      : {
          locale: this.options.defaultLocale ?? DEFAULT_LOCALE,
          channels: { email: false, sms: false, whatsapp: false },
        };
  }

  /* --------------------------------------------------------------- creating */

  /**
   * Record a notification for every recipient and channel. Idempotent: replaying the same
   * `dedupeKey` creates nothing new. Inactive accounts are skipped; an account receives an external
   * message only if it opted into that channel; customers receive external messages only.
   */
  async notify(
    input: NotifyInput,
  ): Promise<{ created: number; duplicates: number; skipped: number }> {
    const channels = input.channels ?? ['inApp'];
    const now = this.now();
    const quiet = input.urgent
      ? undefined
      : quietHoursRelease(now, this.options.timeZone, (await this.options.quietHours?.()) ?? null);
    const rows: Omit<NotificationDocument, 'notificationId'>[] = [];
    let skipped = 0;

    for (const accountId of input.recipients.accountIds ?? []) {
      if (this.options.isActiveAccount && !(await this.options.isActiveAccount(accountId))) {
        skipped += channels.length;
        continue;
      }
      const preferences = await this.preferencesOf(accountId);
      for (const channel of channels) {
        if (channel !== 'inApp' && !preferences.channels[channel]) {
          skipped += 1;
          continue;
        }
        rows.push(
          this.row(
            input,
            { kind: 'account', id: accountId },
            channel,
            preferences.locale,
            now,
            quiet,
          ),
        );
      }
    }
    for (const customerId of input.recipients.customerIds ?? []) {
      for (const channel of channels) {
        // A customer has no inbox: in-app is for people who use the product.
        if (channel === 'inApp') {
          skipped += 1;
          continue;
        }
        rows.push(
          this.row(
            input,
            { kind: 'customer', id: customerId },
            channel,
            this.options.defaultLocale ?? DEFAULT_LOCALE,
            now,
            quiet,
          ),
        );
      }
    }

    let created = 0;
    let duplicates = 0;
    for (const row of rows) {
      try {
        await this.notifications.create([{ ...row, notificationId: newId('ntf') }]);
        created += 1;
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        duplicates += 1;
      }
    }
    return { created, duplicates, skipped };
  }

  private row(
    input: NotifyInput,
    recipient: NotificationDocument['recipient'],
    channel: NotificationChannel,
    locale: Locale,
    now: Date,
    quietUntil: Date | undefined,
  ): Omit<NotificationDocument, 'notificationId'> {
    const external = channel !== 'inApp';
    const state: NotificationState = external ? (quietUntil ? 'deferred' : 'pending') : 'delivered';
    return {
      dedupeKey: `${input.dedupeKey}|${recipient.kind}:${recipient.id}|${channel}`,
      type: input.type,
      channel,
      recipient,
      locale,
      params: input.params ?? {},
      ...(input.text ? { text: input.text } : {}),
      ...(input.source ? { source: input.source } : {}),
      urgent: input.urgent ?? false,
      state,
      attempts: 0,
      ...(external ? { nextAttemptAt: quietUntil ?? now } : { deliveredAt: now }),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      createdAt: now,
      updatedAt: now,
    };
  }

  /* ------------------------------------------------------------- dispatching */

  /**
   * Deliver what is due (CORE-NOTIFY-005). Each notification is **claimed** with a lease before any
   * attempt, so two dispatchers never send the same one; a dispatcher that dies mid-send leaves a lease
   * that expires, and the next sweep retries with the **same** idempotency key. Idempotent to run twice.
   */
  async dispatchDue(limit = 100): Promise<DispatchResult> {
    const result: DispatchResult = {
      claimed: 0,
      delivered: 0,
      simulated: 0,
      retrying: 0,
      failed: 0,
      undeliverable: 0,
    };
    for (let index = 0; index < limit; index += 1) {
      const now = this.now();
      const claimed = await this.notifications
        .findOneAndUpdate(
          {
            channel: { $ne: 'inApp' },
            $or: [
              { state: { $in: ['pending', 'deferred'] }, nextAttemptAt: { $lte: now } },
              { state: 'sending', leaseUntil: { $lt: now } },
            ],
          },
          {
            $set: {
              state: 'sending',
              leaseUntil: new Date(now.getTime() + LEASE_MS),
              updatedAt: now,
            },
            $inc: { attempts: 1 },
          },
          { sort: { nextAttemptAt: 1 }, returnDocument: 'after' },
        )
        .lean<NotificationDocument>()
        .exec();
      if (!claimed) break;
      result.claimed += 1;
      const outcome = await this.attempt(claimed);
      result[outcome] += 1;
    }
    return result;
  }

  /** The dispatcher run by a person or the scheduler, with its outcome recorded (AUDIT-003). */
  async sweep(actor: ActorContext, context: RequestContext, limit = 100): Promise<DispatchResult> {
    const result = await this.dispatchDue(limit);
    await this.options.audit.record({
      action: NOTIFICATION_AUDIT_ACTIONS.dispatched,
      outcome: 'succeeded',
      actor: auditActor(actor),
      target: { type: 'notificationQueue' },
      changes: Object.entries(result).map(([path, value]) => ({ path, to: String(value) })),
      context,
    });
    return result;
  }

  private async attempt(
    notification: NotificationDocument,
  ): Promise<'delivered' | 'simulated' | 'retrying' | 'failed' | 'undeliverable'> {
    const channel = notification.channel as 'email' | 'sms' | 'whatsapp';
    const adapter = this.adapterFor(channel);
    const now = this.now();

    const finish = async (
      state: NotificationState,
      attemptOutcome: 'delivered' | 'simulated' | 'retryable' | 'permanent' | 'notConnected',
      extra: { errorCode?: string; providerReference?: string; nextAttemptAt?: Date } = {},
    ) => {
      try {
        await this.attempts.create([
          {
            notificationId: notification.notificationId,
            attempt: notification.attempts,
            channel,
            adapter: adapter.name,
            outcome: attemptOutcome,
            ...(extra.errorCode ? { errorCode: extra.errorCode } : {}),
            ...(extra.providerReference ? { providerReference: extra.providerReference } : {}),
            at: now,
          },
        ]);
      } catch (error) {
        // The attempt was already recorded by a dispatcher that died after recording it.
        if (!isDuplicateKeyError(error)) throw error;
      }
      await this.notifications
        .updateOne(
          { notificationId: notification.notificationId, state: 'sending' },
          {
            $set: {
              state,
              updatedAt: now,
              ...(extra.errorCode ? { lastErrorCode: extra.errorCode } : {}),
              ...(extra.providerReference ? { providerReference: extra.providerReference } : {}),
              ...(state === 'delivered' || state === 'simulated' ? { deliveredAt: now } : {}),
              ...(extra.nextAttemptAt ? { nextAttemptAt: extra.nextAttemptAt } : {}),
            },
            $unset: { leaseUntil: 1 },
          },
        )
        .exec();
    };

    // A real provider sends nothing while the deployment has not switched external delivery on, and
    // never to a customer whose consent is not recorded.
    if (adapter.connected) {
      if (!(await this.options.externalDeliveryEnabled?.())) {
        await finish('undeliverable', 'notConnected', { errorCode: 'EXTERNAL_DELIVERY_DISABLED' });
        return 'undeliverable';
      }
      if (
        notification.recipient.kind === 'customer' &&
        !(await this.options.hasConsent?.(notification.recipient.id, channel))
      ) {
        await finish('undeliverable', 'permanent', { errorCode: 'CONSENT_NOT_RECORDED' });
        return 'undeliverable';
      }
    }

    const words = notification.text
      ? { title: '', body: notification.text[notification.locale] }
      : renderNotification(notification.type, notification.locale, notification.params ?? {});
    const message: OutboundMessage = {
      notificationId: notification.notificationId,
      idempotencyKey: notification.notificationId,
      channel,
      recipient: notification.recipient,
      locale: notification.locale,
      title: words.title,
      body: words.body,
    };

    let outcome: DeliveryOutcome;
    try {
      outcome = await adapter.send(message);
    } catch (error) {
      if (error instanceof ChannelNotConnectedError) {
        await finish('undeliverable', 'notConnected', { errorCode: 'CHANNEL_NOT_CONNECTED' });
        return 'undeliverable';
      }
      if (
        error instanceof RetryableDeliveryError &&
        notification.attempts < NOTIFICATION_MAX_ATTEMPTS
      ) {
        const backoffMs = (error.retryAfterSeconds ?? 60 * 2 ** (notification.attempts - 1)) * 1000;
        await finish('pending', 'retryable', {
          errorCode: error.errorCode,
          nextAttemptAt: new Date(now.getTime() + backoffMs),
        });
        return 'retrying';
      }
      const code =
        error instanceof RetryableDeliveryError || error instanceof PermanentDeliveryError
          ? error.errorCode
          : 'ADAPTER_ERROR';
      this.options.logger?.warn(
        { notificationId: notification.notificationId, channel, code },
        'Notification delivery failed permanently',
      );
      await finish('failed', 'permanent', { errorCode: code });
      return 'failed';
    }
    if (outcome.status === 'simulated') {
      await finish('simulated', 'simulated', { providerReference: outcome.providerReference });
      return 'simulated';
    }
    await finish('delivered', 'delivered', { providerReference: outcome.providerReference });
    return 'delivered';
  }

  /**
   * Create one external message and dispatch it at once — for a person's explicit action, such as the
   * reminder centre's "send" button. Returns the notification's final state.
   */
  async sendNow(input: NotifyInput & { channels: readonly ('email' | 'sms' | 'whatsapp')[] }) {
    await this.notify({ ...input, urgent: true });
    const [recipientKind, recipientId] = input.recipients.customerIds?.[0]
      ? ['customer', input.recipients.customerIds[0]]
      : ['account', input.recipients.accountIds?.[0] ?? ''];
    const dedupeKey = `${input.dedupeKey}|${recipientKind}:${recipientId}|${input.channels[0]}`;
    assertSafeFilter({ dedupeKey });
    const pending = await this.notifications
      .findOne({ dedupeKey })
      .lean<NotificationDocument>()
      .exec();
    if (!pending) return undefined;
    if (pending.state === 'pending' || pending.state === 'deferred') {
      const claimed = await this.notifications
        .findOneAndUpdate(
          { dedupeKey, state: { $in: ['pending', 'deferred'] } },
          {
            $set: {
              state: 'sending',
              leaseUntil: new Date(this.now().getTime() + LEASE_MS),
              updatedAt: this.now(),
            },
            $inc: { attempts: 1 },
          },
          { returnDocument: 'after' },
        )
        .lean<NotificationDocument>()
        .exec();
      if (claimed) await this.attempt(claimed);
    }
    const final = await this.notifications
      .findOne({ dedupeKey })
      .lean<NotificationDocument>()
      .exec();
    return final
      ? {
          notificationId: final.notificationId,
          state: final.state,
          ...(final.providerReference ? { providerReference: final.providerReference } : {}),
        }
      : undefined;
  }

  /* ------------------------------------------------------------------ inbox */

  async inbox(
    accountId: string,
    query: { unreadOnly?: boolean; limit: number; cursor?: string },
  ): Promise<{ items: Notification[]; unread: number; nextCursor?: string }> {
    assertSafeFilter({ accountId });
    const base = { 'recipient.kind': 'account', 'recipient.id': accountId, channel: 'inApp' };
    let filter: Record<string, unknown> = {
      ...base,
      ...(query.unreadOnly ? { readAt: { $exists: false } } : {}),
    };
    if (query.cursor) {
      const [time, id] = Buffer.from(query.cursor, 'base64url').toString('utf8').split('|');
      const at = time ? new Date(time) : undefined;
      if (!at || Number.isNaN(at.getTime()) || !id) throw invalid('CURSOR_INVALID', ['cursor']);
      filter = {
        $and: [
          filter,
          { $or: [{ createdAt: { $lt: at } }, { createdAt: at, notificationId: { $lt: id } }] },
        ],
      };
    }
    const [rows, unread] = await Promise.all([
      this.notifications
        .find(filter)
        .sort({ createdAt: -1, notificationId: -1 })
        .limit(query.limit + 1)
        .lean<NotificationDocument[]>()
        .exec(),
      this.unreadCount(accountId),
    ]);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toNotification),
      unread,
      ...(rows.length > query.limit && last
        ? {
            nextCursor: Buffer.from(
              `${iso(last.createdAt)}|${last.notificationId}`,
              'utf8',
            ).toString('base64url'),
          }
        : {}),
    };
  }

  async unreadCount(accountId: string): Promise<number> {
    assertSafeFilter({ accountId });
    return this.notifications
      .countDocuments({
        'recipient.kind': 'account',
        'recipient.id': accountId,
        channel: 'inApp',
        readAt: { $exists: false },
      })
      .exec();
  }

  /** Mark one of **the caller's own** notices read. Anyone else's is answered as absent. */
  async markRead(
    actor: ActorContext,
    notificationId: string,
    context: RequestContext,
  ): Promise<Notification> {
    assertSafeFilter({ notificationId });
    const now = this.now();
    const own = {
      notificationId,
      'recipient.kind': 'account' as const,
      'recipient.id': actor.accountId,
      channel: 'inApp' as const,
    };
    // The first read wins; reading again changes nothing.
    await this.notifications
      .updateOne({ ...own, readAt: { $exists: false } }, { $set: { readAt: now, updatedAt: now } })
      .exec();
    const updated = await this.notifications.findOne(own).lean<NotificationDocument>().exec();
    if (!updated) throw notFound();
    await this.options.audit.record({
      action: NOTIFICATION_AUDIT_ACTIONS.read,
      outcome: 'succeeded',
      actor: auditActor(actor),
      target: { type: 'notification', id: notificationId },
      context,
    });
    return toNotification(updated);
  }

  async markAllRead(actor: ActorContext, context: RequestContext): Promise<{ updated: number }> {
    const now = this.now();
    const result = await this.notifications
      .updateMany(
        {
          'recipient.kind': 'account',
          'recipient.id': actor.accountId,
          channel: 'inApp',
          readAt: { $exists: false },
        },
        { $set: { readAt: now, updatedAt: now } },
      )
      .exec();
    await this.options.audit.record({
      action: NOTIFICATION_AUDIT_ACTIONS.readAll,
      outcome: 'succeeded',
      actor: auditActor(actor),
      target: { type: 'notificationInbox', id: actor.accountId },
      changes: [{ path: 'marked', to: String(result.modifiedCount) }],
      context,
    });
    return { updated: result.modifiedCount };
  }

  async getPreferences(accountId: string): Promise<NotificationPreferences> {
    return this.preferencesOf(accountId);
  }

  async setPreferences(
    actor: ActorContext,
    preferences: NotificationPreferences,
    context: RequestContext,
  ): Promise<NotificationPreferences> {
    const before = await this.preferencesOf(actor.accountId);
    await this.preferences
      .updateOne(
        { accountId: actor.accountId },
        {
          $set: {
            locale: preferences.locale,
            channels: preferences.channels,
            updatedAt: this.now(),
          },
        },
        { upsert: true },
      )
      .exec();
    await this.options.audit.record({
      action: NOTIFICATION_AUDIT_ACTIONS.preferencesChanged,
      outcome: 'succeeded',
      actor: auditActor(actor),
      target: { type: 'notificationPreferences', id: actor.accountId },
      changes: [
        { path: 'locale', from: before.locale, to: preferences.locale },
        ...(['email', 'sms', 'whatsapp'] as const).map((channel) => ({
          path: `channels.${channel}`,
          from: String(before.channels[channel]),
          to: String(preferences.channels[channel]),
        })),
      ],
      context,
    });
    return preferences;
  }

  /** Delivery state for operations: channel, state, attempts, last error — never the text. */
  async deliveries(query: {
    state?: NotificationState;
    channel?: NotificationChannel;
    limit: number;
  }) {
    const filter: Record<string, unknown> = {};
    if (query.state) filter['state'] = query.state;
    if (query.channel) filter['channel'] = query.channel;
    assertSafeFilter(filter);
    const rows = await this.notifications
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(query.limit)
      .lean<NotificationDocument[]>()
      .exec();
    return rows.map((row) => ({
      notificationId: row.notificationId,
      type: row.type,
      channel: row.channel,
      recipient: { kind: row.recipient.kind, id: row.recipient.id },
      state: row.state,
      attempts: row.attempts,
      ...(row.lastErrorCode ? { lastErrorCode: row.lastErrorCode } : {}),
      ...(row.nextAttemptAt && (row.state === 'pending' || row.state === 'deferred')
        ? { nextAttemptAt: iso(row.nextAttemptAt) }
        : {}),
      createdAt: iso(row.createdAt),
      ...(row.deliveredAt ? { deliveredAt: iso(row.deliveredAt) } : {}),
    }));
  }
}
