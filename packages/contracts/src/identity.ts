import { z } from 'zod';
import { InstantSchema } from './time';

/**
 * Identity and authentication contracts (SEC-011 … SEC-022).
 *
 * A **security account** owns credentials, sessions, devices, and MFA. It may *reference* an employee
 * record by id, but it never carries employee or organization data: those are `HR-EMP` and `CORE-ORG`
 * aggregates (ADR-0019). Nothing in this file describes employment.
 */

/**
 * Lifecycle (`SEC-012`, `SEC-019`, `SEC-021`): invited → active → suspended → terminated. There is no
 * deleted state — removing an account would orphan every audit record it appears in (ADR-0009).
 *
 * **Lockout is deliberately not a stored state.** It is a throttling decision with a bounded TTL, so a
 * counter store cannot lock an account out permanently; `suspended` is the administrative decision.
 */
export const ACCOUNT_STATES = ['invited', 'active', 'suspended', 'terminated'] as const;
export const AccountStateSchema = z.enum(ACCOUNT_STATES);
export type AccountState = z.infer<typeof AccountStateSchema>;

/** States from which an account may still authenticate. */
export const AUTHENTICABLE_STATES: readonly AccountState[] = ['active'];

/** Permitted transitions. Anything absent here is refused by the service, not by a caller's good manners. */
export const ACCOUNT_TRANSITIONS: Readonly<Record<AccountState, readonly AccountState[]>> = {
  invited: ['active', 'suspended', 'terminated'],
  active: ['suspended', 'terminated'],
  suspended: ['active', 'terminated'],
  terminated: [],
};

export function canTransition(from: AccountState, to: AccountState): boolean {
  return ACCOUNT_TRANSITIONS[from].includes(to);
}

/**
 * Login identifiers are normalized for **uniqueness and lookup**: trimmed, Unicode-normalized, and
 * lowercased. The raw form the person typed is never used as a key, so `Admin@x.com` and `admin@x.com`
 * cannot become two accounts — which is what makes "personal accounts only" (`SEC-022`) enforceable by
 * a unique index rather than by hope.
 *
 * Passwords are **never** normalized: see `PASSWORD_POLICY`.
 */
export function normalizeLoginIdentifier(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

/**
 * The schema validates the shape and bounds the length; it does **not** transform. Normalization happens
 * once, in the service, on the way to storage and lookup. A transform here would also make the contract
 * unrepresentable as JSON Schema, and the OpenAPI document is generated from these same definitions.
 */
const loginIdentifier = z
  .string()
  .min(3)
  .max(254)
  .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeLoginIdentifier(value)), {
    message: 'EMAIL_EXPECTED',
  });

export const LoginIdentifierSchema = loginIdentifier;

/**
 * Password policy (`SEC-013`, ADR-0023).
 *
 * Length-first, following NIST SP 800-63B: a long passphrase beats composition rules, and composition
 * rules push people towards `Password1!`. The raw password is never trimmed, lowercased, or
 * Unicode-normalized — doing so would silently shrink the keyspace and break a password that already
 * worked.
 */
export const PASSWORD_POLICY = {
  minLength: 12,
  /** Bounded so an enormous body cannot turn a hash into a denial-of-service. */
  maxLength: 200,
  /** Rejected outright, lowercased for comparison. Short list on purpose: it is not a breach corpus. */
  blockedPasswords: [
    'password',
    'password1',
    'password123',
    'passw0rd',
    '123456789012',
    '1234567890123',
    'qwertyuiop12',
    'administrator',
    'letmein12345',
    'iloveyou1234',
    'welcome12345',
    'alolaerp1234',
    'realestate12',
  ],
} as const;

export const PASSWORD_ISSUE_CODES = [
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
  'PASSWORD_TOO_COMMON',
  'PASSWORD_SINGLE_CHARACTER',
  'PASSWORD_CONTAINS_IDENTIFIER',
] as const;
export type PasswordIssueCode = (typeof PASSWORD_ISSUE_CODES)[number];

/**
 * Evaluate a password against the policy. Returns issue **codes**, never prose and never the password.
 * `identifier` is the account's login identifier when one is known, so "contains your own email" can be
 * refused; it is optional because the check must not be the reason the policy cannot run.
 */
