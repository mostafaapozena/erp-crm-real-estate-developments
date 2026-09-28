import {
  ArchiveDocumentSchema,
  CreateTemplateSchema,
  DOCUMENT_MAX_BYTES,
  DocumentQuerySchema,
  DownloadRequestSchema,
  PreviewTemplateSchema,
  PublishTemplateSchema,
  RecordIdSchema,
  RetentionSchema,
  TemplateKindSchema,
  UpdateTemplateDraftSchema,
  UploadDocumentQuerySchema,
  UploadVersionQuerySchema,
} from '@alola/contracts';
import type { LocalDiskFileStore } from '@alola/security';
import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { markAuditExempt } from '../../http/audit-context';
import { requirePermission, type GuardOptions } from '../../http/actor';
import { requestContextOf, requireActor } from '../../http/request-context';
import { validate, validated } from '../../http/validate';
import { invalid, notFound } from '../../platform/audit-port';
import type { DocumentService } from './service';
import type { TemplateService } from './templates';

/**
 * Documents, templates and signed file delivery (CORE-DOC-002, 004, 006).
 *
 * Uploads send the file as the request body, with its metadata in the query string, so no multipart
 * parser is needed and the bytes reach validation untouched. The body parser accepts any type on
 * purpose: a wrong type must arrive to be refused with a code, not arrive empty.
 */
export interface DocumentRouterOptions {
  getDocuments: () => DocumentService;
  getTemplates: () => TemplateService;
  guard?: GuardOptions;
}

const DocumentParamsSchema = z.strictObject({ documentId: RecordIdSchema });
const TemplateParamsSchema = z.strictObject({
  templateKey: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
  version: z.coerce.number().int().positive(),
});
const TemplateQuerySchema = z.strictObject({
  kind: TemplateKindSchema.optional(),
  templateKey: z
    .string()
    .regex(/^[a-z][a-z0-9-]{2,63}$/)
    .optional(),
});

const rawFile = express.raw({ type: () => true, limit: DOCUMENT_MAX_BYTES });

function fileOf(req: Request): { bytes: Uint8Array; declaredType: string } {
  const body: unknown = req.body;
  if (!Buffer.isBuffer(body) || body.byteLength === 0) throw invalid('EMPTY_FILE', ['file']);
  return { bytes: body, declaredType: req.get('content-type') ?? '' };
}

