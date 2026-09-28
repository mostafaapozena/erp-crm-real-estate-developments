import { RESERVATION_STATES, type ReservationPage } from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { DataTable, Icon, PageHeader, TableToolbar, type DataColumn } from '@alola/ui';
import { Plus } from '@alola/ui/icons';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { query } from '../api/client';
import { useSession } from '../api/session';
import { usePagedList } from '../api/usePagedList';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { PersonName } from '../people';
import {
  EnumChip,
  FilterSelect,
  ListFooter,
  RESERVATION_TONES,
  RequirePermission,
  Verbatim,
  tableStatus,
  useTableLabels,
} from './shared';

type Reservation = ReservationPage['items'][number];

export default function ReservationsPage() {
  return (
    <RequirePermission permission="sales.reservation.view">
      <ReservationsScreen />
    </RequirePermission>
  );
}

function ReservationsScreen() {
  const { t, td } = useLocale();
  const { can } = useSession();
  const format = useFormatters();
  const navigate = useNavigate();
  const labels = useTableLabels();
  const [state, setState] = useState('');
  const reservations = usePagedList<Reservation>(
    `/api/v1/sales/reservations${query({ limit: 50, state })}`,
  );

  const columns = useMemo<DataColumn<Reservation>[]>(
    () => [
      {
        key: 'number',
        header: t('sales.reservationNumber'),
        render: (row) => (
          <Box component="span" sx={{ fontWeight: 600 }}>
            <Verbatim>{row.reservationNumber}</Verbatim>
          </Box>
        ),
      },
      {
        key: 'reservedOn',
        header: t('sales.reservedOn'),
        render: (row) => <Verbatim>{format.date(row.reservedOn)}</Verbatim>,
      },
      {
        key: 'expiresOn',
        header: t('sales.expiresOn'),
        render: (row) => <Verbatim>{format.date(row.expiresOn)}</Verbatim>,
      },
      {
        key: 'owner',
        header: t('sales.salesOwner'),
        render: (row) => <PersonName accountId={row.salesOwnerAccountId} />,
        secondary: true,
      },
      {
        key: 'price',
        header: t('sales.agreedPrice'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.agreedPrice)}</Verbatim>,
      },
      {
        key: 'state',
        header: t('fields.state'),
        render: (row) => (
          <EnumChip namespace="reservationState" value={row.state} tones={RESERVATION_TONES} />
        ),
      },
    ],
    [format, t],
  );

  return (
    <Box>
      <PageHeader
        title={t('sales.reservationsTitle')}
        subtitle={t('sales.reservationsSubtitle')}
        actions={
          can('sales.reservation.create') ? (
            <Button
              component={Link}
              to="/reservations/new"
              variant="contained"
              startIcon={<Icon icon={Plus} size={18} />}
            >
              {t('sales.newReservation')}
            </Button>
          ) : undefined
        }
      />
      <DataTable
        columns={columns}
        rows={reservations.items}
        rowKey={(row) => row.reservationId}
        rowLabel={(row) => t('list.open', { label: row.reservationNumber })}
        status={tableStatus(reservations.state)}
        caption={t('sales.reservationsTitle')}
        filtered={state !== ''}
        onRowClick={(row) => void navigate(`/reservations/${row.reservationId}`)}
        errorAction={
          <Button variant="contained" onClick={reservations.reload}>
            {t('states.retry')}
          </Button>
        }
        labels={labels}
        toolbar={
          <TableToolbar
            filters={
              <FilterSelect
                label={t('fields.state')}
                value={state}
                onChange={setState}
                options={RESERVATION_STATES.map((value) => ({
                  value,
                  label: td(`reservationState.${value}`),
                }))}
              />
            }
            activeFilters={
              state
                ? [
                    {
                      key: 'state',
                      label: `${t('fields.state')}: ${td(`reservationState.${state}`)}`,
                      onRemove: () => setState(''),
                    },
                  ]
                : []
            }
            removeLabel={(label) => t('filters.remove', { label })}
          />
        }
        footer={
          <ListFooter
            shown={reservations.items.length}
            total={reservations.total}
            hasMore={reservations.hasMore}
            loadingMore={reservations.loadingMore}
            onLoadMore={reservations.loadMore}
            error={reservations.moreError}
          />
        }
      />
    </Box>
  );
}