export function passwordPolicyIssues(password: string, identifier?: string): PasswordIssueCode[] {
  const issues: PasswordIssueCode[] = [];
  if (password.length < PASSWORD_POLICY.minLength) issues.push('PASSWORD_TOO_SHORT');
  if (password.length > PASSWORD_POLICY.maxLength) issues.push('PASSWORD_TOO_LONG');
  const lowered = password.toLowerCase();
  if ((PASSWORD_POLICY.blockedPasswords as readonly string[]).includes(lowered)) {
    issues.push('PASSWORD_TOO_COMMON');
  }
  if (password.length > 0 && new Set(password).size === 1) issues.push('PASSWORD_SINGLE_CHARACTER');
  const local = identifier ? normalizeLoginIdentifier(identifier).split('@')[0] : undefined;
  if (local && local.length >= 3 && lowered.includes(local)) {
    issues.push('PASSWORD_CONTAINS_IDENTIFIER');
  }
  return issues;
}

/**
 * A password is validated by the policy function, not by a regex in a schema: the schema only bounds the
 * length so an oversized value is rejected before hashing is attempted.
 */
export const RawPasswordSchema = z.string().min(1).max(PASSWORD_POLICY.maxLength);

/** What an administrator sees. There is no field here that could carry a credential. */
export const SecurityAccountSchema = z.strictObject({
  accountId: z.string().min(1),
  loginIdentifier: z.string().min(1),
  displayName: z.string().min(1).max(200),
  state: AccountStateSchema,
  /** Opaque `HR-EMP` reference. Never employee data (ADR-0019). */
  employeeRef: z.string().min(1).max(200).optional(),
  mfaEnabled: z.boolean(),
  mfaRequired: z.boolean(),
  lastLoginAt: InstantSchema.optional(),
  /** Increments whenever credentials change; invalidates issued access tokens (`SEC-020`). */
  credentialVersion: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
  suspendedAt: InstantSchema.optional(),
  terminatedAt: InstantSchema.optional(),
});
export type SecurityAccount = z.infer<typeof SecurityAccountSchema>;

export const CreateAccountRequestSchema = z.strictObject({
  loginIdentifier: loginIdentifier,
  displayName: z.string().trim().min(1).max(200),
  employeeRef: z.string().trim().min(1).max(200).optional(),
  /**
   * `SEC-022`: an account belongs to one named person. The caller states so explicitly, and the
   * statement is audited — a shared mailbox account cannot be created by accident.
   */
  personalAccountAttested: z.literal(true),
});
export type CreateAccountRequest = z.infer<typeof CreateAccountRequestSchema>;

/**
 * Creating an account returns the activation token **once**. Delivery by email or WhatsApp belongs to
 * `CORE-NOTIFY` (not this group), so the administrator passes it on until that exists.
 */
export const CreateAccountResponseSchema = z.strictObject({
  account: SecurityAccountSchema,
  activationToken: z.string().min(1),
  activationExpiresAt: InstantSchema,
});

export const ActivateAccountRequestSchema = z.strictObject({
  token: z.string().min(1).max(200),
  password: RawPasswordSchema,
});

export const LoginRequestSchema = z.strictObject({
  loginIdentifier: loginIdentifier,
  password: RawPasswordSchema,
  /** Free-text label the person gives a device, for the session list (`SEC-018`). */
  deviceLabel: z.string().trim().min(1).max(100).optional(),
});

export const AccessTokenSchema = z.strictObject({
  accessToken: z.string().min(1),
  /** Seconds. The refresh token is a cookie and never appears in a response body. */
  expiresIn: z.number().int().positive(),
  tokenType: z.literal('Bearer'),
});

export const AuthenticatedLoginSchema = z.strictObject({
  status: z.literal('authenticated'),
  ...AccessTokenSchema.shape,
  account: SecurityAccountSchema,
  sessionId: z.string().min(1),
});

/**
 * Second factor still outstanding (`SEC-017`). `stage` distinguishes "enter your code" from "you must
 * enrol before you can sign in"; the challenge token is short-lived and can do nothing else.
 */
export const MfaChallengeResponseSchema = z.strictObject({
  status: z.literal('mfaRequired'),
  stage: z.enum(['verify', 'enrol']),
  challengeToken: z.string().min(1),
  expiresIn: z.number().int().positive(),
});

/**
 * Signing in is a protocol, not a single answer: the request itself succeeded even when a second factor
 * is still outstanding. The two outcomes are one discriminated union rather than an error carrying data,
 * so a client branches on `status` instead of parsing a failure.
 */
export const LoginResultSchema = z.discriminatedUnion('status', [
  AuthenticatedLoginSchema,
  MfaChallengeResponseSchema,
]);
export type LoginResultBody = z.infer<typeof LoginResultSchema>;

