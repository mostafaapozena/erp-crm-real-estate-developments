import { randomBytes } from 'node:crypto';
import {
  ACCOUNT_STATES,
  AUTHENTICABLE_STATES,
  AUDIT_ACTIONS,
  IDENTITY_AUDIT_ACTIONS,
  SecurityAccountSchema,
  SessionSummarySchema,
  canTransition,
  normalizeLoginIdentifier,
  requiresMfa,
  type AccountState,
  type ActorContext,
  type CreateAccountRequest,
  type SecurityAccount,
  type SessionRevocationReason,
  type SessionSummary,
} from '@alola/contracts';
import {
  createTotpEnrolment,
  effectivePermissions,
  generateOpaqueSecret,
  generateRecoveryCodes,
  hashOpaqueSecret,
  looksLikeRecoveryCode,
  normalizeRecoveryCode,
  verifyTotp,
  type Encryptor,
  type Logger,
  type PasswordHasher,
  type TokenIssuer,
} from '@alola/security';
import type { Connection } from 'mongoose';
import type { AuthThrottle } from './throttle';
import {
  accountModel,
  accountTokenModel,
  refreshTokenModel,
  sessionModel,
  type AccountTokenDocument,
  type AuthSessionDocument,
  type SecurityAccountDocument,
  type StoredEncryptedValue,
} from './model';

/**
 * Identity and authentication (`SEC-011` … `SEC-022`).
 *
 * Two rules shape everything here:
 *
 * 1. **A failed authentication says nothing.** Unknown identifier, wrong password, suspended account,
 *    terminated account, and unactivated account all produce the same error, and the unknown-identifier
 *    path spends the same hashing work as a real one, so neither the body nor the timing distinguishes
 *    them (`SEC-013`).
 * 2. **A credential change is effective immediately.** Sessions are stored, and every request re-reads
 *    the session and the account, so suspension, password change, and offboarding end access at once
 *    rather than at the next login (`SEC-020`, ADR-0022).
 */

/** What this module needs from the audit subsystem; it never imports the module itself (ADR-0001). */
export interface IdentityAuditRecorder {
  record(input: {
    action: string;
    outcome: 'succeeded' | 'denied' | 'failed';
    actor: {
      kind: 'account' | 'system' | 'anonymous';
      accountId?: string;
      roleKeys?: string[];
      sessionId?: string;
    };
    target: { type: string; id?: string };
    changes?: { path: string; from?: string; to?: string }[];
    reason?: string;
    context: {
      correlationId: string;
      ip?: string;
      userAgent?: string;
      method?: string;
      route?: string;
    };
  }): Promise<unknown>;
}

export interface RequestContext {
  correlationId: string;
  ip?: string;
  userAgent?: string;
  method?: string;
  route?: string;
}

/** Time-to-live settings, all from configuration so an environment can tighten them. */
export interface IdentityTtl {
  sessionIdleSeconds: number;
  sessionAbsoluteSeconds: number;
  activationSeconds: number;
  passwordResetSeconds: number;
}

export interface IdentityServiceOptions {
  connection: Connection;
  logger: Logger;
  audit: IdentityAuditRecorder;
  hasher: PasswordHasher;
  tokens: TokenIssuer;
  encryptor: Encryptor;
  throttle: AuthThrottle;
  /** Supplied by the composition root, so identity does not depend on the authorization module. */
  resolveGrants: (accountId: string) => Promise<ActorContext | undefined>;
  ttl: IdentityTtl;
  totpIssuer: string;
  now?: () => Date;
}

/* ------------------------------------------------------------------ errors */

/** The single answer to every failed authentication. Carries no reason a caller could mine. */
export class AuthenticationFailedError extends Error {
  readonly code = 'UNAUTHENTICATED';
  constructor(
    /** Server-side only: why it actually failed, for the audit record and the log. */
    readonly internalReason: string,
  ) {
    super('UNAUTHENTICATED');
    this.name = 'AuthenticationFailedError';
  }
}

export class ReauthenticationRequiredError extends Error {
  readonly code = 'REAUTHENTICATION_REQUIRED';
  constructor() {
    super('REAUTHENTICATION_REQUIRED');
    this.name = 'ReauthenticationRequiredError';
  }
}

export class InvalidCredentialTokenError extends Error {
  readonly code = 'VALIDATION_FAILED';
  constructor(readonly purpose: string) {
    super('VALIDATION_FAILED');
    this.name = 'InvalidCredentialTokenError';
  }
}

export class AccountConflictError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly conflict: 'loginIdentifier' | 'employeeRef' | 'state') {
    super('CONFLICT');
    this.name = 'AccountConflictError';
  }
}

export class AccountNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('NOT_FOUND');
    this.name = 'AccountNotFoundError';
  }
}

export class MfaStateError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly detail: 'not-enrolling' | 'already-enabled' | 'not-enabled') {
    super('CONFLICT');
    this.name = 'MfaStateError';
  }
}

/**
 * An administrative operation aimed at the caller's own account (`SEC-031` applied to the account
 * lifecycle). Resetting your own second factor or password through the administrative route would skip
 * the re-authentication the self-service route requires, which is a way around `SEC-017`; suspending or
 * offboarding yourself is a self-inflicted lockout. Both are refused and recorded.
 */
export class SelfAdministrationError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(readonly operation: string) {
    super('FORBIDDEN');
    this.name = 'SelfAdministrationError';
  }
}

export class BootstrapNotPermittedError extends Error {
  readonly code = 'CONFLICT';
  constructor() {
    super('CONFLICT');
    this.name = 'BootstrapNotPermittedError';
  }
}

/* ------------------------------------------------------------------ results */

export interface IssuedSession {
  status: 'authenticated';
  accessToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
  account: SecurityAccount;
  sessionId: string;
  /** Returned to the router, which puts it in the `HttpOnly` cookie and never in the body. */
  refreshToken: string;
  refreshTokenMaxAgeSeconds: number;
}

export interface MfaChallenge {
  status: 'mfaRequired';
  stage: 'verify' | 'enrol';
  challengeToken: string;
  expiresIn: number;
}

export type LoginResult = IssuedSession | MfaChallenge;

export interface ResolvedSession {
  actor: ActorContext;
  session: AuthSessionDocument;
}

/** Retention for operational rows. The audit trail is separate, append-only, and unaffected. */
const SESSION_RETENTION_DAYS = 30;
const TOKEN_RETENTION_DAYS = 7;
/** Writing `lastSeenAt` on literally every request would be a write per read. */
const LAST_SEEN_WRITE_INTERVAL_SECONDS = 60;

const DAY_MS = 86_400_000;

