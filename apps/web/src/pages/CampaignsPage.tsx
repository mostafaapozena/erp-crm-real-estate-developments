import {
  CAMPAIGN_PLATFORMS,
  CAMPAIGN_STATES,
  subtractMoney,
  type CampaignPage,
  type MarketingOverview,
} from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  DataTable,
  DemoBadge,
  MetricCard,
  NotConnectedNotice,
  PageHeader,
  SectionCard,
  StatusChip,
  TableToolbar,
  type DataColumn,
} from '@alola/ui';
import { ChartColumn, Coins, Eye, Megaphone, Target, Unplug, Users, Wallet } from '@alola/ui/icons';
import { useMemo, useState } from 'react';
import { query } from '../api/client';
import { useApi } from '../api/useApi';
import { usePagedList } from '../api/usePagedList';
import { CategoryBarChart, ChartSkeleton } from '../charts';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import {
  CAMPAIGN_TONES,
  EnumChip,
  Field,
  FilterSelect,
  ListFooter,
  RequirePermission,
  Verbatim,
  tableStatus,
  useEnumLabel,
  useTableLabels,
} from './shared';

type Campaign = CampaignPage['items'][number];

/**
 * The marketing centre.
 *
 * Every figure on this screen is local demonstration data, and the screen says so three times in
 * three forms: the connection panel (no provider, never synchronised), a badge on every figure group,
 * and the notice above it all. There is no publish control anywhere — not a disabled one, not one
 * that opens a "coming soon" dialog — because a control that looks like a capability is read as one
 * (ADR-0026).
 *
 * Only the campaign states the product has are shown: draft, ready to publish, archived. "Published",
 * "paused", "rejected" and "failed" are provider outcomes; with no provider they do not exist, and a
 * legend listing them would imply they can happen.
 *
 * Money is the server's decimal string, and the remaining budget is decimal subtraction (ADR-0007);
 * reach and impressions are integer counts over the campaigns loaded.
 */
export default function CampaignsPage() {
  return (
    <RequirePermission permission="marketing.campaign.view">
      <CampaignsScreen />
    </RequirePermission>
  );
}

