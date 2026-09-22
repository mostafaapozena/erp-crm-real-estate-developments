import { randomUUID } from 'node:crypto';

/**
 * Server-generated record identifiers (`RecordIdSchema` in `@alola/contracts`).
 *
 * A prefix plus 32 hex characters of a v4 UUID. The prefix makes an identifier self-describing in an
 * audit record or a support conversation; the random body reveals no ordering, so records cannot be
 * enumerated and volume cannot be inferred from an identifier seen in a URL.
 *
 * Identifiers are never derived from user input, and never from a counter.
 */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}
