import {
  LEAD_IMPORT_COLUMNS,
  LEAD_SOURCES,
  EnteredNameSchema,
  NoteSchema,
  PhoneSchema,
  normalizePhone,
  type ActorContext,
  type ImportIssue,
  type LeadSource,
} from '@alola/contracts';
import type { ClientSession } from 'mongoose';
import { z } from 'zod';
import type { RequestContext } from '../../platform/audit-port';
import type { CrmService } from './service';

/** One validated row of a leads file, with its branch resolved. */
export interface LeadImportRow extends Record<string, unknown> {
  name: string;
  primaryPhone: string;
  secondaryPhone?: string;
  email?: string;
  source: LeadSource;
  branchCode: string;
  branchId?: string;
  legalEntityId?: string;
  notes?: string;
  /** Set when an open lead in the same legal entity already has this phone — shown, not refused. */
  possibleDuplicate?: boolean;
}

export type BranchCodeResolver = (
  code: string,
) => Promise<{ branchId: string; legalEntityId: string } | undefined>;

const EmailSchema = z.string().trim().email().max(254);

/**
 * The leads importer (CRM-LEAD-006) on the CORE-IMPORT mechanism: every row validated before anything
 * is written, errors by row and column, and a commit that writes all rows in one transaction or none.
 *
 * Two duplicate rules, deliberately different (`BD-26`): the same phone **twice in one file** is an
 * error — it is almost always a paste mistake — while a phone already held by an open lead is only
 * **marked** in the preview, because a lead with a shared number is still a lead.
 */
export function leadImporter(getService: () => CrmService, resolveBranchCode: BranchCodeResolver) {
  return {
    kind: 'leads' as const,
    permission: 'crm.lead.import' as const,
    columns: LEAD_IMPORT_COLUMNS,

    validateRow(cells: Record<string, string>) {
      const issues: Omit<ImportIssue, 'row'>[] = [];
      const name = EnteredNameSchema.safeParse(cells['name'] ?? '');
      if (!name.success) issues.push({ column: 'name', code: 'NAME_EXPECTED' });
      const phone = PhoneSchema.safeParse(cells['primary_phone'] ?? '');
      if (!phone.success) issues.push({ column: 'primary_phone', code: 'PHONE_EXPECTED' });
      const secondaryCell = cells['secondary_phone'] ?? '';
      const secondary = secondaryCell ? PhoneSchema.safeParse(secondaryCell) : undefined;
      if (secondary && !secondary.success) {
        issues.push({ column: 'secondary_phone', code: 'PHONE_EXPECTED' });
      }
      const emailCell = cells['email'] ?? '';
      const email = emailCell ? EmailSchema.safeParse(emailCell) : undefined;
      if (email && !email.success) issues.push({ column: 'email', code: 'EMAIL_EXPECTED' });
      const source = cells['source'] ?? '';
      if (!(LEAD_SOURCES as readonly string[]).includes(source)) {
        issues.push({ column: 'source', code: 'UNKNOWN_SOURCE' });
      }
      const branchCode = (cells['branch_code'] ?? '').trim();
      if (!branchCode) issues.push({ column: 'branch_code', code: 'REQUIRED' });
      const notesCell = cells['notes'] ?? '';
      const notes = notesCell ? NoteSchema.safeParse(notesCell) : undefined;
      if (notes && !notes.success) issues.push({ column: 'notes', code: 'TOO_LONG' });
      if (issues.length > 0 || !name.success || !phone.success) return { issues };
      const value: LeadImportRow = {
        name: name.data,
        primaryPhone: phone.data,
        ...(secondary?.success ? { secondaryPhone: secondary.data } : {}),
        ...(email?.success ? { email: email.data } : {}),
        source: source as LeadSource,
        branchCode,
        ...(notes?.success && notes.data ? { notes: notes.data } : {}),
      };
      return { value, issues };
    },

    async validateAll(rows: readonly { row: number; value: LeadImportRow }[]) {
      const issues: ImportIssue[] = [];
      const seen = new Map<string, number>();
      const branches = new Map<string, Awaited<ReturnType<BranchCodeResolver>>>();
      for (const { row, value } of rows) {
        if (!branches.has(value.branchCode)) {
          branches.set(value.branchCode, await resolveBranchCode(value.branchCode));
        }
        const branch = branches.get(value.branchCode);
        if (!branch) {
          issues.push({ row, column: 'branch_code', code: 'UNKNOWN_BRANCH' });
          continue;
        }
        value.branchId = branch.branchId;
        value.legalEntityId = branch.legalEntityId;
        const key = `${branch.legalEntityId}|${normalizePhone(value.primaryPhone)}`;
        if (seen.has(key)) issues.push({ row, column: 'primary_phone', code: 'DUPLICATE_IN_FILE' });
        seen.set(key, row);
      }
      const marked = await getService().markExistingLeadPhones(rows.map((entry) => entry.value));
      for (const value of marked) value.possibleDuplicate = true;
      return issues;
    },

    preview(value: LeadImportRow) {
      return {
        name: value.name,
        primary_phone: value.primaryPhone,
        source: value.source,
        branch_code: value.branchCode,
        possible_duplicate: value.possibleDuplicate ? 'yes' : 'no',
      };
    },

    commit(
      actor: ActorContext,
      rows: readonly LeadImportRow[],
      session: ClientSession,
      context: RequestContext,
    ) {
      return getService().importLeads(actor, rows, session, context);
    },
  };
}
