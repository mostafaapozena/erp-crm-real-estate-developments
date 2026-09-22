import {
  AssignLeadSchema,
  ChangeLeadStageSchema,
  CreateActivitySchema,
  CreateCustomerSchema,
  CreateLeadSchema,
  LeadQuerySchema,
  RecordIdSchema,
  UpdateLeadSchema,
  type ActorContext,
} from '@alola/contracts';
import { can } from '@alola/security';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors';
import { currentActor, requirePermission, type GuardOptions } from '../../http/actor';
import { correlationIdOf } from '../../http/correlation';
import { validate, validated } from '../../http/validate';
import type { CrmService, RequestContext } from './service';

/**
 * CRM HTTP surface — `CRM-*` demonstration slice.
 *
 * Creating a lead needs `crm.lead.create`; **assigning it to someone else** additionally needs
 * `crm.lead.assign`, and without that permission the body's `assignedToAccountId` is ignored rather
 * than rejected. Ignoring it is deliberate: a representative's client may send the field, and the
 * right answer is "the lead is yours", not an error they cannot act on.
 */
export interface CrmRouterOptions {
  getService: () => CrmService;
  guard?: GuardOptions;
}

const LeadParamsSchema = z.strictObject({ leadId: RecordIdSchema });
const CustomerParamsSchema = z.strictObject({ customerId: RecordIdSchema });
const CustomerQuerySchema = z.strictObject({ search: z.string().trim().max(80).optional() });

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

export function crmRouter(options: CrmRouterOptions): Router {
  const router = Router();
  const base = '/api/v1/crm';

  /* ------------------------------------------------------------ customers */

  router.get(
    '/customers',
    requirePermission('crm.customer.view', options.guard),
    validate({ query: CustomerQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof CustomerQuerySchema._output>(res, 'query');
      res.json({ items: await options.getService().listCustomers(actorOf(res), query.search) });
    },
  );

  router.post(
    '/customers',
    requirePermission('crm.customer.manage', options.guard),
    validate({ body: CreateCustomerSchema }),
    async (req, res) => {
      const body = validated<typeof CreateCustomerSchema._output>(res, 'body');
      const created = await options
        .getService()
        .createCustomer(actorOf(res), body, requestContext(req, res, `${base}/customers`));
      res.status(201).json(created);
    },
  );

  router.get(
    '/customers/:customerId',
    requirePermission('crm.customer.view', options.guard),
    validate({ params: CustomerParamsSchema }),
    async (_req, res) => {
      const { customerId } = validated<typeof CustomerParamsSchema._output>(res, 'params');
      res.json(await options.getService().getCustomer(actorOf(res), customerId));
    },
  );

  /* ---------------------------------------------------------------- leads */

  router.get(
    '/leads',
    requirePermission('crm.lead.view', options.guard),
    validate({ query: LeadQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof LeadQuerySchema._output>(res, 'query');
      res.json(await options.getService().listLeads(actorOf(res), query));
    },
  );

  router.get('/dashboard', requirePermission('crm.lead.view', options.guard), async (_req, res) => {
    res.json(await options.getService().dashboard(actorOf(res)));
  });

  router.post(
    '/leads',
    requirePermission('crm.lead.create', options.guard),
    validate({ body: CreateLeadSchema }),
    async (req, res) => {
      const actor = actorOf(res);
      const body = validated<typeof CreateLeadSchema._output>(res, 'body');
      const result = await options
        .getService()
        .createLead(actor, body, requestContext(req, res, `${base}/leads`), {
          mayAssign: can(actor, 'crm.lead.assign'),
        });
      res.status(201).json(result);
    },
  );

  router.get(
    '/leads/:leadId',
    requirePermission('crm.lead.view', options.guard),
    validate({ params: LeadParamsSchema }),
    async (_req, res) => {
      const { leadId } = validated<typeof LeadParamsSchema._output>(res, 'params');
      res.json(await options.getService().getLead(actorOf(res), leadId));
    },
  );

  router.patch(
    '/leads/:leadId',
    requirePermission('crm.lead.edit', options.guard),
    validate({ params: LeadParamsSchema, body: UpdateLeadSchema }),
    async (req, res) => {
      const { leadId } = validated<typeof LeadParamsSchema._output>(res, 'params');
      const body = validated<Record<string, unknown>>(res, 'body');
      res.json(
        await options
          .getService()
          .updateLead(
            actorOf(res),
            leadId,
            body,
            requestContext(req, res, `${base}/leads/:leadId`),
          ),
      );
    },
  );

  router.post(
    '/leads/:leadId/stage',
    requirePermission('crm.lead.edit', options.guard),
    validate({ params: LeadParamsSchema, body: ChangeLeadStageSchema }),
    async (req, res) => {
      const { leadId } = validated<typeof LeadParamsSchema._output>(res, 'params');
      const body = validated<typeof ChangeLeadStageSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .changeStage(
            actorOf(res),
            leadId,
            body,
            requestContext(req, res, `${base}/leads/:leadId/stage`),
          ),
      );
    },
  );

  router.post(
    '/leads/:leadId/assign',
    requirePermission('crm.lead.assign', options.guard),
    validate({ params: LeadParamsSchema, body: AssignLeadSchema }),
    async (req, res) => {
      const { leadId } = validated<typeof LeadParamsSchema._output>(res, 'params');
      const body = validated<typeof AssignLeadSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .assignLead(
            actorOf(res),
            leadId,
            body,
            requestContext(req, res, `${base}/leads/:leadId/assign`),
          ),
      );
    },
  );

  router.get(
    '/leads/:leadId/activities',
    requirePermission('crm.lead.view', options.guard),
    validate({ params: LeadParamsSchema }),
    async (_req, res) => {
      const { leadId } = validated<typeof LeadParamsSchema._output>(res, 'params');
      res.json({ items: await options.getService().listActivities(actorOf(res), leadId) });
    },
  );

  router.post(
    '/leads/:leadId/activities',
    requirePermission('crm.activity.create', options.guard),
    validate({ params: LeadParamsSchema, body: CreateActivitySchema }),
    async (req, res) => {
      const { leadId } = validated<typeof LeadParamsSchema._output>(res, 'params');
      const body = validated<typeof CreateActivitySchema._output>(res, 'body');
      const created = await options
        .getService()
        .addActivity(
          actorOf(res),
          leadId,
          body,
          requestContext(req, res, `${base}/leads/:leadId/activities`),
        );
      res.status(201).json(created);
    },
  );

  return router;
}
