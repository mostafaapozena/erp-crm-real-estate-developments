import { z } from 'zod';
import { PermissionSchema, type Permission } from './authorization';
import type { DocumentOwnerType } from './documents';
import { RecordIdSchema } from './identifiers';
import { LocaleSchema, LocalizedLabelSchema } from './localized';
import { BusinessDateSchema, InstantSchema } from './time';

/**
 * Issued business documents and their public verification (CORE-DOC-003, CORE-DOC-005).
 *
 * An **issued document** is a PDF the product generated from a business record — a quotation, a
 * reservation, a contract summary, an instalment schedule, a receipt, a customer statement. The file is
 * stored as a version of an ordinary document (CORE-DOC-004), so it is private, versioned, scoped by
 * the record it belongs to, and every download is recorded (CORE-DOC-006). This record adds what a
 * generated file needs on top: which template and template version drew it, in which language, its
 * checksums, its place in the sequence of versions, and its verification token.
 *
 * An issued file **never changes**. A later change to the company profile, the customer or the
 * template produces a new version on the next generation; the previous one is kept and marked
 * superseded, and its verification page says so.
 */

export const ISSUED_DOCUMENT_TYPES = [
  'quotation',
  'reservation',
  'contractSummary',
  'installmentSchedule',
  'receipt',
  'customerStatement',
] as const;
export const IssuedDocumentTypeSchema = z.enum(ISSUED_DOCUMENT_TYPES);
export type IssuedDocumentType = z.infer<typeof IssuedDocumentTypeSchema>;

/** The record each type is generated from, and to which its file is attached. */
export const ISSUED_DOCUMENT_SOURCES: Readonly<Record<IssuedDocumentType, DocumentOwnerType>> = {
  quotation: 'quotation',
  reservation: 'reservation',
  contractSummary: 'contract',
  installmentSchedule: 'contract',
  receipt: 'receipt',
  customerStatement: 'customer',
};

/**
 * What an actor must hold, besides `document.generate` or `document.view`, to generate or read an
 * issued document of a type: the permission that reads its source. A PDF is never a way around the
 * permission that guards the record it was drawn from.
 */
export const ISSUED_DOCUMENT_PERMISSIONS: Readonly<Record<IssuedDocumentType, Permission[]>> = {
  quotation: ['sales.quotation.view'],
  reservation: ['sales.reservation.view'],
  contractSummary: ['sales.contract.view'],
  installmentSchedule: ['sales.contract.view', 'collection.installment.view'],
  receipt: ['collection.receipt.view'],
  customerStatement: ['crm.customer.view', 'sales.contract.view', 'collection.receipt.view'],
};

/**
 * The built-in layout version of each type. Raised whenever a type's layout or wording changes, so an
 * issued file always names the layout that drew it. Approved legal wording, when a client publishes
 * it, comes from the template registry (CORE-DOC-002) and is recorded beside this.
 */
export const ISSUED_TEMPLATE_VERSIONS: Readonly<Record<IssuedDocumentType, number>> = {
  quotation: 1,
  reservation: 1,
  contractSummary: 1,
  installmentSchedule: 1,
  receipt: 1,
  customerStatement: 1,
};

