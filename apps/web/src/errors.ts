import { useCallback } from 'react';
import type { ApiError } from './api/client';
import { useLocale } from './locale';

/**
 * Turns an API failure into a sentence the person can read.
 *
 * The API never returns prose (PLAT-008, I18N-008): it returns a stable code, and the message lives
 * in the `errors` namespace in both languages. That is what stops an English exception message
 * appearing on an Arabic screen, and it is checked by the i18n key check rather than by review.
 *
 * A `429` also carries `Retry-After`, which the message repeats so the person waits the right amount
 * instead of retrying immediately.
 */
export function useErrorMessage(): (error: ApiError) => string {
  const { td } = useLocale();
  return useCallback(
    (error: ApiError) => {
      // A refusal that names its reason (`ASSIGNEE_INACTIVE`, `STALE_VERSION`) says so in the person's
      // language; one the client has no sentence for falls back to the general code's message.
      const issue = error.issues?.[0]?.code;
      if (issue && /^[A-Z][A-Z0-9_]*$/.test(issue)) {
        const issueKey = `errors:issue.${issue}`;
        const issueMessage = td(issueKey);
        if (issueMessage !== issueKey) return issueMessage;
      }
      // `errors` is keyed by the code itself, so an unknown code cannot be invented.
      const key = `errors:${error.code}`;
      const message = td(key);
      // i18next returns the key when nothing matches; fall back to the generic message rather than
      // showing a raw key to a customer.
      return message === key ? td('errors:INTERNAL_ERROR') : message;
    },
    [td],
  );
}
