import { z } from 'zod';
import { InstantSchema } from './time';

/**
 * Audit record contract (AUDIT-002).
 *
 * Every record carries: actor, action, target entity, before/after **summary**, reason, UTC timestamp,
 * session, IP, correlation ID, and a provider reference where applicable. Records are append-only
 * (AUDIT-001) and hold summaries rather than verbatim protected values (AUDIT-006).
 */

/** Namespaced action identifiers: `<domain>.<entity>.<event>`. Stable machine codes, never prose. */
export const AuditActionSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,3}$/, { message: 'AUDIT_ACTION_EXPECTED' });

/** Known actions recorded by the platform today. Extended per phase; the schema stays open. */
export const AUDIT_ACTIONS = {
  authenticationSucceeded: 'auth.session.succeeded',
  authenticationFailed: 'auth.session.failed',
  authenticationLoggedOut: 'auth.session.loggedOut',
  authorizationDenied: 'security.authorization.denied',
  roleCreated: 'security.role.created',
  grantUpdated: 'security.grant.updated',
  auditRead: 'audit.events.read',
  auditExported: 'audit.events.exported',
} as const;

export const AuditOutcomeSchema = z.enum(['succeeded', 'denied', 'failed']);
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;

export const AuditActorSchema = z.strictObject({
  kind: z.enum(['account', 'system', 'anonymous']),
  /** Opaque security-account reference; never an employee record (ADR-0019). */
  accountId: z.string().min(1).optional(),
  roleKeys: z.array(z.string()).optional(),
  sessionId: z.string().min(1).optional(),
});

export const AuditTargetSchema = z.strictObject({
  type: z.string().min(1).max(64),
  id: z.string().min(1).max(200).optional(),
});

/** One changed field. Values are summarized and redacted before they reach here (AUDIT-006). */
export const AuditChangeSchema = z.strictObject({
  path: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const AuditContextSchema = z.strictObject({
  correlationId: z.string().min(1),
  ip: z.string().max(64).optional(),
  userAgent: z.string().max(256).optional(),
  method: z.string().max(10).optional(),
  route: z.string().max(256).optional(),
});

export const AuditProviderSchema = z.strictObject({
  name: z.string().min(1).max(64),
  requestId: z.string().min(1).max(200).optional(),
});

export const AuditEventSchema = z.strictObject({
  eventId: z.string().min(1),
  occurredAt: InstantSchema,
  action: AuditActionSchema,
  outcome: AuditOutcomeSchema,
  actor: AuditActorSchema,
  target: AuditTargetSchema,
  /** Optional because field restrictions may remove it entirely (SEC-029). */
  changes: z.array(AuditChangeSchema).optional(),
  reason: z.string().max(500).optional(),
  context: AuditContextSchema.partial({ ip: true, userAgent: true }),
  provider: AuditProviderSchema.optional(),
  schemaVersion: z.literal(1),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

/** Input accepted by the audit service. The service supplies identity, time, and schema version. */
export const RecordAuditInputSchema = z.strictObject({
  action: AuditActionSchema,
  outcome: AuditOutcomeSchema,
  actor: AuditActorSchema,
  target: AuditTargetSchema,
  changes: z.array(AuditChangeSchema).max(200).optional(),
  reason: z.string().max(500).optional(),
  context: AuditContextSchema,
  provider: AuditProviderSchema.optional(),
});
export type RecordAuditInput = z.infer<typeof RecordAuditInputSchema>;

export const AUDIT_PAGE_SIZE_DEFAULT = 50;
export const AUDIT_PAGE_SIZE_MAX = 100;
export const AUDIT_EXPORT_MAX_ROWS = 5000;

/**
 * Deterministic keyset pagination: ordering is `occurredAt desc, eventId desc`, and the cursor carries
 * the last row's position. Offset pagination would repeat or skip rows as new events arrive.
 */
export const AuditQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_SIZE_MAX).default(AUDIT_PAGE_SIZE_DEFAULT),
  cursor: z.string().min(1).max(200).optional(),
  action: AuditActionSchema.optional(),
  actorAccountId: z.string().min(1).max(200).optional(),
  targetType: z.string().min(1).max(64).optional(),
  targetId: z.string().min(1).max(200).optional(),
  outcome: AuditOutcomeSchema.optional(),
  occurredFrom: InstantSchema.optional(),
  occurredTo: InstantSchema.optional(),
  correlationId: z.string().min(1).max(200).optional(),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;

export const AuditPageSchema = z.strictObject({
  items: z.array(AuditEventSchema),
  /** Total matching records **within the actor's scope** (SEC-028). */
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  nextCursor: z.string().optional(),
});
export type AuditPage = z.infer<typeof AuditPageSchema>;
