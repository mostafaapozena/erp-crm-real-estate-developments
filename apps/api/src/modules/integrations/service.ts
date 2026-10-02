import {
  INTEGRATION_AUDIT_ACTIONS,
  INTEGRATION_MAX_ATTEMPTS,
  INTEGRATION_PROVIDERS,
  IntegrationConnectionSchema,
  type ActorContext,
  type IntegrationConnection,
  type IntegrationProvider,
  type IntegrationSweepResult,
} from '@alola/contracts';
import type { Encryptor } from '@alola/security';
import type { ClientSession, Connection } from 'mongoose';
import type { Logger } from 'pino';
import {
  auditActor,
  conflict,
  invalid,
  isDuplicateKeyError,
  notFound,
  type AuditRecorder,
  type RequestContext,
} from '../../platform/audit-port';
import { newId } from '../../platform/ids';
import { withTransaction } from '../../platform/transactions';
import { RetryableIntegrationError, type IntegrationAdapter } from './adapters';
import {
  connectionModel,
  outboxModel,
  webhookModel,
  type ConnectionDocument,
  type OutboxDocument,
  type WebhookDocument,
} from './model';

/**
 * The integration foundation (INTEGRATION-001 … 005, ADR-0010).
 *
 * It owns the registry, the webhook inbox and the outbox; adapters own everything provider-specific.
 * With no adapter registered — this build — every provider reads `noAdapter`, credentials cannot be
 * stored for it, its webhook endpoint answers 404, and an outbound operation waits as `held`.
 */
export interface IntegrationServiceOptions {
  connection: Connection;
  audit: AuditRecorder;
  encryptor: Encryptor;
  adapters: readonly IntegrationAdapter[];
  logger?: Logger;
  now?: () => Date;
}

const LEASE_MS = 60_000;
const HELD_RETRY_MS = 15 * 60_000;
const PROCESSED_RETENTION_DAYS = 30;
const SWEEP_BATCH = 100;

const iso = (date: Date | undefined) => (date ? date.toISOString() : undefined);

/** Exponential backoff with ±10 % jitter, capped at an hour (ADR-0010). */
function backoff(attempt: number): number {
  const base = Math.min(30_000 * 2 ** (attempt - 1), 3_600_000);
  return Math.round(base * (0.9 + Math.random() * 0.2));
}

function errorCode(error: unknown): string {
  if (error instanceof RetryableIntegrationError) return error.code;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)
    ? code
    : 'PROCESSING_FAILED';
}

export class IntegrationService {
  private readonly connections;
  private readonly inbox;
  private readonly outbox;
  private readonly now: () => Date;
  private readonly adapters: ReadonlyMap<IntegrationProvider, IntegrationAdapter>;

  constructor(private readonly options: IntegrationServiceOptions) {
    this.connections = connectionModel(options.connection);
    this.inbox = webhookModel(options.connection);
    this.outbox = outboxModel(options.connection);
    this.now = options.now ?? (() => new Date());
    this.adapters = new Map(options.adapters.map((adapter) => [adapter.provider, adapter]));
  }

  /* ---------------------------------------------------------------- registry */

  private toConnection(
    provider: IntegrationProvider,
    document: ConnectionDocument | undefined,
  ): IntegrationConnection {
    const adapter = this.adapters.get(provider);
    const now = this.now();
    const freshness =
      !adapter || !document?.lastSyncAt
        ? 'unknown'
        : now.getTime() - document.lastSyncAt.getTime() > adapter.staleAfterMinutes * 60_000
          ? 'stale'
          : 'fresh';
    const state = !adapter
      ? 'noAdapter'
      : !document || (!document.credentials && document.state !== 'disabled')
        ? 'notConfigured'
        : document.state;
    return IntegrationConnectionSchema.parse({
      provider,
      state,
      ...(adapter ? { adapterApiVersion: adapter.apiVersion } : {}),
      ...(document?.recordedApiVersion ? { recordedApiVersion: document.recordedApiVersion } : {}),
      versionMismatch: Boolean(
        adapter &&
        document?.recordedApiVersion &&
        document.recordedApiVersion !== adapter.apiVersion,
      ),
      hasCredentials: Boolean(document?.credentials),
      ...(document?.credentialsUpdatedAt
        ? { credentialsUpdatedAt: iso(document.credentialsUpdatedAt) }
        : {}),
      scopes: document?.scopes ?? [],
      health: {
        ...(document?.checkedAt ? { checkedAt: iso(document.checkedAt) } : {}),
        ...(document?.tokenValidUntil ? { tokenValidUntil: iso(document.tokenValidUntil) } : {}),
        ...(document?.lastSyncAt ? { lastSyncAt: iso(document.lastSyncAt) } : {}),
        ...(document?.lastErrorCode ? { lastErrorCode: document.lastErrorCode } : {}),
        ...(document?.lastErrorAt ? { lastErrorAt: iso(document.lastErrorAt) } : {}),
        freshness,
      },
      version: document?.version ?? 0,
    });
  }

