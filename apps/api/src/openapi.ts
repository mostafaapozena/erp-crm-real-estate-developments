import {
  AccountGrantSchema,
  AccountListResponseSchema,
  ActivateAccountRequestSchema,
  AuditEventSchema,
  AuditPageSchema,
  ChangePasswordRequestSchema,
  CompletePasswordResetRequestSchema,
  ConfirmMfaRequestSchema,
  CreateAccountRequestSchema,
  CreateAccountResponseSchema,
  CreateRoleRequestSchema,
  DisableMfaRequestSchema,
  EnrolMfaResponseSchema,
  ErrorResponseSchema,
  LivenessResponseSchema,
  LoginRequestSchema,
  LoginResultSchema,
  ReadinessResponseSchema,
  RequestPasswordResetRequestSchema,
  RevokedSessionsResponseSchema,
  RoleListResponseSchema,
  RoleSchema,
  SecurityAccountSchema,
  SessionListResponseSchema,
  SetAccountGrantRequestSchema,
  SuspendAccountRequestSchema,
  OffboardAccountRequestSchema,
  VerifyMfaRequestSchema,
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
  SecurityAccount: SecurityAccountSchema,
  AccountList: AccountListResponseSchema,
  CreateAccountRequest: CreateAccountRequestSchema,
  CreateAccountResponse: CreateAccountResponseSchema,
  ActivateAccountRequest: ActivateAccountRequestSchema,
  LoginRequest: LoginRequestSchema,
  LoginResult: LoginResultSchema,
  VerifyMfaRequest: VerifyMfaRequestSchema,
  ConfirmMfaRequest: ConfirmMfaRequestSchema,
  EnrolMfaResponse: EnrolMfaResponseSchema,
  DisableMfaRequest: DisableMfaRequestSchema,
  ChangePasswordRequest: ChangePasswordRequestSchema,
  RequestPasswordResetRequest: RequestPasswordResetRequestSchema,
  CompletePasswordResetRequest: CompletePasswordResetRequestSchema,
  SessionList: SessionListResponseSchema,
  RevokedSessions: RevokedSessionsResponseSchema,
  SuspendAccountRequest: SuspendAccountRequestSchema,
  OffboardAccountRequest: OffboardAccountRequestSchema,
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

const sessionIdParameter = {
  name: 'sessionId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description:
    'A session belonging to the account. Another account\u2019s session is reported as absent.',
};

/** Shared by the unauthenticated authentication routes: no permission, but every other failure applies. */
const publicAuthErrors = {
  '400': json('ErrorResponse', 'Invalid input (VALIDATION_FAILED); unknown fields are rejected'),
  '401': json(
    'ErrorResponse',
    'Authentication failed (UNAUTHENTICATED). Identical for an unknown identifier, a wrong password, and an account that is not active, so the answer cannot be used to discover accounts',
  ),
  ...standardErrors,
};

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
      '/api/v1/auth/login': {
        post: {
          operationId: 'login',
          summary: 'Sign in with a login identifier and password',
          description:
            'Argon2id password verification (SEC-013). Answers either an authenticated session or a ' +
            'second-factor challenge (SEC-017), which is why the 200 body is a discriminated union: the ' +
            'request succeeded either way. The refresh token is set as a Secure HttpOnly SameSite=Strict ' +
            'cookie scoped to /api/v1/auth and never appears in a response body (SEC-014). Throttled per ' +
            'address and per identifier (SEC-003); a throttled answer carries Retry-After.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('LoginRequest') } },
          },
          responses: {
            '200': json('LoginResult', 'An authenticated session, or a second-factor challenge'),
            ...publicAuthErrors,
          },
        },
      },
      '/api/v1/auth/activate': {
        post: {
          operationId: 'activateAccount',
          summary: 'Activate an invited account by setting its first password',
          description:
            'Completes an invitation (SEC-012). The token is single-use and expires. The password must ' +
            'satisfy the policy; it is never trimmed or normalized (ADR-0023).',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('ActivateAccountRequest') } },
          },
          responses: {
            '200': json('SecurityAccount', 'The activated account'),
            ...publicAuthErrors,
          },
        },
      },
      '/api/v1/auth/refresh': {
        post: {
          operationId: 'refreshSession',
          summary: 'Rotate the refresh token and issue a new access token',
          description:
            'Reads the refresh cookie, rotates it, and returns a new access token (SEC-014). Presenting a ' +
            'token that was already rotated revokes the entire session family (SEC-015).',
          responses: {
            '200': json('LoginResult', 'A new access token; a new refresh cookie is set'),
            ...publicAuthErrors,
          },
        },
      },
      '/api/v1/auth/logout': {
        post: {
          operationId: 'logout',
          summary: 'End the current session',
          description: 'Revokes the session server-side and clears the refresh cookie (SEC-013).',
          responses: { '204': { description: 'Signed out' }, ...authorizedErrors },
        },
      },
      '/api/v1/auth/mfa/verify': {
        post: {
          operationId: 'verifyMfaChallenge',
          summary: 'Complete a sign-in with a second factor',
          description:
            'Accepts a TOTP code or a recovery code (SEC-017). A code already used within its time step ' +
            'is refused, and a recovery code works exactly once. Throttled per account.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('VerifyMfaRequest') } },
          },
          responses: {
            '200': json('LoginResult', 'An authenticated session'),
            ...publicAuthErrors,
          },
        },
      },
      '/api/v1/auth/mfa/enrol': {
        post: {
          operationId: 'startMfaEnrolment',
          summary: 'Begin second-factor enrolment',
          description:
            'Returns the shared secret, its otpauth URI, and the recovery codes **once** (SEC-017). The ' +
            'secret is stored encrypted and is not active until a code from it is confirmed. Usable with a ' +
            'login challenge token when a privileged account must enrol before signing in, or from a live ' +
            'session for voluntary enrolment.',
          responses: {
            '200': json('EnrolMfaResponse', 'Enrolment material, shown once'),
            '409': json('ErrorResponse', 'A second factor is already enabled (CONFLICT)'),
            ...publicAuthErrors,
          },
        },
      },
      '/api/v1/auth/mfa/confirm': {
        post: {
          operationId: 'confirmMfaEnrolment',
          summary: 'Confirm second-factor enrolment with a live code',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('ConfirmMfaRequest') } },
          },
          responses: {
            '201': json('LoginResult', 'Enrolled during sign-in: an authenticated session'),
            '204': { description: 'Enrolled from an existing session' },
            ...publicAuthErrors,
          },
        },
      },
      '/api/v1/auth/password/reset-request': {
        post: {
          operationId: 'requestPasswordReset',
          summary: 'Ask for a password-reset token',
          description:
            'Always answers 202 with the same body, whether or not the identifier exists (SEC-016), and ' +
            'never returns the token: delivery belongs to CORE-NOTIFY. An administrator can issue one ' +
            'meanwhile through POST /api/v1/security/accounts/{accountId}/password-reset.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('RequestPasswordResetRequest') } },
          },
          responses: {
            '202': { description: 'Accepted, whether or not the account exists' },
            ...standardErrors,
          },
        },
      },
      '/api/v1/auth/password/reset': {
        post: {
          operationId: 'completePasswordReset',
          summary: 'Set a new password with a reset token',
          description:
            'Single-use token. Every session of the account is revoked (SEC-020) and the credential ' +
            'generation is incremented, so access tokens already issued stop working at once.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('CompletePasswordResetRequest') } },
          },
          responses: { '204': { description: 'Password set' }, ...publicAuthErrors },
        },
      },
      '/api/v1/me': {
        get: {
          operationId: 'getCurrentAccount',
          summary: 'The signed-in account, its permissions, and its data scope',
          responses: {
            '200': json('SecurityAccount', 'Wrapped with the effective permissions and scope'),
            ...authorizedErrors,
          },
        },
      },
      '/api/v1/me/password': {
        post: {
          operationId: 'changeOwnPassword',
          summary: 'Change your own password',
          description:
            'Requires the current password; a wrong one answers REAUTHENTICATION_REQUIRED. Every session ' +
            'ends, including the one that made the change (SEC-020).',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('ChangePasswordRequest') } },
          },
          responses: {
            '204': { description: 'Password changed; all sessions revoked' },
            ...authorizedErrors,
          },
        },
      },
      '/api/v1/me/sessions': {
        get: {
          operationId: 'listOwnSessions',
          summary: 'Your live sessions and devices',
          description:
            'No permission needed: these are your own sessions (SEC-018). Carries a coarse client ' +
            'summary rather than the raw user agent, and never a token or a digest.',
          responses: { '200': json('SessionList', 'Live sessions'), ...authorizedErrors },
        },
      },
      '/api/v1/me/sessions/{sessionId}': {
        delete: {
          operationId: 'revokeOwnSession',
          summary: 'Revoke one of your sessions',
          description:
            'Ownership is part of the query, so another account\u2019s session is reported as absent ' +
            'rather than forbidden (SEC-030).',
          parameters: [sessionIdParameter],
          responses: {
            '204': { description: 'Session revoked' },
            '404': json('ErrorResponse', 'Absent, or not yours (NOT_FOUND)'),
            ...authorizedErrors,
          },
        },
      },
      '/api/v1/me/sessions/revoke-others': {
        post: {
          operationId: 'revokeOtherOwnSessions',
          summary: 'Revoke every session except the current one',
          responses: { '200': json('RevokedSessions', 'How many ended'), ...authorizedErrors },
        },
      },
      '/api/v1/me/mfa/disable': {
        post: {
          operationId: 'disableOwnMfa',
          summary: 'Turn off your second factor',
          description:
            'Requires the password again (SEC-017): turning off a factor is exactly when ' +
            're-authentication matters. Every session ends.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('DisableMfaRequest') } },
          },
          responses: {
            '204': { description: 'Disabled; all sessions revoked' },
            ...authorizedErrors,
          },
        },
      },
      '/api/v1/security/accounts': {
        get: {
          operationId: 'listAccounts',
          summary: 'List security accounts',
          description:
            'Requires security.account.view. Accounts carry no employee data (ADR-0019).',
          parameters: [
            {
              name: 'state',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['invited', 'active', 'suspended', 'terminated'] },
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            },
          ],
          responses: { '200': json('AccountList', 'Accounts'), ...authorizedErrors },
        },
        post: {
          operationId: 'createAccount',
          summary: 'Invite a security account',
          description:
            'Requires security.account.create. Creates an account in the invited state with **no ' +
            'password** and returns its activation token once (SEC-011, SEC-012). There is no public ' +
            'self-registration. The caller attests that the account belongs to one named person (SEC-022), ' +
            'which is recorded in the audit trail.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('CreateAccountRequest') } },
          },
          responses: {
            '201': json('CreateAccountResponse', 'The invited account and its activation token'),
            '409': json(
              'ErrorResponse',
              'The login identifier is taken, or the employee already has a live account (CONFLICT)',
            ),
            ...authorizedErrors,
          },
        },
      },
      '/api/v1/security/accounts/{accountId}': {
        get: {
          operationId: 'getAccount',
          summary: 'Read one security account',
          description: 'Requires security.account.view.',
          parameters: [accountIdParameter],
          responses: {
            '200': json('SecurityAccount', 'The account'),
            '404': json('ErrorResponse', 'No such account (NOT_FOUND)'),
            ...authorizedErrors,
          },
        },
      },
      '/api/v1/security/accounts/{accountId}/suspend': {
        post: {
          operationId: 'suspendAccount',
          summary: 'Suspend an account',
          description:
            'Requires security.account.suspend. Revokes every session immediately, because a suspended ' +
            'account with a live session is not suspended (SEC-019, SEC-020). Nothing is deleted ' +
            '(ADR-0009). Refused on the caller\u2019s own account.',
          parameters: [accountIdParameter],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('SuspendAccountRequest') } },
          },
          responses: {
            '200': json('SecurityAccount', 'The suspended account'),
            '409': json('ErrorResponse', 'Not a permitted transition (CONFLICT)'),
            ...authorizedErrors,
          },
        },
      },
      '/api/v1/security/accounts/{accountId}/reactivate': {
        post: {
          operationId: 'reactivateAccount',
          summary: 'Return a suspended account to active',
          description:
            'Requires security.account.reactivate. A terminated account is never revived.',
          parameters: [accountIdParameter],
          responses: {
            '200': json('SecurityAccount', 'The reactivated account'),
            '409': json('ErrorResponse', 'Not a permitted transition (CONFLICT)'),
            ...authorizedErrors,
          },
        },
      },
      '/api/v1/security/accounts/{accountId}/offboard': {
        post: {
          operationId: 'offboardAccount',
          summary: 'Offboard an account as one audited action',
          description:
            'Requires security.account.offboard. Terminates the account, revokes every session, and ' +
            'invalidates outstanding activation and reset tokens (SEC-021). It does **not** touch the ' +
            'employee record, and it does **not** reassign tasks, approvals, or customers: those are ' +
            'CORE-TASK-005, APPROVAL-007, and Phase 3 CRM-OWNER. The caller acknowledges that explicitly.',
          parameters: [accountIdParameter],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('OffboardAccountRequest') } },
          },
          responses: {
            '200': json('SecurityAccount', 'The terminated account'),
            ...authorizedErrors,
          },
        },
      },
      '/api/v1/security/accounts/{accountId}/password-reset': {
        post: {
          operationId: 'issueAccountPasswordReset',
          summary: 'Issue a password-reset token for an account',
          description:
            'Requires security.account.resetPassword. Returns a single-use token for the administrator to ' +
            'deliver out of band until CORE-NOTIFY exists. It sets no password and reveals none. Refused ' +
            'on the caller\u2019s own account, where the self-service route asks for the current password.',
          parameters: [accountIdParameter],
          responses: {
            '201': { description: 'A single-use reset token and its expiry' },
            ...authorizedErrors,
          },
        },
      },
      '/api/v1/security/accounts/{accountId}/mfa/reset': {
        post: {
          operationId: 'resetAccountMfa',
          summary: 'Clear an account\u2019s second factor',
          description:
            'Requires security.account.resetMfa — a separate administrative permission, because it is the ' +
            'obvious way around someone else\u2019s second factor. Every session ends, and the use is ' +
            'audited. Refused on the caller\u2019s own account.',
          parameters: [accountIdParameter],
          responses: {
            '204': { description: 'Cleared; all sessions revoked' },
            ...authorizedErrors,
          },
        },
      },
      '/api/v1/security/accounts/{accountId}/sessions': {
        get: {
          operationId: 'listAccountSessions',
          summary: 'List another account\u2019s live sessions',
          description: 'Requires security.session.viewAny.',
          parameters: [accountIdParameter],
          responses: { '200': json('SessionList', 'Live sessions'), ...authorizedErrors },
        },
      },
      '/api/v1/security/accounts/{accountId}/sessions/{sessionId}': {
        delete: {
          operationId: 'revokeAccountSession',
          summary: 'Revoke one session of another account',
          description: 'Requires security.session.revokeAny.',
          parameters: [accountIdParameter, sessionIdParameter],
          responses: {
            '204': { description: 'Session revoked' },
            '404': json('ErrorResponse', 'Absent, or not that account\u2019s (NOT_FOUND)'),
            ...authorizedErrors,
          },
        },
      },
      '/api/v1/security/accounts/{accountId}/sessions/revoke-all': {
        post: {
          operationId: 'revokeAllAccountSessions',
          summary: 'Revoke every session of an account',
          description: 'Requires security.session.revokeAny.',
          parameters: [accountIdParameter],
          responses: { '200': json('RevokedSessions', 'How many ended'), ...authorizedErrors },
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
