import type {
  ContractSummary,
  CrmDashboard,
  InstallmentPage,
  InventorySummary,
  MarketingOverview,
  Money,
  ReminderPage,
  ReservationPage,
} from '@alola/contracts';
import { LEAD_STAGES, businessDateInZone, nowInstant } from '@alola/contracts';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { DemoBadge, Icon, MetricCard, PageHeader, SectionCard, StateView, tokens } from '@alola/ui';
import {
  AlarmClock,
  BellRing,
  Building2,
  CalendarCheck,
  CalendarClock,
  ChevronRight,
  Coins,
  FileSignature,
  FlaskConical,
  HandCoins,
  House,
  ListChecks,
  Megaphone,
  Target,
  TrendingUp,
  TriangleAlert,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from '@alola/ui/icons';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import { useSession } from '../api/session';
import { useApi } from '../api/useApi';
import { useBranding } from '../branding';
import {
  CategoryBarChart,
  ChartSkeleton,
  DonutChart,
  RatioMeter,
  type ChartDatum,
} from '../charts';
import { useFormatters } from '../format';
import { useLocale } from '../locale';
import { usePersonLabel } from '../people';
import { useEnumLabel } from './shared';

/**
 * The dashboard, assembled from what the actor may see, ordered by what needs deciding.
 *
 * Every figure is fetched from an endpoint that applies the actor's data scope **inside the query**
 * (SEC-028), so a representative's "total leads" is their own and a branch manager's is their
 * branch — without this screen knowing anything about scopes. A card whose permission the actor lacks
 * is not requested at all, and its section does not render: the same component is the executive,
 * sales and collections dashboard, and the difference is entirely what the server answers.
 *
 * Order: the executive summary, what needs attention today, collections and overdue exposure, sales,
 * inventory, marketing, team. Money totals come from the server's `Decimal128` aggregate, one figure
 * per currency — never a client-side sum of a page of rows (ADR-0007). Charts draw returned numbers
 * only; there is no trend without a real comparison, so there is no trend.
 */
type Task = { overdue: boolean };

const AGEING_BUCKETS = [
  { key: 'd1to30', max: 30 },
  { key: 'd31to60', max: 60 },
  { key: 'd61to90', max: 90 },
  { key: 'd90plus', max: Number.POSITIVE_INFINITY },
] as const;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export default function DashboardPage() {
  const { t, td } = useLocale();
  const { session, can } = useSession();
  const branding = useBranding();
  const format = useFormatters();
  const enumLabel = useEnumLabel();
  const personLabel = usePersonLabel();

  const canLeads = can('crm.lead.view');
  const canUnits = can('inventory.unit.view');
  const canContracts = can('sales.contract.view');
  const canInstallments = can('collection.installment.view');
  const canReservations = can('sales.reservation.view');
  const canReminders = can('collection.reminder.view');
  const canMarketing = can('marketing.campaign.view');

  const crm = useApi<CrmDashboard>(canLeads ? '/api/v1/crm/dashboard' : undefined);
  const inventory = useApi<InventorySummary>(
    canUnits ? '/api/v1/inventory/units/summary' : undefined,
  );
  const contracts = useApi<ContractSummary>(
    canContracts ? '/api/v1/sales/contracts/summary?state=active' : undefined,
  );
  const overdue = useApi<InstallmentPage>(
    canInstallments ? '/api/v1/sales/installments?bucket=overdue&limit=200' : undefined,
  );
  const upcoming = useApi<InstallmentPage>(
    canInstallments
      ? '/api/v1/sales/installments?bucket=upcoming&withinDays=15&limit=200'
      : undefined,
  );
  const pending = useApi<ReservationPage>(
    canReservations ? '/api/v1/sales/reservations?state=pendingApproval&limit=1' : undefined,
  );
  const remindersReady = useApi<ReminderPage>(
    canReminders ? '/api/v1/collections/reminders?state=ready&limit=1' : undefined,
  );
  const remindersSimulated = useApi<ReminderPage>(
    canReminders ? '/api/v1/collections/reminders?state=simulated&limit=1' : undefined,
  );
  // Everyone has their own tasks (CORE-TASK-001); no permission gates this request.
  const tasks = useApi<{ items: Task[]; nextCursor?: string }>(
    '/api/v1/tasks?view=mine&state=open&limit=100',
  );
  const marketing = useApi<MarketingOverview>(
    canMarketing ? '/api/v1/marketing/overview' : undefined,
  );

  const ready = <T,>(state: { kind: string; data?: T }) =>
    state.kind === 'ready' ? (state as { data: T }).data : undefined;
  const crmData = ready<CrmDashboard>(crm.state);
  const inventoryData = ready<InventorySummary>(inventory.state);
  const contractData = ready<ContractSummary>(contracts.state);
  const overdueData = ready<InstallmentPage>(overdue.state);
  const upcomingData = ready<InstallmentPage>(upcoming.state);
  const marketingData = ready<MarketingOverview>(marketing.state);

  /** One figure per currency, joined; two currencies are never added into one number. */
  const perCurrency = (pick: (row: ContractSummary['byCurrency'][number]) => Money) =>
    contractData && contractData.byCurrency.length > 0
      ? contractData.byCurrency.map((row) => format.money(pick(row))).join(' · ')
      : format.number(0);

  const count = (value: number | undefined) => format.number(value ?? 0);
  const link = (to: string, label = t('dashboard.viewAll')) => ({
    component: RouterLink,
    to,
    label,
  });

  const anything =
    canLeads || canUnits || canContracts || canInstallments || canMarketing || canReservations;

  /* ------------------------------------------------------------ derived views */

  const today = businessDateInZone(nowInstant(), branding.timeZone);
  const ageing: ChartDatum[] = AGEING_BUCKETS.map((bucket, index) => {
    const floor = index === 0 ? 0 : (AGEING_BUCKETS[index - 1]?.max ?? 0);
    const value = (overdueData?.items ?? []).filter((item) => {
      const late = daysBetween(item.dueOn, today);
      return late > floor && late <= bucket.max;
    }).length;
    return {
      key: bucket.key,
      label: td(`dashboard.ageing.${bucket.key}`),
      value,
      display: format.number(value),
    };
  });

  const primaryCurrency = contractData?.byCurrency[0];
  const collectionRatio =
    primaryCurrency && Number(primaryCurrency.totalContracted.amount) > 0
      ? Number(primaryCurrency.totalPaid.amount) / Number(primaryCurrency.totalContracted.amount)
      : undefined;

  const portfolio: ChartDatum[] = primaryCurrency
    ? [
        {
          key: 'contracted',
          label: t('dashboard.contractedValue'),
          value: Number(primaryCurrency.totalContracted.amount),
          display: format.money(primaryCurrency.totalContracted, 0),
        },
        {
          key: 'collected',
          label: t('dashboard.collected'),
          value: Number(primaryCurrency.totalPaid.amount),
          display: format.money(primaryCurrency.totalPaid, 0),
        },
        {
          key: 'outstanding',
          label: t('dashboard.outstanding'),
          value: Number(primaryCurrency.totalOutstanding.amount),
          display: format.money(primaryCurrency.totalOutstanding, 0),
        },
      ]
    : [];

  const taskItems = tasks.state.kind === 'ready' ? tasks.state.data.items : undefined;
  const taskCount = (items: Task[] | undefined) =>
    items === undefined
      ? undefined
      : `${format.number(items.length)}${tasks.state.kind === 'ready' && tasks.state.data.nextCursor ? '+' : ''}`;

  const attention: AttentionItem[] = [
    ...(canInstallments
      ? [
          {
            key: 'overdue',
            icon: TriangleAlert,
            tone: 'danger' as const,
            label: t('dashboard.attention.overdueInstallments'),
            count: overdueData ? format.number(overdueData.total) : undefined,
            active: (overdueData?.total ?? 0) > 0,
            to: '/installments',
            loading: overdue.state.kind === 'loading',
          },
          {
            key: 'upcoming',
            icon: CalendarClock,
            tone: 'warning' as const,
            label: t('dashboard.attention.upcomingInstallments'),
            count: upcomingData ? format.number(upcomingData.total) : undefined,
            active: (upcomingData?.total ?? 0) > 0,
            to: '/installments',
            loading: upcoming.state.kind === 'loading',
          },
        ]
      : []),
    ...(canReservations
      ? [
          {
            key: 'approvals',
            icon: CalendarCheck,
            tone: 'warning' as const,
            label: t('dashboard.attention.pendingApprovals'),
            count:
              pending.state.kind === 'ready' ? format.number(pending.state.data.total) : undefined,
            active: pending.state.kind === 'ready' && pending.state.data.total > 0,
            to: '/reservations',
            loading: pending.state.kind === 'loading',
          },
        ]
      : []),
    ...(canLeads
      ? [
          {
            key: 'overdueFollowUps',
            icon: AlarmClock,
            tone: 'danger' as const,
            label: t('dashboard.attention.overdueFollowUps'),
            count: crmData ? format.number(crmData.overdueFollowUps) : undefined,
            active: (crmData?.overdueFollowUps ?? 0) > 0,
            to: '/leads',
            loading: crm.state.kind === 'loading',
          },
          {
            key: 'dueFollowUps',
            icon: UserPlus,
            tone: 'info' as const,
            label: t('dashboard.attention.dueFollowUps'),
            count: crmData ? format.number(crmData.dueFollowUps) : undefined,
            active: (crmData?.dueFollowUps ?? 0) > 0,
            to: '/leads',
            loading: crm.state.kind === 'loading',
          },
        ]
      : []),
    ...(canReminders
      ? [
          {
            key: 'remindersReady',
            icon: BellRing,
            tone: 'info' as const,
            label: t('dashboard.attention.remindersReady'),
            count:
              remindersReady.state.kind === 'ready'
                ? format.number(remindersReady.state.data.total)
                : undefined,
            active: remindersReady.state.kind === 'ready' && remindersReady.state.data.total > 0,
            to: '/reminders',
            loading: remindersReady.state.kind === 'loading',
          },
          {
            key: 'remindersSimulated',
            icon: FlaskConical,
            tone: 'info' as const,
            label: t('dashboard.attention.remindersSimulated'),
            count:
              remindersSimulated.state.kind === 'ready'
                ? format.number(remindersSimulated.state.data.total)
                : undefined,
            active:
              remindersSimulated.state.kind === 'ready' && remindersSimulated.state.data.total > 0,
            to: '/reminders',
            loading: remindersSimulated.state.kind === 'loading',
          },
        ]
      : []),
    {
      key: 'tasksOverdue',
      icon: ListChecks,
      tone: 'danger' as const,
      label: t('dashboard.attention.tasksOverdue'),
      count: taskCount(taskItems?.filter((task) => task.overdue)),
      active: (taskItems?.filter((task) => task.overdue).length ?? 0) > 0,
      to: '/tasks',
      loading: tasks.state.kind === 'loading',
    },
    {
      key: 'tasksOpen',
      icon: ListChecks,
      tone: 'info' as const,
      label: t('dashboard.attention.tasksOpen'),
      count: taskCount(taskItems),
      active: (taskItems?.length ?? 0) > 0,
      to: '/tasks',
      loading: tasks.state.kind === 'loading',
    },
  ];

  return (
    <Box>
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.welcome', { name: session?.account.displayName ?? '' })}
        meta={<span>{t('dashboard.scopeNote')}</span>}
      />

      {anything ? null : (
        <Box sx={{ marginBlockEnd: 3 }}>
          <StateView kind="empty" title={t('dashboard.nothingAssigned')} />
        </Box>
      )}

      <Box sx={{ display: 'grid', gap: 3 }}>
        {/* 1 — Executive summary */}
        {canContracts || canLeads || canUnits ? (
          <Section title={t('dashboard.sections.executive')}>
            <KpiGrid>
              {canContracts ? (
                <>
                  <MetricCard
                    icon={FileSignature}
                    label={t('dashboard.activeContracts')}
                    value={count(contractData?.contracts)}
                    loading={contracts.state.kind === 'loading'}
                    link={link('/contracts')}
                  />
                  <MetricCard
                    icon={Wallet}
                    label={t('dashboard.contractedValue')}
                    value={perCurrency((row) => row.totalContracted)}
                    loading={contracts.state.kind === 'loading'}
                  />
                  <MetricCard
                    icon={HandCoins}
                    label={t('dashboard.collected')}
                    value={perCurrency((row) => row.totalPaid)}
                    loading={contracts.state.kind === 'loading'}
                    {...(collectionRatio !== undefined
                      ? {
                          hint: `${t('dashboard.collectionRate')}: ${format.percent(collectionRatio)}`,
                        }
                      : {})}
                  />
                  <MetricCard
                    icon={Coins}
                    label={t('dashboard.outstanding')}
                    value={perCurrency((row) => row.totalOutstanding)}
                    loading={contracts.state.kind === 'loading'}
                  />
                </>
              ) : null}
              {canLeads && !canContracts ? (
                <>
                  <MetricCard
                    icon={Users}
                    label={t('dashboard.totalLeads')}
                    value={count(crmData?.totalLeads)}
                    loading={crm.state.kind === 'loading'}
                    link={link('/leads')}
                  />
                  <MetricCard
                    icon={TrendingUp}
                    label={t('dashboard.conversionRate')}
                    value={format.percent(crmData?.conversionRate)}
                    loading={crm.state.kind === 'loading'}
                  />
                </>
              ) : null}
              {canUnits && !canContracts ? (
                <MetricCard
                  icon={House}
                  label={t('dashboard.availableUnits')}
                  value={count(inventoryData?.byStatus.available)}
                  loading={inventory.state.kind === 'loading'}
                  link={link('/units?status=available')}
                />
              ) : null}
            </KpiGrid>
          </Section>
        ) : null}

        {/* 2 — Needs attention today */}
        <AttentionCentre items={attention} />

        {/* 3 — Collections and overdue exposure */}
        {canContracts || canInstallments ? (
          <Section title={t('dashboard.sections.collections')}>
            <Box sx={twoColumns}>
              {canContracts ? (
                <SectionCard title={t('dashboard.portfolio')} icon={Wallet} fill headingLevel={3}>
                  {contracts.state.kind === 'loading' ? (
                    <ChartSkeleton />
                  ) : (
                    <Box sx={{ display: 'grid', gap: 2.5 }}>
                      {collectionRatio !== undefined ? (
                        <RatioMeter
                          label={t('dashboard.collectionRate')}
                          value={collectionRatio}
                          display={format.percent(collectionRatio)}
                          tone="success"
                        />
                      ) : null}
                      <CategoryBarChart
                        caption={t('dashboard.portfolio')}
                        data={portfolio}
                        headers={{
                          category: t('dashboard.headers.category'),
                          value: t('dashboard.headers.amount'),
                        }}
                        emptyLabel={t('states.emptyDescription')}
                        multicolour
                      />
                      {(contractData?.byCurrency.length ?? 0) > 1 ? (
                        <Typography variant="caption" color="text.secondary">
                          {perCurrency((row) => row.totalContracted)}
                        </Typography>
                      ) : null}
                    </Box>
                  )}
                </SectionCard>
              ) : null}
              {canInstallments ? (
                <SectionCard
                  title={t('dashboard.overdueAgeing')}
                  icon={TriangleAlert}
                  fill
                  headingLevel={3}
                  {...(overdueData && overdueData.total > overdueData.items.length
                    ? {
                        description: t('dashboard.ageingPartial', {
                          count: overdueData.items.length,
                        }),
                      }
                    : {})}
                >
                  {overdue.state.kind === 'loading' ? (
                    <ChartSkeleton />
                  ) : (
                    <CategoryBarChart
                      caption={t('dashboard.overdueAgeing')}
                      data={ageing}
                      headers={{
                        category: t('dashboard.headers.period'),
                        value: t('dashboard.headers.count'),
                      }}
                      emptyLabel={t('states.emptyDescription')}
                      orientation="columns"
                    />
                  )}
                </SectionCard>
              ) : null}
            </Box>
          </Section>
        ) : null}

        {/* 4 — Sales performance */}
        {canLeads ? (
          <Section title={t('dashboard.sections.sales')}>
            {canContracts ? (
              <KpiGrid>
                <MetricCard
                  icon={Users}
                  label={t('dashboard.totalLeads')}
                  value={count(crmData?.totalLeads)}
                  loading={crm.state.kind === 'loading'}
                  link={link('/leads')}
                />
                <MetricCard
                  icon={UserPlus}
                  label={t('dashboard.newLeads')}
                  value={count(crmData?.newLeads)}
                  loading={crm.state.kind === 'loading'}
                />
                <MetricCard
                  icon={TrendingUp}
                  label={t('dashboard.conversionRate')}
                  value={format.percent(crmData?.conversionRate)}
                  loading={crm.state.kind === 'loading'}
                />
                <MetricCard
                  icon={Target}
                  label={t('dashboard.overdueFollowUps')}
                  value={count(crmData?.overdueFollowUps)}
                  loading={crm.state.kind === 'loading'}
                  tone={(crmData?.overdueFollowUps ?? 0) > 0 ? 'attention' : 'default'}
                />
              </KpiGrid>
            ) : null}
            <Box sx={{ ...twoColumns, marginBlockStart: canContracts ? 2 : 0 }}>
              <SectionCard
                title={t('dashboard.pipelineByStage')}
                icon={Target}
                fill
                headingLevel={3}
              >
                {crm.state.kind === 'loading' ? (
                  <ChartSkeleton />
                ) : (
                  <CategoryBarChart
                    caption={t('dashboard.pipelineByStage')}
                    // In pipeline order, so the chart reads as the funnel it is.
                    data={LEAD_STAGES.filter((stage) => crmData?.byStage[stage] !== undefined).map(
                      (stage) => {
                        const value = crmData?.byStage[stage] ?? 0;
                        return {
                          key: stage,
                          label: enumLabel('leadStage', stage),
                          value,
                          display: format.number(value),
                        };
                      },
                    )}
                    headers={{
                      category: t('dashboard.headers.stage'),
                      value: t('dashboard.headers.count'),
                    }}
                    emptyLabel={t('states.emptyDescription')}
                  />
                )}
              </SectionCard>
              <SectionCard title={t('dashboard.leadsBySource')} icon={Users} fill headingLevel={3}>
                {crm.state.kind === 'loading' ? (
                  <ChartSkeleton />
                ) : (
                  <DonutChart
                    caption={t('dashboard.leadsBySource')}
                    data={Object.entries(crmData?.bySource ?? {}).map(([source, value]) => ({
                      key: source,
                      label: enumLabel('leadSource', source),
                      value,
                      display: format.number(value),
                    }))}
                    headers={{
                      category: t('dashboard.headers.source'),
                      value: t('dashboard.headers.count'),
                    }}
                    emptyLabel={t('states.emptyDescription')}
                    centre={{
                      value: format.number(crmData?.totalLeads),
                      label: t('dashboard.leadsCaption'),
                    }}
                  />
                )}
              </SectionCard>
            </Box>
          </Section>
        ) : null}

        {/* 5 — Inventory status */}
        {canUnits ? (
          <Section title={t('dashboard.sections.inventory')}>
            <Box sx={twoColumns}>
              <SectionCard
                title={t('dashboard.unitsByStatus')}
                icon={Building2}
                fill
                headingLevel={3}
              >
                {inventory.state.kind === 'loading' ? (
                  <ChartSkeleton />
                ) : (
                  <DonutChart
                    caption={t('dashboard.unitsByStatus')}
                    data={(
                      ['available', 'held', 'reserved', 'contracted', 'unavailable'] as const
                    ).map((status) => {
                      const value = inventoryData?.byStatus[status] ?? 0;
                      return {
                        key: status,
                        label: enumLabel('unitStatus', status),
                        value,
                        display: format.number(value),
                      };
                    })}
                    headers={{
                      category: t('dashboard.headers.status'),
                      value: t('dashboard.headers.count'),
                    }}
                    emptyLabel={t('states.emptyDescription')}
                    centre={{
                      value: format.number(inventoryData?.total),
                      label: t('dashboard.unitsCaption'),
                    }}
                  />
                )}
              </SectionCard>
              <KpiGrid min={180}>
                <MetricCard
                  icon={House}
                  label={t('dashboard.totalUnits')}
                  value={count(inventoryData?.total)}
                  loading={inventory.state.kind === 'loading'}
                  link={link('/units')}
                />
                <MetricCard
                  icon={House}
                  label={t('dashboard.availableUnits')}
                  value={count(inventoryData?.byStatus.available)}
                  loading={inventory.state.kind === 'loading'}
                  tone="positive"
                  link={link('/units?status=available', t('dashboard.openList'))}
                />
                <MetricCard
                  icon={CalendarCheck}
                  label={t('dashboard.reservedUnits')}
                  value={count(
                    (inventoryData?.byStatus.reserved ?? 0) + (inventoryData?.byStatus.held ?? 0),
                  )}
                  loading={inventory.state.kind === 'loading'}
                  link={link('/units?status=reserved', t('dashboard.openList'))}
                />
                <MetricCard
                  icon={FileSignature}
                  label={t('dashboard.contractedUnits')}
                  value={count(inventoryData?.byStatus.contracted)}
                  loading={inventory.state.kind === 'loading'}
                  link={link('/units?status=contracted', t('dashboard.openList'))}
                />
              </KpiGrid>
            </Box>
          </Section>
        ) : null}

        {/* 6 — Marketing (demonstration figures, stated as such) */}
        {canMarketing ? (
          <Section title={t('dashboard.sections.marketing')}>
            <SectionCard
              title={t('dashboard.marketingSpend')}
              icon={Megaphone}
              headingLevel={3}
              actions={<DemoBadge label={t('marketing.localDraftOnly')} />}
              description={t('dashboard.marketingDemo')}
            >
              {marketing.state.kind === 'loading' ? (
                <ChartSkeleton />
              ) : (
                <CategoryBarChart
                  caption={t('dashboard.marketingSpend')}
                  data={(marketingData?.byPlatform ?? []).map((row) => ({
                    key: row.platform,
                    label: enumLabel('campaignPlatform', row.platform),
                    value: Number(row.spend.amount),
                    display: format.money(row.spend, 0),
                  }))}
                  headers={{
                    category: t('dashboard.headers.platform'),
                    value: t('dashboard.headers.amount'),
                  }}
                  emptyLabel={t('states.emptyDescription')}
                  multicolour
                />
              )}
            </SectionCard>
          </Section>
        ) : null}

        {/* 7 — Team */}
        {canLeads && (crmData?.byOwner.length ?? 0) > 0 ? (
          <Section title={t('dashboard.sections.team')}>
            <SectionCard title={t('dashboard.ownerPerformance')} icon={Users} headingLevel={3}>
              <CategoryBarChart
                caption={t('dashboard.ownerPerformance')}
                data={(crmData?.byOwner ?? []).map((owner) => ({
                  key: owner.accountId,
                  label: personLabel(owner.accountId),
                  value: owner.total,
                  display: t('dashboard.wonOfTotal', {
                    won: format.number(owner.won),
                    total: format.number(owner.total),
                  }),
                }))}
                headers={{
                  category: t('dashboard.headers.representative'),
                  value: t('dashboard.headers.count'),
                }}
                emptyLabel={t('states.emptyDescription')}
              />
            </SectionCard>
          </Section>
        ) : null}
      </Box>
    </Box>
  );
}

/* --------------------------------------------------------------- layout bits */

const twoColumns = {
  display: 'grid',
  gap: 2,
  gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
  alignItems: 'stretch',
} as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" aria-label={title}>
      <Typography
        component="h2"
        sx={{ fontSize: '1rem', fontWeight: 700, marginBlockEnd: 1.5, color: 'text.primary' }}
      >
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function KpiGrid({ children, min = 220 }: { children: ReactNode; min?: number }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`,
        alignContent: 'start',
      }}
    >
      {children}
    </Box>
  );
}

/* ----------------------------------------------------------- attention centre */

interface AttentionItem {
  key: string;
  icon: LucideIcon;
  tone: 'danger' | 'warning' | 'info';
  label: string;
  count: string | undefined;
  active: boolean;
  to: string;
  loading: boolean;
}

const TONE_COLOURS = {
  danger: { fg: tokens.error, bg: tokens.errorSoft },
  warning: { fg: tokens.warning, bg: tokens.warningSoft },
  info: { fg: tokens.info, bg: tokens.infoSoft },
} as const;

/**
 * What needs someone today. Only items with something in them are listed; the rest are summarised as
 * "nothing needs your attention", so a quiet day reads as a quiet day rather than a wall of zeroes.
 * Every row links to the list behind it, filtered by the server to the person's scope.
 */
function AttentionCentre({ items }: { items: AttentionItem[] }) {
  const { t } = useLocale();
  const loading = items.some((item) => item.loading);
  const active = items.filter((item) => item.active);

  return (
    <SectionCard title={t('dashboard.sections.attention')} icon={AlarmClock} flush>
      {active.length === 0 ? (
        loading ? (
          <Box sx={{ padding: 2.5 }}>
            <ChartSkeleton />
          </Box>
        ) : (
          <StateView
            variant="inline"
            kind="success"
            title={t('dashboard.attention.allClear')}
            description={t('dashboard.attention.allClearHint')}
          />
        )
      ) : (
        <Box
          component="ul"
          sx={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
          }}
        >
          {active.map((item) => (
            <Box
              component="li"
              key={item.key}
              sx={{ borderBlockEnd: 1, borderColor: tokens.borderSoft }}
            >
              <Box
                component={RouterLink}
                to={item.to}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  paddingInline: 2.5,
                  paddingBlock: 1.5,
                  color: 'text.primary',
                  textDecoration: 'none',
                  minBlockSize: 56,
                  '&:hover': { bgcolor: tokens.neutralSoft },
                  '&:focus-visible': { outlineOffset: -3 },
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    display: 'grid',
                    placeItems: 'center',
                    inlineSize: 36,
                    blockSize: 36,
                    borderRadius: 2,
                    flexShrink: 0,
                    color: TONE_COLOURS[item.tone].fg,
                    backgroundColor: TONE_COLOURS[item.tone].bg,
                  }}
                >
                  <Icon icon={item.icon} size={18} />
                </Box>
                <Typography variant="body2" sx={{ flexGrow: 1, fontWeight: 600 }}>
                  {item.label}
                </Typography>
                <Box
                  component="span"
                  sx={{
                    minInlineSize: 32,
                    paddingInline: 1,
                    blockSize: 24,
                    display: 'inline-grid',
                    placeItems: 'center',
                    borderRadius: 999,
                    fontSize: '0.8125rem',
                    fontWeight: 700,
                    color: TONE_COLOURS[item.tone].fg,
                    backgroundColor: TONE_COLOURS[item.tone].bg,
                  }}
                >
                  <bdi dir="ltr">{item.count}</bdi>
                </Box>
                <Box sx={{ color: 'text.secondary', display: 'inline-flex' }}>
                  <Icon icon={ChevronRight} size={16} mirrorInRtl />
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </SectionCard>
  );
}
