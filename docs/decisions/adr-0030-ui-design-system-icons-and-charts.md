# ADR-0030 — UI design system: layout scale, icon library and chart library

- **Status:** Accepted (2026-09-28)
- **Deciders:** Product owner (UI/UX redesign master prompt), engineering
- **Related:** [ADR-0004](adr-0004-light-mode-only.md), [ADR-0005](adr-0005-light-mode-design-tokens.md),
  [ADR-0026](adr-0026-demonstration-mode-boundary.md), [ADR-0027](adr-0027-single-tenant-per-deployment.md),
  `THEME-001`–`THEME-013`, `I18N-004`, `I18N-005`

## Context

The foundation shipped a correct but plain interface: the approved Light Mode tokens, an accessible
theme and a handful of shared components, with every icon drawn from hand-copied Material Design SVG
paths and every chart a row of labelled bars. The product is now shown to client companies, each on
its own deployment (ADR-0027), and has to read as a serious corporate ERP in both Arabic (RTL) and
English (LTR) without giving up any of the guarantees the foundation established — Light Mode only,
tokens only, logical CSS only, WCAG AA, and the route and vendor bundle split.

Three things were missing: a shared layout scale (sizes, radii, density, elevation), a real icon
library, and a real chart library.

## Decision

### 1. Layout scale and elevation

- `packages/ui/src/layout.ts` holds the numbers every screen shares: sidebar widths (272 px expanded,
  76 px collapsed), top bar height (64 px), content max width (1680 px), page gutter (16/24/32 px by
  breakpoint), section gap, card padding, control height (40 px; 44 px touch target) and radii
  (6/8/12 px).
- Elevation is a colour value, so it lives in `tokens.ts` beside the palette as `elevation`: `card`
  (barely visible), `raised` (sticky top bar), `overlay` (menus, popovers) and `modal` (dialogs,
  mobile drawer). Surfaces are grouped by a border first; a shadow only says "this sits above".
- Three neutral tokens are added to ADR-0005's set — see its 2026-09-28 status update: `neutralSoft`,
  `mutedText`, `borderSoft`. No existing value changes.

### 2. Type scale

One scale, applied through the MUI theme so no screen chooses its own sizes: page title 1.625 rem/700,
section title 1.125 rem/600, card title 1 rem/600, body 0.9375 rem, supporting text and table cells
0.875 rem, table header 0.8125 rem/600, caption 0.75 rem. Only the self-hosted weights 400, 600 and 700
exist (I18N-007).

### 3. Icons — `lucide-react`, exact-pinned

- **Chosen:** `lucide-react` 1.48.0 (ISC licence), one outline style, one stroke weight (1.75),
  ES modules with `sideEffects: false`, so only the glyphs imported reach a bundle.
- **Not chosen:** `@mui/icons-material` (a second filled/outlined style mix, and a very large package
  that relies on deep imports for tree-shaking); keeping hand-copied SVG paths (no vocabulary, no
  consistency, every new glyph a copy-paste).
- **Boundary:** only `@alola/ui` imports the library. Applications import glyphs from
  `@alola/ui/icons`, a curated re-export, and render them through `<Icon>`, which hides decorative
  glyphs from assistive technology, gives a standalone glyph an accessible name, and mirrors
  directional glyphs (chevrons, arrows) under `dir="rtl"`. Lint refuses `lucide-react`,
  `@mui/icons-material` and `react-icons` anywhere in the web application
  (`tests/lint-rules.test.ts`).
- **No emoji and no Unicode symbol is used as an icon.**

### 4. Charts — `recharts`, exact-pinned, loaded only by the screens that draw one

- **Chosen:** `recharts` 3.10.1 (MIT), with its `react-is` peer pinned to the React version.
  React-native components, SVG output, tooltips, responsive containers and a keyboard-accessible
  layer.
- **Not chosen:** `@mui/x-charts` (substantially heavier, and its licence tiers need review for
  features a dashboard would soon want); a hand-built SVG set (the previous `BarChart` shows the
  limit: no columns, no donut, no tooltips, no axes).
- **Bundle:** charts sit in a separate `vendor-charts` chunk requested only by the routes that draw a
  chart (dashboard, marketing). The shell, sign-in and every list screen download nothing more than
  before. The bundle budget (650 kB / 210 kB gzip per chunk) is unchanged and still enforced.
- **Accessibility (THEME-009):** every chart is a `<figure>` with a caption and a visually hidden
  data table carrying the same numbers; series are distinguished by label, legend and position, never
  by hue alone; colours come from `CHART_SERIES_ORDER`. In RTL, category axes are reversed so the
  first category sits at the inline start.
- **No invented figures:** a chart draws only what an endpoint returned. No trend is drawn without a
  real comparison.

## Consequences

- Shared primitives (`StatusChip`, `StateView`, `MetricCard`, `PageHeader`, `SectionCard`,
  `DataTable`, `TableToolbar`) carry the look; screens compose them and set no colours, sizes or
  shadows of their own.
- Two dependencies are added (plus `react-is`). Both are exact-pinned, audited, and recorded in
  [dependencies.md](../architecture/dependencies.md) with their bundle impact.
- A new glyph means adding one name to `packages/ui/src/icons.ts`; a new chart type means a wrapper in
  `apps/web/src/charts/`.

## Compliance

- `tests/lint-rules.test.ts` proves the icon boundary rule fires.
- `packages/ui/src/components.test.tsx` proves decorative icons are hidden, labelled ones are exposed,
  every status tone has its own glyph and a contrast-registered palette, and the table's states.
- `packages/ui/src/contrast.test.ts` proves every new token pair meets its threshold.
- `npm run check:bundle` keeps every chunk inside the unchanged budget.

## References

- WCAG 2.1 SC 1.1.1, 1.3.1, 1.4.1, 1.4.3, 1.4.11, 2.1.1, 2.4.7
- lucide-react — https://lucide.dev · recharts — https://recharts.org
