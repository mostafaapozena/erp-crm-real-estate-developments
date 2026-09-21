/**
 * SEC module published interface (ADR-0001, ADR-0019). Owns security accounts' authorization data only:
 * roles, permissions, denials, and data scopes. Organization structure belongs to `CORE-ORG` and employee
 * records to `HR-EMP`.
 */
export { ACCOUNT_GRANTS_COLLECTION, ROLES_COLLECTION } from './model';
export { bootstrapGrant, bootstrapRole } from './bootstrap';
export type { BootstrapGrantInput, BootstrapRoleInput } from './bootstrap';
export { RoleKeyConflictError, SecurityService, UnknownRoleError } from './service';
export type { AuditRecorder, RequestContext } from './service';
export { securityRouter } from './router';
export type { SecurityRouterOptions } from './router';
