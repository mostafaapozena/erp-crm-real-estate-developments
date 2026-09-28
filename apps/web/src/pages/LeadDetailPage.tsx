import type { Activity, Lead, LEAD_STAGES } from '@alola/contracts';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { PageHeader, StateView } from '@alola/ui';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { apiRequest, type ApiError } from '../api/client';
import { useSession } from '../api/session';
import { useApi, useMutation } from '../api/useApi';
import { useErrorMessage } from '../errors';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { PersonName } from '../people';
import {
  CardGrid,
  EnumChip,
  ErrorState,
  Field,
  LEAD_TONES,
  Panel,
  RequirePermission,
  Verbatim,
} from './shared';

type LeadStage = (typeof LEAD_STAGES)[number];

const STAGES: LeadStage[] = [
  'new',
  'contacted',
  'qualified',
  'visitScheduled',
  'negotiation',
  'reservation',
  'won',
  'lost',
];

const ACTIVITY_KINDS = [
  'note',
  'call',
  'whatsapp',
  'meeting',
  'siteVisit',
  'followUpScheduled',
] as const;

/**
 * One lead: its details, its timeline, and the two things a sales person does to it — move it
 * through the pipeline and record what happened.
 *
 * Moving to `lost` requires a reason, and the form enforces that before the request goes out, so the
 * person gets the message next to the field rather than as a generic validation failure. The server
 * refuses it regardless.
 */
export default function LeadDetailPage() {
  return (
    <RequirePermission permission="crm.lead.view">
      <LeadDetailScreen />
    </RequirePermission>
  );
}

