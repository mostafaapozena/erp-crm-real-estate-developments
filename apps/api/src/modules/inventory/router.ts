import {
  ChangeUnitStatusSchema,
  CreateBuildingSchema,
  CreateProjectSchema,
  CreateUnitSchema,
  ProjectStatusSchema,
  RecordIdSchema,
  UnitQuerySchema,
  type ActorContext,
} from '@alola/contracts';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors';
import { currentActor, requirePermission, type GuardOptions } from '../../http/actor';
import { correlationIdOf } from '../../http/correlation';
import { validate, validated } from '../../http/validate';
import type { InventoryService, RequestContext } from './service';

/**
 * Inventory HTTP surface — `INV-*` demonstration slice.
 *
 * Reading pricing is a **separate** permission from reading a unit, so a route that lists units is
 * useful to someone who may not see the price list; the stripping happens in the service, on every
 * serialization path, rather than here (SEC-029).
 */
export interface InventoryRouterOptions {
  getService: () => InventoryService;
  guard?: GuardOptions;
}

const ProjectParamsSchema = z.strictObject({ projectId: RecordIdSchema });
const UnitParamsSchema = z.strictObject({ unitId: RecordIdSchema });
const ProjectQuerySchema = z.strictObject({ status: ProjectStatusSchema.optional() });
const BuildingQuerySchema = z.strictObject({ projectId: RecordIdSchema.optional() });
const SummaryQuerySchema = z.strictObject({ projectId: RecordIdSchema.optional() });

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

export function inventoryRouter(options: InventoryRouterOptions): Router {
  const router = Router();
  const base = '/api/v1/inventory';

  router.get(
    '/projects',
    requirePermission('inventory.project.view', options.guard),
    validate({ query: ProjectQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof ProjectQuerySchema._output>(res, 'query');
      res.json({ items: await options.getService().listProjects(actorOf(res), query.status) });
    },
  );

  router.post(
    '/projects',
    requirePermission('inventory.project.manage', options.guard),
    validate({ body: CreateProjectSchema }),
    async (req, res) => {
      const body = validated<typeof CreateProjectSchema._output>(res, 'body');
      const created = await options
        .getService()
        .createProject(actorOf(res), body, requestContext(req, res, `${base}/projects`));
      res.status(201).json(created);
    },
  );

  router.get(
    '/projects/:projectId',
    requirePermission('inventory.project.view', options.guard),
    validate({ params: ProjectParamsSchema }),
    async (_req, res) => {
      const { projectId } = validated<typeof ProjectParamsSchema._output>(res, 'params');
      res.json(await options.getService().getProject(actorOf(res), projectId));
    },
  );

  router.get(
    '/buildings',
    requirePermission('inventory.project.view', options.guard),
    validate({ query: BuildingQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof BuildingQuerySchema._output>(res, 'query');
      res.json({ items: await options.getService().listBuildings(actorOf(res), query.projectId) });
    },
  );

  router.post(
    '/buildings',
    requirePermission('inventory.project.manage', options.guard),
    validate({ body: CreateBuildingSchema }),
    async (req, res) => {
      const body = validated<typeof CreateBuildingSchema._output>(res, 'body');
      const created = await options
        .getService()
        .createBuilding(actorOf(res), body, requestContext(req, res, `${base}/buildings`));
      res.status(201).json(created);
    },
  );

  router.get(
    '/units',
    requirePermission('inventory.unit.view', options.guard),
    validate({ query: UnitQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof UnitQuerySchema._output>(res, 'query');
      res.json(await options.getService().listUnits(actorOf(res), query));
    },
  );

  router.get(
    '/units/summary',
    requirePermission('inventory.unit.view', options.guard),
    validate({ query: SummaryQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof SummaryQuerySchema._output>(res, 'query');
      res.json(await options.getService().summary(actorOf(res), query.projectId));
    },
  );

  router.post(
    '/units',
    requirePermission('inventory.unit.manage', options.guard),
    validate({ body: CreateUnitSchema }),
    async (req, res) => {
      const body = validated<typeof CreateUnitSchema._output>(res, 'body');
      const created = await options
        .getService()
        .createUnit(actorOf(res), body, requestContext(req, res, `${base}/units`));
      res.status(201).json(created);
    },
  );

  router.get(
    '/units/:unitId',
    requirePermission('inventory.unit.view', options.guard),
    validate({ params: UnitParamsSchema }),
    async (_req, res) => {
      const { unitId } = validated<typeof UnitParamsSchema._output>(res, 'params');
      res.json(await options.getService().getUnit(actorOf(res), unitId));
    },
  );

  router.get(
    '/units/:unitId/history',
    requirePermission('inventory.unit.view', options.guard),
    validate({ params: UnitParamsSchema }),
    async (_req, res) => {
      const { unitId } = validated<typeof UnitParamsSchema._output>(res, 'params');
      res.json({ items: await options.getService().listUnitEvents(actorOf(res), unitId) });
    },
  );

  router.post(
    '/units/:unitId/status',
    requirePermission('inventory.unit.manage', options.guard),
    validate({ params: UnitParamsSchema, body: ChangeUnitStatusSchema }),
    async (req, res) => {
      const { unitId } = validated<typeof UnitParamsSchema._output>(res, 'params');
      const body = validated<typeof ChangeUnitStatusSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .changeStatus(
            actorOf(res),
            unitId,
            body,
            requestContext(req, res, `${base}/units/:unitId/status`),
          ),
      );
    },
  );

  return router;
}
