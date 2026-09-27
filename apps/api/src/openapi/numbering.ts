import {
  ActivateSequenceSchema,
  CreateSequenceSchema,
  IssuedNumberPageSchema,
  NumberPreviewSchema,
  PreviewNumberSchema,
  SEQUENCE_TYPES,
  SequenceListSchema,
  SequenceSchema,
  UpdateSequenceDraftSchema,
} from '@alola/contracts';
import { queryParameter, requestBody, type OpenApiHelpers, type PathMap } from './shared';

/** Schemas number sequences contribute (CORE-DOC-001). */
export const numberingComponents = {
  Sequence: SequenceSchema,
  SequenceList: SequenceListSchema,
  CreateSequenceRequest: CreateSequenceSchema,
  UpdateSequenceDraftRequest: UpdateSequenceDraftSchema,
  ActivateSequenceRequest: ActivateSequenceSchema,
  PreviewNumberRequest: PreviewNumberSchema,
  NumberPreview: NumberPreviewSchema,
  IssuedNumberPage: IssuedNumberPageSchema,
} as const;

const typeEnum = { type: 'string', enum: [...SEQUENCE_TYPES] };
const versionParameters = [
  { name: 'type', in: 'path', required: true, schema: typeEnum },
  { name: 'version', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
];
const MANAGE = 'Requires the administrative numbering.manage permission (second factor mandatory).';

export function numberingPaths(h: OpenApiHelpers): PathMap {
  return {
    '/api/v1/numbering/sequences': {
      get: {
        operationId: 'listNumberSequences',
        summary: 'Number formats, every version',
        description: 'Requires numbering.view.',
        parameters: [queryParameter('type', typeEnum)],
        responses: { '200': h.json('SequenceList', 'The formats'), ...h.authorizedErrors },
      },
      post: {
        operationId: 'createNumberSequence',
        summary: 'Define a draft number format',
        description:
          `${MANAGE} A draft numbers nothing until activated. A reset policy without a matching date ` +
          'component is refused (RESET_WITHOUT_DATE_COMPONENT): it would issue the same number every ' +
          'period. No official format is seeded — formats are SD-10.',
        requestBody: requestBody(h.ref('CreateSequenceRequest')),
        responses: { '201': h.json('Sequence', 'The draft'), ...h.conflictErrors },
      },
    },
    '/api/v1/numbering/sequences/{type}/versions/{version}': {
      patch: {
        operationId: 'updateNumberSequenceDraft',
        summary: 'Change a draft format',
        description: `${MANAGE} Only a draft changes (SEQUENCE_NOT_DRAFT otherwise).`,
        parameters: versionParameters,
        requestBody: requestBody(h.ref('UpdateSequenceDraftRequest')),
        responses: { '200': h.json('Sequence', 'The draft'), ...h.conflictErrors },
      },
    },
    '/api/v1/numbering/sequences/{type}/versions/{version}/activate': {
      post: {
        operationId: 'activateNumberSequence',
        summary: 'Make a draft the active format for its type',
        description:
          `${MANAGE} Retires the previous active format in the same transaction; exactly one format ` +
          'per type is active, enforced by a unique index. The series continues across formats.',
        parameters: versionParameters,
        requestBody: requestBody(h.ref('ActivateSequenceRequest')),
        responses: { '200': h.json('Sequence', 'The active format'), ...h.conflictErrors },
      },
    },
    '/api/v1/numbering/preview': {
      post: {
        operationId: 'previewNumber',
        summary: 'The number the next issue would receive',
        description:
          'Requires numbering.view. Reserves nothing. Refused while no format is active ' +
          '(NO_ACTIVE_SEQUENCE) or a fiscal-year format has no configured fiscal year ' +
          '(FISCAL_YEAR_NOT_CONFIGURED).',
        requestBody: requestBody(h.ref('PreviewNumberRequest')),
        responses: { '200': h.json('NumberPreview', 'The preview'), ...h.conflictErrors },
      },
    },
    '/api/v1/numbering/issued': {
      get: {
        operationId: 'listIssuedNumbers',
        summary: 'The ledger of issued and voided numbers, newest first',
        description:
          'Requires numbering.view. Numbers are issued only by the module creating the document, ' +
          'inside its transaction — there is no route that issues one.',
        parameters: [
          queryParameter('type', typeEnum),
          queryParameter('limit', { type: 'integer', minimum: 1, maximum: 100, default: 50 }),
          queryParameter('cursor', { type: 'string' }),
        ],
        responses: {
          '200': h.json('IssuedNumberPage', 'A page of the ledger'),
          ...h.authorizedErrors,
        },
      },
    },
  };
}