function identifier(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString('base64url')}`;
}

function plusSeconds(from: Date, seconds: number): Date {
  return new Date(from.getTime() + seconds * 1000);
}

export class IdentityService {
  private readonly accounts;
  private readonly sessions;
  private readonly refreshTokens;
  private readonly accountTokens;
  private readonly now: () => Date;

  constructor(private readonly options: IdentityServiceOptions) {
    this.accounts = accountModel(options.connection);
    this.sessions = sessionModel(options.connection);
    this.refreshTokens = refreshTokenModel(options.connection);
    this.accountTokens = accountTokenModel(options.connection);
    this.now = options.now ?? (() => new Date());
  }

  /* --------------------------------------------------------- serialization */

  /**
   * The only way an account leaves this module. Built field by field from a fixed list, so a credential
   * added to the document later cannot reach a response by being picked up automatically.
   */
  private async toContract(document: SecurityAccountDocument): Promise<SecurityAccount> {
    return SecurityAccountSchema.parse({
      accountId: document.accountId,
      loginIdentifier: document.loginIdentifier,
      displayName: document.displayName,
      state: document.state,
      ...(document.employeeRef ? { employeeRef: document.employeeRef } : {}),
      mfaEnabled: document.mfa.enabled,
      mfaRequired: await this.accountRequiresMfa(document.accountId),
      ...(document.lastLoginAt ? { lastLoginAt: document.lastLoginAt.toISOString() } : {}),
      credentialVersion: document.credentialVersion,
      version: document.version,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      ...(document.suspendedAt ? { suspendedAt: document.suspendedAt.toISOString() } : {}),
      ...(document.terminatedAt ? { terminatedAt: document.terminatedAt.toISOString() } : {}),
    });
  }

  private toSessionSummary(
    document: AuthSessionDocument,
    currentSessionId: string | undefined,
  ): SessionSummary {
    return SessionSummarySchema.parse({
      sessionId: document.sessionId,
      current: document.sessionId === currentSessionId,
      createdAt: document.createdAt.toISOString(),
      lastSeenAt: document.lastSeenAt.toISOString(),
      absoluteExpiresAt: document.absoluteExpiresAt.toISOString(),
      ...(document.deviceLabel ? { deviceLabel: document.deviceLabel } : {}),
      ...(document.client ? { client: document.client } : {}),
      ...(document.ip ? { ip: document.ip } : {}),
    });
  }

  /* ------------------------------------------------------------------ MFA policy */

  /** `SEC-017`: a second factor is mandatory once an account holds any privileged permission. */
  private async accountRequiresMfa(accountId: string): Promise<boolean> {
    const grants = await this.options.resolveGrants(accountId);
    if (!grants) return false;
    return requiresMfa(effectivePermissions(grants));
  }

  private async encryptSecret(accountId: string, secret: string): Promise<StoredEncryptedValue> {
    const value = await this.options.encryptor.encrypt(Buffer.from(secret, 'utf8'), {
      purpose: 'mfa-totp-secret',
      accountId,
    });
    return { ...value };
  }

  private async decryptSecret(accountId: string, value: StoredEncryptedValue): Promise<string> {
    const plaintext = await this.options.encryptor.decrypt(value, {
      purpose: 'mfa-totp-secret',
      accountId,
    });
    return Buffer.from(plaintext).toString('utf8');
  }

  /* ------------------------------------------------------- account lifecycle */

  /**
   * Administrative operations never apply to the caller's own account. The self-service routes exist for
   * that and they ask for the password first.
   */
  private async assertNotSelfAdministration(
    actor: ActorContext,
    accountId: string,
    operation: string,
    context: RequestContext,
  ): Promise<void> {
    if (actor.accountId !== accountId) return;
    await this.options.audit.record({
      action: AUDIT_ACTIONS.authorizationDenied,
      outcome: 'denied',
      actor: this.auditActor(actor),
      target: { type: 'securityAccount', id: accountId },
      reason: `administrative ${operation} refused on the caller's own account`,
      context,
    });
    throw new SelfAdministrationError(operation);
  }

  private async findByAccountId(accountId: string): Promise<SecurityAccountDocument> {
    const document = await this.accounts
      .findOne({ accountId })
      .lean<SecurityAccountDocument>()
      .exec();
    if (!document) throw new AccountNotFoundError();
    return document;
  }

  /**
   * Create an account in the `invited` state with an activation token (`SEC-011`, `SEC-012`).
   *
   * No password is set here: nobody but the account holder ever knows it, and there is no public
   * self-registration path. The token is returned once — delivery is `CORE-NOTIFY`, a later group.
   */
  async createAccount(
    actor: ActorContext,
    input: CreateAccountRequest,
    context: RequestContext,
  ): Promise<{ account: SecurityAccount; activationToken: string; activationExpiresAt: Date }> {
    const loginIdentifier = normalizeLoginIdentifier(input.loginIdentifier);
    const now = this.now();
    const document: SecurityAccountDocument = {
      accountId: identifier('acc'),
      loginIdentifier,
      displayName: input.displayName,
      state: 'invited',
      ...(input.employeeRef ? { employeeRef: input.employeeRef } : {}),
      credentialVersion: 1,
      mfa: { enabled: false, recoveryCodes: [] },
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.accountId,
      updatedBy: actor.accountId,
    };

    try {
      await this.accounts.create(document);
    } catch (error) {
      throw this.asConflict(error);
    }

    const { token, expiresAt } = await this.issueAccountToken(
      document.accountId,
      'activation',
      this.options.ttl.activationSeconds,
    );

    await this.options.audit.record({
      action: IDENTITY_AUDIT_ACTIONS.accountCreated,
      outcome: 'succeeded',
      actor: this.auditActor(actor),
      target: { type: 'securityAccount', id: document.accountId },
      changes: [
        { path: 'state', to: 'invited' },
        { path: 'loginIdentifier', to: loginIdentifier },
        ...(input.employeeRef ? [{ path: 'employeeRef', to: input.employeeRef }] : []),
        // SEC-022: the attestation is part of the evidence, not just a form field.
        { path: 'personalAccountAttested', to: 'true' },
      ],
      context,
    });

    return {
      account: await this.toContract(document),
      activationToken: token,
      activationExpiresAt: expiresAt,
    };
  }

  /** Duplicate key → a conflict naming which uniqueness rule was hit, never the stored row. */
  private asConflict(error: unknown): Error {
    const message = error instanceof Error ? error.message : '';
    if (/E11000/.test(message)) {
      if (/loginIdentifier/.test(message)) return new AccountConflictError('loginIdentifier');
      if (/employeeRef/.test(message)) return new AccountConflictError('employeeRef');
    }
    return error instanceof Error ? error : new Error('UNKNOWN_WRITE_ERROR');
  }

  private auditActor(actor: ActorContext): {
    kind: 'account' | 'system';
    accountId: string;
    roleKeys: string[];
    sessionId?: string;
  } {
    return {
      kind: actor.kind,
      accountId: actor.accountId,
      roleKeys: [...actor.roleKeys],
      ...(actor.sessionId ? { sessionId: actor.sessionId } : {}),
    };
  }

  private async issueAccountToken(
    accountId: string,
    purpose: AccountTokenDocument['purpose'],
    ttlSeconds: number,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = generateOpaqueSecret();
    const now = this.now();
    const expiresAt = plusSeconds(now, ttlSeconds);
    await this.accountTokens.create({
      tokenHash: hashOpaqueSecret(token),
      accountId,
      purpose,
      createdAt: now,
      expiresAt,
      purgeAfter: new Date(expiresAt.getTime() + TOKEN_RETENTION_DAYS * DAY_MS),
    });
    return { token, expiresAt };
  }

  /** Consumes a single-use token. A replay finds `usedAt` already set and is refused. */
  private async consumeAccountToken(
    token: string,
    purpose: AccountTokenDocument['purpose'],
  ): Promise<AccountTokenDocument> {
    const now = this.now();
    const consumed = await this.accountTokens
      .findOneAndUpdate(
        {
          tokenHash: hashOpaqueSecret(token),
          purpose,
          usedAt: { $exists: false },
          expiresAt: { $gt: now },
        },
        { $set: { usedAt: now } },
        { new: true },
      )
      .lean<AccountTokenDocument>()
      .exec();
    if (!consumed) throw new InvalidCredentialTokenError(purpose);
    return consumed;
  }

  /** Activation sets the first password and moves `invited` → `active` (`SEC-012`). */
  async activateAccount(
    token: string,
    password: string,
    context: RequestContext,
  ): Promise<SecurityAccount> {
    const consumed = await this.consumeAccountToken(token, 'activation');
    const account = await this.findByAccountId(consumed.accountId);
    if (account.state !== 'invited') throw new AccountConflictError('state');

    const passwordHash = await this.options.hasher.hashNewPassword(
      password,
      account.loginIdentifier,
    );
    const now = this.now();
    const updated = await this.accounts
      .findOneAndUpdate(
        { accountId: account.accountId, state: 'invited' },
        {
          $set: {
            state: 'active',
            passwordHash,
            passwordUpdatedAt: now,
            updatedAt: now,
            updatedBy: account.accountId,
          },
          $inc: { version: 1, credentialVersion: 1 },
        },
        { new: true },
      )
      .lean<SecurityAccountDocument>()
      .exec();
    if (!updated) throw new AccountConflictError('state');

    await this.options.audit.record({
      action: IDENTITY_AUDIT_ACTIONS.accountActivated,
      outcome: 'succeeded',
      // The account activates itself: it is the only party that knows the token.
      actor: { kind: 'account', accountId: account.accountId },
      target: { type: 'securityAccount', id: account.accountId },
      changes: [{ path: 'state', from: 'invited', to: 'active' }],
      context,
    });
    return this.toContract(updated);
  }

  /** Suspension (`SEC-019`) ends access at once by revoking every session (`SEC-020`). */
  async suspendAccount(
    actor: ActorContext,
    accountId: string,
    reason: string,
    context: RequestContext,
  ): Promise<SecurityAccount> {
    await this.assertNotSelfAdministration(actor, accountId, 'suspend', context);
    const updated = await this.transition(actor, accountId, 'suspended', context, {
      reason,
      auditAction: IDENTITY_AUDIT_ACTIONS.accountSuspended,
      revocation: 'suspended',
    });
    return updated;
  }

  async reactivateAccount(
    actor: ActorContext,
    accountId: string,
    context: RequestContext,
  ): Promise<SecurityAccount> {
    return this.transition(actor, accountId, 'active', context, {
      auditAction: IDENTITY_AUDIT_ACTIONS.accountReactivated,
    });
  }

  /**
   * Offboarding (`SEC-021`): **one** audited action that terminates the account, revokes every session,
   * and invalidates outstanding activation and reset tokens.
   *
   * It does not touch the employee record. This module holds only an opaque reference to one, and
   * employment termination is an `HR-EMP` action (ADR-0019). Task, approval, and customer reassignment
   * are `CORE-TASK-005`, `APPROVAL-007`, and Phase 3 `CRM-OWNER`; the caller acknowledges that
   * explicitly so a terminated account is never mistaken for a completed handover.
   */
  async offboardAccount(
    actor: ActorContext,
    accountId: string,
    reason: string,
    context: RequestContext,
  ): Promise<SecurityAccount> {
    await this.assertNotSelfAdministration(actor, accountId, 'offboard', context);
    const account = await this.transition(actor, accountId, 'terminated', context, {
      reason,
      auditAction: IDENTITY_AUDIT_ACTIONS.accountOffboarded,
      revocation: 'offboarded',
    });
    // Outstanding invitations and reset links must not outlive the account.
    await this.accountTokens
      .updateMany({ accountId, usedAt: { $exists: false } }, { $set: { usedAt: this.now() } })
      .exec();
    return account;
  }

  private async transition(
    actor: ActorContext,
    accountId: string,
    to: AccountState,
    context: RequestContext,
    options: {
      reason?: string;
      auditAction: string;
      revocation?: SessionRevocationReason;
    },
  ): Promise<SecurityAccount> {
    const current = await this.findByAccountId(accountId);
    if (!canTransition(current.state, to)) throw new AccountConflictError('state');

    const now = this.now();
    const set: Record<string, unknown> = { state: to, updatedAt: now, updatedBy: actor.accountId };
    if (to === 'suspended') {
      set['suspendedAt'] = now;
      if (options.reason) set['suspensionReason'] = options.reason;
    }
    if (to === 'terminated') set['terminatedAt'] = now;
    if (to === 'active') set['suspendedAt'] = undefined;

    // Compare-and-set on the state: a concurrent transition loses rather than overwriting.
    const updated = await this.accounts
      .findOneAndUpdate(
        { accountId, state: current.state },
        { $set: set, $inc: { version: 1 } },
        { new: true },
      )
      .lean<SecurityAccountDocument>()
      .exec();
    if (!updated) throw new AccountConflictError('state');

    if (options.revocation) {
      await this.revokeSessions({ accountId }, options.revocation, context, actor);
    }

    await this.options.audit.record({
      action: options.auditAction,
      outcome: 'succeeded',
      actor: this.auditActor(actor),
      target: { type: 'securityAccount', id: accountId },
      changes: [{ path: 'state', from: current.state, to }],
      ...(options.reason ? { reason: options.reason } : {}),
      context,
    });
    return this.toContract(updated);
  }

  async listAccounts(filter: { state?: AccountState }, limit: number): Promise<SecurityAccount[]> {
    const query: Record<string, unknown> = {};
    if (filter.state && (ACCOUNT_STATES as readonly string[]).includes(filter.state)) {
      query['state'] = filter.state;
    }
    const documents = await this.accounts
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<SecurityAccountDocument[]>()
      .exec();
    return Promise.all(documents.map((document) => this.toContract(document)));
  }

  async getAccount(accountId: string): Promise<SecurityAccount> {
    return this.toContract(await this.findByAccountId(accountId));
  }

  /* ------------------------------------------------------------ authentication */

  /**
   * Verify a password and either issue a session or demand a second factor (`SEC-013`, `SEC-017`).
   *
   * Every failure path throws the same error. The unknown-identifier path performs a dummy verification
   * so that it costs the same as a real one.
   */
  async login(
    input: { loginIdentifier: string; password: string; deviceLabel?: string },
    context: RequestContext,
  ): Promise<LoginResult> {
    const loginIdentifier = normalizeLoginIdentifier(input.loginIdentifier);
    await this.options.throttle.consume('loginByIp', context.ip ?? 'unknown-ip');
    // Keyed by the identifier, not the account id: an unknown identifier must be throttled too, or the
    // throttle itself would answer "does this account exist?".
    await this.options.throttle.consume('loginByAccount', loginIdentifier);

    const account = await this.accounts
      .findOne({ loginIdentifier })
      .lean<SecurityAccountDocument>()
      .exec();

    if (!account || !account.passwordHash) {
      await this.options.hasher.verifyDummy(input.password);
      await this.recordFailedLogin(loginIdentifier, undefined, 'unknown-or-unactivated', context);
      throw new AuthenticationFailedError('unknown-or-unactivated');
    }

    const passwordMatches = await this.options.hasher.verify(account.passwordHash, input.password);
    if (!passwordMatches) {
      await this.recordFailedLogin(loginIdentifier, account.accountId, 'wrong-password', context);
      await this.noteLockout(loginIdentifier, account.accountId, context);
      throw new AuthenticationFailedError('wrong-password');
    }

    if (!AUTHENTICABLE_STATES.includes(account.state)) {
      await this.recordFailedLogin(
        loginIdentifier,
        account.accountId,
        `state-${account.state}`,
        context,
      );
      throw new AuthenticationFailedError(`state-${account.state}`);
    }

    // The password was right: the attempt counters have served their purpose.
    await this.options.throttle.reset('loginByAccount', loginIdentifier);

    // Upgrade a hash produced by weaker parameters, now that the plaintext is available (ADR-0023).
    if (this.options.hasher.needsRehash(account.passwordHash)) {
      const rehashed = await this.options.hasher.hash(input.password);
      await this.accounts
        .updateOne({ accountId: account.accountId }, { $set: { passwordHash: rehashed } })
        .exec();
    }

    const mustUseMfa = await this.accountRequiresMfa(account.accountId);
    if (account.mfa.enabled || mustUseMfa) {
      const stage = account.mfa.enabled ? 'verify' : 'enrol';
      const challengeToken = await this.options.tokens.issueMfaChallenge({
        accountId: account.accountId,
        stage,
        attemptId: identifier('att'),
      });
      await this.options.audit.record({
        action: IDENTITY_AUDIT_ACTIONS.mfaChallengeIssued,
        outcome: 'succeeded',
        actor: { kind: 'account', accountId: account.accountId },
        target: { type: 'securityAccount', id: account.accountId },
        reason: `password accepted; second factor required (stage=${stage})`,
        context,
      });
      return {
        status: 'mfaRequired',
        stage,
        challengeToken,
        expiresIn: this.options.tokens.mfaChallengeTtlSeconds,
      };
    }

    return this.startSession(account, { mfaSatisfied: false }, input.deviceLabel, context);
  }

  private async recordFailedLogin(
    loginIdentifier: string,
    accountId: string | undefined,
    internalReason: string,
    context: RequestContext,
  ): Promise<void> {
    await this.options.audit.record({
      action: AUDIT_ACTIONS.authenticationFailed,
      outcome: 'failed',
      actor: accountId ? { kind: 'account', accountId } : { kind: 'anonymous' },
      target: { type: 'securityAccount', ...(accountId ? { id: accountId } : {}) },
      // The identifier that was tried is evidence; the password never appears anywhere.
      reason: `login failed: ${internalReason}`,
      context,
    });
  }

  /** Lockout is a throttle state with a TTL, recorded once when it engages (`SEC-019` stays separate). */
  private async noteLockout(
    loginIdentifier: string,
    accountId: string,
    context: RequestContext,
  ): Promise<void> {
    if (!(await this.options.throttle.isBlocked('loginByAccount', loginIdentifier))) return;
    await this.options.audit.record({
      action: IDENTITY_AUDIT_ACTIONS.accountLockedOut,
      outcome: 'denied',
      actor: { kind: 'account', accountId },
      target: { type: 'securityAccount', id: accountId },
      reason: 'too many failed sign-in attempts; temporary lockout',
      context,
    });
  }

  /* ---------------------------------------------------------------- sessions */

  private async startSession(
    account: SecurityAccountDocument,
    options: { mfaSatisfied: boolean },
    deviceLabel: string | undefined,
    context: RequestContext,
  ): Promise<IssuedSession> {
    const now = this.now();
    const sessionId = identifier('ses');
    const familyId = identifier('fam');
    const absoluteExpiresAt = plusSeconds(now, this.options.ttl.sessionAbsoluteSeconds);
    const session: AuthSessionDocument = {
      sessionId,
      accountId: account.accountId,
      familyId,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: plusSeconds(now, this.options.ttl.sessionIdleSeconds),
      absoluteExpiresAt,
      ...(deviceLabel ? { deviceLabel } : {}),
      ...(context.userAgent ? { client: context.userAgent } : {}),
      ...(context.ip ? { ip: context.ip } : {}),
      mfaSatisfied: options.mfaSatisfied,
      purgeAfter: new Date(absoluteExpiresAt.getTime() + SESSION_RETENTION_DAYS * DAY_MS),
    };
    await this.sessions.create(session);

    const refreshToken = await this.issueRefreshToken(session);
    const accessToken = await this.options.tokens.issueAccessToken({
      accountId: account.accountId,
      sessionId,
      credentialVersion: account.credentialVersion,
    });

    await this.accounts
      .updateOne({ accountId: account.accountId }, { $set: { lastLoginAt: now } })
      .exec();

    await this.options.audit.record({
      action: AUDIT_ACTIONS.authenticationSucceeded,
      outcome: 'succeeded',
      actor: { kind: 'account', accountId: account.accountId, sessionId },
      target: { type: 'authSession', id: sessionId },
      reason: options.mfaSatisfied ? 'password and second factor' : 'password',
      context,
    });
    await this.options.audit.record({
      action: IDENTITY_AUDIT_ACTIONS.sessionCreated,
      outcome: 'succeeded',
      actor: { kind: 'account', accountId: account.accountId, sessionId },
      target: { type: 'authSession', id: sessionId },
      context,
    });

    const fresh = await this.findByAccountId(account.accountId);
    return {
      status: 'authenticated',
      accessToken,
      expiresIn: this.options.tokens.accessTokenTtlSeconds,
      tokenType: 'Bearer',
      account: await this.toContract(fresh),
      sessionId,
      refreshToken,
      refreshTokenMaxAgeSeconds: this.options.ttl.sessionAbsoluteSeconds,
    };
  }

  private async issueRefreshToken(session: AuthSessionDocument): Promise<string> {
    const token = generateOpaqueSecret();
    const now = this.now();
    await this.refreshTokens.create({
      tokenHash: hashOpaqueSecret(token),
      sessionId: session.sessionId,
      familyId: session.familyId,
      accountId: session.accountId,
      issuedAt: now,
      expiresAt: session.absoluteExpiresAt,
      purgeAfter: new Date(session.absoluteExpiresAt.getTime() + SESSION_RETENTION_DAYS * DAY_MS),
    });
    return token;
  }

  /**
   * Rotate a refresh token (`SEC-014`) with reuse detection (`SEC-015`).
   *
   * Presenting a token that was already rotated means either a replay or a stolen copy. There is no way
   * to tell which, so the whole family dies: every session descended from that login is revoked.
   */
  async refreshSession(refreshToken: string, context: RequestContext): Promise<IssuedSession> {
    const now = this.now();
    const tokenHash = hashOpaqueSecret(refreshToken);
    const record = await this.refreshTokens.findOne({ tokenHash }).lean().exec();
    if (!record) throw new AuthenticationFailedError('refresh-token-unknown');

    if (record.usedAt) {
      await this.revokeSessions({ familyId: record.familyId }, 'reuseDetected', context);
      await this.options.audit.record({
        action: IDENTITY_AUDIT_ACTIONS.sessionReuseDetected,
        outcome: 'denied',
        actor: { kind: 'account', accountId: record.accountId, sessionId: record.sessionId },
        target: { type: 'authSession', id: record.sessionId },
        reason: 'rotated refresh token presented again; session family revoked',
        context,
      });
      throw new AuthenticationFailedError('refresh-token-reuse');
    }

    if (record.expiresAt <= now) throw new AuthenticationFailedError('refresh-token-expired');

    const session = await this.sessions.findOne({ sessionId: record.sessionId }).lean().exec();
    if (!session || session.revokedAt || session.absoluteExpiresAt <= now) {
      throw new AuthenticationFailedError('session-ended');
    }
    if (session.idleExpiresAt <= now) {
      await this.revokeSessions({ sessionId: session.sessionId }, 'logout', context);
      throw new AuthenticationFailedError('session-idle-expired');
    }

    const account = await this.accounts
      .findOne({ accountId: record.accountId })
      .lean<SecurityAccountDocument>()
      .exec();
    if (!account || !AUTHENTICABLE_STATES.includes(account.state)) {
      throw new AuthenticationFailedError('account-not-authenticable');
    }

    // Mark used first: a concurrent replay of the same token then loses the race and trips reuse
    // detection instead of both requests succeeding.
    const claimed = await this.refreshTokens
      .findOneAndUpdate(
        { tokenHash, usedAt: { $exists: false } },
        { $set: { usedAt: now } },
        { new: true },
      )
      .lean()
      .exec();
    if (!claimed) throw new AuthenticationFailedError('refresh-token-raced');

    // Rotation stays inside the same family, under the same absolute deadline.
    const nextToken = await this.issueRefreshToken(session);

    await this.sessions
      .updateOne(
        { sessionId: session.sessionId },
        {
          $set: {
            lastSeenAt: now,
            idleExpiresAt: plusSeconds(now, this.options.ttl.sessionIdleSeconds),
          },
        },
      )
      .exec();

    const accessToken = await this.options.tokens.issueAccessToken({
      accountId: account.accountId,
      sessionId: session.sessionId,
      credentialVersion: account.credentialVersion,
    });

    await this.options.audit.record({
      action: IDENTITY_AUDIT_ACTIONS.sessionRotated,
      outcome: 'succeeded',
      actor: {
        kind: 'account',
        accountId: account.accountId,
        sessionId: session.sessionId,
      },
      target: { type: 'authSession', id: session.sessionId },
      context,
    });

    return {
      status: 'authenticated',
      accessToken,
      expiresIn: this.options.tokens.accessTokenTtlSeconds,
      tokenType: 'Bearer',
      account: await this.toContract(account),
      sessionId: session.sessionId,
      refreshToken: nextToken,
      refreshTokenMaxAgeSeconds: Math.max(
        1,
        Math.ceil((session.absoluteExpiresAt.getTime() - now.getTime()) / 1000),
      ),
    };
  }

  /**
   * Revoke sessions matching a filter and invalidate their refresh tokens (`SEC-018`, `SEC-020`).
   * Returns how many were ended, which is what the caller reports and what the audit record states.
   */
  private async revokeSessions(
    filter: { accountId?: string; sessionId?: string; familyId?: string; exceptSessionId?: string },
    reason: SessionRevocationReason,
    context: RequestContext,
    actor?: ActorContext,
  ): Promise<number> {
    const now = this.now();
    const query: Record<string, unknown> = { revokedAt: { $exists: false } };
    if (filter.accountId) query['accountId'] = filter.accountId;
    if (filter.familyId) query['familyId'] = filter.familyId;
    if (filter.sessionId) query['sessionId'] = filter.sessionId;
    if (filter.exceptSessionId) query['sessionId'] = { $ne: filter.exceptSessionId };

    const affected = await this.sessions.find(query).lean<AuthSessionDocument[]>().exec();
    if (affected.length === 0) return 0;

    const sessionIds = affected.map((session) => session.sessionId);
    await this.sessions
      .updateMany(
        { sessionId: { $in: sessionIds } },
        { $set: { revokedAt: now, revocationReason: reason } },
      )
      .exec();
    // Outstanding refresh tokens die with the session; marking them used makes a later attempt a
    // detectable reuse rather than a silent failure.
    await this.refreshTokens
      .updateMany(
        { sessionId: { $in: sessionIds }, usedAt: { $exists: false } },
        { $set: { usedAt: now } },
      )
      .exec();

    for (const session of affected) {
      await this.options.audit.record({
        action: IDENTITY_AUDIT_ACTIONS.sessionRevoked,
        outcome: 'succeeded',
        actor: actor
          ? this.auditActor(actor)
          : { kind: 'account', accountId: session.accountId, sessionId: session.sessionId },
        target: { type: 'authSession', id: session.sessionId },
        reason: `revoked: ${reason}`,
        context,
      });
    }
    return affected.length;
  }

  async logout(actor: ActorContext, context: RequestContext): Promise<void> {
    if (actor.sessionId) {
      await this.revokeSessions({ sessionId: actor.sessionId }, 'logout', context, actor);
    }
    await this.options.audit.record({
      action: AUDIT_ACTIONS.authenticationLoggedOut,
      outcome: 'succeeded',
      actor: this.auditActor(actor),
      target: { type: 'authSession', ...(actor.sessionId ? { id: actor.sessionId } : {}) },
      context,
    });
  }

  async listSessions(accountId: string, currentSessionId?: string): Promise<SessionSummary[]> {
    const now = this.now();
    const documents = await this.sessions
      .find({
        accountId,
        revokedAt: { $exists: false },
        absoluteExpiresAt: { $gt: now },
        idleExpiresAt: { $gt: now },
      })
      .sort({ createdAt: -1 })
      .lean<AuthSessionDocument[]>()
      .exec();
    return documents.map((document) => this.toSessionSummary(document, currentSessionId));
  }

  /**
   * Revoke one session (`SEC-018`). `ownerAccountId` is checked in the query, so another account's
   * session is simply not found — the same answer as a session that does not exist (`SEC-030`).
   */
  async revokeSession(
    actor: ActorContext,
    sessionId: string,
    context: RequestContext,
    options: { ownerAccountId?: string } = {},
  ): Promise<void> {
    const query: Record<string, unknown> = { sessionId };
    if (options.ownerAccountId) query['accountId'] = options.ownerAccountId;
    const session = await this.sessions.findOne(query).lean<AuthSessionDocument>().exec();
    if (!session) throw new AccountNotFoundError();
    const reason: SessionRevocationReason = options.ownerAccountId
      ? 'revokedByOwner'
      : 'revokedByAdministrator';
    await this.revokeSessions({ sessionId }, reason, context, actor);
  }

  /** Bulk revocation (`SEC-018`): every session of an account except, optionally, the current one. */
  async revokeAllSessions(
    actor: ActorContext,
    accountId: string,
    context: RequestContext,
    options: { exceptSessionId?: string } = {},
  ): Promise<number> {
    return this.revokeSessions(
      {
        accountId,
        ...(options.exceptSessionId ? { exceptSessionId: options.exceptSessionId } : {}),
      },
      actor.accountId === accountId ? 'revokedByOwner' : 'revokedByAdministrator',
      context,
      actor,
    );
  }

  /**
   * Turn an access token into an actor (`SEC-020`, ADR-0022).
   *
   * The signature is necessary but never sufficient: the session must still exist and be live, the
   * account must still be active, and the token's credential generation must still match the account's.
   * That last check is what makes a password change end other sessions' access immediately, even for an
   * access token that has not yet expired.
   */
  async resolveSession(accessToken: string): Promise<ResolvedSession | undefined> {
    const claims = await this.options.tokens.verifyAccessToken(accessToken);
    const now = this.now();

    const session = await this.sessions
      .findOne({ sessionId: claims.sessionId })
      .lean<AuthSessionDocument>()
      .exec();
    if (!session || session.revokedAt) return undefined;
    if (session.absoluteExpiresAt <= now || session.idleExpiresAt <= now) return undefined;
    if (session.accountId !== claims.accountId) return undefined;

    const account = await this.accounts
      .findOne({ accountId: claims.accountId })
      .lean<SecurityAccountDocument>()
      .exec();
    if (!account || !AUTHENTICABLE_STATES.includes(account.state)) return undefined;
    if (account.credentialVersion !== claims.credentialVersion) return undefined;

    // A privileged account whose session never completed a second factor does not get that session's
    // authority, whatever the token says.
    if (!session.mfaSatisfied && (await this.accountRequiresMfa(account.accountId))) {
      return undefined;
    }

    if (now.getTime() - session.lastSeenAt.getTime() > LAST_SEEN_WRITE_INTERVAL_SECONDS * 1000) {
      await this.sessions
        .updateOne(
          { sessionId: session.sessionId },
          {
            $set: {
              lastSeenAt: now,
              idleExpiresAt: plusSeconds(now, this.options.ttl.sessionIdleSeconds),
            },
          },
        )
        .exec();
    }

    const grants = await this.options.resolveGrants(account.accountId);
    // An account with no grant is authenticated and authorized for nothing: it must see 403, not 401.
    const actor: ActorContext = grants
      ? { ...grants, sessionId: session.sessionId }
      : {
          accountId: account.accountId,
          kind: 'account',
          roleKeys: [],
          permissions: [],
          deniedPermissions: [],
          scope: {
            level: 'self',
            teamIds: [],
            departmentIds: [],
            branchIds: [],
            projectIds: [],
            legalEntityIds: [],
          },
          grantVersion: 0,
          sessionId: session.sessionId,
        };
    return { actor, session };
  }

  /* ---------------------------------------------------------------- passwords */

  /** Changing a password bumps the credential generation and ends every other session (`SEC-020`). */
  async changePassword(
    actor: ActorContext,
    input: { currentPassword: string; newPassword: string },
    context: RequestContext,
  ): Promise<void> {
    const account = await this.findByAccountId(actor.accountId);
    if (
      !account.passwordHash ||
      !(await this.options.hasher.verify(account.passwordHash, input.currentPassword))
    ) {
      await this.options.audit.record({
        action: IDENTITY_AUDIT_ACTIONS.passwordChanged,
        outcome: 'denied',
        actor: this.auditActor(actor),
        target: { type: 'securityAccount', id: actor.accountId },
        reason: 'current password did not match',
        context,
      });
      throw new ReauthenticationRequiredError();
    }
    await this.setPassword(account, input.newPassword, 'passwordChanged', context, actor);
  }

  private async setPassword(
    account: SecurityAccountDocument,
    newPassword: string,
    reason: 'passwordChanged' | 'passwordReset',
    context: RequestContext,
    actor?: ActorContext,
  ): Promise<void> {
    const passwordHash = await this.options.hasher.hashNewPassword(
      newPassword,
      account.loginIdentifier,
    );
    const now = this.now();
    await this.accounts
      .updateOne(
        { accountId: account.accountId },
        {
          $set: {
            passwordHash,
            passwordUpdatedAt: now,
            updatedAt: now,
            updatedBy: actor?.accountId ?? account.accountId,
          },
          $inc: { version: 1, credentialVersion: 1 },
        },
      )
      .exec();

    // SEC-020: every session created under the old credential ends, including the current one.
    await this.revokeSessions(
      { accountId: account.accountId },
      reason === 'passwordChanged' ? 'passwordChanged' : 'passwordReset',
      context,
      actor,
    );

    await this.options.audit.record({
      action:
        reason === 'passwordChanged'
          ? IDENTITY_AUDIT_ACTIONS.passwordChanged
          : IDENTITY_AUDIT_ACTIONS.passwordResetCompleted,
      outcome: 'succeeded',
      actor: actor ? this.auditActor(actor) : { kind: 'account', accountId: account.accountId },
      target: { type: 'securityAccount', id: account.accountId },
      // The change is recorded; no password material of any kind is.
      changes: [{ path: 'passwordHash', from: '[redacted]', to: '[redacted]' }],
      context,
    });
  }

  /**
   * Start a password reset (`SEC-016`). The answer is the same whether or not the identifier exists, and
   * the work done is similar, so this endpoint cannot be used to enumerate accounts. When an account does
   * exist, the token is returned to the **caller of this method** — the router never puts it in a
   * response body; delivery is `CORE-NOTIFY`.
   */
  async requestPasswordReset(
    loginIdentifier: string,
    context: RequestContext,
  ): Promise<{ token: string; accountId: string } | undefined> {
    const normalized = normalizeLoginIdentifier(loginIdentifier);
    await this.options.throttle.consume('passwordResetByIp', context.ip ?? 'unknown-ip');
    await this.options.throttle.consume('passwordResetByAccount', normalized);

    const account = await this.accounts
      .findOne({ loginIdentifier: normalized })
      .lean<SecurityAccountDocument>()
      .exec();

    await this.options.audit.record({
      action: IDENTITY_AUDIT_ACTIONS.passwordResetRequested,
      outcome: 'succeeded',
      actor: account ? { kind: 'account', accountId: account.accountId } : { kind: 'anonymous' },
      target: { type: 'securityAccount', ...(account ? { id: account.accountId } : {}) },
      reason: account ? 'reset token issued' : 'no account for identifier',
      context,
    });

    if (!account || account.state === 'terminated') return undefined;
    const { token } = await this.issueAccountToken(
      account.accountId,
      'passwordReset',
      this.options.ttl.passwordResetSeconds,
    );
    return { token, accountId: account.accountId };
  }

  async completePasswordReset(
    token: string,
    password: string,
    context: RequestContext,
  ): Promise<void> {
    const consumed = await this.consumeAccountToken(token, 'passwordReset');
    const account = await this.findByAccountId(consumed.accountId);
    if (account.state === 'terminated') throw new AccountConflictError('state');
    await this.setPassword(account, password, 'passwordReset', context);
  }

  /* --------------------------------------------------------------------- MFA */

  /**
   * Begin enrolment (`SEC-017`). The secret and the recovery codes are returned **once**; the secret is
   * stored encrypted as *pending* and cannot authenticate anything until a code from it is confirmed.
   */
  async startMfaEnrolment(
    accountId: string,
    context: RequestContext,
  ): Promise<{ secret: string; otpauthUri: string; recoveryCodes: string[] }> {
    const account = await this.findByAccountId(accountId);
    if (account.mfa.enabled) throw new MfaStateError('already-enabled');

    const enrolment = createTotpEnrolment(this.options.totpIssuer, account.loginIdentifier);
    const recoveryCodes = generateRecoveryCodes();
    const hashes = await Promise.all(
      recoveryCodes.map((code) => this.options.hasher.hash(normalizeRecoveryCode(code))),
    );

    await this.accounts
      .updateOne(
        { accountId },
        {
          $set: {
            'mfa.pendingSecret': await this.encryptSecret(accountId, enrolment.secret),
            'mfa.recoveryCodes': hashes.map((hash) => ({ hash })),
            updatedAt: this.now(),
          },
          $inc: { version: 1 },
        },
      )
      .exec();

    await this.options.audit.record({
      action: IDENTITY_AUDIT_ACTIONS.mfaEnrolmentStarted,
      outcome: 'succeeded',
      actor: { kind: 'account', accountId },
      target: { type: 'securityAccount', id: accountId },
      // No secret, no URI, no recovery code: only the fact and the count.
      reason: `enrolment started; ${recoveryCodes.length} recovery codes issued`,
      context,
    });

    return { ...enrolment, recoveryCodes };
  }

  /** Confirm enrolment with a live code, which is what proves the authenticator was really set up. */
  async confirmMfaEnrolment(
    accountId: string,
    code: string,
    context: RequestContext,
  ): Promise<void> {
    const account = await this.findByAccountId(accountId);
    if (account.mfa.enabled) throw new MfaStateError('already-enabled');
    if (!account.mfa.pendingSecret) throw new MfaStateError('not-enrolling');

    await this.options.throttle.consume('mfaByAccount', accountId);
    const secret = await this.decryptSecret(accountId, account.mfa.pendingSecret);
    const result = verifyTotp({
      secret,
      code,
      issuer: this.options.totpIssuer,
      label: account.loginIdentifier,
      now: this.now(),
    });
    if (!result.valid) {
      await this.recordMfaFailure(accountId, 'enrolment code rejected', context);
      throw new AuthenticationFailedError('mfa-enrolment-code-invalid');
    }

    await this.accounts
      .updateOne(
        { accountId },
        {
          $set: {
            'mfa.enabled': true,
            'mfa.secret': account.mfa.pendingSecret,
            'mfa.enabledAt': this.now(),
            'mfa.lastAcceptedStep': result.step,
            updatedAt: this.now(),
          },
          $unset: { 'mfa.pendingSecret': '' },
          $inc: { version: 1 },
        },
      )
      .exec();

    await this.options.audit.record({
      action: IDENTITY_AUDIT_ACTIONS.mfaEnabled,
      outcome: 'succeeded',
      actor: { kind: 'account', accountId },
      target: { type: 'securityAccount', id: accountId },
      changes: [{ path: 'mfa.enabled', from: 'false', to: 'true' }],
      context,
    });
    await this.options.throttle.reset('mfaByAccount', accountId);
  }

  /** Complete a login challenge with a TOTP code or a recovery code (`SEC-017`). */
  async verifyMfaChallenge(
    challengeToken: string,
    code: string,
    deviceLabel: string | undefined,
    context: RequestContext,
  ): Promise<IssuedSession> {
    const claims = await this.options.tokens.verifyMfaChallenge(challengeToken);
    if (claims.stage !== 'verify') throw new AuthenticationFailedError('mfa-stage-mismatch');

    const account = await this.findByAccountId(claims.accountId);
    if (!AUTHENTICABLE_STATES.includes(account.state)) {
      throw new AuthenticationFailedError(`state-${account.state}`);
    }
    if (!account.mfa.enabled || !account.mfa.secret) throw new MfaStateError('not-enabled');

    await this.options.throttle.consume('mfaByAccount', account.accountId);

    if (looksLikeRecoveryCode(code)) {
      await this.consumeRecoveryCode(account, code, context);
    } else {
      const secret = await this.decryptSecret(account.accountId, account.mfa.secret);
      const result = verifyTotp({
        secret,
        code,
        issuer: this.options.totpIssuer,
        label: account.loginIdentifier,
        ...(account.mfa.lastAcceptedStep !== undefined
          ? { lastAcceptedStep: account.mfa.lastAcceptedStep }
          : {}),
        now: this.now(),
      });
      if (!result.valid) {
        await this.recordMfaFailure(account.accountId, 'code rejected or replayed', context);
        throw new AuthenticationFailedError('mfa-code-invalid');
      }
      // Remember the step so the same code cannot be presented again inside the drift window.
      await this.accounts
        .updateOne(
          { accountId: account.accountId },
          { $set: { 'mfa.lastAcceptedStep': result.step } },
        )
        .exec();
    }

    await this.options.throttle.reset('mfaByAccount', account.accountId);
    await this.options.throttle.reset('loginByAccount', account.loginIdentifier);
    return this.startSession(account, { mfaSatisfied: true }, deviceLabel, context);
  }

  /** Recovery codes are single use: the matching hash is marked consumed before the session is issued. */
  private async consumeRecoveryCode(
    account: SecurityAccountDocument,
    code: string,
    context: RequestContext,
  ): Promise<void> {
    const normalized = normalizeRecoveryCode(code);
    for (const [index, stored] of account.mfa.recoveryCodes.entries()) {
      if (stored.usedAt) continue;
      if (!(await this.options.hasher.verify(stored.hash, normalized))) continue;
      const claimed = await this.accounts
        .updateOne(
          {
            accountId: account.accountId,
            [`mfa.recoveryCodes.${index}.usedAt`]: { $exists: false },
          },
          { $set: { [`mfa.recoveryCodes.${index}.usedAt`]: this.now() } },
        )
        .exec();
      if (claimed.modifiedCount !== 1) break;
      await this.options.audit.record({
        action: IDENTITY_AUDIT_ACTIONS.mfaRecoveryCodeUsed,
        outcome: 'succeeded',
        actor: { kind: 'account', accountId: account.accountId },
        target: { type: 'securityAccount', id: account.accountId },
        reason: `recovery code consumed; ${
          account.mfa.recoveryCodes.filter((entry) => !entry.usedAt).length - 1
        } remaining`,
        context,
      });
      return;
    }
    await this.recordMfaFailure(account.accountId, 'recovery code rejected', context);
    throw new AuthenticationFailedError('mfa-recovery-code-invalid');
  }

  private async recordMfaFailure(
    accountId: string,
    reason: string,
    context: RequestContext,
  ): Promise<void> {
    await this.options.audit.record({
      action: IDENTITY_AUDIT_ACTIONS.mfaFailed,
      outcome: 'failed',
      actor: { kind: 'account', accountId },
      target: { type: 'securityAccount', id: accountId },
      reason,
      context,
    });
  }

  /** Disabling a second factor requires the password again, and ends every session. */
  async disableMfa(
    actor: ActorContext,
    currentPassword: string,
    context: RequestContext,
  ): Promise<void> {
    const account = await this.findByAccountId(actor.accountId);
    if (!account.mfa.enabled) throw new MfaStateError('not-enabled');
    if (
      !account.passwordHash ||
      !(await this.options.hasher.verify(account.passwordHash, currentPassword))
    ) {
      throw new ReauthenticationRequiredError();
    }
    await this.clearMfa(account.accountId, context, actor, 'disabled by the account holder');
  }

  /**
   * Administrative MFA reset (`SEC-017` recovery). A separate, administrative permission, because it is
   * the obvious way to walk around someone else's second factor — and every use is audited.
   */
  async resetMfaAsAdministrator(
    actor: ActorContext,
    accountId: string,
    context: RequestContext,
  ): Promise<void> {
    // Otherwise an administrator could drop their own second factor without re-entering a password.
    await this.assertNotSelfAdministration(actor, accountId, 'mfa reset', context);
    const account = await this.findByAccountId(accountId);
    if (!account.mfa.enabled && !account.mfa.pendingSecret) throw new MfaStateError('not-enabled');
    await this.clearMfa(accountId, context, actor, 'reset by an administrator');
  }

  private async clearMfa(
    accountId: string,
    context: RequestContext,
    actor: ActorContext,
    reason: string,
  ): Promise<void> {
    await this.accounts
      .updateOne(
        { accountId },
        {
          $set: { 'mfa.enabled': false, 'mfa.recoveryCodes': [], updatedAt: this.now() },
          $unset: {
            'mfa.secret': '',
            'mfa.pendingSecret': '',
            'mfa.lastAcceptedStep': '',
            'mfa.enabledAt': '',
          },
          $inc: { version: 1 },
        },
      )
      .exec();
    await this.revokeSessions({ accountId }, 'mfaDisabled', context, actor);
    await this.options.audit.record({
      action: IDENTITY_AUDIT_ACTIONS.mfaDisabled,
      outcome: 'succeeded',
      actor: this.auditActor(actor),
      target: { type: 'securityAccount', id: accountId },
      changes: [{ path: 'mfa.enabled', from: 'true', to: 'false' }],
      reason,
      context,
    });
  }

  /**
   * The account a login challenge names. The token is signed and single-purpose, so this cannot be used
   * to act on any other account — and a `verify` token cannot be presented where `enrol` is required.
   */
  async accountIdFromChallenge(challengeToken: string, stage: 'verify' | 'enrol'): Promise<string> {
    const claims = await this.options.tokens.verifyMfaChallenge(challengeToken);
    if (claims.stage !== stage) throw new AuthenticationFailedError('mfa-stage-mismatch');
    return claims.accountId;
  }

  /**
   * Finish a sign-in that required enrolling a second factor first. Called only after
   * `confirmMfaEnrolment` has accepted a live code, which is what makes the factor satisfied.
   */
  async completeEnrolmentLogin(
    accountId: string,
    deviceLabel: string | undefined,
    context: RequestContext,
  ): Promise<IssuedSession> {
    const account = await this.findByAccountId(accountId);
    if (!AUTHENTICABLE_STATES.includes(account.state)) {
      throw new AuthenticationFailedError(`state-${account.state}`);
    }
    if (!account.mfa.enabled) throw new MfaStateError('not-enabled');
    return this.startSession(account, { mfaSatisfied: true }, deviceLabel, context);
  }

  /**
   * Administrative password reset (`SEC-016`). The token is handed to the administrator to deliver out of
   * band; it is single-use and short-lived, and issuing it is audited. It does **not** set a password and
   * does not reveal the current one — nobody, including an administrator, can read a password here.
   */
  async issueAdministrativePasswordReset(
    actor: ActorContext,
    accountId: string,
    context: RequestContext,
  ): Promise<{ token: string; expiresAt: Date }> {
    // A self-issued reset would let a hijacked session set a new password without knowing the old one.
    await this.assertNotSelfAdministration(actor, accountId, 'password reset', context);
    const account = await this.findByAccountId(accountId);
    if (account.state === 'terminated') throw new AccountConflictError('state');
    const issued = await this.issueAccountToken(
      accountId,
      'passwordReset',
      this.options.ttl.passwordResetSeconds,
    );
    await this.options.audit.record({
      action: IDENTITY_AUDIT_ACTIONS.passwordResetRequested,
      outcome: 'succeeded',
      actor: this.auditActor(actor),
      target: { type: 'securityAccount', id: accountId },
      reason: 'reset token issued by an administrator',
      context,
    });
    return issued;
  }

  /* --------------------------------------------------------------- bootstrap */

  /**
   * Create the very first account (`SEC-011`).
   *
   * Deliberately awkward: it refuses once any account exists, it sets **no** password, and it produces an
   * activation token the operator must use. There is no default administrator and no hard-coded
   * credential anywhere in the repository — the first password is chosen by the first human, once.
   *
   * It is called by `scripts/bootstrap-admin.ts`, never from an HTTP route.
   */
  async createBootstrapAccount(
    input: { loginIdentifier: string; displayName: string },
    context: RequestContext,
  ): Promise<{ account: SecurityAccount; activationToken: string; activationExpiresAt: Date }> {
    if ((await this.accounts.countDocuments({}).exec()) > 0) {
      throw new BootstrapNotPermittedError();
    }
    const systemActor: ActorContext = {
      accountId: 'system:bootstrap',
      kind: 'system',
      roleKeys: [],
      permissions: [],
      deniedPermissions: [],
      scope: {
        level: 'all',
        teamIds: [],
        departmentIds: [],
        branchIds: [],
        projectIds: [],
        legalEntityIds: [],
      },
      grantVersion: 0,
    };
    // The bootstrap path is the one place with no authenticated actor; it is recorded as `system`.
    return this.createAccount(systemActor, { ...input, personalAccountAttested: true }, context);
  }
}
