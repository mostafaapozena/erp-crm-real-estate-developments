import { safePalette, type Palette } from '@alola/ui/brand';
import PDFDocument from 'pdfkit';
import {
  directionOf,
  lineWidth,
  ltrIsolate,
  visualPieces,
  wrap,
  type Direction,
  type Script,
} from './bidi';
import { fontsFor, type FontKey, type Weight } from './fonts';
import type { Block, FieldItem, PdfDocumentModel, TableColumn, TableRow, Tone } from './model';
import { qrMatrix } from './qr';

/**
 * Draw a document model as an A4 PDF (CORE-DOC-003).
 *
 * pdfkit writes the file and embeds (subsets) the fonts; fontkit, inside it, shapes Arabic. Line
 * breaking and bidirectional ordering are this module's: every line is broken here and placed run by
 * run (`bidi.ts`), so nothing depends on pdfkit's Latin-only line wrapper.
 *
 * Layout rules that keep a document readable:
 *
 * - The page is divided into header, body and footer; body content never enters the footer.
 * - A table row is never split across pages; a table continuing on a new page repeats its header.
 * - A field grid row, a notice and a signature row move to the next page whole.
 * - Every value is laid out in its own direction and aligned in its cell (`directionOf`).
 * - Colours are the theme's semantic tokens, derived from the company's validated brand colour.
 */

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = { side: 40, top: 30, bottom: 28 };
const HEADER_HEIGHT = 74;
const FOOTER_HEIGHT = 46;
const BODY_TOP = MARGIN.top + HEADER_HEIGHT + 14;
const BODY_BOTTOM = PAGE.height - MARGIN.bottom - FOOTER_HEIGHT - 8;
const CONTENT_WIDTH = PAGE.width - MARGIN.side * 2;

const LEADING = 1.55;

type Doc = PDFKit.PDFDocument;

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];

/** Only a real PNG or JPEG is drawn; anything else falls back to the monogram, never a broken image. */
export function isDrawableImage(bytes: Buffer | undefined): bytes is Buffer {
  if (!bytes || bytes.length < 8) return false;
  const starts = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  return starts(PNG) || starts(JPEG);
}

class Writer {
  private y = BODY_TOP;
  private readonly dir: Direction;
  private readonly palette: Palette;

  constructor(
    private readonly doc: Doc,
    private readonly model: PdfDocumentModel,
  ) {
    this.dir = model.locale === 'ar' ? 'rtl' : 'ltr';
    this.palette = safePalette(model.company.primaryColor);
    const fonts = fontsFor(model.locale);
    for (const [key, bytes] of Object.entries(fonts)) doc.registerFont(key, bytes);
  }

  /* ------------------------------------------------------------ text */

  private font(script: Script, weight: Weight): FontKey {
    return `${script}-${weight}`;
  }

  private measure(size: number, weight: Weight) {
    return (text: string, script: Script) =>
      this.doc.font(this.font(script, weight)).fontSize(size).widthOfString(text);
  }

  /** Lines a text occupies in `width`, in its own direction. */
  private lines(text: string, width: number, size: number, weight: Weight, dir: Direction) {
    return wrap(text, width, dir, this.measure(size, weight));
  }

  /**
   * Draw one already-broken line between `x0` and `x1`. `align` is logical: `start` is the right edge
   * of a right-to-left document.
   */
  private drawLine(
    text: string,
    x0: number,
    x1: number,
    y: number,
    options: {
      size: number;
      weight?: Weight;
      color?: string;
      dir?: Direction;
      align?: 'start' | 'end' | 'center';
    },
  ): void {
    const weight = options.weight ?? 400;
    const dir = options.dir ?? this.dir;
    const measure = this.measure(options.size, weight);
    const pieces = visualPieces(text, dir);
    const width = lineWidth(pieces, measure);
    const align = options.align ?? 'start';
    // The line's own direction decides nothing about where it sits: the document's does.
    const startsRight = this.dir === 'rtl';
    let x: number;
    if (align === 'center') x = x0 + (x1 - x0 - width) / 2;
    else if ((align === 'start') === startsRight) x = x1 - width;
    else x = x0;
    const space = measure(' ', 'latin');
    this.doc.fillColor(options.color ?? this.palette.mainText);
    for (const piece of pieces) {
      if (piece.kind === 'space') {
        x += space * piece.count;
        continue;
      }
      this.doc
        .font(this.font(piece.script, weight))
        .fontSize(options.size)
        .text(piece.text, x, y, { lineBreak: false });
      x += measure(piece.text, piece.script);
    }
  }

