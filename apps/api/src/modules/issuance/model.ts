import { ISSUED_DOCUMENT_TYPES, ISSUED_STATES } from '@alola/contracts';
import { Schema, type Connection, type Model } from 'mongoose';

/**
 * Issued documents (CORE-DOC-003, CORE-DOC-005): one row per generated file.
 *
 * The file itself is a version of an ordinary document (`documents` module); this row records what
 * produced it and whether it still stands. Rows are never deleted — a superseded or revoked document
 * stays, with the reason, because its QR code may still be scanned years later and must say what
 * happened to it.
 */
export const ISSUED_DOCUMENTS_COLLECTION = 'issuedDocuments';

export class IssuedDocumentUndeletableError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly operation: string) {
    super(`Issued documents are superseded or revoked, never deleted: "${operation}" is refused.`);
    this.name = 'IssuedDocumentUndeletableError';
  }
}

export interface IssuedDocumentDocument {
  issueId: string;
  type: (typeof ISSUED_DOCUMENT_TYPES)[number];
  source: { type: string; id: string };
  businessReference: string;
  locale: 'ar' | 'en';
  version: number;
  state: (typeof ISSUED_STATES)[number];
  template: { key: string; version: number; registry?: { templateKey: string; version: number } };
  companyVersion: number;
  /** The issuing company's name as printed, for the public verification page. */
  companyName: { ar: string; en: string };
  documentId: string;
  documentVersion: number;
  fileSha256: string;
  contentSha256: string;
  fingerprint: string;
  pages: number;
  restricted: string[];
  /** Sorted, comma-joined `restricted`: files with the same restrictions share one stored document. */
  restrictionKey: string;
  validUntil?: string;
  /**
   * 256 random bits, base64url. Printed in the QR code. Stored so an authorized reader can reopen the
   * verification page; a database reader who has it learns only what the public page shows.
   */
  verificationToken: string;
  /** Data-scope fields, copied from the source record (SEC-027, SEC-028). */
  legalEntityId: string;
  branchId?: string;
  departmentId?: string;
  teamId?: string;
  projectId?: string;
  ownerAccountId?: string;
  issuedAt: Date;
  /** The issue date in the organization's calendar — what the verification page shows. */
  issuedOn: string;
  issuedBy: string;
  supersededAt?: Date;
  supersededByIssueId?: string;
  revokedAt?: Date;
  revokedBy?: string;
  revocationReason?: string;
  /** Set when the request carried one; a replay returns this row (absent on earlier issues). */
  idempotencyKey?: string;
  idempotencyFingerprint?: string;
}

const DELETE_OPS = ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const;

function issuedSchema(): Schema<IssuedDocumentDocument> {
  const schema = new Schema<IssuedDocumentDocument>(
    {
      issueId: { type: String, required: true, immutable: true },
      type: { type: String, required: true, immutable: true, enum: [...ISSUED_DOCUMENT_TYPES] },
      source: {
        type: new Schema(
          { type: { type: String, required: true }, id: { type: String, required: true } },
          { _id: false },
        ),
        required: true,
        immutable: true,
      },
      businessReference: { type: String, required: true, immutable: true },
      locale: { type: String, required: true, immutable: true, enum: ['ar', 'en'] },
      version: { type: Number, required: true, immutable: true },
      state: { type: String, required: true, enum: [...ISSUED_STATES] },
      template: {
        type: new Schema(
          {
            key: { type: String, required: true },
            version: { type: Number, required: true },
            registry: {
              type: new Schema(
                {
                  templateKey: { type: String, required: true },
                  version: { type: Number, required: true },
                },
                { _id: false },
              ),
            },
          },
          { _id: false },
        ),
        required: true,
        immutable: true,
      },
      companyVersion: { type: Number, required: true, immutable: true },
      companyName: {
        type: new Schema(
          { ar: { type: String, required: true }, en: { type: String, required: true } },
          { _id: false },
        ),
        required: true,
        immutable: true,
      },
      documentId: { type: String, required: true, immutable: true },
      documentVersion: { type: Number, required: true, immutable: true },
      fileSha256: { type: String, required: true, immutable: true },
      contentSha256: { type: String, required: true, immutable: true },
      fingerprint: { type: String, required: true, immutable: true },
      pages: { type: Number, required: true, immutable: true },
      restricted: { type: [String], required: true, immutable: true },
      // Empty for an unrestricted file, which a `required` string would refuse.
      restrictionKey: { type: String, default: '', immutable: true },
      validUntil: { type: String, immutable: true },
      verificationToken: { type: String, required: true, immutable: true },
      legalEntityId: { type: String, required: true, immutable: true },
      branchId: { type: String, immutable: true },
      departmentId: { type: String, immutable: true },
      teamId: { type: String, immutable: true },
      projectId: { type: String, immutable: true },
      ownerAccountId: { type: String, immutable: true },
      issuedAt: { type: Date, required: true, immutable: true },
      issuedOn: { type: String, required: true, immutable: true },
      issuedBy: { type: String, required: true, immutable: true },
      supersededAt: { type: Date },
      supersededByIssueId: { type: String },
      revokedAt: { type: Date },
      revokedBy: { type: String },
      revocationReason: { type: String },
      idempotencyKey: { type: String, immutable: true },
      idempotencyFingerprint: { type: String, immutable: true },
    },
    {
      collection: ISSUED_DOCUMENTS_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
    },
  );
  for (const operation of DELETE_OPS) {
    schema.pre(operation, function refuse() {
      throw new IssuedDocumentUndeletableError(operation);
    });
  }
  schema.index({ issueId: 1 }, { unique: true, name: 'issuedDocuments_id_unique' });
  schema.index({ verificationToken: 1 }, { unique: true, name: 'issuedDocuments_token_unique' });
  /** The version sequence per type, source and language; the loser of a race gets a conflict. */
  schema.index(
    { type: 1, 'source.id': 1, locale: 1, version: 1 },
    { unique: true, name: 'issuedDocuments_series_unique' },
  );
  schema.index(
    { 'source.type': 1, 'source.id': 1, issuedAt: -1 },
    { name: 'issuedDocuments_source' },
  );
  schema.index({ legalEntityId: 1, branchId: 1 }, { name: 'issuedDocuments_scope' });
  schema.index({ teamId: 1 }, { name: 'issuedDocuments_scope_team' });
  schema.index({ ownerAccountId: 1 }, { name: 'issuedDocuments_owner' });
  /** One issue per idempotency key; issues made without one (all earlier ones) are not indexed. */
  schema.index(
    { idempotencyKey: 1 },
    {
      unique: true,
      name: 'issuedDocuments_idempotency_unique',
      partialFilterExpression: { idempotencyKey: { $type: 'string' } },
    },
  );
  return schema;
}

export function issuedDocumentModel(connection: Connection): Model<IssuedDocumentDocument> {
  return (
    (connection.models[ISSUED_DOCUMENTS_COLLECTION] as Model<IssuedDocumentDocument> | undefined) ??
    connection.model<IssuedDocumentDocument>(ISSUED_DOCUMENTS_COLLECTION, issuedSchema())
  );
}
