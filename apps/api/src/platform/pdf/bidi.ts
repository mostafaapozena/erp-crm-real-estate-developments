import bidiFactory from 'bidi-js';

/**
 * Bidirectional text for PDF output (CORE-DOC-003, ADR-0003).
 *
 * A PDF has no text engine: every run is placed at an explicit position, in **visual** order. This
 * module turns logical text — what the database stores and a person types — into the runs a page
 * draws, using the Unicode Bidirectional Algorithm (UAX #9) through `bidi-js`:
 *
 * - Arabic letters are handed to the font engine in **logical** order: fontkit shapes them (initial,
 *   medial, final forms, lam-alef) and reverses them itself.
 * - Everything else — Latin, digits, punctuation — is handed over in visual order, with mirrored
 *   brackets inside right-to-left text.
 * - Spaces are never drawn; they become advances, because the Arabic font subset has no space glyph.
 *
 * Pure: no PDF, no fonts. Widths come from a `measure` function, so layout is testable on its own.
 */

const bidi = bidiFactory();

export type Direction = 'rtl' | 'ltr';
export type Script = 'arabic' | 'latin';

/** Arabic, Arabic Supplement, Extended-A, presentation forms. */
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
/** Characters with a strong direction, for picking a value's own direction. */
const STRONG_RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const STRONG_LTR = /[A-Za-z\u00C0-\u024F]/;

/** Bidi controls: they steer ordering and are never drawn (LRM, RLM, ALM, embeddings, isolates). */
const CONTROL = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/;

/**
 * Wrap a value that must read left to right — a number, an amount, a percentage, a date, a code — when
 * it sits inside a sentence. Without it, a figure after Arabic letters becomes an Arabic number and a
 * trailing `%` or currency code detaches from it (UAX #9 rules W2 and W5): `بنسبة 24.62%` would print
 * the percent sign on the wrong side. The web does the same with a direction isolate.
 */
export function ltrIsolate(value: string): string {
  return `\u2066${value}\u2069`;
}

export function scriptOf(char: string): Script {
  return ARABIC.test(char) ? 'arabic' : 'latin';
}

/**
 * The direction a value reads in: that of its first strong character, or `fallback` when it has
 * none (a bare number or code). A value is laid out in its own direction and then aligned in its
 * cell — the PDF equivalent of the web's direction isolate, so `24.62%` never becomes `%24.62`.
 */
export function directionOf(text: string, fallback: Direction): Direction {
  for (const char of text) {
    if (STRONG_RTL.test(char)) return 'rtl';
    if (STRONG_LTR.test(char)) return 'ltr';
  }
  return fallback;
}

/** One piece of a line, in visual order from the line's left edge. */
export type VisualPiece =
  { kind: 'text'; text: string; script: Script } | { kind: 'space'; count: number };

/**
 * Visual pieces of one line. `text` in each piece is exactly what the font engine is given: logical
 * order for Arabic (the shaper reverses it), visual order for everything else.
 */
export function visualPieces(line: string, base: Direction): VisualPiece[] {
  if (line.length === 0) return [];
  // Work in UTF-16 indices, which is what bidi-js reports.
  const levels = bidi.getEmbeddingLevels(line, base);
  const order = Array.from({ length: line.length }, (_, index) => index);
  // Each segment is an inclusive [start, end] pair, typed by the package as number[].
  for (const [start = 0, end = -1] of bidi.getReorderSegments(line, levels)) {
    const reversed = order.slice(start, end + 1).reverse();
    order.splice(start, reversed.length, ...reversed);
  }

  const pieces: VisualPiece[] = [];
  let group: number[] = [];
  let groupScript: Script | undefined;

  const flush = () => {
    if (group.length === 0 || !groupScript) return;
    let text: string;
    if (groupScript === 'arabic') {
      // Logical order; the shaper reverses right-to-left runs itself.
      const sorted = [...group].sort((a, b) => a - b);
      text = sorted.map((index) => line[index]).join('');
    } else {
      text = group
        .map((index) => {
          const char = line[index] as string;
          // A bracket inside right-to-left text is drawn mirrored (UAX #9, rule L4).
          const rtl = ((levels.levels[index] ?? 0) & 1) === 1;
          return rtl ? (bidi.getMirroredCharacter(char) ?? char) : char;
        })
        .join('');
    }
    pieces.push({ kind: 'text', text, script: groupScript });
    group = [];
    groupScript = undefined;
  };

  for (let position = 0; position < order.length; position += 1) {
    const index = order[position] as number;
    const char = line[index] as string;
    if (CONTROL.test(char)) {
      // Invisible and zero-width; it also ends the current run.
      flush();
      continue;
    }
    if (char === ' ') {
      flush();
      const last = pieces.at(-1);
      if (last?.kind === 'space') last.count += 1;
      else pieces.push({ kind: 'space', count: 1 });
      continue;
    }
    const script = scriptOf(char);
    const previous = group.at(-1);
    const contiguous =
      previous !== undefined &&
      Math.abs(previous - index) === 1 &&
      (levels.levels[previous] ?? 0) === (levels.levels[index] ?? 0);
    if (group.length > 0 && (script !== groupScript || !contiguous)) flush();
    group.push(index);
    groupScript = script;
  }
  flush();
  return pieces;
}

/** Width of text in one script, as the page will draw it. */
export type Measure = (text: string, script: Script) => number;

export function lineWidth(pieces: VisualPiece[], measure: Measure): number {
  const space = measure(' ', 'latin');
  return pieces.reduce(
    (total, piece) =>
      total + (piece.kind === 'space' ? space * piece.count : measure(piece.text, piece.script)),
    0,
  );
}

/**
 * Break logical text into lines no wider than `width`, at spaces and explicit line breaks. A single
 * word wider than the line (a long e-mail address) is broken between characters rather than drawn
 * across the margin.
 */
export function wrap(text: string, width: number, base: Direction, measure: Measure): string[] {
  const lines: string[] = [];
  const fits = (candidate: string) =>
    lineWidth(visualPieces(candidate, base), measure) <= width + 0.01;
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = paragraph.split(/ +/).filter((word) => word.length > 0);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (fits(candidate)) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (fits(word)) {
        current = word;
        continue;
      }
      // Hard-break an over-long word by characters.
      let piece = '';
      for (const char of Array.from(word)) {
        if (piece && !fits(piece + char)) {
          lines.push(piece);
          piece = char;
        } else {
          piece += char;
        }
      }
      current = piece;
    }
    lines.push(current);
  }
  return lines;
}
