import { randomInt } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';

/**
 * Time-based one-time passwords and recovery codes (`SEC-017`, ADR-0023).
 *
 * RFC 6238 through `otpauth`; no hand-rolled HMAC construction. The secret is generated from the system
 * CSPRNG, shown exactly once at enrolment, and stored **encrypted** — never in plaintext, and never in a
 * log line, an audit record, or an error.
 */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_ALGORITHM = 'SHA1';
/** ±1 step, the usual allowance for clock drift. Wider windows weaken the factor. */
export const TOTP_WINDOW_STEPS = 1;

export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_CODE_LENGTH = 10;

export interface TotpEnrolment {
  /** Base32, shown once. */
  secret: string;
  otpauthUri: string;
}

function totp(secret: string, issuer: string, label: string): TOTP {
  return new TOTP({
    issuer,
    label,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(secret),
  });
}

export function createTotpEnrolment(issuer: string, label: string): TotpEnrolment {
  // 20 bytes = 160 bits, the RFC 4226 recommendation.
  const secret = new Secret({ size: 20 }).base32;
  return { secret, otpauthUri: totp(secret, issuer, label).toString() };
}

export interface TotpVerification {
  valid: boolean;
  /**
   * The absolute time step the code belongs to. Stored as the last accepted step so the same code cannot
   * be presented twice — replay resistance the window would otherwise leave open.
   */
  step?: number;
}

export function verifyTotp(options: {
  secret: string;
  code: string;
  issuer: string;
  label: string;
  /** The last accepted step for this account, if any. */
  lastAcceptedStep?: number;
  now?: Date;
}): TotpVerification {
  const timestamp = (options.now ?? new Date()).getTime();
  const delta = totp(options.secret, options.issuer, options.label).validate({
    token: options.code.replace(/\s+/g, ''),
    timestamp,
    window: TOTP_WINDOW_STEPS,
  });
  if (delta === null) return { valid: false };
  const step = Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS) + delta;
  if (options.lastAcceptedStep !== undefined && step <= options.lastAcceptedStep) {
    // A code from this step, or an earlier one, has already been used.
    return { valid: false };
  }
  return { valid: true, step };
}

/** Generates the current code. Used by tests and never by a request path. */
export function currentTotpCode(options: {
  secret: string;
  issuer: string;
  label: string;
  now?: Date;
}): string {
  return totp(options.secret, options.issuer, options.label).generate({
    timestamp: (options.now ?? new Date()).getTime(),
  });
}

/**
 * Recovery codes, from the CSPRNG. An unambiguous alphabet (no `I`, `O`, `0`, `1`) because these get
 * written down. Plaintext is returned once and never stored: the caller hashes each one independently.
 */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let index = 0; index < count; index += 1) {
    let code = '';
    for (let position = 0; position < RECOVERY_CODE_LENGTH; position += 1) {
      code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    }
    codes.push(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return codes;
}

/** Normalizes the shape people type: spaces stripped, uppercased, hyphen optional. */
export function normalizeRecoveryCode(code: string): string {
  const compact = code.replace(/[\s-]+/g, '').toUpperCase();
  return compact.length === RECOVERY_CODE_LENGTH
    ? `${compact.slice(0, 5)}-${compact.slice(5)}`
    : compact;
}

/** A recovery code is not a TOTP code: the shapes are distinguishable, so the server never guesses. */
export function looksLikeRecoveryCode(code: string): boolean {
  return !/^\d{6}$/.test(code.replace(/\s+/g, ''));
}
