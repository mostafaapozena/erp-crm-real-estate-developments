/**
 * CSV reading and writing for import and export (CORE-IMPORT-001, CORE-IMPORT-003).
 *
 * Reading follows RFC 4180: quoted fields may hold separators, doubled quotes and line breaks; CRLF
 * and LF both end a record; a UTF-8 byte-order mark is dropped. A malformed file — an unterminated
 * quote, or text after a closing quote — is refused rather than guessed at, because a guessed column
 * boundary silently shifts every value after it.
 *
 * Writing is **formula-safe**. A spreadsheet treats a cell beginning with `=`, `+`, `-`, `@`, a tab or
 * a carriage return as a formula, so an exported customer name like `=HYPERLINK(...)` would run when
 * someone opens the file (CSV injection). Such a cell is prefixed with an apostrophe, which every
 * spreadsheet displays as plain text. The file starts with a byte-order mark so Excel reads Arabic as
 * UTF-8.
 */

export class CsvFormatError extends Error {
  readonly code = 'CSV_MALFORMED';
  constructor(readonly line: number) {
    super(`The CSV file is malformed near line ${String(line)}.`);
    this.name = 'CsvFormatError';
  }
}

/** Parse CSV text into rows of cells. Empty trailing lines are ignored. */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let afterQuote = false;
  let line = 1;

  const endCell = () => {
    row.push(cell);
    cell = '';
    afterQuote = false;
  };
  const endRow = () => {
    endCell();
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        if (char === '\n') line += 1;
        cell += char;
      }
      continue;
    }
    if (char === ',') {
      endCell();
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      endRow();
      line += 1;
    } else if (char === '"') {
      if (cell.length > 0 || afterQuote) throw new CsvFormatError(line);
      quoted = true;
    } else {
      if (afterQuote) throw new CsvFormatError(line);
      cell += char;
    }
  }
  if (quoted) throw new CsvFormatError(line);
  if (cell.length > 0 || row.length > 0 || afterQuote) endRow();
  return rows;
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell, neutralized against formula execution and quoted when it needs to be. */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A whole CSV document: header then rows, CRLF line endings, UTF-8 byte-order mark. */
export function writeCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | boolean | null | undefined)[])[],
): string {
  const lines = [header, ...rows].map((cells) => cells.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
