import {
  DATE_COMPONENTS,
  LEGACY_SERIES_PREFIXES,
  RESET_POLICIES,
  type Sequence,
  type SequenceType,
  type Setting,
} from '@alola/contracts';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DataTable, Icon, PageHeader, StatusChip, type DataColumn } from '@alola/ui';
import { Hash, Plus, SlidersHorizontal } from '@alola/ui/icons';
import { useMemo, useState } from 'react';
import { apiRequest } from '../api/client';
import { useSession } from '../api/session';
import { useApi, useMutation } from '../api/useApi';
import { useErrorMessage } from '../errors';
import { useFormatters, useToday } from '../format';
import { useLocale } from '../locale';
import { Panel, Verbatim, tableStatus, useTableLabels } from './shared';

/** The commercial settings this page edits directly: a number of days, or a percentage. */
const EDITABLE: Record<string, 'days' | 'hours' | 'percent'> = {
  'sales.reservationValidityDays': 'days',
  'sales.quotationValidityDays': 'days',
  'sales.unitHoldHours': 'hours',
  'sales.maximumDiscountPercent': 'percent',
};

/** The commercial documents whose numbering this page configures (SALE-RESERVE-006). */
const COMMERCIAL_TYPES: SequenceType[] = [
  'reservation',
  'contract',
  'quotation',
  'receipt',
  'customerStatement',
];

/**
 * Settings → Sales and commercial operations (PLAT-024, CORE-DOC-001, SALE-RESERVE-006).
 *
 * Two kinds of configuration, each under its own permission. **Commercial rules** are catalogued
 * settings: a value not configured is shown as such, with the decision it waits for — nothing is
 * assumed. Changing one is `settings.manage`, needs a reason, and is audited with the version it
 * replaced. **Number formats** are CORE-DOC-001 sequences: a draft can be edited and previewed, and
 * activating it — permanent in every document numbered under it — is `numbering.manage` with a
 * reason. A format of the legacy shape continues the legacy series; any other shape starts its own.
 */
export default function SalesSettingsPage() {
  const { canAny } = useSession();
  const { t } = useLocale();
  if (!canAny(['settings.view', 'numbering.view'])) {
    return (
      <Alert severity="warning" role="alert">
        {t('states.forbiddenDescription')}
      </Alert>
    );
  }
  return <SalesSettingsScreen />;
}

function SalesSettingsScreen() {
  const { t } = useLocale();
  const { can } = useSession();
  return (
    <Box>
      <PageHeader title={t('salesSettings.title')} subtitle={t('salesSettings.subtitle')} />
      <Stack spacing={3}>
        {can('settings.view') ? <CommercialRules /> : null}
        {can('numbering.view') ? <NumberFormats /> : null}
      </Stack>
    </Box>
  );
}

/* ------------------------------------------------------------ commercial rules */

function CommercialRules() {
  const { t, td } = useLocale();
  const { can } = useSession();
  const format = useFormatters();
  const labels = useTableLabels();
  const settings = useApi<{ items: Setting[] }>('/api/v1/settings');
  const [editing, setEditing] = useState<Setting | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const rows = useMemo(
    () =>
      settings.state.kind === 'ready'
        ? settings.state.data.items.filter((item) => item.category === 'sales')
        : [],
    [settings.state],
  );
  const describe = (setting: Setting): string => {
    if (setting.value === null) return t('salesSettings.notConfigured');
    const kind = EDITABLE[setting.key];
    if (kind === 'days')
      return t('salesSettings.days', { count: format.number(setting.value as number) });
    if (kind === 'hours')
      return t('salesSettings.hours', { count: format.number(setting.value as number) });
    if (kind === 'percent') return `${format.number(setting.value as string, 2)}%`;
    return t('salesSettings.configured');
  };
  const columns: DataColumn<Setting>[] = [
    {
      key: 'setting',
      header: t('salesSettings.setting'),
      render: (row) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {td(`salesSettings.key.${row.key.replace('sales.', '')}`)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {td(`salesSettings.hint.${row.key.replace('sales.', '')}`)}
          </Typography>
        </Box>
      ),
    },
    {
      key: 'value',
      header: t('salesSettings.value'),
      render: (row) => <Verbatim>{describe(row)}</Verbatim>,
    },
    {
      key: 'decision',
      header: t('salesSettings.decision'),
      render: (row) =>
        row.decision ? (
          <StatusChip
            tone={row.value === null ? 'warning' : 'neutral'}
            label={
              row.value === null
                ? t('salesSettings.awaiting', { decision: row.decision })
                : row.decision
            }
          />
        ) : (
          '—'
        ),
    },
    {
      key: 'actions',
      header: t('fields.actions'),
      render: (row) =>
        can('settings.manage') && EDITABLE[row.key] ? (
          <Button size="small" variant="outlined" onClick={() => setEditing(row)}>
            {t('salesSettings.change')}
          </Button>
        ) : null,
    },
  ];
  const awaiting = rows.filter((row) => row.decision && row.value === null);
  return (
    <Panel
      title={t('salesSettings.rulesTitle')}
      icon={SlidersHorizontal}
      description={t('salesSettings.rulesHint')}
    >
      <Stack spacing={2}>
        {notice ? (
          <Alert severity="success" role="status" onClose={() => setNotice(undefined)}>
            {notice}
          </Alert>
        ) : null}
        {awaiting.length > 0 ? (
          <Alert severity="warning" variant="outlined">
            {t('salesSettings.awaitingSummary', { count: format.number(awaiting.length) })}
          </Alert>
        ) : null}
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.key}
          status={tableStatus(settings.state)}
          caption={t('salesSettings.rulesTitle')}
          labels={labels}
        />
      </Stack>
      {editing ? (
        <SettingDialog
          setting={editing}
          onClose={() => setEditing(undefined)}
          onDone={() => {
            setEditing(undefined);
            setNotice(t('salesSettings.saved'));
            settings.reload();
          }}
        />
      ) : null}
    </Panel>
  );
}

