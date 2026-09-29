/**
 * Types for `bidi-js` 1.1.0 — the Unicode Bidirectional Algorithm (UAX #9). The package ships no
 * declarations; only the functions this project calls are declared.
 */
declare module 'bidi-js' {
  export interface EmbeddingLevelsResult {
    levels: Uint8Array;
    paragraphs: { start: number; end: number; level: number }[];
  }
  export interface Bidi {
    getEmbeddingLevels(text: string, direction?: 'ltr' | 'rtl' | 'auto'): EmbeddingLevelsResult;
    /** Ranges (inclusive) to reverse, in order, to turn logical order into visual order. */
    getReorderSegments(
      text: string,
      levels: EmbeddingLevelsResult,
      start?: number,
      end?: number,
    ): [number, number][];
    getMirroredCharacter(char: string): string | null;
  }
  export default function bidiFactory(): Bidi;
}