  async list(): Promise<IntegrationConnection[]> {
    const rows = await this.connections.find().lean<ConnectionDocument[]>().exec();
    const byProvider = new Map(rows.map((row) => [row.provider, row]));
    return INTEGRATION_PROVIDERS.map((provider) =>
      this.toConnection(provider, byProvider.get(provider)),
    );
  }

  async get(provider: IntegrationProvider): Promise<IntegrationConnection> {
    const row = await this.connections.findOne({ provider }).lean<ConnectionDocument>().exec();
    return this.toConnection(provider, row ?? undefined);
  }

  private async credentialsOf(document: ConnectionDocument): Promise<Record<string, string>> {
    if (!document.credentials) return {};
    const bytes = await this.options.encryptor.decrypt(document.credentials, {
      purpose: 'integration-credentials',
      provider: document.provider,
    });
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, string>;
  }

  private async record(
    actor: ActorContext,
    action: string,
    provider: IntegrationProvider,
    context: RequestContext,
    extra: { changes?: { path: string; from?: string; to?: string }[]; reason?: string } = {},
    session?: ClientSession,
  ) {
    await this.options.audit.record(
      {
        action,
        outcome: 'succeeded',
        actor: auditActor(actor),
        target: { type: 'integration', id: provider },
        ...(extra.changes ? { changes: extra.changes } : {}),
        ...(extra.reason ? { reason: extra.reason } : {}),
        context,
      },
      session ? { session } : undefined,
    );
  }

  /**
   * Store a provider's credentials, encrypted (INTEGRATION-001), and record the adapter's pinned API
   * version (INTEGRATION-002). Only the names the adapter declares are accepted, all of them are
   * required, and the audit record names them without their values. Without a configured key — any
   * environment before `SEC-033` — the encryptor refuses and nothing is stored.
   */
  async setCredentials(
    actor: ActorContext,
    provider: IntegrationProvider,
    input: { expectedVersion: number; credentials: Record<string, string>; scopes: string[] },
    context: RequestContext,
  ): Promise<IntegrationConnection> {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw conflict('NO_ADAPTER', ['provider']);
    const names = Object.keys(input.credentials);
    const unknown = names.find((name) => !adapter.credentialNames.includes(name));
    if (unknown) throw invalid('UNKNOWN_CREDENTIAL', ['body', 'credentials', unknown]);
    const missing = adapter.credentialNames.find((name) => !names.includes(name));
    if (missing) throw invalid('MISSING_CREDENTIAL', ['body', 'credentials', missing]);

    const encrypted = await this.options.encryptor.encrypt(
      Buffer.from(JSON.stringify(input.credentials), 'utf8'),
      { purpose: 'integration-credentials', provider },
    );
    const now = this.now();
    try {
      const updated = await withTransaction(this.options.connection, async (session) => {
        const row = await this.connections
          .findOneAndUpdate(
            { provider, version: input.expectedVersion },
            {
              $set: {
                state: 'configured',
                credentials: { ...encrypted },
                credentialsUpdatedAt: now,
                recordedApiVersion: adapter.apiVersion,
                scopes: input.scopes,
                updatedAt: now,
                updatedBy: actor.accountId,
              },
              $unset: { lastErrorCode: 1, lastErrorAt: 1 },
              $inc: { version: 1 },
            },
            { returnDocument: 'after', upsert: input.expectedVersion === 0, session },
          )
          .lean<ConnectionDocument>()
          .exec();
        if (!row) throw conflict('STALE_VERSION', ['body', 'expectedVersion']);
        await this.record(
          actor,
          INTEGRATION_AUDIT_ACTIONS.credentialsSet,
          provider,
          context,
          {
            changes: [
              { path: 'credentials', to: names.sort().join(',') },
              { path: 'apiVersion', to: adapter.apiVersion },
            ],
          },
          session,
        );
        return row;
      });
      return this.toConnection(provider, updated);
    } catch (error) {
      // An upsert racing an existing row, or a stale version 0: both are a conflict, not a 500.
      if (isDuplicateKeyError(error)) throw conflict('STALE_VERSION', ['body', 'expectedVersion']);
      throw error;
    }
  }

