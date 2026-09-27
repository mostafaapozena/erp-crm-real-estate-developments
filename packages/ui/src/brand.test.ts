import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DERIVED_BRAND_TOKENS,
  derivePalette,
  mix,
  normalizeBrandColor,
  safePalette,
  validateBrandColor,
} from './brand';
import { MINIMUM_RATIO, TOKEN_PAIRS_IN_USE, contrastRatio } from './contrast';
import { tokens } from './tokens';

/**
 * THEME-013: a deployment's brand colour, derived and validated (ADR-0027).
 */
describe('brand palette', () => {
  it('returns the approved token object itself when nothing is configured', () => {
    expect(derivePalette()).toBe(tokens);
    expect(derivePalette(tokens.primary)).toBe(tokens);
    expect(derivePalette(tokens.primary.toLowerCase())).toBe(tokens);
  });

  it('accepts the approved primary, so a default deployment always validates', () => {
    const result = validateBrandColor(tokens.primary);
    expect(result.ok).toBe(true);
  });

  it('derives only the brand states and leaves every other token approved', () => {
    const palette = derivePalette('#0F766E');
    for (const name of Object.keys(tokens) as (keyof typeof tokens)[]) {
      if ((DERIVED_BRAND_TOKENS as readonly string[]).includes(name)) continue;
      expect(palette[name], name).toBe(tokens[name]);
    }
    expect(palette.primary).toBe('#0F766E');
    expect(palette.focusRing).toBe(palette.primaryHover);
  });

  it('accepts a dark brand colour that passes every pair in use', () => {
    const result = validateBrandColor('#0f766e');
    expect(result).toMatchObject({ ok: true, primary: '#0F766E' });
    if (!result.ok) return;
    for (const pair of TOKEN_PAIRS_IN_USE) {
      const required = MINIMUM_RATIO[pair.usage];
      expect(
        contrastRatio(result.palette[pair.foreground], result.palette[pair.background]),
        `${pair.foreground} on ${pair.background}`,
      ).toBeGreaterThanOrEqual(required);
    }
  });

  it('refuses a light colour that white text cannot sit on, and names the failing pairs', () => {
    const result = validateBrandColor('#FACC15');
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'BRAND_COLOR_CONTRAST') throw new Error('expected contrast');
    expect(result.failures).toContainEqual(
      expect.objectContaining({ foreground: 'onPrimary', background: 'primary', required: 4.5 }),
    );
  });

  it('refuses anything that is not #RRGGBB', () => {
    for (const input of ['blue', '#FFF', '#12345G', 'rgb(0,0,0)', '#1234567', '', ' ']) {
      expect(validateBrandColor(input), input).toEqual({
        ok: false,
        reason: 'BRAND_COLOR_INVALID',
      });
      expect(normalizeBrandColor(input)).toBeUndefined();
    }
  });

  it('never renders an unvalidated colour in the browser', () => {
    expect(safePalette('#FACC15')).toBe(tokens);
    expect(safePalette('not a colour')).toBe(tokens);
    expect(safePalette(undefined)).toBe(tokens);
    expect(safePalette('#0F766E').primary).toBe('#0F766E');
  });

  it('mixes linearly and stays within #RRGGBB', () => {
    expect(mix('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(mix('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });

  it('stays importable by the server: it depends on nothing but tokens and contrast', () => {
    // Resolved from the working directory: the jsdom environment gives this module a non-file URL.
    const candidates = ['packages/ui/src/brand.ts', 'src/brand.ts'].map((path) => resolve(path));
    const file = candidates.find((path) => existsSync(path));
    expect(file).toBeDefined();
    const source = readFileSync(file ?? '', 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    expect(imports.sort()).toEqual(['./contrast', './tokens']);
  });
});
