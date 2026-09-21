import {
  CancelRequestSchema,
  CreateDelegationRequestSchema,
  CreatePolicyRequestSchema,
  DecisionRequestSchema,
  PolicyKeySchema,
  ReassignRequestSchema,
  RejectRequestSchema,
  RequestQuerySchema,
  SubmitRequestSchema,
  UpdatePolicyRequestSchema,
  type ActorContext,
} from '@alola/contracts';
import { can } from '@alola/security';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors';
import {
  currentActor,
  requireAuthenticated,
  requirePermission,
  type GuardOptions,
} from '../../http/actor';
import { markAuditExempt } from '../../http/audit-context';
import { correlationIdOf } from '../../http/correlation';
import { validate, validated } from '../../http/validate';
import type { ApprovalService, RequestContext } from './service';

/**
 * Approval HTTP surface (`APPROVAL-001` … `APPROVAL-007`).
 *
 * Every route is authenticated. Breadth is the actor's **data scope**, as everywhere else (ADR-0006): a
 * request outside it is reported as absent, not forbidden. Two routes are deliberately conditional rather
 * than permission-gated at the door, because the answer depends on whose record it is:
 *
 * - cancelling: a requester may always cancel their own request; anyone else needs `approval.request.cancel`;
 * - delegating: managing your own delegation needs `approval.delegation.manage`, and doing it for someone
 *   else needs the administrative `approval.delegation.manageAny`.
 */
export interface ApprovalRouterOptions {
  getService: () => ApprovalService;
  guard?: GuardOptions;
}

const PolicyParamsSchema = z.strictObject({
  key: PolicyKeySchema,
  version: z.coerce.number().int().min(1).max(10_000),
});

const RequestParamsSchema = z.strictObject({
  requestId: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9._:-]+$/, { message: 'REQUEST_ID_EXPECTED' }),
});

const DelegationParamsSchema = z.strictObject({
  delegationId: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9._:-]+$/, { message: 'DELEGATION_ID_EXPECTED' }),
});

const PolicyQuerySchema = z.strictObject({
  key: PolicyKeySchema.optional(),
  state: z.enum(['draft', 'published', 'retired']).optional(),
});

const ReassignAccountSchema = z.strictObject({
  fromAccountId: z.string().min(1).max(200),
  toAccountId: z.string().min(1).max(200),
  reason: z.string().trim().min(3).max(500),
});

