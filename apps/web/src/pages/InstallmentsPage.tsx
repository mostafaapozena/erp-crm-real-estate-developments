import type { InstallmentPage } from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { DataTable, MetricCard, PageHeader, type DataColumn } from '@alola/ui';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../api/useApi';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import {
  CardGrid,
  EnumChip,
  INSTALLMENT_TONES,
  RequirePermission,
  Verbatim,
  tableStatus,
} from './shared';

type Installment = InstallmentPage['items'][number];
type Bucket = 'overdue' | 'due' | 'upcoming';

/**
 * The collection officer's working queues.
 *
 * Three server-side buckets, because "overdue" has to be computed against the organization date over
 * **every** installment, not over the page currently downloaded. The counts on the cards come from
 * the same query as the rows, so a card and the table it sits above can never disagree.
 */
export default function InstallmentsPage() {
  return (
    <RequirePermission permission="collection.installment.view">
      <InstallmentsScreen />
    </RequirePermission>
  );
}

function InstallmentsScreen() {
  const { t, td } = useLocale();
  const format = useFormatters();
  const navigate = useNavigate();
  const [bucket, setBucket] = useState<Bucket>('overdue');

  const overdue = useApi<InstallmentPage>('/api/v1/sales/installments?bucket=overdue&limit=100');
  const due = useApi<InstallmentPage>('/api/v1/sales/installments?bucket=due&limit=100');
  const upcoming = useApi<InstallmentPage>(
    '/api/v1/sales/installments?bucket=upcoming&withinDays=15&limit=100',
  );

  const active = bucket === 'overdue' ? overdue : bucket === 'due' ? due : upcoming;

  const columns = useMemo<DataColumn<Installment>[]>(
    () => [
      {
        key: 'dueOn',
        header: t('fields.dueDate'),
        render: (row) => <Verbatim>{format.date(row.dueOn)}</Verbatim>,
      },
      {
        key: 'sequence',
        header: t('fields.sequence'),
        render: (row) => <Verbatim>{format.number(row.sequence)}</Verbatim>,
        width: 64,
      },
      {
        key: 'kind',
        header: t('installmentKind.installment'),
        render: (row) => td(`installmentKind.${row.kind}`),
      },
      {
        key: 'amount',
        header: t('fields.amount'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.amount)}</Verbatim>,
      },
      {
        key: 'remaining',
        header: t('fields.remaining'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.remainingAmount)}</Verbatim>,
      },
      {
        key: 'state',
        header: t('fields.state'),
        render: (row) => (
          <EnumChip namespace="installmentState" value={row.state} tones={INSTALLMENT_TONES} />
        ),
      },
    ],
    [format, t, td],
  );

  return (
    <Box>
      <PageHeader
        title={t('collections.installmentsTitle')}
        subtitle={t('collections.installmentsSubtitle')}
      />

      <Stack spacing={3}>
        <CardGrid min={200}>
          <MetricCard
            label={t('collections.buckets.overdue')}
            value={format.number(
              overdue.state.kind === 'ready' ? overdue.state.data.total : undefined,
            )}
            loading={overdue.state.kind === 'loading'}
            tone={
              overdue.state.kind === 'ready' && overdue.state.data.total > 0
                ? 'attention'
                : 'default'
            }
          />
          <MetricCard
            label={t('collections.buckets.due')}
            value={format.number(due.state.kind === 'ready' ? due.state.data.total : undefined)}
            loading={due.state.kind === 'loading'}
          />
          <MetricCard
            label={t('collections.buckets.upcoming')}
            value={format.number(
              upcoming.state.kind === 'ready' ? upcoming.state.data.total : undefined,
            )}
            loading={upcoming.state.kind === 'loading'}
          />
        </CardGrid>

        <Tabs
          value={bucket}
          onChange={(_event, value: Bucket) => setBucket(value)}
          aria-label={t('collections.installmentsSubtitle')}
        >
          <Tab value="overdue" label={t('collections.buckets.overdue')} />
          <Tab value="due" label={t('collections.buckets.due')} />
          <Tab value="upcoming" label={t('collections.buckets.upcoming')} />
        </Tabs>

        <DataTable
          columns={columns}
          rows={active.state.kind === 'ready' ? active.state.data.items : []}
          rowKey={(row) => row.installmentId}
          status={tableStatus(active.state)}
          caption={t('collections.installmentsTitle')}
          onRowClick={(row) => void navigate(`/contracts/${row.contractId}`)}
          errorAction={
            <Button variant="contained" onClick={active.reload}>
              {t('states.retry')}
            </Button>
          }
          labels={{
            loadingTitle: t('states.loadingTitle'),
            emptyTitle: t('states.emptyTitle'),
            emptyDescription: t('states.emptyDescription'),
            errorTitle: t('states.errorTitle'),
            errorDescription: t('states.errorDescription'),
            forbiddenTitle: t('states.forbiddenTitle'),
            forbiddenDescription: t('states.forbiddenDescription'),
          }}
        />

        {active.state.kind === 'ready' ? (
          <Typography variant="body2" color="text.secondary">
            <Verbatim>
              {t('pagination.showing', {
                shown: active.state.data.items.length,
                total: active.state.data.total,
              })}
            </Verbatim>
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}
