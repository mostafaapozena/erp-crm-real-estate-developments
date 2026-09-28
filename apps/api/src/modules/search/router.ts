import { SearchQuerySchema } from '@alola/contracts';
import { Router } from 'express';
import { requireAuthenticated, type GuardOptions } from '../../http/actor';
import { requireActor } from '../../http/request-context';
import { validate, validated } from '../../http/validate';
import type { SearchService } from './service';

/**
 * Global search HTTP surface (CORE-SEARCH-001).
 *
 * A session is enough to call it: which kinds of record are searched follows from the caller's read
 * permissions, and every provider applies the caller's data scope inside its own query.
 */
export interface SearchRouterOptions {
  getService: () => SearchService;
  guard?: GuardOptions;
}

export function searchRouter(options: SearchRouterOptions): Router {
  const router = Router();
  router.get(
    '/',
    requireAuthenticated(options.guard),
    validate({ query: SearchQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof SearchQuerySchema._output>(res, 'query');
      res.json(await options.getService().search(requireActor(res), query));
    },
  );
  return router;
}
