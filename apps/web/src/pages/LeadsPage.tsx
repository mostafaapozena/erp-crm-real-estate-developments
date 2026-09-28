import type {
  Branch,
  CreateLeadResult,
  LEAD_SOURCES,
  LeadPage,
  OrgChart,
  Project,
} from '@alola/contracts';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import { DataTable, Icon, PageHeader, TableToolbar, type DataColumn } from '@alola/ui';
import { Plus } from '@alola/ui/icons';
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { apiRequest, query } from '../api/client';
import { useSession } from '../api/session';
import { useApi, useMutation } from '../api/useApi';
import { usePagedList } from '../api/usePagedList';
import { useErrorMessage } from '../errors';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { PersonName } from '../people';
import { ExportButton } from './ExportButton';
import {
  EnumChip,
  FilterSelect,
  LEAD_TONES,
  ListFooter,
  ListSearch,
  RequirePermission,
  Verbatim,
  tableStatus,
  useTableLabels,
} from './shared';

type Lead = LeadPage['items'][number];
type LeadSource = (typeof LEAD_SOURCES)[number];

const STAGES = [
  'new',
  'contacted',
  'qualified',
  'visitScheduled',
  'negotiation',
  'reservation',
  'won',
  'lost',
] as const;

const SOURCES: LeadSource[] = [
  'facebook',
  'instagram',
  'whatsapp',
  'website',
  'phoneCall',
  'walkIn',
  'referral',
  'broker',
  'other',
];

/**
 * The lead list, the follow-up queues, and lead creation.
 *
 * The follow-up tabs are server-side filters (`followUp=due|overdue`), not a client-side filter over
 * a page of rows: "due today" has to be computed against the **organization** timezone and across
 * every lead, not just the twenty-five currently downloaded.
 */
export default function LeadsPage() {
  return (
    <RequirePermission permission="crm.lead.view">
      <LeadsScreen />
    </RequirePermission>
  );
}

function LeadsScreen() {
  const { t, td } = useLocale();
  const { can } = useSession();
  const format = useFormatters();
  const navigate = useNavigate();

  const labels = useTableLabels();
  const [followUp, setFollowUp] = useState<'' | 'due' | 'overdue'>('');
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [source, setSource] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const path = `/api/v1/crm/leads${query({ limit: 50, followUp, search, stage, source })}`;
  const leads = usePagedList<Lead>(path);
  const active = [
    ...(search
      ? [
          {
            key: 'search',
            label: `${t('actions.search')}: ${search}`,
            onRemove: () => setSearch(''),
          },
        ]
      : []),
    ...(stage
      ? [
          {
            key: 'stage',
            label: `${t('crm.stage')}: ${td(`leadStage.${stage}`)}`,
            onRemove: () => setStage(''),
          },
        ]
      : []),
    ...(source
      ? [
          {
            key: 'source',
            label: `${t('crm.source')}: ${td(`leadSource.${source}`)}`,
            onRemove: () => setSource(''),
          },
        ]
      : []),
  ];

  const columns = useMemo<DataColumn<Lead>[]>(
    () => [
      {
        key: 'name',
        header: t('fields.name'),
        render: (lead) => lead.name,
      },
      {
        key: 'phone',
        header: t('fields.phone'),
        render: (lead) => <Verbatim>{lead.primaryPhone}</Verbatim>,
      },
      {
        key: 'stage',
        header: t('crm.stage'),
        render: (lead) => <EnumChip namespace="leadStage" value={lead.stage} tones={LEAD_TONES} />,
      },
      {
        key: 'source',
        header: t('crm.source'),
        render: (lead) => td(`leadSource.${lead.source}`),
      },
      {
        key: 'followUp',
        header: t('crm.nextFollowUp'),
        render: (lead) => format.date(lead.nextFollowUpOn),
      },
      {
        key: 'owner',
        header: t('crm.assignedTo'),
        render: (lead) => <PersonName accountId={lead.assignedToAccountId} />,
        secondary: true,
      },
    ],
    [format, t, td],
  );

  return (
    <Box>
      <PageHeader
        title={t('crm.title')}
        subtitle={t('crm.subtitle')}
        actions={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            <ExportButton kind="leads" permission="crm.lead.export" />
            {can('crm.lead.create') ? (
              <Button
                variant="contained"
                onClick={() => setDialogOpen(true)}
                startIcon={<Icon icon={Plus} size={18} />}
              >
                {t('crm.newLead')}
              </Button>
            ) : null}
          </Stack>
        }
      />

      <Stack spacing={2}>
        <Tabs
          value={followUp}
          onChange={(_event, value: '' | 'due' | 'overdue') => setFollowUp(value)}
          aria-label={t('crm.subtitle')}
        >
          <Tab value="" label={t('crm.allFollowUps')} />
          <Tab value="due" label={t('crm.followUpDue')} />
          <Tab value="overdue" label={t('crm.followUpOverdue')} />
        </Tabs>

        <DataTable
          columns={columns}
          rows={leads.items}
          rowKey={(lead) => lead.leadId}
          rowLabel={(lead) => t('list.open', { label: lead.name })}
          status={tableStatus(leads.state)}
          caption={t('crm.title')}
          filtered={active.length > 0 || followUp !== ''}
          onRowClick={(lead) => void navigate(`/leads/${lead.leadId}`)}
          errorAction={
            <Button variant="contained" onClick={leads.reload}>
              {t('states.retry')}
            </Button>
          }
          labels={labels}
          toolbar={
            <TableToolbar
              search={
                <ListSearch
                  value={search}
                  onSubmit={setSearch}
                  label={t('crm.searchPlaceholder')}
                />
              }
              filters={
                <>
                  <FilterSelect
                    label={t('crm.stage')}
                    value={stage}
                    onChange={setStage}
                    options={STAGES.map((value) => ({ value, label: td(`leadStage.${value}`) }))}
                  />
                  <FilterSelect
                    label={t('crm.source')}
                    value={source}
                    onChange={setSource}
                    options={SOURCES.map((value) => ({ value, label: td(`leadSource.${value}`) }))}
                  />
                </>
              }
              activeFilters={active}
              clearLabel={t('filters.clearAll')}
              removeLabel={(label) => t('filters.remove', { label })}
              onClearAll={() => {
                setSearch('');
                setStage('');
                setSource('');
              }}
            />
          }
          footer={
            <ListFooter
              shown={leads.items.length}
              total={leads.total}
              hasMore={leads.hasMore}
              loadingMore={leads.loadingMore}
              onLoadMore={leads.loadMore}
              error={leads.moreError}
            />
          }
        />
      </Stack>

      {dialogOpen ? (
        <NewLeadDialog
          onClose={() => setDialogOpen(false)}
          onCreated={() => {
            setDialogOpen(false);
            leads.reload();
          }}
        />
      ) : null}
    </Box>
  );
}

