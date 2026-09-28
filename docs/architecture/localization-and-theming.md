# Localization, Direction, and Theming

Implements [ADR-0003](../decisions/adr-0003-arabic-first-localization.md) (Arabic-first),
[ADR-0004](../decisions/adr-0004-light-mode-only.md) (Light Mode only), and
[ADR-0005](../decisions/adr-0005-light-mode-design-tokens.md) (token set).

## 1. Locale model

| Property | Arabic | English |
|---|---|---|
| Code | `ar` | `en` |
| Default | **Yes** | No |
| Direction | RTL | LTR |
| Font | Alexandria | Inter |
| Acceptance priority | Primary | Secondary |

Arabic is the default for a new session and the primary acceptance locale — a feature demonstrated only
in English is not demonstrated.

## 2. Translation resources

- Namespaced per module (`common`, `core`, `inventory`, `crm`, `marketing`, `sales`, `collections`,
  `finance`, `procurement`, `construction`, `hr`, `handover`).
- Both locales ship in the same change. **A missing key in either locale fails CI**, so a mixed-language
  screen cannot reach a reviewer.
- Keys are semantic, not literal: `unit.status.reserved`, never `unit.status.محجوزة` or
  `unit.status.Reserved`. A key derived from English text becomes wrong when the English copy changes.
- Interpolation and ICU pluralization only. **Never concatenate translated fragments** — Arabic word order
  and agreement differ from English, so an assembled sentence that reads correctly in one language will be
  wrong in the other.
- Server responses carry stable machine codes; the client renders them. `UNIT_ALREADY_RESERVED` → localized
  message. This keeps copy changes out of the API contract.

## 3. What is never translated

User-entered content: customer names, notes, addresses, document contents, and uploaded files. Stored and
displayed exactly as entered. Machine translation of these values is prohibited — a machine-translated
customer name in a contract is a legal defect.

Admin-configurable dictionary values *are* bilingual by shape: `{ ar, en }`, both required. This covers
unit types, activities, lead sources, loss reasons, status labels, document types, payment methods, taxes,
currencies, campaign objectives, and approval reasons.

## 4. Direction

**Locale and direction change atomically.** Setting the locale sets `dir` on the document root in the same
state commit. A frame in which the locale is Arabic and the direction is still LTR must not exist.

### Rules

1. **Use CSS logical properties.** `margin-inline-start`, `padding-inline-end`, `inset-inline-start`,
   `text-align: start`. Physical properties (`margin-left`, `right:`) are lint-rejected.
2. **Mirror only genuinely directional icons** — back/forward arrows, indent, list alignment, progress
   direction. Never mirror: logos, user avatars, media play buttons, checkmarks, or numerals.
3. **Charts are not mirrored wholesale.** A time axis runs left-to-right in both locales — reversing it
   makes trends read backwards. Mirror the legend and label placement, not the data orientation.
4. **Isolate mixed-direction content.** Phone numbers, emails, URLs, IBANs, account numbers, unit codes,
   and file names are LTR content inside an RTL layout. Without bidirectional isolation, adjacent
   punctuation and digits reorder visibly — a phone number rendered as `0100-1234567+` instead of
   `+201001234567`. Use isolation (`unicode-bidi: isolate` or `dir="ltr"` on the element), not manual
   markers.
5. **Tables:** the logical first column is the visually leading column, which is the right in Arabic.
   Numeric columns stay end-aligned; currency symbol placement is locale-aware.
6. **Test both directions.** Navigation, forms, tables, dialogs, drawers, menus, tooltips, charts, print,
   and PDFs. Playwright E2E runs in both.

## 5. Typography

- **Self-hosted**, not from a third-party CDN: Alexandria (Arabic), Inter (English). Only the weights
  actually used, subset where possible, `font-display: swap`.
- Each family declares a real fallback stack, so a font load failure degrades rather than breaking layout.
- **Arabic-capable fonts must be embedded in generated PDFs.** Otherwise Arabic renders as missing glyphs
  or reversed text — and this appears only in the generated artifact, not in the browser, so it must be
  asserted by test. A PDF test that only checks a file was produced does not catch it.
- Arabic script needs more vertical space than Latin at the same nominal size. Line height is set per
  locale, and fixed-height containers are avoided.

## 6. Formatting

Locale-aware via `Intl`, with **Western digits (0–9) in both languages** (`SD-23`,
[ADR-0003](../decisions/adr-0003-arabic-first-localization.md) status update). Implemented once, in
`packages/i18n/src/format.ts`:

