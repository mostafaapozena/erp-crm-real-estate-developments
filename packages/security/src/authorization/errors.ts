/**
 * Authorization failures carry the stable code the API returns (PLAT-008, I18N-008) and never a reason
 * the caller could mine: a denial message never states which permission or scope was missing, because
 * that is itself information about the policy (SEC-030).
 */
export class PermissionDeniedError extends Error {
  readonly code = 'FORBIDDEN';

  constructor(
    /** For server-side logs and audit only — never sent to the client. */
    readonly requiredPermission: string,
  ) {
    super('FORBIDDEN');
    this.name = 'PermissionDeniedError';
  }
}

export class UnauthenticatedError extends Error {
  readonly code = 'UNAUTHENTICATED';

  constructor() {
    super('UNAUTHENTICATED');
    this.name = 'UnauthenticatedError';
  }
}

/**
 * Raised when a record exists but is outside the actor's data scope. The API answers `404`, not `403`:
 * a `403` would confirm the record exists (SEC-030, ADR-0006).
 */
export class OutOfScopeError extends Error {
  readonly code = 'NOT_FOUND';

  constructor(readonly resource: string) {
    super('NOT_FOUND');
    this.name = 'OutOfScopeError';
  }
}

/** Raised when an actor tries to grant more than they hold, or to edit their own grants (SEC-031). */
export class PrivilegeEscalationError extends Error {
  readonly code = 'FORBIDDEN';

  constructor(readonly attempt: string) {
    super('FORBIDDEN');
    this.name = 'PrivilegeEscalationError';
  }
}

/** Raised when a query would reach the database without a scope (SEC-027). */
export class UnscopedQueryError extends Error {
  readonly code = 'INTERNAL_ERROR';

  constructor(readonly resource: string) {
    super(`Query on "${resource}" attempted without a data scope (SEC-027).`);
    this.name = 'UnscopedQueryError';
  }
}

/** Raised when a client-supplied filter contains MongoDB operators (injection guard). */
export class UnsafeFilterError extends Error {
  readonly code = 'VALIDATION_FAILED';

  constructor(readonly key: string) {
    super('VALIDATION_FAILED');
    this.name = 'UnsafeFilterError';
  }
}
