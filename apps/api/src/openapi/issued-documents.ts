import {
  ISSUED_DOCUMENT_TYPES,
  IssueDocumentSchema,
  IssuePreviewSchema,
  IssuedDocumentListSchema,
  IssuedDocumentSchema,
  PublicVerificationSchema,
  RevokeIssuedDocumentSchema,
} from '@alola/contracts';
import {
  pathParameter,
  queryParameter,
  requestBody,
  type OpenApiHelpers,
  type PathMap,
} from './shared';

export const issuedDocumentComponents = {
  IssuedDocument: IssuedDocumentSchema,
  IssuedDocumentList: IssuedDocumentListSchema,
  IssueDocumentRequest: IssueDocumentSchema,
  IssuePreview: IssuePreviewSchema,
  RevokeIssuedDocumentRequest: RevokeIssuedDocumentSchema,
  PublicVerification: PublicVerificationSchema,
} as const;

export function issuedDocumentPaths(h: OpenApiHelpers): PathMap {
  return {
    '/api/v1/issued-documents': {
      get: {
        operationId: 'listIssuedDocuments',
        summary: 'Issued documents of one source record, newest first',
        description:
          'Requires document.view and, per document type, the permission that reads its source ' +
          "(ISSUED_DOCUMENT_PERMISSIONS). Scoped by the source's placement inside the query; an issue " +
          'whose file prints a restricted field (a buyer identity) is absent for anyone who may not ' +
          'see that field (SEC-029). The file itself is fetched through POST ' +
          '/api/v1/documents/{documentId}/download, which records the download (CORE-DOC-006).',
        parameters: [
          queryParameter('sourceType', {
            type: 'string',
            enum: ['quotation', 'reservation', 'contract', 'receipt', 'customer'],
          }),
          queryParameter('sourceId', { type: 'string' }),
        ],
        responses: { '200': h.json('IssuedDocumentList', 'The issues'), ...h.authorizedErrors },
      },
      post: {
        operationId: 'issueDocument',
        summary: 'Generate a business PDF in one language',
        description:
          'Requires document.generate and the source permission for the type. Server-side PDF with ' +
          'embedded Alexandria (Arabic) and Inter (English), A4, bidirectional layout (CORE-DOC-003). ' +
          'Reads the source as the actor sees it, so the PDF prints only what the actor may see. ' +
          'Each call is a new version: the file becomes the next version of the source’s generated ' +
          'document and the previous issue in that language is superseded in the same transaction. ' +
          'Refused with COMPANY_PROFILE_REQUIRED before a company profile exists. The response ' +
          'carries the verification link printed in the QR code.',
        requestBody: requestBody(h.ref('IssueDocumentRequest')),
        responses: {
          '201': h.json('IssuedDocument', 'The issued document'),
          ...h.notFoundErrors,
          ...h.conflictErrors,
        },
      },
    },
    '/api/v1/issued-documents/preview': {
      get: {
        operationId: 'previewIssuedDocument',
        summary: 'Safe metadata before generating',
        description:
          'Requires document.generate and the source permission. Returns the business reference, the ' +
          'next version per language, warnings (draft, not final, cancelled, identity missing, no ' +
          'approved wording…) and the restricted fields the file would print. Never document content.',
        parameters: [
          queryParameter('type', { type: 'string', enum: [...ISSUED_DOCUMENT_TYPES] }),
          queryParameter('sourceId', { type: 'string' }),
        ],
        responses: { '200': h.json('IssuePreview', 'The preview'), ...h.notFoundErrors },
      },
    },
    '/api/v1/issued-documents/{issueId}': {
      get: {
        operationId: 'getIssuedDocument',
        summary: 'Read one issue record',
        description: 'Requires document.view and the source permission. Out of scope answers 404.',
        parameters: [pathParameter('issueId', 'Opaque issue identifier')],
        responses: { '200': h.json('IssuedDocument', 'The issue'), ...h.notFoundErrors },
      },
    },
    '/api/v1/issued-documents/{issueId}/revoke': {
      post: {
        operationId: 'revokeIssuedDocument',
        summary: 'Revoke an issued document',
        description:
          'Requires the administrative document.revoke. The verification page reports it revoked ' +
          'from then on; the row, the file and the audit trail are kept.',
        parameters: [pathParameter('issueId', 'Opaque issue identifier')],
        requestBody: requestBody(h.ref('RevokeIssuedDocumentRequest')),
        responses: { '200': h.json('IssuedDocument', 'The revoked issue'), ...h.conflictErrors },
      },
    },
    '/api/v1/public/verify/{token}': {
      get: {
        operationId: 'verifyIssuedDocument',
        summary: 'Verify a scanned document (public)',
        description:
          'No sign-in (CORE-DOC-005). The token is 256 random bits, base64url, printed only in the ' +
          'QR code. Answers valid, superseded, revoked, expired (a quotation past its validity) or ' +
          'invalid, with only the issuing company, document type, business number, issue date, ' +
          'version and fingerprint — never a customer, amount, identity, address or internal ' +
          'identifier. An unknown, forged or malformed token gets the same bare invalid. Rate-limited ' +
          'per address (VERIFY_RATE_LIMIT_PER_MINUTE) on top of the global limit; Cache-Control: ' +
          'no-store; X-Robots-Tag: noindex. Recorded without the caller’s address or browser.',
        security: [],
        parameters: [pathParameter('token', 'Verification token from the QR code')],
        responses: { '200': h.json('PublicVerification', 'The verification'), ...h.standardErrors },
      },
    },
  };
}
