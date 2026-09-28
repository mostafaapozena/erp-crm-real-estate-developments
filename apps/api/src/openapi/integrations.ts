import {
  ConnectionToggleSchema,
  INTEGRATION_PROVIDERS,
  IntegrationConnectionSchema,
  IntegrationSweepResultSchema,
  SetCredentialsSchema,
  WEBHOOK_MAX_BYTES,
} from '@alola/contracts';
import { z } from 'zod';
import { pathParameter, requestBody, type OpenApiHelpers, type PathMap } from './shared';

/** Schemas the integration foundation contributes (INTEGRATION-001 … 005). */
export const integrationComponents = {
  IntegrationConnection: IntegrationConnectionSchema,
  IntegrationConnectionList: z.strictObject({ items: z.array(IntegrationConnectionSchema) }),
  SetCredentials: SetCredentialsSchema,
  ConnectionToggle: ConnectionToggleSchema,
  IntegrationSweepResult: IntegrationSweepResultSchema,
  WebhookReceipt: z.strictObject({ received: z.literal(true), duplicate: z.boolean().optional() }),
} as const;

export function integrationPaths(h: OpenApiHelpers): PathMap {
  const provider = [pathParameter('provider', `One of: ${INTEGRATION_PROVIDERS.join(', ')}`)];
  const conflict = {
    '409': h.json('ErrorResponse', 'No adapter, not configured, disabled, or a stale version'),
  };
  return {
    '/api/v1/integrations': {
      get: {
        operationId: 'listIntegrations',
        summary: 'Every provider slot, its state and health',
        description:
          'Requires the administrative integration.view. Says whether credentials are set and when — ' +
          'never the credentials. A provider with no adapter in this build reads noAdapter.',
        responses: {
          '200': h.json('IntegrationConnectionList', 'The registry'),
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/integrations/{provider}': {
      get: {
        operationId: 'getIntegration',
        summary: 'One provider: state, pinned and recorded API version, health, freshness',
        parameters: provider,
        responses: {
          '200': h.json('IntegrationConnection', 'The provider'),
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/integrations/{provider}/credentials': {
      put: {
        operationId: 'setIntegrationCredentials',
        summary: 'Store a provider’s credentials, encrypted',
        description:
          'Requires the administrative integration.manage. Exactly the names the adapter declares; ' +
          'encrypted at rest; the audit record names them without their values; the adapter’s ' +
          'pinned API version is recorded. Refused (503) where no encryption key is configured.',
        parameters: provider,
        requestBody: requestBody(h.ref('SetCredentials')),
        responses: {
          '200': h.json('IntegrationConnection', 'The provider'),
          ...conflict,
          '503': h.json(
            'ErrorResponse',
            'No encryption key is configured (SERVICE_NOT_CONFIGURED)',
          ),
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/integrations/{provider}/disable': {
      post: {
        operationId: 'disableIntegration',
        summary: 'Switch a provider off; credentials are kept',
        parameters: provider,
        requestBody: requestBody(h.ref('ConnectionToggle')),
        responses: {
          '200': h.json('IntegrationConnection', 'The provider'),
          ...conflict,
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/integrations/{provider}/enable': {
      post: {
        operationId: 'enableIntegration',
        summary: 'Switch a provider back on',
        parameters: provider,
        requestBody: requestBody(h.ref('ConnectionToggle')),
        responses: {
          '200': h.json('IntegrationConnection', 'The provider'),
          ...conflict,
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/integrations/{provider}/check': {
      post: {
        operationId: 'checkIntegration',
        summary: 'Ask the adapter whether the stored credentials work',
        parameters: provider,
        responses: {
          '200': h.json('IntegrationConnection', 'The provider, with the result recorded'),
          ...conflict,
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/integrations/sweep': {
      post: {
        operationId: 'sweepIntegrations',
        summary: 'Process received webhooks and deliver pending outbound operations, now',
        description:
          'Requires the administrative integration.process. Each row is claimed under a lease; ' +
          'failures back off; after five attempts a row is kept as failed (the dead letter).',
        responses: {
          '200': h.json('IntegrationSweepResult', 'What the sweep did'),
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/webhooks/{provider}': {
      post: {
        operationId: 'receiveWebhook',
        summary: 'A provider’s webhook delivery',
        description:
          'Public; authenticated only by the provider’s signature, verified on the raw bytes ' +
          `before anything is parsed or stored. At most ${String(WEBHOOK_MAX_BYTES)} bytes. A repeated ` +
          'provider event ID is acknowledged and discarded. Processing happens later.',
        parameters: provider,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: {
          '202': h.json('WebhookReceipt', 'Accepted for processing'),
          '200': h.json('WebhookReceipt', 'A repeat, acknowledged and discarded'),
          '401': h.json('ErrorResponse', 'The signature did not verify'),
          '404': h.json('ErrorResponse', 'The provider is not connected'),
          ...h.standardErrors,
        },
      },
    },
  };
}