  async setEnabled(
    actor: ActorContext,
    provider: IntegrationProvider,
    enabled: boolean,
    input: { expectedVersion: number; reason: string },
    context: RequestContext,
  ): Promise<IntegrationConnection> {
    if (!this.adapters.has(provider)) throw conflict('NO_ADAPTER', ['provider']);
    const updated = await withTransaction(this.options.connection, async (session) => {
      const row = await this.connections
        .findOneAndUpdate(
          {
            provider,
            version: input.expectedVersion,
            state: enabled ? 'disabled' : { $ne: 'disabled' },
          },
          {
            $set: {
              state: enabled ? 'configured' : 'disabled',
              updatedAt: this.now(),
              updatedBy: actor.accountId,
            },
            $inc: { version: 1 },
          },
          { returnDocument: 'after', session },
        )
        .lean<ConnectionDocument>()
        .exec();
      if (!row) throw conflict('STALE_VERSION', ['body', 'expectedVersion']);
      await this.record(
        actor,
        enabled ? INTEGRATION_AUDIT_ACTIONS.enabled : INTEGRATION_AUDIT_ACTIONS.disabled,
        provider,
        context,
        { reason: input.reason },
        session,
      );
      return row;
    });
    return this.toConnection(provider, updated);
  }

  /** Ask the adapter whether the stored credentials work, and record the answer (INTEGRATION-003). */
  async check(
    actor: ActorContext,
    provider: IntegrationProvider,
    context: RequestContext,
  ): Promise<IntegrationConnection> {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw conflict('NO_ADAPTER', ['provider']);
    const row = await this.connections.findOne({ provider }).lean<ConnectionDocument>().exec();
    if (!row?.credentials) throw conflict('NOT_CONFIGURED', ['provider']);
    if (row.state === 'disabled') throw conflict('INTEGRATION_DISABLED', ['provider']);
    let result;
    try {
      result = await adapter.check(await this.credentialsOf(row));
    } catch (error) {
      result = { ok: false, errorCode: errorCode(error) };
    }
    const now = this.now();
    const updated = await this.connections
      .findOneAndUpdate(
        { provider },
        {
          $set: {
            state: result.ok ? 'configured' : 'error',
            checkedAt: now,
            ...(result.tokenValidUntil ? { tokenValidUntil: result.tokenValidUntil } : {}),
            ...(result.ok
              ? {}
              : { lastErrorCode: result.errorCode ?? 'CHECK_FAILED', lastErrorAt: now }),
          },
          ...(result.ok ? { $unset: { lastErrorCode: 1 } } : {}),
        },
        { returnDocument: 'after' },
      )
      .lean<ConnectionDocument>()
      .exec();
    await this.record(actor, INTEGRATION_AUDIT_ACTIONS.checked, provider, context, {
      changes: [{ path: 'ok', to: String(result.ok) }],
    });
    return this.toConnection(provider, updated ?? row);
  }

  /** A successful synchronisation, reported by the adapter's module (INTEGRATION-003 freshness). */
  async recordSync(provider: IntegrationProvider, at: Date = this.now()): Promise<void> {
    await this.connections.updateOne({ provider }, { $set: { lastSyncAt: at } }).exec();
  }

  /* ---------------------------------------------------------------- webhooks */

