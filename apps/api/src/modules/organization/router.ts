import {
  CreateBranchSchema,
  CreateDepartmentSchema,
  CreateJobTitleSchema,
  CreateLegalEntitySchema,
  CreatePlacementSchema,
  CreateTeamSchema,
  OrgLifecycleChangeSchema,
  OrgStatusSchema,
  PeopleLookupQuerySchema,
  PlacementLifecycleSchema,
  RecordIdSchema,
  TransferPlacementSchema,
  UpdateBranchSchema,
  UpdateDepartmentSchema,
  UpdateJobTitleSchema,
  UpdateLegalEntitySchema,
  UpdatePlacementSchema,
  UpdateTeamSchema,
  type ActorContext,
  type OrgUnitKind,
} from '@alola/contracts';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuthenticated, requirePermission, type GuardOptions } from '../../http/actor';
import { requestContextOf, requireActor } from '../../http/request-context';
import { validate, validated } from '../../http/validate';
import type { OrganizationService, RequestContext } from './service';

/**
 * Organization HTTP surface — `CORE-ORG` foundation (CORE-ORG-001 … 006).
 *
 * Reads need `org.view` (placements `org.placement.view`); writes need the administrative `org.manage`
 * / `org.placement.manage`, because the hierarchy is what every data scope resolves against. Breadth —
 * for reads **and** writes — is the actor's data scope, applied inside the query (CORE-ORG-004).
 */
export interface OrgRouterOptions {
  getService: () => OrganizationService;
  guard?: GuardOptions;
}

const IdParamsSchema = z.strictObject({ id: RecordIdSchema });
const PlacementParamsSchema = z.strictObject({ placementId: RecordIdSchema });

const PlacementQuerySchema = z.strictObject({
  status: OrgStatusSchema.optional(),
  departmentId: RecordIdSchema.optional(),
  teamId: RecordIdSchema.optional(),
});

/** Each unit kind, its collection path, and its update schema. */
const UNIT_ROUTES: {
  kind: OrgUnitKind;
  path: string;
  update: z.ZodType;
  apply: (
    service: OrganizationService,
    actor: ActorContext,
    id: string,
    // Already validated against `update` by the time `apply` runs.
    body: never,
    context: RequestContext,
  ) => Promise<unknown>;
}[] = [
  {
    kind: 'legalEntity',
    path: '/legal-entities',
    update: UpdateLegalEntitySchema,
    apply: (service, actor, id, body, context) =>
      service.updateLegalEntity(actor, id, body, context),
  },
  {
    kind: 'branch',
    path: '/branches',
    update: UpdateBranchSchema,
    apply: (service, actor, id, body, context) => service.updateBranch(actor, id, body, context),
  },
  {
    kind: 'department',
    path: '/departments',
    update: UpdateDepartmentSchema,
    apply: (service, actor, id, body, context) =>
      service.updateDepartment(actor, id, body, context),
  },
  {
    kind: 'team',
    path: '/teams',
    update: UpdateTeamSchema,
    apply: (service, actor, id, body, context) => service.updateTeam(actor, id, body, context),
  },
  {
    kind: 'jobTitle',
    path: '/job-titles',
    update: UpdateJobTitleSchema,
    apply: (service, actor, id, body, context) => service.updateJobTitle(actor, id, body, context),
  },
];

