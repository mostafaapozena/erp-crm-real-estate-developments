import Box from '@mui/material/Box';
import type { ReactNode } from 'react';
import { visuallyHidden } from './StatusChip';

/**
 * RTL-safe display of formatted values (I18N-005, SD-23).
 *
 * The formatters return correct **logical** strings — `24.62%`, `4,000,000.00 ج.م.`, `EGP 12.50`,
 * `CTR-2026-00002` — and the defects the review found were all in how those strings were *placed*:
 *
 * - a bare `24.62%` inside right-to-left text renders as `%24.62`, because `%` is a neutral that
 *   takes the paragraph direction;
 * - an Arabic money string forced into a left-to-right isolate reorders its `ج.م.` unit;
 * - a value that wraps can leave its last character or its currency on a line of its own.
 *
 * So the direction of the isolate follows the **content**, not the page: a value with Arabic letters
 * (Arabic money, an Arabic label) is isolated right-to-left; everything else (digits, percentages,
 * dates, English money, codes, phone numbers, e-mail addresses) is isolated left-to-right. Isolation
 * is done with `<bdi dir>` — markup, not invisible control characters — so copying a value copies
 * exactly the value. Numeric values never wrap inside themselves; long addresses may break anywhere.
 */
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-ﻼ]/;

export function isolationDirection(text: string): 'rtl' | 'ltr' {
  return ARABIC_SCRIPT.test(text) ? 'rtl' : 'ltr';
}

/** A value that may be long and is not a number (an e-mail, a URL) may wrap; a number never does. */
function wraps(text: string): boolean {
  return text.length > 24 && /[@/]/.test(text);
}

function textOf(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(textOf).join('');
  return '';
}

export function FormattedValue({ children }: { children: ReactNode }) {
  const text = textOf(children);
  return (
    <Box
      component="bdi"
      dir={isolationDirection(text)}
      data-value=""
      sx={
        wraps(text)
          ? { overflowWrap: 'anywhere' }
          : { whiteSpace: 'nowrap', unicodeBidi: 'isolate' }
      }
    >
      {children}
    </Box>
  );
}

/**
 * Two values and a separator — a budget range, a period. Each value is a `FormattedValue`, so it
 * never splits; the separator sits between them in both directions because the three are laid out
 * in the page's inline direction; the range may wrap only between whole values.
 */
export function ValueRange({
  from,
  to,
  spokenSeparator,
}: {
  from: string;
  to: string;
  /** What a screen reader says between the values ("to" / "إلى"); the dash itself is hidden. */
  spokenSeparator: string;
}) {
  return (
    <Box
      component="span"
      data-range=""
      sx={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        columnGap: 0.75,
        rowGap: 0,
      }}
    >
      <FormattedValue>{from}</FormattedValue>
      <Box component="span" aria-hidden sx={{ color: 'text.secondary' }}>
        –
      </Box>
      <Box component="span" sx={visuallyHidden}>
        {` ${spokenSeparator} `}
      </Box>
      <FormattedValue>{to}</FormattedValue>
    </Box>
  );
}
