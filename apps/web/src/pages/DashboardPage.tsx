import type {
  CrmDashboard,
  InstallmentPage,
  InventorySummary,
  MarketingOverview,
  ContractPage,
} from '@alola/contracts';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { BarChart, MetricCard, PageHeader } from '@alola/ui';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { CardGrid, Panel, useEnumLabel } from './shared';

/**
 * The dashboard, assembled from what the actor may see.
 *
 * Every card is fetched from an endpoint that applies the actor's data scope **inside the query**
 * (SEC-028), so a sales representative's "total leads" is their own and a branch manager's is their
 * branch — without this screen knowing anything about scopes. A card whose permission the actor
 * lacks is not requested at all, which is why the request list is permission-gated rather than the
 * rendering.
 *
 * The result is that the same component is the executive dashboard, the sales dashboard and the
 * collections dashboard; the difference is entirely in what the server answers.
 */
export default function DashboardPage() {
  const { t } = useLocale();
  const { session, can } = useSession();
  const format = useFormatters();
  const enumLabel = useEnumLabel();

  const crm = useApi<CrmDashboard>(can('crm.lead.view') ? '/api/v1/crm/dashboard' : undefined);
  const inventory = useApi<InventorySummary>(
    can('inventory.unit.view') ? '/api/v1/inventory/units/summary' : undefined,
  );
  const contracts = useApi<ContractPage>(
    can('sales.contract.view') ? '/api/v1/sales/contracts?limit=100&state=active' : undefined,
  );
  const overdue = useApi<InstallmentPage>(
    can('collection.installment.view')
      ? '/api/v1/sales/installments?bucket=overdue&limit=200'
      : undefined,
  );
  const upcoming = useApi<InstallmentPage>(
    can('collection.installment.view')
      ? '/api/v1/sales/installments?bucket=upcoming&withinDays=15&limit=200'
      : undefined,
  );
  const marketing = useApi<MarketingOverview>(
    can('marketing.campaign.view') ? '/api/v1/marketing/overview' : undefined,
  );

  const crmData = crm.state.kind === 'ready' ? crm.state.data : undefined;
  const inventoryData = inventory.state.kind === 'ready' ? inventory.state.data : undefined;
  const contractData = contracts.state.kind === 'ready' ? contracts.state.data : undefined;
  const overdueData = overdue.state.kind === 'ready' ? overdue.state.data : undefined;
  const upcomingData = upcoming.state.kind === 'ready' ? upcoming.state.data : undefined;
  const marketingData = marketing.state.kind === 'ready' ? marketing.state.data : undefined;

  /**
   * Totals are summed from the rows the server returned, which are already scope-filtered. Summing
   * here rather than asking for a total keeps one source of truth: the figure can never disagree with
   * the list a person opens next.
   */
  const contractedValue = contractData?.items.reduce(
    (sum, contract) => sum + Number(contract.totalPrice.amount),
    0,
  );
  const collected = contractData?.items.reduce(
    (sum, contract) => sum + Number(contract.paidAmount.amount),
    0,
  );
  const outstanding = contractData?.items.reduce(
    (sum, contract) => sum + Number(contract.outstandingAmount.amount),
    0,
  );
  const currency = contractData?.items[0]?.totalPrice.currency ?? 'EGP';
  const asMoney = (value: number | undefined) =>
    value === undefined
      ? undefined
      : format.money({ amount: String(value.toFixed(2)) as never, currency });

  const showsNothing =
    !can('crm.lead.view') &&
    !can('inventory.unit.view') &&
    !can('sales.contract.view') &&
    !can('collection.installment.view') &&
    !can('marketing.campaign.view');

  return (
    <Box>
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        banner={
          <Typography variant="body2" color="text.secondary">
            {t('dashboard.welcome', { name: session?.account.displayName ?? '' })}
          </Typography>
        }
      />

      {showsNothing ? (
        <Typography color="text.secondary">{t('dashboard.nothingAssigned')}</Typography>
      ) : null}

      <Stack spacing={3}>
        {can('crm.lead.view') ? (
          <CardGrid>
            <MetricCard
              label={t('dashboard.totalLeads')}
              value={format.number(crmData?.totalLeads)}
              loading={crm.state.kind === 'loading'}
            />
            <MetricCard
              label={t('dashboard.newLeads')}
              value={format.number(crmData?.newLeads)}
              loading={crm.state.kind === 'loading'}
            />
            <MetricCard
              label={t('dashboard.dueFollowUps')}
              value={format.number(crmData?.dueFollowUps)}
              loading={crm.state.kind === 'loading'}
              tone={crmData && crmData.dueFollowUps > 0 ? 'attention' : 'default'}
            />
            <MetricCard
              label={t('dashboard.overdueFollowUps')}
              value={format.number(crmData?.overdueFollowUps)}
              loading={crm.state.kind === 'loading'}
              tone={crmData && crmData.overdueFollowUps > 0 ? 'attention' : 'default'}
            />
            <MetricCard
              label={t('dashboard.conversionRate')}
              value={format.percent(crmData?.conversionRate)}
              loading={crm.state.kind === 'loading'}
            />
          </CardGrid>
        ) : null}

        {can('inventory.unit.view') ? (
          <CardGrid>
            <MetricCard
              label={t('dashboard.totalUnits')}
              value={format.number(inventoryData?.total)}
              loading={inventory.state.kind === 'loading'}
            />
            <MetricCard
              label={t('dashboard.availableUnits')}
              value={format.number(inventoryData?.byStatus.available ?? 0)}
              loading={inventory.state.kind === 'loading'}
            />
            <MetricCard
              label={t('dashboard.reservedUnits')}
              value={format.number(
                (inventoryData?.byStatus.reserved ?? 0) + (inventoryData?.byStatus.held ?? 0),
              )}
              loading={inventory.state.kind === 'loading'}
            />
            <MetricCard
              label={t('dashboard.contractedUnits')}
              value={format.number(inventoryData?.byStatus.contracted ?? 0)}
              loading={inventory.state.kind === 'loading'}
            />
          </CardGrid>
        ) : null}

        {can('sales.contract.view') || can('collection.installment.view') ? (
          <CardGrid>
            {can('sales.contract.view') ? (
              <>
                <MetricCard
                  label={t('dashboard.activeContracts')}
                  value={format.number(contractData?.total)}
                  loading={contracts.state.kind === 'loading'}
                />
                <MetricCard
                  label={t('dashboard.contractedValue')}
                  value={asMoney(contractedValue)}
                  loading={contracts.state.kind === 'loading'}
                />
                <MetricCard
                  label={t('dashboard.collected')}
                  value={asMoney(collected)}
                  loading={contracts.state.kind === 'loading'}
                />
                <MetricCard
                  label={t('dashboard.outstanding')}
                  value={asMoney(outstanding)}
                  loading={contracts.state.kind === 'loading'}
                />
              </>
            ) : null}
            {can('collection.installment.view') ? (
              <>
                <MetricCard
                  label={t('dashboard.overdueInstallments')}
                  value={format.number(overdueData?.total)}
                  loading={overdue.state.kind === 'loading'}
                  tone={overdueData && overdueData.total > 0 ? 'attention' : 'default'}
                />
                <MetricCard
                  label={t('dashboard.upcomingInstallments')}
                  value={format.number(upcomingData?.total)}
                  hint={t('collections.buckets.upcoming')}
                  loading={upcoming.state.kind === 'loading'}
                />
              </>
            ) : null}
          </CardGrid>
        ) : null}

        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, 1fr)' },
          }}
        >
          {can('crm.lead.view') ? (
            <Panel title={t('dashboard.pipelineByStage')}>
              <BarChart
                caption={t('dashboard.pipelineByStage')}
                emptyLabel={t('states.emptyDescription')}
                data={Object.entries(crmData?.byStage ?? {}).map(([stage, count]) => ({
                  key: stage,
                  label: enumLabel('leadStage', stage),
                  value: count,
                  displayValue: format.number(count),
                }))}
              />
            </Panel>
          ) : null}

          {can('crm.lead.view') ? (
            <Panel title={t('dashboard.leadsBySource')}>
              <BarChart
                caption={t('dashboard.leadsBySource')}
                emptyLabel={t('states.emptyDescription')}
                data={Object.entries(crmData?.bySource ?? {}).map(([source, count]) => ({
                  key: source,
                  label: enumLabel('leadSource', source),
                  value: count,
                  displayValue: format.number(count),
                }))}
              />
            </Panel>
          ) : null}

          {can('inventory.unit.view') ? (
            <Panel title={t('dashboard.unitsByStatus')}>
              <BarChart
                caption={t('dashboard.unitsByStatus')}
                emptyLabel={t('states.emptyDescription')}
                data={Object.entries(inventoryData?.byStatus ?? {}).map(([status, count]) => ({
                  key: status,
                  label: enumLabel('unitStatus', status),
                  value: count,
                  displayValue: format.number(count),
                }))}
              />
            </Panel>
          ) : null}

          {can('crm.lead.view') && (crmData?.byOwner.length ?? 0) > 0 ? (
            <Panel title={t('dashboard.ownerPerformance')}>
              <BarChart
                caption={t('dashboard.ownerPerformance')}
                emptyLabel={t('states.emptyDescription')}
                data={(crmData?.byOwner ?? []).map((owner) => ({
                  key: owner.accountId,
                  label: owner.accountId,
                  value: owner.total,
                  displayValue: `${format.number(owner.won)} / ${format.number(owner.total)}`,
                }))}
              />
            </Panel>
          ) : null}

          {can('marketing.campaign.view') ? (
            <Panel title={t('dashboard.marketingSpend')}>
              <Stack spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  {t('marketing.notConnectedTitle')}
                </Typography>
                <BarChart
                  caption={t('dashboard.marketingSpend')}
                  emptyLabel={t('states.emptyDescription')}
                  data={(marketingData?.byPlatform ?? []).map((row) => ({
                    key: row.platform,
                    label: enumLabel('campaignPlatform', row.platform),
                    value: Number(row.spend.amount),
                    displayValue: format.money(row.spend),
                  }))}
                />
              </Stack>
            </Panel>
          ) : null}
        </Box>
      </Stack>
    </Box>
  );
}