export function documentRouter(options: DocumentRouterOptions): Router {
  const router = Router();
  const base = '/api/v1/documents';
  const service = () => options.getDocuments();

  router.get(
    '/',
    requirePermission('document.view', options.guard),
    validate({ query: DocumentQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof DocumentQuerySchema._output>(res, 'query');
      res.json(await service().listDocuments(requireActor(res), query));
    },
  );

  router.post(
    '/uploads',
    requirePermission('document.upload', options.guard),
    rawFile,
    validate({ query: UploadDocumentQuerySchema }),
    async (req, res) => {
      const query = validated<typeof UploadDocumentQuerySchema._output>(res, 'query');
      const created = await service().upload(
        requireActor(res),
        query,
        fileOf(req),
        requestContextOf(req, res, `${base}/uploads`),
      );
      res.status(201).json(created);
    },
  );

  router.get(
    '/:documentId',
    requirePermission('document.view', options.guard),
    validate({ params: DocumentParamsSchema }),
    async (_req, res) => {
      const { documentId } = validated<typeof DocumentParamsSchema._output>(res, 'params');
      res.json(await service().getDocument(requireActor(res), documentId));
    },
  );

  router.post(
    '/:documentId/versions',
    requirePermission('document.upload', options.guard),
    rawFile,
    validate({ params: DocumentParamsSchema, query: UploadVersionQuerySchema }),
    async (req, res) => {
      const { documentId } = validated<typeof DocumentParamsSchema._output>(res, 'params');
      const query = validated<typeof UploadVersionQuerySchema._output>(res, 'query');
      res
        .status(201)
        .json(
          await service().addVersion(
            requireActor(res),
            documentId,
            query,
            fileOf(req),
            requestContextOf(req, res, `${base}/:documentId/versions`),
          ),
        );
    },
  );

  router.post(
    '/:documentId/download',
    requirePermission('document.download', options.guard),
    validate({ params: DocumentParamsSchema, body: DownloadRequestSchema }),
    async (req, res) => {
      const { documentId } = validated<typeof DocumentParamsSchema._output>(res, 'params');
      const body = validated<typeof DownloadRequestSchema._output>(res, 'body');
      res.json(
        await service().downloadLink(
          requireActor(res),
          documentId,
          body,
          requestContextOf(req, res, `${base}/:documentId/download`),
        ),
      );
    },
  );

  router.post(
    '/:documentId/archive',
    requirePermission('document.archive', options.guard),
    validate({ params: DocumentParamsSchema, body: ArchiveDocumentSchema }),
    async (req, res) => {
      const { documentId } = validated<typeof DocumentParamsSchema._output>(res, 'params');
      const { reason } = validated<typeof ArchiveDocumentSchema._output>(res, 'body');
      res.json(
        await service().archive(
          requireActor(res),
          documentId,
          reason,
          requestContextOf(req, res, `${base}/:documentId/archive`),
        ),
      );
    },
  );

  router.put(
    '/:documentId/retention',
    requirePermission('document.manageRetention', options.guard),
    validate({ params: DocumentParamsSchema, body: RetentionSchema }),
    async (req, res) => {
      const { documentId } = validated<typeof DocumentParamsSchema._output>(res, 'params');
      const body = validated<typeof RetentionSchema._output>(res, 'body');
      res.json(
        await service().setRetention(
          requireActor(res),
          documentId,
          body,
          requestContextOf(req, res, `${base}/:documentId/retention`),
        ),
      );
    },
  );

  return router;
}

export function templateRouter(options: DocumentRouterOptions): Router {
  const router = Router();
  const base = '/api/v1/templates';
  const service = () => options.getTemplates();

  router.get(
    '/',
    requirePermission('template.view', options.guard),
    validate({ query: TemplateQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof TemplateQuerySchema._output>(res, 'query');
      res.json({ items: await service().listTemplates(query) });
    },
  );

  router.post(
    '/',
    requirePermission('template.manage', options.guard),
    validate({ body: CreateTemplateSchema }),
    async (req, res) => {
      const body = validated<typeof CreateTemplateSchema._output>(res, 'body');
      res
        .status(201)
        .json(
          await service().createDraft(requireActor(res), body, requestContextOf(req, res, base)),
        );
    },
  );

  router.get(
    '/:templateKey/versions/:version',
    requirePermission('template.view', options.guard),
    validate({ params: TemplateParamsSchema }),
    async (_req, res) => {
      const { templateKey, version } = validated<typeof TemplateParamsSchema._output>(
        res,
        'params',
      );
      res.json(await service().getTemplate(templateKey, version));
    },
  );

  router.put(
    '/:templateKey/versions/:version',
    requirePermission('template.manage', options.guard),
    validate({ params: TemplateParamsSchema, body: UpdateTemplateDraftSchema }),
    async (req, res) => {
      const { templateKey, version } = validated<typeof TemplateParamsSchema._output>(
        res,
        'params',
      );
      const body = validated<typeof UpdateTemplateDraftSchema._output>(res, 'body');
      res.json(
        await service().updateDraft(
          requireActor(res),
          templateKey,
          version,
          body,
          requestContextOf(req, res, `${base}/:templateKey/versions/:version`),
        ),
      );
    },
  );

  for (const change of ['publish', 'retire'] as const) {
    router.post(
      `/:templateKey/versions/:version/${change}`,
      requirePermission('template.manage', options.guard),
      validate({ params: TemplateParamsSchema, body: PublishTemplateSchema }),
      async (req, res) => {
        const { templateKey, version } = validated<typeof TemplateParamsSchema._output>(
          res,
          'params',
        );
        const { reason } = validated<typeof PublishTemplateSchema._output>(res, 'body');
        const context = requestContextOf(
          req,
          res,
          `${base}/:templateKey/versions/:version/${change}`,
        );
        res.json(
          change === 'publish'
            ? await service().publish(requireActor(res), templateKey, version, reason, context)
            : await service().retire(requireActor(res), templateKey, version, reason, context),
        );
      },
    );
  }

  /** A read expressed as POST because it takes a body; it changes nothing. */
  router.post(
    '/:templateKey/versions/:version/preview',
    requirePermission('template.view', options.guard),
    validate({ params: TemplateParamsSchema, body: PreviewTemplateSchema }),
    async (_req, res) => {
      const { templateKey, version } = validated<typeof TemplateParamsSchema._output>(
        res,
        'params',
      );
      const { locale } = validated<typeof PreviewTemplateSchema._output>(res, 'body');
      markAuditExempt(res);
      res.json({ locale, text: await service().preview(templateKey, version, locale) });
    },
  );

  return router;
}

/**
 * Signed file delivery for the **local** store (development and test). A production store answers
 * signed links itself, from private object storage; this route is not mounted there.
 *
 * The token is the capability: it names one stored object, carries its expiry, and is signed with a
 * key that lives only in this process. The response is always an attachment with the verified type
 * and `nosniff`, and is never cached.
 */
export function fileRouter(options: { store: LocalDiskFileStore }): Router {
  const router = Router();
  const TokenParamsSchema = z.strictObject({ token: z.string().min(10).max(2000) });

  router.get('/:token', validate({ params: TokenParamsSchema }), async (_req, res) => {
    const { token } = validated<typeof TokenParamsSchema._output>(res, 'params');
    const grant = options.store.verify(token);
    if (!grant) throw notFound();
    const bytes = await options.store.read(grant.key);
    res.setHeader('Content-Type', grant.contentType || 'application/octet-stream');
    res.setHeader('Content-Length', String(bytes.byteLength));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(grant.fileName)}`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(bytes));
  });

  return router;
}
