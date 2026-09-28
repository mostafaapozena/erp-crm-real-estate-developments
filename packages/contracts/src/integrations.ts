import { z } from 'zod';
import { RecordIdSchema } from './identifiers';
import { InstantSchema } from './time';

/**
 * Integration foundation (INTEGRATION-001 … 005, ADR-0010).
 *
 * Every external provider is reached through an adapter. This foundation is what every adapter plugs
 * into, and it is complete **with no provider connected**:
 *
 * - **Registry** (001). One entry per provider slot. Credentials are encrypted at rest and never
 *   leave the server — a response says only whether they are set, and when.
 * - **Pinned API version** (002). An adapter declares the provider API version it targets; the
 *   registry records it at connection time and reports a mismatch instead of upgrading silently.
 * - **Health** (003). Connection state, token validity, last sync, last error and a fresh/stale
 *   verdict, per provider.
 * - **Webhooks** (004, 005). The signature is verified **before** anything is parsed or stored; a
 *   provider event ID is stored once and a repeat is acknowledged and discarded; processing happens
 *   later, never inside the provider's request.
 * - **Outbox**. An outbound operation is recorded with its idempotency key and delivered by a
 *   dispatcher, so a retry never becomes a second message or a second charge.
 */

export const INTEGRATION_PROVIDERS = [
  'whatsapp',
  'metaMarketing',
  'metaConversions',
  'email',
  'sms',
  'paymentGateway',
  'eInvoicing',
  'bankStatements',
  'maps',
] as const;
export const IntegrationProviderSchema = z.enum(INTEGRATION_PROVIDERS);
export type IntegrationProvider = z.infer<typeof IntegrationProviderSchema>;

export const CONNECTION_STATES = [
  /** No adapter exists in this build for the provider. */
  'noAdapter',
  /** An adapter exists; no credentials are stored. */
  'notConfigured',
  /** Credentials stored; not yet checked, or checked and healthy. */
  'configured',
  /** The last check failed. */
  'error',
  /** Switched off by an administrator; credentials kept. */
  'disabled',
] as const;
export const ConnectionStateSchema = z.enum(CONNECTION_STATES);
export type ConnectionState = z.infer<typeof ConnectionStateSchema>;

export const FRESHNESS = ['fresh', 'stale', 'unknown'] as const;

export const IntegrationConnectionSchema = z.strictObject({
  provider: IntegrationProviderSchema,
  state: ConnectionStateSchema,
  /** The API version the running adapter is pinned to. Absent when no adapter exists. */
  adapterApiVersion: z.string().optional(),
  /** The API version recorded when credentials were stored. */
  recordedApiVersion: z.string().optional(),
  versionMismatch: z.boolean(),
  hasCredentials: z.boolean(),
  credentialsUpdatedAt: InstantSchema.optional(),
  scopes: z.array(z.string()),
  health: z.strictObject({
    checkedAt: InstantSchema.optional(),
    tokenValidUntil: InstantSchema.optional(),
    lastSyncAt: InstantSchema.optional(),
    lastErrorCode: z.string().optional(),
    lastErrorAt: InstantSchema.optional(),
    freshness: z.enum(FRESHNESS),
  }),
  version: z.number().int().nonnegative(),
});
export type IntegrationConnection = z.infer<typeof IntegrationConnectionSchema>;

/** Credentials are an opaque map of named secrets; the adapter says which names it needs. */
export const SetCredentialsSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  credentials: z
    .record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/), z.string().min(1).max(4096))
    .refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 10, {
      message: 'CREDENTIALS_EXPECTED',
    }),
  scopes: z.array(z.string().min(1).max(100)).max(50).default([]),
});

export const ConnectionToggleSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(3).max(300),
});

export const WEBHOOK_STATES = ['received', 'processing', 'processed', 'failed'] as const;
export const WebhookStateSchema = z.enum(WEBHOOK_STATES);

export const WebhookEventSchema = z.strictObject({
  eventId: RecordIdSchema,
  provider: IntegrationProviderSchema,
  providerEventId: z.string(),
  eventType: z.string(),
  state: WebhookStateSchema,
  attempts: z.number().int().nonnegative(),
  lastErrorCode: z.string().optional(),
  receivedAt: InstantSchema,
  processedAt: InstantSchema.optional(),
});

export const OUTBOX_STATES = ['pending', 'sending', 'sent', 'failed', 'held'] as const;
export const OutboxStateSchema = z.enum(OUTBOX_STATES);

export const IntegrationSweepResultSchema = z.strictObject({
  webhooksProcessed: z.number().int().nonnegative(),
  webhooksFailed: z.number().int().nonnegative(),
  outboxSent: z.number().int().nonnegative(),
  outboxHeld: z.number().int().nonnegative(),
  outboxRetrying: z.number().int().nonnegative(),
  outboxFailed: z.number().int().nonnegative(),
});
export type IntegrationSweepResult = z.infer<typeof IntegrationSweepResultSchema>;

/** Attempts before a webhook or an outbound operation is kept as failed (a dead letter). */
export const INTEGRATION_MAX_ATTEMPTS = 5;
/** Largest webhook body accepted — the API's JSON limit, so every content type is bounded alike. */
export const WEBHOOK_MAX_BYTES = 100 * 1024;

export const INTEGRATION_AUDIT_ACTIONS = {
  credentialsSet: 'integration.credentialsSet',
  disabled: 'integration.disabled',
  enabled: 'integration.enabled',
  checked: 'integration.checked',
  webhookRejected: 'integration.webhookRejected',
  webhookAccepted: 'integration.webhookAccepted',
  swept: 'integration.swept',
} as const;
