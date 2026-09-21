/**
 * AUDIT module published interface (ADR-0001). Other modules use only what is exported here — never the
 * model or the collection directly, which is what keeps the append-only guarantee enforceable.
 */
export { AUDIT_COLLECTION, AuditImmutableError } from './model';
export { AuditService, AuditWriteError, AUDIT_SCOPE_FIELDS } from './service';
export type { AuditServiceOptions, AuditWriteOptions } from './service';
export { auditRouter } from './router';
export type { AuditRouterOptions } from './router';
