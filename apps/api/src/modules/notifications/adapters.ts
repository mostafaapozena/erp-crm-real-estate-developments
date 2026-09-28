import type { Locale } from '@alola/contracts';

/**
 * External channel adapters (CORE-NOTIFY-002, ADR-0010).
 *
 * Every provider — an e-mail service, an SMS gateway, the official WhatsApp Business Platform — is
 * reached through this interface and nothing else, so connecting one adds an implementation without
 * changing a caller. **None is connected** (`SD-20`), and no unofficial WhatsApp route will ever
 * implement it.
 *
 * Two implementations exist:
 *
 * - `UnconfiguredChannelAdapter` — the production default. It refuses to send, and the notification
 *   is recorded `undeliverable` rather than silently dropped.
 * - `SimulatedChannelAdapter` — development and test only. It accepts a message, records it in memory,
 *   and reports `simulated`: a state no report can mistake for `delivered` (ADR-0026).
 */
export interface OutboundMessage {
  notificationId: string;
  /** The same on every attempt of one notification, so a provider can refuse a duplicate. */
  idempotencyKey: string;
  channel: 'email' | 'sms' | 'whatsapp';
  recipient: { kind: 'account' | 'customer'; id: string };
  locale: Locale;
  title: string;
  body: string;
}

export type DeliveryOutcome =
  | { status: 'delivered'; providerReference: string }
  | { status: 'simulated'; providerReference: string };

/** A failure worth retrying — a timeout, a rate limit, a provider outage. */
export class RetryableDeliveryError extends Error {
  constructor(
    readonly errorCode: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(errorCode);
    this.name = 'RetryableDeliveryError';
  }
}

/** A failure retrying cannot fix — an invalid address, a rejected template. */
export class PermanentDeliveryError extends Error {
  constructor(readonly errorCode: string) {
    super(errorCode);
    this.name = 'PermanentDeliveryError';
  }
}

export class ChannelNotConnectedError extends Error {
  constructor(readonly channel: string) {
    super(`No provider is connected for ${channel}.`);
    this.name = 'ChannelNotConnectedError';
  }
}

export interface ChannelAdapter {
  readonly channel: OutboundMessage['channel'];
  /** A stable adapter name for attempt records and logs. */
  readonly name: string;
  /** True only for a real, configured provider. The simulator is not connected. */
  readonly connected: boolean;
  send(message: OutboundMessage): Promise<DeliveryOutcome>;
}

export class UnconfiguredChannelAdapter implements ChannelAdapter {
  readonly name = 'unconfigured';
  readonly connected = false;
  constructor(readonly channel: OutboundMessage['channel']) {}

  send(): Promise<DeliveryOutcome> {
    return Promise.reject(new ChannelNotConnectedError(this.channel));
  }
}

export class SimulatedChannelNotPermittedError extends Error {
  readonly code = 'SERVICE_NOT_CONFIGURED';
  constructor(readonly environment: string) {
    super(`The simulated channel adapter is development-only (constructed in "${environment}").`);
    this.name = 'SimulatedChannelNotPermittedError';
  }
}

/**
 * Accepts messages and delivers them to nobody. Idempotent by key — a second send of the same
 * notification returns the first reference — so tests can prove a retry never becomes a second
 * message.
 */
export class SimulatedChannelAdapter implements ChannelAdapter {
  readonly name = 'simulated';
  readonly connected = false;
  private readonly accepted = new Map<string, string>();

  constructor(
    readonly channel: OutboundMessage['channel'],
    environment: string,
  ) {
    if (environment !== 'development' && environment !== 'test') {
      throw new SimulatedChannelNotPermittedError(environment);
    }
  }

  send(message: OutboundMessage): Promise<DeliveryOutcome> {
    const existing = this.accepted.get(message.idempotencyKey);
    const providerReference = existing ?? `simulated:${message.notificationId}`;
    this.accepted.set(message.idempotencyKey, providerReference);
    return Promise.resolve({ status: 'simulated', providerReference });
  }

  /** How many distinct messages were accepted — for tests. */
  get distinctMessages(): number {
    return this.accepted.size;
  }
}

/**
 * When quiet hours end, if `now` falls inside them (CORE-NOTIFY-004). Hours are local times in the
 * organization's timezone and may wrap midnight (`22:00`–`07:00`). Returns `undefined` outside them.
 * Minute precision; a daylight-saving jump inside the window shifts the release by at most an hour,
 * which only ever delays a non-urgent message.
 */
export function quietHoursRelease(
  now: Date,
  timeZone: string,
  hours: { start: string; end: string } | null,
): Date | undefined {
  if (!hours) return undefined;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  const toMinutes = (text: string) => {
    const [h = '0', m = '0'] = text.split(':');
    return Number(h) * 60 + Number(m);
  };
  const current = hour * 60 + minute;
  const start = toMinutes(hours.start);
  const end = toMinutes(hours.end);
  const inside =
    start < end ? current >= start && current < end : current >= start || current < end;
  if (!inside) return undefined;
  const wait = (end - current + 1440) % 1440;
  const release = new Date(now.getTime() + wait * 60_000);
  release.setUTCSeconds(0, 0);
  return release;
}
