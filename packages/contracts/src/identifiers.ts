import { z } from 'zod';

/**
 * Opaque record identifiers.
 *
 * Every business record carries a server-generated, prefixed, URL-safe identifier — `unit_3f2a…`, not a
 * raw MongoDB `ObjectId` and not a sequence number. Three reasons this shape is worth fixing once:
 *
 * - A prefixed identifier is self-describing in an audit record, a log line, and a support conversation.
 * - It is safe in a URL path, so a route parameter can be validated with one strict schema everywhere.
 * - It reveals no ordering, so it cannot be enumerated or used to infer volume.
 *
 * Identifiers are rendered **verbatim** and direction-isolated in the interface (ADR-0003); they are
 * never reformatted, localized, or converted to Arabic-Indic digits.
 */
const IDENTIFIER = /^[a-z][a-z0-9]{0,11}_[A-Za-z0-9]{6,64}$/;

export const RecordIdSchema = z
  .string()
  .regex(IDENTIFIER, { message: 'RECORD_ID_EXPECTED' })
  .max(80);
export type RecordId = z.infer<typeof RecordIdSchema>;

/**
 * A human-facing business code — a unit code, a branch code, a contract number. Entered or generated,
 * shown to people, and used in conversation. Uppercase alphanumerics with `-` and `/` separators, which
 * is what the domain already uses; deliberately not the same thing as a `RecordId`.
 */
export const BusinessCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Z0-9][A-Z0-9/-]*$/, { message: 'BUSINESS_CODE_EXPECTED' });
export type BusinessCode = z.infer<typeof BusinessCodeSchema>;

/**
 * A phone number as entered. Stored and displayed verbatim (never reformatted, ADR-0003) and matched
 * for duplicates on a normalized form the service derives — the raw value is what a person recognizes.
 */
export const PhoneSchema = z
  .string()
  .trim()
  .min(6)
  .max(32)
  .regex(/^\+?[0-9][0-9\s()-]*$/, { message: 'PHONE_EXPECTED' });
export type Phone = z.infer<typeof PhoneSchema>;

/** Digits only, for duplicate detection. Never stored in place of the entered value. */
export function normalizePhone(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

/** A short free-text note. Bounded so a note can never become an unbounded document store. */
export const NoteSchema = z.string().trim().max(2000);

/** Any name a person typed: a customer, a project, a campaign. Stored exactly as entered (I18N-009). */
export const EnteredNameSchema = z.string().trim().min(2).max(160);
