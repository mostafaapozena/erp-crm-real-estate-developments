import type { ActorContext, FieldIssue } from '@alola/contracts';
import type { ClientSession } from 'mongoose';

/**
 * The audit port every foundation module records through (AUDIT-002, AUDIT-003).
 *
 * A module depends on this shape, not on the audit module's implementation, so the composition root
 * decides what records the evidence (ADR-0001). `session` lets a module write its evidence inside the
 * same transaction as the change it describes: the two commit together or not at all.
 */
export interface AuditRecordInput {
  action: string;
  outcome: 'succeeded' | 'denied' | 'failed';
  actor: { kind: 'account' | 'system' | 'anonymous'; accountId?: string; roleKeys?: string[] };
  target: { type: string; id?: string };
  changes?: { path: string; from?: string; to?: string }[];
  reason?: string;
  context: RequestContext;
}

export interface AuditRecorder {
  record(input: AuditRecordInput, options?: { session?: ClientSession }): Promise<unknown>;
}

/** What a service needs to know about the request that caused a change. */
export interface RequestContext {
  correlationId: string;
  ip?: string;
  userAgent?: string;
  method?: string;
  route?: string;
}

/** The actor as the audit record stores it. */
export function auditActor(actor: ActorContext): AuditRecordInput['actor'] {
  return { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys };
}

/**
 * True for MongoDB's duplicate-key error (E11000).
 *
 * A unique index is the concurrency control for "exactly one" rules, so a duplicate-key failure is an
 * expected answer — a conflict — not an internal error. Recognising it here lets a module answer 409
 * instead of letting the driver's numeric code fall through to a 500.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000
  );
}

/** A classified failure a module can throw without importing the HTTP layer (PLAT-008). */
export class DomainError extends Error {
  constructor(
    readonly code: 'VALIDATION_FAILED' | 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN',
    readonly issues?: FieldIssue[],
  ) {
    super(code);
    this.name = 'DomainError';
  }
}

export const notFound = () => new DomainError('NOT_FOUND');
export const conflict = (issueCode?: string, path: (string | number)[] = []) =>
  new DomainError('CONFLICT', issueCode ? [{ path, code: issueCode }] : undefined);
export const invalid = (issueCode: string, path: (string | number)[] = []) =>
  new DomainError('VALIDATION_FAILED', [{ path, code: issueCode }]);