  /**
   * Take one webhook delivery (INTEGRATION-004, INTEGRATION-005). The signature is checked on the raw
   * bytes **before** they are parsed or stored; an invalid one is recorded and refused. A valid one is
   * stored once — a repeat of the provider's event ID is acknowledged and discarded — and processed
   * later by the sweep, so a slow domain operation can never make the provider retry.
   */
  async receiveWebhook(
    provider: IntegrationProvider,
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
    context: RequestContext,
  ): Promise<'accepted' | 'duplicate' | 'rejected'> {
    const adapter = this.adapters.get(provider);
    const row = await this.connections.findOne({ provider }).lean<ConnectionDocument>().exec();
    // No adapter, no credentials or switched off: the endpoint does not exist.
    if (!adapter?.webhook || !row?.credentials || row.state === 'disabled') throw notFound();

    const verified = adapter.webhook.verify(
      rawBody,
      headers,
      await this.credentialsOf(row),
      this.now(),
    );
    if (!verified) {
      await this.options.audit.record({
        action: INTEGRATION_AUDIT_ACTIONS.webhookRejected,
        outcome: 'denied',
        actor: { kind: 'anonymous' },
        target: { type: 'integration', id: provider },
        reason: 'signature did not verify',
        context,
      });
      this.options.logger?.warn({ provider }, 'webhook signature rejected');
      return 'rejected';
    }

    const now = this.now();
    try {
      await withTransaction(this.options.connection, async (session) => {
        const eventId = newId('whk');
        await this.inbox.create(
          [
            {
              eventId,
              provider,
              providerEventId: verified.providerEventId,
              eventType: verified.eventType,
              payload: verified.payload,
              state: 'received',
              attempts: 0,
              nextAttemptAt: now,
              receivedAt: now,
            },
          ],
          { session },
        );
        await this.options.audit.record(
          {
            action: INTEGRATION_AUDIT_ACTIONS.webhookAccepted,
            outcome: 'succeeded',
            actor: { kind: 'system' },
            target: { type: 'webhookEvent', id: eventId },
            changes: [
              { path: 'provider', to: provider },
              { path: 'providerEventId', to: verified.providerEventId.slice(0, 200) },
              { path: 'eventType', to: verified.eventType.slice(0, 200) },
            ],
            context,
          },
          { session },
        );
      });
      return 'accepted';
    } catch (error) {
      if (isDuplicateKeyError(error)) return 'duplicate';
      throw error;
    }
  }

  /* ------------------------------------------------------------------ outbox */

  /**
   * Record an outbound operation, inside the caller's transaction when one is given, so the business
   * change and the intent to tell the provider commit together. The same idempotency key twice is one
   * operation.
   */
  async enqueue(
    input: {
      provider: IntegrationProvider;
      operation: string;
      payload: unknown;
      idempotencyKey: string;
    },
    session?: ClientSession,
  ): Promise<{ outboxId: string; duplicate: boolean }> {
    const outboxId = newId('obx');
    try {
      await this.outbox.create(
        [
          {
            outboxId,
            provider: input.provider,
            operation: input.operation,
            idempotencyKey: input.idempotencyKey,
            payload: input.payload,
            state: 'pending',
            attempts: 0,
            nextAttemptAt: this.now(),
            createdAt: this.now(),
          },
        ],
        session ? { session } : {},
      );
      return { outboxId, duplicate: false };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const existing = await this.outbox
        .findOne({ idempotencyKey: input.idempotencyKey })
        .lean<OutboxDocument>()
        .exec();
      return { outboxId: existing?.outboxId ?? outboxId, duplicate: true };
    }
  }

  /* ------------------------------------------------------------------- sweep */

  /**
   * Process received webhooks and deliver pending outbound operations. Each row is claimed under a
   * lease, so parallel sweeps never handle one twice and a crashed sweep's rows come back; failures
   * back off and, after the last attempt, stay as `failed` — the dead letter, kept for an operator.
   */
  async sweep(actor: ActorContext, context: RequestContext): Promise<IntegrationSweepResult> {
    const result: IntegrationSweepResult = {
      webhooksProcessed: 0,
      webhooksFailed: 0,
      outboxSent: 0,
      outboxHeld: 0,
      outboxRetrying: 0,
      outboxFailed: 0,
    };
    for (let index = 0; index < SWEEP_BATCH; index += 1) {
      const outcome = await this.processOneWebhook();
      if (outcome === 'none') break;
      if (outcome === 'processed') result.webhooksProcessed += 1;
      if (outcome === 'failed') result.webhooksFailed += 1;
    }
    for (let index = 0; index < SWEEP_BATCH; index += 1) {
      const outcome = await this.deliverOne();
      if (outcome === 'none') break;
      if (outcome === 'sent') result.outboxSent += 1;
      if (outcome === 'held') result.outboxHeld += 1;
      if (outcome === 'retrying') result.outboxRetrying += 1;
      if (outcome === 'failed') result.outboxFailed += 1;
    }
    await this.options.audit.record({
      action: INTEGRATION_AUDIT_ACTIONS.swept,
      outcome: 'succeeded',
      actor: auditActor(actor),
      target: { type: 'integration' },
      changes: Object.entries(result).map(([path, value]) => ({ path, to: String(value) })),
      context,
    });
    return result;
  }

