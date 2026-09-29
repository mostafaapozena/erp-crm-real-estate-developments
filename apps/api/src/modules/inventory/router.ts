import {
  CreateHoldSchema,
  CreatePlanTemplateSchema,
  ExtendHoldSchema,
  HoldQuerySchema,
  PlanTemplatePreviewRequestSchema,
  PlanTemplateQuerySchema,
  ProposePriceSchema,
  ReleaseHoldSchema,
  RetirePlanTemplateSchema,
  UnitComparisonQuerySchema,
  UpdateBuildingSchema,
  UpdateProjectSchema,
  UpdateUnitSchema,
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
import { markAuditExempt } from '../../http/audit-context';
import type { HoldService } from './holds';
import type { PriceService } from './pricing';
import type { InventoryService, RequestContext } from './service';
import type { PlanTemplateService } from './templates';

/**
 * Inventory HTTP surface — `INV-*` demonstration slice.
 *
 * Reading pricing is a **separate** permission from reading a unit, so a route that lists units is
 * useful to someone who may not see the price list; the stripping happens in the service, on every
 * serialization path, rather than here (SEC-029).
 */
export interface InventoryRouterOptions {
  getService: () => InventoryService;
  getPrices: () => PriceService;
  getHolds: () => HoldService;
  getTemplates: () => PlanTemplateService;
  guard?: GuardOptions;
}

const ProjectParamsSchema = z.strictObject({ projectId: RecordIdSchema });
const UnitParamsSchema = z.strictObject({ unitId: RecordIdSchema });
const BuildingParamsSchema = z.strictObject({ buildingId: RecordIdSchema });
const PriceParamsSchema = z.strictObject({ priceVersionId: RecordIdSchema });
const HoldParamsSchema = z.strictObject({ holdId: RecordIdSchema });
const TemplateParamsSchema = z.strictObject({ templateId: RecordIdSchema });
const CancelPriceSchema = z.strictObject({ reason: z.string().trim().min(3).max(500) });
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

  router.get(
    '/units/compare',
    requirePermission('inventory.unit.view', options.guard),
    validate({ query: UnitComparisonQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof UnitComparisonQuerySchema._output>(res, 'query');
      res.json({ items: await options.getService().compareUnits(actorOf(res), query.ids) });
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

  /* ------------------------------------------------------- editing (BMP-1) */

  router.patch(
    '/projects/:projectId',
    requirePermission('inventory.project.manage', options.guard),
    validate({ params: ProjectParamsSchema, body: UpdateProjectSchema }),
    async (req, res) => {
      const { projectId } = validated<typeof ProjectParamsSchema._output>(res, 'params');
      const body = validated<typeof UpdateProjectSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .updateProject(
            actorOf(res),
            projectId,
            body,
            requestContext(req, res, `${base}/projects/:projectId`),
          ),
      );
    },
  );

  router.get(
    '/projects/:projectId/matrix',
    requirePermission('inventory.unit.view', options.guard),
    validate({ params: ProjectParamsSchema }),
    async (_req, res) => {
      const { projectId } = validated<typeof ProjectParamsSchema._output>(res, 'params');
      res.json(await options.getService().availabilityMatrix(actorOf(res), projectId));
    },
  );

  router.patch(
    '/buildings/:buildingId',
    requirePermission('inventory.project.manage', options.guard),
    validate({ params: BuildingParamsSchema, body: UpdateBuildingSchema }),
    async (req, res) => {
      const { buildingId } = validated<typeof BuildingParamsSchema._output>(res, 'params');
      const body = validated<typeof UpdateBuildingSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .updateBuilding(
            actorOf(res),
            buildingId,
            body,
            requestContext(req, res, `${base}/buildings/:buildingId`),
          ),
      );
    },
  );

  router.patch(
    '/units/:unitId',
    requirePermission('inventory.unit.manage', options.guard),
    validate({ params: UnitParamsSchema, body: UpdateUnitSchema }),
    async (req, res) => {
      const { unitId } = validated<typeof UnitParamsSchema._output>(res, 'params');
      const body = validated<typeof UpdateUnitSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .updateUnit(
            actorOf(res),
            unitId,
            body,
            requestContext(req, res, `${base}/units/:unitId`),
          ),
      );
    },
  );

  /* -------------------------------------------------------- price versions */

  router.get(
    '/units/:unitId/prices',
    requirePermission('inventory.unit.view', options.guard),
    requirePermission('inventory.unit.viewPricing', options.guard),
    validate({ params: UnitParamsSchema }),
    async (_req, res) => {
      const { unitId } = validated<typeof UnitParamsSchema._output>(res, 'params');
      res.json({ items: await options.getPrices().list(actorOf(res), unitId) });
    },
  );

  router.post(
    '/units/:unitId/prices',
    requirePermission('inventory.price.propose', options.guard),
    requirePermission('inventory.unit.viewPricing', options.guard),
    validate({ params: UnitParamsSchema, body: ProposePriceSchema }),
    async (req, res) => {
      const { unitId } = validated<typeof UnitParamsSchema._output>(res, 'params');
      const body = validated<typeof ProposePriceSchema._output>(res, 'body');
      const result = await options
        .getPrices()
        .propose(
          actorOf(res),
          unitId,
          body,
          requestContext(req, res, `${base}/units/:unitId/prices`),
        );
      if (result.replayed) markAuditExempt(res);
      res.status(result.replayed ? 200 : 201).json(result.version);
    },
  );

  router.post(
    '/prices/:priceVersionId/cancel',
    requirePermission('inventory.price.propose', options.guard),
    requirePermission('inventory.unit.viewPricing', options.guard),
    validate({ params: PriceParamsSchema, body: CancelPriceSchema }),
    async (req, res) => {
      const { priceVersionId } = validated<typeof PriceParamsSchema._output>(res, 'params');
      const body = validated<typeof CancelPriceSchema._output>(res, 'body');
      res.json(
        await options
          .getPrices()
          .cancel(
            actorOf(res),
            priceVersionId,
            body.reason,
            requestContext(req, res, `${base}/prices/:priceVersionId/cancel`),
          ),
      );
    },
  );

  /* ----------------------------------------------------------------- holds */

  router.get(
    '/holds',
    requirePermission('inventory.unit.view', options.guard),
    validate({ query: HoldQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof HoldQuerySchema._output>(res, 'query');
      res.json({ items: await options.getHolds().list(actorOf(res), query) });
    },
  );

  router.post(
    '/holds',
    requirePermission('inventory.hold.create', options.guard),
    validate({ body: CreateHoldSchema }),
    async (req, res) => {
      const body = validated<typeof CreateHoldSchema._output>(res, 'body');
      const result = await options
        .getHolds()
        .create(actorOf(res), body, requestContext(req, res, `${base}/holds`));
      if (result.replayed) markAuditExempt(res);
      res.status(result.replayed ? 200 : 201).json(result.hold);
    },
  );

  router.get(
    '/holds/:holdId',
    requirePermission('inventory.unit.view', options.guard),
    validate({ params: HoldParamsSchema }),
    async (_req, res) => {
      const { holdId } = validated<typeof HoldParamsSchema._output>(res, 'params');
      res.json(await options.getHolds().get(actorOf(res), holdId));
    },
  );

  router.post(
    '/holds/:holdId/release',
    requirePermission('inventory.hold.create', options.guard),
    validate({ params: HoldParamsSchema, body: ReleaseHoldSchema }),
    async (req, res) => {
      const { holdId } = validated<typeof HoldParamsSchema._output>(res, 'params');
      const body = validated<typeof ReleaseHoldSchema._output>(res, 'body');
      res.json(
        await options
          .getHolds()
          .release(
            actorOf(res),
            holdId,
            body.reason,
            requestContext(req, res, `${base}/holds/:holdId/release`),
          ),
      );
    },
  );

  router.post(
    '/holds/:holdId/extend',
    requirePermission('inventory.hold.create', options.guard),
    validate({ params: HoldParamsSchema, body: ExtendHoldSchema }),
    async (req, res) => {
      const { holdId } = validated<typeof HoldParamsSchema._output>(res, 'params');
      const body = validated<typeof ExtendHoldSchema._output>(res, 'body');
      res.json(
        await options
          .getHolds()
          .extend(
            actorOf(res),
            holdId,
            body,
            requestContext(req, res, `${base}/holds/:holdId/extend`),
          ),
      );
    },
  );

  /* ------------------------------------------------------ plan templates */

  router.get(
    '/plan-templates',
    requirePermission('inventory.project.view', options.guard),
    validate({ query: PlanTemplateQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof PlanTemplateQuerySchema._output>(res, 'query');
      res.json({ items: await options.getTemplates().list(actorOf(res), query) });
    },
  );

  router.post(
    '/plan-templates',
    requirePermission('inventory.plan.manage', options.guard),
    validate({ body: CreatePlanTemplateSchema }),
    async (req, res) => {
      const body = validated<typeof CreatePlanTemplateSchema._output>(res, 'body');
      res
        .status(201)
        .json(
          await options
            .getTemplates()
            .create(actorOf(res), body, requestContext(req, res, `${base}/plan-templates`)),
        );
    },
  );

  router.post(
    '/plan-templates/:templateId/retire',
    requirePermission('inventory.plan.manage', options.guard),
    validate({ params: TemplateParamsSchema, body: RetirePlanTemplateSchema }),
    async (req, res) => {
      const { templateId } = validated<typeof TemplateParamsSchema._output>(res, 'params');
      const body = validated<typeof RetirePlanTemplateSchema._output>(res, 'body');
      res.json(
        await options
          .getTemplates()
          .retire(
            actorOf(res),
            templateId,
            body.reason,
            requestContext(req, res, `${base}/plan-templates/:templateId/retire`),
          ),
      );
    },
  );

  /** A calculation, not a mutation: nothing is stored and nothing is audited. */
  router.post(
    '/plan-templates/:templateId/preview',
    requirePermission('inventory.unit.viewPricing', options.guard),
    validate({ params: TemplateParamsSchema, body: PlanTemplatePreviewRequestSchema }),
    async (_req, res) => {
      const { templateId } = validated<typeof TemplateParamsSchema._output>(res, 'params');
      const body = validated<typeof PlanTemplatePreviewRequestSchema._output>(res, 'body');
      markAuditExempt(res);
      res.json(await options.getTemplates().preview(actorOf(res), templateId, body));
    },
  );

  return router;
}
