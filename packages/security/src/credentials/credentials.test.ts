import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { DevKeyEncryptor } from '../encryption';
import {
  createTotpEnrolment,
  currentTotpCode,
  generateRecoveryCodes,
  looksLikeRecoveryCode,
  normalizeRecoveryCode,
  verifyTotp,
} from './mfa';
import { DEFAULT_ARGON2_PARAMETERS, PasswordHasher, PasswordPolicyError } from './passwords';
import {
  InvalidAccessTokenError,
  TokenIssuer,
  generateOpaqueSecret,
  hashOpaqueSecret,
  timingSafeEquals,
} from './tokens';

/**
 * Credential primitives (`SEC-013`, `SEC-014`, `SEC-015`, `SEC-017`, ADR-0023).
 *
 * The parameters are deliberately the lowest permitted values here: these tests hash many passwords, and
 * the property being checked is the behaviour, not the cost.
 */
const hasher = new PasswordHasher(DEFAULT_ARGON2_PARAMETERS);
const PASSPHRASE = 'seven-blue-harbour-lanterns';

describe('password hashing (SEC-013)', () => {
  it('produces an Argon2id PHC string carrying the configured parameters', async () => {
    const stored = await hasher.hashNewPassword(PASSPHRASE);
    // The algorithm is asserted, not assumed: the library takes it as a numeric variant.
    expect(stored.startsWith('$argon2id$')).toBe(true);
    expect(stored).toContain(`m=${DEFAULT_ARGON2_PARAMETERS.memoryCost}`);
    expect(stored).toContain(`t=${DEFAULT_ARGON2_PARAMETERS.timeCost}`);
    expect(stored).toContain(`p=${DEFAULT_ARGON2_PARAMETERS.parallelism}`);
    // Never the password, in any form.
    expect(stored).not.toContain(PASSPHRASE);
  });

  it('salts every hash, so the same password stores differently each time', async () => {
    const [first, second] = await Promise.all([hasher.hash(PASSPHRASE), hasher.hash(PASSPHRASE)]);
    expect(first).not.toBe(second);
    expect(await hasher.verify(first, PASSPHRASE)).toBe(true);
    expect(await hasher.verify(second, PASSPHRASE)).toBe(true);
  });

  it('verifies the right password and refuses everything else', async () => {
    const stored = await hasher.hash(PASSPHRASE);
    expect(await hasher.verify(stored, PASSPHRASE)).toBe(true);
    expect(await hasher.verify(stored, `${PASSPHRASE} `)).toBe(false);
    expect(await hasher.verify(stored, PASSPHRASE.toUpperCase())).toBe(false);
    expect(await hasher.verify(stored, '')).toBe(false);
  });

  it('never trims or normalizes the password it is given', async () => {
    // Trimming would silently accept a different password than the one chosen.
    const padded = `  ${PASSPHRASE}  `;
    const stored = await hasher.hash(padded);
    expect(await hasher.verify(stored, padded)).toBe(true);
    expect(await hasher.verify(stored, PASSPHRASE)).toBe(false);
  });

  it('treats a malformed stored value as a failed verification, not a crash', async () => {
    expect(await hasher.verify('not-a-hash', PASSPHRASE)).toBe(false);
    expect(await hasher.verify('', PASSPHRASE)).toBe(false);
  });

  it('spends work on an unknown account and still answers false', async () => {
    expect(await hasher.verifyDummy(PASSPHRASE)).toBe(false);
  });

  it('flags a hash made with weaker parameters, or another algorithm, for rehashing', async () => {
    const current = await hasher.hash(PASSPHRASE);
    expect(hasher.needsRehash(current)).toBe(false);

    const weaker = new PasswordHasher({ memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    const stronger = new PasswordHasher({ memoryCost: 47_104, timeCost: 3, parallelism: 1 });
    expect(stronger.needsRehash(await weaker.hash(PASSPHRASE))).toBe(true);
    // A bcrypt or argon2i value is upgraded too.
    expect(hasher.needsRehash('$2b$12$abcdefghijklmnopqrstuv')).toBe(true);
    expect(hasher.needsRehash('$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$ZGlnZXN0')).toBe(true);
  });

  it('describes its parameters without exposing anything secret', () => {
    expect(hasher.describe()).toBe('argon2id m=19456 t=2 p=1');
  });
});

describe('password policy (SEC-013, ADR-0023)', () => {
  it('refuses a password shorter than the policy minimum', async () => {
    await expect(hasher.hashNewPassword('short-one')).rejects.toBeInstanceOf(PasswordPolicyError);
    await expect(hasher.hashNewPassword('short-one')).rejects.toMatchObject({
      issues: ['PASSWORD_TOO_SHORT'],
    });
  });

  it('refuses a very common password and a single repeated character', async () => {
    await expect(hasher.hashNewPassword('password123')).rejects.toMatchObject({
      issues: expect.arrayContaining(['PASSWORD_TOO_COMMON']),
    });
    await expect(hasher.hashNewPassword('aaaaaaaaaaaaaa')).rejects.toMatchObject({
      issues: ['PASSWORD_SINGLE_CHARACTER'],
    });
  });

  it('refuses a password containing the account identifier', async () => {
    await expect(
      hasher.hashNewPassword('samira.hassan-loves-cats', 'Samira.Hassan@example.com'),
    ).rejects.toMatchObject({ issues: ['PASSWORD_CONTAINS_IDENTIFIER'] });
  });

  it('refuses an oversized password rather than hashing it', async () => {
    await expect(hasher.hashNewPassword('x'.repeat(5000))).rejects.toMatchObject({
      issues: expect.arrayContaining(['PASSWORD_TOO_LONG']),
    });
  });

  it('accepts a long passphrase with no composition rules at all', async () => {
    await expect(hasher.hashNewPassword('the quiet harbour at dawn')).resolves.toContain(
      'argon2id',
    );
  });

  it('never puts the password in the error it throws', async () => {
    const error = await hasher.hashNewPassword('short').catch((thrown: unknown) => thrown);
    expect(JSON.stringify({ error, message: (error as Error).message })).not.toContain('short');
  });
});

describe('opaque secrets (SEC-014)', () => {
  it('generates URL-safe 256-bit secrets that do not repeat', () => {
    const secrets = new Set(Array.from({ length: 200 }, () => generateOpaqueSecret()));
    expect(secrets.size).toBe(200);
    for (const secret of secrets) expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('stores a digest, never the secret', () => {
    const secret = generateOpaqueSecret();
    const digest = hashOpaqueSecret(secret);
    expect(digest).not.toBe(secret);
    expect(digest).toBe(hashOpaqueSecret(secret));
    expect(hashOpaqueSecret(generateOpaqueSecret())).not.toBe(digest);
  });

  it('compares strings without leaking their length through an early return', () => {
    expect(timingSafeEquals('abc', 'abc')).toBe(true);
    expect(timingSafeEquals('abc', 'abd')).toBe(false);
    expect(timingSafeEquals('abc', 'a-much-longer-value')).toBe(false);
  });
});

describe('access tokens and MFA challenges (SEC-014, SEC-017)', () => {
  const secret = 'k'.repeat(48);
  const issuer = new TokenIssuer({
    secret,
    issuer: 'alola-erp-api',
    audience: 'alola-erp',
    accessTokenTtlSeconds: 600,
    mfaChallengeTtlSeconds: 300,
  });

  it('refuses a signing secret that is too short to be a key', () => {
    expect(
      () =>
        new TokenIssuer({
          secret: 'short',
          issuer: 'a',
          audience: 'b',
          accessTokenTtlSeconds: 60,
          mfaChallengeTtlSeconds: 60,
        }),
    ).toThrow(/at least 32 bytes/);
  });

  it('round-trips the claims a request needs', async () => {
    const token = await issuer.issueAccessToken({
      accountId: 'acc_1',
      sessionId: 'ses_1',
      credentialVersion: 3,
    });
    expect(await issuer.verifyAccessToken(token)).toEqual({
      accountId: 'acc_1',
      sessionId: 'ses_1',
      credentialVersion: 3,
    });
  });

  it('refuses a token signed with a different key', async () => {
    const other = new TokenIssuer({
      secret: 'z'.repeat(48),
      issuer: 'alola-erp-api',
      audience: 'alola-erp',
      accessTokenTtlSeconds: 600,
      mfaChallengeTtlSeconds: 300,
    });
    const foreign = await other.issueAccessToken({
      accountId: 'acc_1',
      sessionId: 'ses_1',
      credentialVersion: 1,
    });
    await expect(issuer.verifyAccessToken(foreign)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('will not let a challenge token be used as an access token, or the reverse', async () => {
    const challenge = await issuer.issueMfaChallenge({
      accountId: 'acc_1',
      stage: 'verify',
      attemptId: 'att_1',
    });
    await expect(issuer.verifyAccessToken(challenge)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
    const access = await issuer.issueAccessToken({
      accountId: 'acc_1',
      sessionId: 'ses_1',
      credentialVersion: 1,
    });
    await expect(issuer.verifyMfaChallenge(access)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('refuses an expired token', async () => {
    const expired = await new SignJWT({ sub: 'acc_1', sid: 'ses_1', cv: 1, purpose: 'access' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('alola-erp-api')
      .setAudience('alola-erp')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(secret));
    await expect(issuer.verifyAccessToken(expired)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('refuses a token for a different audience or issuer', async () => {
    const foreign = await new SignJWT({ sub: 'acc_1', sid: 'ses_1', cv: 1, purpose: 'access' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('someone-else')
      .setAudience('alola-erp')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode(secret));
    await expect(issuer.verifyAccessToken(foreign)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('refuses a malformed token and an unsigned one', async () => {
    await expect(issuer.verifyAccessToken('not.a.token')).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(
      JSON.stringify({ sub: 'acc_1', purpose: 'access' }),
    ).toString('base64url')}.`;
    await expect(issuer.verifyAccessToken(unsigned)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });
});

describe('TOTP and recovery codes (SEC-017)', () => {
  const issuerName = 'ALOLA ERP';
  const label = 'samira@example.com';

  it('creates a 160-bit base32 secret and an enrolment URI', () => {
    const { secret, otpauthUri } = createTotpEnrolment(issuerName, label);
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri.startsWith('otpauth://totp/')).toBe(true);
    expect(otpauthUri).toContain('ALOLA%20ERP');
    expect(otpauthUri).toContain(secret);
  });

  it('accepts the current code and refuses a wrong one', () => {
    const { secret } = createTotpEnrolment(issuerName, label);
    const now = new Date('2026-09-21T10:00:00.000Z');
    const code = currentTotpCode({ secret, issuer: issuerName, label, now });
    expect(verifyTotp({ secret, code, issuer: issuerName, label, now }).valid).toBe(true);
    expect(verifyTotp({ secret, code: '000000', issuer: issuerName, label, now }).valid).toBe(
      false,
    );
  });

  it('refuses a code from another secret', () => {
    const mine = createTotpEnrolment(issuerName, label);
    const theirs = createTotpEnrolment(issuerName, label);
    const now = new Date('2026-09-21T10:00:00.000Z');
    const code = currentTotpCode({ secret: theirs.secret, issuer: issuerName, label, now });
    expect(verifyTotp({ secret: mine.secret, code, issuer: issuerName, label, now }).valid).toBe(
      false,
    );
  });

  it('refuses a code that was already accepted, even inside the drift window', () => {
    const { secret } = createTotpEnrolment(issuerName, label);
    const now = new Date('2026-09-21T10:00:00.000Z');
    const code = currentTotpCode({ secret, issuer: issuerName, label, now });
    const first = verifyTotp({ secret, code, issuer: issuerName, label, now });
    expect(first.valid).toBe(true);
    expect(first.step).toBeTypeOf('number');
    // Replaying the same code in the same step is refused (SEC-017 replay resistance).
    expect(
      verifyTotp({ secret, code, issuer: issuerName, label, now, lastAcceptedStep: first.step })
        .valid,
    ).toBe(false);
  });

  it('allows one step of clock drift', () => {
    const { secret } = createTotpEnrolment(issuerName, label);
    const now = new Date('2026-09-21T10:00:00.000Z');
    const earlier = new Date(now.getTime() - 30_000);
    const code = currentTotpCode({ secret, issuer: issuerName, label, now: earlier });
    expect(verifyTotp({ secret, code, issuer: issuerName, label, now }).valid).toBe(true);
    // Two steps away is outside the window.
    const tooOld = currentTotpCode({
      secret,
      issuer: issuerName,
      label,
      now: new Date(now.getTime() - 120_000),
    });
    expect(verifyTotp({ secret, code: tooOld, issuer: issuerName, label, now }).valid).toBe(false);
  });

  it('generates distinct recovery codes from an unambiguous alphabet', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      // No characters that get misread when written down.
      expect(code).not.toMatch(/[IO01]/);
    }
  });

  it('normalizes the shape a person types', () => {
    expect(normalizeRecoveryCode('abcde fghjk')).toBe('ABCDE-FGHJK');
    expect(normalizeRecoveryCode('ABCDE-FGHJK')).toBe('ABCDE-FGHJK');
  });

  it('tells a recovery code from a six-digit code, so the server never guesses', () => {
    expect(looksLikeRecoveryCode('123456')).toBe(false);
    expect(looksLikeRecoveryCode('ABCDE-FGHJK')).toBe(true);
  });
});

describe('development encryption of MFA secrets (SEC-017, SEC-033 pending)', () => {
  const key = Buffer.alloc(32, 9).toString('base64');
  const context = { purpose: 'mfa-totp-secret', accountId: 'acc_1' };

  it('round-trips a secret with a stable key, so an enrolment survives a restart', async () => {
    const encryptor = new DevKeyEncryptor('development', key);
    const value = await encryptor.encrypt(Buffer.from('JBSWY3DPEHPK3PXP', 'utf8'), context);
    expect(value.ciphertext).not.toContain('JBSWY3DPEHPK3PXP');
    // A second instance with the same configured key can still read it.
    const restarted = new DevKeyEncryptor('development', key);
    expect(Buffer.from(await restarted.decrypt(value, context)).toString('utf8')).toBe(
      'JBSWY3DPEHPK3PXP',
    );
  });

  it('refuses to decrypt under a different context, so a secret cannot be moved between accounts', async () => {
    const encryptor = new DevKeyEncryptor('development', key);
    const value = await encryptor.encrypt(Buffer.from('secret', 'utf8'), context);
    await expect(
      encryptor.decrypt(value, { purpose: 'mfa-totp-secret', accountId: 'acc_2' }),
    ).rejects.toThrow('DECRYPTION_FAILED');
  });

  it('refuses to exist in staging or production', () => {
    expect(() => new DevKeyEncryptor('production', key)).toThrow(/not permitted/);
    expect(() => new DevKeyEncryptor('staging', key)).toThrow(/not permitted/);
  });

  it('refuses a key of the wrong length', () => {
    expect(
      () => new DevKeyEncryptor('development', Buffer.alloc(16, 1).toString('base64')),
    ).toThrow(/exactly 32 bytes/);
  });
});
