/**
 * The layout scale: sizes, radii and density that every screen shares.
 *
 * Numbers rather than colours, so they are not tokens in the ADR-0005 sense, but they are just as
 * central: a screen that invents its own card padding or control height is how a product stops
 * looking like one product. Spacing values are MUI spacing units (8 px each) unless the name says px.
 */
export const layout = {
  /** The permanent navigation on desktop, expanded and collapsed to icons. */
  sidebarWidthPx: 272,
  sidebarCollapsedWidthPx: 76,
  topBarHeightPx: 64,
  /** Wide enough for a twelve-column table, narrow enough that a line of text stays readable. */
  contentMaxWidthPx: 1680,
  /** Page gutter: 16 px on a phone, 24 on a tablet, 32 on a desktop. */
  pagePadding: { xs: 2, sm: 3, lg: 4 },
  /** Vertical rhythm between the sections of a page. */
  sectionGap: 3,
  cardPadding: { xs: 2, sm: 2.5 },
  formGap: 2,
  /** Corner radii in px: controls, cards, dialogs. */
  radius: { sm: 6, md: 8, lg: 12 },
  /** Control heights in px. 40 keeps the WCAG 2.5.8 target with room to spare; 44 on touch. */
  controlHeightPx: 40,
  touchTargetPx: 44,
} as const;
