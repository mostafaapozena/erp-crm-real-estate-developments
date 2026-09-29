import type { Locale } from '@alola/contracts';

/**
 * What a generated document says, independent of how it is drawn (CORE-DOC-003).
 *
 * Every business document — quotation, reservation, contract summary, schedule, receipt, statement —
 * is expressed in these few blocks, and one writer draws them. Text arrives **already translated and
 * formatted** (money, dates, percentages with Western digits, SD-23); the writer only places it, in
 * the document's direction, and never re-formats a value.
 */

export type Tone = 'neutral' | 'info' | 'warning' | 'danger' | 'success';

export interface FieldItem {
  label: string;
  value: string;
  /**
   * Force left-to-right: codes, phone numbers, e-mail addresses and identifiers are drawn exactly as
   * stored, never reordered by the Arabic around them (I18N, `LtrIsolate` on the web).
   */
  ltr?: boolean;
}

export interface TableColumn {
  header: string;
  /** Relative width. */
  weight: number;
  /** `end` for amounts and dates, so figures line up. */
  align?: 'start' | 'end';
  ltr?: boolean;
}

export interface TableRow {
  cells: string[];
  /** `muted` for a row that no longer counts (a rescheduled instalment), `strong` for totals. */
  tone?: 'muted' | 'strong';
}

export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'fields'; columns: 2 | 3; items: FieldItem[] }
  | { kind: 'table'; columns: TableColumn[]; rows: TableRow[]; empty?: string }
  | { kind: 'notice'; tone: Tone; text: string }
  | { kind: 'paragraph'; text: string; muted?: boolean }
  | { kind: 'signatures'; labels: string[] };

export interface CompanyBlock {
  name: string;
  /** Legal name, registration numbers, address and contact — each already labelled. */
  lines: string[];
  footer?: string;
  /** A PNG or JPEG; anything else is ignored and the monogram drawn instead. */
  logo?: Buffer;
  initials: string;
  /** The brand colour, validated by the company profile (THEME-013). */
  primaryColor?: string;
}

export interface VerificationBlock {
  url: string;
  caption: string;
  hint: string;
  /** A short, safe fingerprint of the issued document — never a personal detail. */
  fingerprint: string;
  fingerprintLabel: string;
}

export interface PdfDocumentModel {
  locale: Locale;
  title: string;
  subtitle?: string;
  reference: { label: string; value: string };
  status?: { label: string; tone: Tone };
  /** Printed diagonally on every page — "Draft", "Cancelled". */
  watermark?: string;
  company: CompanyBlock;
  blocks: Block[];
  verification?: VerificationBlock;
  /** One line above the page number on every page — what kind of document this is and is not. */
  footerNote?: string;
  pageLabel: (page: number, total: number) => string;
  meta: { title: string; subject: string; creationDate: Date };
}
