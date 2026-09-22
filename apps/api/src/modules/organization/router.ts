import {
  CreateBranchSchema,
  CreateDepartmentSchema,
  CreateJobTitleSchema,
  CreateLegalEntitySchema,
  CreatePlacementSchema,
  CreateTeamSchema,
  OrgStatusSchema,
  RecordIdSchema,
  UpdatePlacementSchema,
  type ActorContext,
} from '@alola/contracts';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors';
import { currentActor, requirePermission, type GuardOptions } from '../../http/actor';
import { correlationIdOf } from '../../http/correlation';
import { validate, validated } from '../../http/validate';
import type { OrganizationService, RequestContext } from './service';

/**
 * Organization HTTP surface — `CORE-ORG` demonstration slice.
 *
 * Reads need `org.view` (placements need `org.placement.view`); writes need the administrative
 * `org.manage` / `org.placement.manage`, because the hierarchy is what every data scope resolves
 * against. Breadth within a read is the actor's data scope, applied inside the query.
 */
export interface OrgRouterOptions {
  getService: () => OrganizationService;
  guard?: GuardOptions;
}

const PlacementParamsSchema = z.strictObject({ placementId: RecordIdSchema });

const PlacementQuerySchema = z.strictObject({
  status: OrgStatusSchema.optional(),
  departmentId: RecordIdSchema.optional(),
  teamId: RecordIdSchema.optional(),
});

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

export function organizationRouter(options: OrgRouterOptions): Router {
  const router = Router();
  const base = '/api/v1/organization';

  router.get('/chart', requirePermission('org.view', options.guard), async (_req, res) => {
    res.json(await options.getService().chart(actorOf(res)));
  });

  router.get('/legal-entities', requirePermission('org.view', options.guard), async (_req, res) => {
    res.json({ items: await options.getService().listLegalEntities(actorOf(res)) });
  });

  router.post(
    '/legal-entities',
    requirePermission('org.manage', options.guard),
    validate({ body: CreateLegalEntitySchema }),
    async (req, res) => {
      const body = validated<typeof CreateLegalEntitySchema._output>(res, 'body');
      const created = await options
        .getService()
        .createLegalEntity(actorOf(res), body, requestContext(req, res, `${base}/legal-entities`));
      res.status(201).json(created);
    },
  );

  router.get('/branches', requirePermission('org.view', options.guard), async (_req, res) => {
    res.json({ items: await options.getService().listBranches(actorOf(res)) });
  });

  router.post(
    '/branches',
    requirePermission('org.manage', options.guard),
    validate({ body: CreateBranchSchema }),
    async (req, res) => {
      const body = validated<typeof CreateBranchSchema._output>(res, 'body');
      const created = await options
        .getService()
        .createBranch(actorOf(res), body, requestContext(req, res, `${base}/branches`));
      res.status(201).json(created);
    },
  );

  router.get('/departments', requirePermission('org.view', options.guard), async (_req, res) => {
    res.json({ items: await options.getService().listDepartments(actorOf(res)) });
  });

  router.post(
    '/departments',
    requirePermission('org.manage', options.guard),
    validate({ body: CreateDepartmentSchema }),
    async (req, res) => {
      const body = validated<typeof CreateDepartmentSchema._output>(res, 'body');
      const created = await options
        .getService()
        .createDepartment(actorOf(res), body, requestContext(req, res, `${base}/departments`));
      res.status(201).json(created);
    },
  );

  router.get('/teams', requirePermission('org.view', options.guard), async (_req, res) => {
    res.json({ items: await options.getService().listTeams(actorOf(res)) });
  });

  router.post(
    '/teams',
    requirePermission('org.manage', options.guard),
    validate({ body: CreateTeamSchema }),
    async (req, res) => {
      const body = validated<typeof CreateTeamSchema._output>(res, 'body');
      const created = await options
        .getService()
        .createTeam(actorOf(res), body, requestContext(req, res, `${base}/teams`));
      res.status(201).json(created);
    },
  );

  router.get('/job-titles', requirePermission('org.view', options.guard), async (_req, res) => {
    res.json({ items: await options.getService().listJobTitles() });
  });

  router.post(
    '/job-titles',
    requirePermission('org.manage', options.guard),
    validate({ body: CreateJobTitleSchema }),
    async (req, res) => {
      const body = validated<typeof CreateJobTitleSchema._output>(res, 'body');
      const created = await options
        .getService()
        .createJobTitle(actorOf(res), body, requestContext(req, res, `${base}/job-titles`));
      res.status(201).json(created);
    },
  );

  router.get(
    '/placements',
    requirePermission('org.placement.view', options.guard),
    validate({ query: PlacementQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof PlacementQuerySchema._output>(res, 'query');
      res.json({ items: await options.getService().listPlacements(actorOf(res), query) });
    },
  );

  router.post(
    '/placements',
    requirePermission('org.placement.manage', options.guard),
    validate({ body: CreatePlacementSchema }),
    async (req, res) => {
      const body = validated<typeof CreatePlacementSchema._output>(res, 'body');
      const created = await options
        .getService()
        .createPlacement(actorOf(res), body, requestContext(req, res, `${base}/placements`));
      res.status(201).json(created);
    },
  );

  router.patch(
    '/placements/:placementId',
    requirePermission('org.placement.manage', options.guard),
    validate({ params: PlacementParamsSchema, body: UpdatePlacementSchema }),
    async (req, res) => {
      const { placementId } = validated<typeof PlacementParamsSchema._output>(res, 'params');
      const body = validated<typeof UpdatePlacementSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .updatePlacement(
            actorOf(res),
            placementId,
            body,
            requestContext(req, res, `${base}/placements/:placementId`),
          ),
      );
    },
  );

  return router;
}
