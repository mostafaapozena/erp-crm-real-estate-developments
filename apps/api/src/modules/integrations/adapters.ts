import type { IntegrationProvider } from '@alola/contracts';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * What an adapter provides (ADR-0010). Every method speaks the product's language; provider payloads
 * stay inside the adapter. **No adapter is registered in this build** — each provider's adapter
 * arrives with its business phase and its own contract tests.
 */
export interface IntegrationAdapter {
  provider: IntegrationProvider;
  /** The provider API version this adapter is written and tested against (INTEGRATION-002). */
  apiVersion: string;
  /** Credential names the adapter needs; storing others is refused. */
  credentialNames: readonly string[];
  /** How long after the last successful sync the data counts as stale (INTEGRATION-003). */
  staleAfterMinutes: number;
  /** Check the connection with stored credentials. Never throws for an ordinary provider failure. */
  check(credentials: Readonly<Record<string, string>>): Promise<AdapterCheck>;
  /** Present when the provider sends webhooks. */
  webhook?: WebhookHandling;
  /** Present when the provider receives outbound operations through the outbox. */
  perform?(
    operation: string,
    payload: unknown,
    idempotencyKey: string,
    credentials: Readonly<Record<string, string>>,
  ): Promise<{ providerReference?: string }>;
}

export interface AdapterCheck {
  ok: boolean;
  tokenValidUntil?: Date;
  /** A stable code — never provider prose (ADR-0010, "errors are translated"). */
  errorCode?: string;
}

export interface WebhookHandling {
  /**
   * Decide whether the raw bytes were sent by the provider. Runs **before** anything is parsed.
   * Returns the provider's event ID and type when valid, `undefined` when not.
   */
  verify(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
    credentials: Readonly<Record<string, string>>,
    now: Date,
  ): { providerEventId: string; eventType: string; payload: unknown } | undefined;
  /** Apply one verified event. Must be idempotent: it may run again after a crash. */
  process(event: { providerEventId: string; eventType: string; payload: unknown }): Promise<void>;
}

/** A provider-side failure that is worth retrying (rate limit, timeout, 5xx). */
export class RetryableIntegrationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'RetryableIntegrationError';
  }
}

/**
 * The HMAC-SHA256 scheme most providers use, as a building block for adapters (INTEGRATION-004).
 *
 * Signs `timestamp + "." + body` with a shared secret; refuses a timestamp outside the tolerance
 * (replay of an old capture) and compares in constant time. The signature header may carry a
 * `sha256=` prefix. A provider with a different scheme implements `verify` itself.
 */
export function verifyHmacSha256(options: {
  rawBody: Buffer;
  signature: string | undefined;
  timestamp: string | undefined;
  secret: string | undefined;
  now: Date;
  toleranceSeconds?: number;
}): boolean {
  const { rawBody, signature, timestamp, secret, now } = options;
  if (!signature || !timestamp || !secret) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const age = Math.abs(now.getTime() / 1000 - Number(timestamp));
  if (age > (options.toleranceSeconds ?? 300)) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  const presented = signature.replace(/^sha256=/, '');
  if (!/^[0-9a-f]{64}$/i.test(presented)) return false;
  const actual = Buffer.from(presented, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Produce a signature the way `verifyHmacSha256` expects — for tests and fixtures. */
export function signHmacSha256(rawBody: Buffer, timestamp: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex')}`;
}
