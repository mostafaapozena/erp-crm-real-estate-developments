import type { Permission } from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  Icon,
  LtrIsolate,
  SectionCard,
  StateView,
  StatusChip,
  type DataTableLabels,
  type DataTableStatus,
  type StatusTone,
} from '@alola/ui';
import { Search, type LucideIcon } from '@alola/ui/icons';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { ApiError } from '../api/client';
import { useSession } from '../api/session';
import type { AsyncState } from '../api/useApi';
import { useFormatters } from '../format';
import { useLocale } from '../locale';

/**
 * Status tone maps.
 *
 * Kept together so the same meaning gets the same treatment across screens: "overdue" is a danger
 * everywhere, "reserved" is an information state everywhere. Scattering these across pages is how a
 * product ends up with amber on one table and red on another for the same fact.
 *
 * Tone is never the only signal — `StatusChip` always renders the label and a shape (WCAG 1.4.1).
 */
export const UNIT_TONES: Record<string, StatusTone> = {
  available: 'success',
  held: 'warning',
  reserved: 'info',
  contracted: 'neutral',
  unavailable: 'danger',
};

export const LEAD_TONES: Record<string, StatusTone> = {
  new: 'info',
  contacted: 'info',
  qualified: 'info',
  visitScheduled: 'warning',
  negotiation: 'warning',
  reservation: 'success',
  won: 'success',
  lost: 'danger',
};

export const RESERVATION_TONES: Record<string, StatusTone> = {
  draft: 'neutral',
  pendingApproval: 'warning',
  confirmed: 'success',
  cancelled: 'danger',
  expired: 'danger',
  converted: 'info',
};

export const CONTRACT_TONES: Record<string, StatusTone> = {
  draft: 'neutral',
  active: 'success',
  cancelled: 'danger',
  completed: 'info',
};

export const INSTALLMENT_TONES: Record<string, StatusTone> = {
  upcoming: 'neutral',
  due: 'warning',
  partiallyPaid: 'warning',
  paid: 'success',
  overdue: 'danger',
  rescheduled: 'info',
  cancelled: 'neutral',
};

export const RECEIPT_TONES: Record<string, StatusTone> = {
  posted: 'success',
  reversed: 'danger',
};

export const INSTRUMENT_TONES: Record<string, StatusTone> = {
  received: 'info',
  deposited: 'info',
  presented: 'info',
  cleared: 'success',
  returned: 'danger',
  replaced: 'neutral',
  cancelled: 'neutral',
};

export const REMINDER_TONES: Record<string, StatusTone> = {
  scheduled: 'neutral',
  ready: 'info',
  simulated: 'warning',
  sent: 'success',
  failed: 'danger',
};

export const CAMPAIGN_TONES: Record<string, StatusTone> = {
  draft: 'neutral',
  readyToPublish: 'info',
  archived: 'neutral',
};

/** A chip whose label comes from a translation namespace keyed by the value itself. */
export function EnumChip({
  namespace,
  value,
  tones,
}: {
  namespace: string;
  value: string;
  tones: Record<string, StatusTone>;
}) {
  const { td } = useLocale();
  return <StatusChip tone={tones[value] ?? 'neutral'} label={td(`${namespace}.${value}`)} />;
}

/** Translate an enumerated value without a chip — for a plain cell or a select option. */
export function useEnumLabel(): (namespace: string, value: string | undefined) => string {
  const { td } = useLocale();
  return (namespace, value) => (value ? td(`${namespace}.${value}`) : '—');
}

/** Map an async state onto the table's status, so a screen never has to branch on both. */
export function tableStatus(state: AsyncState<unknown>): DataTableStatus {
  if (state.kind === 'loading') return 'loading';
  if (state.kind === 'error') return state.error.status === 403 ? 'forbidden' : 'error';
  return 'ready';
}

