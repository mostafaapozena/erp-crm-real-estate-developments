import {
  EXPORT_MAX_ROWS,
  IMPORT_AUDIT_ACTIONS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  IMPORT_PREVIEW_TTL_HOURS,
  ImportBatchSchema,
  ExportResultSchema,
  type ActorContext,
  type ExportKind,
  type ExportResult,
  type ImportBatch,
  type ImportIssue,
  type ImportKind,
  type Permission,
} from '@alola/contracts';
import { MAX_SIGNED_URL_TTL_SECONDS, can, type PrivateFileStore } from '@alola/security';
import { createHash } from 'node:crypto';
import type { ClientSession, Connection } from 'mongoose';
import {
  DomainError,
  auditActor,
  conflict,
  invalid,
  notFound,
  type AuditRecorder,
  type RequestContext,
} from '../../platform/audit-port';
import { CsvFormatError, parseCsv, writeCsv } from '../../platform/csv';
import { newId } from '../../platform/ids';
import { withTransaction } from '../../platform/transactions';
import { exportRecordModel, importBatchModel, type ImportBatchDocument } from './model';

/**
 * Import and export (CORE-IMPORT-001 … 003).
 *
 * The service owns the mechanism — reading a file, mapping its header, collecting every issue,
 * storing the preview, committing in one transaction, writing a formula-safe export, recording who did
 * what. **What** is imported or exported belongs to the owning module, plugged in at the composition
 * root as an `Importer` or an `Exporter`, so its validation, its permission and its data scope stay
 * the module's own.
 */

/** A column an importer reads. Header names are matched case-insensitively, ignoring spaces. */
export interface ImportColumn {
  name: string;
  required: boolean;
}

export interface Importer<Row extends Record<string, unknown> = Record<string, unknown>> {
  kind: ImportKind;
  /** Needed to preview and to commit. */
  permission: Permission;
  columns: readonly ImportColumn[];
  /** Validate one row's cells (keyed by column name, blanks as `''`). */
  validateRow(cells: Record<string, string>): { value?: Row; issues: Omit<ImportIssue, 'row'>[] };
  /** Checks across the file and against stored data — duplicates, codes already in use. */
  validateAll(rows: readonly { row: number; value: Row }[]): Promise<ImportIssue[]>;
  /** What a person sees for a row in the preview. */
  preview(value: Row): Record<string, string>;
  /** Write every row inside `session`. Anything it throws rolls the whole import back. */
  commit(
    actor: ActorContext,
    rows: readonly Row[],
    session: ClientSession,
    context: RequestContext,
  ): Promise<void>;
}

export interface Exporter {
  kind: ExportKind;
  permission: Permission;
  /**
   * The rows **as the actor may see them**: scope inside the owning module's query, restricted
   * fields absent from `columns` altogether. At most `limit` rows.
   */
  rows(
    actor: ActorContext,
    limit: number,
  ): Promise<{ columns: string[]; rows: (string | number | null | undefined)[][] }>;
}

/** Reads the cells of an `.xlsx` workbook's first sheet. Injected: it is the one binary dependency. */
export type XlsxReader = (bytes: Uint8Array) => Promise<unknown[][]>;

export interface ImportServiceOptions {
  connection: Connection;
  audit: AuditRecorder;
  store: PrivateFileStore;
  importers: readonly Importer[];
  exporters: readonly Exporter[];
  readXlsx: XlsxReader;
  importsEnabled: () => Promise<boolean>;
  exportsEnabled: () => Promise<boolean>;
  /** Lifetime of an export link; at most `MAX_SIGNED_URL_TTL_SECONDS`. */
  linkTtlSeconds?: number;
  now?: () => Date;
}

const ISSUE_LIMIT = 200;
const PREVIEW_ROWS = 20;
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

const iso = (date: Date) => date.toISOString();
const headerKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '');

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // Anything else a workbook might hold (an error cell, a rich-text run) is not a value to import.
  return '';
}

export class ImportService {
  private readonly batches;
  private readonly exports;
  private readonly now: () => Date;
  private readonly linkTtl: number;

