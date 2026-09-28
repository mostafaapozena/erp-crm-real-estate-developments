/**
 * Import and export published interface (CORE-IMPORT-001 … 003).
 *
 * Owning modules contribute an `Importer` or an `Exporter`, wired at the composition root; this module
 * owns the mechanism — parsing, preview, all-or-nothing commit, formula-safe export, audit.
 */
export {
  EXPORT_RECORDS_COLLECTION,
  IMPORT_BATCHES_COLLECTION,
  exportRecordModel,
  importBatchModel,
} from './model';
export { ImportService } from './service';
export type { Exporter, ImportColumn, ImportServiceOptions, Importer, XlsxReader } from './service';
export { exportRouter, importRouter } from './router';
export type { ImportRouterOptions } from './router';
export { readFirstSheet } from './xlsx';
