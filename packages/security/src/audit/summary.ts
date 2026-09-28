import { REDACTED } from '../logging';

/**
 * Before/after **summaries** for audit records (AUDIT-002, AUDIT-006).
 *
 * An audit log containing plaintext salaries, bank numbers, or tokens becomes the least-protected copy of
 * the most sensitive data in the system. So a summary:
 *
 * - redacts any path whose key matches a sensitive name, or which the caller marks protected;
 * - never stores a whole request body — only the paths that actually changed;
 * - describes large or structured values instead of copying them (`[string length=…]`, `[array length=…]`);
 * - records that a protected field *changed* without revealing either value, because the fact of the
 *   change is the audit-relevant part.
 */

/** Key names whose values never appear in an audit record, at any depth. */
const SENSITIVE_KEY_PATTERN =
  /(password|passphrase|secret|token|apikey|api_key|credential|cookie|authorization|otp|mfa|cvv|card|iban|accountnumber|nationalid|identitynumber|passport|salary|commission|balance|connectionstring|privatekey)/i;

const MAX_VALUE_LENGTH = 64;
const MAX_PATHS = 200;
const MAX_DEPTH = 6;

export interface ChangeSummaryEntry {
  path: string;
  from?: string;
  to?: string;
}

export interface SummaryOptions {
  /** Extra paths to redact, for values that are sensitive by context rather than by name. */
  protectedPaths?: readonly string[];
}

function isSensitive(path: string, options: SummaryOptions): boolean {
  const lastSegment = path.split('.').pop() ?? path;
  if (SENSITIVE_KEY_PATTERN.test(lastSegment)) return true;
  return (options.protectedPaths ?? []).some(
    (protectedPath) => path === protectedPath || path.startsWith(`${protectedPath}.`),
  );
}

/** Render one value as a short, safe string. Never returns a verbatim protected value. */
export function summarizeValue(value: unknown, path: string, options: SummaryOptions = {}): string {
  if (isSensitive(path, options)) return REDACTED;
  if (value === undefined) return '(absent)';
  if (value === null) return '(null)';
  if (typeof value === 'string') {
    return value.length > MAX_VALUE_LENGTH ? `[string length=${value.length}]` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const items = value.filter((item) => ['string', 'number', 'boolean'].includes(typeof item));
    if (items.length === value.length && value.length <= 10) {
      const rendered = items.join(',');
      return rendered.length > MAX_VALUE_LENGTH ? `[array length=${value.length}]` : rendered;
    }
    return `[array length=${value.length}]`;
  }
  if (typeof value === 'object') return `[object keys=${Object.keys(value).length}]`;
  return '[unsupported]';
}

function flatten(value: unknown, prefix: string, depth: number, out: Map<string, unknown>): void {
  if (
    depth >= MAX_DEPTH ||
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value instanceof Date
  ) {
    out.set(prefix, value);
    return;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    out.set(prefix, value);
    return;
  }
  for (const [key, child] of entries) {
    flatten(child, prefix ? `${prefix}.${key}` : key, depth + 1, out);
  }
}

/**
 * Compare two states and return only the paths that changed. Passing `undefined` for `before` records a
 * creation; passing `undefined` for `after` records a removal.
 */
export function buildChangeSummary(
  before: unknown,
  after: unknown,
  options: SummaryOptions = {},
): ChangeSummaryEntry[] {
  const beforeFlat = new Map<string, unknown>();
  const afterFlat = new Map<string, unknown>();
  if (before !== undefined) flatten(before, '', 0, beforeFlat);
  if (after !== undefined) flatten(after, '', 0, afterFlat);

  const paths = [...new Set([...beforeFlat.keys(), ...afterFlat.keys()])].sort();
  const entries: ChangeSummaryEntry[] = [];
  for (const path of paths) {
    const from = beforeFlat.get(path);
    const to = afterFlat.get(path);
    const unchanged =
      beforeFlat.has(path) && afterFlat.has(path) && JSON.stringify(from) === JSON.stringify(to);
    if (unchanged) continue;
    const entry: ChangeSummaryEntry = { path: path || '(root)' };
    if (beforeFlat.has(path)) entry.from = summarizeValue(from, path, options);
    if (afterFlat.has(path)) entry.to = summarizeValue(to, path, options);
    entries.push(entry);
    if (entries.length >= MAX_PATHS) break;
  }
  return entries;
}
