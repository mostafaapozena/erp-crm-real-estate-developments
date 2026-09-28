import { Router } from 'express';
import { requirePermission, type GuardOptions } from '../../http/actor';
import type { OperationsService } from './service';

/**
 * `GET /api/v1/operations/diagnostics` — administrative `operations.diagnostics` (OPS-006). Build,
 * schema version, scheduled sweeps, worker heartbeat, integration states and which configuration
 * variables are set. Never a value, a connection string or a secret.
 */
export interface OperationsRouterOptions {
  getService: () => OperationsService;
  guard?: GuardOptions;
}

export function operationsRouter(options: OperationsRouterOptions): Router {
  const router = Router();
  router.get(
    '/diagnostics',
    requirePermission('operations.diagnostics', options.guard),
    async (_req, res) => {
      res.json(await options.getService().diagnostics());
    },
  );
  return router;
}