const CreateDelegationForSchema = z.strictObject({
  ...CreateDelegationRequestSchema.shape,
  /** Omitted means "my own authority"; naming another account needs the administrative permission. */
  delegatorAccountId: z.string().min(1).max(200).optional(),
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

export function approvalRouter(options: ApprovalRouterOptions): Router {
  const router = Router();

  /* ------------------------------------------------------------- policies */

  router.get(
    '/policies',
    requirePermission('approval.policy.view', options.guard),
    validate({ query: PolicyQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof PolicyQuerySchema._output>(res, 'query');
      res.json({ items: await options.getService().listPolicies(query) });
    },
  );

  router.post(
    '/policies',
    requirePermission('approval.policy.create', options.guard),
    validate({ body: CreatePolicyRequestSchema }),
    async (req, res) => {
      const body = validated<typeof CreatePolicyRequestSchema._output>(res, 'body');
      const policy = await options
        .getService()
        .createPolicy(actorOf(res), body, requestContext(req, res, '/api/v1/approvals/policies'));
      res.status(201).json(policy);
    },
  );

  router.get(
    '/policies/:key/versions/:version',
    requirePermission('approval.policy.view', options.guard),
    validate({ params: PolicyParamsSchema }),
    async (_req, res) => {
      const { key, version } = validated<typeof PolicyParamsSchema._output>(res, 'params');
      res.json(await options.getService().getPolicy(key, version));
    },
  );

  router.patch(
    '/policies/:key/versions/:version',
    requirePermission('approval.policy.create', options.guard),
    validate({ params: PolicyParamsSchema, body: UpdatePolicyRequestSchema }),
    async (req, res) => {
      const { key, version } = validated<typeof PolicyParamsSchema._output>(res, 'params');
      const body = validated<typeof UpdatePolicyRequestSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .updateDraftPolicy(
            actorOf(res),
            key,
            version,
            body,
            requestContext(req, res, '/api/v1/approvals/policies/:key/versions/:version'),
          ),
      );
    },
  );

  router.post(
    '/policies/:key/versions/:version/publish',
    requirePermission('approval.policy.publish', options.guard),
    validate({ params: PolicyParamsSchema }),
    async (req, res) => {
      const { key, version } = validated<typeof PolicyParamsSchema._output>(res, 'params');
      res.json(
        await options
          .getService()
          .publishPolicy(
            actorOf(res),
            key,
            version,
            requestContext(req, res, '/api/v1/approvals/policies/:key/versions/:version/publish'),
          ),
      );
    },
  );

  /* -------------------------------------------------------------- requests */

  router.post(
    '/requests',
    requirePermission('approval.request.create', options.guard),
    validate({ body: SubmitRequestSchema }),
    async (req, res) => {
      const body = validated<typeof SubmitRequestSchema._output>(res, 'body');
      const result = await options
        .getService()
        .submit(actorOf(res), body, requestContext(req, res, '/api/v1/approvals/requests'));
      // A replay records no new audit event, because nothing changed (AUDIT-003).
      if (result.replayed) markAuditExempt(res);
      res.status(result.replayed ? 200 : 201).json(result.request);
    },
  );

  router.get(
    '/requests',
    requirePermission('approval.request.view', options.guard),
    validate({ query: RequestQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof RequestQuerySchema._output>(res, 'query');
      res.json(await options.getService().listRequests(actorOf(res), query));
    },
  );

  /** The maintenance sweep: expire what is past its deadline, escalate what is overdue. Idempotent. */
  router.post(
    '/requests/sweep',
    requirePermission('approval.request.escalate', options.guard),
    async (req, res) => {
      const actor = actorOf(res);
      const context = requestContext(req, res, '/api/v1/approvals/requests/sweep');
      const service = options.getService();
      const expired = await service.expireOverdue(context);
      const escalation = await service.escalateOverdue(actor, context);
      // A sweep that changed nothing has nothing to audit.
      if (expired === 0 && escalation.escalated === 0) markAuditExempt(res);
      res.json({ expired, ...escalation });
    },
  );

  /** Bulk reassignment, the offboarding path (`APPROVAL-007`). */
  router.post(
    '/requests/reassign-account',
    requirePermission('approval.request.reassign', options.guard),
    validate({ body: ReassignAccountSchema }),
    async (req, res) => {
      const body = validated<typeof ReassignAccountSchema._output>(res, 'body');
      const result = await options
        .getService()
        .reassign(
          actorOf(res),
          body,
          requestContext(req, res, '/api/v1/approvals/requests/reassign-account'),
        );
      if (result.reassigned === 0) markAuditExempt(res);
      res.json(result);
    },
  );

  router.get(
    '/requests/:requestId',
    requirePermission('approval.request.view', options.guard),
    validate({ params: RequestParamsSchema }),
    async (_req, res) => {
      const { requestId } = validated<typeof RequestParamsSchema._output>(res, 'params');
      res.json(await options.getService().getRequest(actorOf(res), requestId));
    },
  );

  for (const [path, kind, permission, schema] of [
    ['approve', 'approved', 'approval.request.approve', DecisionRequestSchema],
    ['reject', 'rejected', 'approval.request.reject', RejectRequestSchema],
    // Returning for correction is a refusal that invites a resubmission, so it shares the reject permission.
    ['return', 'returned', 'approval.request.reject', RejectRequestSchema],
  ] as const) {
    router.post(
      `/requests/:requestId/${path}`,
      requirePermission(permission, options.guard),
      validate({ params: RequestParamsSchema, body: schema }),
      async (req, res) => {
        const { requestId } = validated<typeof RequestParamsSchema._output>(res, 'params');
        const body = validated<{ reason?: string; expectedVersion?: number }>(res, 'body');
        res.json(
          await options
            .getService()
            .decide(
              actorOf(res),
              requestId,
              kind,
              body,
              requestContext(req, res, `/api/v1/approvals/requests/:requestId/${path}`),
            ),
        );
      },
    );
  }

  router.post(
    '/requests/:requestId/resubmit',
    requireAuthenticated(options.guard),
    validate({ params: RequestParamsSchema }),
    async (req, res) => {
      const { requestId } = validated<typeof RequestParamsSchema._output>(res, 'params');
      res.json(
        await options
          .getService()
          .resubmit(
            actorOf(res),
            requestId,
            requestContext(req, res, '/api/v1/approvals/requests/:requestId/resubmit'),
          ),
      );
    },
  );

  /**
   * Cancelling is conditional: your own request needs no permission, someone else's needs
   * `approval.request.cancel`. The check reads the stored requester, never anything from the body.
   */
  router.post(
    '/requests/:requestId/cancel',
    requireAuthenticated(options.guard),
    validate({ params: RequestParamsSchema, body: CancelRequestSchema }),
    async (req, res) => {
      const actor = actorOf(res);
      const { requestId } = validated<typeof RequestParamsSchema._output>(res, 'params');
      const body = validated<typeof CancelRequestSchema._output>(res, 'body');
      const service = options.getService();
      const existing = await service.getRequest(actor, requestId);
      if (
        existing.requesterAccountId !== actor.accountId &&
        !can(actor, 'approval.request.cancel')
      ) {
        throw new AppError('FORBIDDEN', 403);
      }
      res.json(
        await service.cancel(
          actor,
          requestId,
          body.reason,
          requestContext(req, res, '/api/v1/approvals/requests/:requestId/cancel'),
        ),
      );
    },
  );

  router.post(
    '/requests/:requestId/reassign',
    requirePermission('approval.request.reassign', options.guard),
    validate({ params: RequestParamsSchema, body: ReassignRequestSchema }),
    async (req, res) => {
      const { requestId } = validated<typeof RequestParamsSchema._output>(res, 'params');
      const body = validated<typeof ReassignRequestSchema._output>(res, 'body');
      const result = await options
        .getService()
        .reassign(
          actorOf(res),
          { requestId, ...body },
          requestContext(req, res, '/api/v1/approvals/requests/:requestId/reassign'),
        );
      if (result.reassigned === 0) markAuditExempt(res);
      res.json(result);
    },
  );

  /* ----------------------------------------------------------- delegations */

  router.get('/delegations', requireAuthenticated(options.guard), async (_req, res) => {
    const actor = actorOf(res);
    const service = options.getService();
    // Your own delegations, in both directions. Someone else's are not listed here.
    const [given, received] = await Promise.all([
      service.listDelegations({ delegatorAccountId: actor.accountId }),
      service.listDelegations({ delegateAccountId: actor.accountId }),
    ]);
    res.json({ items: [...given, ...received] });
  });

  router.post(
    '/delegations',
    requirePermission('approval.delegation.manage', options.guard),
    validate({ body: CreateDelegationForSchema }),
    async (req, res) => {
      const actor = actorOf(res);
      const body = validated<typeof CreateDelegationForSchema._output>(res, 'body');
      const delegatorAccountId = body.delegatorAccountId ?? actor.accountId;
      if (delegatorAccountId !== actor.accountId && !can(actor, 'approval.delegation.manageAny')) {
        throw new AppError('FORBIDDEN', 403);
      }
      const delegation = await options.getService().createDelegation(
        actor,
        {
          delegatorAccountId,
          delegateAccountId: body.delegateAccountId,
          policyKeys: body.policyKeys,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          reason: body.reason,
        },
        requestContext(req, res, '/api/v1/approvals/delegations'),
      );
      res.status(201).json(delegation);
    },
  );

  router.delete(
    '/delegations/:delegationId',
    requirePermission('approval.delegation.manage', options.guard),
    validate({ params: DelegationParamsSchema }),
    async (req, res) => {
      const actor = actorOf(res);
      const { delegationId } = validated<typeof DelegationParamsSchema._output>(res, 'params');
      await options.getService().revokeDelegation(
        actor,
        delegationId,
        requestContext(req, res, '/api/v1/approvals/delegations/:delegationId'),
        // Without the administrative permission, only your own delegation is found at all.
        can(actor, 'approval.delegation.manageAny') ? {} : { ownerAccountId: actor.accountId },
      );
      res.status(204).end();
    },
  );

  return router;
}
