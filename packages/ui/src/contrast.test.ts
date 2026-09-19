import { describe, expect, it } from 'vitest';
import { MINIMUM_RATIO, TOKEN_PAIRS_IN_USE, contrastRatio, pairRatio } from './contrast';
import { CHART_SERIES_ORDER, tokens } from './tokens';

describe('approved token values (THEME-001)', () => {
  it('match the approved blue palette exactly', () => {
    expect(tokens.primary).toBe('#2563EB');
    expect(tokens.primaryHover).toBe('#1D4ED8');
    expect(tokens.primaryPressed).toBe('#1E40AF');
    expect(tokens.primarySoft).toBe('#EFF6FF');
    expect(tokens.primarySoftStrong).toBe('#DBEAFE');
    expect(tokens.onPrimary).toBe('#FFFFFF');
    expect(tokens.focusRing).toBe('#1D4ED8');
  });

  it('keep status colors distinct from the brand blue', () => {
    const brand = new Set<string>([tokens.primary, tokens.primaryHover, tokens.primaryPressed]);
    for (const status of [tokens.success, tokens.warning, tokens.error, tokens.info]) {
      expect(brand.has(status)).toBe(false);
    }
  });

  it('define exactly one palette — no dark or alternate tokens (THEME-002)', () => {
    for (const name of Object.keys(tokens)) expect(name).not.toMatch(/dark|night|inverse/i);
  });
});

describe('WCAG AA contrast of every pair in use (THEME-005)', () => {
  for (const pair of TOKEN_PAIRS_IN_USE) {
    const label = `${pair.foreground} on ${pair.background} (${pair.usage})`;

    it(`${label} meets its threshold`, () => {
      expect(pairRatio(pair)).toBeGreaterThanOrEqual(MINIMUM_RATIO[pair.usage]);
    });

    if (pair.recorded !== undefined) {
      const recorded = pair.recorded;
      it(`${label} matches the ratio recorded in ADR-0005`, () => {
        expect(pairRatio(pair)).toBeCloseTo(recorded, 1);
      });
    }
  }

  it('confirms primary on primarySoftStrong fails AA for normal text (THEME-006)', () => {
    const ratio = contrastRatio(tokens.primary, tokens.primarySoftStrong);
    expect(ratio).toBeLessThan(4.5);
    expect(ratio).toBeGreaterThanOrEqual(3);
    expect(
      TOKEN_PAIRS_IN_USE.find(
        (p) => p.foreground === 'primary' && p.background === 'primarySoftStrong',
      )?.usage,
    ).toBe('largeText');
  });

  it('never uses borderSubtle or disabled as text or control boundaries (THEME-007, THEME-008)', () => {
    for (const pair of TOKEN_PAIRS_IN_USE) {
      if (pair.foreground === 'borderSubtle') expect(pair.usage).toBe('decorative');
      if (pair.foreground === 'disabled') expect(pair.usage).toBe('inactive');
    }
  });
});

describe('chart palette (THEME-009)', () => {
  it('lacks luminance separation, so charts must not rely on hue alone', () => {
    expect(contrastRatio(tokens.chart3, tokens.chart4)).toBeCloseTo(1.0, 1);
  });

  it('orders series so chart3 and chart4 are never adjacent', () => {
    const i3 = CHART_SERIES_ORDER.indexOf('chart3');
    const i4 = CHART_SERIES_ORDER.indexOf('chart4');
    expect(Math.abs(i3 - i4)).toBeGreaterThan(1);
  });
});
