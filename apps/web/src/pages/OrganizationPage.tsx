import type { OrgChart } from '@alola/contracts';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { DataTable, PageHeader, StateView, type DataColumn } from '@alola/ui';
import { useMemo } from 'react';
import { useApi } from '../api/useApi';
import { useLocale } from '../locale';
import { ErrorState, Panel, RequirePermission, Verbatim } from './shared';

type Placement = OrgChart['placements'][number];

/**
 * The organization: the hierarchy, and who reports to whom.
 *
 * The reporting line is shown because it is not decoration — it is what an overdue approval escalates
 * along (`APPROVAL-005`). A person with no manager is stated plainly rather than left blank, because
 * "no manager" and "not loaded" look identical otherwise and only one of them means an escalation
 * will go nowhere.
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
  const chart = useApi<OrgChart>('/api/v1/organization/chart');

  const data = chart.state.kind === 'ready' ? chart.state.data : undefined;

  const names = useMemo(() => {
    const byId = new Map<string, string>();
    for (const placement of data?.placements ?? []) {
      byId.set(placement.placementId, placement.displayName);
    }
    return byId;
  }, [data]);

  const jobTitles = useMemo(() => {
    const byId = new Map<string, string>();
    for (const title of data?.jobTitles ?? []) {
      byId.set(title.jobTitleId, locale === 'ar' ? title.name.ar : title.name.en);
    }
    return byId;
  }, [data, locale]);

  const departments = useMemo(() => {
    const byId = new Map<string, string>();
    for (const department of data?.departments ?? []) {
      byId.set(department.departmentId, locale === 'ar' ? department.name.ar : department.name.en);
    }
    return byId;
  }, [data, locale]);

  const columns = useMemo<DataColumn<Placement>[]>(
    () => [
      { key: 'name', header: t('fields.name'), render: (row) => row.displayName },
      {
        key: 'jobTitle',
        header: t('organization.jobTitle'),
        render: (row) => jobTitles.get(row.jobTitleId) ?? '—',
      },
      {
        key: 'department',
        header: t('fields.department'),
        render: (row) => departments.get(row.departmentId) ?? '—',
      },
      {
        key: 'manager',
        header: t('organization.manager'),
        render: (row) =>
          row.managerPlacementId ? (
            (names.get(row.managerPlacementId) ?? '—')
          ) : (
            <Typography component="span" variant="body2" color="text.secondary">
              {t('organization.noManager')}
            </Typography>
          ),
      },
    ],
    [departments, jobTitles, names, t],
  );

  if (chart.state.kind === 'loading') {
    return <StateView kind="loading" title={t('states.loadingTitle')} />;
  }
  if (chart.state.kind === 'error') {
    return <ErrorState error={chart.state.error} onRetry={chart.reload} />;
  }

  return (
    <Box>
      <PageHeader title={t('organization.title')} subtitle={t('organization.subtitle')} />

      <Stack spacing={3}>
        <Panel title={t('organization.legalEntities')}>
          <Stack spacing={1}>
            {data?.legalEntities.map((entity) => (
              <Box key={entity.legalEntityId}>
                <Typography sx={{ fontWeight: 600 }}>
                  {locale === 'ar' ? entity.name.ar : entity.name.en}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  <Verbatim>{`${entity.code} · ${entity.currency} · ${entity.timeZone}`}</Verbatim>
                </Typography>
              </Box>
            ))}
          </Stack>
        </Panel>

        <Panel title={t('organization.branches')}>
          <Stack spacing={1}>
            {data?.branches.map((branch) => (
              <Box key={branch.branchId}>
                <Typography sx={{ fontWeight: 600 }}>
                  {locale === 'ar' ? branch.name.ar : branch.name.en}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {locale === 'ar' ? branch.city.ar : branch.city.en}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Panel>

        <Panel title={t('organization.departments')}>
          <Stack spacing={1}>
            {data?.departments.map((department) => (
              <Box key={department.departmentId}>
                <Typography sx={{ fontWeight: 600 }}>
                  {locale === 'ar' ? department.name.ar : department.name.en}
                </Typography>
                {department.costCenterCode ? (
                  <Typography variant="body2" color="text.secondary">
                    {`${t('organization.costCenter')}: `}
                    <Verbatim>{department.costCenterCode}</Verbatim>
                  </Typography>
                ) : null}
              </Box>
            ))}
          </Stack>
        </Panel>

        <Panel title={t('organization.placements')}>
          <DataTable
            columns={columns}
            rows={data?.placements ?? []}
            rowKey={(row) => row.placementId}
            status="ready"
            caption={t('organization.placements')}
            labels={{
              loadingTitle: t('states.loadingTitle'),
              emptyTitle: t('states.emptyTitle'),
              emptyDescription: t('states.emptyDescription'),
              errorTitle: t('states.errorTitle'),
              forbiddenTitle: t('states.forbiddenTitle'),
            }}
          />
          <Typography variant="body2" color="text.secondary" sx={{ marginBlockStart: 2 }}>
            {t('organization.employeeNote')}
          </Typography>
        </Panel>
      </Stack>
    </Box>
  );
}
