/**
 * Shared OpenAPI building blocks.
 *
 * The document is assembled from one file per domain so that adding a module does not mean editing a
 * three-thousand-line file. Every domain file receives these helpers rather than importing the
 * document builder, which keeps the dependency one-way and cycle-free.
 *
 * `ref` throws on an unknown component name. That is deliberate: a `$ref` pointing at a schema that was
 * never registered produces a document that looks fine until a client tries to generate from it, and
 * the failure would otherwise surface far from its cause. `apps/api/src/app.test.ts` additionally walks
 * the finished document and asserts every reference resolves.
 */
export type SchemaRef = { $ref: string };

export type ResponseBody = {
  description: string;
  content: { 'application/json': { schema: SchemaRef } };
};

export interface OpenApiHelpers {
  ref(name: string): SchemaRef;
  json(name: string, description: string): ResponseBody;
  /** 429 and 500 — applicable to every endpoint. */
  standardErrors: Record<string, ResponseBody>;
  /** The full set for an endpoint behind a permission guard: 400, 401, 403, 429, 500. */
  authorizedErrors: Record<string, ResponseBody>;
  /** Adds a 404 whose body is identical to an out-of-scope answer (SEC-030). */
  notFoundErrors: Record<string, ResponseBody>;
  /** Adds a 409, for idempotency conflicts and refused state transitions. */
  conflictErrors: Record<string, ResponseBody>;
}

export function createHelpers(componentNames: ReadonlySet<string>): OpenApiHelpers {
  const ref = (name: string): SchemaRef => {
    if (!componentNames.has(name)) {
      throw new Error(
        `OpenAPI component "${name}" is referenced but not registered. Add its Zod schema to the ` +
          'domain file’s component map.',
      );
    }
    return { $ref: `#/components/schemas/${name}` };
  };
  const json = (name: string, description: string): ResponseBody => ({
    description,
    content: { 'application/json': { schema: ref(name) } },
  });
  const standardErrors = {
    '429': json('ErrorResponse', 'Rate limited (RATE_LIMITED)'),
    '500': json('ErrorResponse', 'Unexpected error (INTERNAL_ERROR)'),
  };
  const authorizedErrors = {
    '400': json('ErrorResponse', 'Invalid input (VALIDATION_FAILED); unknown fields are rejected'),
    '401': json('ErrorResponse', 'No authenticated actor (UNAUTHENTICATED)'),
    '403': json(
      'ErrorResponse',
      'Permission denied (FORBIDDEN). The response never names the missing permission',
    ),
    ...standardErrors,
  };
  const notFoundErrors = {
    ...authorizedErrors,
    '404': json(
      'ErrorResponse',
      'Absent, or outside the actor’s data scope — the two answers are identical (SEC-030)',
    ),
  };
  const conflictErrors = {
    ...notFoundErrors,
    '409': json(
      'ErrorResponse',
      'Refused state transition, duplicate, or idempotency conflict (CONFLICT). Nothing stored changed',
    ),
  };
  return { ref, json, standardErrors, authorizedErrors, notFoundErrors, conflictErrors };
}

/** A path item is a plain object; each domain file returns a map of path → item. */
export type PathMap = Record<string, Record<string, unknown>>;

/** Reusable parameter builders, so a path parameter is described the same way everywhere. */
export function pathParameter(name: string, description: string): Record<string, unknown> {
  return { name, in: 'path', required: true, schema: { type: 'string' }, description };
}

export function queryParameter(
  name: string,
  schema: Record<string, unknown>,
  description?: string,
): Record<string, unknown> {
  return {
    name,
    in: 'query',
    required: false,
    schema,
    ...(description ? { description } : {}),
  };
}

export function requestBody(ref: SchemaRef): Record<string, unknown> {
  return { required: true, content: { 'application/json': { schema: ref } } };
}
