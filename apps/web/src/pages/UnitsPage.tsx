import type {
  InventorySummary,
  Project,
  UNIT_STATUSES,
  USAGE_TYPES,
  UnitPage,
} from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { DataTable, MetricCard, PageHeader, TableToolbar, type DataColumn } from '@alola/ui';
import { House } from '@alola/ui/icons';
import { useMemo } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import { query } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { usePagedList } from '../api/usePagedList';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { ExportButton } from './ExportButton';
import {
  CardGrid,
  EnumChip,
  FilterSelect,
  ListFooter,
  ListSearch,
  RequirePermission,
  UNIT_TONES,
  Verbatim,
  tableStatus,
  useTableLabels,
} from './shared';

type Unit = UnitPage['items'][number];
type UnitStatus = (typeof UNIT_STATUSES)[number];
type UsageType = (typeof USAGE_TYPES)[number];

const STATUSES: UnitStatus[] = ['available', 'held', 'reserved', 'contracted', 'unavailable'];
const USAGES: UsageType[] = ['residential', 'commercial', 'administrative', 'medical'];

/**
 * The inventory browser, and the unit-selection step of the sales journey.
 *
 * Filters live in the URL. That is what makes "the available two-bedroom units in Tower A" a link a
 * sales person can send to a colleague, and it is why the back button works after opening a unit.
 *
 * Pricing columns are rendered only when the row actually carries them. The server **omits** them for
 * an actor without `inventory.unit.viewPricing` (SEC-029), so this is not a permission check in the
 * client — it is the client noticing that the field is absent, which is the honest way round.
 */
export default function UnitsPage() {
  return (
    <RequirePermission permission="inventory.unit.view">
      <UnitsScreen />
    </RequirePermission>
  );
}