| Value | Requirement |
|---|---|
| Dates | Numeric `dd/MM/yyyy` (`dd/MM/yyyy HH:mm`, 24-hour) in both languages; organization timezone for display ([ADR-0008](../decisions/adr-0008-utc-storage-and-display-timezone.md)); business dates never shifted |
| Numbers | Western digits in Arabic and English (`1,234.50`); locale separators; forced with `-u-nu-latn`. Arabic-Indic digits never appear, in display or storage |
| Currency | Locale label and placement — Arabic `250,000 ج.م.`, English `EGP 250,000`; precision from currency configuration, never hard-coded to 2 |
| Percentages | `15.5%` in both languages |
| Plurals | ICU rules. Arabic has six plural categories; an English-shaped singular/plural pair is insufficient |
| Relative time | `Intl.RelativeTimeFormat` |

## 7. Theme

One centralized Light Mode theme. No Dark Mode, no System Mode, no switcher, no per-user preference
([ADR-0004](../decisions/adr-0004-light-mode-only.md)).

### Token contract

The token values and their verified contrast ratios are authoritative in
[ADR-0005](../decisions/adr-0005-light-mode-design-tokens.md) and are **not duplicated here** — two copies
of a palette drift, and the ADR carries the measurements.

Implementation rules:

1. Tokens are defined once, in `packages/ui/`, and exposed through the Material UI theme.
2. **Components consume semantic token names.** A hex literal, `rgb()`, or `hsl()` in a component fails
   lint. This holds even though only one theme exists — it is what keeps a future palette change, or an
   eventual Dark Mode, a token edit rather than a codebase sweep.
3. Every interactive element implements default, hover, pressed, selected, focus, and disabled states.
4. Components paint explicit token background and foreground colors. A surface is never transparent over
   an assumed ground.
5. `elevatedSurface` equals `surface`; elevation is shadow and border, not hue.

### The three verified usage constraints

Measured on 2026-09-19; see ADR-0005 for the full table.

| Constraint | Reason |
|---|---|
| Use `mainText` on `primarySoftStrong`, not `primary` | `primary` on `primarySoftStrong` is **4.24:1 — below the 4.5:1 AA threshold** for normal text. Permitted only at ≥18.66px bold or ≥24px. |
| `borderSubtle` is decorative only; interactive boundaries use `borderStrong` | `borderSubtle` is 1.48:1 — compliant only because decorative separators are exempt. As a control boundary it would fail 1.4.11. |
| Placeholders use `secondaryText`, never `disabled` | `disabled` is 2.56:1 — exempt as an inactive control, but a genuine AA failure as placeholder text. |

### Charts

Every chart color passes 3:1 against `surface`, but all fifteen pairwise combinations sit between 1.00 and
1.25 relative contrast — `chart3` (green) against `chart4` (amber) is 1.00, and is also the classic
red/green confusion pair.

Therefore **hue must never be the only differentiator**:

- label series directly wherever space allows, in preference to a legend
- distinct markers and dash patterns for lines
- pattern fills or explicit value labels for adjacent categorical bars
- avoid placing `chart3` next to `chart4`
- a chart that is unreadable in grayscale is a defect

### Deployment brand colour (THEME-013, ADR-0027)

Each client deployment may configure one brand colour in its company profile. It is a **validated
configuration value**, not a constant:

- Only the brand states are derived from it — `primary`, `primaryHover`, `primaryPressed`,
  `primarySoft`, `primarySoftStrong`, `focusRing`, `chart1` — by mixing toward the existing
  `mainText` and `surface` tokens (`packages/ui/src/brand.ts`). No new colour value exists outside
  `tokens.ts`. Text, surfaces, borders and the success/warning/error/information colours are the
  approved values in every deployment.
- The derived palette must pass **every** pair in `TOKEN_PAIRS_IN_USE`. The API refuses a failing
  colour when it is saved (`BRAND_COLOR_CONTRAST`); `ThemeRoot` validates again and renders the
  approved palette instead of any colour that fails.
- With no colour configured, the theme uses the approved token object itself: the approved blue,
  value for value.

The server and the browser share one implementation through the React-free `@alola/ui/brand` entry,
so the two can never disagree about what passes.

### Logo and runtime branding

Each deployment uploads its own logo, compact logo and favicon to its company profile (PNG or JPEG,
verified by magic bytes, at most 512 KiB); they are served by the public branding endpoint and shown
on the sign-in screen, in the shell and in the browser tab, with the company's name as the text
alternative (`PLAT-023`). The company name in the tab and the authenticator label come from the
profile too. Nothing about a client's identity is compiled into the build.

