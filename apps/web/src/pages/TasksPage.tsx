import {
  TASK_PRIORITIES,
  addDays,
  businessDateInZone,
  nowInstant,
  type BusinessDate,
  type Task,
  type TaskPriority,
  type TaskState,
} from '@alola/contracts';
import { formattingLocale } from '@alola/i18n';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import {
  DataTable,
  PageHeader,
  StateView,
  StatusChip,
  type DataColumn,
  type StatusTone,
} from '@alola/ui';
import { useMemo, useState } from 'react';
import { apiRequest, query } from '../api/client';
import { useSession } from '../api/session';
import { useApi, useMutation } from '../api/useApi';
import { useBranding } from '../branding';
import { useErrorMessage } from '../errors';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { EnumChip, ErrorState, Verbatim, tableStatus } from './shared';

/**
 * Tasks (CORE-TASK-001, CORE-TASK-004).
 *
 * "My tasks" are the ones assigned to, escalated to, or created by the signed-in person; a person with
 * `task.view` can widen the list to their data scope. Every date is the **organization's** calendar
 * day (ADR-0008): a task due at 01:30 on the 6th sits on the 6th here even though it is stored as the
 * 5th in UTC. An overdue task says so in words and with a chip — never by colour alone (THEME-004).
 */

const TASK_TONES: Record<TaskState, StatusTone> = {
  open: 'info',
  inProgress: 'warning',
  done: 'success',
  cancelled: 'neutral',
};
const PRIORITY_TONES: Record<TaskPriority, StatusTone> = {
  low: 'neutral',
  normal: 'info',
  high: 'warning',
  urgent: 'danger',
};

/**
 * The calendar's first weekday: Saturday (JavaScript day 6), the start of the working week where the
 * product is used today. A display convention, not business policy — a client that needs Sunday or
 * Monday changes this one constant, or it becomes a display setting.
 */
const WEEK_STARTS_ON = 6;

type View = 'mine' | 'scope';

export default function TasksPage() {
  const { t } = useLocale();
  const { can } = useSession();
  const [view, setView] = useState<View>('mine');
  const [tab, setTab] = useState<'list' | 'calendar'>('list');
  const [creating, setCreating] = useState(false);
  const [refresh, setRefresh] = useState(0);

  return (
    <Box>
      <PageHeader
        title={t('tasks.title')}
        subtitle={t('tasks.subtitle')}
        actions={
          can('task.create') ? (
            <Button variant="contained" onClick={() => setCreating(true)}>
              {t('tasks.new')}
            </Button>
          ) : undefined
        }
      />
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', marginBlockEnd: 2 }}
      >
        <Tabs value={tab} onChange={(_event, value: 'list' | 'calendar') => setTab(value)}>
          <Tab value="list" label={t('tasks.list')} />
          <Tab value="calendar" label={t('tasks.calendar')} />
        </Tabs>
        {can('task.view') ? (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={view}
            onChange={(_event, value: View | null) => value && setView(value)}
            aria-label={t('tasks.viewLabel')}
          >
            <ToggleButton value="mine">{t('tasks.mine')}</ToggleButton>
            <ToggleButton value="scope">{t('tasks.scope')}</ToggleButton>
          </ToggleButtonGroup>
        ) : null}
      </Stack>
      {tab === 'list' ? (
        <TaskList key={`${view}-${refresh}`} view={view} />
      ) : (
        <TaskCalendar key={`${view}-${refresh}`} view={view} />
      )}
      {creating ? (
        <NewTaskDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setRefresh((value) => value + 1);
          }}
        />
      ) : null}
    </Box>
  );
}