function CampaignsScreen() {
  const { t, td } = useLocale();
  const format = useFormatters();
  const enumLabel = useEnumLabel();
  const labels = useTableLabels();
  const [platform, setPlatform] = useState('');
  const [state, setState] = useState('');

  const campaigns = usePagedList<Campaign>(
    `/api/v1/marketing/campaigns${query({ limit: 50, platform, state })}`,
  );
  const overview = useApi<MarketingOverview>('/api/v1/marketing/overview');
  const overviewData = overview.state.kind === 'ready' ? overview.state.data : undefined;
  const loading = overview.state.kind === 'loading';

  const remaining =
    overviewData && overviewData.totalBudget.currency === overviewData.totalSpend.currency
      ? subtractMoney(overviewData.totalBudget, overviewData.totalSpend)
      : undefined;
  const reach = campaigns.items.reduce((sum, row) => sum + row.demoMetrics.reach, 0);
  const impressions = campaigns.items.reduce((sum, row) => sum + row.demoMetrics.impressions, 0);

  const columns = useMemo<DataColumn<Campaign>[]>(
    () => [
      {
        key: 'name',
        header: t('fields.name'),
        render: (row) => (
          <Box component="span" sx={{ fontWeight: 600 }}>
            {row.name}
          </Box>
        ),
      },
      {
        key: 'platform',
        header: t('marketing.platform'),
        render: (row) => td(`campaignPlatform.${row.platform}`),
      },
      {
        key: 'objective',
        header: t('marketing.objective'),
        render: (row) => td(`campaignObjective.${row.objective}`),
        secondary: true,
      },
      {
        key: 'budget',
        header: t('marketing.budget'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.budget, 0)}</Verbatim>,
      },
      {
        key: 'spend',
        header: t('marketing.spend'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.demoMetrics.spend, 0)}</Verbatim>,
      },
      {
        key: 'reach',
        header: t('marketing.reach'),
        align: 'end',
        render: (row) => <Verbatim>{format.number(row.demoMetrics.reach)}</Verbatim>,
        secondary: true,
      },
      {
        key: 'leads',
        header: t('marketing.leads'),
        align: 'end',
        render: (row) => <Verbatim>{format.number(row.demoMetrics.leads)}</Verbatim>,
      },
      {
        key: 'state',
        header: t('fields.state'),
        render: (row) => (
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <EnumChip namespace="campaignState" value={row.state} tones={CAMPAIGN_TONES} />
            <DemoBadge label={t('marketing.simulated')} />
          </Stack>
        ),
      },
    ],
    [format, t, td],
  );

  const figures = <DemoBadge label={t('marketing.demoFigures')} />;

  return (
    <Box>
      <PageHeader
        title={t('marketing.title')}
        subtitle={t('marketing.subtitle')}
        banner={
          <NotConnectedNotice
            title={t('marketing.notConnectedTitle')}
            body={t('marketing.notConnectedBody')}
          />
        }
      />

      <Stack spacing={3}>
        <SectionCard title={t('marketing.connectionTitle')} icon={Unplug}>
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
            }}
          >
            <Field label={t('marketing.provider')}>{t('marketing.providerMeta')}</Field>
            <Field label={t('marketing.connectionState')}>
              <StatusChip tone="neutral" label={t('marketing.notConnected')} />
            </Field>
            <Field label={t('marketing.lastSync')}>{t('marketing.neverSynced')}</Field>
            <Field label={t('marketing.mode')}>
              <DemoBadge label={t('marketing.simulated')} />
            </Field>
          </Box>
        </SectionCard>

        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, marginBlockEnd: 1.5 }}>
            <Typography component="h2" sx={{ fontSize: '1rem', fontWeight: 700 }}>
              {t('marketing.performance')}
            </Typography>
            {figures}
          </Box>
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            }}
          >
            <MetricCard
              icon={Megaphone}
              label={t('nav.campaigns')}
              value={format.number(overviewData?.campaigns)}
              loading={loading}
            />
            <MetricCard
              icon={Wallet}
              label={t('marketing.budget')}
              value={format.money(overviewData?.totalBudget, 0)}
              loading={loading}
            />
            <MetricCard
              icon={Coins}
              label={t('marketing.spend')}
              value={format.money(overviewData?.totalSpend, 0)}
              loading={loading}
            />
            <MetricCard
              icon={Wallet}
              label={t('marketing.remainingBudget')}
              value={format.money(remaining, 0)}
              loading={loading}
            />
            <MetricCard
              icon={Users}
              label={t('marketing.reach')}
              value={format.number(reach)}
              loading={campaigns.state.kind === 'loading'}
            />
            <MetricCard
              icon={Eye}
              label={t('marketing.impressions')}
              value={format.number(impressions)}
              loading={campaigns.state.kind === 'loading'}
            />
            <MetricCard
              icon={Target}
              label={t('marketing.leads')}
              value={format.number(overviewData?.totalLeads)}
              loading={loading}
            />
            {/*
              Cost per lead is absent from the response when nothing converted — the server omits it
              rather than sending a zero — so the card says why instead of showing a misleading figure.
            */}
            <MetricCard
              icon={ChartColumn}
              label={t('marketing.costPerLead')}
              value={overviewData?.costPerLead ? format.money(overviewData.costPerLead) : undefined}
              {...(overviewData && !overviewData.costPerLead
                ? { hint: t('marketing.costPerLeadUnavailable') }
                : {})}
              loading={loading}
            />
          </Box>
        </Box>

        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
          }}
        >
          <SectionCard title={t('marketing.leadsByCampaign')} icon={Target} actions={figures} fill>
            {campaigns.state.kind === 'loading' ? (
              <ChartSkeleton />
            ) : (
              <CategoryBarChart
                caption={t('marketing.leadsByCampaign')}
                data={campaigns.items.map((row) => ({
                  key: row.campaignId,
                  label: row.name,
                  value: row.demoMetrics.leads,
                  display: format.number(row.demoMetrics.leads),
                }))}
                headers={{ category: t('fields.name'), value: t('marketing.leads') }}
                emptyLabel={t('states.emptyDescription')}
              />
            )}
          </SectionCard>
          <SectionCard title={t('marketing.byPlatform')} icon={ChartColumn} actions={figures} fill>
            {loading ? (
              <ChartSkeleton />
            ) : (
              <CategoryBarChart
                caption={t('marketing.byPlatform')}
                multicolour
                data={(overviewData?.byPlatform ?? []).map((row) => ({
                  key: row.platform,
                  label: enumLabel('campaignPlatform', row.platform),
                  value: Number(row.spend.amount),
                  display: `${format.money(row.spend, 0)} · ${t('marketing.leadsCount', {
                    count: format.number(row.leads),
                  })}`,
                }))}
                headers={{ category: t('marketing.platform'), value: t('marketing.spend') }}
                emptyLabel={t('states.emptyDescription')}
              />
            )}
          </SectionCard>
        </Box>

        <DataTable
          columns={columns}
          rows={campaigns.items}
          rowKey={(row) => row.campaignId}
          status={tableStatus(campaigns.state)}
          caption={t('marketing.title')}
          filtered={platform !== '' || state !== ''}
          errorAction={
            <Button variant="contained" onClick={campaigns.reload}>
              {t('states.retry')}
            </Button>
          }
          labels={labels}
          toolbar={
            <TableToolbar
              filters={
                <>
                  <FilterSelect
                    label={t('marketing.platform')}
                    value={platform}
                    onChange={setPlatform}
                    options={CAMPAIGN_PLATFORMS.map((value) => ({
                      value,
                      label: td(`campaignPlatform.${value}`),
                    }))}
                  />
                  <FilterSelect
                    label={t('fields.state')}
                    value={state}
                    onChange={setState}
                    options={CAMPAIGN_STATES.map((value) => ({
                      value,
                      label: td(`campaignState.${value}`),
                    }))}
                  />
                </>
              }
              activeFilters={[
                ...(platform
                  ? [
                      {
                        key: 'platform',
                        label: `${t('marketing.platform')}: ${td(`campaignPlatform.${platform}`)}`,
                        onRemove: () => setPlatform(''),
                      },
                    ]
                  : []),
                ...(state
                  ? [
                      {
                        key: 'state',
                        label: `${t('fields.state')}: ${td(`campaignState.${state}`)}`,
                        onRemove: () => setState(''),
                      },
                    ]
                  : []),
              ]}
              removeLabel={(label) => t('filters.remove', { label })}
            />
          }
          footer={
            <ListFooter
              shown={campaigns.items.length}
              total={campaigns.total}
              hasMore={campaigns.hasMore}
              loadingMore={campaigns.loadingMore}
              onLoadMore={campaigns.loadMore}
              error={campaigns.moreError}
            />
          }
        />

        <Typography variant="body2" color="text.secondary">
          {t('marketing.creativePlaceholder')}
        </Typography>
      </Stack>
    </Box>
  );
}
