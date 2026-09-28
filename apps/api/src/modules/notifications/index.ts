/**
 * Notifications published interface (CORE-NOTIFY-001 … 005).
 *
 * Modules notify through `NotificationService.notify` (and `sendNow` for a person's explicit
 * action). Providers plug in as `ChannelAdapter`s; none is connected.
 */
export {
  NOTIFICATIONS_COLLECTION,
  NOTIFICATION_ATTEMPTS_COLLECTION,
  NOTIFICATION_PREFERENCES_COLLECTION,
  notificationAttemptModel,
  notificationModel,
  notificationPreferencesModel,
} from './model';
export {
  ChannelNotConnectedError,
  PermanentDeliveryError,
  RetryableDeliveryError,
  SimulatedChannelAdapter,
  UnconfiguredChannelAdapter,
  quietHoursRelease,
} from './adapters';
export type { ChannelAdapter, DeliveryOutcome, OutboundMessage } from './adapters';
export { NotificationService, renderNotification } from './service';
export type { NotificationServiceOptions, NotifyInput } from './service';
export { notificationRouter } from './router';
export type { NotificationRouterOptions } from './router';
