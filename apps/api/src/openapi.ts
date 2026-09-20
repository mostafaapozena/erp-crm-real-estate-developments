import {
  AccountGrantSchema,
  AuditEventSchema,
  AuditPageSchema,
  CreateRoleRequestSchema,
  ErrorResponseSchema,
  LivenessResponseSchema,
  ReadinessResponseSchema,
  RoleListResponseSchema,
  RoleSchema,
  SetAccountGrantRequestSchema,
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
  AuditEvent: AuditEventSchema,
  AuditPage: AuditPageSchema,
  Role: RoleSchema,
  RoleList: RoleListResponseSchema,
  CreateRoleRequest: CreateRoleRequestSchema,
  AccountGrant: AccountGrantSchema,
  SetAccountGrantRequest: SetAccountGrantRequestSchema,
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

/** Responses shared by every authorized endpoint (SEC-025, SEC-030). */
const authorizedErrors = {
  '400': json('ErrorResponse', 'Invalid input (VALIDATION_FAILED); unknown fields are rejected'),
  '401': json('ErrorResponse', 'No authenticated actor (UNAUTHENTICATED)'),
  '403': json(
    'ErrorResponse',
    'Permission denied (FORBIDDEN). The response never names the missing permission',
  ),
  ...standardErrors,
};

/** Query parameters of the audit list and export endpoints (deterministic keyset pagination). */
const auditQueryParameters = [
  {
    name: 'limit',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    description: 'Page size. Values above the maximum are rejected.',
  },
  {
    name: 'cursor',
    in: 'query',
    required: false,
    schema: { type: 'string' },
    description:
      'Keyset cursor from a previous response. Ordering is occurredAt desc, eventId desc, so pages never repeat or skip rows.',
  },
  { name: 'action', in: 'query', required: false, schema: { type: 'string' } },
  { name: 'actorAccountId', in: 'query', required: false, schema: { type: 'string' } },
  { name: 'targetType', in: 'query', required: false, schema: { type: 'string' } },
  { name: 'targetId', in: 'query', required: false, schema: { type: 'string' } },
  {
    name: 'outcome',
    in: 'query',
    required: false,
    schema: { type: 'string', enum: ['succeeded', 'denied', 'failed'] },
  },
  { name: 'occurredFrom', in: 'query', required: false, schema: { type: 'string' } },
  { name: 'occurredTo', in: 'query', required: false, schema: { type: 'string' } },
  { name: 'correlationId', in: 'query', required: false, schema: { type: 'string' } },
];

const accountIdParameter = {
  name: 'accountId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: 'Opaque security-account reference. Never an employee record (ADR-0019).',
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
      '/api/v1/audit/events': {
        get: {
          operationId: 'listAuditEvents',
          summary: 'Query audit events',
          description:
            'Requires the audit.view permission. Results, the total, and every export are constrained by ' +
            "the actor's data scope inside the query (SEC-028). Fields the actor may not see are absent, " +
            'not null (SEC-029). The read itself is audited as a sensitive read (AUDIT-004).',
          parameters: auditQueryParameters,
          responses: { '200': json('AuditPage', 'A page of audit events'), ...authorizedErrors },
        },
      },
      '/api/v1/audit/events/export': {
        get: {
          operationId: 'exportAuditEvents',
          summary: 'Export audit events as newline-delimited JSON',
          description:
            'Requires the audit.export permission. Uses the same scope filter and field stripping as the ' +
            'list endpoint, is bounded to 5000 rows, and records an export audit event before any row is ' +
            'returned (AUDIT-004).',
          parameters: auditQueryParameters,
          responses: {
            '200': {
              description: 'Newline-delimited audit events',
              headers: {
                'X-Export-Truncated': {
                  schema: { type: 'string' },
                  description: 'true when the row bound was reached',
                },
              },
              content: { 'application/x-ndjson': { schema: { type: 'string' } } },
            },
            ...authorizedErrors,
          },
        },
      },
      '/api/v1/audit/events/{eventId}': {
        get: {
          operationId: 'getAuditEvent',
          summary: 'Read one audit event',
          description:
            "Requires the audit.view permission. An event outside the actor's scope returns 404, not 403 " +
            '(SEC-030). There is deliberately no endpoint that updates or deletes an audit event (AUDIT-001).',
          parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': json('AuditEvent', 'The audit event'),
            '404': json('ErrorResponse', 'Absent, or outside the scope (NOT_FOUND)'),
            ...authorizedErrors,
          },
        },
      },
      '/api/v1/security/roles': {
        get: {
          operationId: 'listRoles',
          summary: 'List roles',
          description: 'Requires security.role.view. Roles are named permission bundles (SEC-024).',
          responses: { '200': json('RoleList', 'All roles'), ...authorizedErrors },
        },
        post: {
          operationId: 'createRole',
          summary: 'Create a role',
          description:
            'Requires security.role.create. An actor cannot create a role carrying permissions it does ' +
            'not hold unless it also holds security.grant.assignAny (SEC-031). Both the creation and a ' +
            'refused attempt are audited (AUDIT-005).',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('CreateRoleRequest') } },
          },
          responses: {
            '201': json('Role', 'The created role'),
            '409': json('ErrorResponse', 'Role key already exists (CONFLICT)'),
            ...authorizedErrors,
          },
        },
      },
      '/api/v1/security/accounts/{accountId}/grants': {
        get: {
          operationId: 'getAccountGrant',
          summary: "Read an account's roles and data scope",
          description:
            'Requires security.grant.view. The explicit denial list is included only for an actor that ' +
            'also holds security.grant.assign; otherwise the field is absent (SEC-029).',
          parameters: [accountIdParameter],
          responses: {
            '200': json('AccountGrant', 'The account grant'),
            '404': json('ErrorResponse', 'No grant for this account (NOT_FOUND)'),
            ...authorizedErrors,
          },
        },
        put: {
          operationId: 'setAccountGrant',
          summary: "Replace an account's roles, denials, and data scope",
          description:
            'Requires security.grant.assign. Refused when the actor targets its own account, grants ' +
            'permissions it does not hold, or widens the scope beyond its own — unless it holds ' +
            'security.grant.assignAny (SEC-031). Takes effect on the next request with no cache to ' +
            'invalidate (SEC-032). Audited with a redacted before/after summary, and a refused attempt is ' +
            'recorded as a security event (AUDIT-005, AUDIT-006).',
          parameters: [accountIdParameter],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('SetAccountGrantRequest') } },
          },
          responses: {
            '200': json('AccountGrant', 'The updated grant'),
            ...authorizedErrors,
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
