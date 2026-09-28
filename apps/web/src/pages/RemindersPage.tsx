import type { GenerateRemindersResult, Reminder, ReminderPage } from '@alola/contracts';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { DataTable, NotConnectedNotice, PageHeader, type DataColumn } from '@alola/ui';
import { useMemo, useState } from 'react';
import { apiRequest } from '../api/client';
import { useSession } from '../api/session';
import { useApi, useMutation } from '../api/useApi';
import { useErrorMessage } from '../errors';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import {
  EnumChip,
  Field,
  ListFooter,
  REMINDER_TONES,
  RequirePermission,
  Verbatim,
  tableStatus,
  useTableLabels,
} from './shared';

/**
 * The reminder centre.
 *
 * Everything on this screen is internal. The notice at the top says so in whichever language is
 * showing, and the action is called "simulate sending" rather than "send" — because nothing is
 * connected, and a button labelled Send that reaches nobody is the exact failure ADR-0026 exists to
 * prevent.
 *
 * The message itself is shown in **both** languages before any action, so a person can read what a
 * customer would receive rather than trusting that it is right.
 */
export default function RemindersPage() {
  return (
    <RequirePermission permission="collection.reminder.view">
      <RemindersScreen />
    </RequirePermission>
  );
}

function RemindersScreen() {
  const { t, td } = useLocale();
  const { can } = useSession();
  const format = useFormatters();
  const errorMessage = useErrorMessage();
  const labels = useTableLabels();
  const [preview, setPreview] = useState<Reminder | undefined>();
  const [generated, setGenerated] = useState<GenerateRemindersResult | undefined>();

  const reminders = useApi<ReminderPage & { deliveryConnected: boolean }>(
    '/api/v1/collections/reminders?limit=100',
  );

  const generate = useMutation<void, GenerateRemindersResult>(() =>
    apiRequest<GenerateRemindersResult>('/api/v1/collections/reminders/generate', {
      method: 'POST',
      body: { withinDays: 15, channel: 'whatsapp' },
    }),
  );

  const act = useMutation<{ reminderId: string; state: 'ready' | 'simulated' }, Reminder>((input) =>
    apiRequest<Reminder>(`/api/v1/collections/reminders/${input.reminderId}/act`, {
      method: 'POST',
      body: { state: input.state },
    }),
  );

  const columns = useMemo<DataColumn<Reminder>[]>(
    () => [
      {
        key: 'dueOn',
        header: t('fields.dueDate'),
        render: (row) => <Verbatim>{format.date(row.dueOn)}</Verbatim>,
      },
      {
        key: 'amount',
        header: t('fields.amount'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.amount)}</Verbatim>,
      },
      {
        key: 'channel',
        header: t('reminders.channel'),
        render: (row) => td(`reminderChannel.${row.channel}`),
      },
      {
        key: 'state',
        header: t('fields.state'),
        render: (row) => (
          <EnumChip namespace="reminderState" value={row.state} tones={REMINDER_TONES} />
        ),
      },
      {
        key: 'actions',
        header: t('fields.actions'),
        render: (row) => (
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" onClick={() => setPreview(row)}>
              {t('actions.viewMessage')}
            </Button>
            {can('collection.reminder.manage') && row.state === 'ready' ? (
              <Button
                size="small"
                variant="contained"
                disabled={act.pending}
                onClick={() => {
                  void act
                    .run({ reminderId: row.reminderId, state: 'simulated' })
                    .then(reminders.reload, () => undefined);
                }}
              >
                {t('actions.simulateSend')}
              </Button>
            ) : null}
          </Stack>
        ),
      },
    ],
    [act, can, format, reminders.reload, t, td],
  );

  return (
    <Box>
      <PageHeader
        title={t('reminders.title')}
        subtitle={t('reminders.subtitle')}
        actions={
          can('collection.reminder.manage') ? (
            <Button
              variant="contained"
              disabled={generate.pending}
              onClick={() => {
                void generate.run().then(
                  (result) => {
                    setGenerated(result);
                    reminders.reload();
                  },
                  () => undefined,
                );
              }}
            >
              {t('actions.generateReminders')}
            </Button>
          ) : undefined
        }
        banner={
          <NotConnectedNotice
            title={t('reminders.notConnectedTitle')}
            body={t('reminders.notConnectedBody')}
          />
        }
      />

      <Stack spacing={3}>
        {generate.error ? (
          <Alert severity="error" role="alert">
            {errorMessage(generate.error)}
          </Alert>
        ) : null}
        {act.error ? (
          <Alert severity="error" role="alert">
            {errorMessage(act.error)}
          </Alert>
        ) : null}
        {generated ? (
          <Alert severity="success" role="status">
            {`${t('reminders.generated', { count: generated.created })} — ${t(
              'reminders.alreadyExisted',
              { count: generated.existing },
            )}`}
          </Alert>
        ) : null}

        <Typography variant="body2" color="text.secondary">
          {t('reminders.duplicatePrevented')}
        </Typography>

        <DataTable
          columns={columns}
          rows={reminders.state.kind === 'ready' ? reminders.state.data.items : []}
          rowKey={(row) => row.reminderId}
          status={tableStatus(reminders.state)}
          caption={t('reminders.title')}
          errorAction={
            <Button variant="contained" onClick={reminders.reload}>
              {t('states.retry')}
            </Button>
          }
          labels={labels}
          footer={
            reminders.state.kind === 'ready' ? (
              <ListFooter
                shown={reminders.state.data.items.length}
                total={reminders.state.data.total}
                hasMore={false}
                loadingMore={false}
                onLoadMore={() => undefined}
              />
            ) : undefined
          }
        />
      </Stack>

      <Dialog open={Boolean(preview)} onClose={() => setPreview(undefined)} fullWidth maxWidth="sm">
        <DialogTitle>{t('reminders.messagePreview')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ marginBlockStart: 1 }}>
            <Alert severity="info" variant="outlined">
              {t('reminders.notConnectedTitle')}
            </Alert>
            {/* Both languages, always: the person sees exactly what a customer would receive. */}
            <Paper variant="outlined" sx={{ padding: 2 }}>
              <Field label={t('reminders.messageArabic')}>
                <Box component="span" lang="ar" dir="rtl">
                  {preview?.messageAr}
                </Box>
              </Field>
            </Paper>
            <Paper variant="outlined" sx={{ padding: 2 }}>
              <Field label={t('reminders.messageEnglish')}>
                <Box component="span" lang="en" dir="ltr">
                  {preview?.messageEn}
                </Box>
              </Field>
            </Paper>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreview(undefined)}>{t('actions.close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
