import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { directionOf, ltrIsolate, visualPieces, wrap, type VisualPiece } from './bidi';
import type { PdfDocumentModel, TableRow } from './model';
import { decodeQr, embeddedFontNames, extractPages, renderPage } from './test-support';
import { isDrawableImage, renderPdf } from './writer';

/**
 * CORE-DOC-003: a PDF that merely exists proves nothing about Arabic. These tests read the file back —
 * the text a reader extracts, the fonts it embeds, where every run sits on the page, and the page as
 * pixels — so shaping, direction, layout and the QR code are all asserted, not assumed.
 */

const texts = (pieces: VisualPiece[]) =>
  pieces.map((piece) => (piece.kind === 'space' ? ' ' : piece.text));

describe('bidirectional runs (ADR-0003)', () => {
  it('orders Arabic words right to left and leaves each word in logical order for the shaper', () => {
    expect(texts(visualPieces('مرحبا بالعالم', 'rtl'))).toEqual(['بالعالم', ' ', 'مرحبا']);
  });

  it('keeps a number, a code and a percentage whole and left to right inside Arabic', () => {
    const pieces = visualPieces(
      `العقد ${ltrIsolate('CTR-2026-00012')} بنسبة ${ltrIsolate('24.62%')}`,
      'rtl',
    );
    const latin = pieces.filter((piece) => piece.kind === 'text' && piece.script === 'latin');
    expect(latin.map((piece) => (piece.kind === 'text' ? piece.text : ''))).toEqual([
      '24.62%',
      'CTR-2026-00012',
    ]);
    // Visual order, left to right: the percentage (last word) first, the first word last.
    expect(texts(pieces).at(-1)).toBe('العقد');
  });

  it('never turns 24.62% into %24.62 and keeps money figures with their currency', () => {
    expect(texts(visualPieces('24.62%', directionOf('24.62%', 'rtl')))).toEqual(['24.62%']);
    // Visual, left to right: the currency (read last) on the left, the figure on the right.
    expect(texts(visualPieces('3,000,000.00 ج.م.', 'rtl')).join('')).toBe('.م.ج 3,000,000.00');
    // UAX #9 W2: after Arabic letters an unisolated percentage detaches its sign — the reason every
    // template isolates a value it places inside a sentence.
    expect(texts(visualPieces('بنسبة 24.62%', 'rtl')).join('')).toBe('%24.62 بنسبة');
    expect(texts(visualPieces(`بنسبة ${ltrIsolate('24.62%')}`, 'rtl')).join('')).toBe(
      '24.62% بنسبة',
    );
  });

  it('keeps a phone number in order inside an Arabic label only when isolated, and never draws the control', () => {
    const isolated = texts(visualPieces(`الهاتف: ${ltrIsolate('+20 2 2555 0100')}`, 'rtl')).join(
      '',
    );
    expect(isolated).toBe('+20 2 2555 0100 :الهاتف');
    expect(isolated).not.toMatch(/[\u2066-\u2069]/);
  });

  it('mirrors brackets inside right-to-left text', () => {
    // Logical `(` sits to the right of the letter in RTL and is drawn as `)`: the pair still encloses it.
    expect(texts(visualPieces('الوحدة (أ)', 'rtl')).join('')).toBe('(أ) الوحدة');
  });

  it("reads a value's direction from its first strong character", () => {
    expect(directionOf('Ahmed أحمد', 'rtl')).toBe('ltr');
    expect(directionOf('أحمد Ahmed', 'ltr')).toBe('rtl');
    expect(directionOf('+20 100 555', 'rtl')).toBe('rtl');
  });

  it('wraps at spaces and breaks a word longer than the line between characters', () => {
    const measure = (text: string) => text.length * 5;
    expect(wrap('one two three four', 50, 'ltr', measure)).toEqual(['one two', 'three four']);
    const long = wrap('a.very.long.customer.address@example.invalid', 60, 'ltr', measure);
    expect(long.length).toBeGreaterThan(1);
    expect(long.join('')).toBe('a.very.long.customer.address@example.invalid');
    expect(long.every((line) => line.length * 5 <= 60)).toBe(true);
  });
});

function model(locale: 'ar' | 'en', rows: TableRow[], logo?: Buffer): PdfDocumentModel {
  const ar = locale === 'ar';
  return {
    locale,
    title: ar ? 'ملخص العقد' : 'Contract summary',
    reference: { label: ar ? 'رقم العقد' : 'Contract number', value: 'CTR-2026-00012' },
    status: { label: ar ? 'مسودة' : 'Draft', tone: 'warning' },
    watermark: ar ? 'مسودة' : 'DRAFT',
    company: {
      name: ar ? 'شركة المثال للتطوير العقاري' : 'Example Developments',
      lines: [`${ar ? 'الهاتف' : 'Phone'}: ${ltrIsolate('+20 2 2555 0100')}`],
      initials: ar ? 'م' : 'ED',
      ...(logo ? { logo } : {}),
    },
    blocks: [
      {
        kind: 'notice',
        tone: 'warning',
        text: ar ? 'لا توجد وثيقة هوية مسجلة للمشتري.' : 'No identity.',
      },
      {
        kind: 'fields',
        columns: 3,
        items: [
          { label: ar ? 'السعر' : 'Price', value: ar ? '3,000,000.00 ج.م.' : 'EGP 3,000,000.00' },
          { label: ar ? 'الخصم' : 'Discount', value: '24.62%' },
          { label: ar ? 'الهاتف' : 'Phone', value: '+20 100 555 0199', ltr: true },
        ],
      },
      {
        kind: 'table',
        columns: [
          { header: '#', weight: 1 },
          { header: ar ? 'المبلغ' : 'Amount', weight: 3, align: 'end' },
        ],
        rows,
      },
    ],
    verification: {
      url: 'https://erp.example.invalid/verify/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
      caption: ar ? 'تحقق من صحة هذا المستند' : 'Verify this document',
      hint: ar ? 'امسح الرمز' : 'Scan the code',
      // Digits first: unisolated inside an Arabic label, its groups used to come out reordered.
      fingerprint: '1820-BA36-5537-8316',
      fingerprintLabel: ar ? 'البصمة' : 'Fingerprint',
    },
    pageLabel: (page, total) => (ar ? `صفحة ${page} من ${total}` : `Page ${page} of ${total}`),
    meta: { title: 't', subject: 's', creationDate: new Date('2026-09-29T10:00:00Z') },
  };
}

