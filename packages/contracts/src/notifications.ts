import { z } from 'zod';
import { RecordIdSchema } from './identifiers';
import { LocaleSchema } from './localized';
import { InstantSchema } from './time';

/**
 * Notifications (CORE-NOTIFY-001 … 005).
 *
 * One foundation delivers every notice the product sends: in-app notices to people who use the
 * system, and — once a provider is connected — e-mail, SMS and WhatsApp messages. Its guarantees:
 *
 * - **In-app is real** (CORE-NOTIFY-001). The notification row is the inbox.
 * - **External channels are adapters** (CORE-NOTIFY-002). With no provider connected a message is
 *   `undeliverable`; in development a simulated adapter marks it `simulated` — never `delivered`
 *   (ADR-0026). No unofficial WhatsApp route exists.
 * - **Each recipient's language** (CORE-NOTIFY-003) is chosen from their preference.
 * - **Quiet hours** (CORE-NOTIFY-004), in the organization's timezone, hold non-urgent external
 *   messages until they end. The hours themselves are `SD-21`.
 * - **No duplicates** (CORE-NOTIFY-005). A dedupe key makes creation idempotent; a retry passes the same
 *   idempotency key to the provider; every attempt is recorded.
 */

export const NOTIFICATION_CHANNELS = ['inApp', 'email', 'sms', 'whatsapp'] as const;
export const NotificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;
export const EXTERNAL_CHANNELS = ['email', 'sms', 'whatsapp'] as const;

/**
 * What a notification is about. Its words live in the translation resources
 * (`notification.types.<type>`), so every recipient reads it in their own language.
 */
export const NOTIFICATION_TYPES = [
  'approval.pending',
  'approval.escalated',
  'approval.decided',
  'task.assigned',
  'task.dueSoon',
  'task.overdue',
  'task.escalated',
  'reminder.installmentDue',
] as const;
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const NOTIFICATION_STATES = [
  /** Waiting for its first or next attempt. */
  'pending',
  /** Held until quiet hours end. */
  'deferred',
  /** Claimed by a dispatcher; the lease expires if it dies. */
  'sending',
  'delivered',
  /** Accepted by the development simulator — it reached nobody (ADR-0026). */
  'simulated',
  /** Every retry failed. Kept, never deleted: the dead letter of this foundation. */
  'failed',
  /** No provider is connected for the channel. */
  'undeliverable',
] as const;
export const NotificationStateSchema = z.enum(NOTIFICATION_STATES);
export type NotificationState = z.infer<typeof NotificationStateSchema>;

/** Values interpolated into a notification's text. Identifiers and short titles, never secrets. */
export const NotificationParamsSchema = z
  .record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,31}$/), z.string().max(200))
  .refine((params) => Object.keys(params).length <= 10, { message: 'TOO_MANY_PARAMS' });

export const NotificationSchema = z.strictObject({
  notificationId: RecordIdSchema,
  type: NotificationTypeSchema,
  channel: NotificationChannelSchema,
  locale: LocaleSchema,
  params: z.record(z.string(), z.string()),
  source: z.strictObject({ type: z.string(), id: z.string() }).optional(),
  state: NotificationStateSchema,
  read: z.boolean(),
  createdAt: InstantSchema,
  readAt: InstantSchema.optional(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationPageSchema = z.strictObject({
  items: z.array(NotificationSchema),
  unread: z.number().int().nonnegative(),
  nextCursor: z.string().optional(),
});

export const InboxQuerySchema = z.strictObject({
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(200).optional(),
});

/** Delivery detail for operations — who, which channel, which state, how many attempts. */
export const DeliveryRecordSchema = z.strictObject({
  notificationId: RecordIdSchema,
  type: NotificationTypeSchema,
  channel: NotificationChannelSchema,
  recipient: z.strictObject({ kind: z.enum(['account', 'customer']), id: z.string() }),
  state: NotificationStateSchema,
  attempts: z.number().int().nonnegative(),
  lastErrorCode: z.string().optional(),
  nextAttemptAt: InstantSchema.optional(),
  createdAt: InstantSchema,
  deliveredAt: InstantSchema.optional(),
});
export const DeliveryPageSchema = z.strictObject({ items: z.array(DeliveryRecordSchema) });

export const DeliveryQuerySchema = z.strictObject({
  state: NotificationStateSchema.optional(),
  channel: NotificationChannelSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const NotificationPreferencesSchema = z.strictObject({
  locale: LocaleSchema,
  /** External channels are opt-in; in-app is always on. */
  channels: z.strictObject({ email: z.boolean(), sms: z.boolean(), whatsapp: z.boolean() }),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;

export const DispatchResultSchema = z.strictObject({
  claimed: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  simulated: z.number().int().nonnegative(),
  retrying: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  undeliverable: z.number().int().nonnegative(),
});
export type DispatchResult = z.infer<typeof DispatchResultSchema>;

export const NOTIFICATION_AUDIT_ACTIONS = {
  read: 'notification.read',
  readAll: 'notification.readAll',
  preferencesChanged: 'notification.preferencesChanged',
  dispatched: 'notification.dispatchSwept',
} as const;

/** Attempts before an external message is abandoned as `failed`. */
export const NOTIFICATION_MAX_ATTEMPTS = 5;
