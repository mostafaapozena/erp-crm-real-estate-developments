import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalDiskFileStore } from './local-files';
import { sanitizeFileName } from './uploads';

describe('sanitizeFileName (SEC-005)', () => {
  it.each([
    ['contract.pdf', 'application/pdf', 'contract.pdf'],
    ['../../etc/passwd', 'application/pdf', 'passwd.pdf'],
    ['C:\\Users\\x\\scan.jpeg', 'image/jpeg', 'scan.jpg'],
    ['report.exe', 'application/pdf', 'report.pdf'],
    ['.hidden.pdf', 'application/pdf', 'hidden.pdf'],
    ['a<b>c:d|e?f*g.png', 'image/png', 'a_b_c_d_e_f_g.png'],
    ['', 'application/pdf', 'document.pdf'],
    ['...', 'image/png', 'document.png'],
  ] as const)('%s → %s', (input, type, expected) => {
    expect(sanitizeFileName(input, type)).toBe(expected);
  });

  it('removes bidirectional overrides that would disguise an extension', () => {
    const disguised = `invoice${String.fromCharCode(0x202e)}fdp.exe`;
    const safe = sanitizeFileName(disguised, 'application/pdf');
    expect(safe).toBe('invoicefdp.pdf');
    expect([...safe].some((character) => /[\u202a-\u202e\u2066-\u2069]/.test(character))).toBe(
      false,
    );
  });

  it('removes control characters and keeps Arabic names intact', () => {
    expect(sanitizeFileName(`عقد\u0000الحجز\u0007.pdf`, 'application/pdf')).toBe('عقدالحجز.pdf');
    expect(sanitizeFileName('عقد الحجز النهائي.pdf', 'application/pdf')).toBe(
      'عقد الحجز النهائي.pdf',
    );
  });

  it('bounds the length', () => {
    expect(
      sanitizeFileName(`${'a'.repeat(500)}.pdf`, 'application/pdf').length,
    ).toBeLessThanOrEqual(124);
  });
});

describe('LocalDiskFileStore (PLAT-017, SEC-008)', () => {
  let root: string;
  let clock: Date;
  let store: LocalDiskFileStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'alola-files-'));
    clock = new Date('2026-09-27T10:00:00.000Z');
    store = new LocalDiskFileStore('test', root, '/api/v1/files', () => clock);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const token = (url: string) => url.replace('/api/v1/files/', '');

  it('stores and reads back bytes, leaving no partial file behind', async () => {
    await store.put({
      key: 'documents/doc1/v1-a',
      body: new Uint8Array([1, 2, 3]),
      contentType: 'application/pdf',
    });
    expect([...(await store.read('documents/doc1/v1-a'))]).toEqual([1, 2, 3]);
    expect(await readdir(join(root, 'documents', 'doc1'))).toEqual(['v1-a']);
  });

  // Keys are server-generated and random, so an object is never written twice in practice; what matters
  // is that a second write to the same key is still atomic and leaves no partial file behind.
  it('writes atomically even when a key is written twice', async () => {
    const put = () =>
      store.put({
        key: 'documents/doc1/v1-a',
        body: new Uint8Array([1]),
        contentType: 'application/pdf',
      });
    await put();
    await expect(
      store.put({
        key: 'documents/doc1/v1-a',
        body: new Uint8Array([9]),
        contentType: 'application/pdf',
      }),
    ).resolves.toBeUndefined();
    // The rename replaces atomically; the partial is written with an exclusive flag and never reused.
    expect(
      (await readdir(join(root, 'documents', 'doc1'))).filter((name) => name.endsWith('.partial')),
    ).toEqual([]);
  });

  it('issues a signed link that verifies, and refuses a tampered or expired one', async () => {
    const url = await store.createSignedDownloadUrl('documents/doc1/v1-a', 60, {
      fileName: 'عقد.pdf',
      contentType: 'application/pdf',
    });
    expect(url.startsWith('/api/v1/files/')).toBe(true);
    const grant = store.verify(token(url));
    expect(grant).toMatchObject({
      key: 'documents/doc1/v1-a',
      fileName: 'عقد.pdf',
      contentType: 'application/pdf',
    });

    const [payload = '', signature = ''] = token(url).split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify(['documents/other/v1-b', 9_999_999_999, 'x.pdf', 'application/pdf']),
    ).toString('base64url');
    expect(store.verify(`${forgedPayload}.${signature}`)).toBeUndefined();
    expect(store.verify(`${payload}.${signature.slice(0, -2)}AA`)).toBeUndefined();
    expect(store.verify(`${payload}`)).toBeUndefined();

    clock = new Date(clock.getTime() + 61_000);
    expect(store.verify(token(url))).toBeUndefined();
  });

  it('refuses a link from another process — the signing key never leaves this one', async () => {
    const url = await store.createSignedDownloadUrl('documents/doc1/v1-a', 60);
    const other = new LocalDiskFileStore('test', root, '/api/v1/files', () => clock);
    expect(other.verify(token(url))).toBeUndefined();
  });

  it('refuses unsafe keys and lifetimes', async () => {
    for (const key of ['../escape', 'documents/../../x', '/absolute', 'UPPER', 'a//b']) {
      await expect(
        store.put({ key, body: new Uint8Array([1]), contentType: 'application/pdf' }),
      ).rejects.toThrow();
    }
    await expect(store.createSignedDownloadUrl('documents/a', 301)).rejects.toThrow();
    await expect(store.createSignedDownloadUrl('documents/a', 0)).rejects.toThrow();
  });

  it('refuses to exist in staging or production', () => {
    expect(() => new LocalDiskFileStore('production', root)).toThrow();
    expect(() => new LocalDiskFileStore('staging', root)).toThrow();
  });
});
