import {
  AUDIT_ACTIONS,
  AUDIT_EXPORT_MAX_ROWS,
  AuditEventSchema,
  RecordAuditInputSchema,
  type ActorContext,
  type AuditEvent,
  type AuditPage,
  type AuditQuery,
  type RecordAuditInput,
} from '@alola/contracts';
import {
  assertSafeFilter,
  buildScopeFilter,
  restrictDocuments,
  withScope,
  type Logger,
  type ScopeFieldMap,
} from '@alola/security';
import { randomUUID } from 'node:crypto';
import type { Connection } from 'mongoose';
import { auditModel, type AuditEventDocument } from './model';

/**
 * Audit service (AUDIT-001 … AUDIT-006).
 *
 * Writes are append-only and never silently dropped; reads are permission-checked by the router and
 * scope-checked here, in the query (SEC-027, SEC-028).
 */

/**
 * Scope mapping for audit records (SEC-026). An audit event has no organization placement of its own, so
 * `self` and `assigned` both mean "events this account caused". Wider levels have no field to resolve
 * against, so they fail closed to "nothing" unless the actor's level is `all` — deliberately strict:
 * seeing other accounts' audit trail is an `all`-scope decision, which is itself audited.
 */
export const AUDIT_SCOPE_FIELDS: ScopeFieldMap = {
  owner: 'actor.accountId',
  assignee: 'actor.accountId',
};

export interface AuditServiceOptions {
  connection: Connection;
  logger: Logger;
  /**
   * Called after every successful append. The API uses it to count audit writes per request, which is how
   * "every mutation is audited" becomes an enforced invariant rather than a convention (AUDIT-003).
   */
  onRecorded?: () => void;
}

export class AuditWriteError extends Error {
  constructor(cause: unknown) {
    super('Audit record could not be written.');
    this.name = 'AuditWriteError';
    this.cause = cause;
  }
}