  private async processOneWebhook(): Promise<'none' | 'processed' | 'retrying' | 'failed'> {
    const now = this.now();
    const claimed = await this.inbox
      .findOneAndUpdate(
        {
          $or: [
            { state: 'received', nextAttemptAt: { $lte: now } },
            { state: 'processing', leaseUntil: { $lte: now } },
          ],
        },
        {
          $set: { state: 'processing', leaseUntil: new Date(now.getTime() + LEASE_MS) },
          $inc: { attempts: 1 },
        },
        { returnDocument: 'after', sort: { nextAttemptAt: 1 } },
      )
      .lean<WebhookDocument>()
      .exec();
    if (!claimed) return 'none';
    const handler = this.adapters.get(claimed.provider)?.webhook;
    try {
      if (!handler) throw new RetryableIntegrationError('NO_ADAPTER');
      await handler.process({
        providerEventId: claimed.providerEventId,
        eventType: claimed.eventType,
        payload: claimed.payload,
      });
      await this.inbox
        .updateOne(
          { eventId: claimed.eventId, state: 'processing' },
          {
            $set: {
              state: 'processed',
              processedAt: now,
              purgeAfter: new Date(now.getTime() + PROCESSED_RETENTION_DAYS * 86_400_000),
            },
            $unset: { leaseUntil: 1, lastErrorCode: 1 },
          },
        )
        .exec();
      return 'processed';
    } catch (error) {
      const last = claimed.attempts >= INTEGRATION_MAX_ATTEMPTS;
      await this.inbox
        .updateOne(
          { eventId: claimed.eventId, state: 'processing' },
          {
            $set: {
              state: last ? 'failed' : 'received',
              lastErrorCode: errorCode(error),
              nextAttemptAt: new Date(now.getTime() + backoff(claimed.attempts)),
            },
            $unset: { leaseUntil: 1 },
          },
        )
        .exec();
      this.options.logger?.warn(
        { provider: claimed.provider, eventId: claimed.eventId, code: errorCode(error) },
        'webhook processing failed',
      );
      return last ? 'failed' : 'retrying';
    }
  }

  private async deliverOne(): Promise<'none' | 'sent' | 'held' | 'retrying' | 'failed'> {
    const now = this.now();
    const claimed = await this.outbox
      .findOneAndUpdate(
        {
          $or: [
            { state: { $in: ['pending', 'held'] }, nextAttemptAt: { $lte: now } },
            { state: 'sending', leaseUntil: { $lte: now } },
          ],
        },
        { $set: { state: 'sending', leaseUntil: new Date(now.getTime() + LEASE_MS) } },
        { returnDocument: 'after', sort: { nextAttemptAt: 1 } },
      )
      .lean<OutboxDocument>()
      .exec();
    if (!claimed) return 'none';

    const adapter = this.adapters.get(claimed.provider);
    const row = await this.connections
      .findOne({ provider: claimed.provider })
      .lean<ConnectionDocument>()
      .exec();
    // Nothing to deliver through: held, not failed, and not counted as an attempt.
    if (!adapter?.perform || !row?.credentials || row.state === 'disabled') {
      await this.outbox
        .updateOne(
          { outboxId: claimed.outboxId, state: 'sending' },
          {
            $set: {
              state: 'held',
              lastErrorCode: !adapter?.perform ? 'NO_ADAPTER' : 'NOT_CONFIGURED',
              nextAttemptAt: new Date(now.getTime() + HELD_RETRY_MS),
            },
            $unset: { leaseUntil: 1 },
          },
        )
        .exec();
      return 'held';
    }

    const attempt = claimed.attempts + 1;
    try {
      const sent = await adapter.perform(
        claimed.operation,
        claimed.payload,
        claimed.idempotencyKey,
        await this.credentialsOf(row),
      );
      await this.outbox
        .updateOne(
          { outboxId: claimed.outboxId, state: 'sending' },
          {
            $set: {
              state: 'sent',
              attempts: attempt,
              sentAt: now,
              ...(sent.providerReference ? { providerReference: sent.providerReference } : {}),
            },
            $unset: { leaseUntil: 1, lastErrorCode: 1 },
          },
        )
        .exec();
      return 'sent';
    } catch (error) {
      const retryable = error instanceof RetryableIntegrationError;
      const last = !retryable || attempt >= INTEGRATION_MAX_ATTEMPTS;
      await this.outbox
        .updateOne(
          { outboxId: claimed.outboxId, state: 'sending' },
          {
            $set: {
              state: last ? 'failed' : 'pending',
              attempts: attempt,
              lastErrorCode: errorCode(error),
              nextAttemptAt: new Date(now.getTime() + backoff(attempt)),
            },
            $unset: { leaseUntil: 1 },
          },
        )
        .exec();
      return last ? 'failed' : 'retrying';
    }
  }
}
