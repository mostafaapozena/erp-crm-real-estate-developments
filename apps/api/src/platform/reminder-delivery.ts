import type { Reminder } from '@alola/contracts';
import type { ReminderDeliveryAdapter } from '../modules/collections';
import type { NotificationService } from '../modules/notifications';

/**
 * The reminder centre's delivery, through the notification foundation (CORE-NOTIFY-002).
 *
 * A reminder the collections officer sends becomes one external notification to the customer on the
 * reminder's channel, deduplicated by the reminder, and is dispatched at once. What happens next is
 * the channel adapter's answer: in development the simulator marks it `simulated` — never `sent` —
 * and with no provider connected it is `undeliverable`. **No WhatsApp message is sent to anyone**
 * (ADR-0026, `SD-20`).
 */
export class NotificationReminderDelivery implements ReminderDeliveryAdapter {
  readonly provider = 'notifications';

  constructor(
    private readonly notifications: () => NotificationService,
    private readonly channelConnected: (channel: Reminder['channel']) => boolean,
  ) {}

  /** A reminder is only ever "connected" if its channel has a real provider — none has. */
  get connected(): boolean {
    return (['whatsapp', 'sms', 'email'] as const).some((channel) =>
      this.channelConnected(channel),
    );
  }

  async deliver(
    reminder: Reminder,
  ): Promise<{ accepted: boolean; reference?: string; reason?: string }> {
    const result = await this.notifications().sendNow({
      type: 'reminder.installmentDue',
      recipients: { customerIds: [reminder.customerId] },
      text: { ar: reminder.messageAr, en: reminder.messageEn },
      source: { type: 'reminder', id: reminder.reminderId },
      dedupeKey: `reminder:${reminder.reminderId}`,
      channels: [reminder.channel],
    });
    if (!result) return { accepted: false, reason: 'NOTIFICATION_NOT_CREATED' };
    const accepted = result.state === 'simulated' || result.state === 'delivered';
    return accepted
      ? { accepted, reference: `notification:${result.notificationId}` }
      : { accepted, reason: result.state };
  }
}
