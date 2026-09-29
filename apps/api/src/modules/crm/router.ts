import {
  AssignLeadSchema,
  AssignOpportunitySchema,
  ChangeLeadStageSchema,
  ChangeOpportunityStageSchema,
  ConvertLeadSchema,
  CreateOpportunitySchema,
  OpportunityQuerySchema,
  UpdateOpportunitySchema,
  CreateActivitySchema,
  CreateCustomerSchema,
  CreateLeadSchema,
  CustomerQuerySchema,
  DuplicateCheckSchema,
  LeadQuerySchema,
  QualifyLeadSchema,
  RecordConsentSchema,
  RecordIdSchema,
  TransferOwnershipSchema,
  UpdateCustomerSchema,
  UpdateLeadSchema,
  type ActorContext,
} from '@alola/contracts';
import { can } from '@alola/security';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors';
import { currentActor, requirePermission, type GuardOptions } from '../../http/actor';
import { markAuditExempt } from '../../http/audit-context';
import { correlationIdOf } from '../../http/correlation';
import { validate, validated } from '../../http/validate';
import type { OpportunityService } from './opportunities';
import type { CrmService, RequestContext } from './service';

/**
 * CRM HTTP surface (`CRM-*`).
 *
 * Creating a lead needs `crm.lead.create`; **assigning it to someone else** additionally needs
 * `crm.lead.assign`, and without that permission the body's `assignedToAccountId` is ignored rather
 * than rejected. Ignoring it is deliberate: a representative's client may send the field, and the
 * right answer is "the lead is yours", not an error they cannot act on. The same rule applies to a
 * customer's `ownerAccountId` and `crm.customer.transfer`.
 */
export interface CrmRouterOptions {
  getService: () => CrmService;
  getOpportunities: () => OpportunityService;
  guard?: GuardOptions;
}

