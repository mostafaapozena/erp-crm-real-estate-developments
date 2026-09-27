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
 * A file name safe to show and to offer on download (SEC-005).
 *
 * The name a person uploaded is kept as a courtesy — never as a storage key, which the server
 * generates — and it is cleaned of everything that could deceive or break:
 *
 * - directory parts (`../../etc/passwd`, `C:\\x\\y.pdf`) — only the last segment survives;
 * - control characters and **bidirectional overrides** (`U+202E`), which can make `invoice<U+202E>fdp.exe`
 *   display as `invoiceexe.pdf`;
 * - characters reserved on common file systems;
 * - leading dots, so nothing becomes a hidden file.
 *
 * The extension is then **forced to match the verified content type**: a PDF is offered as `.pdf`
 * whatever it was called.
 */
const EXTENSIONS: Record<AllowedContentType, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

/** Control characters, bidirectional controls and zero-width characters, by code point. */
function isInvisibleOrControl(codePoint: number): boolean {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    codePoint === 0xfeff
  );
}

export function sanitizeFileName(input: string, contentType: AllowedContentType): string {
  const lastSegment = input.split(/[\\/]/).pop() ?? '';
  const visible = [...lastSegment.normalize('NFC')]
    .filter((character) => !isInvisibleOrControl(character.codePointAt(0) ?? 0))
    .join('');
  const cleaned = visible
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  const stem =
    cleaned
      .replace(/\.[^.]*$/, '')
      .slice(0, 120)
      .trim() || 'document';
  return `${stem}.${EXTENSIONS[contentType]}`;
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
