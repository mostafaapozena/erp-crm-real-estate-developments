import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

/**
 * Tokens and session secrets (`SEC-014`, `SEC-015`, ADR-0023).
 *
 * Two different kinds of token, deliberately not interchangeable:
 *
 * - **Opaque secrets** — refresh tokens, activation tokens, reset tokens. 256 bits from the system CSPRNG.
 *   Only a SHA-256 digest is stored, so a database copy cannot be replayed. A fast digest is correct
 *   *here*, unlike for a password: the input already has full entropy, so there is nothing to brute-force
 *   and nothing for a slow hash to protect.
 * - **Access tokens** — short-lived signed JWTs, so an ordinary request needs no token lookup. They are
 *   never trusted on their own: the request pipeline still loads the session and the account, which is
 *   what makes revocation immediate (`SEC-020`, ADR-0022).
 */

/** 256 bits, URL-safe, no padding. */
export function generateOpaqueSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** The only representation of an opaque secret that is ever stored. */
export function hashOpaqueSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('base64url');
}

/** Length-independent, timing-safe string comparison. */
export function timingSafeEquals(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

export class InvalidAccessTokenError extends Error {
  readonly code = 'UNAUTHENTICATED';

  constructor() {
    super('UNAUTHENTICATED');
    this.name = 'InvalidAccessTokenError';
  }
}

/** What an access token asserts. Everything here is re-checked against storage on every request. */
export interface AccessTokenClaims {
  accountId: string;
  sessionId: string;
  /** Account credential generation; a mismatch means the password changed (`SEC-020`). */
  credentialVersion: number;
}

/** A challenge token carries no session: it may only complete or enrol a second factor (`SEC-017`). */
export interface MfaChallengeClaims {
  accountId: string;
  stage: 'verify' | 'enrol';
  /** Ties the challenge to the login attempt that created it, so it cannot be reused elsewhere. */
  attemptId: string;
}

const ACCESS_PURPOSE = 'access';
const MFA_PURPOSE = 'mfa';

export interface TokenIssuerOptions {
  /** At least 32 bytes of secret material, from configuration only. */
  secret: string;
  issuer: string;
  audience: string;
  accessTokenTtlSeconds: number;
  mfaChallengeTtlSeconds: number;
}

export class TokenIssuer {
  private readonly key: Uint8Array;

  constructor(private readonly options: TokenIssuerOptions) {
    if (Buffer.byteLength(options.secret, 'utf8') < 32) {
      // A short signing key is the one configuration mistake that silently weakens everything else.
      throw new Error('Token signing secret must be at least 32 bytes.');
    }
    this.key = new TextEncoder().encode(options.secret);
  }

  get accessTokenTtlSeconds(): number {
    return this.options.accessTokenTtlSeconds;
  }

  get mfaChallengeTtlSeconds(): number {
    return this.options.mfaChallengeTtlSeconds;
  }

  private sign(payload: JWTPayload, purpose: string, ttlSeconds: number): Promise<string> {
    return new SignJWT({ ...payload, purpose })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setIssuer(this.options.issuer)
      .setAudience(this.options.audience)
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.key);
  }

  private async verifyPurpose(token: string, purpose: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ['HS256'],
      });
      if (payload['purpose'] !== purpose) throw new InvalidAccessTokenError();
      return payload;
    } catch {
      // Expired, wrong signature, wrong purpose, malformed — one indistinguishable outcome.
      throw new InvalidAccessTokenError();
    }
  }

  issueAccessToken(claims: AccessTokenClaims): Promise<string> {
    return this.sign(
      { sub: claims.accountId, sid: claims.sessionId, cv: claims.credentialVersion },
      ACCESS_PURPOSE,
      this.options.accessTokenTtlSeconds,
    );
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const payload = await this.verifyPurpose(token, ACCESS_PURPOSE);
    const accountId = payload.sub;
    const sessionId = payload['sid'];
    const credentialVersion = payload['cv'];
    if (
      typeof accountId !== 'string' ||
      typeof sessionId !== 'string' ||
      typeof credentialVersion !== 'number'
    ) {
      throw new InvalidAccessTokenError();
    }
    return { accountId, sessionId, credentialVersion };
  }

  issueMfaChallenge(claims: MfaChallengeClaims): Promise<string> {
    return this.sign(
      { sub: claims.accountId, stage: claims.stage, aid: claims.attemptId },
      MFA_PURPOSE,
      this.options.mfaChallengeTtlSeconds,
    );
  }

  async verifyMfaChallenge(token: string): Promise<MfaChallengeClaims> {
    const payload = await this.verifyPurpose(token, MFA_PURPOSE);
    const accountId = payload.sub;
    const stage = payload['stage'];
    const attemptId = payload['aid'];
    if (
      typeof accountId !== 'string' ||
      (stage !== 'verify' && stage !== 'enrol') ||
      typeof attemptId !== 'string'
    ) {
      throw new InvalidAccessTokenError();
    }
    return { accountId, stage, attemptId };
  }
}
