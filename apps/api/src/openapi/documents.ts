import {
  ArchiveDocumentSchema,
  BusinessDocumentSchema,
  CreateTemplateSchema,
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_OWNER_TYPES,
  DocumentListSchema,
  DownloadLinkSchema,
  DownloadRequestSchema,
  PreviewTemplateSchema,
  PublishTemplateSchema,
  RetentionSchema,
  TEMPLATE_KINDS,
  TemplateListSchema,
  TemplatePreviewSchema,
  TemplateSchema,
  UpdateTemplateDraftSchema,
} from '@alola/contracts';
import {
  pathParameter,
  queryParameter,
  requestBody,
  type OpenApiHelpers,
  type PathMap,
} from './shared';

/** Schemas documents and templates contribute (CORE-DOC-002, 004, 006). */
export const documentComponents = {
  Document: BusinessDocumentSchema,
  DocumentList: DocumentListSchema,
  DownloadRequest: DownloadRequestSchema,
  DownloadLink: DownloadLinkSchema,
  ArchiveDocumentRequest: ArchiveDocumentSchema,
  RetentionRequest: RetentionSchema,
  Template: TemplateSchema,
  TemplateList: TemplateListSchema,
  CreateTemplateRequest: CreateTemplateSchema,
  UpdateTemplateDraftRequest: UpdateTemplateDraftSchema,
  TemplateLifecycleRequest: PublishTemplateSchema,
  PreviewTemplateRequest: PreviewTemplateSchema,
  TemplatePreview: TemplatePreviewSchema,
} as const;

