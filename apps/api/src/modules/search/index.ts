/**
 * Global search published interface (CORE-SEARCH-001). Providers are wired at the composition root to
 * each owning module's scoped search; this module holds no data.
 */
export { SearchService, escapeSearchTerm, prefixMatch } from './service';
export type { SearchProvider, SearchServiceOptions } from './service';
export { searchRouter } from './router';
export type { SearchRouterOptions } from './router';