Approved logo assets for the first deployment are still outstanding (`SD-17`). Until a deployment
uploads its own (Settings → Company identity, since 2026-09-28):

- Every build shows a **monogram**: the first letter of the configured short name (or the product's
  initials when nothing is configured) on the theme's primary colour, next to the display name. It
  imitates no logo and is not an image file.
- No logo is invented, redrawn, traced, or permanently embedded.
- The earlier development-only text placeholder was retired with the redesign.

## 8. Accessibility

- Keyboard operation for every interactive element; logical tab order that follows the visual order in
  both directions.
- Visible focus using `focusRing` (6.70:1 on `surface`). Focus indication is never removed.
- Semantic markup and labels; `aria-label` values are localized like any other string.
- **Status is conveyed by text and icon, never by color alone** (WCAG 1.4.1).
- All five UI states implemented everywhere: loading, empty, error, forbidden, success.
- Automated accessibility checks in CI, run in both locales.

## 9. Required verification per change

1. Both locales present; CI missing-key check passes.
2. Arabic RTL and English LTR both render correctly.
3. No hard-coded user-facing text.
4. No hex or physical CSS direction properties in components.
5. Contrast verified for every token pair used, with the three constraints above respected.
6. Keyboard operation and visible focus.
7. Loading, empty, error, forbidden, and success states present.
8. Where a PDF is generated, Arabic glyph rendering asserted.
9. For a visual change, the visual QA below is run and its screenshots looked at.

## 10. The UI system (ADR-0030, 2026-09-28)

### Building blocks

| Need | Use | Never |
|---|---|---|
| Page title, record header | `PageHeader` (`eyebrow`, `status` beside the title, `meta`, `actions` at the inline end, `banner` only for a genuine alert) | a second `<h1>`; a full-width status bar |
| A titled section | `SectionCard` (web `Panel`) | a card inside a card |
| A figure | `MetricCard` (icon, `attention`/`positive` edge, optional link) | a colour per card; an invented trend |
| A list | `DataTable` + `TableToolbar` + `ListFooter` + `usePagedList` | client-side totals; a spinner instead of skeleton rows |
| A record's status | `StatusChip` / `EnumChip` (tone maps in `pages/shared.tsx`) | colour without the word and glyph |
| Loading, empty, no results, error, offline, forbidden, not connected, simulated | `StateView` (`inline` inside a card) | an empty area with no explanation |
| A person | `PersonName` / `usePersonLabel` (ADR-0031) | an account reference such as `acc_…` |
| An icon | `<Icon icon={…} />` from `@alola/ui/icons` | another icon package (lint), an emoji, a Unicode arrow |
| A chart | `apps/web/src/charts` (`CategoryBarChart`, `DonutChart`, `RatioMeter`) | a chart without its numbers in text |
| History | `Timeline`, `Transition` | "→" typed into a string (it does not mirror) |

### Direction rules added by the redesign

- Directional glyphs pass `mirrorInRtl` (chevrons, back arrows, "view all" arrows, the sidebar
  collapse toggle, sign-out). Non-directional glyphs never do.
- Horizontal bar charts are drawn with layout (`HorizontalBars`), not an SVG axis: an SVG category
  axis in RTL placed labels under the bars (found in visual QA). Column charts reverse their category
  axis in RTL.
- A bilingual label is rendered with `label[locale]`, never `label.ar` (two such defects were fixed).
- In MUI `sx`, a number ≤ 1 is a fraction: sizes meant as pixels are written `'1px'` (a `width: 1`
  once made every visually hidden label page-wide).

### Responsive behaviour

- ≥ `md`: a permanent sidebar at the inline start (272 px, 76 px collapsed, preference remembered in
  this browser), a sticky top bar, one page scroll; the sidebar scrolls on its own only when taller
  than the window.
- < `md`: a temporary drawer from the inline start (right in Arabic), search inside the drawer, the
  language switch as an icon button with its language name as its accessible name.
- Tables become label/value cards below `md`; `secondary` columns appear from `lg`.
- Content is capped at 1680 px and padded 16/24/32 px by breakpoint.

### Visual QA

`scratch/ui-visual-qa.mjs` (ignored, read-only) signs in as the demonstration executive and
administrator against the **built** web app and API and captures every screen at 1920, 1440, 1024
and 390 px, in Arabic and English, into `scratch/visual-qa/`, with a JSON report of horizontal
overflow, raw translation keys, raw account references, emoji, heading count, unnamed controls,
console errors and failed API calls. It never prints a credential; the administrator's one-time code
is computed in memory and waits for a fresh time step. DOM assertions are not visual QA: the
screenshots are looked at.
