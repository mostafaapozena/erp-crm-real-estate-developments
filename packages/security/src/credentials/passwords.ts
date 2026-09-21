import { hash, verify } from '@node-rs/argon2';
import { passwordPolicyIssues, type PasswordIssueCode } from '@alola/contracts';

/**
 * Password hashing (`SEC-013`, [ADR-0023](../../../../docs/decisions/adr-0023-password-hashing-and-session-tokens.md)).
 *
 * Argon2id with parameters at or above the OWASP minimum. Nothing here invents cryptography: the
 * algorithm is RFC 9106 as implemented by `@node-rs/argon2`, and the stored string is standard PHC
 * format, which carries the algorithm, version, parameters, and salt with the digest. That is what makes
 * a later parameter increase a transparent rehash instead of a migration.
 */
/**
 * `Algorithm.Argon2id` from the library is an ambient const enum, and `verbatimModuleSyntax` cannot
 * import one as a value, so the numeric variant is used directly. A unit test asserts that the stored
 * string really begins with the Argon2id marker — the guarantee is checked rather than assumed.
 */
const ARGON2ID = 2;

export interface Argon2Parameters {
  /** KiB of memory. The dominant cost, and the one that matters against GPU attack. */
  memoryCost: number;
  /** Iterations. */
  timeCost: number;
  /** Lanes. 1 keeps a login predictable under concurrency. */
  parallelism: number;
}

/** OWASP's Argon2id minimum (m=19456 KiB, t=2, p=1). Raised through configuration, never lowered in code. */
export const DEFAULT_ARGON2_PARAMETERS: Argon2Parameters = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export class PasswordPolicyError extends Error {
  readonly code = 'VALIDATION_FAILED';

  constructor(readonly issues: PasswordIssueCode[]) {
    super('VALIDATION_FAILED');
    this.name = 'PasswordPolicyError';
  }
}

interface ParsedPhc {
  algorithm: string;
  parameters: Partial<Argon2Parameters>;
}

/** Reads the algorithm and cost parameters back out of a stored PHC string. */
function parsePhc(stored: string): ParsedPhc | undefined {
  const parts = stored.split('$');
  // ['', 'argon2id', 'v=19', 'm=19456,t=2,p=1', salt, digest]
  if (parts.length < 6 || parts[1] === undefined) return undefined;
  const numbers = new Map<string, number>();
  for (const pair of (parts[3] ?? '').split(',')) {
    const [key, value] = pair.split('=');
    if (key && value !== undefined && /^\d+$/.test(value)) numbers.set(key, Number(value));
  }
  const parameters: Partial<Argon2Parameters> = {};
  const memoryCost = numbers.get('m');
  const timeCost = numbers.get('t');
  const parallelism = numbers.get('p');
  if (memoryCost !== undefined) parameters.memoryCost = memoryCost;
  if (timeCost !== undefined) parameters.timeCost = timeCost;
  if (parallelism !== undefined) parameters.parallelism = parallelism;
  return { algorithm: parts[1], parameters };
}

export class PasswordHasher {
  private dummyHash: string | undefined;

  constructor(readonly parameters: Argon2Parameters = DEFAULT_ARGON2_PARAMETERS) {}

  /** Throws `PasswordPolicyError` before hashing; the raw value is never trimmed or normalized. */
  async hashNewPassword(password: string, identifier?: string): Promise<string> {
    const issues = passwordPolicyIssues(password, identifier);
    if (issues.length > 0) throw new PasswordPolicyError(issues);
    return this.hash(password);
  }

  /** Hash without the policy check — for a value the policy has already accepted, such as a recovery code. */
  hash(secret: string): Promise<string> {
    return hash(secret, {
      algorithm: ARGON2ID,
      memoryCost: this.parameters.memoryCost,
      timeCost: this.parameters.timeCost,
      parallelism: this.parameters.parallelism,
    });
  }

  /** Constant-time inside the library. A malformed stored value is a failed verification, not a crash. */
  async verify(stored: string, candidate: string): Promise<boolean> {
    try {
      return await verify(stored, candidate);
    } catch {
      return false;
    }
  }

  /**
   * Spend the same work as a real verification when no account was found, so a response time cannot be
   * used to tell an unknown login identifier from a known one (`SEC-013` enumeration resistance).
   */
  async verifyDummy(candidate: string): Promise<false> {
    this.dummyHash ??= await this.hash('dummy-verification-value');
    await this.verify(this.dummyHash, candidate);
    return false;
  }

  /**
   * True when a stored hash was produced by a weaker configuration than the current one, so a successful
   * login can transparently upgrade it. Also true for anything that is not Argon2id.
   */
  needsRehash(stored: string): boolean {
    const parsed = parsePhc(stored);
    if (!parsed || parsed.algorithm !== 'argon2id') return true;
    const { memoryCost, timeCost, parallelism } = parsed.parameters;
    if (memoryCost === undefined || timeCost === undefined || parallelism === undefined)
      return true;
    return (
      memoryCost < this.parameters.memoryCost ||
      timeCost < this.parameters.timeCost ||
      parallelism !== this.parameters.parallelism
    );
  }

  /** For documentation and audit evidence: the parameters in use, never a hash or a secret. */
  describe(): string {
    const { memoryCost, timeCost, parallelism } = this.parameters;
    return `argon2id m=${memoryCost} t=${timeCost} p=${parallelism}`;
  }
}
