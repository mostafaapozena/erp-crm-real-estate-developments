import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import {
  assertSafeObjectKey,
  assertSignedUrlTtl,
  type PrivateFileStore,
  type PutPrivateObject,
  type SignedDownloadOptions,
} from './private-files';

/**
 * Private files on the local disk — **development and test only** (PLAT-017, SEC-008).
 *
 * Production stores files in private object storage behind the same `PrivateFileStore` interface
 * (ADR-0010); this adapter exists so the document foundation can be built and tested end to end on a
 * laptop without an account anywhere. It refuses to run in staging or production.
 *
 * It keeps the same guarantees an object store gives:
 *
 * - **No public path.** A file is reached only through a signed token: HMAC-SHA256 over the key, the
 *   expiry and the offered file name and type, with a key that exists only in this process — so a
 *   restart invalidates every outstanding link, which is the conservative failure.
 * - **Short-lived.** The token carries its expiry; the maximum lifetime is the platform's
 *   (`MAX_SIGNED_URL_TTL_SECONDS`).
 * - **No traversal.** Keys are server-generated and checked by `assertSafeObjectKey`, and the resolved
 *   path must stay inside the storage root.
 */
export interface SignedFileGrant {
  key: string;
  fileName: string;
  contentType: string;
  expiresAt: Date;
}

export class LocalDiskFileStore implements PrivateFileStore {
  private readonly root: string;
  private readonly signingKey: Buffer;

  constructor(
    appEnv: string,
    rootDirectory: string,
    private readonly publicBase = '/api/v1/files',
    private readonly now: () => Date = () => new Date(),
  ) {
    if (appEnv === 'production' || appEnv === 'staging') {
      throw new Error('LocalDiskFileStore is for development and test; configure object storage.');
    }
    this.root = resolve(rootDirectory);
    this.signingKey = randomBytes(32);
  }

  private pathFor(key: string): string {
    assertSafeObjectKey(key);
    const path = resolve(this.root, ...key.split('/'));
    if (!path.startsWith(this.root + sep)) throw new Error('UNSAFE_OBJECT_KEY');
    return path;
  }

  async put(object: PutPrivateObject): Promise<void> {
    const path = this.pathFor(object.key);
    await mkdir(dirname(path), { recursive: true });
    // Write then rename, so a reader never sees half a file.
    const temporary = `${path}.${randomBytes(6).toString('hex')}.partial`;
    await writeFile(temporary, object.body, { flag: 'wx' });
    await rename(temporary, path);
  }

  async read(key: string): Promise<Uint8Array> {
    return readFile(this.pathFor(key));
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.signingKey).update(payload).digest('base64url');
  }

  createSignedDownloadUrl(
    key: string,
    ttlSeconds: number,
    options: SignedDownloadOptions = {},
  ): Promise<string> {
    try {
      assertSignedUrlTtl(ttlSeconds);
      assertSafeObjectKey(key);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    const expires = Math.floor(this.now().getTime() / 1000) + ttlSeconds;
    const payload = Buffer.from(
      JSON.stringify([key, expires, options.fileName ?? 'file', options.contentType ?? '']),
      'utf8',
    ).toString('base64url');
    return Promise.resolve(`${this.publicBase}/${payload}.${this.sign(payload)}`);
  }

  /** The grant a token carries, or `undefined` for a forged, altered or expired one. */
  verify(token: string): SignedFileGrant | undefined {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) return undefined;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
    try {
      const [key, expires, fileName, contentType] = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as [unknown, unknown, unknown, unknown];
      if (typeof key !== 'string' || typeof expires !== 'number') return undefined;
      if (typeof fileName !== 'string' || typeof contentType !== 'string') return undefined;
      if (expires * 1000 < this.now().getTime()) return undefined;
      assertSafeObjectKey(key);
      return { key, fileName, contentType, expiresAt: new Date(expires * 1000) };
    } catch {
      return undefined;
    }
  }
}
