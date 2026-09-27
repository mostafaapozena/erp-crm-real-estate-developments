import {
  ActivateSequenceSchema,
  CreateSequenceSchema,
  IssuedNumberQuerySchema,
  PreviewNumberSchema,
  SequenceTypeSchema,
  UpdateSequenceDraftSchema,
} from '@alola/contracts';
import { Router } from 'express';
import { z } from 'zod';
import { markAuditExempt } from '../../http/audit-context';
import { requirePermission, type GuardOptions } from '../../http/actor';
import { requestContextOf, requireActor } from '../../http/request-context';
import { validate, validated } from '../../http/validate';
import type { NumberingService } from './service';

/**
 * Number sequence administration (CORE-DOC-001). There is deliberately **no issue route**: a number
 * is issued by the module creating the document, inside its transaction, so nobody can consume
 * numbers from outside a document.
 */
export interface NumberingRouterOptions {
  getService: () => NumberingService;
  guard?: GuardOptions;
}

const VersionParamsSchema = z.strictObject({
  type: SequenceTypeSchema,
  version: z.coerce.number().int().positive(),
});
const ListQuerySchema = z.strictObject({ type: SequenceTypeSchema.optional() });

export function numberingRouter(options: NumberingRouterOptions): Router {
  const router = Router();
  const base = '/api/v1/numbering';

  router.get(
    '/sequences',
    requirePermission('numbering.view', options.guard),
    validate({ query: ListQuerySchema }),
    async (_req, res) => {
      const { type } = validated<typeof ListQuerySchema._output>(res, 'query');
      res.json({ items: await options.getService().listSequences(type) });
    },
  );

  router.post(
    '/sequences',
    requirePermission('numbering.manage', options.guard),
    validate({ body: CreateSequenceSchema }),
    async (req, res) => {
      const body = validated<typeof CreateSequenceSchema._output>(res, 'body');
      const created = await options
        .getService()
        .createDraft(requireActor(res), body, requestContextOf(req, res, `${base}/sequences`));
      res.status(201).json(created);
    },
  );

  router.patch(
    '/sequences/:type/versions/:version',
    requirePermission('numbering.manage', options.guard),
    validate({ params: VersionParamsSchema, body: UpdateSequenceDraftSchema }),
    async (req, res) => {
      const { type, version } = validated<typeof VersionParamsSchema._output>(res, 'params');
      const body = validated<typeof UpdateSequenceDraftSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .updateDraft(
            requireActor(res),
            type,
            version,
            body,
            requestContextOf(req, res, `${base}/sequences/:type/versions/:version`),
          ),
      );
    },
  );

  router.post(
    '/sequences/:type/versions/:version/activate',
    requirePermission('numbering.manage', options.guard),
    validate({ params: VersionParamsSchema, body: ActivateSequenceSchema }),
    async (req, res) => {
      const { type, version } = validated<typeof VersionParamsSchema._output>(res, 'params');
      const { reason } = validated<typeof ActivateSequenceSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .activate(
            requireActor(res),
            type,
            version,
            reason,
            requestContextOf(req, res, `${base}/sequences/:type/versions/:version/activate`),
          ),
      );
    },
  );

  /** A read expressed as POST because it takes a body; it changes nothing and reserves nothing. */
  router.post(
    '/preview',
    requirePermission('numbering.view', options.guard),
    validate({ body: PreviewNumberSchema }),
    async (_req, res) => {
      const body = validated<typeof PreviewNumberSchema._output>(res, 'body');
      markAuditExempt(res);
      res.json(await options.getService().preview(body));
    },
  );

  router.get(
    '/issued',
    requirePermission('numbering.view', options.guard),
    validate({ query: IssuedNumberQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof IssuedNumberQuerySchema._output>(res, 'query');
      res.json(await options.getService().listIssued(query));
    },
  );

  return router;
}
