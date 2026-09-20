import { UnsafeFilterError } from './errors';

/**
 * Operator-injection guard.
 *
 * Request schemas are strict, so a client cannot smuggle extra fields, but a value that reaches a query
 * must still never carry MongoDB operators: `{ "actorAccountId": { "$ne": null } }` would otherwise turn
 * an equality filter into "everything". Keys beginning with `$` and keys containing `.` are rejected,
 * and values are accepted only as primitives or arrays of primitives.
 */
export type SafeFilterValue = string | number | boolean | Date | null | (string | number)[];

export function assertSafeFilterKey(key: string): void {
  if (key.startsWith('$') || key.includes('.') || key.includes('\0')) {
    throw new UnsafeFilterError(key);
  }
}

export function assertSafeFilterValue(key: string, value: unknown): void {
  if (value === null) return;
  if (['string', 'number', 'boolean'].includes(typeof value)) return;
  if (value instanceof Date) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!['string', 'number'].includes(typeof item)) throw new UnsafeFilterError(key);
    }
    return;
  }
  // Objects are where `$gt`, `$ne`, `$where`, and `$function` would arrive.
  throw new UnsafeFilterError(key);
}

/**
 * Validate an already-parsed filter before it is combined with a scope filter. Range conditions that the
 * application itself builds (for example `occurredAt` between two instants) are constructed server-side
 * and passed separately, never taken from a client object.
 */
export function assertSafeFilter(filter: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(filter)) {
    assertSafeFilterKey(key);
    assertSafeFilterValue(key, value);
  }
}
