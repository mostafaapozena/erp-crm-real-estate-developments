# ADR-0005 — Extended Light Mode semantic token set

- Status: Accepted · status update 2026-09-28 (three neutral tokens and elevation added, ADR-0030)
- Date: 2026-09-19
- Deciders: ALOLA business owner (approved palette), implementation team
- Scope: Design

## Context

[ADR-0004](adr-0004-light-mode-only.md) establishes a single Light Mode theme. That theme needs a
complete, approved, centrally defined palette before any component is written, because a component that
hard-codes a hex value cannot be corrected centrally later — and a palette whose contrast has never been
measured cannot be claimed to meet WCAG AA.

The business owner has approved an extended token set covering brand, neutral, status, and chart colors.

## Decision

Adopt the token set below as the **only** source of color in the product. Components consume semantic
token names. Raw hex values appear in exactly one place: the theme definition.

### Brand tokens

| Token | Value | Use |
|---|---|---|
| `primary` | `#2563EB` | Brand actions, links, selected navigation, active controls |
| `primaryHover` | `#1D4ED8` | Hover state of primary surfaces |
| `primaryPressed` | `#1E40AF` | Pressed/active state of primary surfaces |
| `primarySoft` | `#EFF6FF` | Subtle branded background (selected row, info panel) |
| `primarySoftStrong` | `#DBEAFE` | Stronger branded background (active selection, chips) |
| `onPrimary` | `#FFFFFF` | Text and icons on any primary surface |

### Neutral tokens

| Token | Value | Use |
|---|---|---|
| `pageBackground` | `#F8FAFC` | Application canvas |
| `surface` | `#FFFFFF` | Cards, tables, panels |
| `elevatedSurface` | `#FFFFFF` | Dialogs, menus, popovers — distinguished by shadow and border, not by hue |
| `mainText` | `#0F172A` | Primary text |
| `secondaryText` | `#475569` | Secondary text, captions, **placeholders** |
| `borderSubtle` | `#CBD5E1` | Decorative separation only |
| `borderStrong` | `#64748B` | Any boundary that identifies a control or interactive area |
| `disabled` | `#94A3B8` | Genuinely inactive controls only |
| `focusRing` | `#1D4ED8` | Visible keyboard focus |
| `overlay` | `rgba(15, 23, 42, 0.45)` | Modal scrim |

### Status tokens

| Token | Value | Soft pair | Value |
|---|---|---|---|
| `success` | `#15803D` | `successSoft` | `#DCFCE7` |
| `warning` | `#B45309` | `warningSoft` | `#FEF3C7` |
| `error` | `#B91C1C` | `errorSoft` | `#FEE2E2` |
| `info` | `#0E7490` | `infoSoft` | `#ECFEFF` |

### Chart palette

| Token | Value | Token | Value |
|---|---|---|---|
| `chart1` | `#2563EB` | `chart4` | `#B45309` |
| `chart2` | `#0E7490` | `chart5` | `#7C3AED` |
| `chart3` | `#15803D` | `chart6` | `#BE123C` |

## Verified contrast results

Measured, not assumed. Ratios computed with the WCAG 2.1 relative-luminance formula on 2026-09-19.
AA thresholds: **4.5:1** for normal text, **3:1** for large text (≥18.66px bold or ≥24px), UI component
boundaries, and graphical objects.

| Foreground | Background | Ratio | Required | Result |
|---|---|---|---|---|
| `mainText` | `surface` | 17.85 | 4.5 | Pass |
| `mainText` | `pageBackground` | 17.06 | 4.5 | Pass |
| `mainText` | `primarySoft` | 16.40 | 4.5 | Pass |
| `mainText` | `primarySoftStrong` | 14.63 | 4.5 | Pass |
| `secondaryText` | `surface` | 7.58 | 4.5 | Pass |
| `secondaryText` | `pageBackground` | 7.24 | 4.5 | Pass |
| `onPrimary` | `primary` | 5.17 | 4.5 | Pass |
| `onPrimary` | `primaryHover` | 6.70 | 4.5 | Pass |
| `onPrimary` | `primaryPressed` | 8.72 | 4.5 | Pass |
| `primary` | `surface` | 5.17 | 4.5 | Pass |
| `primary` | `pageBackground` | 4.94 | 4.5 | Pass |
| `primary` | `primarySoft` | 4.75 | 4.5 | Pass |
| **`primary`** | **`primarySoftStrong`** | **4.24** | **4.5** | **FAIL for normal text** |
| `success` | `surface` | 5.02 | 4.5 | Pass |
| `success` | `successSoft` | 4.57 | 4.5 | Pass |
| `warning` | `surface` | 5.02 | 4.5 | Pass |
| `warning` | `warningSoft` | 4.51 | 4.5 | Pass |
| `error` | `surface` | 6.47 | 4.5 | Pass |
| `error` | `errorSoft` | 5.30 | 4.5 | Pass |
| `info` | `surface` | 5.36 | 4.5 | Pass |
| `info` | `infoSoft` | 5.15 | 4.5 | Pass |
| `borderStrong` | `surface` | 4.76 | 3 | Pass |
| `borderStrong` | `pageBackground` | 4.55 | 3 | Pass |
| `focusRing` | `surface` | 6.70 | 3 | Pass |
| `focusRing` | `pageBackground` | 6.41 | 3 | Pass |
| `borderSubtle` | `surface` | 1.48 | 3 (n/a — decorative) | Below threshold by design |
| `disabled` | `surface` | 2.56 | 3 (exempt — inactive) | Below threshold by design |
| `chart1`…`chart6` | `surface` | 5.02–6.29 | 3 | All pass |

