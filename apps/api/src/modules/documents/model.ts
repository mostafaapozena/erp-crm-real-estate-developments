import {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_OWNER_TYPES,
  DOCUMENT_STATES,
  SCAN_STATUSES,
  TEMPLATE_KINDS,
  TEMPLATE_STATES,
} from '@alola/contracts';
import { Schema, type Connection, type Model } from 'mongoose';

/**
 * Document and template storage (CORE-DOC-002, CORE-DOC-004).
 *
 * - `documents` — one row per document: its owner, category, title, data-scope fields copied from
 *   the owner at upload, lifecycle state and retention.
 * - `documentVersions` — **append-only**. A new file is a new version; an old version is never
 *   overwritten (CORE-DOC-004). Only its scan status may change, when a scanner reports.
 * - `documentTemplates` — versioned bilingual templates. A published version is immutable in the
 *   service and in the model: its bodies, placeholders and dates cannot be rewritten.
 *
 * The bytes live in the private file store under a server-generated key, never here.
 */
export const DOCUMENTS_COLLECTION = 'documents';
export const DOCUMENT_VERSIONS_COLLECTION = 'documentVersions';
export const DOCUMENT_TEMPLATES_COLLECTION = 'documentTemplates';

export class DocumentRecordImmutableError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly operation: string) {
    super(`Documents are archived and versioned, never deleted: "${operation}" is refused.`);
    this.name = 'DocumentRecordImmutableError';
  }
}

