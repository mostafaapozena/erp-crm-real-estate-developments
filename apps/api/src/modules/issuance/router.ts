import {
  IssueDocumentSchema,
  IssuePreviewQuerySchema,
  IssuedDocumentQuerySchema,
  RecordIdSchema,
  RevokeIssuedDocumentSchema,
  type ActorContext,
} from '@alola/contracts';
import { Router, type Request, type Response } from 'express';
import type { RateLimiterAbstract } from 'rate-limiter-flexible';
import { z } from 'zod';
import { AppError } from '../../errors';
import { currentActor, requirePermission, type GuardOptions } from '../../http/actor';
import { markAuditExempt } from '../../http/audit-context';
import { correlationIdOf } from '../../http/correlation';
import { rateLimit } from '../../http/rate-limit';
import { validate, validated } from '../../http/validate';
import type { RequestContext } from '../../platform/audit-port';
import type { IssuanceService } from './service';

/**
 * Issued documents over HTTP (CORE-DOC-003, CORE-DOC-005).
 *
 * `document.generate` makes a file, `document.view` lists and reads the issue records, and
 * `document.revoke` (administrative) revokes one. Every route also requires the permission that reads
 * the document's **source** — enforced in the service, per type, so no route is a side door. The file
 * itself is downloaded through the documents module's audited, short-lived link (CORE-DOC-006).
 */
export interface IssuanceRouterOptions {
  getService: () => IssuanceService;
  guard?: GuardOptions;
}

const IssueParamsSchema = z.strictObject({ issueId: RecordIdSchema });
const TokenParamsSchema = z.strictObject({ token: z.string().min(1).max(200) });

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

export function issuanceRouter(options: IssuanceRouterOptions): Router {
  const router = Router();
  const base = '/api/v1/issued-documents';

  router.get(
    '/preview',
    requirePermission('document.generate', options.guard),
    validate({ query: IssuePreviewQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof IssuePreviewQuerySchema._output>(res, 'query');
      res.json(await options.getService().preview(actorOf(res), query.type, query.sourceId));
    },
  );

  router.get(
    '/',
    requirePermission('document.view', options.guard),
    validate({ query: IssuedDocumentQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof IssuedDocumentQuerySchema._output>(res, 'query');
      res.json(await options.getService().list(actorOf(res), query));
    },
  );

  router.post(
    '/',
    requirePermission('document.generate', options.guard),
    validate({ body: IssueDocumentSchema }),
    async (req, res) => {
      const body = validated<typeof IssueDocumentSchema._output>(res, 'body');
      const { issued, replayed } = await options
        .getService()
        .issueOnce(actorOf(res), body, requestContext(req, res, base));
      // A replay stored nothing, so it recorded nothing either.
      if (replayed) markAuditExempt(res);
      res.status(replayed ? 200 : 201).json(issued);
    },
  );

  router.get(
    '/:issueId',
    requirePermission('document.view', options.guard),
    validate({ params: IssueParamsSchema }),
    async (_req, res) => {
      const { issueId } = validated<typeof IssueParamsSchema._output>(res, 'params');
      res.json(await options.getService().get(actorOf(res), issueId));
    },
  );

  router.post(
    '/:issueId/revoke',
    requirePermission('document.revoke', options.guard),
    validate({ params: IssueParamsSchema, body: RevokeIssuedDocumentSchema }),
    async (req, res) => {
      const { issueId } = validated<typeof IssueParamsSchema._output>(res, 'params');
      const body = validated<typeof RevokeIssuedDocumentSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .revoke(
            actorOf(res),
            issueId,
            body.reason,
            requestContext(req, res, `${base}/:issueId/revoke`),
          ),
      );
    },
  );

  return router;
}

export interface VerificationRouterOptions {
  getService: () => IssuanceService;
  /** Its own, tighter budget per address than the global limit: a verification page is public. */
  limiter: RateLimiterAbstract;
}

/**
 * The public verification endpoint (CORE-DOC-005). No sign-in. Rate-limited per address on top of the
 * global limit, never cached, never indexed. The token is 256 random bits; the answer for an unknown
 * one is the same bare `invalid` as for a malformed one.
 */
export function verificationRouter(options: VerificationRouterOptions): Router {
  const router = Router();
  router.get(
    '/verify/:token',
    rateLimit(options.limiter, (req) => `verify:${req.ip ?? 'unknown'}`),
    validate({ params: TokenParamsSchema }),
    async (_req, res) => {
      const { token } = validated<typeof TokenParamsSchema._output>(res, 'params');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.json(await options.getService().verify(token, correlationIdOf(res)));
    },
  );
  return router;
}