export function organizationRouter(options: OrgRouterOptions): Router {
  const router = Router();
  const base = '/api/v1/organization';
  const service = () => options.getService();

  /**
   * Names for account references (ADR-0031). Any signed-in person may ask, but only about the
   * references they hold, and only for a directory label and job title.
   */
  router.get(
    '/people',
    requireAuthenticated(options.guard),
    validate({ query: PeopleLookupQuerySchema }),
    async (_req, res) => {
      const { ids } = validated<typeof PeopleLookupQuerySchema._output>(res, 'query');
      res.json({ items: await service().lookupPeople(ids) });
    },
  );

  router.get('/chart', requirePermission('org.view', options.guard), async (_req, res) => {
    res.json(await service().chart(requireActor(res)));
  });

  /* ------------------------------------------------------------ units: reads */

  router.get('/legal-entities', requirePermission('org.view', options.guard), async (_req, res) => {
    res.json({ items: await service().listLegalEntities(requireActor(res)) });
  });
  router.get('/branches', requirePermission('org.view', options.guard), async (_req, res) => {
    res.json({ items: await service().listBranches(requireActor(res)) });
  });
  router.get('/departments', requirePermission('org.view', options.guard), async (_req, res) => {
    res.json({ items: await service().listDepartments(requireActor(res)) });
  });
  router.get('/teams', requirePermission('org.view', options.guard), async (_req, res) => {
    res.json({ items: await service().listTeams(requireActor(res)) });
  });
  router.get('/job-titles', requirePermission('org.view', options.guard), async (_req, res) => {
    res.json({ items: await service().listJobTitles() });
  });

  /* ---------------------------------------------------------- units: creates */

  router.post(
    '/legal-entities',
    requirePermission('org.manage', options.guard),
    validate({ body: CreateLegalEntitySchema }),
    async (req, res) => {
      const body = validated<typeof CreateLegalEntitySchema._output>(res, 'body');
      const created = await service().createLegalEntity(
        requireActor(res),
        body,
        requestContextOf(req, res, `${base}/legal-entities`),
      );
      res.status(201).json(created);
    },
  );

  router.post(
    '/branches',
    requirePermission('org.manage', options.guard),
    validate({ body: CreateBranchSchema }),
    async (req, res) => {
      const body = validated<typeof CreateBranchSchema._output>(res, 'body');
      const created = await service().createBranch(
        requireActor(res),
        body,
        requestContextOf(req, res, `${base}/branches`),
      );
      res.status(201).json(created);
    },
  );

  router.post(
    '/departments',
    requirePermission('org.manage', options.guard),
    validate({ body: CreateDepartmentSchema }),
    async (req, res) => {
      const body = validated<typeof CreateDepartmentSchema._output>(res, 'body');
      const created = await service().createDepartment(
        requireActor(res),
        body,
        requestContextOf(req, res, `${base}/departments`),
      );
      res.status(201).json(created);
    },
  );

  router.post(
    '/teams',
    requirePermission('org.manage', options.guard),
    validate({ body: CreateTeamSchema }),
    async (req, res) => {
      const body = validated<typeof CreateTeamSchema._output>(res, 'body');
      const created = await service().createTeam(
        requireActor(res),
        body,
        requestContextOf(req, res, `${base}/teams`),
      );
      res.status(201).json(created);
    },
  );

  router.post(
    '/job-titles',
    requirePermission('org.manage', options.guard),
    validate({ body: CreateJobTitleSchema }),
    async (req, res) => {
      const body = validated<typeof CreateJobTitleSchema._output>(res, 'body');
      const created = await service().createJobTitle(
        requireActor(res),
        body,
        requestContextOf(req, res, `${base}/job-titles`),
      );
      res.status(201).json(created);
    },
  );

  /* ------------------------------------------------ units: update, lifecycle */

  for (const unit of UNIT_ROUTES) {
    router.patch(
      `${unit.path}/:id`,
      requirePermission('org.manage', options.guard),
      validate({ params: IdParamsSchema, body: unit.update }),
      async (req, res) => {
        const { id } = validated<typeof IdParamsSchema._output>(res, 'params');
        const body = validated<never>(res, 'body');
        res.json(
          await unit.apply(
            service(),
            requireActor(res),
            id,
            body,
            requestContextOf(req, res, `${base}${unit.path}/:id`),
          ),
        );
      },
    );

    for (const change of ['deactivate', 'reactivate'] as const) {
      router.post(
        `${unit.path}/:id/${change}`,
        requirePermission('org.manage', options.guard),
        validate({ params: IdParamsSchema, body: OrgLifecycleChangeSchema }),
        async (req, res) => {
          const { id } = validated<typeof IdParamsSchema._output>(res, 'params');
          const { reason } = validated<typeof OrgLifecycleChangeSchema._output>(res, 'body');
          const context = requestContextOf(req, res, `${base}${unit.path}/:id/${change}`);
          const actor = requireActor(res);
          res.json(
            change === 'deactivate'
              ? await service().deactivateUnit(unit.kind, actor, id, reason, context)
              : await service().reactivateUnit(unit.kind, actor, id, reason, context),
          );
        },
      );
    }
  }

  /* -------------------------------------------------------------- placements */

  router.get(
    '/placements',
    requirePermission('org.placement.view', options.guard),
    validate({ query: PlacementQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof PlacementQuerySchema._output>(res, 'query');
      res.json({ items: await service().listPlacements(requireActor(res), query) });
    },
  );

  router.post(
    '/placements',
    requirePermission('org.placement.manage', options.guard),
    validate({ body: CreatePlacementSchema }),
    async (req, res) => {
      const body = validated<typeof CreatePlacementSchema._output>(res, 'body');
      const created = await service().createPlacement(
        requireActor(res),
        body,
        requestContextOf(req, res, `${base}/placements`),
      );
      res.status(201).json(created);
    },
  );

  router.get(
    '/placements/:placementId',
    requirePermission('org.placement.view', options.guard),
    validate({ params: PlacementParamsSchema }),
    async (_req, res) => {
      const { placementId } = validated<typeof PlacementParamsSchema._output>(res, 'params');
      res.json(await service().getPlacement(requireActor(res), placementId));
    },
  );

  router.get(
    '/placements/:placementId/history',
    requirePermission('org.placement.view', options.guard),
    validate({ params: PlacementParamsSchema }),
    async (_req, res) => {
      const { placementId } = validated<typeof PlacementParamsSchema._output>(res, 'params');
      res.json({ items: await service().placementHistory(requireActor(res), placementId) });
    },
  );

  router.get(
    '/placements/:placementId/reporting-line',
    requirePermission('org.placement.view', options.guard),
    validate({ params: PlacementParamsSchema }),
    async (_req, res) => {
      const { placementId } = validated<typeof PlacementParamsSchema._output>(res, 'params');
      res.json(await service().reportingLine(requireActor(res), placementId));
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
        await service().updatePlacement(
          requireActor(res),
          placementId,
          body,
          requestContextOf(req, res, `${base}/placements/:placementId`),
        ),
      );
    },
  );

  router.post(
    '/placements/:placementId/transfer',
    requirePermission('org.placement.manage', options.guard),
    validate({ params: PlacementParamsSchema, body: TransferPlacementSchema }),
    async (req, res) => {
      const { placementId } = validated<typeof PlacementParamsSchema._output>(res, 'params');
      const body = validated<typeof TransferPlacementSchema._output>(res, 'body');
      res.json(
        await service().transferPlacement(
          requireActor(res),
          placementId,
          body,
          requestContextOf(req, res, `${base}/placements/:placementId/transfer`),
        ),
      );
    },
  );

  for (const change of ['deactivate', 'reactivate'] as const) {
    router.post(
      `/placements/:placementId/${change}`,
      requirePermission('org.placement.manage', options.guard),
      validate({ params: PlacementParamsSchema, body: PlacementLifecycleSchema }),
      async (req, res) => {
        const { placementId } = validated<typeof PlacementParamsSchema._output>(res, 'params');
        const body = validated<typeof PlacementLifecycleSchema._output>(res, 'body');
        const context = requestContextOf(req, res, `${base}/placements/:placementId/${change}`);
        const actor = requireActor(res);
        res.json(
          change === 'deactivate'
            ? await service().deactivatePlacement(actor, placementId, body, context)
            : await service().reactivatePlacement(actor, placementId, body, context),
        );
      },
    );
  }

  return router;
}
