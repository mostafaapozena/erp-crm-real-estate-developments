import type {
  InventorySummary,
  Project,
  UNIT_STATUSES,
  USAGE_TYPES,
  UnitPage,
} from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DataTable, MetricCard, PageHeader, type DataColumn } from '@alola/ui';
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { query } from '../api/client';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { ExportButton } from './ExportButton';
import { CardGrid, EnumChip, RequirePermission, UNIT_TONES, Verbatim, tableStatus } from './shared';

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
  const { t, td } = useLocale();
  const { can } = useSession();
  const format = useFormatters();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const status = params.get('status') ?? '';
  const usageType = params.get('usageType') ?? '';
  const projectId = params.get('projectId') ?? '';
  const code = params.get('code') ?? '';
  const [codeDraft, setCodeDraft] = useState(code);

  const projects = useApi<{ items: Project[] }>('/api/v1/inventory/projects');
  const path = `/api/v1/inventory/units${query({ limit: 50, status, usageType, projectId, code })}`;
  const units = useApi<UnitPage>(path);
  const summary = useApi<InventorySummary>(
    `/api/v1/inventory/units/summary${query({ projectId })}`,
  );

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const rows = units.state.kind === 'ready' ? units.state.data.items : [];
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
        <CardGrid min={180}>
          <MetricCard
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
            />
          ))}
        </CardGrid>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ flexWrap: 'wrap' }}>
          <TextField
            select
            size="small"
            label={t('fields.project')}
            value={projectId}
            onChange={(event) => setParam('projectId', event.target.value)}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">—</MenuItem>
            {(projects.state.kind === 'ready' ? projects.state.data.items : []).map((project) => (
              <MenuItem key={project.projectId} value={project.projectId}>
                {project.name.ar}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t('inventory.filterByStatus')}
            value={status}
            onChange={(event) => setParam('status', event.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">—</MenuItem>
            {STATUSES.map((value) => (
              <MenuItem key={value} value={value}>
                {td(`unitStatus.${value}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t('inventory.filterByUsage')}
            value={usageType}
            onChange={(event) => setParam('usageType', event.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">—</MenuItem>
            {USAGES.map((value) => (
              <MenuItem key={value} value={value}>
                {td(`usageType.${value}`)}
              </MenuItem>
            ))}
          </TextField>
          <Stack
            direction="row"
            spacing={1}
            component="form"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              setParam('code', codeDraft.trim());
            }}
          >
            <TextField
              size="small"
              label={t('inventory.searchByCode')}
              value={codeDraft}
              onChange={(event) => setCodeDraft(event.target.value)}
              slotProps={{ htmlInput: { dir: 'ltr' } }}
            />
            <Button type="submit" variant="outlined">
              {t('actions.search')}
            </Button>
          </Stack>
        </Stack>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(unit) => unit.unitId}
          status={tableStatus(units.state)}
          caption={t('inventory.unitsTitle')}
          onRowClick={(unit) => void navigate(`/units/${unit.unitId}`)}
          errorAction={
            <Button variant="contained" onClick={units.reload}>
              {t('states.retry')}
            </Button>
          }
          labels={{
            loadingTitle: t('states.loadingTitle'),
            loadingDescription: t('states.loadingDescription'),
            emptyTitle: t('states.noResults'),
            emptyDescription: t('states.noResultsHint'),
            errorTitle: t('states.errorTitle'),
            errorDescription: t('states.errorDescription'),
            forbiddenTitle: t('states.forbiddenTitle'),
            forbiddenDescription: t('states.forbiddenDescription'),
          }}
        />

        {units.state.kind === 'ready' ? (
          <Typography variant="body2" color="text.secondary">
            <Verbatim>
              {t('pagination.showing', {
                shown: units.state.data.items.length,
                total: units.state.data.total,
              })}
            </Verbatim>
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}
