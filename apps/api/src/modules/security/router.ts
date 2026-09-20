import {
  CreateRoleRequestSchema,
  SetAccountGrantRequestSchema,
  type ActorContext,
} from '@alola/contracts';
import { Router } from 'express';
import { z } from 'zod';
import { restrictDocument } from '@alola/security';
import { AppError } from '../../errors';
import { currentActor, requirePermission, type GuardOptions } from '../../http/actor';
import { correlationIdOf } from '../../http/correlation';
import { validate, validated } from '../../http/validate';
import type { SecurityService } from './service';

/**
 * Authorization administration surface (SEC-023 … SEC-032).
 *
 * Request schemas are strict objects, so mass assignment is rejected at the boundary rather than
 * filtered later: a body carrying `permissions`, `version`, or `updatedBy` fails validation.
 */
export interface SecurityRouterOptions {
  getService: () => SecurityService;
  guard?: GuardOptions;
}

const AccountIdParamsSchema = z.strictObject({
  accountId: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9._:-]+$/, { message: 'ACCOUNT_ID_EXPECTED' }),
});

export function securityRouter(options: SecurityRouterOptions): Router {
  const router = Router();

  router.get(
    '/roles',
    requirePermission('security.role.view', options.guard),
    async (_req, res) => {
      res.json({ items: await options.getService().listRoles() });
    },
  );

  router.post(
    '/roles',
    requirePermission('security.role.create', options.guard),
    validate({ body: CreateRoleRequestSchema }),
    async (req, res) => {
      const actor = currentActor(res) as ActorContext;
      const body = validated<typeof CreateRoleRequestSchema._output>(res, 'body');
      const role = await options.getService().createRole(actor, body, {
        correlationId: correlationIdOf(res),
        method: req.method,
        route: '/api/v1/security/roles',
        ...(req.ip ? { ip: req.ip } : {}),
      });
      res.status(201).json(role);
    },
  );

  router.get(
    '/accounts/:accountId/grants',
    requirePermission('security.grant.view', options.guard),
    validate({ params: AccountIdParamsSchema }),
    async (_req, res) => {
      const actor = currentActor(res) as ActorContext;
      const { accountId } = validated<typeof AccountIdParamsSchema._output>(res, 'params');
      const grant = await options.getService().getGrant(accountId);
      if (!grant) throw new AppError('NOT_FOUND', 404);
      // SEC-029: restricted fields are removed from the serialized response, not masked client-side.
      res.json(restrictDocument('accountGrant', actor, grant));
    },
  );

  router.put(
    '/accounts/:accountId/grants',
    requirePermission('security.grant.assign', options.guard),
    validate({ params: AccountIdParamsSchema, body: SetAccountGrantRequestSchema }),
    async (req, res) => {
      const actor = currentActor(res) as ActorContext;
      const { accountId } = validated<typeof AccountIdParamsSchema._output>(res, 'params');
      const body = validated<typeof SetAccountGrantRequestSchema._output>(res, 'body');
      const grant = await options.getService().setGrant(actor, accountId, body, {
        correlationId: correlationIdOf(res),
        method: req.method,
        route: '/api/v1/security/accounts/:accountId/grants',
        ...(req.ip ? { ip: req.ip } : {}),
      });
      res.json(grant);
    },
  );

  return router;
}
