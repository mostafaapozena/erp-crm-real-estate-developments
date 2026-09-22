import type { ReservationPage } from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { DataTable, PageHeader, type DataColumn } from '@alola/ui';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { EnumChip, RESERVATION_TONES, RequirePermission, Verbatim, tableStatus } from './shared';

type Reservation = ReservationPage['items'][number];

export default function ReservationsPage() {
  return (
    <RequirePermission permission="sales.reservation.view">
      <ReservationsScreen />
    </RequirePermission>
  );
}

function ReservationsScreen() {
  const { t } = useLocale();
  const { can } = useSession();
  const format = useFormatters();
  const navigate = useNavigate();
  const reservations = useApi<ReservationPage>('/api/v1/sales/reservations?limit=50');

  const columns = useMemo<DataColumn<Reservation>[]>(
    () => [
      {
        key: 'number',
        header: t('sales.reservationNumber'),
        render: (row) => <Verbatim>{row.reservationNumber}</Verbatim>,
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
            <Button component={Link} to="/reservations/new" variant="contained">
              {t('sales.newReservation')}
            </Button>
          ) : undefined
        }
      />
      <DataTable
        columns={columns}
        rows={reservations.state.kind === 'ready' ? reservations.state.data.items : []}
        rowKey={(row) => row.reservationId}
        status={tableStatus(reservations.state)}
        caption={t('sales.reservationsTitle')}
        onRowClick={(row) => void navigate(`/reservations/${row.reservationId}`)}
        errorAction={
          <Button variant="contained" onClick={reservations.reload}>
            {t('states.retry')}
          </Button>
        }
        labels={{
          loadingTitle: t('states.loadingTitle'),
          loadingDescription: t('states.loadingDescription'),
          emptyTitle: t('states.emptyTitle'),
          emptyDescription: t('states.emptyDescription'),
          errorTitle: t('states.errorTitle'),
          errorDescription: t('states.errorDescription'),
          forbiddenTitle: t('states.forbiddenTitle'),
          forbiddenDescription: t('states.forbiddenDescription'),
        }}
      />
    </Box>
  );
}
