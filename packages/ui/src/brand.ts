import { MINIMUM_RATIO, TOKEN_PAIRS_IN_USE, contrastRatio, type TokenPair } from './contrast';
import { tokens, type TokenName } from './tokens';

/**
 * A deployment's brand colour, turned into the brand token states (THEME-013, ADR-0027).
 *
 * The product is sold to several companies, each on its own deployment, so the primary colour is a
 * **validated configuration value** rather than a constant. Everything else in the palette — text,
 * surfaces, borders and the success/warning/error/information colours — stays exactly as approved in
 * ADR-0005, because those carry meaning that must not change between clients.
 *
 * Two rules keep this safe:
 *
 * 1. **The approved default is untouched.** With no brand colour configured, `derivePalette` returns
 *    `tokens` itself — the same object, not a recomputation — so a deployment that configures nothing
 *    renders exactly the approved blue theme, value for value.
 * 2. **A configured colour must pass every pair the product uses.** The derived palette is checked
 *    against `TOKEN_PAIRS_IN_USE`, the same registry that proves the approved palette. A colour that
 *    fails any pair is refused when it is saved, and ignored (with the approved palette used instead)
 *    if it ever reaches a browser anyway.
 *
 * This module is pure: it imports only the token and contrast modules, never React, so the API can
 * validate a colour with exactly the rule the browser applies (`@alola/ui/brand`).
 */

export type Palette = Readonly<Record<TokenName, string>>;

export const BRAND_COLOR_PATTERN = /^#[0-9A-F]{6}$/;

/** The brand token states derived from the primary colour. Nothing else is ever derived. */
export const DERIVED_BRAND_TOKENS = [
  'primary',
  'primaryHover',
  'primaryPressed',
  'primarySoft',
  'primarySoftStrong',
  'focusRing',
  'chart1',
] as const satisfies readonly TokenName[];

/**
 * How far each derived state moves from the primary colour. The shades mix toward `mainText` and the
 * tints toward `surface` — existing tokens — so no new colour value exists anywhere outside
 * `tokens.ts`.
 */
const SHADE_HOVER = 0.18;
const SHADE_PRESSED = 0.36;
const TINT_SOFT = 0.93;
const TINT_SOFT_STRONG = 0.83;

function channels(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function toHex(rgb: readonly [number, number, number]): string {
  return `#${rgb
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

/** Linear mix in sRGB space: `amount` 0 is `from`, 1 is `toward`. */
export function mix(from: string, toward: string, amount: number): string {
  const a = channels(from);
  const b = channels(toward);
  return toHex([
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ]);
}

/** Normalize user input to `#RRGGBB` upper case, or `undefined` when it is not a colour at all. */
export function normalizeBrandColor(input: string): string | undefined {
  const value = input.trim().toUpperCase();
  return BRAND_COLOR_PATTERN.test(value) ? value : undefined;
}

/**
 * The full palette for a deployment. `undefined`, or the approved primary itself, returns the approved
 * token object unchanged.
 */
export function derivePalette(brandPrimary?: string): Palette {
  if (brandPrimary === undefined) return tokens;
  const primary = normalizeBrandColor(brandPrimary);
  if (!primary) throw new Error('BRAND_COLOR_INVALID');
  if (primary === tokens.primary) return tokens;
  const hover = mix(primary, tokens.mainText, SHADE_HOVER);
  return {
    ...tokens,
    primary,
    primaryHover: hover,
    primaryPressed: mix(primary, tokens.mainText, SHADE_PRESSED),
    primarySoft: mix(primary, tokens.surface, TINT_SOFT),
    primarySoftStrong: mix(primary, tokens.surface, TINT_SOFT_STRONG),
    // The approved focus ring is the hover shade; a derived palette keeps that relationship.
    focusRing: hover,
    chart1: primary,
  };
}

export interface BrandContrastFailure {
  foreground: TokenName;
  background: TokenName;
  usage: TokenPair['usage'];
  ratio: number;
  required: number;
}

export type BrandValidation =
  | { ok: true; primary: string; palette: Palette }
  | { ok: false; reason: 'BRAND_COLOR_INVALID' }
  | { ok: false; reason: 'BRAND_COLOR_CONTRAST'; failures: BrandContrastFailure[] };

/**
 * Validate a proposed brand colour against every token pair the product uses.
 *
 * Only pairs that involve a derived token can change, but all pairs are evaluated: the check is cheap,
 * and evaluating everything means a future pair added to the registry is covered without anyone
 * remembering to add it here.
 */
export function validateBrandColor(input: string): BrandValidation {
  const primary = normalizeBrandColor(input);
  if (!primary) return { ok: false, reason: 'BRAND_COLOR_INVALID' };
  const palette = derivePalette(primary);
  const failures: BrandContrastFailure[] = [];
  for (const pair of TOKEN_PAIRS_IN_USE) {
    const required = MINIMUM_RATIO[pair.usage];
    if (required === 0) continue;
    const ratio = contrastRatio(palette[pair.foreground], palette[pair.background]);
    if (ratio < required) {
      failures.push({
        foreground: pair.foreground,
        background: pair.background,
        usage: pair.usage,
        ratio: Math.round(ratio * 100) / 100,
        required,
      });
    }
  }
  return failures.length === 0
    ? { ok: true, primary, palette }
    : { ok: false, reason: 'BRAND_COLOR_CONTRAST', failures };
}

/**
 * The palette a browser should render with: the configured colour when it validates, otherwise the
 * approved palette. A browser never renders an unvalidated colour, whatever the server sent.
 */
export function safePalette(brandPrimary: string | undefined): Palette {
  if (brandPrimary === undefined) return tokens;
  const result = validateBrandColor(brandPrimary);
  return result.ok ? result.palette : tokens;
}