export interface DocumentDocument {
  documentId: string;
  owner: { type: (typeof DOCUMENT_OWNER_TYPES)[number]; id: string };
  category: string;
  title: string;
  /** Data-scope fields, copied from the owning record when the document was uploaded (SEC-027). */
  legalEntityId: string;
  branchId?: string;
  departmentId?: string;
  teamId?: string;
  projectId?: string;
  ownerAccountId?: string;
  createdBy: string;
  /**
   * Permissions a reader must hold because the file prints restricted fields — a generated contract
   * summary that shows the buyer's identity needs `crm.customer.viewIdentity` (SEC-029). A document
   * is invisible to anyone missing one: not listed, not found, no link. Absent: no restriction.
   */
  requiredPermissions?: string[];
  state: (typeof DOCUMENT_STATES)[number];
  currentVersion: number;
  retainUntil?: string;
  legalHold: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentVersionDocument {
  documentId: string;
  version: number;
  storageKey: string;
  fileName: string;
  contentType: (typeof DOCUMENT_CONTENT_TYPES)[number];
  size: number;
  sha256: string;
  scanStatus: (typeof SCAN_STATUSES)[number];
  uploadedAt: Date;
  uploadedBy: string;
}

export interface TemplateDocument {
  templateKey: string;
  kind: (typeof TEMPLATE_KINDS)[number];
  version: number;
  state: (typeof TEMPLATE_STATES)[number];
  name: { ar: string; en: string };
  bodies: { ar: string; en: string };
  effectiveFrom: string;
  effectiveTo?: string;
  selectors: { projectId?: string; unitType?: string };
  placeholders: string[];
  firstUsedAt?: Date;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
  publishedAt?: Date;
  publishedBy?: string;
  retiredAt?: Date;
}

const DELETE_OPS = ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const;

function refuse<T>(schema: Schema<T>, operations: readonly string[]): Schema<T> {
  for (const operation of operations) {
    schema.pre(operation as 'deleteOne', function refuseOperation() {
      throw new DocumentRecordImmutableError(operation);
    });
  }
  return schema;
}

const localized = new Schema(
  { ar: { type: String, required: true }, en: { type: String, required: true } },
  { _id: false },
);

function documentSchema(): Schema<DocumentDocument> {
  const schema = new Schema<DocumentDocument>(
    {
      documentId: { type: String, required: true, immutable: true },
      owner: {
        type: new Schema(
          {
            type: { type: String, required: true, enum: [...DOCUMENT_OWNER_TYPES] },
            id: { type: String, required: true },
          },
          { _id: false },
        ),
        required: true,
        immutable: true,
      },
      category: { type: String, required: true },
      title: { type: String, required: true },
      legalEntityId: { type: String, required: true, immutable: true },
      branchId: { type: String, immutable: true },
      departmentId: { type: String, immutable: true },
      teamId: { type: String, immutable: true },
      projectId: { type: String, immutable: true },
      ownerAccountId: { type: String, immutable: true },
      createdBy: { type: String, required: true, immutable: true },
      requiredPermissions: { type: [String], default: undefined, immutable: true },
      state: { type: String, required: true, enum: [...DOCUMENT_STATES] },
      currentVersion: { type: Number, required: true },
      retainUntil: { type: String },
      legalHold: { type: Boolean, required: true },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: DOCUMENTS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  schema.index({ documentId: 1 }, { unique: true, name: 'documents_id_unique' });
  schema.index({ 'owner.type': 1, 'owner.id': 1, state: 1 }, { name: 'documents_owner' });
  schema.index({ updatedAt: -1, documentId: -1 }, { name: 'documents_keyset' });
  schema.index({ legalEntityId: 1, branchId: 1, projectId: 1 }, { name: 'documents_scope' });
  schema.index({ ownerAccountId: 1 }, { name: 'documents_scope_assigned' });
  schema.index({ createdBy: 1 }, { name: 'documents_scope_self' });
  return refuse(schema, DELETE_OPS);
}

function versionSchema(): Schema<DocumentVersionDocument> {
  const schema = new Schema<DocumentVersionDocument>(
    {
      documentId: { type: String, required: true, immutable: true },
      version: { type: Number, required: true, immutable: true },
      storageKey: { type: String, required: true, immutable: true },
      fileName: { type: String, required: true, immutable: true },
      contentType: {
        type: String,
        required: true,
        immutable: true,
        enum: [...DOCUMENT_CONTENT_TYPES],
      },
      size: { type: Number, required: true, immutable: true },
      sha256: { type: String, required: true, immutable: true },
      scanStatus: { type: String, required: true, enum: [...SCAN_STATUSES] },
      uploadedAt: { type: Date, required: true, immutable: true },
      uploadedBy: { type: String, required: true, immutable: true },
    },
    {
      collection: DOCUMENT_VERSIONS_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
    },
  );
  // One row per version: two simultaneous uploads can never both become version N.
  schema.index({ documentId: 1, version: 1 }, { unique: true, name: 'documentVersions_unique' });
  schema.index({ storageKey: 1 }, { unique: true, name: 'documentVersions_storageKey_unique' });
  return refuse(schema, [...DELETE_OPS, 'replaceOne', 'findOneAndReplace']);
}

function templateSchema(): Schema<TemplateDocument> {
  const schema = new Schema<TemplateDocument>(
    {
      templateKey: { type: String, required: true, immutable: true },
      kind: { type: String, required: true, immutable: true, enum: [...TEMPLATE_KINDS] },
      version: { type: Number, required: true, immutable: true },
      state: { type: String, required: true, enum: [...TEMPLATE_STATES] },
      name: { type: localized, required: true },
      bodies: { type: localized, required: true },
      effectiveFrom: { type: String, required: true },
      effectiveTo: { type: String },
      selectors: {
        type: new Schema(
          { projectId: { type: String }, unitType: { type: String } },
          { _id: false },
        ),
        default: {},
      },
      placeholders: { type: [String], required: true },
      firstUsedAt: { type: Date },
      createdAt: { type: Date, required: true, immutable: true },
      createdBy: { type: String, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
      updatedBy: { type: String, required: true },
      publishedAt: { type: Date },
      publishedBy: { type: String },
      retiredAt: { type: Date },
    },
    {
      collection: DOCUMENT_TEMPLATES_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
      minimize: false,
    },
  );
  schema.index(
    { templateKey: 1, version: 1 },
    { unique: true, name: 'documentTemplates_key_version_unique' },
  );
  schema.index({ kind: 1, state: 1, effectiveFrom: 1 }, { name: 'documentTemplates_selection' });
  /**
   * A published version's content is frozen in the database layer too: any update that touches the
   * bodies, placeholders, name, dates or selectors of a published row is refused, whatever code path
   * issues it. State changes (retirement) and the first-use marker remain possible.
   */
  const FROZEN = ['bodies', 'placeholders', 'name', 'effectiveFrom', 'effectiveTo', 'selectors'];
  for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate'] as const) {
    schema.pre(operation, function freezePublished() {
      const filter = this.getFilter() as Record<string, unknown>;
      const update = (this.getUpdate() ?? {}) as Record<
        string,
        Record<string, unknown> | undefined
      >;
      const touched = ['$set', '$unset']
        .flatMap((operator) => Object.keys(update[operator] ?? {}))
        .some((path) => FROZEN.some((field) => path === field || path.startsWith(`${field}.`)));
      if (touched && filter['state'] !== 'draft') {
        throw new DocumentRecordImmutableError(`${operation} of published template content`);
      }
    });
  }
  return refuse(schema, [...DELETE_OPS, 'replaceOne', 'findOneAndReplace']);
}

function model<T>(connection: Connection, name: string, build: () => Schema<T>): Model<T> {
  return (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, build());
}

export function documentModel(connection: Connection): Model<DocumentDocument> {
  return model(connection, DOCUMENTS_COLLECTION, documentSchema);
}

export function documentVersionModel(connection: Connection): Model<DocumentVersionDocument> {
  return model(connection, DOCUMENT_VERSIONS_COLLECTION, versionSchema);
}

export function templateModel(connection: Connection): Model<TemplateDocument> {
  return model(connection, DOCUMENT_TEMPLATES_COLLECTION, templateSchema);
}
