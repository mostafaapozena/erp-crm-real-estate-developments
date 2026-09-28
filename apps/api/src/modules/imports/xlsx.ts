import { readSheet } from 'read-excel-file/node';

/**
 * The first worksheet of an `.xlsx` file as rows of cells (CORE-IMPORT-001).
 *
 * The bytes are handed over as a `Buffer` — **never** a string, which this library would read as a
 * file path. Formulas are not evaluated: a cell yields the value the workbook stored, so an uploaded
 * workbook cannot run anything here.
 */
export async function readFirstSheet(bytes: Uint8Array): Promise<unknown[][]> {
  return readSheet(Buffer.from(bytes));
}
