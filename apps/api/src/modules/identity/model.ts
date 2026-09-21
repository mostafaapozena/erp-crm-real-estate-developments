import { ACCOUNT_STATES, SESSION_REVOCATION_REASONS } from '@alola/contracts';
import { Schema, type Connection, type Model } from 'mongoose';

/**
 * Identity storage (`SEC-011` … `SEC-022`).
 *
 * Four collections, each with one job:
 *
 * - `securityAccounts` — credentials, lifecycle state, and the second factor. It holds an **opaque**
 *   employee reference and nothing else about employment: employee records are `HR-EMP` and organization
 *   structure is `CORE-ORG` (ADR-0019). No account is ever deleted (ADR-0009); `terminated` is the end
 *   state, because deleting one would orphan every audit record naming it.
 * - `authSessions` — one row per signed-in device, with idle and absolute expiry and a revocation reason.
 *   Persisted in MongoDB rather than only in Redis so that revocation is durable and explainable after
 *   the fact; Redis carries throttling counters, which are the part that may safely evaporate.
 * - `authRefreshTokens` — the rotation chain. Only a SHA-256 digest is stored, and a *used* row is kept
 *   precisely so that presenting it again is detectable (`SEC-015`).
 * - `accountTokens` — single-use activation and password-reset tokens, digest only.
 */
export const ACCOUNTS_COLLECTION = 'securityAccounts';
export const SESSIONS_COLLECTION = 'authSessions';
export const REFRESH_TOKENS_COLLECTION = 'authRefreshTokens';
export const ACCOUNT_TOKENS_COLLECTION = 'accountTokens';