function encodeCursor(occurredAt: Date, eventId: string): string {
  return Buffer.from(`${occurredAt.toISOString()}|${eventId}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { occurredAt: Date; eventId: string } | undefined {
  try {
    const [iso, eventId] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!iso || !eventId) return undefined;
    const occurredAt = new Date(iso);
    if (Number.isNaN(occurredAt.getTime())) return undefined;
    return { occurredAt, eventId };
  } catch {
    return undefined;
  }
}

function toContract(document: AuditEventDocument): AuditEvent {
  return AuditEventSchema.parse({
    eventId: document.eventId,
    occurredAt: document.occurredAt.toISOString(),
    action: document.action,
    outcome: document.outcome,
    actor: {
      kind: document.actor.kind,
      ...(document.actor.accountId ? { accountId: document.actor.accountId } : {}),
      ...(document.actor.roleKeys ? { roleKeys: document.actor.roleKeys } : {}),
      ...(document.actor.sessionId ? { sessionId: document.actor.sessionId } : {}),
    },
    target: {
      type: document.target.type,
      ...(document.target.id ? { id: document.target.id } : {}),
    },
    ...(document.changes ? { changes: document.changes } : {}),
    ...(document.reason ? { reason: document.reason } : {}),
    context: {
      correlationId: document.context.correlationId,
      ...(document.context.ip ? { ip: document.context.ip } : {}),
      ...(document.context.userAgent ? { userAgent: document.context.userAgent } : {}),
      ...(document.context.method ? { method: document.context.method } : {}),
      ...(document.context.route ? { route: document.context.route } : {}),
    },
    ...(document.provider ? { provider: document.provider } : {}),
    schemaVersion: 1,
  });
}

export class AuditService {
  private readonly model;
  private readonly logger;
  private readonly onRecorded;

  constructor(options: AuditServiceOptions) {
    this.model = auditModel(options.connection);
    this.logger = options.logger;
    this.onRecorded = options.onRecorded;
  }

  /**
   * Append one record (AUDIT-002). Security-critical evidence must not vanish quietly: a write failure is
   * logged at error level **and rethrown**, so the caller's operation fails rather than completing
   * unaudited (AUDIT-003).
   */
  async record(input: RecordAuditInput): Promise<AuditEvent> {
    const parsed = RecordAuditInputSchema.parse(input);
    const document: AuditEventDocument = {
      eventId: randomUUID(),
      occurredAt: new Date(),
      action: parsed.action,
      outcome: parsed.outcome,
      actor: parsed.actor,
      target: parsed.target,
      ...(parsed.changes && parsed.changes.length > 0 ? { changes: parsed.changes } : {}),
      ...(parsed.reason ? { reason: parsed.reason } : {}),
      context: parsed.context,
      ...(parsed.provider ? { provider: parsed.provider } : {}),
      schemaVersion: 1,
    };
    try {
      const created = await this.model.create(document);
      this.onRecorded?.();
      return toContract(created.toObject());
    } catch (error) {
      this.logger.error(
        {
          err: error,
          action: parsed.action,
          correlationId: parsed.context.correlationId,
          code: 'AUDIT_WRITE_FAILED',
        },
        'Audit record could not be written; the caller operation must fail rather than proceed unaudited.',
      );
      throw new AuditWriteError(error);
    }
  }

  /** Authentication events (AUDIT-005). Used by `SEC-013` when login lands; callable today. */
  async recordAuthenticationEvent(input: {
    outcome: 'succeeded' | 'denied' | 'failed';
    accountId?: string;
    sessionId?: string;
    correlationId: string;
    ip?: string;
    userAgent?: string;
    reason?: string;
    event?: 'succeeded' | 'failed' | 'loggedOut';
  }): Promise<AuditEvent> {
    const action =
      input.event === 'loggedOut'
        ? AUDIT_ACTIONS.authenticationLoggedOut
        : input.event === 'failed'
          ? AUDIT_ACTIONS.authenticationFailed
          : AUDIT_ACTIONS.authenticationSucceeded;
    return this.record({
      action,
      outcome: input.outcome,
      actor: {
        kind: input.accountId ? 'account' : 'anonymous',
        ...(input.accountId ? { accountId: input.accountId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      },
      target: { type: 'securityAccount', ...(input.accountId ? { id: input.accountId } : {}) },
      ...(input.reason ? { reason: input.reason } : {}),
      context: {
        correlationId: input.correlationId,
        ...(input.ip ? { ip: input.ip } : {}),
        ...(input.userAgent ? { userAgent: input.userAgent } : {}),
      },
    });
  }

  /** Build the scoped, injection-safe filter shared by query, count, and export (SEC-027, SEC-028). */
  private buildFilter(actor: ActorContext, query: AuditQuery): Record<string, unknown> {
    const equality: Record<string, unknown> = {};
    if (query.action) equality['action'] = query.action;
    if (query.actorAccountId) equality['actor.accountId'] = query.actorAccountId;
    if (query.targetType) equality['target.type'] = query.targetType;
    if (query.targetId) equality['target.id'] = query.targetId;
    if (query.outcome) equality['outcome'] = query.outcome;
    if (query.correlationId) equality['context.correlationId'] = query.correlationId;
    // Client-supplied values must be primitives, never operator objects.
    assertSafeFilter(
      Object.fromEntries(
        Object.entries(equality).map(([key, value]) => [key.replaceAll('.', '_'), value]),
      ),
    );

    const range: Record<string, unknown> = {};
    if (query.occurredFrom) range['$gte'] = new Date(query.occurredFrom);
    if (query.occurredTo) range['$lte'] = new Date(query.occurredTo);
    const requested: Record<string, unknown> = {
      ...equality,
      ...(Object.keys(range).length > 0 ? { occurredAt: range } : {}),
    };

    return withScope(buildScopeFilter(actor, AUDIT_SCOPE_FIELDS), requested);
  }

  /**
   * Keyset-paginated query (deterministic ordering), with a scoped `total` so a count can never reveal
   * how many records exist outside the actor's scope (SEC-028).
   */
  async query(actor: ActorContext, query: AuditQuery): Promise<AuditPage> {
    const filter = this.buildFilter(actor, query);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const paged: Record<string, unknown> = cursor
      ? {
          $and: [
            filter,
            {
              $or: [
                { occurredAt: { $lt: cursor.occurredAt } },
                { occurredAt: cursor.occurredAt, eventId: { $lt: cursor.eventId } },
              ],
            },
          ],
        }
      : filter;

    const [documents, total] = await Promise.all([
      this.model
        .find(paged)
        .sort({ occurredAt: -1, eventId: -1 })
        .limit(query.limit + 1)
        .lean<AuditEventDocument[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    const hasMore = documents.length > query.limit;
    const page = hasMore ? documents.slice(0, query.limit) : documents;
    const last = page.at(-1);
    const events = page.map(toContract);

    return {
      // Field restrictions apply to list output exactly as to a single read (SEC-029).
      items: restrictDocuments('auditEvent', actor, events) as AuditEvent[],
      total,
      limit: query.limit,
      ...(hasMore && last ? { nextCursor: encodeCursor(last.occurredAt, last.eventId) } : {}),
    };
  }

  /** Single read. Out of scope is indistinguishable from absent (SEC-030). */
  async findByEventId(actor: ActorContext, eventId: string): Promise<AuditEvent | undefined> {
    assertSafeFilter({ eventId });
    const filter = withScope(buildScopeFilter(actor, AUDIT_SCOPE_FIELDS), { eventId });
    const document = await this.model.findOne(filter).lean<AuditEventDocument>().exec();
    if (!document) return undefined;
    const [restricted] = restrictDocuments('auditEvent', actor, [toContract(document)]);
    return restricted as AuditEvent;
  }

  /**
   * Export rows for the same scoped filter (SEC-028) with the same field stripping (SEC-029). Bounded so
   * the response stays deterministic and cannot be used to pull the whole collection in one request.
   */
  async exportEvents(
    actor: ActorContext,
    query: AuditQuery,
  ): Promise<{ rows: AuditEvent[]; truncated: boolean }> {
    const filter = this.buildFilter(actor, query);
    const documents = await this.model
      .find(filter)
      .sort({ occurredAt: -1, eventId: -1 })
      .limit(AUDIT_EXPORT_MAX_ROWS + 1)
      .lean<AuditEventDocument[]>()
      .exec();
    const truncated = documents.length > AUDIT_EXPORT_MAX_ROWS;
    const rows = (truncated ? documents.slice(0, AUDIT_EXPORT_MAX_ROWS) : documents).map(
      toContract,
    );
    return { rows: restrictDocuments('auditEvent', actor, rows) as AuditEvent[], truncated };
  }
}