  /** Wrapped text in a box; returns the height used. */
  private drawText(
    text: string,
    x0: number,
    x1: number,
    y: number,
    options: {
      size: number;
      weight?: Weight;
      color?: string;
      dir?: Direction;
      align?: 'start' | 'end' | 'center';
    },
  ): number {
    const weight = options.weight ?? 400;
    const dir = options.dir ?? directionOf(text, this.dir);
    const lines = this.lines(text, x1 - x0, options.size, weight, dir);
    const step = options.size * LEADING;
    lines.forEach((line, index) =>
      this.drawLine(line, x0, x1, y + index * step, { ...options, weight, dir }),
    );
    return lines.length * step;
  }

  private textHeight(text: string, width: number, size: number, weight: Weight = 400, ltr = false) {
    const dir = ltr ? 'ltr' : directionOf(text, this.dir);
    return this.lines(text, width, size, weight, dir).length * size * LEADING;
  }

  /* ------------------------------------------------------------ flow */

  private ensure(height: number): void {
    if (this.y + height <= BODY_BOTTOM) return;
    this.doc.addPage();
    this.y = BODY_TOP;
  }

  /** Column x ranges in document order: the first column is at the start edge. */
  private columns(weights: number[], x0 = MARGIN.side, x1 = PAGE.width - MARGIN.side) {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = 0;
    return weights.map((weight) => {
      const from = cursor / total;
      cursor += weight;
      const to = cursor / total;
      const width = x1 - x0;
      return this.dir === 'rtl'
        ? { x0: x1 - to * width, x1: x1 - from * width }
        : { x0: x0 + from * width, x1: x0 + to * width };
    });
  }

  private toneColors(tone: Tone): { ink: string; soft: string } {
    const p = this.palette;
    switch (tone) {
      case 'info':
        return { ink: p.info, soft: p.infoSoft };
      case 'warning':
        return { ink: p.warning, soft: p.warningSoft };
      case 'danger':
        return { ink: p.error, soft: p.errorSoft };
      case 'success':
        return { ink: p.success, soft: p.successSoft };
      default:
        return { ink: p.secondaryText, soft: p.neutralSoft };
    }
  }

  /* ------------------------------------------------------------ blocks */

  private title(): void {
    const { title, subtitle, status } = this.model;
    const x0 = MARGIN.side;
    const x1 = PAGE.width - MARGIN.side;
    let pillWidth = 0;
    if (status) {
      const measure = this.measure(9, 700);
      const dir = directionOf(status.label, this.dir);
      pillWidth = lineWidth(visualPieces(status.label, dir), measure) + 20;
      const { ink, soft } = this.toneColors(status.tone);
      const px = this.dir === 'rtl' ? x0 : x1 - pillWidth;
      this.doc.roundedRect(px, this.y + 3, pillWidth, 20, 10).fill(soft);
      this.drawLine(status.label, px, px + pillWidth, this.y + 6.5, {
        size: 9,
        weight: 700,
        color: ink,
        dir,
        align: 'center',
      });
    }
    const titleEnd = pillWidth ? pillWidth + 12 : 0;
    const tx0 = this.dir === 'rtl' ? x0 + titleEnd : x0;
    const tx1 = this.dir === 'rtl' ? x1 : x1 - titleEnd;
    this.y += this.drawText(title, tx0, tx1, this.y, { size: 17, weight: 700 });
    if (subtitle) {
      this.y += this.drawText(subtitle, x0, x1, this.y, {
        size: 9.5,
        color: this.palette.secondaryText,
      });
    }
    this.y += 10;
  }

