import type { Unit, UnitEvent } from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Icon, PageHeader, StateView } from '@alola/ui';
import { CalendarCheck, History, House } from '@alola/ui/icons';
import { Link, useParams } from 'react-router';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { useBreadcrumbTail } from '../shell/breadcrumbs';
import {
  BackLink,
  DetailLayout,
  FieldGroup,
  SystemNote,
  EnumChip,
  ErrorState,
  Field,
  Panel,
  RequirePermission,
  Timeline,
  Transition,
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
  const { t, td, locale } = useLocale();
  const { can } = useSession();
  const format = useFormatters();

  const unit = useApi<Unit>(unitId ? `/api/v1/inventory/units/${unitId}` : undefined);
  const history = useApi<{ items: UnitEvent[] }>(
    unitId ? `/api/v1/inventory/units/${unitId}/history` : undefined,
  );

  useBreadcrumbTail(unit.state.kind === 'ready' ? unit.state.data.code : undefined);

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
      <BackLink to="/units" label={t('detail.backTo', { list: t('nav.units') })} />
      <PageHeader
        eyebrow={t('detail.unit')}
        title={data.code}
        status={<EnumChip namespace="unitStatus" value={data.status} tones={UNIT_TONES} />}
        meta={
          <>
            <span>{td(`propertyType.${data.propertyType}`)}</span>
            <span>{td(`usageType.${data.usageType}`)}</span>
          </>
        }
        actions={
          sellable && can('sales.reservation.create') ? (
            <Button
              component={Link}
              to={`/reservations/new?unitId=${data.unitId}`}
              variant="contained"
              startIcon={<Icon icon={CalendarCheck} size={18} />}
            >
              {t('actions.reserve')}
            </Button>
          ) : undefined
        }
      />

      <DetailLayout
        main={
          <Panel title={t('inventory.unitDetails')} icon={House}>
            <Stack spacing={3}>
              <FieldGroup title={t('detail.specification')}>
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
                {data.view ? <Field label={t('inventory.view')}>{data.view[locale]}</Field> : null}
              </FieldGroup>
              {/*
                Price fields are absent — not null — for an actor without inventory.unit.viewPricing,
                so their absence is what decides whether they render (SEC-029).
              */}
              <FieldGroup title={t('detail.pricing')}>
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
                {!data.currentPrice ? (
                  <Typography variant="body2" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>
                    {t('inventory.pricingHidden')}
                  </Typography>
                ) : null}
              </FieldGroup>
              {data.paymentPlanSummary ? (
                <FieldGroup title={t('inventory.paymentPlanSummary')}>
                  <Box sx={{ gridColumn: '1 / -1', typography: 'body2' }}>
                    {data.paymentPlanSummary[locale]}
                  </Box>
                </FieldGroup>
              ) : null}
            </Stack>
          </Panel>
        }
        aside={
          <Panel title={t('inventory.history')} icon={History}>
            {history.state.kind === 'loading' ? (
              <StateView variant="inline" kind="loading" title={t('states.loadingTitle')} />
            ) : (
              <Timeline
                emptyLabel={t('states.emptyDescription')}
                entries={(history.state.kind === 'ready' ? history.state.data.items : []).map(
                  (event) => ({
                    key: event.eventId,
                    title:
                      event.fromStatus && event.toStatus ? (
                        <Transition
                          from={td(`unitStatus.${event.fromStatus}`)}
                          to={td(`unitStatus.${event.toStatus}`)}
                        />
                      ) : (
                        td(`unitStatus.${event.toStatus ?? 'available'}`)
                      ),
                    when: format.dateTime(event.occurredAt),
                    ...(event.reason ? { body: <SystemNote text={event.reason} /> } : {}),
                  }),
                )}
              />
            )}
          </Panel>
        }
      />
    </Box>
  );
}