/**
 * Renders a screen only when the actor holds the permission.
 *
 * A courtesy, not a control: the API refuses the same request regardless, and the E2E suite proves
 * it by calling the endpoint directly after this component has hidden the route (ADR-0006).
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { can } = useSession();
  const { t } = useLocale();
  if (can(permission)) return <>{children}</>;
  return (
    <StateView
      kind="forbidden"
      title={t('states.forbiddenTitle')}
      description={t('states.forbiddenDescription')}
    />
  );
}

/** The error state with a retry, used wherever a screen loads a single record rather than a list. */
export function ErrorState({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const { t } = useLocale();
  const forbidden = error.status === 403;
  const missing = error.status === 404;
  return (
    <StateView
      kind={forbidden ? 'forbidden' : 'error'}
      title={
        forbidden
          ? t('states.forbiddenTitle')
          : missing
            ? t('states.emptyTitle')
            : t('states.errorTitle')
      }
      description={
        forbidden
          ? t('states.forbiddenDescription')
          : missing
            ? t('states.emptyDescription')
            : t('states.errorDescription')
      }
      {...(forbidden || missing
        ? {}
        : {
            action: (
              <Button variant="contained" onClick={onRetry}>
                {t('states.retry')}
              </Button>
            ),
          })}
    />
  );
}

/**
 * A labelled read-only field.
 *
 * The value is direction-isolated where it is an identifier, a number or a date — those reorder
 * inside Arabic text without it (ADR-0003) — by the caller wrapping it in `Verbatim`.
 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        component="p"
        sx={{ fontWeight: 600, marginBlockEnd: 0.25 }}
      >
        {label}
      </Typography>
      <Typography
        component="div"
        variant="body2"
        sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
      >
        {children}
      </Typography>
    </Box>
  );
}

/** A value that must never be reformatted: a code, a phone number, a reference (ADR-0003). */
export function Verbatim({ children }: { children: ReactNode }) {
  return <LtrIsolate>{children}</LtrIsolate>;
}

/** A titled section. Every detail card uses it, so spacing and headings stay consistent. */
export function Panel({
  title,
  actions,
  children,
  icon,
  description,
  flush,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  icon?: LucideIcon;
  description?: string;
  flush?: boolean;
}) {
  return (
    <SectionCard
      title={title}
      {...(actions ? { actions } : {})}
      {...(icon ? { icon } : {})}
      {...(description ? { description } : {})}
      {...(flush ? { flush } : {})}
      fill
    >
      {children}
    </SectionCard>
  );
}

/** The table state labels every list uses, in the current language. */
export function useTableLabels(): DataTableLabels {
  const { t } = useLocale();
  return {
    loadingTitle: t('states.loadingTitle'),
    loadingDescription: t('states.loadingDescription'),
    emptyTitle: t('states.emptyTitle'),
    emptyDescription: t('states.emptyDescription'),
    noResultsTitle: t('states.noResults'),
    noResultsDescription: t('states.noResultsHint'),
    errorTitle: t('states.errorTitle'),
    errorDescription: t('states.errorDescription'),
    forbiddenTitle: t('states.forbiddenTitle'),
    forbiddenDescription: t('states.forbiddenDescription'),
  };
}

/**
 * The foot of a paged list: how many of how many are shown, and the next page on request. The total
 * is the server's count within the actor's scope, never the length of what happens to be loaded.
 */
export function ListFooter({
  shown,
  total,
  hasMore,
  loadingMore,
  onLoadMore,
  error,
}: {
  shown: number;
  total: number | undefined;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  error?: ApiError | undefined;
}) {
  const { t } = useLocale();
  const format = useFormatters();
  return (
    <>
      <Typography variant="body2" color="text.secondary" component="span">
        {t('pagination.showing', {
          shown: format.number(shown),
          total: format.number(total ?? shown),
        })}
      </Typography>
      {hasMore ? (
        <Button
          variant="outlined"
          color="inherit"
          size="small"
          onClick={onLoadMore}
          disabled={loadingMore}
        >
          {loadingMore ? t('pagination.loadingMore') : t('pagination.showMore')}
        </Button>
      ) : null}
      {error ? (
        <Typography variant="body2" color="error" role="alert" component="span">
          {t('states.errorDescription')}
        </Typography>
      ) : null}
    </>
  );
}

/**
 * The search field of one list. It filters **this list** on the server — its label says so, which is
 * what tells it apart from the global search in the top bar. Enter submits; the value is kept.
 */
export function ListSearch({
  value,
  onSubmit,
  label,
  ltr = false,
}: {
  value: string;
  onSubmit: (value: string) => void;
  label?: string;
  /** For codes and phone numbers, which are typed left to right in either language. */
  ltr?: boolean;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(value);
  }
  return (
    <Box
      component="form"
      role="search"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit(draft.trim());
      }}
      sx={{ display: 'flex', gap: 1 }}
    >
      <TextField
        fullWidth
        label={label ?? t('filters.searchInList')}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        slotProps={{
          ...(ltr ? { htmlInput: { dir: 'ltr' } } : {}),
          input: {
            startAdornment: (
              <InputAdornment position="start" sx={{ color: 'text.secondary' }}>
                <Icon icon={Search} size={18} />
              </InputAdornment>
            ),
          },
        }}
      />
      <Button type="submit" variant="outlined" sx={{ flexShrink: 0 }}>
        {t('filters.searchSubmit')}
      </Button>
    </Box>
  );
}

/** A labelled select for a list filter, with an "All" option that clears it. */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
  minWidth = 170,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  minWidth?: number;
}) {
  const { t } = useLocale();
  return (
    <TextField
      select
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      sx={{ minWidth }}
    >
      <MenuItem value="">{t('filters.all')}</MenuItem>
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          {option.label}
        </MenuItem>
      ))}
    </TextField>
  );
}

/** A responsive grid of fields or cards — the layout every detail screen and dashboard uses. */
export function CardGrid({ children, min = 220 }: { children: ReactNode; min?: number }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`,
      }}
    >
      {children}
    </Box>
  );
}
