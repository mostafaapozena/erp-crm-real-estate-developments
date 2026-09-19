import type { ReactNode } from 'react';

/**
 * Bidirectional isolation for left-to-right values inside right-to-left text (I18N-005): phone numbers,
 * emails, URLs, IBANs, account numbers, unit codes, file names. Without isolation, adjacent digits and
 * punctuation visibly reorder — `+201001234567` renders as `201001234567+`.
 */
export function LtrIsolate({ children }: { children: ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}
