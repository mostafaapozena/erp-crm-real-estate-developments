import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  EphemeralDevEncryptor,
  REDACTED,
  ServiceNotConfiguredError,
  SignedUrlPolicyError,
  UnconfiguredEncryptor,
  UnconfiguredFileStore,
  UnconfiguredMalwareScanner,
  assertSafeObjectKey,
  createLogger,
  validateUpload,
  type UploadPolicy,
} from './index';

function captureLogs() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
  const logger = createLogger({ name: 'test', level: 'info' }, stream);
  return { logger, output: () => lines.join('') };
}

describe('log redaction (PLAT-006, SEC-007)', () => {
  it('removes secrets at every supported depth, keeping the rest of the line', () => {
    const { logger, output } = captureLogs();
    logger.info(
      {
        password: 'top-level-secret-1',
        user: { email: 'visible@example.test', accessToken: 'nested-secret-2' },
        request: { body: { cardNumber: '4111111111111111' } },
        req: {
          headers: { authorization: 'Bearer header-secret-3', cookie: 'sid=cookie-secret-4' },
        },
      },
      'event',
    );
    const text = output();
    for (const secret of [
      'top-level-secret-1',
      'nested-secret-2',
      '4111111111111111',
      'header-secret-3',
      'cookie-secret-4',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain(REDACTED);
    expect(text).toContain('visible@example.test');
  });

  it('writes structured JSON with an ISO timestamp and level label', () => {
    const { logger, output } = captureLogs();
    logger.warn({ correlationId: 'abc' }, 'hello');
    const line = JSON.parse(output()) as Record<string, unknown>;
    expect(line['level']).toBe('warn');
    expect(line['correlationId']).toBe('abc');
    expect(typeof line['time']).toBe('string');
    expect(line['service']).toBe('test');
  });
});

describe('encryption abstraction (SEC-033)', () => {
  const plaintext = new TextEncoder().encode('national id 29001011234567');

  it('fails loudly when KMS is not configured', async () => {
    await expect(new UnconfiguredEncryptor().encrypt()).rejects.toBeInstanceOf(
      ServiceNotConfiguredError,
    );
  });

  it('round-trips with the same context and never stores plaintext', async () => {
    const encryptor = new EphemeralDevEncryptor('test');
    const context = { entity: 'employee', field: 'nationalId', id: 'e1' };
    const value = await encryptor.encrypt(plaintext, context);
    expect(value.ciphertext).not.toContain('29001011234567');
    expect(new TextDecoder().decode(await encryptor.decrypt(value, context))).toBe(
      'national id 29001011234567',
    );
  });

  it('refuses to decrypt under a different context or after tampering', async () => {
    const encryptor = new EphemeralDevEncryptor('test');
    const value = await encryptor.encrypt(plaintext, { id: 'e1' });
    await expect(encryptor.decrypt(value, { id: 'e2' })).rejects.toThrow('DECRYPTION_FAILED');
    const tampered = { ...value, ciphertext: Buffer.from('x').toString('base64') };
    await expect(encryptor.decrypt(tampered, { id: 'e1' })).rejects.toThrow('DECRYPTION_FAILED');
  });

  it('cannot be constructed in staging or production', () => {
    expect(() => new EphemeralDevEncryptor('production')).toThrow();
    expect(() => new EphemeralDevEncryptor('staging')).toThrow();
  });
});

describe('private files (PLAT-017, SEC-008)', () => {
  it('bounds signed URL lifetime', async () => {
    const store = new UnconfiguredFileStore();
    await expect(store.createSignedDownloadUrl('a/b', 3600)).rejects.toBeInstanceOf(
      SignedUrlPolicyError,
    );
    await expect(store.createSignedDownloadUrl('a/b', 0)).rejects.toBeInstanceOf(
      SignedUrlPolicyError,
    );
    await expect(store.createSignedDownloadUrl('a/b', 60)).rejects.toBeInstanceOf(
      ServiceNotConfiguredError,
    );
  });

  it('rejects unsafe object keys', () => {
    expect(() => assertSafeObjectKey('contracts/2026/abc-123')).not.toThrow();
    for (const key of ['../etc/passwd', 'a//b', '/abs', 'Upper/Case', 'name with space.pdf']) {
      expect(() => assertSafeObjectKey(key)).toThrow('UNSAFE_OBJECT_KEY');
    }
  });
});

describe('upload validation (SEC-005)', () => {
  const policy: UploadPolicy = { maxBytes: 1024, allowedTypes: ['application/pdf', 'image/png'] };
  const pdf = new TextEncoder().encode('%PDF-1.7 minimal');
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

  it('accepts a file whose bytes match its declared type', () => {
    expect(validateUpload({ bytes: pdf, declaredType: 'application/pdf' }, policy)).toEqual({
      ok: true,
      contentType: 'application/pdf',
    });
  });

  it('rejects a mismatched, disallowed, empty, or oversized file', () => {
    expect(validateUpload({ bytes: png, declaredType: 'application/pdf' }, policy)).toEqual({
      ok: false,
      reason: 'CONTENT_TYPE_MISMATCH',
    });
    expect(validateUpload({ bytes: pdf, declaredType: 'text/html' }, policy)).toEqual({
      ok: false,
      reason: 'TYPE_NOT_ALLOWED',
    });
    expect(validateUpload({ bytes: new Uint8Array(), declaredType: 'image/png' }, policy)).toEqual({
      ok: false,
      reason: 'EMPTY_FILE',
    });
    expect(
      validateUpload({ bytes: new Uint8Array(2048), declaredType: 'image/png' }, policy),
    ).toEqual({ ok: false, reason: 'FILE_TOO_LARGE' });
  });

  it('marks files as not scanned until a scanner is configured — never as clean', async () => {
    expect(await new UnconfiguredMalwareScanner().scan()).toEqual({ status: 'not_scanned' });
  });
});
