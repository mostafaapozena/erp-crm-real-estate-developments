import { SEARCH_LIMIT_PER_TYPE, SEARCH_TYPES, SearchResultSchema } from '@alola/contracts';
import { queryParameter, type OpenApiHelpers, type PathMap } from './shared';

/** Schemas global search contributes (CORE-SEARCH-001). */
export const searchComponents = {
  SearchResult: SearchResultSchema,
} as const;

export function searchPaths(h: OpenApiHelpers): PathMap {
  return {
    '/api/v1/search': {
      get: {
        operationId: 'globalSearch',
        summary: 'Find records by name, code, number or phone',
        description:
          'Requires only authentication. Each kind of record is searched only when the caller holds its ' +
          'read permission, by the owning module, with the caller’s data scope inside that ' +
          'module’s query. Only unrestricted identifying fields are matched, and a hit carries a ' +
          `label, never a restricted field. At most ${String(SEARCH_LIMIT_PER_TYPE)} hits per kind; ` +
          'the term is treated as literal text.',
        parameters: [
          queryParameter('q', { type: 'string', minLength: 2, maxLength: 100 }),
          queryParameter(
            'types',
            { type: 'string' },
            `Comma-separated subset of: ${SEARCH_TYPES.join(', ')}`,
          ),
        ],
        responses: {
          '200': h.json('SearchResult', 'Hits, grouped by kind'),
          ...h.authorizedErrors,
        },
      },
    },
  };
}