  constructor(private readonly options: ImportServiceOptions) {
    this.batches = importBatchModel(options.connection);
    this.exports = exportRecordModel(options.connection);
    this.now = options.now ?? (() => new Date());
    this.linkTtl = Math.min(options.linkTtlSeconds ?? 120, MAX_SIGNED_URL_TTL_SECONDS);
  }

  private importer(kind: ImportKind): Importer {
    const importer = this.options.importers.find((candidate) => candidate.kind === kind);
    if (!importer) throw invalid('IMPORT_KIND_UNAVAILABLE', ['query', 'kind']);
    return importer;
  }

  private assertCan(actor: ActorContext, permission: Permission): void {
    if (!can(actor, permission)) throw new DomainError('FORBIDDEN');
  }

  private toBatch(document: ImportBatchDocument): ImportBatch {
    return ImportBatchSchema.parse({
      batchId: document.batchId,
      kind: document.kind,
      format: document.format,
      fileName: document.fileName,
      state: document.state,
      totalRows: document.totalRows,
      validRows: document.totalRows - document.invalidRows,
      invalidRows: document.invalidRows,
      issues: document.issues.slice(0, ISSUE_LIMIT).map((issue) => ({
        row: issue.row,
        ...(issue.column ? { column: issue.column } : {}),
        code: issue.code,
      })),
      issueCount: document.issues.length,
      preview: document.preview,
      createdBy: document.createdBy,
      createdAt: iso(document.createdAt),
      expiresAt: iso(document.expiresAt),
      ...(document.committedAt ? { committedAt: iso(document.committedAt) } : {}),
      version: document.version,
    });
  }

  /** The file as rows of text cells, header first. Refuses what it cannot read exactly. */
  private async readTable(
    bytes: Uint8Array,
  ): Promise<{ format: 'csv' | 'xlsx'; table: string[][] }> {
    if (bytes.byteLength === 0) throw invalid('FILE_EMPTY', ['file']);
    if (bytes.byteLength > IMPORT_MAX_BYTES) throw invalid('FILE_TOO_LARGE', ['file']);
    if (ZIP_MAGIC.every((byte, index) => bytes[index] === byte)) {
      try {
        const sheet = await this.options.readXlsx(bytes);
        return { format: 'xlsx', table: sheet.map((row) => row.map(cellText)) };
      } catch {
        throw invalid('XLSX_UNREADABLE', ['file']);
      }
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      // Not UTF-8. A legacy code page would turn Arabic into question marks; ask for UTF-8 instead.
      throw invalid('CSV_NOT_UTF8', ['file']);
    }
    if (text.includes('\u0000')) throw invalid('FILE_TYPE_NOT_ALLOWED', ['file']);
    try {
      return { format: 'csv', table: parseCsv(text).map((row) => row.map((cell) => cell.trim())) };
    } catch (error) {
      if (error instanceof CsvFormatError) throw invalid('CSV_MALFORMED', ['file']);
      throw error;
    }
  }

  /* ---------------------------------------------------------------- import */