export const ISSUED_STATES = ['issued', 'superseded', 'revoked'] as const;
export const IssuedStateSchema = z.enum(ISSUED_STATES);
export type IssuedState = z.infer<typeof IssuedStateSchema>;

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const IssuedDocumentSchema = z.strictObject({
  issueId: RecordIdSchema,
  type: IssuedDocumentTypeSchema,
  source: z.strictObject({ type: z.string(), id: RecordIdSchema }),
  /** The number the business knows the source by: quotation, reservation, contract, receipt. */
  businessReference: z.string().min(1).max(80),
  locale: LocaleSchema,
  /** 1, 2, 3 … per type, source and language. */
  version: z.number().int().positive(),
  state: IssuedStateSchema,
  template: z.strictObject({
    key: z.string(),
    version: z.number().int().positive(),
    /** Approved wording from the template registry, when one was published for this kind. */
    registry: z
      .strictObject({ templateKey: z.string(), version: z.number().int().positive() })
      .optional(),
  }),
  /** The company profile version whose identity the file prints. */
  companyVersion: z.number().int().nonnegative(),
  /** The stored file: a version of an ordinary document (CORE-DOC-004). */
  documentId: RecordIdSchema,
  documentVersion: z.number().int().positive(),
  fileSha256: Sha256Schema,
  /** Checksum of the content the file was drawn from; its first 16 digits are the fingerprint. */
  contentSha256: Sha256Schema,
  fingerprint: z.string().regex(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/),
  pages: z.number().int().positive(),
  /** Permissions a reader needs because the file prints restricted fields (SEC-029). */
  restricted: z.array(PermissionSchema),
  /** A quotation's stated validity; verification reads it as expired afterwards. */
  validUntil: BusinessDateSchema.optional(),
  issuedAt: InstantSchema,
  issuedBy: z.string(),
  supersededAt: InstantSchema.optional(),
  supersededByIssueId: RecordIdSchema.optional(),
  revokedAt: InstantSchema.optional(),
  revokedBy: z.string().optional(),
  revocationReason: z.string().max(500).optional(),
  /**
   * The public verification link printed in the file's QR code. Returned only to someone who may
   * download the file — they could read it from the page anyway.
   */
  verificationUrl: z.string().optional(),
});
export type IssuedDocument = z.infer<typeof IssuedDocumentSchema>;

export const IssueDocumentSchema = z.strictObject({
  type: IssuedDocumentTypeSchema,
  sourceId: RecordIdSchema,
  locale: LocaleSchema,
});
export type IssueDocument = z.infer<typeof IssueDocumentSchema>;

export const IssuePreviewQuerySchema = z.strictObject({
  type: IssuedDocumentTypeSchema,
  sourceId: RecordIdSchema,
});

/** Why a person may want to look twice before generating. Labelled in both languages. */
export const ISSUE_WARNINGS = [
  'draft',
  'notFinal',
  'cancelled',
  'identityMissing',
  'noApprovedWording',
  'expired',
  'withdrawn',
  'superseded',
  'reversed',
] as const;
export type IssueWarning = (typeof ISSUE_WARNINGS)[number];

/** Safe metadata shown before generation — no document content, nothing restricted. */
export const IssuePreviewSchema = z.strictObject({
  type: IssuedDocumentTypeSchema,
  businessReference: z.string(),
  nextVersion: z.record(LocaleSchema, z.number().int().positive()),
  warnings: z.array(z.enum(ISSUE_WARNINGS)),
  /** Restricted fields the file will print because this actor may see them. */
  restricted: z.array(PermissionSchema),
});
export type IssuePreview = z.infer<typeof IssuePreviewSchema>;

export const IssuedDocumentQuerySchema = z.strictObject({
  sourceType: z.enum(['quotation', 'reservation', 'contract', 'receipt', 'customer']),
  sourceId: RecordIdSchema,
});

export const IssuedDocumentListSchema = z.strictObject({ items: z.array(IssuedDocumentSchema) });

export const RevokeIssuedDocumentSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});

/* ------------------------------------------------------------ verification */

/** 256 random bits, base64url: not a number, not guessable, not derived from anything. */
export const VerificationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const VERIFICATION_RESULTS = [
  'valid',
  'superseded',
  'revoked',
  'expired',
  'invalid',
] as const;
export type VerificationResult = (typeof VERIFICATION_RESULTS)[number];

/**
 * The whole public answer. Deliberately small: who issued it, what it is, its business number, when,
 * and whether it still stands. No customer, amount, address, identity, internal identifier or file
 * link — a leaked QR code discloses nothing a printed page's header does not.
 */
export const PublicVerificationSchema = z.strictObject({
  result: z.enum(VERIFICATION_RESULTS),
  company: LocalizedLabelSchema.optional(),
  documentType: IssuedDocumentTypeSchema.optional(),
  businessReference: z.string().optional(),
  issuedOn: BusinessDateSchema.optional(),
  version: z.number().int().positive().optional(),
  /** Matches the fingerprint printed on the genuine page. */
  fingerprint: z.string().optional(),
  checkedAt: InstantSchema,
});
export type PublicVerification = z.infer<typeof PublicVerificationSchema>;

export const ISSUED_AUDIT_ACTIONS = {
  issued: 'document.issued',
  superseded: 'document.superseded',
  revoked: 'document.revoked',
  verified: 'document.verified',
  refused: 'document.issueRefused',
} as const;
