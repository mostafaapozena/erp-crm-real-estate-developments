import type { INSTRUMENT_KINDS, Instrument as InstrumentRecord } from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { DataTable, PageHeader, type DataColumn } from '@alola/ui';
import { useMemo, useState } from 'react';
import { query } from '../api/client';
import { usePagedList } from '../api/usePagedList';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import {
  EnumChip,
  INSTRUMENT_TONES,
  ListFooter,
  RequirePermission,
  Verbatim,
  tableStatus,
  useTableLabels,
} from './shared';

type Instrument = InstrumentRecord;
type Kind = (typeof INSTRUMENT_KINDS)[number];

/**
 * Cheques and promissory notes, split by kind because the two are handled differently in practice: a
 * cheque is deposited at a bank, a note is presented to the drawer. Showing them in one undifferentiated
 * list is how a collections officer ends up chasing the wrong one.
 */
export default function InstrumentsPage() {
  return (
    <RequirePermission permission="collection.instrument.view">
      <InstrumentsScreen />
    </RequirePermission>
  );
}

function InstrumentsScreen() {
  const { t } = useLocale();
  const format = useFormatters();
  const [kind, setKind] = useState<Kind>('cheque');

  const labels = useTableLabels();
  const instruments = usePagedList<Instrument>(
    `/api/v1/collections/instruments${query({ kind, limit: 50 })}`,
  );

  const columns = useMemo<DataColumn<Instrument>[]>(
    () => [
      {
        key: 'number',
        header: t('collections.instrumentNumber'),
        render: (row) => <Verbatim>{row.instrumentNumber}</Verbatim>,
      },
      {
        key: 'drawer',
        header: t('collections.drawerName'),
        render: (row) => row.drawerName,
      },
      {
        key: 'bank',
        header: t('collections.bankName'),
        render: (row) => row.bankName ?? '—',
        secondary: true,
      },
      {
        key: 'amount',
        header: t('fields.amount'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.amount)}</Verbatim>,
      },
      {
        key: 'dueOn',
        header: t('fields.dueDate'),
        render: (row) => <Verbatim>{format.date(row.dueOn)}</Verbatim>,
      },
      {
        key: 'custody',
        header: t('collections.custodyLocation'),
        render: (row) => row.custodyLocation ?? '—',
        secondary: true,
      },
      {
        key: 'state',
        header: t('fields.state'),
        render: (row) => (
          <EnumChip namespace="instrumentState" value={row.state} tones={INSTRUMENT_TONES} />
        ),
      },
    ],
    [format, t],
  );

  return (
    <Box>
      <PageHeader
        title={t('collections.instrumentsTitle')}
        subtitle={t('collections.instrumentsSubtitle')}
      />

      <Stack spacing={2}>
        <Tabs
          value={kind}
          onChange={(_event, value: Kind) => setKind(value)}
          aria-label={t('collections.instrumentsTitle')}
        >
          <Tab value="cheque" label={t('instrumentKind.cheque')} />
          <Tab value="promissoryNote" label={t('instrumentKind.promissoryNote')} />
        </Tabs>

        <DataTable
          columns={columns}
          rows={instruments.items}
          rowKey={(row) => row.instrumentId}
          status={tableStatus(instruments.state)}
          caption={t('collections.instrumentsTitle')}
          errorAction={
            <Button variant="contained" onClick={instruments.reload}>
              {t('states.retry')}
            </Button>
          }
          labels={labels}
          footer={
            <ListFooter
              shown={instruments.items.length}
              total={instruments.total}
              hasMore={instruments.hasMore}
              loadingMore={instruments.loadingMore}
              onLoadMore={instruments.loadMore}
              error={instruments.moreError}
            />
          }
        />
      </Stack>
    </Box>
  );
}
