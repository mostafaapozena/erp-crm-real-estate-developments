import type { OrgChart } from '@alola/contracts';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  DataTable,
  Icon,
  MetricCard,
  PageHeader,
  SectionCard,
  StateView,
  StatusChip,
  TableToolbar,
  tokens,
  type DataColumn,
} from '@alola/ui';
import { Briefcase, Building, Building2, Landmark, Network, Users } from '@alola/ui/icons';
import { useMemo, useState } from 'react';
import { useApi } from '../api/useApi';
import { initialsOf } from '../branding';
import { useLocale } from '../locale';
import {
  ErrorState,
  FilterSelect,
  ListSearch,
  RequirePermission,
  Verbatim,
  useTableLabels,
} from './shared';

type Placement = OrgChart['placements'][number];

/**
 * The organization: the structure, and who reports to whom.
 *
 * Three levels of reading, top to bottom: the legal entity (the company as it is registered), the
 * branches with their departments and teams and how many people are placed in each, and the people
 * directory with job titles and reporting lines.
 *
 * These are **placements** — the organization directory — not security accounts and not employee
 * records (ADR-0019). The screen shows no login identifier, permission or HR field, and joins nothing
 * from those aggregates.
 *
 * The reporting line is shown because it is not decoration — it is what an overdue approval escalates
 * along (`APPROVAL-005`). A person with no manager is stated plainly rather than left blank, because
 * "no manager" and "not loaded" look identical otherwise and only one of them means an escalation
 * will go nowhere. Everything is scoped by the server: a branch-scoped reader sees their branch.
 */
export default function OrganizationPage() {
  return (
    <RequirePermission permission="org.view">
      <OrganizationScreen />
    </RequirePermission>
  );
}

