import {
  SEARCH_LIMIT_PER_TYPE,
  SEARCH_TYPES,
  type ActorContext,
  type Permission,
  type SearchHit,
  type SearchResult,
  type SearchType,
} from '@alola/contracts';
import { can } from '@alola/security';
import type { Logger } from 'pino';
import { invalid } from '../../platform/audit-port';

/**
 * Global search (CORE-SEARCH-001).
 *
 * The service owns no data. Each searchable type is a **provider** wired at the composition root to
 * the owning module's scoped search, so the permission check, the data scope and the field
 * restrictions are the owning module's own — applied inside its query — and this service only
 * decides which providers the actor may ask and merges what they answer.
 */
export interface SearchProvider {
  type: SearchType;
  /** The read permission for this type. A provider the actor lacks it for is never called. */
  permission?: Permission;
  /**
   * Search as the actor sees the records: scope inside the query, restricted fields neither matched
   * nor returned. `term` is plain text; the provider escapes it.
   */
  search(actor: ActorContext, term: string, limit: number): Promise<SearchHit[]>;
}

export interface SearchServiceOptions {
  providers: readonly SearchProvider[];
  logger?: Logger;
}

export class SearchService {
  constructor(private readonly options: SearchServiceOptions) {}

  async search(
    actor: ActorContext,
    query: { q: string; types?: string | undefined },
  ): Promise<SearchResult> {
    const requested = query.types ? query.types.split(',') : [...SEARCH_TYPES];
    const unknown = requested.filter((type) => !(SEARCH_TYPES as readonly string[]).includes(type));
    if (unknown.length > 0) throw invalid('SEARCH_TYPES_INVALID', ['query', 'types']);

    const allowed = this.options.providers.filter(
      (provider) =>
        requested.includes(provider.type) &&
        (provider.permission === undefined || can(actor, provider.permission)),
    );
    // Every provider is asked; one failing provider never hides the others' answers, and is logged.
    const answers = await Promise.all(
      allowed.map(async (provider) => {
        try {
          return await provider.search(actor, query.q, SEARCH_LIMIT_PER_TYPE);
        } catch (error) {
          this.options.logger?.warn(
            { err: error, searchType: provider.type },
            'search provider failed; its results are omitted',
          );
          return [];
        }
      }),
    );
    return {
      items: answers.flatMap((hits) => hits.slice(0, SEARCH_LIMIT_PER_TYPE)),
      searched: allowed.map((provider) => provider.type),
    };
  }
}

/** Escape a user's term for use inside a regular expression. Never pass raw input to `$regex`. */
export function escapeSearchTerm(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A case-insensitive prefix condition on one field, from an escaped term. */
export function prefixMatch(field: string, term: string): Record<string, unknown> {
  return { [field]: { $regex: `^${escapeSearchTerm(term)}`, $options: 'i' } };
}
