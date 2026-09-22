import type { CampaignPage, MarketingOverview } from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  BarChart,
  DataTable,
  DemoBadge,
  MetricCard,
  NotConnectedNotice,
  PageHeader,
  type DataColumn,
} from '@alola/ui';
import { useMemo } from 'react';
import { useApi } from '../api/useApi';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import {
  CAMPAIGN_TONES,
  CardGrid,
  EnumChip,
  Panel,
  RequirePermission,
  Verbatim,
  tableStatus,
  useEnumLabel,
} from './shared';

type Campaign = CampaignPage['items'][number];

/**
 * The marketing centre.
 *
 * Every figure on this screen is local demonstration data. There is no publish control anywhere —
 * not a disabled one, not one that opens a "coming soon" dialog — because a control that looks like a
 * capability is read as one (ADR-0026). The badge beside the section and the notice above it say the
 * same thing in whichever language is showing.
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

  const campaigns = useApi<CampaignPage>('/api/v1/marketing/campaigns?limit=50');
  const overview = useApi<MarketingOverview>('/api/v1/marketing/overview');
  const overviewData = overview.state.kind === 'ready' ? overview.state.data : undefined;

  const columns = useMemo<DataColumn<Campaign>[]>(
    () => [
      { key: 'name', header: t('fields.name'), render: (row) => row.name },
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
        render: (row) => <Verbatim>{format.money(row.budget)}</Verbatim>,
      },
      {
        key: 'spend',
        header: t('marketing.spend'),
        align: 'end',
        render: (row) => <Verbatim>{format.money(row.demoMetrics.spend)}</Verbatim>,
      },
      {
        key: 'leads',
        header: t('marketing.leads'),
        align: 'end',
        render: (row) => <Verbatim>{format.number(row.demoMetrics.leads)}</Verbatim>,
      },
      {
        key: 'impressions',
        header: t('marketing.impressions'),
        align: 'end',
        render: (row) => <Verbatim>{format.number(row.demoMetrics.impressions)}</Verbatim>,
        secondary: true,
      },
      {
        key: 'clicks',
        header: t('marketing.clicks'),
        align: 'end',
        render: (row) => <Verbatim>{format.number(row.demoMetrics.clicks)}</Verbatim>,
        secondary: true,
      },
      {
        key: 'state',
        header: t('fields.state'),
        render: (row) => (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <EnumChip namespace="campaignState" value={row.state} tones={CAMPAIGN_TONES} />
            <DemoBadge label={t('marketing.localDraftOnly')} />
          </Stack>
        ),
      },
    ],
    [format, t, td],
  );

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
        <CardGrid min={200}>
          <MetricCard
            label={t('nav.campaigns')}
            value={format.number(overviewData?.campaigns)}
            loading={overview.state.kind === 'loading'}
          />
          <MetricCard
            label={t('marketing.budget')}
            value={format.money(overviewData?.totalBudget)}
            loading={overview.state.kind === 'loading'}
          />
          <MetricCard
            label={t('marketing.spend')}
            value={format.money(overviewData?.totalSpend)}
            loading={overview.state.kind === 'loading'}
          />
          <MetricCard
            label={t('marketing.leads')}
            value={format.number(overviewData?.totalLeads)}
            loading={overview.state.kind === 'loading'}
          />
          {/*
            Cost per lead is absent from the response when nothing converted — the server omits it
            rather than sending a zero — so the card says why instead of showing a misleading figure.
          */}
          <MetricCard
            label={t('marketing.costPerLead')}
            value={overviewData?.costPerLead ? format.money(overviewData.costPerLead) : undefined}
            hint={
              overviewData && !overviewData.costPerLead
                ? t('marketing.costPerLeadUnavailable')
                : undefined
            }
            loading={overview.state.kind === 'loading'}
          />
        </CardGrid>

        <Panel title={t('marketing.byPlatform')}>
          <BarChart
            caption={t('marketing.byPlatform')}
            emptyLabel={t('states.emptyDescription')}
            data={(overviewData?.byPlatform ?? []).map((row) => ({
              key: row.platform,
              label: enumLabel('campaignPlatform', row.platform),
              value: row.leads,
              displayValue: `${format.number(row.leads)} · ${format.money(row.spend)}`,
            }))}
          />
        </Panel>

        <DataTable
          columns={columns}
          rows={campaigns.state.kind === 'ready' ? campaigns.state.data.items : []}
          rowKey={(row) => row.campaignId}
          status={tableStatus(campaigns.state)}
          caption={t('marketing.title')}
          errorAction={
            <Button variant="contained" onClick={campaigns.reload}>
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

        <Typography variant="body2" color="text.secondary">
          {t('marketing.creativePlaceholder')}
        </Typography>
      </Stack>
    </Box>
  );
}
