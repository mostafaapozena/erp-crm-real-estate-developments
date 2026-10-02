import {
  OPPORTUNITY_TRANSITIONS,
  SYSTEM_OPPORTUNITY_STAGES,
  type Opportunity,
  type OpportunityPage,
  type OpportunityStage,
  type Project,
} from '@alola/contracts';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { DataTable, Icon, type DataColumn } from '@alola/ui';
import { Handshake, Plus } from '@alola/ui/icons';
import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { apiRequest, query } from '../api/client';
import { useSession } from '../api/session';
import { useApi, useMutation } from '../api/useApi';
import { useBranding } from '../branding';
import { useErrorMessage } from '../errors';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { PersonName } from '../people';
import { useProjectNames } from './lookups';
import {
  EnumChip,
  OPPORTUNITY_TONES,
  Panel,
  Verbatim,
  tableStatus,
  useTableLabels,
} from './shared';

/**
 * A customer's opportunities (CRM-OPP-001, CRM-PIPE-001): each a prospective sale, several at once.
 *
 * A person moves an opportunity between the open stages and to `lost`; `reservation` and `won` are
 * set only by the sales workflow — a reservation and an activated contract — so they are not offered
 * here, and the server refuses them if asked (`STAGE_SET_BY_SALES`). From an open opportunity the
 * next steps are a quotation and a reservation, each opened pre-filled.
 */
export function OpportunitiesPanel({ customerId }: { customerId: string }) {
  const { t } = useLocale();
  const { can } = useSession();
  const format = useFormatters();
  const labels = useTableLabels();
  const projectName = useProjectNames();
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<Opportunity | undefined>();
  const list = useApi<OpportunityPage>(
    `/api/v1/crm/opportunities${query({ customerId, limit: 50 })}`,
  );
  const rows = list.state.kind === 'ready' ? list.state.data.items : [];

  const columns = useMemo<DataColumn<Opportunity>[]>(
    () => [
      {
        key: 'stage',
        header: t('opportunities.stage'),
        render: (row) => (
          <EnumChip namespace="opportunityStage" value={row.stage} tones={OPPORTUNITY_TONES} />
        ),
      },
      {
        key: 'project',
        header: t('fields.project'),
        render: (row) => projectName(row.projectId) ?? '—',
      },
      {
        key: 'value',
        header: t('opportunities.expectedValue'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.expectedValue)}</Verbatim>,
      },
      {
        key: 'close',
        header: t('opportunities.expectedCloseOn'),
        render: (row) => <Verbatim>{format.date(row.expectedCloseOn)}</Verbatim>,
        secondary: true,
      },
      {
        key: 'owner',
        header: t('fields.owner'),
        render: (row) => <PersonName accountId={row.ownerAccountId} />,
        secondary: true,
      },
      {
        key: 'actions',
        header: t('fields.actions'),
        render: (row) => {
          const open = row.stage !== 'won' && row.stage !== 'lost' && row.stage !== 'reservation';
          return (
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              {can('crm.opportunity.manage') && row.stage !== 'won' ? (
                <Button
                  size="small"
                  variant="outlined"
                  color="inherit"
                  onClick={() => setMoving(row)}
                >
                  {t('actions.changeStage')}
                </Button>
              ) : null}
              {open && can('sales.quotation.manage') ? (
                <Button
                  size="small"
                  variant="outlined"
                  component={RouterLink}
                  to={`/quotations/new?opportunityId=${row.opportunityId}&customerId=${row.customerId}`}
                >
                  {t('opportunities.quote')}
                </Button>
              ) : null}
              {open && can('sales.reservation.create') ? (
                <Button
                  size="small"
                  variant="outlined"
                  component={RouterLink}
                  to={`/reservations/new?opportunityId=${row.opportunityId}&customerId=${row.customerId}`}
                >
                  {t('opportunities.reserve')}
                </Button>
              ) : null}
            </Stack>
          );
        },
      },
    ],
    [can, format, projectName, t],
  );

  return (
    <Panel
      title={t('opportunities.title')}
      icon={Handshake}
      flush
      actions={
        can('crm.opportunity.manage') ? (
          <Button
            size="small"
            variant="outlined"
            startIcon={<Icon icon={Plus} size={16} />}
            onClick={() => setCreating(true)}
          >
            {t('opportunities.new')}
          </Button>
        ) : undefined
      }
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.opportunityId}
        status={tableStatus(list.state)}
        caption={t('opportunities.title')}
        labels={{ ...labels, emptyTitle: t('opportunities.empty'), emptyDescription: '' }}
        errorAction={
          <Button variant="outlined" onClick={list.reload}>
            {t('states.retry')}
          </Button>
        }
      />
      {creating ? (
        <NewOpportunityDialog
          customerId={customerId}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            list.reload();
          }}
        />
      ) : null}
      {moving ? (
        <StageDialog
          opportunity={moving}
          onClose={() => setMoving(undefined)}
          onDone={() => {
            setMoving(undefined);
            list.reload();
          }}
        />
      ) : null}
    </Panel>
  );
}