  private heading(text: string): void {
    // A heading never ends a page: it moves on with room for the first lines of what it introduces.
    this.ensure(110);
    this.y += 6;
    const x0 = MARGIN.side;
    const x1 = PAGE.width - MARGIN.side;
    const used = this.drawText(text, x0, x1, this.y, {
      size: 11.5,
      weight: 700,
      color: this.palette.primaryPressed,
    });
    this.y += used + 2;
    this.doc
      .moveTo(x0, this.y)
      .lineTo(x1, this.y)
      .lineWidth(0.6)
      .strokeColor(this.palette.borderSoft)
      .stroke();
    this.y += 8;
  }

  private fields(columns: number, items: FieldItem[]): void {
    const gap = 14;
    for (let start = 0; start < items.length; start += columns) {
      const row = items.slice(start, start + columns);
      const slots = this.columns(Array.from({ length: columns }, () => 1));
      const heights = row.map((item, index) => {
        const slot = slots[index] as { x0: number; x1: number };
        const width = slot.x1 - slot.x0 - gap;
        return (
          this.textHeight(item.label, width, 7.5) +
          this.textHeight(item.value || '—', width, 9.5, 400, item.ltr)
        );
      });
      const height = Math.max(...heights) + 8;
      this.ensure(height);
      row.forEach((item, index) => {
        const slot = slots[index] as { x0: number; x1: number };
        const x0 = this.dir === 'rtl' ? slot.x0 + gap : slot.x0;
        const x1 = this.dir === 'rtl' ? slot.x1 : slot.x1 - gap;
        const labelHeight = this.drawText(item.label, x0, x1, this.y, {
          size: 7.5,
          color: this.palette.mutedText,
        });
        this.drawText(item.value || '—', x0, x1, this.y + labelHeight, {
          size: 9.5,
          ...(item.ltr ? { dir: 'ltr' as const } : {}),
        });
      });
      this.y += height;
    }
    this.y += 4;
  }

  private tableHeader(columns: TableColumn[]): number {
    const slots = this.columns(columns.map((column) => column.weight));
    const pad = 7;
    const height =
      Math.max(
        ...columns.map((column, index) => {
          const slot = slots[index] as { x0: number; x1: number };
          return this.textHeight(column.header, slot.x1 - slot.x0 - pad * 2, 7.8, 700);
        }),
      ) +
      pad * 2;
    this.doc.rect(MARGIN.side, this.y, CONTENT_WIDTH, height).fill(this.palette.primarySoft);
    columns.forEach((column, index) => {
      const slot = slots[index] as { x0: number; x1: number };
      this.drawText(column.header, slot.x0 + pad, slot.x1 - pad, this.y + pad, {
        size: 7.8,
        weight: 700,
        color: this.palette.primaryPressed,
        align: column.align ?? 'start',
      });
    });
    return height;
  }

  private table(columns: TableColumn[], rows: TableRow[], empty?: string): void {
    const slots = this.columns(columns.map((column) => column.weight));
    const pad = 7;
    this.ensure(60);
    this.y += this.tableHeader(columns);
    if (rows.length === 0 && empty) {
      this.y += this.drawText(
        empty,
        MARGIN.side + pad,
        PAGE.width - MARGIN.side - pad,
        this.y + pad,
        {
          size: 9,
          color: this.palette.mutedText,
        },
      );
      this.y += pad * 2;
      return;
    }
    rows.forEach((row, rowIndex) => {
      const weight: Weight = row.tone === 'strong' ? 700 : 400;
      const height =
        Math.max(
          ...row.cells.map((cell, index) => {
            const slot = slots[index] as { x0: number; x1: number };
            const column = columns[index] as TableColumn;
            return this.textHeight(
              cell || ' ',
              slot.x1 - slot.x0 - pad * 2,
              8.8,
              weight,
              column.ltr,
            );
          }),
        ) +
        pad * 2;
      if (this.y + height > BODY_BOTTOM) {
        this.doc.addPage();
        this.y = BODY_TOP;
        this.y += this.tableHeader(columns);
      }
      if (row.tone === 'strong') {
        this.doc.rect(MARGIN.side, this.y, CONTENT_WIDTH, height).fill(this.palette.neutralSoft);
      } else if (rowIndex % 2 === 1) {
        this.doc.rect(MARGIN.side, this.y, CONTENT_WIDTH, height).fill(this.palette.pageBackground);
      }
      const color = row.tone === 'muted' ? this.palette.mutedText : this.palette.mainText;
      row.cells.forEach((cell, index) => {
        const slot = slots[index] as { x0: number; x1: number };
        const column = columns[index] as TableColumn;
        if (!cell) return;
        this.drawText(cell, slot.x0 + pad, slot.x1 - pad, this.y + pad, {
          size: 8.8,
          weight,
          color,
          align: column.align ?? 'start',
          ...(column.ltr ? { dir: 'ltr' as const } : {}),
        });
      });
      this.y += height;
      this.doc
        .moveTo(MARGIN.side, this.y)
        .lineTo(PAGE.width - MARGIN.side, this.y)
        .lineWidth(0.5)
        .strokeColor(this.palette.borderSoft)
        .stroke();
    });
    this.y += 10;
  }

