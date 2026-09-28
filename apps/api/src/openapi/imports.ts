import {
  CommitImportSchema,
  CreateExportSchema,
  EXPORT_MAX_ROWS,
  IMPORT_KINDS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  IMPORT_PREVIEW_TTL_HOURS,
  ExportResultSchema,
  ImportBatchSchema,
} from '@alola/contracts';
import {
  pathParameter,
  queryParameter,
  requestBody,
  type OpenApiHelpers,
  type PathMap,
} from './shared';

/** Schemas import and export contribute (CORE-IMPORT-001 … 003). */
export const importComponents = {
  ImportBatch: ImportBatchSchema,
  CommitImport: CommitImportSchema,
  CreateExport: CreateExportSchema,
  ExportResult: ExportResultSchema,
} as const;

export function importPaths(h: OpenApiHelpers): PathMap {
  const batch = [pathParameter('batchId', 'Opaque import batch identifier')];
  const absent = { '404': h.json('ErrorResponse', 'Absent, or uploaded by someone else') };
  const conflict = {
    '409': h.json(
      'ErrorResponse',
      'Not pending, has errors, expired, stale, a code taken meanwhile, or imports disabled',
    ),
  };
  return {
    '/api/v1/imports': {
      post: {
        operationId: 'previewImport',
        summary: 'Upload a CSV or XLSX file and preview it',
        description:
          'The body is the raw file (UTF-8 CSV, or .xlsx — first sheet). Every row is validated and ' +
          `every issue reported by row and column; nothing is written. At most ${String(IMPORT_MAX_ROWS)} ` +
          `rows and ${String(IMPORT_MAX_BYTES)} bytes. The importer's permission is required ` +
          '(referenceItems: referenceData.manage).',
        parameters: [
          queryParameter('kind', { type: 'string', enum: [...IMPORT_KINDS] }),
          queryParameter('fileName', { type: 'string', maxLength: 200 }),
        ],
        requestBody: {
          required: true,
          content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
        },
        responses: {
          '201': h.json('ImportBatch', 'The preview'),
          '409': h.json('ErrorResponse', 'Imports are disabled (FEATURE_DISABLED)'),
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/imports/{batchId}': {
      get: {
        operationId: 'getImportBatch',
        summary: 'A preview I uploaded',
        parameters: batch,
        responses: { '200': h.json('ImportBatch', 'The batch'), ...absent, ...h.authorizedErrors },
      },
    },
    '/api/v1/imports/{batchId}/issues.csv': {
      get: {
        operationId: 'getImportIssueReport',
        summary: 'Every issue of a preview, as formula-safe CSV',
        parameters: batch,
        responses: {
          '200': {
            description: 'row, column, code',
            content: { 'text/csv': { schema: { type: 'string' } } },
          },
          ...absent,
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/imports/{batchId}/commit': {
      post: {
        operationId: 'commitImport',
        summary: 'Write every row, or none',
        description:
          'Refused while any row has an issue, after ' +
          `${String(IMPORT_PREVIEW_TTL_HOURS)} hours, twice, or on a stale version. The rows, the ` +
          'batch state and the audit records commit in one transaction.',
        parameters: batch,
        requestBody: requestBody(h.ref('CommitImport')),
        responses: {
          '200': h.json('ImportBatch', 'The committed batch'),
          ...absent,
          ...conflict,
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/imports/{batchId}/discard': {
      post: {
        operationId: 'discardImport',
        summary: 'Withdraw a preview',
        parameters: batch,
        requestBody: requestBody(h.ref('CommitImport')),
        responses: {
          '200': h.json('ImportBatch', 'The discarded batch'),
          ...absent,
          ...conflict,
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/exports': {
      post: {
        operationId: 'createExport',
        summary: 'Export one kind of data as CSV',
        description:
          'Requires the exporter’s permission (leads: crm.lead.export; units: ' +
          'inventory.unit.export, with prices only for inventory.unit.viewPricing). Scoped and ' +
          `field-restricted by the owning module; refused above ${String(EXPORT_MAX_ROWS)} rows ` +
          '(EXPORT_TOO_LARGE); formula-safe; audited; returned as a link that expires within minutes.',
        requestBody: requestBody(h.ref('CreateExport')),
        responses: {
          '201': h.json('ExportResult', 'The export and its link'),
          '409': h.json('ErrorResponse', 'Exports are disabled (FEATURE_DISABLED)'),
          ...h.authorizedErrors,
        },
      },
    },
  };
}