  /**
   * Parse and validate a file, and keep it as a preview. Nothing is written to the target. Every
   * issue is collected — a person fixes the whole file once, not one error per attempt.
   */
  async preview(
    actor: ActorContext,
    input: { kind: ImportKind; fileName: string },
    bytes: Uint8Array,
    context: RequestContext,
  ): Promise<ImportBatch> {
    if (!(await this.options.importsEnabled())) throw conflict('FEATURE_DISABLED');
    const importer = this.importer(input.kind);
    this.assertCan(actor, importer.permission);
    const { format, table } = await this.readTable(bytes);
    const [header = [], ...body] = table;
    if (body.length > IMPORT_MAX_ROWS) throw invalid('TOO_MANY_ROWS', ['file']);

    const issues: ImportIssue[] = [];
    const known = new Map(importer.columns.map((column) => [headerKey(column.name), column.name]));
    const positions = new Map<string, number>();
    header.forEach((name, index) => {
      const column = known.get(headerKey(name));
      if (!column) issues.push({ row: 1, column: name, code: 'UNKNOWN_COLUMN' });
      else if (positions.has(column))
        issues.push({ row: 1, column: name, code: 'DUPLICATE_COLUMN' });
      else positions.set(column, index);
    });
    for (const column of importer.columns) {
      if (column.required && !positions.has(column.name)) {
        issues.push({ row: 1, column: column.name, code: 'MISSING_COLUMN' });
      }
    }
    if (body.length === 0) issues.push({ row: 2, code: 'NO_ROWS' });

    const valid: { row: number; value: Record<string, unknown> }[] = [];
    const invalidRows = new Set<number>();
    if (issues.length === 0) {
      body.forEach((cells, index) => {
        const row = index + 2;
        const named: Record<string, string> = {};
        for (const [column, position] of positions) named[column] = cells[position] ?? '';
        const result = importer.validateRow(named);
        if (result.issues.length > 0 || !result.value) {
          invalidRows.add(row);
          for (const issue of result.issues) issues.push({ row, ...issue });
        } else {
          valid.push({ row, value: result.value });
        }
      });
      for (const issue of await importer.validateAll(valid)) {
        invalidRows.add(issue.row);
        issues.push(issue);
      }
    }
    issues.sort((a, b) => a.row - b.row);

    const now = this.now();
    const clean = issues.length === 0;
    const document: ImportBatchDocument = {
      batchId: newId('imp'),
      kind: input.kind,
      format,
      fileName: input.fileName,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      state: 'previewed',
      totalRows: body.length,
      invalidRows: clean
        ? 0
        : Math.max(invalidRows.size, issues.some((i) => i.row === 1) ? body.length : 0),
      issues,
      // A batch with any issue keeps no rows: it can never be committed, so it holds nothing to commit.
      rows: clean ? valid.map((entry) => entry.value) : [],
      preview: valid.slice(0, PREVIEW_ROWS).map((entry) => importer.preview(entry.value)),
      createdBy: actor.accountId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + IMPORT_PREVIEW_TTL_HOURS * 3_600_000),
      version: 1,
    };
    await withTransaction(this.options.connection, async (session) => {
      await this.batches.create([document], { session });
      await this.options.audit.record(
        {
          action: IMPORT_AUDIT_ACTIONS.previewed,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'importBatch', id: document.batchId },
          changes: [
            { path: 'kind', to: document.kind },
            { path: 'sha256', to: document.sha256 },
            { path: 'rows', to: String(document.totalRows) },
            { path: 'issues', to: String(issues.length) },
          ],
          context,
        },
        { session },
      );
    });
    return this.toBatch(document);
  }

  private async findOwnBatch(actor: ActorContext, batchId: string): Promise<ImportBatchDocument> {
    const document = await this.batches.findOne({ batchId }).lean<ImportBatchDocument>().exec();
    // Another person's batch is absent, as is a kind the actor may no longer import.
    if (
      !document ||
      document.createdBy !== actor.accountId ||
      !can(actor, this.importer(document.kind).permission)
    ) {
      throw notFound();
    }
    return document;
  }

  async getBatch(actor: ActorContext, batchId: string): Promise<ImportBatch> {
    return this.toBatch(await this.findOwnBatch(actor, batchId));
  }

  /** Every issue of a batch as a formula-safe CSV — the per-row error report (CORE-IMPORT-002). */
  async issueReport(actor: ActorContext, batchId: string): Promise<string> {
    const document = await this.findOwnBatch(actor, batchId);
    return writeCsv(
      ['row', 'column', 'code'],
      document.issues.map((issue) => [issue.row, issue.column ?? '', issue.code]),
    );
  }

  /**
   * Write every row, or nothing (CORE-IMPORT-002). Refused while any row has an issue, after the
   * preview expires, twice, or on a stale version; the importer's writes, the batch's new state and the
   * audit record commit together.
   */
  async commit(
    actor: ActorContext,
    batchId: string,
    expectedVersion: number,
    context: RequestContext,
  ): Promise<ImportBatch> {
    if (!(await this.options.importsEnabled())) throw conflict('FEATURE_DISABLED');
    const document = await this.findOwnBatch(actor, batchId);
    if (document.state !== 'previewed') throw conflict('IMPORT_NOT_PENDING', ['state']);
    if (document.issues.length > 0) throw conflict('IMPORT_HAS_ERRORS');
    if (document.expiresAt <= this.now()) throw conflict('IMPORT_EXPIRED');
    if (document.version !== expectedVersion) throw conflict('STALE_VERSION', ['expectedVersion']);
    const importer = this.importer(document.kind);

    const committed = await withTransaction(this.options.connection, async (session) => {
      const now = this.now();
      const claimed = await this.batches
        .findOneAndUpdate(
          { batchId, version: expectedVersion, state: 'previewed' },
          { $set: { state: 'committed', committedAt: now }, $inc: { version: 1 } },
          { new: true, session },
        )
        .lean<ImportBatchDocument>()
        .exec();
      if (!claimed) throw conflict('STALE_VERSION', ['expectedVersion']);
      await importer.commit(actor, document.rows, session, context);
      await this.options.audit.record(
        {
          action: IMPORT_AUDIT_ACTIONS.committed,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'importBatch', id: batchId },
          changes: [
            { path: 'kind', to: document.kind },
            { path: 'rows', to: String(document.rows.length) },
          ],
          context,
        },
        { session },
      );
      return claimed;
    });
    return this.toBatch(committed);
  }

  async discard(
    actor: ActorContext,
    batchId: string,
    expectedVersion: number,
    context: RequestContext,
  ): Promise<ImportBatch> {
    await this.findOwnBatch(actor, batchId);
    const discarded = await withTransaction(this.options.connection, async (session) => {
      const updated = await this.batches
        .findOneAndUpdate(
          { batchId, version: expectedVersion, state: 'previewed' },
          { $set: { state: 'discarded', discardedAt: this.now(), rows: [] }, $inc: { version: 1 } },
          { new: true, session },
        )
        .lean<ImportBatchDocument>()
        .exec();
      if (!updated) throw conflict('IMPORT_NOT_PENDING', ['state']);
      await this.options.audit.record(
        {
          action: IMPORT_AUDIT_ACTIONS.discarded,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'importBatch', id: batchId },
          context,
        },
        { session },
      );
      return updated;
    });
    return this.toBatch(discarded);
  }

  /* ---------------------------------------------------------------- export */

  /**
   * Export one kind of data as the actor may see it (CORE-IMPORT-003): permission-checked, scoped and
   * field-restricted by the owning module, refused rather than truncated above the bound, written as
   * formula-safe CSV, audited, and returned as a link that expires within minutes.
   */
  async export(
    actor: ActorContext,
    kind: ExportKind,
    context: RequestContext,
  ): Promise<ExportResult> {
    if (!(await this.options.exportsEnabled())) throw conflict('FEATURE_DISABLED');
    const exporter = this.options.exporters.find((candidate) => candidate.kind === kind);
    if (!exporter) throw invalid('EXPORT_KIND_UNAVAILABLE', ['kind']);
    this.assertCan(actor, exporter.permission);

    const { columns, rows } = await exporter.rows(actor, EXPORT_MAX_ROWS + 1);
    if (rows.length > EXPORT_MAX_ROWS) throw invalid('EXPORT_TOO_LARGE');
    const body = new TextEncoder().encode(writeCsv(columns, rows));
    const exportId = newId('exp');
    const storageKey = `exports/${exportId}`;
    await this.options.store.put({ key: storageKey, body, contentType: 'text/csv' });
    const sha256 = createHash('sha256').update(body).digest('hex');
    const now = this.now();

    await withTransaction(this.options.connection, async (session) => {
      await this.exports.create(
        [
          {
            exportId,
            kind,
            rowCount: rows.length,
            columns,
            storageKey,
            sha256,
            createdBy: actor.accountId,
            createdAt: now,
          },
        ],
        { session },
      );
      await this.options.audit.record(
        {
          action: IMPORT_AUDIT_ACTIONS.exported,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'export', id: exportId },
          changes: [
            { path: 'kind', to: kind },
            { path: 'rows', to: String(rows.length) },
            { path: 'columns', to: columns.join(',').slice(0, 400) },
          ],
          context,
        },
        { session },
      );
    });
    const url = await this.options.store.createSignedDownloadUrl(storageKey, this.linkTtl, {
      fileName: `${kind}-${iso(now).slice(0, 10)}.csv`,
      contentType: 'text/csv',
    });
    return ExportResultSchema.parse({
      exportId,
      kind,
      rowCount: rows.length,
      columns,
      url,
      expiresAt: iso(new Date(now.getTime() + this.linkTtl * 1000)),
    });
  }
}
