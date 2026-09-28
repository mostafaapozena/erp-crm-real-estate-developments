import type { Activity, Lead, LEAD_STAGES } from '@alola/contracts';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { PageHeader, StateView, ValueRange } from '@alola/ui';
import {
  BadgeCheck,
  CalendarClock,
  CircleDot,
  FilePen,
  History,
  MapPin,
  MessageCircle,
  Phone,
  TrendingUp,
  UserPlus,
  Users,
  type LucideIcon,
} from '@alola/ui/icons';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { apiRequest, type ApiError } from '../api/client';
import { useSession } from '../api/session';
import { useApi, useMutation, type AsyncState } from '../api/useApi';
import { useErrorMessage } from '../errors';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { PersonName } from '../people';
import { useBreadcrumbTail } from '../shell/breadcrumbs';
import {
  BackLink,
  DetailLayout,
  EnumChip,
  ErrorState,
  Field,
  FieldGroup,
  LEAD_TONES,
  Panel,
  RequirePermission,
  SystemNote,
  Timeline,
  Transition,
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

/** One glyph per kind of activity, so the timeline can be scanned by shape as well as by word. */
const ACTIVITY_ICONS: Partial<Record<Activity['kind'], LucideIcon>> = {
  note: FilePen,
  call: Phone,
  whatsapp: MessageCircle,
  meeting: Users,
  siteVisit: MapPin,
  followUpScheduled: CalendarClock,
  stageChanged: TrendingUp,
  assignmentChanged: UserPlus,
  converted: BadgeCheck,
};

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

  useBreadcrumbTail(lead.state.kind === 'ready' ? lead.state.data.name : undefined);

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
      <BackLink to="/leads" label={t('detail.backTo', { list: t('nav.crm') })} />
      <PageHeader
        eyebrow={t('detail.lead')}
        title={data.name}
        status={<EnumChip namespace="leadStage" value={data.stage} tones={LEAD_TONES} />}
        meta={
          <>
            <span>{td(`leadSource.${data.source}`)}</span>
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
              {`${t('crm.assignedTo')}:`}
              <PersonName accountId={data.assignedToAccountId} compact />
            </Box>
          </>
        }
      />

      <DetailLayout
        main={
          <>
            <Panel title={t('crm.leadDetails')} icon={UserPlus}>
              <Stack spacing={3}>
                <FieldGroup title={t('detail.contact')}>
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
                </FieldGroup>
                <FieldGroup title={t('detail.interest')}>
                  <Field label={t('crm.source')}>{td(`leadSource.${data.source}`)}</Field>
                  {data.budgetMin || data.budgetMax ? (
                    <Field label={t('crm.budget')}>
                      <ValueRange
                        from={format.money(data.budgetMin)}
                        to={format.money(data.budgetMax)}
                        spokenSeparator={t('detail.rangeTo')}
                      />
                    </Field>
                  ) : null}
                  {data.lostReason ? (
                    <Field label={t('crm.lostReason')}>{data.lostReason}</Field>
                  ) : null}
                </FieldGroup>
                <FieldGroup title={t('detail.ownership')}>
                  <Field label={t('crm.assignedTo')}>
                    <PersonName accountId={data.assignedToAccountId} showTitle />
                  </Field>
                  <Field label={t('crm.nextFollowUp')}>
                    <Verbatim>{format.date(data.nextFollowUpOn)}</Verbatim>
                  </Field>
                  <Field label={t('fields.createdAt')}>
                    <Verbatim>{format.dateTime(data.createdAt)}</Verbatim>
                  </Field>
                </FieldGroup>
                {data.notes ? (
                  <FieldGroup title={t('fields.notes')}>
                    <Box sx={{ gridColumn: '1 / -1', typography: 'body2', whiteSpace: 'pre-line' }}>
                      {data.notes}
                    </Box>
                  </FieldGroup>
                ) : null}
              </Stack>
            </Panel>
            <LeadTimeline activities={activities.state} />
          </>
        }
        aside={
          can('sales.reservation.create') || can('crm.lead.edit') || can('crm.activity.create') ? (
            <>
              {can('sales.reservation.create') && data.stage !== 'lost' && data.stage !== 'won' ? (
                <Alert
                  severity="info"
                  variant="outlined"
                  sx={{ '& .MuiAlert-message': { inlineSize: '100%' } }}
                >
                  <Box sx={{ marginBlockEnd: 1.25 }}>{t('sales.selectUnitHint')}</Box>
                  <Button
                    component={Link}
                    to={`/reservations/new?leadId=${data.leadId}`}
                    variant="contained"
                    size="small"
                  >
                    {t('sales.newReservation')}
                  </Button>
                </Alert>
              ) : null}
              {can('crm.lead.edit') ? (
                <StageForm lead={data} onDone={reload} errorMessage={errorMessage} />
              ) : null}
              {can('crm.activity.create') ? (
                <ActivityForm leadId={data.leadId} onDone={reload} errorMessage={errorMessage} />
              ) : null}
            </>
          ) : undefined
        }
      />
    </Box>
  );
}

/** The lead's activity history, newest first. System-written references are translated on display. */
function LeadTimeline({ activities }: { activities: AsyncState<{ items: Activity[] }> }) {
  const { t, td } = useLocale();
  const format = useFormatters();
  return (
    <Panel title={t('crm.timeline')} icon={History}>
      {activities.kind === 'loading' ? (
        <StateView variant="inline" kind="loading" title={t('states.loadingTitle')} />
      ) : (
        <Timeline
          emptyLabel={t('states.emptyDescription')}
          entries={(activities.kind === 'ready' ? activities.data.items : []).map((activity) => ({
            key: activity.activityId,
            icon: ACTIVITY_ICONS[activity.kind] ?? CircleDot,
            title: td(`activityKind.${activity.kind}`),
            when: format.dateTime(activity.occurredAt),
            body: (
              <>
                {activity.fromStage && activity.toStage ? (
                  <Box>
                    <Transition
                      from={td(`leadStage.${activity.fromStage}`)}
                      to={td(`leadStage.${activity.toStage}`)}
                    />
                  </Box>
                ) : null}
                {activity.body ? (
                  <Box sx={{ color: 'text.primary' }}>
                    <SystemNote text={activity.body} />
                  </Box>
                ) : null}
                {activity.dueOn ? (
                  <Box>
                    {`${t('crm.activityDueOn')}: `}
                    <Verbatim>{format.date(activity.dueOn)}</Verbatim>
                  </Box>
                ) : null}
              </>
            ),
          }))}
        />
      )}
    </Panel>
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
