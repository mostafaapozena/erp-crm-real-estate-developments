import type { Unit, UnitEvent } from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { PageHeader, StateView } from '@alola/ui';
import { Link, useParams } from 'react-router';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import {
  CardGrid,
  EnumChip,
  ErrorState,
  Field,
  Panel,
  RequirePermission,
  UNIT_TONES,
  Verbatim,
} from './shared';

/**
 * One unit: what it is, what it costs, and everything that has happened to it.
 *
 * The **business** timeline is shown here, not the audit trail. They answer different questions: a
 * sales person wants to know when the unit was reserved and by which reservation; an investigator
 * wants to know who changed what and from where. Mixing them gives the sales person a screen full of
 * noise and the investigator an incomplete record.
 */
export default function UnitDetailPage() {
  return (
    <RequirePermission permission="inventory.unit.view">
      <UnitDetailScreen />
    </RequirePermission>
  );
}

function UnitDetailScreen() {
  const { unitId } = useParams<{ unitId: string }>();
  const { t, td } = useLocale();
  const { can } = useSession();
  const format = useFormatters();

  const unit = useApi<Unit>(unitId ? `/api/v1/inventory/units/${unitId}` : undefined);
  const history = useApi<{ items: UnitEvent[] }>(
    unitId ? `/api/v1/inventory/units/${unitId}/history` : undefined,
  );

  if (unit.state.kind === 'loading') {
    return <StateView kind="loading" title={t('states.loadingTitle')} />;
  }
  if (unit.state.kind === 'error') {
    return <ErrorState error={unit.state.error} onRetry={unit.reload} />;
  }
  const data = unit.state.data;
  const sellable = data.status === 'available';

  return (
    <Box>
      <PageHeader
        title={data.code}
        subtitle={t('inventory.unitDetails')}
        banner={<EnumChip namespace="unitStatus" value={data.status} tones={UNIT_TONES} />}
        actions={
          sellable && can('sales.reservation.create') ? (
            <Button
              component={Link}
              to={`/reservations/new?unitId=${data.unitId}`}
              variant="contained"
            >
              {t('actions.reserve')}
            </Button>
          ) : undefined
        }
      />

      <Stack spacing={3}>
        <Panel title={t('inventory.unitDetails')}>
          <CardGrid min={200}>
            <Field label={t('inventory.propertyType')}>
              {td(`propertyType.${data.propertyType}`)}
            </Field>
            <Field label={t('inventory.usage')}>{td(`usageType.${data.usageType}`)}</Field>
            <Field label={t('fields.floor')}>
              <Verbatim>{format.number(data.floor)}</Verbatim>
            </Field>
            <Field label={t('fields.area')}>
              <Verbatim>{`${format.number(data.area, 2)} ${t('inventory.squareMetre')}`}</Verbatim>
            </Field>
            <Field label={t('inventory.finishing')}>
              {td(`finishingStatus.${data.finishingStatus}`)}
            </Field>
            {data.view ? <Field label={t('inventory.view')}>{data.view.ar}</Field> : null}
            {/*
              Price fields are absent — not null — for an actor without inventory.unit.viewPricing,
              so their absence is what decides whether they render (SEC-029).
            */}
            {data.currentPrice ? (
              <Field label={t('inventory.currentPrice')}>
                <Verbatim>{format.money(data.currentPrice)}</Verbatim>
              </Field>
            ) : null}
            {data.basePrice ? (
              <Field label={t('inventory.basePrice')}>
                <Verbatim>{format.money(data.basePrice)}</Verbatim>
              </Field>
            ) : null}
            {data.pricePerSquareMeter ? (
              <Field label={t('inventory.pricePerSquareMeter')}>
                <Verbatim>{format.money(data.pricePerSquareMeter)}</Verbatim>
              </Field>
            ) : null}
          </CardGrid>
          {!data.currentPrice ? (
            <Typography variant="body2" color="text.secondary" sx={{ marginBlockStart: 2 }}>
              {t('inventory.pricingHidden')}
            </Typography>
          ) : null}
          {data.paymentPlanSummary ? (
            <Box sx={{ marginBlockStart: 2 }}>
              <Field label={t('inventory.paymentPlanSummary')}>{data.paymentPlanSummary.ar}</Field>
            </Box>
          ) : null}
        </Panel>

        <Panel title={t('inventory.history')}>
          {history.state.kind === 'ready' && history.state.data.items.length > 0 ? (
            <Stack spacing={1.5} component="ol" sx={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {history.state.data.items.map((event) => (
                <Box key={event.eventId} component="li">
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {event.fromStatus && event.toStatus
                        ? `${td(`unitStatus.${event.fromStatus}`)} → ${td(`unitStatus.${event.toStatus}`)}`
                        : td(`unitStatus.${event.toStatus ?? 'available'}`)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      <Verbatim>{format.dateTime(event.occurredAt)}</Verbatim>
                    </Typography>
                  </Stack>
                  {event.reason ? (
                    <Typography variant="body2" color="text.secondary">
                      {event.reason}
                    </Typography>
                  ) : null}
                  <Divider sx={{ marginBlockStart: 1 }} />
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