/**
 * Lead creation.
 *
 * A duplicate phone number produces a **warning on a successful create**, not a refusal: households,
 * switchboards and brokers genuinely share numbers. The dialog stays open to show it, because the
 * useful action is to go and talk to the colleague who already owns the other lead.
 */
function NewLeadDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t, td, locale } = useLocale();
  const errorMessage = useErrorMessage();
  const chart = useApi<OrgChart>('/api/v1/organization/chart');
  const projects = useApi<{ items: Project[] }>('/api/v1/inventory/projects');

  const [name, setName] = useState('');
  const [primaryPhone, setPrimaryPhone] = useState('');
  const [source, setSource] = useState<LeadSource>('walkIn');
  const [branchId, setBranchId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [notes, setNotes] = useState('');
  const [duplicate, setDuplicate] = useState<CreateLeadResult['possibleDuplicate']>();

  const branches: Branch[] = chart.state.kind === 'ready' ? chart.state.data.branches : [];
  const projectList = projects.state.kind === 'ready' ? projects.state.data.items : [];
  const effectiveBranch = branchId || branches[0]?.branchId || '';

  const create = useMutation<void, CreateLeadResult>(() =>
    apiRequest<CreateLeadResult>('/api/v1/crm/leads', {
      method: 'POST',
      body: {
        name: name.trim(),
        primaryPhone: primaryPhone.trim(),
        source,
        branchId: effectiveBranch,
        ...(projectId ? { interestedProjectId: projectId } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      },
    }),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await create.run();
      if (result.possibleDuplicate) {
        // Created, and worth saying so before the dialog disappears.
        setDuplicate(result.possibleDuplicate);
        return;
      }
      onCreated();
    } catch {
      // The error is rendered from `create.error`; nothing to do here.
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={(event) => void submit(event)} noValidate>
        <DialogTitle>{t('crm.newLead')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ marginBlockStart: 1 }}>
            {create.error ? (
              <Alert severity="error" role="alert">
                {errorMessage(create.error)}
              </Alert>
            ) : null}

            {duplicate ? (
              <Alert severity="warning" role="status">
                <AlertTitle>{t('crm.duplicateWarningTitle')}</AlertTitle>
                {t('crm.duplicateWarningBody', {
                  name: duplicate.name,
                  stage: td(`leadStage.${duplicate.stage}`),
                })}
              </Alert>
            ) : null}

            <TextField
              label={t('fields.name')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoFocus
            />
            <TextField
              label={t('fields.phone')}
              value={primaryPhone}
              onChange={(event) => setPrimaryPhone(event.target.value)}
              required
              slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'tel' } }}
            />
            <TextField
              select
              label={t('crm.source')}
              value={source}
              onChange={(event) => setSource(event.target.value as LeadSource)}
            >
              {SOURCES.map((value) => (
                <MenuItem key={value} value={value}>
                  {td(`leadSource.${value}`)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={t('fields.branch')}
              value={effectiveBranch}
              onChange={(event) => setBranchId(event.target.value)}
              required
            >
              {branches.map((branch) => (
                <MenuItem key={branch.branchId} value={branch.branchId}>
                  {branch.name[locale]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={t('crm.interestedProject')}
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <MenuItem value="">—</MenuItem>
              {projectList.map((project) => (
                <MenuItem key={project.projectId} value={project.projectId}>
                  {project.name[locale]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label={t('fields.notes')}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              multiline
              minRows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={duplicate ? onCreated : onClose}>
            {duplicate ? t('actions.close') : t('actions.cancel')}
          </Button>
          {duplicate ? null : (
            <Button type="submit" variant="contained" disabled={create.pending}>
              {t('actions.save')}
            </Button>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
}
