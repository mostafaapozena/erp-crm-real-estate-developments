import {
  CampaignQuerySchema,
  CreateCampaignSchema,
  RecordIdSchema,
  UpdateCampaignSchema,
  type ActorContext,
} from '@alola/contracts';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors';
import { currentActor, requirePermission, type GuardOptions } from '../../http/actor';
import { correlationIdOf } from '../../http/correlation';
import { validate, validated } from '../../http/validate';
import type { MarketingService, RequestContext } from './service';

/**
 * Marketing HTTP surface — `MKT-*` demonstration slice.
 *
 * There is **no publish route**. That absence is the honesty: a button that posts to an endpoint which
 * quietly does nothing is worse than no button, and a route named `publish` would be read as a
 * capability whatever its body did (ADR-0026). `marketing.campaign.publish` is not in the permission
 * catalog either — it arrives with the adapter in Macro Phase 4.
 */
export interface MarketingRouterOptions {
  getService: () => MarketingService;
  guard?: GuardOptions;
}

const CampaignParamsSchema = z.strictObject({ campaignId: RecordIdSchema });

function requestContext(req: Request, res: Response, route: string): RequestContext {
  return {
    correlationId: correlationIdOf(res),
    method: req.method,
    route,
    ...(req.ip ? { ip: req.ip } : {}),
  };
}

function actorOf(res: Response): ActorContext {
  const actor = currentActor(res);
  if (!actor) throw new AppError('UNAUTHENTICATED', 401);
  return actor;
}

export function marketingRouter(options: MarketingRouterOptions): Router {
  const router = Router();
  const base = '/api/v1/marketing';

  router.get(
    '/campaigns',
    requirePermission('marketing.campaign.view', options.guard),
    validate({ query: CampaignQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof CampaignQuerySchema._output>(res, 'query');
      res.json(await options.getService().listCampaigns(actorOf(res), query));
    },
  );

  router.post(
    '/campaigns',
    requirePermission('marketing.campaign.manage', options.guard),
    validate({ body: CreateCampaignSchema }),
    async (req, res) => {
      const body = validated<typeof CreateCampaignSchema._output>(res, 'body');
      const created = await options
        .getService()
        .createCampaign(actorOf(res), body, requestContext(req, res, `${base}/campaigns`));
      res.status(201).json(created);
    },
  );

  router.get(
    '/overview',
    requirePermission('marketing.campaign.view', options.guard),
    async (_req, res) => {
      res.json(await options.getService().overview(actorOf(res)));
    },
  );

  router.get(
    '/campaigns/:campaignId',
    requirePermission('marketing.campaign.view', options.guard),
    validate({ params: CampaignParamsSchema }),
    async (_req, res) => {
      const { campaignId } = validated<typeof CampaignParamsSchema._output>(res, 'params');
      res.json(await options.getService().getCampaign(actorOf(res), campaignId));
    },
  );

  router.patch(
    '/campaigns/:campaignId',
    requirePermission('marketing.campaign.manage', options.guard),
    validate({ params: CampaignParamsSchema, body: UpdateCampaignSchema }),
    async (req, res) => {
      const { campaignId } = validated<typeof CampaignParamsSchema._output>(res, 'params');
      const body = validated<typeof UpdateCampaignSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .updateCampaign(
            actorOf(res),
            campaignId,
            body,
            requestContext(req, res, `${base}/campaigns/:campaignId`),
          ),
      );
    },
  );

  return router;
}