function SettingDialog({
  setting,
  onClose,
  onDone,
}: {
  setting: Setting;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, td } = useLocale();
  const errorMessage = useErrorMessage();
  const kind = EDITABLE[setting.key];
  const [value, setValue] = useState(
    typeof setting.value === 'number' || typeof setting.value === 'string'
      ? String(setting.value)
      : '',
  );
  const [clear, setClear] = useState(false);
  const [reason, setReason] = useState('');
  const save = useMutation(() =>
    apiRequest<Setting>(`/api/v1/settings/${setting.key}`, {
      method: 'PUT',
      body: {
        value: clear ? null : kind === 'percent' ? value.trim() : Number(value),
        expectedVersion: setting.version,
        reason: reason.trim(),
      },
    }),
  );
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="setting-title">
      <DialogTitle id="setting-title">
        {td(`salesSettings.key.${setting.key.replace('sales.', '')}`)}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ paddingBlockStart: 1 }}>
          <DialogContentText>{t('salesSettings.changeHint')}</DialogContentText>
          <TextField
            label={t('salesSettings.value')}
            value={value}
            disabled={clear}
            onChange={(event) => setValue(event.target.value)}
            slotProps={{
              htmlInput: { dir: 'ltr', inputMode: kind === 'percent' ? 'decimal' : 'numeric' },
            }}
          />
          {setting.value !== null ? (
            <FormControlLabel
              control={
                <Checkbox checked={clear} onChange={(event) => setClear(event.target.checked)} />
              }
              label={t('salesSettings.clear')}
            />
          ) : null}
          <TextField
            label={t('fields.reason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            multiline
            minRows={2}
            helperText={t('confirm.reasonRequired')}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          {save.error ? (
            <Alert severity="error" role="alert">
              {errorMessage(save.error)}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        <Button
          variant="contained"
          disabled={(!clear && !value.trim()) || reason.trim().length < 3 || save.pending}
          onClick={() => void save.run(undefined).then(onDone, () => undefined)}
        >
          {t('actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* --------------------------------------------------------------- number formats */

function NumberFormats() {
  const { t, td, locale } = useLocale();
  const { can } = useSession();
  const labels = useTableLabels();
  const today = useToday();
  const sequences = useApi<{ items: Sequence[] }>('/api/v1/numbering/sequences');
  const [creating, setCreating] = useState(false);
  const [activating, setActivating] = useState<Sequence | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const rows = useMemo(
    () =>
      sequences.state.kind === 'ready'
        ? sequences.state.data.items.filter((item) => COMMERCIAL_TYPES.includes(item.type))
        : [],
    [sequences.state],
  );
  const columns: DataColumn<Sequence>[] = [
    {
      key: 'type',
      header: t('salesSettings.documentType'),
      render: (row) => td(`sequenceType.${row.type}`),
    },
    {
      key: 'example',
      header: t('salesSettings.example'),
      render: (row) => <Verbatim>{row.example}</Verbatim>,
    },
    {
      key: 'state',
      header: t('fields.state'),
      render: (row) => (
        <StatusChip
          tone={row.state === 'active' ? 'success' : row.state === 'draft' ? 'info' : 'neutral'}
          label={td(`sequenceState.${row.state}`)}
        />
      ),
    },
    {
      key: 'series',
      header: t('salesSettings.series'),
      render: (row) =>
        row.continuesLegacySeries ? t('salesSettings.continues') : t('salesSettings.newSeries'),
    },
    {
      key: 'next',
      header: t('salesSettings.next'),
      render: (row) => (row.state === 'active' ? <NextNumber type={row.type} on={today} /> : '—'),
    },
    {
      key: 'actions',
      header: t('fields.actions'),
      render: (row) =>
        row.state === 'draft' && can('numbering.manage') ? (
          <Button size="small" variant="outlined" onClick={() => setActivating(row)}>
            {t('salesSettings.activate')}
          </Button>
        ) : null,
    },
  ];
  const unconfigured = COMMERCIAL_TYPES.filter(
    (type) => !rows.some((row) => row.type === type && row.state === 'active'),
  );
  return (
    <Panel
      title={t('salesSettings.numberingTitle')}
      icon={Hash}
      description={t('salesSettings.numberingHint')}
      {...(can('numbering.manage')
        ? {
            actions: (
              <Button
                size="small"
                variant="outlined"
                startIcon={<Icon icon={Plus} size={16} />}
                onClick={() => setCreating(true)}
              >
                {t('salesSettings.newFormat')}
              </Button>
            ),
          }
        : {})}
    >
      <Stack spacing={2}>
        {notice ? (
          <Alert severity="success" role="status" onClose={() => setNotice(undefined)}>
            {notice}
          </Alert>
        ) : null}
        {unconfigured.length > 0 ? (
          <Alert severity="info" variant="outlined">
            {t('salesSettings.legacyInUse', {
              types: new Intl.ListFormat(locale, { type: 'conjunction' }).format(
                unconfigured.map((type) => td(`sequenceType.${type}`)),
              ),
            })}
          </Alert>
        ) : null}
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => `${row.type}@${row.version}`}
          status={tableStatus(sequences.state)}
          caption={t('salesSettings.numberingTitle')}
          labels={{ ...labels, emptyTitle: t('salesSettings.noFormats'), emptyDescription: '' }}
        />
      </Stack>
      {creating ? (
        <FormatDialog
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            setNotice(t('salesSettings.draftSaved'));
            sequences.reload();
          }}
        />
      ) : null}
      {activating ? (
        <ActivateDialog
          sequence={activating}
          onClose={() => setActivating(undefined)}
          onDone={() => {
            setActivating(undefined);
            setNotice(t('salesSettings.activated'));
            sequences.reload();
          }}
        />
      ) : null}
    </Panel>
  );
}

/** The number the next issue would receive. Nothing is reserved; a concurrent issue may take it. */
function NextNumber({ type, on }: { type: SequenceType; on: string }) {
  const [answer, setAnswer] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);
  const { t } = useLocale();
  const ask = useMutation(() =>
    apiRequest<{ next: string }>('/api/v1/numbering/preview', {
      method: 'POST',
      body: { type, issueDate: on },
    }),
  );
  if (answer) return <Verbatim>{answer}</Verbatim>;
  if (failed) return <>{t('salesSettings.previewNeedsCodes')}</>;
  return (
    <Button
      size="small"
      disabled={ask.pending}
      onClick={() =>
        void ask.run(undefined).then(
          (result) => setAnswer(result.next),
          () => setFailed(true),
        )
      }
    >
      {t('salesSettings.preview')}
    </Button>
  );
}

function FormatDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t, td } = useLocale();
  const errorMessage = useErrorMessage();
  const today = useToday();
  const [type, setType] = useState<SequenceType>('reservation');
  const [prefix, setPrefix] = useState('');
  const [separator, setSeparator] = useState<'-' | '/' | ''>('-');
  const [dateComponent, setDateComponent] = useState<(typeof DATE_COMPONENTS)[number]>('yyyy');
  const [resetPolicy, setResetPolicy] = useState<(typeof RESET_POLICIES)[number]>('yearly');
  const [branchComponent, setBranchComponent] = useState(false);
  const [projectComponent, setProjectComponent] = useState(false);
  const [padding, setPadding] = useState('5');
  const [startAt, setStartAt] = useState('1');
  const [effectiveFrom, setEffectiveFrom] = useState<string>(today);
  const legacy = LEGACY_SERIES_PREFIXES[type];
  const create = useMutation(() =>
    apiRequest<Sequence>('/api/v1/numbering/sequences', {
      method: 'POST',
      body: {
        type,
        prefix: prefix.trim(),
        separator,
        dateComponent,
        branchComponent,
        projectComponent,
        padding: Number(padding),
        resetPolicy,
        startAt: Number(startAt),
        effectiveFrom,
      },
    }),
  );
  const useLegacyShape = () => {
    if (!legacy) return;
    setPrefix(legacy);
    setSeparator('-');
    setDateComponent('yyyy');
    setResetPolicy('yearly');
    setBranchComponent(false);
    setProjectComponent(false);
    setPadding('5');
    setStartAt('1');
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="format-title">
      <DialogTitle id="format-title">{t('salesSettings.newFormat')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ paddingBlockStart: 1 }}>
          <Alert severity="info" variant="outlined">
            {t('salesSettings.proposedOnly')}
          </Alert>
          <TextField
            select
            label={t('salesSettings.documentType')}
            value={type}
            onChange={(event) => setType(event.target.value as SequenceType)}
          >
            {COMMERCIAL_TYPES.map((value) => (
              <MenuItem key={value} value={value}>
                {td(`sequenceType.${value}`)}
              </MenuItem>
            ))}
          </TextField>
          {legacy ? (
            <Box>
              <Button size="small" variant="outlined" onClick={useLegacyShape}>
                {t('salesSettings.useLegacyShape', { prefix: legacy })}
              </Button>
            </Box>
          ) : null}
          <TextField
            label={t('salesSettings.prefix')}
            value={prefix}
            onChange={(event) => setPrefix(event.target.value.toUpperCase())}
            required
            slotProps={{ htmlInput: { dir: 'ltr', maxLength: 12 } }}
          />
          <TextField
            select
            label={t('salesSettings.separator')}
            value={separator}
            onChange={(event) => setSeparator(event.target.value as '-' | '/' | '')}
          >
            <MenuItem value="-">-</MenuItem>
            <MenuItem value="/">/</MenuItem>
            <MenuItem value="">{t('salesSettings.noSeparator')}</MenuItem>
          </TextField>
          <TextField
            select
            label={t('salesSettings.dateComponent')}
            value={dateComponent}
            onChange={(event) =>
              setDateComponent(event.target.value as (typeof DATE_COMPONENTS)[number])
            }
          >
            {DATE_COMPONENTS.map((value) => (
              <MenuItem key={value} value={value}>
                {td(`sequenceDate.${value}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label={t('salesSettings.resetPolicy')}
            value={resetPolicy}
            onChange={(event) =>
              setResetPolicy(event.target.value as (typeof RESET_POLICIES)[number])
            }
          >
            {RESET_POLICIES.map((value) => (
              <MenuItem key={value} value={value}>
                {td(`sequenceReset.${value}`)}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={
              <Checkbox
                checked={branchComponent}
                onChange={(event) => setBranchComponent(event.target.checked)}
              />
            }
            label={t('salesSettings.branchComponent')}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={projectComponent}
                onChange={(event) => setProjectComponent(event.target.checked)}
              />
            }
            label={t('salesSettings.projectComponent')}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label={t('salesSettings.padding')}
              value={padding}
              onChange={(event) => setPadding(event.target.value)}
              slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'numeric' } }}
              fullWidth
            />
            <TextField
              label={t('salesSettings.startAt')}
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
              slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'numeric' } }}
              fullWidth
            />
          </Stack>
          <TextField
            label={t('salesSettings.effectiveFrom')}
            type="date"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          {create.error ? (
            <Alert severity="error" role="alert">
              {errorMessage(create.error)}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!prefix.trim() || create.pending}
          onClick={() => void create.run(undefined).then(onDone, () => undefined)}
        >
          {t('salesSettings.saveDraft')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ActivateDialog({
  sequence,
  onClose,
  onDone,
}: {
  sequence: Sequence;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, td } = useLocale();
  const errorMessage = useErrorMessage();
  const [reason, setReason] = useState('');
  const activate = useMutation(() =>
    apiRequest<Sequence>(
      `/api/v1/numbering/sequences/${sequence.type}/versions/${sequence.version}/activate`,
      {
        method: 'POST',
        body: { reason: reason.trim() },
      },
    ),
  );
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="activate-format-title">
      <DialogTitle id="activate-format-title">{t('salesSettings.activateTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ paddingBlockStart: 1 }}>
          <DialogContentText>
            {t('salesSettings.activateHint', {
              type: td(`sequenceType.${sequence.type}`),
              example: sequence.example,
            })}
          </DialogContentText>
          <Alert
            severity={sequence.continuesLegacySeries ? 'success' : 'warning'}
            variant="outlined"
          >
            {sequence.continuesLegacySeries
              ? t('salesSettings.willContinue')
              : t('salesSettings.willStartNew')}
          </Alert>
          <TextField
            label={t('fields.reason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            multiline
            minRows={2}
            helperText={t('confirm.reasonRequired')}
          />
          {activate.error ? (
            <Alert severity="error" role="alert">
              {errorMessage(activate.error)}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        <Button
          variant="contained"
          disabled={reason.trim().length < 3 || activate.pending}
          onClick={() => void activate.run(undefined).then(onDone, () => undefined)}
        >
          {t('salesSettings.activate')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