### Three findings that constrain usage

**1. `primary` on `primarySoftStrong` fails AA for normal text (4.24 < 4.5).**
It passes the 3:1 large-text threshold only. This confirms the business owner's precautionary usage
rule as a measured fact. Therefore: **use `mainText` on `primarySoftStrong`.** `primary` text on
`primarySoftStrong` is permitted only at large-text sizes (≥18.66px bold or ≥24px) and must be
justified in review. `primary` on `primarySoft` (4.75) is safe for normal text.

**2. `borderSubtle` (1.48) and `disabled` (2.56) are intentionally below 3:1.**
WCAG 1.4.11 applies to non-text content that conveys meaning, and 1.4.3/1.4.11 exempt inactive
controls. These two tokens are therefore compliant *only while used as specified*:

- `borderSubtle` must never be the sole indicator of a control's boundary or of an interactive area.
  Any boundary a user must perceive to operate the interface uses `borderStrong` (4.76).
- `disabled` must never be used for placeholder text or for active low-emphasis content. Placeholders
  use `secondaryText` (7.58). Using `disabled` for a placeholder would be a genuine AA failure, which
  is exactly why the rule exists.

**3. The chart palette is hue-differentiated but not luminance-differentiated.**
Every chart color passes 3:1 against `surface`, but all fifteen pairwise combinations fall between
1.00 and 1.25 in relative contrast — `chart3` (green `#15803D`) against `chart4` (amber `#B45309`) is
1.00, effectively identical in luminance, and is also the classic red/green confusion pair.

Consequence: **charts must never rely on hue alone to distinguish series.** Required mitigations —
direct labelling of series, distinct markers or dash patterns for lines, pattern fills or explicit value
labels for adjacent categorical bars, and ordering that avoids placing `chart3` next to `chart4`. A
chart that is unreadable in grayscale is a defect.

## Usage rules

1. Never hard-code a hex value, `rgb()`, or color name in a component. Consume the token.
2. Use `primary` for brand actions, links, selected navigation, active controls, and focus. Never as a
   substitute for a status color.
3. Keep `success`, `warning`, `error`, and `info` semantically distinct from `primary` blue. `info` is
   teal (`#0E7490`) specifically so that "information" is not confused with "brand".
4. Statuses must carry text and an icon. Color alone never conveys state.
5. `elevatedSurface` equals `surface`; elevation is communicated by shadow and border, so a dialog must
   not rely on hue to separate from the page.
6. Every interactive element defines default, hover, pressed, selected, focus, and disabled states.
7. Table rows use `surface` with `borderSubtle` separators; a selected row uses `primarySoft` with
   `mainText`, never `primary` text.

## Consequences

**Accepted benefits**

- A measured, documented contrast baseline instead of an assumed one.
- Central correction: a token value change propagates everywhere at once.
- The three findings above convert vague guidance ("verify contrast") into concrete, enforceable rules.

**Accepted costs**

- Chart work requires extra labelling effort because the palette lacks luminance spread. Accepted:
  changing the approved palette is a business decision, and labelling is the correct accessibility
  answer regardless of palette.
- Designers lose ad-hoc color freedom. That is the intent.

## Compliance

- Lint must fail on hex literals and `rgb()`/`hsl()` literals in `apps/web` components.
- Automated accessibility tests assert contrast for each token pair in the table above; the two
  intentional exceptions are asserted as *usage* rules (no `borderSubtle` on interactive boundaries, no
  `disabled` on placeholders), not as contrast passes.
- Chart components must be reviewed for non-color differentiation before a phase gate passes.
- Re-run the contrast computation if any token value changes; update this table in the same change.

## References

- `CLAUDE.md` — approved blue tokens; never copy values into components
- `docs/MASTER-MAPPING.md` §5.3, §13
- [ADR-0004](adr-0004-light-mode-only.md)
- [../architecture/localization-and-theming.md](../architecture/localization-and-theming.md)
- WCAG 2.1 SC 1.4.3 (Contrast Minimum), 1.4.11 (Non-text Contrast), 1.4.1 (Use of Color)

## Status update — 2026-09-28 (ADR-0030)

No approved value changed. Three neutral tokens and an elevation scale were **added** for the UI
redesign, each measured and registered in `packages/ui/src/contrast.ts`:

| Token | Value | Use | Measured |
|---|---|---|---|
| `neutralSoft` | `#F1F5F9` | Table header fill, neutral status chip, hovered row, meter track | `mainText` 16.3:1 · `secondaryText` 6.92:1 · `borderStrong` 4.34:1 (non-text) |
| `mutedText` | `#64748B` | Supporting text and metadata on `surface` and `pageBackground` **only** | 4.76:1 on `surface` · 4.55:1 on `pageBackground` · **4.34:1 on `neutralSoft` — not used there** |
| `borderSoft` | `#E2E8F0` | Card and section outlines, dividers inside a card | 1.23:1 — decorative only, like `borderSubtle` (THEME-007) |

`elevation` (`card`, `raised`, `overlay`, `modal`) holds the only shadow values in the product; they
are built from `mainText` at low opacity. The derived brand palette (THEME-013) is unaffected: none
of the new tokens is derived from the brand colour, and the new pairs are part of the registry every
configured colour is validated against.