function TaskList({ view }: { view: View }) {
  const { t, td } = useLocale();
  const { session } = useSession();
  const format = useFormatters();
  const errorMessage = useErrorMessage();
  const [state, setState] = useState<'open' | 'closed'>('open');
  const tasks = useApi<{ items: Task[] }>(`/api/v1/tasks${query({ view, state, limit: 100 })}`);
  const move = useMutation<{ task: Task; state: TaskState }, Task>(({ task, state: next }) =>
    apiRequest<Task>(`/api/v1/tasks/${task.taskId}/transition`, {
      method: 'POST',
      body: { expectedVersion: task.version, state: next },
    }),
  );
  const me = session?.account.accountId;

  const columns = useMemo<DataColumn<Task>[]>(
    () => [
      { key: 'title', header: t('tasks.titleField'), render: (row) => row.title },
      {
        key: 'dueAt',
        header: t('fields.dueDate'),
        render: (row) => (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Verbatim>{format.dateTime(row.dueAt)}</Verbatim>
            {row.overdue ? <StatusChip tone="danger" label={t('tasks.overdue')} /> : null}
          </Stack>
        ),
      },
      {
        key: 'priority',
        header: t('tasks.priority'),
        render: (row) => (
          <StatusChip
            tone={PRIORITY_TONES[row.priority]}
            label={td(`taskPriority.${row.priority}`)}
          />
        ),
      },
      {
        key: 'state',
        header: t('fields.state'),
        render: (row) => <EnumChip namespace="taskState" value={row.state} tones={TASK_TONES} />,
      },
      {
        key: 'actions',
        header: t('fields.actions'),
        render: (row) =>
          row.assigneeAccountId === me && (row.state === 'open' || row.state === 'inProgress') ? (
            <Stack direction="row" spacing={1}>
              {row.state === 'open' ? (
                <Button
                  size="small"
                  variant="outlined"
                  disabled={move.pending}
                  onClick={() => {
                    void move
                      .run({ task: row, state: 'inProgress' })
                      .then(tasks.reload, () => undefined);
                  }}
                >
                  {t('tasks.start')}
                </Button>
              ) : null}
              <Button
                size="small"
                variant="contained"
                disabled={move.pending}
                onClick={() => {
                  void move.run({ task: row, state: 'done' }).then(tasks.reload, () => undefined);
                }}
              >
                {t('tasks.complete')}
              </Button>
            </Stack>
          ) : null,
      },
    ],
    [format, me, move, tasks.reload, t, td],
  );

  if (tasks.state.kind === 'error') {
    return <ErrorState error={tasks.state.error} onRetry={tasks.reload} />;
  }
  return (
    <Stack spacing={2}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={state}
        onChange={(_event, value: 'open' | 'closed' | null) => value && setState(value)}
        aria-label={t('tasks.stateFilter')}
      >
        <ToggleButton value="open">{t('tasks.openTasks')}</ToggleButton>
        <ToggleButton value="closed">{t('tasks.closedTasks')}</ToggleButton>
      </ToggleButtonGroup>
      {move.error ? <Alert severity="error">{errorMessage(move.error)}</Alert> : null}
      <DataTable
        caption={t('tasks.title')}
        columns={columns}
        rows={tasks.state.kind === 'ready' ? tasks.state.data.items : []}
        rowKey={(row) => row.taskId}
        status={tableStatus(tasks.state)}
        labels={{
          loadingTitle: t('states.loadingTitle'),
          emptyTitle: t('tasks.empty'),
          errorTitle: t('states.errorTitle'),
          errorDescription: t('states.errorDescription'),
          forbiddenTitle: t('states.forbiddenTitle'),
          forbiddenDescription: t('states.forbiddenDescription'),
        }}
      />
    </Stack>
  );
}

/** The first day of the calendar grid that shows `month` (a `YYYY-MM-01` date). */
function gridStart(month: BusinessDate): BusinessDate {
  const weekday = new Date(`${month}T00:00:00Z`).getUTCDay();
  return addDays(month, -((weekday - WEEK_STARTS_ON + 7) % 7));
}

