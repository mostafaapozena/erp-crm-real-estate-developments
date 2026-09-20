# ADR-0003 — Arabic-first localization with Arabic and English shipped together

- Status: Accepted · Digit rule added by stakeholder decision `SD-23`, 2026-09-19 (see status update)
- Date: 2026-09-19
- Deciders: Implementation team, ratified by ALOLA blueprint revision 2.0
- Scope: Localization

## Context

ALOLA's users work in Arabic. The common industry pattern — build in English, "add Arabic later" —
fails specifically for RTL products: layout, icon direction, input handling, table alignment, PDF
rendering, and number/date formatting all encode direction assumptions that are cheap to get right at
the start and extremely expensive to retrofit. A partially translated interface is also worse than
either single language, because users cannot predict which half they will get.

The supplementary Arabic business scope confirms Arabic as the primary language
(`مع اعتبار العربية اللغة الأساسية للنظام`).

## Decision

**Arabic is the default and the primary acceptance locale. Arabic and English ship together in the same
change, or the change is not done.**

1. **No deferral.** Every component, message, email, notification, PDF, and error carries complete
   `ar` and `en` keys in the commit that introduces it.
2. **CI enforcement.** A missing key in either locale fails the build. A mixed-language screen is a
   defect, not a cosmetic issue.
3. **No hard-coded user-facing text.** Anywhere. Including validation messages, empty states, chart
   axis labels, and PDF headers.
4. **APIs return stable machine codes, not prose.** The server returns `UNIT_ALREADY_RESERVED`; the
   client localizes it. This keeps the API contract stable across locales and lets one error be
   rendered in both languages without a server change.
5. **Configurable labels are bilingual by shape.** Any admin-configurable dictionary value — unit type,
   loss reason, status label, document type, approval reason — is stored as `{ ar, en }`.
6. **User-entered content is never machine-translated.** Customer names, notes, addresses, and document
   contents are stored and displayed exactly as entered.
7. **Direction is atomic with locale.** Switching locale changes `dir` on the document root in the same
   commit of state. Arabic is RTL; English is LTR. Use CSS logical properties (`margin-inline-start`,
   not `margin-left`). Mirror only genuinely directional icons — never mirror logos, charts with a time
   axis, media controls, or numerals.
8. **Mixed-direction fields get explicit handling.** Phone numbers, emails, URLs, IBANs, unit codes, and
   account numbers are LTR content inside an RTL layout and must be isolated so they do not reorder.
9. **Locale-aware formatting** for dates, numbers, currency, percentages, and plurals — never
   string concatenation for any of them.
10. **Fonts are hosted locally**, not fetched from a third-party CDN: Alexandria for Arabic, Inter for
    English, only the weights actually used. Arabic-capable fonts must be embedded in generated PDFs,
    or Arabic text will render as missing glyphs in reports.

## Consequences

**Accepted benefits**

- RTL is correct from the first component instead of being a retrofit project.
- Translation coverage is a build-time guarantee, not a manual audit.
- The API is locale-independent and stays stable as copy changes.

**Accepted costs**

- Every UI change costs two sets of keys and two directional reviews. Accepted: this is the product's
  primary constraint, not overhead.
- Playwright E2E tests run in both directions, roughly doubling E2E time. Accepted.
- Developers must resist `margin-left`. Mitigation: a lint rule against physical CSS properties.

## Compliance

- Missing-key check must fail CI.
- Lint must reject hard-coded user-facing strings and physical CSS direction properties.
- Every phase gate verifies Arabic RTL and English LTR across navigation, forms, tables, dialogs,
  charts, print, and PDFs.
- PDF generation tests must assert Arabic glyph rendering, not merely that a file was produced.

## Status update — 2026-09-19: digits and numeric formatting (`SD-23`)

Stakeholder decision `SD-23`, **approved and closed**: the application uses **Western digits (0–9) in
both Arabic and English** interfaces.

| Value | Arabic UI | English UI |
|---|---|---|
| Number | `1,234.50` | `1,234.50` |
| Money | `250,000 ج.م.` | `EGP 250,000` |
| Percentage | `15.5%` | `15.5%` |
| Date | `15/09/2026` | `15/09/2026` |
| Date and time | `15/09/2026 08:05` (24-hour) | `15/09/2026 08:05` |

Rules:

1. Arabic text remains RTL. Western digits joined by `,` `.` `/` `:` form a single left-to-right run
   inside RTL text, so numeric ordering stays clear. Phone numbers, IDs, account numbers, and unit codes
   are additionally isolated with `LtrIsolate` (I18N-005).
2. Separators and currency labels are locale-aware (CLDR): Arabic currency label `ج.م.` after the amount,
   English `EGP` before it, a non-breaking space between.
3. Every formatter uses the `-u-nu-latn` locale extension, so no locale default (for example `ar-EG`)
   can switch to Arabic-Indic digits.
4. Dates are numeric `dd/MM/yyyy` in both languages. The English order follows the approved Arabic
   example so both languages read dates identically; month names are not used.
5. Formatting is **display only.** Stored and API values stay language-neutral — decimal strings, ISO-8601
   dates, `Decimal128` — and are never converted to Arabic-Indic characters. Contracts reject
   Arabic-Indic digits in decimal strings and business dates.
6. ICU's invisible bidi marks are removed for deterministic output, except one leading left-to-right mark
   on negative numbers, which keeps the minus sign attached in RTL text.

Implemented in `packages/i18n/src/format.ts`; verified by the `SD-23` tests in
`packages/i18n/src/i18n.test.ts`.

## References

- `docs/MASTER-MAPPING.md` §5.1, §5.2
- `CLAUDE.md` — Arabic default; bilingual keys together; no hard-coded text or direction
- Arabic scope document p3; see [../discovery/arabic-scope-review.md](../discovery/arabic-scope-review.md)
- [../glossary.md](../glossary.md) — the approved bilingual terminology