function UnitsScreen() {
  const { t, td, locale } = useLocale();
  const { can } = useSession();
  const format = useFormatters();
  const navigate = useNavigate();
  const labels = useTableLabels();
  const [params, setParams] = useSearchParams();

  const status = params.get('status') ?? '';
  const usageType = params.get('usageType') ?? '';
  const projectId = params.get('projectId') ?? '';
  const code = params.get('code') ?? '';

  const projects = useApi<{ items: Project[] }>('/api/v1/inventory/projects');
  const projectList = projects.state.kind === 'ready' ? projects.state.data.items : [];
  const path = `/api/v1/inventory/units${query({ limit: 50, status, usageType, projectId, code })}`;
  const units = usePagedList<Unit>(path);
  const summary = useApi<InventorySummary>(
    `/api/v1/inventory/units/summary${query({ projectId })}`,
  );

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const rows = units.items;
  const chip = (key: string, name: string, value: string) => ({
    key,
    label: t('filters.active', { name, value }),
    onRemove: () => setParam(key, ''),
  });
  const active = [
    ...(code ? [chip('code', t('inventory.searchByCode'), code)] : []),
    ...(projectId
      ? [
          chip(
            'projectId',
            t('fields.project'),
            projectList.find((project) => project.projectId === projectId)?.name[locale] ?? '…',
          ),
        ]
      : []),
    ...(status ? [chip('status', t('inventory.filterByStatus'), td(`unitStatus.${status}`))] : []),
    ...(usageType
      ? [chip('usageType', t('inventory.filterByUsage'), td(`usageType.${usageType}`))]
      : []),
  ];
  const pricingVisible = rows.some((unit) => unit.currentPrice !== undefined);
  const summaryData = summary.state.kind === 'ready' ? summary.state.data : undefined;

  const columns = useMemo<DataColumn<Unit>[]>(() => {
    const base: DataColumn<Unit>[] = [
      {
        key: 'code',
        header: t('fields.code'),
        render: (unit) => <Verbatim>{unit.code}</Verbatim>,
      },
      {
        key: 'type',
        header: t('inventory.propertyType'),
        render: (unit) => td(`propertyType.${unit.propertyType}`),
      },
      {
        key: 'usage',
        header: t('inventory.usage'),
        render: (unit) => td(`usageType.${unit.usageType}`),
      },
      {
        key: 'floor',
        header: t('fields.floor'),
        render: (unit) => <Verbatim>{format.number(unit.floor)}</Verbatim>,
      },
      {
        key: 'area',
        header: t('fields.area'),
        render: (unit) => (
          <Verbatim>{`${format.number(unit.area, 2)} ${t('inventory.squareMetre')}`}</Verbatim>
        ),
      },
      {
        key: 'status',
        header: t('fields.status'),
        render: (unit) => (
          <EnumChip namespace="unitStatus" value={unit.status} tones={UNIT_TONES} />
        ),
      },
    ];
    if (pricingVisible) {
      base.splice(5, 0, {
        key: 'price',
        header: t('inventory.currentPrice'),
        align: 'end',
        render: (unit) => <Verbatim>{format.money(unit.currentPrice)}</Verbatim>,
      });
    }
    return base;
  }, [format, pricingVisible, t, td]);

  return (
    <Box>
      <PageHeader
        title={t('inventory.unitsTitle')}
        subtitle={t('inventory.unitsSubtitle')}
        actions={<ExportButton kind="units" permission="inventory.unit.export" />}
        banner={
          pricingVisible || !can('inventory.unit.view') ? undefined : (
            <Typography variant="body2" color="text.secondary">
              {t('inventory.pricingHidden')}
            </Typography>
          )
        }
      />

      <Stack spacing={3}>
        <CardGrid min={170}>
          <MetricCard
            icon={House}
            label={t('dashboard.totalUnits')}
            value={format.number(summaryData?.total)}
            loading={summary.state.kind === 'loading'}
          />
          {STATUSES.map((value) => (
            <MetricCard
              key={value}
              label={td(`unitStatus.${value}`)}
              value={format.number(summaryData?.byStatus[value] ?? 0)}
              loading={summary.state.kind === 'loading'}
              {...(value === 'available' ? { tone: 'positive' as const } : {})}
              link={{
                component: RouterLink,
                to: `/units${query({ projectId, status: value })}`,
                label: t('dashboard.openList'),
              }}
            />
          ))}
        </CardGrid>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(unit) => unit.unitId}
          rowLabel={(unit) => t('list.open', { label: unit.code })}
          status={tableStatus(units.state)}
          caption={t('inventory.unitsTitle')}
          filtered={active.length > 0}
          onRowClick={(unit) => void navigate(`/units/${unit.unitId}`)}
          errorAction={
            <Button variant="contained" onClick={units.reload}>
              {t('states.retry')}
            </Button>
          }
          labels={labels}
          toolbar={
            <TableToolbar
              search={
                <ListSearch
                  value={code}
                  onSubmit={(value) => setParam('code', value)}
                  label={t('inventory.searchByCode')}
                  ltr
                />
              }
              filters={
                <>
                  <FilterSelect
                    label={t('fields.project')}
                    value={projectId}
                    onChange={(value) => setParam('projectId', value)}
                    minWidth={200}
                    options={projectList.map((project) => ({
                      value: project.projectId,
                      label: project.name[locale],
                    }))}
                  />
                  <FilterSelect
                    label={t('inventory.filterByStatus')}
                    value={status}
                    onChange={(value) => setParam('status', value)}
                    options={STATUSES.map((value) => ({
                      value,
                      label: td(`unitStatus.${value}`),
                    }))}
                  />
                  <FilterSelect
                    label={t('inventory.filterByUsage')}
                    value={usageType}
                    onChange={(value) => setParam('usageType', value)}
                    options={USAGES.map((value) => ({ value, label: td(`usageType.${value}`) }))}
                  />
                </>
              }
              activeFilters={active}
              clearLabel={t('filters.clearAll')}
              removeLabel={(label) => t('filters.remove', { label })}
              onClearAll={() => setParams(new URLSearchParams(), { replace: true })}
            />
          }
          footer={
            <ListFooter
              shown={units.items.length}
              total={units.total}
              hasMore={units.hasMore}
              loadingMore={units.loadingMore}
              onLoadMore={units.loadMore}
              error={units.moreError}
            />
          }
        />
      </Stack>
    </Box>
  );
}
