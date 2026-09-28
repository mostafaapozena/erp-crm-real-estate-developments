import {
  DeliveryPageSchema,
  DispatchResultSchema,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATES,
  NotificationPageSchema,
  NotificationPreferencesSchema,
  NotificationSchema,
} from '@alola/contracts';
import { z } from 'zod';
import {
  pathParameter,
  queryParameter,
  requestBody,
  type OpenApiHelpers,
  type PathMap,
} from './shared';

/** Schemas notifications contribute (CORE-NOTIFY-001 … 005). */
export const notificationComponents = {
  Notification: NotificationSchema,
  NotificationPage: NotificationPageSchema,
  NotificationPreferences: NotificationPreferencesSchema,
  DeliveryPage: DeliveryPageSchema,
  DispatchResult: DispatchResultSchema,
  UnreadCount: z.strictObject({ unread: z.number().int().nonnegative() }),
  ReadAllResult: z.strictObject({ updated: z.number().int().nonnegative() }),
} as const;

const OWN =
  "Requires only authentication. Always narrowed to the caller's own notices: another person's are " +
  'answered as absent.';

export function notificationPaths(h: OpenApiHelpers): PathMap {
  const own = { ...h.standardErrors, '401': h.authorizedErrors['401'] };
  return {
    '/api/v1/notifications/inbox': {
      get: {
        operationId: 'getNotificationInbox',
        summary: 'My in-app notifications, newest first',
        description: `${OWN} Words come from the translation resources by type, in the reader's language.`,
        parameters: [
          queryParameter('unreadOnly', { type: 'string', enum: ['true', 'false'] }),
          queryParameter('limit', { type: 'integer', minimum: 1, maximum: 100, default: 20 }),
          queryParameter('cursor', { type: 'string' }),
        ],
        responses: { '200': h.json('NotificationPage', 'A page of the inbox'), ...own },
      },
    },
    '/api/v1/notifications/unread-count': {
      get: {
        operationId: 'getUnreadNotificationCount',
        summary: 'How many of my notifications are unread',
        description: OWN,
        responses: { '200': h.json('UnreadCount', 'The count'), ...own },
      },
    },
    '/api/v1/notifications/{notificationId}/read': {
      post: {
        operationId: 'markNotificationRead',
        summary: 'Mark one of my notifications read',
        description: `${OWN} Idempotent: the first read time is kept.`,
        parameters: [pathParameter('notificationId', 'Opaque notification identifier')],
        responses: {
          '200': h.json('Notification', 'The notification'),
          '404': h.json('ErrorResponse', 'Absent, or not mine (NOT_FOUND)'),
          ...own,
        },
      },
    },
    '/api/v1/notifications/read-all': {
      post: {
        operationId: 'markAllNotificationsRead',
        summary: 'Mark all my notifications read',
        description: OWN,
        responses: { '200': h.json('ReadAllResult', 'How many changed'), ...own },
      },
    },
    '/api/v1/notifications/preferences': {
      get: {
        operationId: 'getNotificationPreferences',
        summary: 'My notification language and external-channel opt-ins',
        description: `${OWN} External channels are opt-in; in-app is always on (CORE-NOTIFY-003).`,
        responses: { '200': h.json('NotificationPreferences', 'The preferences'), ...own },
      },
      put: {
        operationId: 'setNotificationPreferences',
        summary: 'Set my notification language and opt-ins',
        description: OWN,
        requestBody: requestBody(h.ref('NotificationPreferences')),
        responses: {
          '200': h.json('NotificationPreferences', 'The preferences'),
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/notifications/deliveries': {
      get: {
        operationId: 'listNotificationDeliveries',
        summary: 'Delivery state of notifications — for operations',
        description:
          'Requires the administrative notification.viewDeliveries. Channel, state, attempts and the last ' +
          'error code; never the text. A simulated message reads simulated, never delivered (ADR-0026).',
        parameters: [
          queryParameter('state', { type: 'string', enum: [...NOTIFICATION_STATES] }),
          queryParameter('channel', { type: 'string', enum: [...NOTIFICATION_CHANNELS] }),
          queryParameter('limit', { type: 'integer', minimum: 1, maximum: 200, default: 50 }),
        ],
        responses: { '200': h.json('DeliveryPage', 'Deliveries'), ...h.authorizedErrors },
      },
    },
    '/api/v1/notifications/dispatch': {
      post: {
        operationId: 'dispatchNotifications',
        summary: 'Deliver what is due, now',
        description:
          'Requires the administrative notification.dispatch. Claims each due message under a lease, ' +
          'retries with backoff using the same idempotency key, and records every attempt. Idempotent.',
        responses: { '200': h.json('DispatchResult', 'What the sweep did'), ...h.authorizedErrors },
      },
    },
  };
}
