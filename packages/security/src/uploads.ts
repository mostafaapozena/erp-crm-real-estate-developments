/**
 * Upload validation (SEC-005): size, declared type against an allow-list, and the **actual** content
 * type sniffed from the bytes. A declared type is attacker-controlled; the magic bytes are not.
 */
export interface UploadPolicy {
  maxBytes: number;
  allowedTypes: readonly AllowedContentType[];
}

export type AllowedContentType = 'application/pdf' | 'image/png' | 'image/jpeg';

export type UploadRejection =
  'EMPTY_FILE' | 'FILE_TOO_LARGE' | 'TYPE_NOT_ALLOWED' | 'CONTENT_TYPE_MISMATCH';

export type UploadValidation =
  { ok: true; contentType: AllowedContentType } | { ok: false; reason: UploadRejection };

const SIGNATURES: ReadonlyArray<{ type: AllowedContentType; bytes: readonly number[] }> = [
  { type: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
];

export function sniffContentType(head: Uint8Array): AllowedContentType | undefined {
  return SIGNATURES.find((s) => s.bytes.every((byte, i) => head[i] === byte))?.type;
}

export function validateUpload(
  file: { bytes: Uint8Array; declaredType: string },
  policy: UploadPolicy,
): UploadValidation {
  if (file.bytes.byteLength === 0) return { ok: false, reason: 'EMPTY_FILE' };
  if (file.bytes.byteLength > policy.maxBytes) return { ok: false, reason: 'FILE_TOO_LARGE' };
  const declared = policy.allowedTypes.find((t) => t === file.declaredType.toLowerCase());
  if (!declared) return { ok: false, reason: 'TYPE_NOT_ALLOWED' };
  if (sniffContentType(file.bytes) !== declared)
    return { ok: false, reason: 'CONTENT_TYPE_MISMATCH' };
  return { ok: true, contentType: declared };
}

/**
 * Malware scanning hook. The scanner is a provider (ADR-0010); until one is selected, uploads are
 * marked `not_scanned`, which downstream code must treat as untrusted — never as clean.
 */
export type ScanResult =
  { status: 'clean' } | { status: 'infected'; signature: string } | { status: 'not_scanned' };

export interface MalwareScanner {
  scan(bytes: Uint8Array): Promise<ScanResult>;
}

export class UnconfiguredMalwareScanner implements MalwareScanner {
  scan(): Promise<ScanResult> {
    return Promise.resolve({ status: 'not_scanned' });
  }
}