function NewOpportunityDialog({
  customerId,
  onClose,
  onDone,
}: {
  customerId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, locale } = useLocale();
  const { can } = useSession();
  const { baseCurrency } = useBranding();
  const errorMessage = useErrorMessage();
  const projects = useApi<{ items: Project[] }>(
    can('inventory.project.view') ? '/api/v1/inventory/projects' : undefined,
  );
  const [projectId, setProjectId] = useState('');
  const [expectedValue, setExpectedValue] = useState('');
  const [expectedCloseOn, setExpectedCloseOn] = useState('');
  const [notes, setNotes] = useState('');
  const create = useMutation(() =>
    apiRequest<Opportunity>('/api/v1/crm/opportunities', {
      method: 'POST',
      body: {
        customerId,
        ...(projectId ? { projectId } : {}),
        ...(expectedValue.trim() && baseCurrency
          ? { expectedValue: { amount: expectedValue.trim(), currency: baseCurrency } }
          : {}),
        ...(expectedCloseOn ? { expectedCloseOn } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      },
    }),
  );
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="new-opportunity-title">
      <DialogTitle id="new-opportunity-title">{t('opportunities.new')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ paddingBlockStart: 1 }}>
          {projects.state.kind === 'ready' ? (
            <TextField
              select
              label={t('fields.project')}
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              helperText={t('plan.optional')}
            >
              <MenuItem value="">{t('filters.all')}</MenuItem>
              {projects.state.data.items.map((project) => (
                <MenuItem key={project.projectId} value={project.projectId}>
                  {project.name[locale]}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          {baseCurrency ? (
            <TextField
              label={t('opportunities.expectedValue')}
              value={expectedValue}
              onChange={(event) => setExpectedValue(event.target.value)}
              helperText={t('plan.optional')}
              slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'decimal' } }}
            />
          ) : null}
          <TextField
            label={t('opportunities.expectedCloseOn')}
            type="date"
            value={expectedCloseOn}
            onChange={(event) => setExpectedCloseOn(event.target.value)}
            helperText={t('plan.optional')}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label={t('fields.notes')}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            multiline
            minRows={2}
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
          disabled={create.pending}
          onClick={() => void create.run(undefined).then(onDone, () => undefined)}
        >
          {t('actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function StageDialog({
  opportunity,
  onClose,
  onDone,
}: {
  opportunity: Opportunity;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, td } = useLocale();
  const errorMessage = useErrorMessage();
  const options = OPPORTUNITY_TRANSITIONS[opportunity.stage].filter(
    (stage) => !SYSTEM_OPPORTUNITY_STAGES.includes(stage),
  );
  const [stage, setStage] = useState<OpportunityStage | ''>(options[0] ?? '');
  const [reason, setReason] = useState('');
  const needsReason = stage === 'lost';
  const move = useMutation(() =>
    apiRequest<Opportunity>(`/api/v1/crm/opportunities/${opportunity.opportunityId}/stage`, {
      method: 'POST',
      body: {
        stage,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        expectedVersion: opportunity.version,
      },
    }),
  );
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="stage-title">
      <DialogTitle id="stage-title">{t('actions.changeStage')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ paddingBlockStart: 1 }}>
          <DialogContentText>{t('opportunities.stageHint')}</DialogContentText>
          {options.length === 0 ? (
            <Alert severity="info">{t('opportunities.noManualStage')}</Alert>
          ) : (
            <TextField
              select
              label={t('opportunities.stage')}
              value={stage}
              onChange={(event) => setStage(event.target.value as OpportunityStage)}
            >
              {options.map((value) => (
                <MenuItem key={value} value={value}>
                  {td(`opportunityStage.${value}`)}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField
            label={t('fields.reason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required={needsReason}
            multiline
            minRows={2}
            helperText={needsReason ? t('confirm.reasonRequired') : t('plan.optional')}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          {move.error ? (
            <Alert severity="error" role="alert">
              {errorMessage(move.error)}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!stage || (needsReason && reason.trim().length < 3) || move.pending}
          onClick={() => void move.run(undefined).then(onDone, () => undefined)}
        >
          {t('actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
