import type { PeopleLookupResult, PersonReference } from '@alola/contracts';
import { PEOPLE_LOOKUP_MAX } from '@alola/contracts';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import { visuallyHidden } from '@alola/ui';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiRequest, query } from './api/client';
import { initialsOf } from './branding';
import { useLocale } from './locale';

/**
 * Account references rendered as people (ADR-0031).
 *
 * Records carry opaque account references — `acc_…` — and a screen must never show one to a person.
 * `PersonName` asks this provider, which collects every reference rendered in the same frame and
 * resolves them in one request to `/api/v1/organization/people`, then remembers the answer for the
 * rest of the session. A reference the directory does not know renders a neutral localized label,
 * never the raw value; a system actor (`system:…`) renders as "System".
 */
type Known = ReadonlyMap<string, PersonReference | null>;

interface PeopleContextValue {
  known: Known;
  want: (accountIds: readonly string[]) => void;
}

const PeopleContext = createContext<PeopleContextValue | null>(null);

const BATCH_DELAY_MS = 16;
const SYSTEM_PREFIX = 'system:';

export function PeopleProvider({ children }: { children: ReactNode }) {
  const [known, setKnown] = useState<Known>(new Map());
  const requested = useRef(new Set<string>());
  const pending = useRef(new Set<string>());
  const timer = useRef<number | undefined>(undefined);

  const flush = useCallback(() => {
    timer.current = undefined;
    const ids = [...pending.current];
    pending.current.clear();
    for (let start = 0; start < ids.length; start += PEOPLE_LOOKUP_MAX) {
      const batch = ids.slice(start, start + PEOPLE_LOOKUP_MAX);
      apiRequest<PeopleLookupResult>(
        `/api/v1/organization/people${query({ ids: batch.join(',') })}`,
      ).then(
        (result) => {
          setKnown((previous) => {
            const next = new Map(previous);
            for (const id of batch) next.set(id, null);
            for (const person of result.items) next.set(person.accountId, person);
            return next;
          });
        },
        () => {
          setKnown((previous) => {
            const next = new Map(previous);
            for (const id of batch) next.set(id, null);
            return next;
          });
        },
      );
    }
  }, []);

  const want = useCallback(
    (accountIds: readonly string[]) => {
      for (const id of accountIds) {
        if (!id || id.startsWith(SYSTEM_PREFIX) || requested.current.has(id)) continue;
        requested.current.add(id);
        pending.current.add(id);
      }
      if (pending.current.size > 0 && timer.current === undefined) {
        timer.current = window.setTimeout(flush, BATCH_DELAY_MS);
      }
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    },
    [],
  );

  const value = useMemo(() => ({ known, want }), [known, want]);
  return <PeopleContext value={value}>{children}</PeopleContext>;
}

export type PersonState =
  | { kind: 'loading' }
  | { kind: 'system' }
  | { kind: 'unknown' }
  | { kind: 'known'; person: PersonReference };

/** The resolution state of one account reference. Outside a provider, everything is "unknown". */
export function usePerson(accountId: string | undefined): PersonState {
  const context = use(PeopleContext);
  const want = context?.want;
  useEffect(() => {
    if (accountId && want) want([accountId]);
  }, [accountId, want]);
  if (!accountId) return { kind: 'unknown' };
  if (accountId.startsWith(SYSTEM_PREFIX)) return { kind: 'system' };
  if (!context) return { kind: 'unknown' };
  const found = context.known.get(accountId);
  if (found === undefined) return { kind: 'loading' };
  return found ? { kind: 'known', person: found } : { kind: 'unknown' };
}

/** A person's name as plain text, for places that take a string (chart labels, aria-labels). */
export function usePersonLabel(): (accountId: string | undefined) => string {
  const context = use(PeopleContext);
  const { t } = useLocale();
  return useCallback(
    (accountId) => {
      if (!accountId) return t('people.unknown');
      if (accountId.startsWith(SYSTEM_PREFIX)) return t('people.system');
      const found = context?.known.get(accountId);
      if (found === undefined) {
        context?.want([accountId]);
        return '…';
      }
      return found ? found.displayName : t('people.unknown');
    },
    [context, t],
  );
}

/**
 * A person: initials, name and — where there is room — job title. `compact` drops the avatar for
 * dense table cells.
 */
export function PersonName({
  accountId,
  showTitle = false,
  compact = false,
}: {
  accountId: string | undefined;
  showTitle?: boolean;
  compact?: boolean;
}) {
  const { t, locale } = useLocale();
  const state = usePerson(accountId);

  if (state.kind === 'loading') {
    return (
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        <Box component="span" sx={visuallyHidden}>
          {t('people.loading')}
        </Box>
        <Skeleton aria-hidden variant="text" sx={{ inlineSize: 96 }} />
      </Box>
    );
  }

  const name =
    state.kind === 'known'
      ? state.person.displayName
      : state.kind === 'system'
        ? t('people.system')
        : t('people.unknown');
  const title = state.kind === 'known' ? state.person.jobTitle?.[locale] : undefined;
  const muted = state.kind !== 'known';

  return (
    <Box
      component="span"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0 }}
      data-person={state.kind}
    >
      {compact ? null : (
        <Avatar
          aria-hidden
          sx={{ inlineSize: 28, blockSize: 28, fontSize: '0.75rem', flexShrink: 0 }}
        >
          {state.kind === 'known' ? initialsOf(name) : '·'}
        </Avatar>
      )}
      <Box component="span" sx={{ minWidth: 0, display: 'inline-flex', flexDirection: 'column' }}>
        <Typography
          component="span"
          variant="body2"
          sx={{
            fontWeight: muted ? 400 : 600,
            color: muted ? 'text.secondary' : 'text.primary',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </Typography>
        {showTitle && title ? (
          <Typography component="span" variant="caption" color="text.secondary">
            {title}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}
