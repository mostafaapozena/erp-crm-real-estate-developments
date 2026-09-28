import Box from '@mui/material/Box';
import type { LucideIcon } from 'lucide-react';

/**
 * Every icon in the product goes through this component (ADR-0030).
 *
 * - **One library, one weight.** Glyphs come from `lucide-react` through `@alola/ui/icons`, drawn at
 *   one stroke width, so a screen never mixes a filled icon beside an outlined one.
 * - **Decorative by default.** An icon next to a word adds nothing for a screen reader, so it is hidden
 *   from the accessibility tree. An icon that stands alone must be given a `label` — or, better, sit
 *   inside a control that carries the accessible name.
 * - **Direction-aware.** A glyph that points somewhere (a chevron, "next", "back", a trend arrow)
 *   passes `mirrorInRtl`, and flips under `dir="rtl"` without a second icon or a branch in the caller.
 */
export interface IconProps {
  icon: LucideIcon;
  /** px. 16 in dense places (chips, table cells), 20 by default, 24 for page-level marks. */
  size?: number;
  /** Flip horizontally in right-to-left layouts: only for glyphs that point in the reading direction. */
  mirrorInRtl?: boolean;
  /** Only for an icon that conveys meaning on its own. Omit it for decoration. */
  label?: string;
}

export const ICON_STROKE_WIDTH = 1.75;

export function Icon({ icon: Glyph, size = 20, mirrorInRtl = false, label }: IconProps) {
  return (
    <Box
      component="span"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      data-icon=""
      sx={{
        display: 'inline-flex',
        flexShrink: 0,
        lineHeight: 0,
        '& > svg': { display: 'block' },
        ...(mirrorInRtl ? { '[dir="rtl"] &': { transform: 'scaleX(-1)' } } : {}),
      }}
    >
      <Glyph size={size} strokeWidth={ICON_STROKE_WIDTH} aria-hidden focusable={false} />
    </Box>
  );
}