/** Mirrors `EncryptedValue` from `@alola/security`; stored, never logged, never serialized. */
export interface StoredEncryptedValue {
  algorithm: string;
  keyRef: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export interface StoredRecoveryCode {
  /** Argon2id hash of one recovery code. Independent per code, so one leak is one code. */
  hash: string;
  usedAt?: Date;
}

export interface AccountMfa {
  enabled: boolean;
  /** Confirmed secret. Encrypted at rest (`SEC-017`). */
  secret?: StoredEncryptedValue;
  /** Enrolment in progress: not yet usable for sign-in, so an abandoned enrolment locks nobody out. */
  pendingSecret?: StoredEncryptedValue;
  /** Highest accepted TOTP step, so a code cannot be presented twice within its window. */
  lastAcceptedStep?: number;
  recoveryCodes: StoredRecoveryCode[];
  enabledAt?: Date;
}

export interface SecurityAccountDocument {
  accountId: string;
  loginIdentifier: string;
  displayName: string;
  state: (typeof ACCOUNT_STATES)[number];
  employeeRef?: string;
  /** Argon2id PHC string. Never returned by any endpoint and never placed in an audit record. */
  passwordHash?: string;
  passwordUpdatedAt?: Date;
  /** Bumped by every credential change; invalidates access tokens already issued (`SEC-020`). */
  credentialVersion: number;
  mfa: AccountMfa;
  lastLoginAt?: Date;
  suspendedAt?: Date;
  suspensionReason?: string;
  terminatedAt?: Date;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
}

export interface AuthSessionDocument {
  sessionId: string;
  accountId: string;
  familyId: string;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt?: Date;
  revocationReason?: (typeof SESSION_REVOCATION_REASONS)[number];
  deviceLabel?: string;
  /** Coarse client summary, derived from the user agent. The raw header is never stored. */
  client?: string;
  ip?: string;
  mfaSatisfied: boolean;
  /** Retention boundary for the row itself; the audit trail is separate and permanent. */
  purgeAfter: Date;
}

export interface AuthRefreshTokenDocument {
  tokenHash: string;
  sessionId: string;
  familyId: string;
  accountId: string;
  issuedAt: Date;
  expiresAt: Date;
  usedAt?: Date;
  purgeAfter: Date;
}

export interface AccountTokenDocument {
  tokenHash: string;
  accountId: string;
  purpose: 'activation' | 'passwordReset';
  createdAt: Date;
  expiresAt: Date;
  usedAt?: Date;
  purgeAfter: Date;
}

const encryptedValueSchema = new Schema(
  {
    algorithm: { type: String, required: true },
    keyRef: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    ciphertext: { type: String, required: true },
  },
  { _id: false },
);

const recoveryCodeSchema = new Schema(
  { hash: { type: String, required: true }, usedAt: { type: Date } },
  { _id: false },
);

const mfaSchema = new Schema(
  {
    enabled: { type: Boolean, required: true, default: false },
    secret: { type: encryptedValueSchema },
    pendingSecret: { type: encryptedValueSchema },
    lastAcceptedStep: { type: Number },
    recoveryCodes: { type: [recoveryCodeSchema], required: true, default: [] },
    enabledAt: { type: Date },
  },
  { _id: false },
);

function accountSchema(): Schema<SecurityAccountDocument> {
  const schema = new Schema<SecurityAccountDocument>(
    {
      accountId: { type: String, required: true, immutable: true },
      loginIdentifier: { type: String, required: true },
      displayName: { type: String, required: true },
      state: { type: String, required: true, enum: [...ACCOUNT_STATES] },
      employeeRef: { type: String },
      passwordHash: { type: String },
      passwordUpdatedAt: { type: Date },
      credentialVersion: { type: Number, required: true },
      mfa: { type: mfaSchema, required: true },
      lastLoginAt: { type: Date },
      suspendedAt: { type: Date },
      suspensionReason: { type: String },
      terminatedAt: { type: Date },
      version: { type: Number, required: true },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
      createdBy: { type: String, required: true, immutable: true },
      updatedBy: { type: String, required: true },
    },
    { collection: ACCOUNTS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );

  schema.index({ accountId: 1 }, { unique: true, name: 'accounts_accountId_unique' });
  // The normalized identifier is the login key, so uniqueness here is what stops two accounts for one
  // person — and therefore what makes `SEC-022` mechanical rather than a matter of discipline.
  schema.index({ loginIdentifier: 1 }, { unique: true, name: 'accounts_loginIdentifier_unique' });
  /**
   * One live account per employee (`SEC-022`). Partial, so a terminated account does not block the
   * replacement account a rehired person needs — and so history is never deleted to make room.
   */
  schema.index(
    { employeeRef: 1 },
    {
      unique: true,
      name: 'accounts_employeeRef_live_unique',
      partialFilterExpression: {
        employeeRef: { $exists: true },
        state: { $in: ['invited', 'active', 'suspended'] },
      },
    },
  );
  schema.index({ state: 1, createdAt: -1 }, { name: 'accounts_state_createdAt' });
  return schema;
}

function sessionSchema(): Schema<AuthSessionDocument> {
  const schema = new Schema<AuthSessionDocument>(
    {
      sessionId: { type: String, required: true, immutable: true },
      accountId: { type: String, required: true, immutable: true },
      familyId: { type: String, required: true, immutable: true },
      createdAt: { type: Date, required: true, immutable: true },
      lastSeenAt: { type: Date, required: true },
      idleExpiresAt: { type: Date, required: true },
      absoluteExpiresAt: { type: Date, required: true, immutable: true },
      revokedAt: { type: Date },
      revocationReason: { type: String, enum: [...SESSION_REVOCATION_REASONS] },
      deviceLabel: { type: String },
      client: { type: String },
      ip: { type: String },
      mfaSatisfied: { type: Boolean, required: true },
      purgeAfter: { type: Date, required: true },
    },
    { collection: SESSIONS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );

  schema.index({ sessionId: 1 }, { unique: true, name: 'sessions_sessionId_unique' });
  // "Every session for this account", used by the session list and by every bulk revocation.
  schema.index({ accountId: 1, createdAt: -1 }, { name: 'sessions_accountId_createdAt' });
  schema.index({ familyId: 1 }, { name: 'sessions_familyId' });
  // Expired rows are removed by MongoDB; the audit record of the session is permanent and elsewhere.
  schema.index({ purgeAfter: 1 }, { expireAfterSeconds: 0, name: 'sessions_ttl' });
  return schema;
}

function refreshTokenSchema(): Schema<AuthRefreshTokenDocument> {
  const schema = new Schema<AuthRefreshTokenDocument>(
    {
      tokenHash: { type: String, required: true, immutable: true },
      sessionId: { type: String, required: true, immutable: true },
      familyId: { type: String, required: true, immutable: true },
      accountId: { type: String, required: true, immutable: true },
      issuedAt: { type: Date, required: true, immutable: true },
      expiresAt: { type: Date, required: true, immutable: true },
      usedAt: { type: Date },
      purgeAfter: { type: Date, required: true },
    },
    {
      collection: REFRESH_TOKENS_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
    },
  );

  schema.index({ tokenHash: 1 }, { unique: true, name: 'refreshTokens_tokenHash_unique' });
  schema.index({ familyId: 1, issuedAt: -1 }, { name: 'refreshTokens_familyId_issuedAt' });
  schema.index({ sessionId: 1 }, { name: 'refreshTokens_sessionId' });
  schema.index({ purgeAfter: 1 }, { expireAfterSeconds: 0, name: 'refreshTokens_ttl' });
  return schema;
}

function accountTokenSchema(): Schema<AccountTokenDocument> {
  const schema = new Schema<AccountTokenDocument>(
    {
      tokenHash: { type: String, required: true, immutable: true },
      accountId: { type: String, required: true, immutable: true },
      purpose: { type: String, required: true, enum: ['activation', 'passwordReset'] },
      createdAt: { type: Date, required: true, immutable: true },
      expiresAt: { type: Date, required: true, immutable: true },
      usedAt: { type: Date },
      purgeAfter: { type: Date, required: true },
    },
    {
      collection: ACCOUNT_TOKENS_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
    },
  );

  schema.index({ tokenHash: 1 }, { unique: true, name: 'accountTokens_tokenHash_unique' });
  schema.index({ accountId: 1, purpose: 1 }, { name: 'accountTokens_accountId_purpose' });
  schema.index({ purgeAfter: 1 }, { expireAfterSeconds: 0, name: 'accountTokens_ttl' });
  return schema;
}

function model<T>(connection: Connection, name: string, build: () => Schema<T>): Model<T> {
  return (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, build());
}

export function accountModel(connection: Connection): Model<SecurityAccountDocument> {
  return model(connection, ACCOUNTS_COLLECTION, accountSchema);
}

export function sessionModel(connection: Connection): Model<AuthSessionDocument> {
  return model(connection, SESSIONS_COLLECTION, sessionSchema);
}

export function refreshTokenModel(connection: Connection): Model<AuthRefreshTokenDocument> {
  return model(connection, REFRESH_TOKENS_COLLECTION, refreshTokenSchema);
}

export function accountTokenModel(connection: Connection): Model<AccountTokenDocument> {
  return model(connection, ACCOUNT_TOKENS_COLLECTION, accountTokenSchema);
}
