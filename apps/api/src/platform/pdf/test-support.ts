/**
 * Reading a generated PDF back, for tests only (CORE-DOC-003, CORE-DOC-005). Never imported by
 * application code: `pdfjs-dist`, `@napi-rs/canvas` and `jsqr` are development dependencies.
 *
 * - `extractPages` reads the text a person would copy or a search would find, per page, with the
 *   position of each run — what proves the words are there, in reading order, inside the margins.
 * - `renderPage` draws a page to PNG with pdf.js, which is what proves the file actually renders and
 *   what the visual review looks at.
 * - `decodeQr` reads the QR code from a rendered page, as a phone camera would.
 */
import { createCanvas } from '@napi-rs/canvas';
import jsQR from 'jsqr';

export interface ExtractedRun {
  text: string;
  x: number;
  y: number;
  width: number;
}

async function load(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
}

export async function extractPages(
  bytes: Uint8Array,
): Promise<{ width: number; height: number; runs: ExtractedRun[]; text: string }[]> {
  const doc = await load(bytes);
  const pages = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const runs: ExtractedRun[] = [];
    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      const [, , , , x, y] = item.transform as number[];
      runs.push({ text: item.str, x: x ?? 0, y: y ?? 0, width: item.width });
    }
    pages.push({
      width: viewport.width,
      height: viewport.height,
      runs,
      text: runs.map((run) => run.text).join(' '),
    });
  }
  return pages;
}

export async function renderPage(
  bytes: Uint8Array,
  number: number,
  scale = 1.5,
): Promise<{ png: Buffer; width: number; height: number; rgba: Uint8ClampedArray }> {
  const doc = await load(bytes);
  const page = await doc.getPage(number);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  // pdf.js is typed for the DOM canvas; @napi-rs/canvas implements the same drawing interface.
  const parameters = { canvasContext: context, viewport, canvas } as unknown as Parameters<
    typeof page.render
  >[0];
  await page.render(parameters).promise;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return {
    png: canvas.toBuffer('image/png'),
    width: canvas.width,
    height: canvas.height,
    rgba: image.data,
  };
}

export function decodeQr(rendered: {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}): string | undefined {
  return jsQR(rendered.rgba, rendered.width, rendered.height)?.data;
}

/** The font names a PDF embeds, from its font descriptors (`/FontName /ABCDEF+Alexandria-…`). */
export function embeddedFontNames(bytes: Uint8Array): string[] {
  const text = Buffer.from(bytes).toString('latin1');
  return [...text.matchAll(/\/FontName \/([A-Z]{6}\+[^\s/]+)/g)].map((match) => match[1] as string);
}