function OrganizationScreen() {
  const { t, locale } = useLocale();
  const labels = useTableLabels();
  const chart = useApi<OrgChart>('/api/v1/organization/chart');
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');

  const data = chart.state.kind === 'ready' ? chart.state.data : undefined;

  const lookups = useMemo(() => {
    const name = <T extends { name: { ar: string; en: string } }>(item: T) => item.name[locale];
    return {
      placements: new Map((data?.placements ?? []).map((p) => [p.placementId, p.displayName])),
      jobTitles: new Map((data?.jobTitles ?? []).map((j) => [j.jobTitleId, name(j)])),
      departments: new Map((data?.departments ?? []).map((d) => [d.departmentId, name(d)])),
      teams: new Map((data?.teams ?? []).map((team) => [team.teamId, name(team)])),
    };
  }, [data, locale]);

  const headcount = useMemo(() => {
    const byDepartment = new Map<string, number>();
    const byTeam = new Map<string, number>();
    const byBranch = new Map<string, number>();
    for (const placement of data?.placements ?? []) {
      byDepartment.set(placement.departmentId, (byDepartment.get(placement.departmentId) ?? 0) + 1);
      byBranch.set(placement.branchId, (byBranch.get(placement.branchId) ?? 0) + 1);
      if (placement.teamId) byTeam.set(placement.teamId, (byTeam.get(placement.teamId) ?? 0) + 1);
    }
    return { byDepartment, byTeam, byBranch };
  }, [data]);

  const columns = useMemo<DataColumn<Placement>[]>(
    () => [
      {
        key: 'name',
        header: t('fields.name'),
        render: (row) => (
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
            <Avatar aria-hidden sx={{ inlineSize: 28, blockSize: 28, fontSize: '0.75rem' }}>
              {initialsOf(row.displayName)}
            </Avatar>
            <Box component="span" sx={{ fontWeight: 600 }}>
              {row.displayName}
            </Box>
          </Box>
        ),
      },
      {
        key: 'jobTitle',
        header: t('organization.jobTitle'),
        render: (row) => lookups.jobTitles.get(row.jobTitleId) ?? '—',
      },
      {
        key: 'department',
        header: t('fields.department'),
        render: (row) => lookups.departments.get(row.departmentId) ?? '—',
      },
      {
        key: 'team',
        header: t('organization.team'),
        render: (row) => (row.teamId ? (lookups.teams.get(row.teamId) ?? '—') : '—'),
        secondary: true,
      },
      {
        key: 'manager',
        header: t('organization.manager'),
        render: (row) =>
          row.managerPlacementId ? (
            (lookups.placements.get(row.managerPlacementId) ?? '—')
          ) : (
            <StatusChip tone="neutral" label={t('organization.noManager')} />
          ),
      },
    ],
    [lookups, t],
  );

  if (chart.state.kind === 'loading') {
    return <StateView kind="loading" title={t('states.loadingTitle')} />;
  }
  if (chart.state.kind === 'error') {
    return <ErrorState error={chart.state.error} onRetry={chart.reload} />;
  }
  const org = chart.state.data;
  const needle = search.trim().toLowerCase();
  const people = org.placements.filter(
    (placement) =>
      (!departmentFilter || placement.departmentId === departmentFilter) &&
      (!needle || placement.displayName.toLowerCase().includes(needle)),
  );

  return (
    <Box>
      <PageHeader title={t('organization.title')} subtitle={t('organization.subtitle')} />

      <Stack spacing={3}>
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          }}
        >
          <MetricCard
            icon={Landmark}
            label={t('organization.legalEntities')}
            value={String(org.legalEntities.length)}
          />
          <MetricCard
            icon={Building2}
            label={t('organization.branches')}
            value={String(org.branches.length)}
          />
          <MetricCard
            icon={Building}
            label={t('organization.departments')}
            value={String(org.departments.length)}
          />
          <MetricCard
            icon={Network}
            label={t('organization.teams')}
            value={String(org.teams.length)}
          />
          <MetricCard
            icon={Users}
            label={t('organization.placements')}
            value={String(org.placements.length)}
          />
        </Box>

        <SectionCard title={t('organization.structure')} icon={Network}>
          {org.legalEntities.length === 0 && org.branches.length === 0 ? (
            <StateView
              variant="inline"
              kind="empty"
              title={t('organization.nothingInScope')}
              description={t('organization.nothingInScopeHint')}
            />
          ) : (
            <Stack spacing={2.5}>
              {org.legalEntities.map((entity) => (
                <Box
                  key={entity.legalEntityId}
                  sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}
                >
                  <Box
                    aria-hidden
                    sx={{
                      display: 'grid',
                      placeItems: 'center',
                      inlineSize: 40,
                      blockSize: 40,
                      borderRadius: 2,
                      bgcolor: 'primary.main',
                      color: 'primary.contrastText',
                      flexShrink: 0,
                    }}
                  >
                    <Icon icon={Landmark} size={20} />
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography component="h3" sx={{ fontWeight: 700, fontSize: '1rem' }}>
                      {entity.name[locale]}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      <Verbatim>{`${entity.code} · ${entity.currency} · ${entity.timeZone}`}</Verbatim>
                    </Typography>
                  </Box>
                </Box>
              ))}

              <Box
                sx={{
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                }}
              >
                {org.branches.map((branch) => {
                  const departments = org.departments.filter(
                    (department) => department.branchId === branch.branchId,
                  );
                  return (
                    <Paper
                      key={branch.branchId}
                      variant="outlined"
                      sx={{ padding: 2, boxShadow: 'none', minWidth: 0 }}
                      component="section"
                      aria-label={branch.name[locale]}
                    >
                      <Box
                        sx={{ display: 'flex', alignItems: 'center', gap: 1, marginBlockEnd: 1.5 }}
                      >
                        <Box sx={{ color: 'text.secondary', display: 'inline-flex' }}>
                          <Icon icon={Building2} size={18} />
                        </Box>
                        <Typography component="h3" sx={{ fontWeight: 700, flexGrow: 1 }}>
                          {branch.name[locale]}
                        </Typography>
                        <StatusChip
                          tone="neutral"
                          label={t('organization.people', {
                            count: headcount.byBranch.get(branch.branchId) ?? 0,
                          })}
                        />
                      </Box>
                      <Typography variant="caption" color="text.secondary" component="p">
                        {branch.city[locale]}
                      </Typography>
                      <Box
                        component="ul"
                        sx={{ listStyle: 'none', margin: 0, padding: 0, marginBlockStart: 1.5 }}
                      >
                        {departments.map((department) => {
                          const teams = org.teams.filter(
                            (team) => team.departmentId === department.departmentId,
                          );
                          return (
                            <Box
                              component="li"
                              key={department.departmentId}
                              sx={{
                                paddingBlock: 1,
                                borderBlockStart: 1,
                                borderColor: tokens.borderSoft,
                              }}
                            >
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Box sx={{ color: 'text.secondary', display: 'inline-flex' }}>
                                  <Icon icon={Briefcase} size={16} />
                                </Box>
                                <Typography variant="body2" sx={{ fontWeight: 600, flexGrow: 1 }}>
                                  {department.name[locale]}
                                </Typography>
                                {department.costCenterCode ? (
                                  <Typography variant="caption" color="text.secondary">
                                    <Verbatim>{department.costCenterCode}</Verbatim>
                                  </Typography>
                                ) : null}
                                <Typography variant="caption" color="text.secondary">
                                  {t('organization.people', {
                                    count: headcount.byDepartment.get(department.departmentId) ?? 0,
                                  })}
                                </Typography>
                              </Box>
                              {teams.length > 0 ? (
                                <Box
                                  component="ul"
                                  sx={{
                                    listStyle: 'none',
                                    margin: 0,
                                    paddingInlineStart: 3.5,
                                    paddingBlockStart: 0.5,
                                  }}
                                >
                                  {teams.map((team) => (
                                    <Box
                                      component="li"
                                      key={team.teamId}
                                      sx={{
                                        display: 'flex',
                                        gap: 1,
                                        typography: 'body2',
                                        color: 'text.secondary',
                                      }}
                                    >
                                      <Box component="span" sx={{ flexGrow: 1 }}>
                                        {team.name[locale]}
                                      </Box>
                                      <span>
                                        {t('organization.people', {
                                          count: headcount.byTeam.get(team.teamId) ?? 0,
                                        })}
                                      </span>
                                    </Box>
                                  ))}
                                </Box>
                              ) : null}
                            </Box>
                          );
                        })}
                      </Box>
                    </Paper>
                  );
                })}
              </Box>
            </Stack>
          )}
        </SectionCard>

        <Box component="section" aria-label={t('organization.placements')}>
          <Typography
            component="h2"
            sx={{ fontSize: '1rem', fontWeight: 600, marginBlockEnd: 1.25 }}
          >
            {t('organization.placements')}
          </Typography>
          <DataTable
            columns={columns}
            rows={people}
            rowKey={(row) => row.placementId}
            status="ready"
            caption={t('organization.placements')}
            labels={labels}
            filtered={Boolean(needle || departmentFilter)}
            toolbar={
              <TableToolbar
                search={<ListSearch value={search} onSubmit={setSearch} />}
                filters={
                  <FilterSelect
                    label={t('fields.department')}
                    value={departmentFilter}
                    onChange={setDepartmentFilter}
                    minWidth={200}
                    options={org.departments.map((department) => ({
                      value: department.departmentId,
                      label: department.name[locale],
                    }))}
                  />
                }
                summary={t('pagination.showing', {
                  shown: people.length,
                  total: org.placements.length,
                })}
              />
            }
          />
          <Typography variant="body2" color="text.secondary" sx={{ marginBlockStart: 1.5 }}>
            {t('organization.employeeNote')}
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
}