export const RevokedSessionsResponseSchema = z.strictObject({
  revoked: z.number().int().nonnegative(),
});

export const VerifyMfaRequestSchema = z.strictObject({
  challengeToken: z.string().min(1),
  /** A TOTP code or a recovery code; the server decides which by shape, and audits which was used. */
  code: z.string().trim().min(6).max(32),
  deviceLabel: z.string().trim().min(1).max(100).optional(),
});

export const ChangePasswordRequestSchema = z.strictObject({
  currentPassword: RawPasswordSchema,
  newPassword: RawPasswordSchema,
});

export const RequestPasswordResetRequestSchema = z.strictObject({
  loginIdentifier: loginIdentifier,
});

export const CompletePasswordResetRequestSchema = z.strictObject({
  token: z.string().min(1).max(200),
  password: RawPasswordSchema,
});

/** One session as its owner sees it (`SEC-018`). No token, no hash, no fingerprint. */
export const SessionSummarySchema = z.strictObject({
  sessionId: z.string().min(1),
  current: z.boolean(),
  createdAt: InstantSchema,
  lastSeenAt: InstantSchema,
  absoluteExpiresAt: InstantSchema,
  deviceLabel: z.string().max(100).optional(),
  /** Coarse client description derived from the user agent — never the raw header. */
  client: z.string().max(120).optional(),
  ip: z.string().max(64).optional(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const SessionListResponseSchema = z.strictObject({
  items: z.array(SessionSummarySchema),
});

/**
 * Enrolment reveals the shared secret exactly once (`SEC-017`). It is not active until a code from it is
 * confirmed, so an interrupted enrolment cannot lock anyone out.
 */
export const EnrolMfaResponseSchema = z.strictObject({
  secret: z.string().min(1),
  otpauthUri: z.string().min(1),
  /** Shown once, hashed at rest, each usable a single time. */
  recoveryCodes: z.array(z.string().min(1)).min(1),
});

export const ConfirmMfaRequestSchema = z.strictObject({
  code: z.string().trim().min(6).max(10),
});

export const DisableMfaRequestSchema = z.strictObject({
  /** Re-authentication: disabling a second factor requires the first one again. */
  currentPassword: RawPasswordSchema,
});

export const SuspendAccountRequestSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});

export const OffboardAccountRequestSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
  /**
   * `SEC-021` is account offboarding only. Task, approval, and customer reassignment are
   * `CORE-TASK-005`, `APPROVAL-007`, and Phase 3 `CRM-OWNER`; the caller acknowledges that those are
   * separate actions so "offboarded" is never mistaken for "handed over".
   */
  recordHandoverAcknowledged: z.literal(true),
});

export const AccountListResponseSchema = z.strictObject({
  items: z.array(SecurityAccountSchema),
});

export const AccountQuerySchema = z.strictObject({
  state: AccountStateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Audit actions this module records (AUDIT-005). */
export const IDENTITY_AUDIT_ACTIONS = {
  accountCreated: 'security.account.created',
  accountActivated: 'security.account.activated',
  accountSuspended: 'security.account.suspended',
  accountReactivated: 'security.account.reactivated',
  accountOffboarded: 'security.account.offboarded',
  accountLockedOut: 'security.account.lockedOut',
  passwordChanged: 'security.password.changed',
  passwordResetRequested: 'security.password.resetRequested',
  passwordResetCompleted: 'security.password.resetCompleted',
  sessionCreated: 'security.session.created',
  sessionRotated: 'security.session.rotated',
  sessionRevoked: 'security.session.revoked',
  sessionReuseDetected: 'security.session.reuseDetected',
  mfaChallengeIssued: 'security.mfa.challengeIssued',
  mfaEnrolmentStarted: 'security.mfa.enrolmentStarted',
  mfaEnabled: 'security.mfa.enabled',
  mfaDisabled: 'security.mfa.disabled',
  mfaFailed: 'security.mfa.failed',
  mfaRecoveryCodeUsed: 'security.mfa.recoveryCodeUsed',
} as const;

/** Reasons a session ends. Stored on the session so revocation is explainable afterwards. */
export const SESSION_REVOCATION_REASONS = [
  'logout',
  'rotated',
  'reuseDetected',
  'passwordChanged',
  'passwordReset',
  'suspended',
  'offboarded',
  'revokedByOwner',
  'revokedByAdministrator',
  'mfaDisabled',
] as const;
export const SessionRevocationReasonSchema = z.enum(SESSION_REVOCATION_REASONS);
export type SessionRevocationReason = z.infer<typeof SessionRevocationReasonSchema>;
