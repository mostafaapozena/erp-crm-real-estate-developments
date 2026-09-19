import {
  ErrorResponseSchema,
  LivenessResponseSchema,
  ReadinessResponseSchema,
} from '@alola/contracts';
import { z } from 'zod';

/**
 * OpenAPI 3.1 document generated from the contracts package (PLAT-010). Component schemas come from
 * the same Zod definitions the API validates with, so documentation cannot drift from behavior.
 * OpenAPI 3.1 uses JSON Schema 2020-12, which is what `z.toJSONSchema` emits.
 */
const components = {
  ErrorResponse: ErrorResponseSchema,
  LivenessResponse: LivenessResponseSchema,
  ReadinessResponse: ReadinessResponseSchema,
} as const;

type ComponentName = keyof typeof components;

const ref = (name: ComponentName) => ({ $ref: `#/components/schemas/${name}` });
const json = (name: ComponentName, description: string) => ({
  description,
  content: { 'application/json': { schema: ref(name) } },
});

const standardErrors = {
  '429': json('ErrorResponse', 'Rate limited (RATE_LIMITED)'),
  '500': json('ErrorResponse', 'Unexpected error (INTERNAL_ERROR)'),
};

export function buildOpenApiDocument(): Record<string, unknown> {
  const schemas = Object.fromEntries(
    Object.entries(components).map(([name, schema]) => {
      const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema, { io: 'output' });
      return [name, jsonSchema];
    }),
  );

  return {
    openapi: '3.1.0',
    info: {
      title: 'ALOLA ERP API',
      version: '0.1.0',
      description:
        'Errors return stable machine codes; clients localize them. Every response carries an ' +
        'x-correlation-id header.',
    },
    paths: {
      '/health/live': {
        get: {
          operationId: 'getLiveness',
          summary: 'Process liveness',
          responses: { '200': json('LivenessResponse', 'The process is running') },
        },
      },
      '/health/ready': {
        get: {
          operationId: 'getReadiness',
          summary: 'Per-dependency readiness',
          responses: {
            '200': json('ReadinessResponse', 'All required dependencies are up'),
            '503': json('ReadinessResponse', 'At least one dependency is down or not configured'),
          },
        },
      },
      '/api/v1/openapi.json': {
        get: {
          operationId: 'getOpenApiDocument',
          summary: 'This document',
          responses: { '200': { description: 'OpenAPI 3.1 document' }, ...standardErrors },
        },
      },
    },
    components: { schemas },
  };
}
