import { DiagnosticsSchema } from '@alola/contracts';
import type { OpenApiHelpers, PathMap } from './shared';

/** Schemas operational readiness contributes (OPS-006). */
export const operationsComponents = {
  Diagnostics: DiagnosticsSchema,
} as const;

export function operationsPaths(h: OpenApiHelpers): PathMap {
  return {
    '/api/v1/operations/diagnostics': {
      get: {
        operationId: 'getDiagnostics',
        summary: 'Build, schema version, scheduled sweeps, worker and integrations — redacted',
        description:
          'Requires the administrative operations.diagnostics. Configuration is reported as set or ' +
          'not set, never as a value; sweep failures as a stable code, never a message.',
        responses: { '200': h.json('Diagnostics', 'The diagnostics'), ...h.authorizedErrors },
      },
    },
  };
}