const fileBody = {
  required: true,
  content: Object.fromEntries(
    DOCUMENT_CONTENT_TYPES.map((type) => [type, { schema: { type: 'string', format: 'binary' } }]),
  ),
};
const documentId = pathParameter('documentId', 'Opaque document identifier');
const templateParameters = [
  pathParameter('templateKey', 'Stable template key'),
  { name: 'version', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
];
const SCOPE =
  "A document is exactly as visible as the record it belongs to: it inherits that record's data " +
  'scope when uploaded, and every list and read is scoped inside the query (SEC-027).';

export function documentPaths(h: OpenApiHelpers): PathMap {
  return {
    '/api/v1/documents': {
      get: {
        operationId: 'listDocuments',
        summary: 'Documents, newest first',
        description: `Requires document.view. ${SCOPE} Archived documents only on request.`,
        parameters: [
          queryParameter('ownerType', { type: 'string', enum: [...DOCUMENT_OWNER_TYPES] }),
          queryParameter('ownerId', { type: 'string' }),
          queryParameter('includeArchived', { type: 'string', enum: ['true', 'false'] }),
          queryParameter('limit', { type: 'integer', minimum: 1, maximum: 100, default: 25 }),
          queryParameter('cursor', { type: 'string' }),
        ],
        responses: { '200': h.json('DocumentList', 'A page of documents'), ...h.authorizedErrors },
      },
    },
    '/api/v1/documents/uploads': {
      post: {
        operationId: 'uploadDocument',
        summary: 'Attach a new document to a record',
        description:
          'Requires document.upload. The body is the file; ownerType, ownerId, category, title and ' +
          'fileName travel in the query string. The owning record is looked up as the actor sees it: ' +
          `outside the actor's scope it is 404 and nothing is stored. PDF, PNG or JPEG only, at most ` +
          `${DOCUMENT_MAX_BYTES} bytes, verified by magic bytes (CONTENT_TYPE_MISMATCH otherwise). The ` +
          'file name is sanitized — directories, control and bidirectional characters removed — and its ' +
          'extension forced to the verified type. No malware scanner is configured yet, so files are ' +
          'recorded not_scanned; an infected verdict is refused and audited.',
        parameters: [
          queryParameter('ownerType', { type: 'string', enum: [...DOCUMENT_OWNER_TYPES] }),
          queryParameter('ownerId', { type: 'string' }),
          queryParameter('category', { type: 'string' }),
          queryParameter('title', { type: 'string' }),
          queryParameter('fileName', { type: 'string' }),
        ],
        requestBody: fileBody,
        responses: {
          '201': h.json('Document', 'The document, version 1'),
          '413': h.json('ErrorResponse', 'Larger than the limit (PAYLOAD_TOO_LARGE)'),
          ...h.notFoundErrors,
        },
      },
    },
    '/api/v1/documents/{documentId}': {
      get: {
        operationId: 'getDocument',
        summary: 'One document with every version',
        description: `Requires document.view. ${SCOPE}`,
        parameters: [documentId],
        responses: { '200': h.json('Document', 'The document'), ...h.notFoundErrors },
      },
    },
    '/api/v1/documents/{documentId}/versions': {
      post: {
        operationId: 'addDocumentVersion',
        summary: 'Upload a new version; every earlier version is kept',
        description:
          'Requires document.upload. Guarded by expectedVersion (the current version the uploader ' +
          'saw); a stale one is CONFLICT and stores nothing (CORE-DOC-004).',
        parameters: [
          documentId,
          queryParameter('fileName', { type: 'string' }),
          queryParameter('expectedVersion', { type: 'integer', minimum: 1 }),
        ],
        requestBody: fileBody,
        responses: { '201': h.json('Document', 'The document'), ...h.conflictErrors },
      },
    },
    '/api/v1/documents/{documentId}/download': {
      post: {
        operationId: 'createDocumentDownloadLink',
        summary: 'A short-lived link to one version — the audited act of downloading or printing',
        description:
          'Requires document.download. Records who obtained which version, for download or print, and ' +
          "the file's scan status, before the link is returned (CORE-DOC-006). The link expires within " +
          'minutes and carries no identity. A quarantined document is refused.',
        parameters: [documentId],
        requestBody: requestBody(h.ref('DownloadRequest')),
        responses: { '200': h.json('DownloadLink', 'The link'), ...h.conflictErrors },
      },
    },
    '/api/v1/documents/{documentId}/archive': {
      post: {
        operationId: 'archiveDocument',
        summary: 'Withdraw a document from everyday lists; nothing is deleted',
        description: 'Requires document.archive. Versions and history are kept (ADR-0009).',
        parameters: [documentId],
        requestBody: requestBody(h.ref('ArchiveDocumentRequest')),
        responses: { '200': h.json('Document', 'The document'), ...h.conflictErrors },
      },
    },
    '/api/v1/documents/{documentId}/retention': {
      put: {
        operationId: 'setDocumentRetention',
        summary: 'Set the retention date and legal hold',
        description:
          'Requires the administrative document.manageRetention. Retention periods themselves are ' +
          'SD-18; this records the decision for one document, with its reason.',
        parameters: [documentId],
        requestBody: requestBody(h.ref('RetentionRequest')),
        responses: { '200': h.json('Document', 'The document'), ...h.notFoundErrors },
      },
    },
    '/api/v1/files/{token}': {
      get: {
        operationId: 'getSignedFile',
        summary:
          'Deliver a file through a signed, expiring token (development and test store only)',
        description:
          'Public: the token is the capability. Forged, altered or expired tokens are 404. Always an ' +
          'attachment, with the verified type, nosniff and no-store. Production serves signed links ' +
          'from private object storage instead, and this route is not mounted there.',
        parameters: [pathParameter('token', 'Signed download token')],
        responses: {
          '200': {
            description: 'The file',
            content: Object.fromEntries(
              DOCUMENT_CONTENT_TYPES.map((type) => [
                type,
                { schema: { type: 'string', format: 'binary' } },
              ]),
            ),
          },
          '404': h.json('ErrorResponse', 'Unknown, altered or expired token'),
          ...h.standardErrors,
        },
      },
    },
    '/api/v1/templates': {
      get: {
        operationId: 'listTemplates',
        summary: 'Templates, every version',
        description: 'Requires template.view.',
        parameters: [
          queryParameter('kind', { type: 'string', enum: [...TEMPLATE_KINDS] }),
          queryParameter('templateKey', { type: 'string' }),
        ],
        responses: { '200': h.json('TemplateList', 'The templates'), ...h.authorizedErrors },
      },
      post: {
        operationId: 'createTemplate',
        summary: 'Write a draft template version, in Arabic and English',
        description:
          'Requires the administrative template.manage. No wording ships with the product; templates ' +
          "are the deployment's own content, approved by its owners (SD-10).",
        requestBody: requestBody(h.ref('CreateTemplateRequest')),
        responses: { '201': h.json('Template', 'The draft'), ...h.conflictErrors },
      },
    },
    '/api/v1/templates/{templateKey}/versions/{version}': {
      get: {
        operationId: 'getTemplate',
        summary: 'One template version',
        description: 'Requires template.view.',
        parameters: templateParameters,
        responses: { '200': h.json('Template', 'The version'), ...h.notFoundErrors },
      },
      put: {
        operationId: 'updateTemplateDraft',
        summary: 'Change a draft version',
        description:
          'Requires template.manage. Only a draft changes; a published version is immutable here and ' +
          'in the database layer (TEMPLATE_NOT_DRAFT).',
        parameters: templateParameters,
        requestBody: requestBody(h.ref('UpdateTemplateDraftRequest')),
        responses: { '200': h.json('Template', 'The draft'), ...h.conflictErrors },
      },
    },
    ...Object.fromEntries(
      (['publish', 'retire'] as const).map((change): [string, Record<string, unknown>] => [
        `/api/v1/templates/{templateKey}/versions/{version}/${change}`,
        {
          post: {
            operationId: `${change}Template`,
            summary:
              change === 'publish'
                ? 'Publish a draft — it becomes immutable'
                : 'Retire a published version',
            description:
              change === 'publish'
                ? 'Requires template.manage. Refused when a placeholder is not one the kind supports ' +
                  '(UNKNOWN_PLACEHOLDER) or the two languages use different placeholders ' +
                  '(PLACEHOLDERS_DIFFER_BY_LANGUAGE).'
                : 'Requires template.manage. A retired version stops being selected; it is kept.',
            parameters: templateParameters,
            requestBody: requestBody(h.ref('TemplateLifecycleRequest')),
            responses: { '200': h.json('Template', 'The version'), ...h.conflictErrors },
          },
        },
      ]),
    ),
    '/api/v1/templates/{templateKey}/versions/{version}/preview': {
      post: {
        operationId: 'previewTemplate',
        summary: 'Render a version with synthetic sample values',
        description:
          'Requires template.view. Values are obviously fictional (amounts in XXX, the ISO code for ' +
          '"no currency"); a preview never reads a real record.',
        parameters: templateParameters,
        requestBody: requestBody(h.ref('PreviewTemplateRequest')),
        responses: { '200': h.json('TemplatePreview', 'The rendered text'), ...h.notFoundErrors },
      },
    },
  };
}
