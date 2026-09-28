/**
 * The approved Light Mode semantic token set (THEME-001, ADR-0005).
 *
 * THIS IS THE ONLY FILE IN THE PRODUCT THAT MAY CONTAIN COLOR VALUES. Lint rejects color literals
 * everywhere else (THEME-003). Components consume these names — through the MUI theme or this object —
 * never raw values. Changing a value requires re-running the contrast verification (contrast.test.ts)
 * and updating ADR-0005 in the same change.
 *
 * There is exactly one palette. No dark or alternate token set exists or may be added (ADR-0004).
 */
export const tokens = {
  // Brand
  primary: '#2563EB',
  primaryHover: '#1D4ED8',
  primaryPressed: '#1E40AF',
  primarySoft: '#EFF6FF',
  primarySoftStrong: '#DBEAFE',
  onPrimary: '#FFFFFF',

  // Neutral
  pageBackground: '#F8FAFC',
  surface: '#FFFFFF',
  elevatedSurface: '#FFFFFF',
  /** A quiet neutral fill: table headers, neutral chips, hovered rows, the inactive part of a meter. */
  neutralSoft: '#F1F5F9',
  mainText: '#0F172A',
  secondaryText: '#475569',
  /** Supporting text that still meets 4.5:1 on every surface it is used on (captions, metadata). */
  mutedText: '#64748B',
  /** Card and section outlines, dividers inside a card. Decorative only (THEME-007). */
  borderSoft: '#E2E8F0',
  borderSubtle: '#CBD5E1',
  borderStrong: '#64748B',
  disabled: '#94A3B8',
  focusRing: '#1D4ED8',
  overlay: 'rgba(15, 23, 42, 0.45)',

  // Status — semantically distinct from the brand blue
  success: '#15803D',
  successSoft: '#DCFCE7',
  warning: '#B45309',
  warningSoft: '#FEF3C7',
  error: '#B91C1C',
  errorSoft: '#FEE2E2',
  info: '#0E7490',
  infoSoft: '#ECFEFF',

  // Charts — hue-differentiated only; never rely on hue alone (THEME-009)
  chart1: '#2563EB',
  chart2: '#0E7490',
  chart3: '#15803D',
  chart4: '#B45309',
  chart5: '#7C3AED',
  chart6: '#BE123C',
} as const;

export type TokenName = keyof typeof tokens;

/** Chart series order avoids placing chart3 (green) next to chart4 (amber) — ADR-0005 finding 3. */
export const CHART_SERIES_ORDER: readonly TokenName[] = [
  'chart1',
  'chart3',
  'chart5',
  'chart4',
  'chart2',
  'chart6',
];

export const focusRingWidthPx = 3;

/**
 * Elevation. Shadows are colour values too, so they live here and nowhere else (THEME-003).
 *
 * Deliberately restrained: an ERP screen is read for hours, and heavy shadows turn every card into a
 * floating object competing for attention. Surfaces are separated by a border first; a shadow only
 * says "this sits above the page" (a menu, a dialog, the sticky top bar).
 */
export const elevation = {
  none: 'none',
  /** Cards and panels: barely there, so grouping reads from the border. */
  card: '0 1px 2px rgba(15, 23, 42, 0.04)',
  /** The sticky top bar once content scrolls beneath it. */
  raised: '0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)',
  /** Menus, popovers, tooltips, autocomplete lists. */
  overlay: '0 10px 24px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.06)',
  /** Dialogs and the mobile navigation drawer. */
  modal: '0 24px 48px rgba(15, 23, 42, 0.18)',
} as const;
