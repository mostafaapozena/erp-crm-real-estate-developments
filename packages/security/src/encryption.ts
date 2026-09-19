import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ServiceNotConfiguredError } from './errors';

/**
 * Encryption abstraction (SEC-033). Domain code depends on `Encryptor`, never on a KMS SDK.
 *
 * `context` is authenticated but not encrypted (AES-GCM additional data, or the KMS encryption
 * context): a ciphertext decrypts only with the same context, so a value copied onto another record
 * fails to decrypt instead of silently appearing there.
 */
export interface EncryptedValue {
  readonly algorithm: string;
  readonly keyRef: string;
  readonly iv: string;
  readonly authTag: string;
  readonly ciphertext: string;
}

export type EncryptionContext = Readonly<Record<string, string>>;

export interface Encryptor {
  encrypt(plaintext: Uint8Array, context: EncryptionContext): Promise<EncryptedValue>;
  decrypt(value: EncryptedValue, context: EncryptionContext): Promise<Uint8Array>;
}

/** Used whenever `KMS_KEY_ID` is unset: fails loudly instead of storing plaintext. */
export class UnconfiguredEncryptor implements Encryptor {
  encrypt(): Promise<EncryptedValue> {
    return Promise.reject(new ServiceNotConfiguredError('KMS encryption', 'KMS_KEY_ID'));
  }

  decrypt(): Promise<Uint8Array> {
    return Promise.reject(new ServiceNotConfiguredError('KMS encryption', 'KMS_KEY_ID'));
  }
}

function serializeContext(context: EncryptionContext): Buffer {
  const ordered = Object.keys(context)
    .sort()
    .map((key) => [key, context[key]]);
  return Buffer.from(JSON.stringify(ordered), 'utf8');
}

/**
 * AES-256-GCM with an ephemeral in-memory key, for tests and local development only. The key exists
 * only for the life of the process, so nothing it encrypts is recoverable afterwards — which is the
 * point: it can never become an accidental production key store.
 */
export class EphemeralDevEncryptor implements Encryptor {
  private readonly key = randomBytes(32);

  constructor(appEnv: string) {
    if (appEnv === 'production' || appEnv === 'staging') {
      throw new Error('EphemeralDevEncryptor is not permitted in staging or production.');
    }
  }

  encrypt(plaintext: Uint8Array, context: EncryptionContext): Promise<EncryptedValue> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(serializeContext(context));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Promise.resolve({
      algorithm: 'AES-256-GCM',
      keyRef: 'ephemeral-dev',
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    });
  }

  decrypt(value: EncryptedValue, context: EncryptionContext): Promise<Uint8Array> {
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(value.iv, 'base64'));
      decipher.setAAD(serializeContext(context));
      decipher.setAuthTag(Buffer.from(value.authTag, 'base64'));
      return Promise.resolve(
        Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]),
      );
    } catch {
      return Promise.reject(new Error('DECRYPTION_FAILED'));
    }
  }
}