function TaskCalendar({ view }: { view: View }) {
  const { t, locale } = useLocale();
  const { timeZone } = useBranding();
  const today = businessDateInZone(nowInstant(), timeZone);
  const [month, setMonth] = useState(() => `${today.slice(0, 7)}-01` as BusinessDate);
  const first = gridStart(month);
  const last = addDays(first, 41);
  const days = Array.from({ length: 42 }, (_value, index) => addDays(first, index));
  const tasks = useApi<{ items: Task[]; truncated: boolean }>(
    `/api/v1/tasks/calendar${query({ from: first, to: last, view })}`,
  );

  const intl = formattingLocale(locale);
  const monthName = new Intl.DateTimeFormat(intl, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}T00:00:00Z`));
  const weekdays = days
    .slice(0, 7)
    .map((day) =>
      new Intl.DateTimeFormat(intl, { weekday: 'short', timeZone: 'UTC' }).format(
        new Date(`${day}T00:00:00Z`),
      ),
    );
  const shiftMonth = (months: number) => {
    const [year, monthIndex] = month.split('-').map(Number) as [number, number];
    const shifted = new Date(Date.UTC(year, monthIndex - 1 + months, 1));
    setMonth(shifted.toISOString().slice(0, 10) as BusinessDate);
  };

  if (tasks.state.kind === 'error') {
    return <ErrorState error={tasks.state.error} onRetry={tasks.reload} />;
  }
  const byDay = new Map<string, Task[]>();
  if (tasks.state.kind === 'ready') {
    for (const task of tasks.state.data.items) {
      byDay.set(task.dueOn, [...(byDay.get(task.dueOn) ?? []), task]);
    }
  }

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Button variant="outlined" onClick={() => shiftMonth(-1)}>
          {t('tasks.previousMonth')}
        </Button>
        <Typography component="h2" variant="h6">
          <Verbatim>{monthName}</Verbatim>
        </Typography>
        <Button variant="outlined" onClick={() => shiftMonth(1)}>
          {t('tasks.nextMonth')}
        </Button>
      </Stack>
      {tasks.state.kind === 'loading' ? (
        <StateView kind="loading" title={t('states.loadingTitle')} />
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Box
            role="grid"
            aria-label={monthName}
            sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(88px, 1fr))', gap: 0.5 }}
          >
            {weekdays.map((name) => (
              <Typography
                key={name}
                role="columnheader"
                variant="caption"
                sx={{ textAlign: 'center', fontWeight: 700 }}
              >
                {name}
              </Typography>
            ))}
            {days.map((day) => {
              const items = byDay.get(day) ?? [];
              const inMonth = day.slice(0, 7) === month.slice(0, 7);
              return (
                <Paper
                  key={day}
                  role="gridcell"
                  variant="outlined"
                  aria-current={day === today ? 'date' : undefined}
                  sx={{
                    minBlockSize: 88,
                    padding: 0.75,
                    ...(inMonth ? {} : { backgroundColor: 'action.hover' }),
                    ...(day === today ? { borderColor: 'primary.main', borderWidth: 2 } : {}),
                  }}
                >
                  <Typography variant="caption" color={inMonth ? 'text.primary' : 'text.secondary'}>
                    <Verbatim>{String(Number(day.slice(8)))}</Verbatim>
                  </Typography>
                  <Stack
                    component="ul"
                    spacing={0.25}
                    sx={{ listStyle: 'none', margin: 0, padding: 0 }}
                  >
                    {items.map((task) => (
                      <Typography
                        key={task.taskId}
                        component="li"
                        variant="caption"
                        sx={{
                          display: 'block',
                          overflowWrap: 'anywhere',
                          fontWeight: task.overdue ? 700 : 400,
                          textDecoration: task.state === 'done' ? 'line-through' : 'none',
                        }}
                      >
                        {task.overdue ? `${t('tasks.overdue')}: ` : ''}
                        {task.title}
                      </Typography>
                    ))}
                  </Stack>
                </Paper>
              );
            })}
          </Box>
        </Box>
      )}
      {tasks.state.kind === 'ready' && tasks.state.data.truncated ? (
        <Alert severity="info">{t('tasks.truncated')}</Alert>
      ) : null}
    </Stack>
  );
}

function NewTaskDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t, td } = useLocale();
  const { session } = useSession();
  const { timeZone } = useBranding();
  const errorMessage = useErrorMessage();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => businessDateInZone(nowInstant(), timeZone) as string);
  const [time, setTime] = useState('17:00');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const create = useMutation<void, Task>(() =>
    apiRequest<Task>('/api/v1/tasks', {
      method: 'POST',
      body: {
        title,
        priority,
        // Assigning to someone else needs an account picker, which arrives with the business modules.
        assigneeAccountId: session?.account.accountId,
        due: { date, time },
      },
    }),
  );

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="new-task-title">
      <DialogTitle id="new-task-title">{t('tasks.new')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ paddingBlockStart: 1 }}>
          {create.error ? <Alert severity="error">{errorMessage(create.error)}</Alert> : null}
          <TextField
            label={t('tasks.titleField')}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label={t('fields.dueDate')}
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label={t('tasks.dueTime')}
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              required
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>
          <TextField
            select
            label={t('tasks.priority')}
            value={priority}
            onChange={(event) => setPriority(event.target.value as TaskPriority)}
          >
            {TASK_PRIORITIES.map((value) => (
              <MenuItem key={value} value={value}>
                {td(`taskPriority.${value}`)}
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="caption" color="text.secondary">
            {t('tasks.timeZoneNote', { timeZone })}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.cancel')}</Button>
        <Button
          variant="contained"
          disabled={create.pending || title.trim().length === 0 || !date || !time}
          onClick={() => {
            void create.run().then(onCreated, () => undefined);
          }}
        >
          {t('tasks.create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
