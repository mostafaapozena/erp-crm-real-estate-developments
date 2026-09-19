import { tokens, type TokenName } from './tokens';

/** WCAG 2.1 relative luminance and contrast ratio (SC 1.4.3, 1.4.11). */
export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`Expected #RRGGBB, got ${hex}`);
  const value = parseInt(match[1], 16);
  const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * How a pair is used decides the threshold:
 * - `text`: normal text, 4.5:1
 * - `largeText`: only ≥18.66px bold or ≥24px, 3:1
 * - `nonText`: component boundaries, focus indicators, icons, chart marks, 3:1
 * - `decorative` / `inactive`: exempt by WCAG — enforced as usage rules instead of a ratio
 */
export type PairUsage = 'text' | 'largeText' | 'nonText' | 'decorative' | 'inactive';

export const MINIMUM_RATIO: Record<PairUsage, number> = {
  text: 4.5,
  largeText: 3,
  nonText: 3,
  decorative: 0,
  inactive: 0,
};

export interface TokenPair {
  foreground: TokenName;
  background: TokenName;
  usage: PairUsage;
  /** Ratio measured and recorded in ADR-0005 on 2026-09-19. */
  recorded?: number;
}

/**
 * Every token pair the theme and shared components actually use (THEME-005). Adding a new pairing in
 * a component means adding it here; the test then proves it meets its threshold.
 */
export const TOKEN_PAIRS_IN_USE: readonly TokenPair[] = [
  { foreground: 'mainText', background: 'surface', usage: 'text', recorded: 17.85 },
  { foreground: 'mainText', background: 'pageBackground', usage: 'text', recorded: 17.06 },
  { foreground: 'mainText', background: 'primarySoft', usage: 'text', recorded: 16.4 },
  { foreground: 'mainText', background: 'primarySoftStrong', usage: 'text', recorded: 14.63 },
  { foreground: 'secondaryText', background: 'surface', usage: 'text', recorded: 7.58 },
  { foreground: 'secondaryText', background: 'pageBackground', usage: 'text', recorded: 7.24 },
  { foreground: 'onPrimary', background: 'primary', usage: 'text', recorded: 5.17 },
  { foreground: 'onPrimary', background: 'primaryHover', usage: 'text', recorded: 6.7 },
  { foreground: 'onPrimary', background: 'primaryPressed', usage: 'text', recorded: 8.72 },
  { foreground: 'primary', background: 'surface', usage: 'text', recorded: 5.17 },
  { foreground: 'primary', background: 'pageBackground', usage: 'text', recorded: 4.94 },
  { foreground: 'primary', background: 'primarySoft', usage: 'text', recorded: 4.75 },
  // THEME-006: fails AA for normal text (4.24). Permitted only as large text.
  { foreground: 'primary', background: 'primarySoftStrong', usage: 'largeText', recorded: 4.24 },
  { foreground: 'success', background: 'surface', usage: 'text', recorded: 5.02 },
  { foreground: 'success', background: 'successSoft', usage: 'text', recorded: 4.57 },
  { foreground: 'warning', background: 'surface', usage: 'text', recorded: 5.02 },
  { foreground: 'warning', background: 'warningSoft', usage: 'text', recorded: 4.51 },
  { foreground: 'error', background: 'surface', usage: 'text', recorded: 6.47 },
  { foreground: 'error', background: 'errorSoft', usage: 'text', recorded: 5.3 },
  { foreground: 'info', background: 'surface', usage: 'text', recorded: 5.36 },
  { foreground: 'info', background: 'infoSoft', usage: 'text', recorded: 5.15 },
  // Text on a filled status surface (contained status buttons, badges) is the surface color.
  { foreground: 'surface', background: 'success', usage: 'text' },
  { foreground: 'surface', background: 'warning', usage: 'text' },
  { foreground: 'surface', background: 'error', usage: 'text' },
  { foreground: 'surface', background: 'info', usage: 'text' },
  // Tooltip: surface text on mainText.
  { foreground: 'surface', background: 'mainText', usage: 'text' },
  { foreground: 'borderStrong', background: 'surface', usage: 'nonText', recorded: 4.76 },
  { foreground: 'borderStrong', background: 'pageBackground', usage: 'nonText', recorded: 4.55 },
  { foreground: 'focusRing', background: 'surface', usage: 'nonText', recorded: 6.7 },
  { foreground: 'focusRing', background: 'pageBackground', usage: 'nonText', recorded: 6.41 },
  { foreground: 'focusRing', background: 'primarySoft', usage: 'nonText' },
  { foreground: 'chart1', background: 'surface', usage: 'nonText' },
  { foreground: 'chart2', background: 'surface', usage: 'nonText' },
  { foreground: 'chart3', background: 'surface', usage: 'nonText' },
  { foreground: 'chart4', background: 'surface', usage: 'nonText' },
  { foreground: 'chart5', background: 'surface', usage: 'nonText' },
  { foreground: 'chart6', background: 'surface', usage: 'nonText' },
  // THEME-007 / THEME-008: below 3:1 by design; compliant only as used.
  { foreground: 'borderSubtle', background: 'surface', usage: 'decorative', recorded: 1.48 },
  { foreground: 'disabled', background: 'surface', usage: 'inactive', recorded: 2.56 },
];

export function pairRatio(pair: TokenPair): number {
  return contrastRatio(tokens[pair.foreground], tokens[pair.background]);
}