  private notice(tone: Tone, text: string): void {
    const { ink, soft } = this.toneColors(tone);
    const pad = 9;
    const x0 = MARGIN.side;
    const x1 = PAGE.width - MARGIN.side;
    const height = this.textHeight(text, CONTENT_WIDTH - pad * 2 - 4, 9, 700) + pad * 2;
    this.ensure(height + 8);
    this.doc.rect(x0, this.y, CONTENT_WIDTH, height).fill(soft);
    const bar = this.dir === 'rtl' ? x1 - 3 : x0;
    this.doc.rect(bar, this.y, 3, height).fill(ink);
    this.drawText(text, x0 + pad + 4, x1 - pad - 4, this.y + pad, {
      size: 9,
      weight: 700,
      color: ink,
    });
    this.y += height + 8;
  }

  private paragraph(text: string, muted?: boolean): void {
    const height = this.textHeight(text, CONTENT_WIDTH, 9);
    this.ensure(Math.min(height, 60));
    // A long paragraph flows line by line across pages.
    const dir = directionOf(text, this.dir);
    const step = 9 * LEADING;
    for (const line of this.lines(text, CONTENT_WIDTH, 9, 400, dir)) {
      this.ensure(step);
      this.drawLine(line, MARGIN.side, PAGE.width - MARGIN.side, this.y, {
        size: 9,
        dir,
        color: muted ? this.palette.secondaryText : this.palette.mainText,
      });
      this.y += step;
    }
    this.y += 6;
  }

  private signatures(labels: string[]): void {
    const perRow = Math.min(labels.length, 3);
    const gap = 18;
    for (let start = 0; start < labels.length; start += perRow) {
      const row = labels.slice(start, start + perRow);
      const slots = this.columns(Array.from({ length: perRow }, () => 1));
      const height = 78;
      this.ensure(height);
      row.forEach((label, index) => {
        const slot = slots[index] as { x0: number; x1: number };
        const x0 = slot.x0 + (this.dir === 'rtl' ? gap : 0);
        const x1 = slot.x1 - (this.dir === 'rtl' ? 0 : gap);
        this.doc
          .roundedRect(x0, this.y, x1 - x0, 52, 4)
          .lineWidth(0.6)
          .dash(3, { space: 3 })
          .strokeColor(this.palette.borderSubtle)
          .stroke()
          .undash();
        this.drawText(label, x0, x1, this.y + 57, {
          size: 8,
          color: this.palette.secondaryText,
          align: 'center',
        });
      });
      this.y += height;
    }
  }

