import type { Permission } from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  LtrIsolate,
  StateView,
  StatusChip,
  type DataTableStatus,
  type StatusTone,
} from '@alola/ui';
import type { ReactNode } from 'react';
import type { ApiError } from '../api/client';
import { useSession } from '../api/session';
import type { AsyncState } from '../api/useApi';
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
 * The value is direction-isolated because most of them are identifiers, numbers or dates, and those
 * reorder inside Arabic text without it (ADR-0003).
 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="p">
        {label}
      </Typography>
      <Typography component="p" sx={{ fontWeight: 500, wordBreak: 'break-word' }}>
        {children}
      </Typography>
    </Box>
  );
}

/** A value that must never be reformatted: a code, a phone number, a reference (ADR-0003). */
export function Verbatim({ children }: { children: ReactNode }) {
  return <LtrIsolate>{children}</LtrIsolate>;
}

/** A titled panel. Used for every detail card so spacing and headings stay consistent. */
export function Panel({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ padding: { xs: 2, sm: 3 } }}>
      <Stack
        direction="row"
        sx={{ justifyContent: 'space-between', alignItems: 'center', marginBlockEnd: 2, gap: 1 }}
      >
        <Typography variant="h2" component="h2" sx={{ fontSize: '1.125rem' }}>
          {title}
        </Typography>
        {actions}
      </Stack>
      {children}
    </Paper>
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
