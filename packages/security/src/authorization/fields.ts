import { FIELD_RESTRICTIONS, type ActorContext, type RestrictedResource } from '@alola/contracts';
import { can } from './policy';
import { PermissionDeniedError } from './errors';

/**
 * Field-level restriction (SEC-029, ADR-0006).
 *
 * A field the actor may not see is **removed**, not nulled and not masked in the client: anything the
 * server serializes can be read. The same function serves list responses, single reads, and exports, so
 * an export cannot bypass stripping by taking a different code path.
 */

function deleteAtPath(target: Record<string, unknown>, path: string): void {
  const segments = path.split('.');
  let cursor: Record<string, unknown> = target;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (typeof next !== 'object' || next === null) return;
    cursor = next as Record<string, unknown>;
  }
  delete cursor[segments[segments.length - 1] as string];
}

/** Fields of `resource` the actor is not entitled to see. */
export function restrictedFieldsFor(resource: RestrictedResource, actor: ActorContext): string[] {
  return Object.entries(FIELD_RESTRICTIONS[resource])
    .filter(([, permission]) => !can(actor, permission))
    .map(([field]) => field);
}

/** Returns a copy of `document` with every field the actor may not see absent. */
export function restrictDocument<T extends Record<string, unknown>>(
  resource: RestrictedResource,
  actor: ActorContext,
  document: T,
): Partial<T> {
  const copy = structuredClone(document) as Record<string, unknown>;
  for (const field of restrictedFieldsFor(resource, actor)) deleteAtPath(copy, field);
  return copy as Partial<T>;
}

export function restrictDocuments<T extends Record<string, unknown>>(
  resource: RestrictedResource,
  actor: ActorContext,
  documents: readonly T[],
): Partial<T>[] {
  return documents.map((document) => restrictDocument(resource, actor, document));
}

/**
 * Writes are checked too: an actor who may not *see* a protected field may not set it either. Combined
 * with strict request schemas (mass assignment is rejected at the boundary), this closes the write path.
 */
export function assertWritableFields(
  resource: RestrictedResource,
  actor: ActorContext,
  payload: Record<string, unknown>,
): void {
  for (const [field, permission] of Object.entries(FIELD_RESTRICTIONS[resource])) {
    const [root] = field.split('.');
    if (root !== undefined && root in payload && !can(actor, permission)) {
      throw new PermissionDeniedError(permission);
    }
  }
}