  private verification(): void {
    const verification = this.model.verification;
    if (!verification) return;
    const size = 78;
    this.ensure(size + 16);
    this.y += 6;
    const x0 = MARGIN.side;
    const x1 = PAGE.width - MARGIN.side;
    const qrX = this.dir === 'rtl' ? x1 - size : x0;
    const matrix = qrMatrix(verification.url);
    // Four modules of quiet zone, as the standard asks, inside the drawn square.
    const cell = size / (matrix.size + 8);
    this.doc.rect(qrX, this.y, size, size).fill('#FFFFFF');
    for (let row = 0; row < matrix.size; row += 1) {
      for (let column = 0; column < matrix.size; column += 1) {
        if (matrix.isDark(row, column)) {
          this.doc
            .rect(qrX + (column + 4) * cell, this.y + (row + 4) * cell, cell, cell)
            .fill('#000000');
        }
      }
    }
    const tx0 = this.dir === 'rtl' ? x0 : x0 + size + 14;
    const tx1 = this.dir === 'rtl' ? x1 - size - 14 : x1;
    let ty = this.y + 6;
    ty += this.drawText(verification.caption, tx0, tx1, ty, { size: 10, weight: 700 });
    ty += this.drawText(verification.hint, tx0, tx1, ty, {
      size: 8,
      color: this.palette.secondaryText,
    });
    ty += this.drawText(verification.url, tx0, tx1, ty, {
      size: 7.5,
      dir: 'ltr',
      color: this.palette.primaryPressed,
    });
    this.drawText(
      `${verification.fingerprintLabel}: ${ltrIsolate(verification.fingerprint)}`,
      tx0,
      tx1,
      ty,
      {
        size: 7.5,
        color: this.palette.mutedText,
      },
    );
    this.y += size + 10;
  }

  /* ------------------------------------------------------------ chrome */

  private header(): void {
    const { company, reference } = this.model;
    const x0 = MARGIN.side;
    const x1 = PAGE.width - MARGIN.side;
    const top = MARGIN.top;
    const mark = 44;
    const markX = this.dir === 'rtl' ? x1 - mark : x0;
    let drewLogo = false;
    if (isDrawableImage(company.logo)) {
      try {
        this.doc.image(company.logo, markX, top, {
          fit: [mark, mark],
          align: 'center',
          valign: 'center',
        });
        drewLogo = true;
      } catch {
        drewLogo = false;
      }
    }
    if (!drewLogo) {
      this.doc.circle(markX + mark / 2, top + mark / 2, mark / 2).fill(this.palette.primary);
      this.drawLine(company.initials, markX, markX + mark, top + mark / 2 - 8, {
        size: 13,
        weight: 700,
        color: this.palette.onPrimary,
        align: 'center',
        dir: directionOf(company.initials, this.dir),
      });
    }
    const nameX0 = this.dir === 'rtl' ? x0 + 170 : x0 + mark + 12;
    const nameX1 = this.dir === 'rtl' ? x1 - mark - 12 : x1 - 170;
    let y = top + 1;
    y += this.drawText(company.name, nameX0, nameX1, y, { size: 12, weight: 700 });
    for (const line of company.lines.slice(0, 3)) {
      y += this.drawText(line, nameX0, nameX1, y, { size: 7.2, color: this.palette.secondaryText });
    }
    // The business reference, at the end edge.
    const refX0 = this.dir === 'rtl' ? x0 : x1 - 160;
    const refX1 = this.dir === 'rtl' ? x0 + 160 : x1;
    const labelHeight = this.drawText(reference.label, refX0, refX1, top + 4, {
      size: 7.5,
      color: this.palette.mutedText,
      align: 'end',
    });
    this.drawText(reference.value, refX0, refX1, top + 4 + labelHeight, {
      size: 10.5,
      weight: 700,
      align: 'end',
      dir: 'ltr',
    });
    const rule = MARGIN.top + HEADER_HEIGHT;
    this.doc.rect(x0, rule, CONTENT_WIDTH, 1.6).fill(this.palette.primary);
  }

  private footer(page: number, total: number): void {
    const x0 = MARGIN.side;
    const x1 = PAGE.width - MARGIN.side;
    const top = PAGE.height - MARGIN.bottom - FOOTER_HEIGHT;
    this.doc
      .moveTo(x0, top)
      .lineTo(x1, top)
      .lineWidth(0.6)
      .strokeColor(this.palette.borderSoft)
      .stroke();
    let y = top + 5;
    const pageText = this.model.pageLabel(page, total);
    const pageWidth = 90;
    const textX0 = this.dir === 'rtl' ? x0 + pageWidth : x0;
    const textX1 = this.dir === 'rtl' ? x1 : x1 - pageWidth;
    if (this.model.company.footer) {
      y += this.drawText(this.model.company.footer, textX0, textX1, y, {
        size: 7,
        color: this.palette.secondaryText,
      });
    }
    if (this.model.footerNote) {
      this.drawText(this.model.footerNote, textX0, textX1, y, {
        size: 7,
        color: this.palette.mutedText,
      });
    }
    const px0 = this.dir === 'rtl' ? x0 : x1 - pageWidth;
    this.drawLine(pageText, px0, px0 + pageWidth, top + 5, {
      size: 7.5,
      color: this.palette.mutedText,
      align: 'end',
    });
  }

