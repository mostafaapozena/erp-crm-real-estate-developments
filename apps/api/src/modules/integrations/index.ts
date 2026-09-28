/**
 * Integration foundation published interface (INTEGRATION-001 … 005, ADR-0010).
 *
 * A provider's adapter implements `IntegrationAdapter` and is registered at the composition root.
 * Modules record outbound operations through `IntegrationService.enqueue` and never call a provider
 * themselves. No adapter is registered in this build.
 */
export {
  INTEGRATION_CONNECTIONS_COLLECTION,
  INTEGRATION_OUTBOX_COLLECTION,
  WEBHOOK_INBOX_COLLECTION,
  connectionModel,
  outboxModel,
  webhookModel,
} from './model';
export { RetryableIntegrationError, signHmacSha256, verifyHmacSha256 } from './adapters';
export type { AdapterCheck, IntegrationAdapter, WebhookHandling } from './adapters';
export { IntegrationService } from './service';
export type { IntegrationServiceOptions } from './service';
export { integrationRouter, webhookRouter } from './router';
export type { IntegrationRouterOptions } from './router';
