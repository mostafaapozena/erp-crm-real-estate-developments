/**
 * Identity module published interface (ADR-0001, ADR-0019).
 *
 * Owns credentials, authentication, sessions, devices, the second factor, and the account lifecycle. It
 * holds an **opaque** employee reference and nothing else about employment: employee records are
 * `HR-EMP` and organization structure is `CORE-ORG`.
 */
export {
  ACCOUNTS_COLLECTION,
  ACCOUNT_TOKENS_COLLECTION,
  REFRESH_TOKENS_COLLECTION,
  SESSIONS_COLLECTION,
  accountModel,
  accountTokenModel,
  refreshTokenModel,
  sessionModel,
} from './model';
export {
  AccountConflictError,
  AccountNotFoundError,
  AuthenticationFailedError,
  BootstrapNotPermittedError,
  IdentityService,
  InvalidCredentialTokenError,
  MfaStateError,
  ReauthenticationRequiredError,
  SelfAdministrationError,
} from './service';
export type {
  IdentityAuditRecorder,
  IdentityServiceOptions,
  IdentityTtl,
  IssuedSession,
  LoginResult,
  RequestContext,
  ResolvedSession,
} from './service';
export { AUTH_THROTTLE_RULES, AuthThrottle, ThrottledError } from './throttle';
export type { ThrottleName } from './throttle';
export {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  cookiePolicyFor,
  summarizeClient,
} from './cookies';
export type { CookiePolicy } from './cookies';
export { accountAdminRouter, authRouter, meRouter } from './router';
export type { IdentityRouterOptions } from './router';
