import {
  CommitImportSchema,
  CreateExportSchema,
  IMPORT_MAX_BYTES,
  RecordIdSchema,
  UploadImportQuerySchema,
} from '@alola/contracts';
import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuthenticated, type GuardOptions } from '../../http/actor';
import { requestContextOf, requireActor } from '../../http/request-context';
import { validate, validated } from '../../http/validate';
import { invalid } from '../../platform/audit-port';
import type { ImportService } from './service';

/**
 * Import and export HTTP surface (CORE-IMPORT-001 … 003).
 *
 * A session is required everywhere; the permission is the importer's or exporter's own (for example
 * `referenceData.manage` to import reference items, `crm.lead.export` to export leads), checked by
 * the service because it depends on the kind in the request. A batch belongs to the person who
 * uploaded it: anyone else is answered as if it did not exist.
 */
export interface ImportRouterOptions {
  getService: () => ImportService;
  guard?: GuardOptions;
}

const BatchParamsSchema = z.strictObject({ batchId: RecordIdSchema });
const rawFile = express.raw({ type: () => true, limit: IMPORT_MAX_BYTES });

function bytesOf(req: Request): Uint8Array {
  const body: unknown = req.body;
  if (!Buffer.isBuffer(body) || body.byteLength === 0) throw invalid('FILE_EMPTY', ['file']);
  return body;
}

export function importRouter(options: ImportRouterOptions): Router {
  const router = Router();
  const base = '/api/v1/imports';
  const service = () => options.getService();

  router.post(
    '/',
    requireAuthenticated(options.guard),
    rawFile,
    validate({ query: UploadImportQuerySchema }),
    async (req, res) => {
      const query = validated<typeof UploadImportQuerySchema._output>(res, 'query');
      res
        .status(201)
        .json(
          await service().preview(
            requireActor(res),
            query,
            bytesOf(req),
            requestContextOf(req, res, base),
          ),
        );
    },
  );

  router.get(
    '/:batchId',
    requireAuthenticated(options.guard),
    validate({ params: BatchParamsSchema }),
    async (_req, res) => {
      const { batchId } = validated<typeof BatchParamsSchema._output>(res, 'params');
      res.json(await service().getBatch(requireActor(res), batchId));
    },
  );

  router.get(
    '/:batchId/issues.csv',
    requireAuthenticated(options.guard),
    validate({ params: BatchParamsSchema }),
    async (_req, res) => {
      const { batchId } = validated<typeof BatchParamsSchema._output>(res, 'params');
      const csv = await service().issueReport(requireActor(res), batchId);
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="import-issues-${batchId}.csv"`);
      res.set('X-Content-Type-Options', 'nosniff');
      res.send(csv);
    },
  );

  router.post(
    '/:batchId/commit',
    requireAuthenticated(options.guard),
    validate({ params: BatchParamsSchema, body: CommitImportSchema }),
    async (req, res) => {
      const { batchId } = validated<typeof BatchParamsSchema._output>(res, 'params');
      const { expectedVersion } = validated<typeof CommitImportSchema._output>(res, 'body');
      res.json(
        await service().commit(
          requireActor(res),
          batchId,
          expectedVersion,
          requestContextOf(req, res, `${base}/:batchId/commit`),
        ),
      );
    },
  );

  router.post(
    '/:batchId/discard',
    requireAuthenticated(options.guard),
    validate({ params: BatchParamsSchema, body: CommitImportSchema }),
    async (req, res) => {
      const { batchId } = validated<typeof BatchParamsSchema._output>(res, 'params');
      const { expectedVersion } = validated<typeof CommitImportSchema._output>(res, 'body');
      res.json(
        await service().discard(
          requireActor(res),
          batchId,
          expectedVersion,
          requestContextOf(req, res, `${base}/:batchId/discard`),
        ),
      );
    },
  );

  return router;
}

/** Exports live under their own path: `POST /api/v1/exports`. */
export function exportRouter(options: ImportRouterOptions): Router {
  const router = Router();
  router.post(
    '/',
    requireAuthenticated(options.guard),
    validate({ body: CreateExportSchema }),
    async (req, res) => {
      const { kind } = validated<typeof CreateExportSchema._output>(res, 'body');
      res
        .status(201)
        .json(
          await options
            .getService()
            .export(requireActor(res), kind, requestContextOf(req, res, '/api/v1/exports')),
        );
    },
  );
  return router;
}
