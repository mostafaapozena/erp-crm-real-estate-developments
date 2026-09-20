import { AUDIT_ACTIONS, AuditQuerySchema, type ActorContext } from '@alola/contracts';
import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors';
import { currentActor, requirePermission, type GuardOptions } from '../../http/actor';
import { correlationIdOf } from '../../http/correlation';
import { validate, validated } from '../../http/validate';
import type { AuditService } from './service';

/**
 * Audit query surface (AUDIT-004, SEC-028, SEC-029, SEC-030).
 *
 * There is intentionally **no** endpoint that updates or deletes an audit record (AUDIT-001).
 * Reading audit data is itself a sensitive read, so every read is recorded before the response is sent
 * (AUDIT-004): if the evidence cannot be written, the read fails rather than happening unrecorded.
 */
export interface AuditRouterOptions {
  /** Throws `SERVICE_NOT_CONFIGURED` when MongoDB is unavailable, so routes fail cleanly (ADR-0012). */
  getService: () => AuditService;
  guard?: GuardOptions;
}

function requestContext(res: Parameters<typeof correlationIdOf>[0], method: string, route: string) {
  return { correlationId: correlationIdOf(res), method, route };
}

/** Validated at the boundary like every other input, so no raw path value reaches a query (SEC-004). */
const EventIdParamsSchema = z.strictObject({
  eventId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/, { message: 'EVENT_ID_EXPECTED' }),
});

export function auditRouter(options: AuditRouterOptions): Router {
  const router = Router();

  router.get(
    '/events',
    requirePermission('audit.view', options.guard),
    validate({ query: AuditQuerySchema }),
    async (req, res) => {
      const actor = currentActor(res) as ActorContext;
      const service = options.getService();
      const query = validated<typeof AuditQuerySchema._output>(res, 'query');
      const page = await service.query(actor, query);
      await service.record({
        action: AUDIT_ACTIONS.auditRead,
        outcome: 'succeeded',
        actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
        target: { type: 'auditEvent' },
        reason: `list returned=${page.items.length} total=${page.total}`,
        context: {
          ...requestContext(res, req.method, '/api/v1/audit/events'),
          ...(req.ip ? { ip: req.ip } : {}),
        },
      });
      res.json(page);
    },
  );

  // Declared before `/events/:eventId` so "export" is never read as an event id.
  router.get(
    '/events/export',
    requirePermission('audit.export', options.guard),
    validate({ query: AuditQuerySchema }),
    async (req, res) => {
      const actor = currentActor(res) as ActorContext;
      const service = options.getService();
      const query = validated<typeof AuditQuerySchema._output>(res, 'query');
      const { rows, truncated } = await service.exportEvents(actor, query);
      // AUDIT-004: the export is recorded before any row leaves the server.
      await service.record({
        action: AUDIT_ACTIONS.auditExported,
        outcome: 'succeeded',
        actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
        target: { type: 'auditEvent' },
        reason: `export rows=${rows.length} truncated=${String(truncated)}`,
        context: {
          ...requestContext(res, req.method, '/api/v1/audit/events/export'),
          ...(req.ip ? { ip: req.ip } : {}),
        },
      });
      // Newline-delimited JSON: streamable, and every row passes through the same field stripping.
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('X-Export-Truncated', String(truncated));
      res.send(rows.map((row) => JSON.stringify(row)).join('\n'));
    },
  );

  router.get(
    '/events/:eventId',
    requirePermission('audit.view', options.guard),
    validate({ params: EventIdParamsSchema }),
    async (req, res) => {
      const actor = currentActor(res) as ActorContext;
      const service = options.getService();
      const { eventId } = validated<typeof EventIdParamsSchema._output>(res, 'params');
      const event = await service.findByEventId(actor, eventId);
      // SEC-030: out of scope is indistinguishable from absent.
      if (!event) throw new AppError('NOT_FOUND', 404);
      await service.record({
        action: AUDIT_ACTIONS.auditRead,
        outcome: 'succeeded',
        actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
        target: { type: 'auditEvent', id: eventId },
        context: {
          ...requestContext(res, req.method, '/api/v1/audit/events/:eventId'),
          ...(req.ip ? { ip: req.ip } : {}),
        },
      });
      res.json(event);
    },
  );

  return router;
}
