import {
  ConnectionToggleSchema,
  IntegrationProviderSchema,
  SetCredentialsSchema,
  WEBHOOK_MAX_BYTES,
} from '@alola/contracts';
import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors';
import { requirePermission, type GuardOptions } from '../../http/actor';
import { markAuditExempt } from '../../http/audit-context';
import { rawBodyOf } from '../../http/raw-body';
import { requestContextOf, requireActor } from '../../http/request-context';
import { validate, validated } from '../../http/validate';
import type { IntegrationService } from './service';

/**
 * Integration HTTP surface (INTEGRATION-001 … 005).
 *
 * The registry is administrative: `integration.view` to read state and health (never a secret),
 * `integration.manage` to store credentials or switch a provider off, `integration.process` to run
 * the sweep by hand. Webhooks are public by nature and authenticated by their signature alone.
 */
export interface IntegrationRouterOptions {
  getService: () => IntegrationService;
  guard?: GuardOptions;
}

const ProviderParamsSchema = z.strictObject({ provider: IntegrationProviderSchema });

export function integrationRouter(options: IntegrationRouterOptions): Router {
  const router = Router();
  const base = '/api/v1/integrations';
  const service = () => options.getService();
  const provider = (res: Parameters<typeof validated>[0]) =>
    validated<typeof ProviderParamsSchema._output>(res, 'params').provider;

  router.get('/', requirePermission('integration.view', options.guard), async (_req, res) => {
    res.json({ items: await service().list() });
  });

  router.post(
    '/sweep',
    requirePermission('integration.process', options.guard),
    async (req, res) => {
      res.json(
        await service().sweep(requireActor(res), requestContextOf(req, res, `${base}/sweep`)),
      );
    },
  );

  router.get(
    '/:provider',
    requirePermission('integration.view', options.guard),
    validate({ params: ProviderParamsSchema }),
    async (_req, res) => {
      res.json(await service().get(provider(res)));
    },
  );

  router.put(
    '/:provider/credentials',
    requirePermission('integration.manage', options.guard),
    validate({ params: ProviderParamsSchema, body: SetCredentialsSchema }),
    async (req, res) => {
      const body = validated<typeof SetCredentialsSchema._output>(res, 'body');
      res.json(
        await service().setCredentials(
          requireActor(res),
          provider(res),
          body,
          requestContextOf(req, res, `${base}/:provider/credentials`),
        ),
      );
    },
  );

  for (const [path, enabled] of [
    ['disable', false],
    ['enable', true],
  ] as const) {
    router.post(
      `/:provider/${path}`,
      requirePermission('integration.manage', options.guard),
      validate({ params: ProviderParamsSchema, body: ConnectionToggleSchema }),
      async (req, res) => {
        const body = validated<typeof ConnectionToggleSchema._output>(res, 'body');
        res.json(
          await service().setEnabled(
            requireActor(res),
            provider(res),
            enabled,
            body,
            requestContextOf(req, res, `${base}/:provider/${path}`),
          ),
        );
      },
    );
  }

  router.post(
    '/:provider/check',
    requirePermission('integration.manage', options.guard),
    validate({ params: ProviderParamsSchema }),
    async (req, res) => {
      res.json(
        await service().check(
          requireActor(res),
          provider(res),
          requestContextOf(req, res, `${base}/:provider/check`),
        ),
      );
    },
  );

  return router;
}

/** Bodies the JSON parser did not take (form-encoded, text) arrive here as raw bytes. */
const rawOther = express.raw({ type: () => true, limit: WEBHOOK_MAX_BYTES });

function bytesOf(req: Request): Buffer {
  const kept = rawBodyOf(req);
  if (kept) return kept;
  const body: unknown = req.body;
  return Buffer.isBuffer(body) ? body : Buffer.alloc(0);
}

/**
 * `POST /api/v1/webhooks/{provider}` — one endpoint per provider, answering fast (ADR-0010):
 * `202` accepted for later processing, `200` for a repeat that was discarded, `401` for a signature
 * that does not verify, `404` when the provider is not connected.
 */
export function webhookRouter(options: IntegrationRouterOptions): Router {
  const router = Router();
  router.post(
    '/:provider',
    rawOther,
    validate({ params: ProviderParamsSchema }),
    async (req, res) => {
      const { provider } = validated<typeof ProviderParamsSchema._output>(res, 'params');
      const headers: Record<string, string | undefined> = {};
      for (const [name, value] of Object.entries(req.headers)) {
        headers[name.toLowerCase()] = Array.isArray(value) ? value.join(',') : value;
      }
      const outcome = await options
        .getService()
        .receiveWebhook(
          provider,
          bytesOf(req),
          headers,
          requestContextOf(req, res, '/api/v1/webhooks/:provider'),
        );
      if (outcome === 'rejected') throw new AppError('UNAUTHENTICATED', 401);
      if (outcome === 'duplicate') {
        // Nothing was stored: the first delivery's record is the evidence.
        markAuditExempt(res);
        res.status(200).json({ received: true, duplicate: true });
        return;
      }
      res.status(202).json({ received: true });
    },
  );
  return router;
}
