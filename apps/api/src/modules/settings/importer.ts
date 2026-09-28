import {
  BOUND_REFERENCE_LISTS,
  REFERENCE_IMPORT_COLUMNS,
  REFERENCE_LISTS,
  ReferenceCodeSchema,
  type ActorContext,
  type CreateReferenceItem,
  type ImportIssue,
  type ReferenceList,
} from '@alola/contracts';
import type { ClientSession } from 'mongoose';
import type { RequestContext } from '../../platform/audit-port';
import type { SettingsService } from './service';

/**
 * Reference data from a spreadsheet (CORE-IMPORT-001, PLAT-025) — the first thing a new client
 * deployment usually loads: its loss reasons, cancellation reasons, document types.
 *
 * Only **open** lists accept new items. A bound list's codes are the product's own and are relabelled,
 * never added to, so a row for one is refused rather than silently ignored.
 */
export type ReferenceImportRow = CreateReferenceItem & { list: ReferenceList };

const OPEN_LISTS = REFERENCE_LISTS.filter((list) => BOUND_REFERENCE_LISTS[list] === undefined);

export { REFERENCE_IMPORT_COLUMNS };

export function referenceItemImporter(getService: () => SettingsService) {
  return {
    kind: 'referenceItems' as const,
    permission: 'referenceData.manage' as const,
    columns: REFERENCE_IMPORT_COLUMNS,

    validateRow(cells: Record<string, string>) {
      const issues: Omit<ImportIssue, 'row'>[] = [];
      const list = cells['list'] ?? '';
      if (!(REFERENCE_LISTS as readonly string[]).includes(list)) {
        issues.push({ column: 'list', code: 'UNKNOWN_LIST' });
      } else if (!(OPEN_LISTS as readonly string[]).includes(list)) {
        issues.push({ column: 'list', code: 'LIST_BOUND_TO_PRODUCT' });
      }
      const code = ReferenceCodeSchema.safeParse(cells['code'] ?? '');
      if (!code.success) issues.push({ column: 'code', code: 'REFERENCE_CODE_EXPECTED' });
      const text = (column: string, required: boolean) => {
        const value = cells[column] ?? '';
        if (!value) {
          if (required) issues.push({ column, code: 'REQUIRED' });
          return undefined;
        }
        const limit = column.startsWith('label') ? 120 : 500;
        if (value.length > limit) issues.push({ column, code: 'TOO_LONG' });
        return value;
      };
      const labelAr = text('label_ar', true);
      const labelEn = text('label_en', true);
      const descriptionAr = text('description_ar', false);
      const descriptionEn = text('description_en', false);
      // Every text ships in both languages (I18N-001): one description without the other is refused.
      if ((descriptionAr === undefined) !== (descriptionEn === undefined)) {
        issues.push({
          column: descriptionAr === undefined ? 'description_ar' : 'description_en',
          code: 'BOTH_LANGUAGES_REQUIRED',
        });
      }
      let sortOrder = 100;
      const order = cells['sort_order'] ?? '';
      if (order) {
        if (!/^\d{1,5}$/.test(order) || Number(order) > 10_000) {
          issues.push({ column: 'sort_order', code: 'SORT_ORDER_EXPECTED' });
        } else {
          sortOrder = Number(order);
        }
      }
      if (issues.length > 0 || !code.success || !labelAr || !labelEn) return { issues };
      const value: ReferenceImportRow = {
        list: list as ReferenceList,
        code: code.data,
        label: { ar: labelAr, en: labelEn },
        ...(descriptionAr && descriptionEn
          ? { description: { ar: descriptionAr, en: descriptionEn } }
          : {}),
        sortOrder,
      };
      return { value, issues };
    },

    /** A code may appear once per list in the file, and must not already exist. */
    async validateAll(rows: readonly { row: number; value: ReferenceImportRow }[]) {
      const issues: ImportIssue[] = [];
      const seen = new Set<string>();
      const stored = new Map<ReferenceList, Set<string>>();
      for (const { row, value } of rows) {
        const key = `${value.list}\u0000${value.code}`;
        if (seen.has(key)) issues.push({ row, column: 'code', code: 'DUPLICATE_IN_FILE' });
        seen.add(key);
        if (!stored.has(value.list)) {
          stored.set(value.list, await getService().storedCodes(value.list));
        }
        if (stored.get(value.list)?.has(value.code)) {
          issues.push({ row, column: 'code', code: 'CODE_TAKEN' });
        }
      }
      return issues;
    },

    preview(value: ReferenceImportRow): Record<string, string> {
      return {
        list: value.list,
        code: value.code,
        label_ar: value.label.ar,
        label_en: value.label.en,
        sort_order: String(value.sortOrder),
      };
    },

    commit(
      actor: ActorContext,
      rows: readonly ReferenceImportRow[],
      session: ClientSession,
      context: RequestContext,
    ) {
      return getService().importItems(actor, rows, session, context);
    },
  };
}
