import { z } from 'zod';
import { RecordIdSchema } from './identifiers';
import { InstantSchema } from './time';

/**
 * Import and export (CORE-IMPORT-001, 002, 003).
 *
 * **Import is preview, then commit — all or nothing.** An uploaded file is parsed and every row
 * validated before anything is written; the preview lists each row's errors by row and column; and a
 * commit either writes every row in one transaction or refuses. There is no "import the good rows" —
 * a partial import that silently drops rows is the failure CORE-IMPORT-002 exists to prevent.
 *
 * **Export is a controlled read** (CORE-IMPORT-003): the owning module's scoped, field-restricted
 * query, bounded in size, written as formula-safe CSV, recorded in the audit trail, and handed over as
 * a short-lived link rather than a permanent file.
 */

/** What can be imported. Each kind is an importer registered at the composition root. */
export const IMPORT_KINDS = ['referenceItems', 'leads'] as const;
export const ImportKindSchema = z.enum(IMPORT_KINDS);
export type ImportKind = z.infer<typeof ImportKindSchema>;

/**
 * The leads file's columns, in order (CRM-LEAD-006). Every imported lead is owned by the person who
 * imports it; handing leads out is a separate, audited assignment.
 */
export const LEAD_IMPORT_COLUMNS = [
  { name: 'name', required: true },
  { name: 'primary_phone', required: true },
  { name: 'secondary_phone', required: false },
  { name: 'email', required: false },
  { name: 'source', required: true },
  { name: 'branch_code', required: true },
  { name: 'notes', required: false },
] as const;

/** The reference-items file's columns, in order. Header names match case-insensitively. */
export const REFERENCE_IMPORT_COLUMNS = [
  { name: 'list', required: true },
  { name: 'code', required: true },
  { name: 'label_ar', required: true },
  { name: 'label_en', required: true },
  { name: 'description_ar', required: false },
  { name: 'description_en', required: false },
  { name: 'sort_order', required: false },
] as const;

export const IMPORT_FORMATS = ['csv', 'xlsx'] as const;
export const IMPORT_STATES = [
  /** Parsed and validated; nothing written. */
  'previewed',
  /** Every row written, in one transaction. */
  'committed',
  /** Withdrawn by a person before commit. */
  'discarded',
] as const;
export const ImportStateSchema = z.enum(IMPORT_STATES);

/** An upload may hold at most this many data rows; a larger file is refused, never truncated. */
export const IMPORT_MAX_ROWS = 5000;
/** At most this many bytes. */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
/** How long a preview may wait for its commit. */
export const IMPORT_PREVIEW_TTL_HOURS = 24;

export const ImportIssueSchema = z.strictObject({
  /** The spreadsheet row, counting the header as row 1 — what the person sees in their file. */
  row: z.number().int().positive(),
  column: z.string().optional(),
  code: z.string(),
});
export type ImportIssue = z.infer<typeof ImportIssueSchema>;

export const ImportBatchSchema = z.strictObject({
  batchId: RecordIdSchema,
  kind: ImportKindSchema,
  format: z.enum(IMPORT_FORMATS),
  fileName: z.string(),
  state: ImportStateSchema,
  totalRows: z.number().int().nonnegative(),
  validRows: z.number().int().nonnegative(),
  invalidRows: z.number().int().nonnegative(),
  /** Up to the first 200 issues; `issueCount` says how many there are in all. */
  issues: z.array(ImportIssueSchema),
  issueCount: z.number().int().nonnegative(),
  /** The first rows as they will be written, for a person to check before committing. */
  preview: z.array(z.record(z.string(), z.string())),
  createdBy: z.string(),
  createdAt: InstantSchema,
  expiresAt: InstantSchema,
  committedAt: InstantSchema.optional(),
  version: z.number().int().positive(),
});
export type ImportBatch = z.infer<typeof ImportBatchSchema>;

export const UploadImportQuerySchema = z.strictObject({
  kind: ImportKindSchema,
  fileName: z.string().trim().min(1).max(200),
});

export const CommitImportSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
});

/* ---------------------------------------------------------------- exports */

export const EXPORT_KINDS = ['leads', 'units'] as const;
export const ExportKindSchema = z.enum(EXPORT_KINDS);
export type ExportKind = z.infer<typeof ExportKindSchema>;

/** The most rows one export may hold. A larger result is refused with a request to narrow it. */
export const EXPORT_MAX_ROWS = 5000;

export const CreateExportSchema = z.strictObject({
  kind: ExportKindSchema,
});

export const ExportResultSchema = z.strictObject({
  exportId: RecordIdSchema,
  kind: ExportKindSchema,
  rowCount: z.number().int().nonnegative(),
  /** The columns written — restricted fields the caller may not see are absent, not blank. */
  columns: z.array(z.string()),
  url: z.string(),
  expiresAt: InstantSchema,
});
export type ExportResult = z.infer<typeof ExportResultSchema>;

export const IMPORT_AUDIT_ACTIONS = {
  previewed: 'import.previewed',
  committed: 'import.committed',
  discarded: 'import.discarded',
  exported: 'export.created',
} as const;
