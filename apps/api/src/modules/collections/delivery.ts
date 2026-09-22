import type { Reminder } from '@alola/contracts';

/**
 * Reminder delivery, as a port — and the only implementation that exists (ADR-0026).
 *
 * **Nothing is connected.** There is no WhatsApp Business account, no approved message template, and
 * no provider selected (`SD-20`). The interface below is the one a real adapter will implement, so
 * that connecting a provider later adds an implementation rather than changing every caller.
 *
 * The simulated adapter exists so the demonstration can show the reminder centre working end to end.
 * It is refused outside development, exactly as `DevKeyEncryptor` is, and everything it produces is
 * marked `simulated` — never `sent`. A reminder it "delivered" reached nobody, and the interface says
 * so in both languages.
 *
 * The feature must remain correct with **no** adapter configured: a reminder with nothing behind the
 * port is still generated, listed, previewed and audited. It simply stays `ready`.
 */
export interface ReminderDeliveryAdapter {
  /** A stable provider name for logs and audit records. Never a brand the product does not use. */
  readonly provider: string;
  /** True only when a real provider is configured and reachable. The simulated adapter returns false. */
  readonly connected: boolean;
  deliver(reminder: Reminder): Promise<{ accepted: boolean; reference?: string; reason?: string }>;
}

export class SimulatedDeliveryNotPermittedError extends Error {
  readonly code = 'SERVICE_NOT_CONFIGURED';
  constructor(readonly environment: string) {
    super(
      `The simulated reminder adapter is development-only and was constructed in "${environment}". ` +
        'Connect a real provider or leave the port unconfigured (ADR-0026).',
    );
    this.name = 'SimulatedDeliveryNotPermittedError';
  }
}

/**
 * Records that a reminder *would* have been delivered, and nothing else.
 *
 * It makes no network call, holds no credential, and cannot fail for a provider reason — which is
 * precisely why its result is never reported as `sent`.
 */
export class SimulatedReminderDelivery implements ReminderDeliveryAdapter {
  readonly provider = 'simulated';
  readonly connected = false;

  constructor(environment: string) {
    if (environment !== 'development' && environment !== 'test') {
      throw new SimulatedDeliveryNotPermittedError(environment);
    }
  }

  deliver(reminder: Reminder): Promise<{ accepted: boolean; reference?: string }> {
    return Promise.resolve({
      accepted: true,
      // Prefixed so the reference can never be mistaken for a provider's own identifier.
      reference: `simulated:${reminder.reminderId}`,
    });
  }
}

/**
 * The bilingual reminder message.
 *
 * Composed here rather than in the interface so that the text a person previews is byte-identical to
 * the text an adapter would be handed. Both languages are always produced: a message that exists in
 * one language is a message that will eventually be sent in the wrong one.
 *
 * Amounts and dates are formatted by the caller with the shared formatters, so Western digits and
 * `dd/MM/yyyy` hold here too (`SD-23`).
 */
export function composeReminderMessage(input: {
  customerName: string;
  unitCode: string;
  amountText: string;
  dueDateText: string;
  contractNumber: string;
}): { messageAr: string; messageEn: string } {
  return {
    messageAr:
      `عميلنا العزيز ${input.customerName}، نذكّركم بقرب موعد استحقاق قسط الوحدة ${input.unitCode} ` +
      `ضمن العقد رقم ${input.contractNumber}. قيمة القسط ${input.amountText} ` +
      `وتاريخ الاستحقاق ${input.dueDateText}. شكرًا لتعاونكم.`,
    messageEn:
      `Dear ${input.customerName}, this is a reminder that the installment for unit ${input.unitCode} ` +
      `under contract ${input.contractNumber} is due soon. The amount is ${input.amountText} ` +
      `and the due date is ${input.dueDateText}. Thank you.`,
  };
}