const LeadParamsSchema = z.strictObject({ leadId: RecordIdSchema });
const CustomerParamsSchema = z.strictObject({ customerId: RecordIdSchema });
const OpportunityParamsSchema = z.strictObject({ opportunityId: RecordIdSchema });

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
      res.json(await options.getService().listCustomers(actorOf(res), query));
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

  /** A read expressed as POST so contact details never travel in a URL; nothing is stored. */
  router.post(
    '/customers/duplicate-check',
    requirePermission('crm.customer.view', options.guard),
    validate({ body: DuplicateCheckSchema }),
    async (_req, res) => {
      const body = validated<typeof DuplicateCheckSchema._output>(res, 'body');
      markAuditExempt(res);
      res.json(await options.getService().checkDuplicates(actorOf(res), body));
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

  router.patch(
    '/customers/:customerId',
    requirePermission('crm.customer.manage', options.guard),
    validate({ params: CustomerParamsSchema, body: UpdateCustomerSchema }),
    async (req, res) => {
      const { customerId } = validated<typeof CustomerParamsSchema._output>(res, 'params');
      const body = validated<typeof UpdateCustomerSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .correctCustomer(
            actorOf(res),
            customerId,
            body,
            requestContext(req, res, `${base}/customers/:customerId`),
          ),
      );
    },
  );

  router.post(
    '/customers/:customerId/consents',
    requirePermission('crm.customer.manage', options.guard),
    validate({ params: CustomerParamsSchema, body: RecordConsentSchema }),
    async (req, res) => {
      const { customerId } = validated<typeof CustomerParamsSchema._output>(res, 'params');
      const body = validated<typeof RecordConsentSchema._output>(res, 'body');
      res
        .status(201)
        .json(
          await options
            .getService()
            .recordConsent(
              actorOf(res),
              customerId,
              body,
              requestContext(req, res, `${base}/customers/:customerId/consents`),
            ),
        );
    },
  );

  router.post(
    '/customers/:customerId/transfer',
    requirePermission('crm.customer.transfer', options.guard),
    validate({ params: CustomerParamsSchema, body: TransferOwnershipSchema }),
    async (req, res) => {
      const { customerId } = validated<typeof CustomerParamsSchema._output>(res, 'params');
      const body = validated<typeof TransferOwnershipSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .transferCustomer(
            actorOf(res),
            customerId,
            body,
            requestContext(req, res, `${base}/customers/:customerId/transfer`),
          ),
      );
    },
  );

  router.get(
    '/customers/:customerId/duplicates',
    requirePermission('crm.customer.view', options.guard),
    validate({ params: CustomerParamsSchema }),
    async (_req, res) => {
      const { customerId } = validated<typeof CustomerParamsSchema._output>(res, 'params');
      res.json(await options.getService().customerDuplicates(actorOf(res), customerId));
    },
  );

  router.get(
    '/customers/:customerId/ownership',
    requirePermission('crm.customer.view', options.guard),
    validate({ params: CustomerParamsSchema }),
    async (_req, res) => {
      const { customerId } = validated<typeof CustomerParamsSchema._output>(res, 'params');
      res.json({
        items: await options.getService().customerOwnershipHistory(actorOf(res), customerId),
      });
    },
  );

  router.get(
    '/customers/:customerId/activities',
    requirePermission('crm.customer.view', options.guard),
    validate({ params: CustomerParamsSchema }),
    async (_req, res) => {
      const { customerId } = validated<typeof CustomerParamsSchema._output>(res, 'params');
      res.json({
        items: await options.getService().listCustomerActivities(actorOf(res), customerId),
      });
    },
  );

  router.post(
    '/customers/:customerId/activities',
    requirePermission('crm.activity.create', options.guard),
    validate({ params: CustomerParamsSchema, body: CreateActivitySchema }),
    async (req, res) => {
      const { customerId } = validated<typeof CustomerParamsSchema._output>(res, 'params');
      const body = validated<typeof CreateActivitySchema._output>(res, 'body');
      res
        .status(201)
        .json(
          await options
            .getService()
            .addCustomerActivity(
              actorOf(res),
              customerId,
              body,
              requestContext(req, res, `${base}/customers/:customerId/activities`),
            ),
        );
    },
  );

  /* --------------------------------------------------------- opportunities */

  router.get(
    '/opportunities',
    requirePermission('crm.opportunity.view', options.guard),
    validate({ query: OpportunityQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof OpportunityQuerySchema._output>(res, 'query');
      res.json(await options.getOpportunities().list(actorOf(res), query));
    },
  );

  // Declared before '/opportunities/:opportunityId' so "summary" is never read as an identifier.
  router.get(
    '/opportunities/summary',
    requirePermission('crm.opportunity.view', options.guard),
    async (_req, res) => {
      res.json(await options.getOpportunities().summary(actorOf(res)));
    },
  );

  router.post(
    '/opportunities',
    requirePermission('crm.opportunity.manage', options.guard),
    validate({ body: CreateOpportunitySchema }),
    async (req, res) => {
      const body = validated<typeof CreateOpportunitySchema._output>(res, 'body');
      res
        .status(201)
        .json(
          await options
            .getOpportunities()
            .create(actorOf(res), body, requestContext(req, res, `${base}/opportunities`)),
        );
    },
  );

  router.get(
    '/opportunities/:opportunityId',
    requirePermission('crm.opportunity.view', options.guard),
    validate({ params: OpportunityParamsSchema }),
    async (_req, res) => {
      const { opportunityId } = validated<typeof OpportunityParamsSchema._output>(res, 'params');
      res.json(await options.getOpportunities().get(actorOf(res), opportunityId));
    },
  );

  router.patch(
    '/opportunities/:opportunityId',
    requirePermission('crm.opportunity.manage', options.guard),
    validate({ params: OpportunityParamsSchema, body: UpdateOpportunitySchema }),
    async (req, res) => {
      const { opportunityId } = validated<typeof OpportunityParamsSchema._output>(res, 'params');
      const body = validated<typeof UpdateOpportunitySchema._output>(res, 'body');
      res.json(
        await options
          .getOpportunities()
          .update(
            actorOf(res),
            opportunityId,
            body,
            requestContext(req, res, `${base}/opportunities/:opportunityId`),
          ),
      );
    },
  );

  router.post(
    '/opportunities/:opportunityId/stage',
    requirePermission('crm.opportunity.manage', options.guard),
    validate({ params: OpportunityParamsSchema, body: ChangeOpportunityStageSchema }),
    async (req, res) => {
      const { opportunityId } = validated<typeof OpportunityParamsSchema._output>(res, 'params');
      const body = validated<typeof ChangeOpportunityStageSchema._output>(res, 'body');
      res.json(
        await options
          .getOpportunities()
          .changeStage(
            actorOf(res),
            opportunityId,
            body,
            requestContext(req, res, `${base}/opportunities/:opportunityId/stage`),
          ),
      );
    },
  );

  router.post(
    '/opportunities/:opportunityId/assign',
    requirePermission('crm.opportunity.assign', options.guard),
    validate({ params: OpportunityParamsSchema, body: AssignOpportunitySchema }),
    async (req, res) => {
      const { opportunityId } = validated<typeof OpportunityParamsSchema._output>(res, 'params');
      const body = validated<typeof AssignOpportunitySchema._output>(res, 'body');
      res.json(
        await options
          .getOpportunities()
          .assign(
            actorOf(res),
            opportunityId,
            body,
            requestContext(req, res, `${base}/opportunities/:opportunityId/assign`),
          ),
      );
    },
  );

  router.get(
    '/opportunities/:opportunityId/ownership',
    requirePermission('crm.opportunity.view', options.guard),
    validate({ params: OpportunityParamsSchema }),
    async (_req, res) => {
      const { opportunityId } = validated<typeof OpportunityParamsSchema._output>(res, 'params');
      res.json({
        items: await options.getOpportunities().ownershipHistory(actorOf(res), opportunityId),
      });
    },
  );

  router.get(
    '/opportunities/:opportunityId/activities',
    requirePermission('crm.opportunity.view', options.guard),
    validate({ params: OpportunityParamsSchema }),
    async (_req, res) => {
      const { opportunityId } = validated<typeof OpportunityParamsSchema._output>(res, 'params');
      res.json({ items: await options.getOpportunities().activities(actorOf(res), opportunityId) });
    },
  );

  router.post(
    '/opportunities/:opportunityId/activities',
    requirePermission('crm.activity.create', options.guard),
    validate({ params: OpportunityParamsSchema, body: CreateActivitySchema }),
    async (req, res) => {
      const { opportunityId } = validated<typeof OpportunityParamsSchema._output>(res, 'params');
      const body = validated<typeof CreateActivitySchema._output>(res, 'body');
      res
        .status(201)
        .json(
          await options
            .getOpportunities()
            .addActivity(
              actorOf(res),
              opportunityId,
              body,
              requestContext(req, res, `${base}/opportunities/:opportunityId/activities`),
            ),
        );
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
    '/leads/:leadId/qualify',
    requirePermission('crm.lead.edit', options.guard),
    validate({ params: LeadParamsSchema, body: QualifyLeadSchema }),
    async (req, res) => {
      const { leadId } = validated<typeof LeadParamsSchema._output>(res, 'params');
      const body = validated<typeof QualifyLeadSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .qualifyLead(
            actorOf(res),
            leadId,
            body,
            requestContext(req, res, `${base}/leads/:leadId/qualify`),
          ),
      );
    },
  );

  router.post(
    '/leads/:leadId/convert',
    requirePermission('crm.lead.convert', options.guard),
    validate({ params: LeadParamsSchema, body: ConvertLeadSchema }),
    async (req, res) => {
      const { leadId } = validated<typeof LeadParamsSchema._output>(res, 'params');
      const body = validated<typeof ConvertLeadSchema._output>(res, 'body');
      const actor = actorOf(res);
      const context = requestContext(req, res, `${base}/leads/:leadId/convert`);
      // Opening an opportunity on the way is an opportunity action, with its own permission.
      if (body.opportunity && !can(actor, 'crm.opportunity.manage')) {
        throw new AppError('FORBIDDEN', 403);
      }
      const extras = body.opportunity;
      const { replayed, ...result } = await options
        .getService()
        .convertLead(
          actor,
          leadId,
          context,
          extras
            ? (lead, customer, session) =>
                options
                  .getOpportunities()
                  .createFromLead(actor, lead, customer, extras, context, session)
            : undefined,
        );
      // Converting a converted lead is a replay: it stored nothing and recorded nothing.
      if (replayed) markAuditExempt(res);
      res.json(result);
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
    '/leads/:leadId/ownership',
    requirePermission('crm.lead.view', options.guard),
    validate({ params: LeadParamsSchema }),
    async (_req, res) => {
      const { leadId } = validated<typeof LeadParamsSchema._output>(res, 'params');
      res.json({ items: await options.getService().leadOwnershipHistory(actorOf(res), leadId) });
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