function LeadDetailScreen() {
  const { leadId } = useParams<{ leadId: string }>();
  const { t, td } = useLocale();
  const { can } = useSession();
  const format = useFormatters();
  const errorMessage = useErrorMessage();

  const lead = useApi<Lead>(leadId ? `/api/v1/crm/leads/${leadId}` : undefined);
  const activities = useApi<{ items: Activity[] }>(
    leadId ? `/api/v1/crm/leads/${leadId}/activities` : undefined,
  );

  if (lead.state.kind === 'loading') {
    return <StateView kind="loading" title={t('states.loadingTitle')} />;
  }
  if (lead.state.kind === 'error') {
    return <ErrorState error={lead.state.error} onRetry={lead.reload} />;
  }
  const data = lead.state.data;

  const reload = () => {
    lead.reload();
    activities.reload();
  };

  return (
    <Box>
      <PageHeader
        title={data.name}
        subtitle={t('crm.leadDetails')}
        banner={<EnumChip namespace="leadStage" value={data.stage} tones={LEAD_TONES} />}
      />

      <Stack spacing={3}>
        <Panel title={t('crm.leadDetails')}>
          <CardGrid min={200}>
            <Field label={t('fields.phone')}>
              <Verbatim>{data.primaryPhone}</Verbatim>
            </Field>
            {data.secondaryPhone ? (
              <Field label={t('fields.secondaryPhone')}>
                <Verbatim>{data.secondaryPhone}</Verbatim>
              </Field>
            ) : null}
            {data.email ? (
              <Field label={t('fields.email')}>
                <Verbatim>{data.email}</Verbatim>
              </Field>
            ) : null}
            <Field label={t('crm.source')}>{td(`leadSource.${data.source}`)}</Field>
            <Field label={t('crm.assignedTo')}>
              <PersonName accountId={data.assignedToAccountId} showTitle />
            </Field>
            <Field label={t('crm.nextFollowUp')}>{format.date(data.nextFollowUpOn)}</Field>
            {data.budgetMin || data.budgetMax ? (
              <Field label={t('crm.budget')}>
                {`${format.money(data.budgetMin)} – ${format.money(data.budgetMax)}`}
              </Field>
            ) : null}
            {data.lostReason ? <Field label={t('crm.lostReason')}>{data.lostReason}</Field> : null}
            <Field label={t('fields.createdAt')}>{format.dateTime(data.createdAt)}</Field>
          </CardGrid>
          {data.notes ? (
            <Box sx={{ marginBlockStart: 2 }}>
              <Field label={t('fields.notes')}>{data.notes}</Field>
            </Box>
          ) : null}
        </Panel>

        {can('sales.reservation.create') && data.stage !== 'lost' && data.stage !== 'won' ? (
          <Alert
            severity="info"
            variant="outlined"
            action={
              <Button
                component={Link}
                to={`/reservations/new?leadId=${data.leadId}`}
                variant="contained"
                size="small"
              >
                {t('sales.newReservation')}
              </Button>
            }
          >
            {t('sales.selectUnitHint')}
          </Alert>
        ) : null}

        {can('crm.lead.edit') ? (
          <StageForm lead={data} onDone={reload} errorMessage={errorMessage} />
        ) : null}

        {can('crm.activity.create') ? (
          <ActivityForm leadId={data.leadId} onDone={reload} errorMessage={errorMessage} />
        ) : null}

        <Panel title={t('crm.timeline')}>
          {activities.state.kind === 'ready' && activities.state.data.items.length > 0 ? (
            <Stack spacing={2} component="ol" sx={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {activities.state.data.items.map((activity) => (
                <Box key={activity.activityId} component="li">
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {td(`activityKind.${activity.kind}`)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      <Verbatim>{format.dateTime(activity.occurredAt)}</Verbatim>
                    </Typography>
                  </Stack>
                  {activity.fromStage && activity.toStage ? (
                    <Typography variant="body2" color="text.secondary">
                      {`${td(`leadStage.${activity.fromStage}`)} → ${td(`leadStage.${activity.toStage}`)}`}
                    </Typography>
                  ) : null}
                  {activity.body ? <Typography variant="body2">{activity.body}</Typography> : null}
                  {activity.dueOn ? (
                    <Typography variant="caption" color="text.secondary">
                      {`${t('crm.activityDueOn')}: `}
                      <Verbatim>{format.date(activity.dueOn)}</Verbatim>
                    </Typography>
                  ) : null}
                  <Divider sx={{ marginBlockStart: 1.5 }} />
                </Box>
              ))}
            </Stack>
          ) : (
            <Typography color="text.secondary">{t('states.emptyDescription')}</Typography>
          )}
        </Panel>
      </Stack>
    </Box>
  );
}

function StageForm({
  lead,
  onDone,
  errorMessage,
}: {
  lead: Lead;
  onDone: () => void;
  errorMessage: (error: ApiError) => string;
}) {
  const { t, td } = useLocale();
  const [stage, setStage] = useState<LeadStage>(lead.stage);
  const [reason, setReason] = useState('');

  const change = useMutation<void, unknown>(() =>
    apiRequest(`/api/v1/crm/leads/${lead.leadId}/stage`, {
      method: 'POST',
      body: { stage, ...(reason.trim() ? { reason: reason.trim() } : {}) },
    }),
  );

  // Checked here so the person sees it beside the field, and again on the server, which is the rule.
  const reasonMissing = stage === 'lost' && reason.trim().length === 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (reasonMissing) return;
    try {
      await change.run();
      setReason('');
      onDone();
    } catch {
      /* rendered from change.error */
    }
  }

  return (
    <Panel title={t('actions.changeStage')}>
      <Stack component="form" onSubmit={(event) => void submit(event)} spacing={2} noValidate>
        {change.error ? (
          <Alert severity="error" role="alert">
            {errorMessage(change.error)}
          </Alert>
        ) : null}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            label={t('crm.stage')}
            value={stage}
            onChange={(event) => setStage(event.target.value as LeadStage)}
            sx={{ minWidth: 220 }}
          >
            {STAGES.map((value) => (
              <MenuItem key={value} value={value}>
                {td(`leadStage.${value}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('fields.reason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required={stage === 'lost'}
            error={reasonMissing && reason !== ''}
            helperText={stage === 'lost' ? t('confirm.reasonRequired') : undefined}
            sx={{ flexGrow: 1 }}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={change.pending || stage === lead.stage || reasonMissing}
          >
            {t('actions.save')}
          </Button>
        </Stack>
      </Stack>
    </Panel>
  );
}

function ActivityForm({
  leadId,
  onDone,
  errorMessage,
}: {
  leadId: string;
  onDone: () => void;
  errorMessage: (error: ApiError) => string;
}) {
  const { t, td } = useLocale();
  const [kind, setKind] = useState<(typeof ACTIVITY_KINDS)[number]>('call');
  const [body, setBody] = useState('');
  const [dueOn, setDueOn] = useState('');

  const add = useMutation<void, unknown>(() =>
    apiRequest(`/api/v1/crm/leads/${leadId}/activities`, {
      method: 'POST',
      body: {
        kind,
        ...(body.trim() ? { body: body.trim() } : {}),
        ...(dueOn ? { dueOn } : {}),
      },
    }),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await add.run();
      setBody('');
      setDueOn('');
      onDone();
    } catch {
      /* rendered from add.error */
    }
  }

  return (
    <Panel title={t('actions.addActivity')}>
      <Stack component="form" onSubmit={(event) => void submit(event)} spacing={2} noValidate>
        {add.error ? (
          <Alert severity="error" role="alert">
            {errorMessage(add.error)}
          </Alert>
        ) : null}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            label={t('activityKind.note')}
            value={kind}
            onChange={(event) => setKind(event.target.value as (typeof ACTIVITY_KINDS)[number])}
            sx={{ minWidth: 200 }}
          >
            {ACTIVITY_KINDS.map((value) => (
              <MenuItem key={value} value={value}>
                {td(`activityKind.${value}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('crm.activityBody')}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            sx={{ flexGrow: 1 }}
          />
          <TextField
            label={t('crm.activityDueOn')}
            type="date"
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Button type="submit" variant="contained" disabled={add.pending}>
            {t('actions.save')}
          </Button>
        </Stack>
      </Stack>
    </Panel>
  );
}
