import { describe, expect, it } from 'vitest';
import { CsvFormatError, csvCell, parseCsv, writeCsv } from './csv';

describe('parseCsv (CORE-IMPORT-001)', () => {
  it('reads quoted separators, doubled quotes, line breaks, CRLF and a byte-order mark', () => {
    const text = '\uFEFFcode,label\r\n"a,b","say ""hi"""\r\nc,"two\nlines"\n\n';
    expect(parseCsv(text)).toEqual([
      ['code', 'label'],
      ['a,b', 'say "hi"'],
      ['c', 'two\nlines'],
    ]);
  });

  it('keeps Arabic text and empty cells exactly', () => {
    expect(parseCsv('رمز,اسم\nx,,')).toEqual([
      ['رمز', 'اسم'],
      ['x', '', ''],
    ]);
  });

  it('refuses a malformed file instead of guessing where a column ends', () => {
    expect(() => parseCsv('a,"open\nb,c')).toThrow(CsvFormatError);
    expect(() => parseCsv('a,"closed"tail')).toThrow(CsvFormatError);
    expect(() => parseCsv('a,mid"quote')).toThrow(CsvFormatError);
  });
});

describe('writeCsv (CORE-IMPORT-003)', () => {
  it('neutralizes every formula prefix', () => {
    for (const value of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) {
      expect(csvCell(value).replace(/^"/, '').startsWith("'")).toBe(true);
    }
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(undefined)).toBe('');
  });

  it('round-trips through the parser, Arabic included', () => {
    const csv = writeCsv(
      ['code', 'name'],
      [
        ['A-1', 'شقة "أ"'],
        ['B-2', 'line\nbreak'],
      ],
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(parseCsv(csv)).toEqual([
      ['code', 'name'],
      ['A-1', 'شقة "أ"'],
      ['B-2', 'line\nbreak'],
    ]);
  });
});
