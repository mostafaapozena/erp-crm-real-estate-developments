import {
  DeliveryQuerySchema,
  InboxQuerySchema,
  NotificationPreferencesSchema,
  RecordIdSchema,
} from '@alola/contracts';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuthenticated, requirePermission, type GuardOptions } from '../../http/actor';
import { requestContextOf, requireActor } from '../../http/request-context';
import { validate, validated } from '../../http/validate';
import type { NotificationService } from './service';

/**
 * Notifications HTTP surface (CORE-NOTIFY).
 *
 * The inbox and preferences belong to the signed-in person and need no permission; the queries are
 * always narrowed to `recipient = the caller`, so nobody can read or mark another person's notices.
 * Delivery state and the manual sweep are administrative.
 */
export interface NotificationRouterOptions {
  getService: () => NotificationService;
  guard?: GuardOptions;
}

const IdParamsSchema = z.strictObject({ notificationId: RecordIdSchema });

export function notificationRouter(options: NotificationRouterOptions): Router {
  const router = Router();
  const base = '/api/v1/notifications';
  const service = () => options.getService();

  router.get(
    '/inbox',
    requireAuthenticated(options.guard),
    validate({ query: InboxQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof InboxQuerySchema._output>(res, 'query');
      res.json(await service().inbox(requireActor(res).accountId, query));
    },
  );

  router.get('/unread-count', requireAuthenticated(options.guard), async (_req, res) => {
    res.json({ unread: await service().unreadCount(requireActor(res).accountId) });
  });

  router.post('/read-all', requireAuthenticated(options.guard), async (req, res) => {
    res.json(
      await service().markAllRead(
        requireActor(res),
        requestContextOf(req, res, `${base}/read-all`),
      ),
    );
  });

  router.get('/preferences', requireAuthenticated(options.guard), async (_req, res) => {
    res.json(await service().getPreferences(requireActor(res).accountId));
  });

  router.put(
    '/preferences',
    requireAuthenticated(options.guard),
    validate({ body: NotificationPreferencesSchema }),
    async (req, res) => {
      const body = validated<typeof NotificationPreferencesSchema._output>(res, 'body');
      res.json(
        await service().setPreferences(
          requireActor(res),
          body,
          requestContextOf(req, res, `${base}/preferences`),
        ),
      );
    },
  );

  router.get(
    '/deliveries',
    requirePermission('notification.viewDeliveries', options.guard),
    validate({ query: DeliveryQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof DeliveryQuerySchema._output>(res, 'query');
      res.json({ items: await service().deliveries(query) });
    },
  );

  router.post(
    '/dispatch',
    requirePermission('notification.dispatch', options.guard),
    async (req, res) => {
      res.json(
        await service().sweep(requireActor(res), requestContextOf(req, res, `${base}/dispatch`)),
      );
    },
  );

  router.post(
    '/:notificationId/read',
    requireAuthenticated(options.guard),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const { notificationId } = validated<typeof IdParamsSchema._output>(res, 'params');
      res.json(
        await service().markRead(
          requireActor(res),
          notificationId,
          requestContextOf(req, res, `${base}/:notificationId/read`),
        ),
      );
    },
  );

  return router;
}