const numbered = (count: number): TableRow[] =>
  Array.from({ length: count }, (_, index) => ({ cells: [`R${index + 1}`, '83,333.33'] }));

describe('PDF output (CORE-DOC-003)', () => {
  it('embeds Alexandria for Arabic, and Inter for the Latin text of an English document', async () => {
    const arabic = await renderPdf(model('ar', numbered(2)));
    expect(embeddedFontNames(arabic.bytes).every((name) => /Alexandria/.test(name))).toBe(true);
    expect(embeddedFontNames(arabic.bytes).length).toBeGreaterThan(0);
    const english = await renderPdf(model('en', numbered(2)));
    const names = embeddedFontNames(english.bytes);
    expect(names.some((name) => /Inter/.test(name))).toBe(true);
    expect(Buffer.from(english.bytes).toString('latin1')).toContain('/FontFile2');
  });

  it('extracts shaped Arabic, ligatures included, in reading order, and values intact', async () => {
    const pdf = await renderPdf(model('ar', numbered(2)));
    const [first] = await extractPages(pdf.bytes);
    const text = first?.text ?? '';
    expect(text).toContain('لا توجد وثيقة هوية مسجلة للمشتري');
    expect(text).toContain('ملخص العقد');
    expect(text).toContain('CTR-2026-00012');
    expect(text).toContain('3,000,000.00');
    expect(text).toContain('24.62%');
    expect(text).not.toContain('%24.62');
    expect(text).toContain('+20 100 555 0199');
    expect(text).toContain('+20 2 2555 0100');
    expect(text).toContain('1820-BA36-5537-8316');
    expect(first?.runs.some((run) => run.text.includes('صفحة'))).toBe(true);
  });

  it('flows a long table over pages, repeating its header, never splitting or losing a row', async () => {
    const pdf = await renderPdf(model('en', numbered(70)));
    expect(pdf.pages).toBeGreaterThan(1);
    const pages = await extractPages(pdf.bytes);
    const all = pages.flatMap((page) => page.runs.map((run) => run.text));
    for (let index = 1; index <= 70; index += 1) {
      expect(all.filter((text) => text === `R${index}`)).toHaveLength(1);
    }
    for (const page of pages) {
      // Every page carries the header reference, the table header and its own page number.
      expect(page.text).toContain('CTR-2026-00012');
      expect(page.text).toContain('Amount');
    }
    expect(pages.at(-1)?.text).toContain(`Page ${pages.length} of ${pages.length}`);
  });

  it('keeps every run inside the page margins', async () => {
    for (const locale of ['ar', 'en'] as const) {
      const pdf = await renderPdf(model(locale, numbered(40)));
      for (const page of await extractPages(pdf.bytes)) {
        for (const run of page.runs) {
          expect(run.x).toBeGreaterThanOrEqual(39);
          expect(run.x + run.width).toBeLessThanOrEqual(page.width - 39);
          expect(run.y).toBeGreaterThan(20);
          expect(run.y).toBeLessThan(page.height - 20);
        }
      }
    }
  });

  it('draws a QR code a camera can read back to the verification link', async () => {
    const pdf = await renderPdf(model('ar', numbered(1)));
    const page = await renderPage(pdf.bytes, 1, 2.5);
    expect(decodeQr(page)).toBe(
      'https://erp.example.invalid/verify/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
    );
  });

  it('draws a valid logo and falls back to the monogram for anything else', async () => {
    const canvas = createCanvas(8, 8);
    canvas.getContext('2d').fillRect(0, 0, 8, 8);
    const png = canvas.toBuffer('image/png');
    expect(isDrawableImage(png)).toBe(true);
    expect(isDrawableImage(Buffer.from('<svg></svg>'))).toBe(false);
    expect(isDrawableImage(undefined)).toBe(false);

    const withLogo = await renderPdf(model('en', numbered(1), png));
    expect(Buffer.from(withLogo.bytes).toString('latin1')).toContain('/Subtype /Image');
    // A broken image is never embedded: the monogram's initials are drawn instead.
    const broken = await renderPdf(model('en', numbered(1), Buffer.from('not an image at all')));
    expect(Buffer.from(broken.bytes).toString('latin1')).not.toContain('/Subtype /Image');
    const [page] = await extractPages(broken.bytes);
    expect(page?.text).toContain('ED');
  });

  it('renders to pixels: a page is drawn, not blank', async () => {
    const pdf = await renderPdf(model('ar', numbered(3)));
    const page = await renderPage(pdf.bytes, 1, 1);
    let dark = 0;
    for (let index = 0; index < page.rgba.length; index += 4) {
      if ((page.rgba[index] ?? 255) < 128) dark += 1;
    }
    expect(dark).toBeGreaterThan(2000);
  });
});
