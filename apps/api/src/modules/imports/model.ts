import { IMPORT_FORMATS, IMPORT_KINDS, IMPORT_STATES, EXPORT_KINDS } from '@alola/contracts';
import { Schema, type Connection, type Model } from 'mongoose';

/**
 * Import and export storage (CORE-IMPORT-001 … 003).
 *
 * - `importBatches` — one row per uploaded file: its validated rows, its issues, and whether it was
 *   committed or discarded. A batch is the evidence of what was imported, by whom, from which file;
 *   it is never deleted.
 * - `exportRecords` — one row per export: who took which kind of data, how many rows, which columns.
 *   The file itself lives in the private store under a server-generated key and is reached only by a
 *   short-lived signed link.
 */
export const IMPORT_BATCHES_COLLECTION = 'importBatches';
export const EXPORT_RECORDS_COLLECTION = 'exportRecords';

export class ImportRecordImmutableError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly operation: string) {
    super(`Import and export history is never deleted: "${operation}" is refused.`);
    this.name = 'ImportRecordImmutableError';
  }
}

export interface ImportBatchDocument {
  batchId: string;
  kind: (typeof IMPORT_KINDS)[number];
  format: (typeof IMPORT_FORMATS)[number];
  fileName: string;
  sha256: string;
  state: (typeof IMPORT_STATES)[number];
  totalRows: number;
  invalidRows: number;
  issues: { row: number; column?: string; code: string }[];
  /** The validated values, in file order — what a commit writes. Empty when any row is invalid. */
  rows: Record<string, unknown>[];
  preview: Record<string, string>[];
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
  committedAt?: Date;
  discardedAt?: Date;
  version: number;
}

export interface ExportRecordDocument {
  exportId: string;
  kind: (typeof EXPORT_KINDS)[number];
  rowCount: number;
  columns: string[];
  storageKey: string;
  sha256: string;
  createdBy: string;
  createdAt: Date;
}

const DELETE_OPS = [
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findOneAndReplace',
  'replaceOne',
];

function refuseDeletes<T>(schema: Schema<T>): Schema<T> {
  for (const operation of DELETE_OPS) {
    schema.pre(operation as 'deleteOne', function refuseOperation() {
      throw new ImportRecordImmutableError(operation);
    });
  }
  return schema;
}

const issueSchema = new Schema(
  {
    row: { type: Number, required: true },
    column: { type: String },
    code: { type: String, required: true },
  },
  { _id: false },
);

function batchSchema(): Schema<ImportBatchDocument> {
  const schema = new Schema<ImportBatchDocument>(
    {
      batchId: { type: String, required: true },
      kind: { type: String, required: true, enum: IMPORT_KINDS },
      format: { type: String, required: true, enum: IMPORT_FORMATS },
      fileName: { type: String, required: true },
      sha256: { type: String, required: true },
      state: { type: String, required: true, enum: IMPORT_STATES },
      totalRows: { type: Number, required: true },
      invalidRows: { type: Number, required: true },
      issues: { type: [issueSchema], default: [] },
      // Plain arrays of plain objects, validated by the importer before they are stored.
      rows: { type: Schema.Types.Mixed, default: [] },
      preview: { type: Schema.Types.Mixed, default: [] },
      createdBy: { type: String, required: true },
      createdAt: { type: Date, required: true },
      expiresAt: { type: Date, required: true },
      committedAt: { type: Date },
      discardedAt: { type: Date },
      version: { type: Number, required: true },
    },
    {
      collection: IMPORT_BATCHES_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
      minimize: false,
    },
  );
  schema.index({ batchId: 1 }, { unique: true, name: 'importBatches_id_unique' });
  schema.index({ createdBy: 1, createdAt: -1 }, { name: 'importBatches_creator' });
  return refuseDeletes(schema);
}

function exportSchema(): Schema<ExportRecordDocument> {
  const schema = new Schema<ExportRecordDocument>(
    {
      exportId: { type: String, required: true, immutable: true },
      kind: { type: String, required: true, enum: EXPORT_KINDS, immutable: true },
      rowCount: { type: Number, required: true, immutable: true },
      columns: { type: [String], required: true, immutable: true },
      storageKey: { type: String, required: true, immutable: true },
      sha256: { type: String, required: true, immutable: true },
      createdBy: { type: String, required: true, immutable: true },
      createdAt: { type: Date, required: true, immutable: true },
    },
    {
      collection: EXPORT_RECORDS_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
    },
  );
  schema.index({ exportId: 1 }, { unique: true, name: 'exportRecords_id_unique' });
  schema.index({ createdBy: 1, createdAt: -1 }, { name: 'exportRecords_creator' });
  return refuseDeletes(schema);
}

export function importBatchModel(connection: Connection): Model<ImportBatchDocument> {
  return (
    (connection.models[IMPORT_BATCHES_COLLECTION] as Model<ImportBatchDocument> | undefined) ??
    connection.model<ImportBatchDocument>(IMPORT_BATCHES_COLLECTION, batchSchema())
  );
}

export function exportRecordModel(connection: Connection): Model<ExportRecordDocument> {
  return (
    (connection.models[EXPORT_RECORDS_COLLECTION] as Model<ExportRecordDocument> | undefined) ??
    connection.model<ExportRecordDocument>(EXPORT_RECORDS_COLLECTION, exportSchema())
  );
}
