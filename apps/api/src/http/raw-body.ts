import type { IncomingMessage } from 'node:http';

/**
 * The exact bytes of a webhook request (INTEGRATION-004).
 *
 * A signature is computed over the bytes the provider sent. Once the JSON parser has turned them into
 * an object, re-serializing cannot reproduce them — key order, spacing and escapes differ — so the
 * parser keeps a copy for webhook paths only, and the webhook route verifies against that copy.
 */
const rawBodies = new WeakMap<IncomingMessage, Buffer>();

export const WEBHOOK_PATH_PREFIX = '/api/v1/webhooks/';

export function keepRawBody(req: IncomingMessage, _res: unknown, buffer: Buffer): void {
  if (req.url?.startsWith(WEBHOOK_PATH_PREFIX)) rawBodies.set(req, Buffer.from(buffer));
}

export function rawBodyOf(req: IncomingMessage): Buffer | undefined {
  return rawBodies.get(req);
}