  private watermark(): void {
    const text = this.model.watermark;
    if (!text) return;
    this.doc.save();
    this.doc.rotate(-32, { origin: [PAGE.width / 2, PAGE.height / 2] });
    this.doc.fillOpacity(0.07);
    this.drawLine(text, 0, PAGE.width, PAGE.height / 2 - 40, {
      size: 78,
      weight: 700,
      color: this.palette.error,
      align: 'center',
      dir: directionOf(text, this.dir),
    });
    this.doc.restore();
  }

  /* ------------------------------------------------------------ run */

  render(): void {
    this.title();
    for (const block of this.model.blocks) this.block(block);
    this.verification();
    const range = this.doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      this.doc.switchToPage(index);
      this.watermark();
      this.header();
      this.footer(index - range.start + 1, range.count);
    }
  }

  private block(block: Block): void {
    switch (block.kind) {
      case 'heading':
        this.heading(block.text);
        return;
      case 'fields':
        this.fields(block.columns, block.items);
        return;
      case 'table':
        this.table(block.columns, block.rows, block.empty);
        return;
      case 'notice':
        this.notice(block.tone, block.text);
        return;
      case 'paragraph':
        this.paragraph(block.text, block.muted);
        return;
      case 'signatures':
        this.signatures(block.labels);
        return;
    }
  }
}

const ARABIC_LETTER = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;

/**
 * Make copied and searched Arabic read in the right order.
 *
 * A ligature (lam-alef, and Alexandria's `تر`, `مح` …) is one glyph standing for several letters, and
 * the PDF's Unicode map lists them in logical order. A reader extracting right-to-left text reverses
 * the whole run to recover reading order — and so reverses the letters inside every ligature too:
 * `لا` came back as `ال`. Listing a ligature's letters in **visual** order makes that reversal restore
 * them. The drawing is untouched; only the text a reader extracts changes.
 *
 * This reads pdfkit's per-font glyph-to-Unicode table (`_fontFamilies[…].unicode`), which is not public
 * API. pdfkit is pinned (0.20.2), the access is guarded, and `pdf.test.ts` extracts ligature words, so
 * an upgrade that moves the table fails a test instead of silently degrading the text.
 */
function orderLigaturesForExtraction(doc: Doc): void {
  const families = (doc as unknown as { _fontFamilies?: Record<string, unknown> })._fontFamilies;
  if (!families) return;
  for (const font of Object.values(families)) {
    const unicode = (font as { unicode?: unknown }).unicode;
    if (!Array.isArray(unicode)) continue;
    for (let gid = 0; gid < unicode.length; gid += 1) {
      const codePoints: unknown = unicode[gid];
      if (!Array.isArray(codePoints) || codePoints.length < 2) continue;
      const letters = codePoints.map((point) => String.fromCodePoint(point as number));
      if (letters.every((letter) => ARABIC_LETTER.test(letter))) {
        unicode[gid] = (codePoints as number[]).slice().reverse();
      }
    }
  }
}

export interface RenderedPdf {
  bytes: Buffer;
  pages: number;
}

/** Render a model to PDF bytes. Pure apart from the fonts it reads. */
export async function renderPdf(model: PdfDocumentModel): Promise<RenderedPdf> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    bufferPages: true,
    autoFirstPage: true,
    lang: model.locale,
    displayTitle: true,
    info: {
      Title: model.meta.title,
      Subject: model.meta.subject,
      Author: model.company.name,
      Creator: 'Real Estate ERP',
      CreationDate: model.meta.creationDate,
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve());
    doc.on('error', reject);
  });
  const writer = new Writer(doc, model);
  writer.render();
  const pages = doc.bufferedPageRange().count;
  orderLigaturesForExtraction(doc);
  doc.end();
  await finished;
  return { bytes: Buffer.concat(chunks), pages };
}
