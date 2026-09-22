import type { Building, InventorySummary, Project } from '@alola/contracts';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { MetricCard, PageHeader, StateView } from '@alola/ui';
import { Link } from 'react-router';
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
  Verbatim,
} from './shared';

/**
 * Projects, each with its buildings and a live availability summary.
 *
 * The summary comes from the inventory endpoint rather than being counted here, because it is scoped
 * inside the query: a project-scoped actor's "available" is the number they can actually sell.
 */
export default function ProjectsPage() {
  return (
    <RequirePermission permission="inventory.project.view">
      <ProjectsScreen />
    </RequirePermission>
  );
}

function ProjectsScreen() {
  const { t } = useLocale();
  const projects = useApi<{ items: Project[] }>('/api/v1/inventory/projects');
  const buildings = useApi<{ items: Building[] }>('/api/v1/inventory/buildings');

  if (projects.state.kind === 'loading') {
    return <StateView kind="loading" title={t('states.loadingTitle')} />;
  }
  if (projects.state.kind === 'error') {
    return <ErrorState error={projects.state.error} onRetry={projects.reload} />;
  }

  const items = projects.state.data.items;
  const buildingsByProject = new Map<string, Building[]>();
  if (buildings.state.kind === 'ready') {
    for (const building of buildings.state.data.items) {
      const list = buildingsByProject.get(building.projectId) ?? [];
      list.push(building);
      buildingsByProject.set(building.projectId, list);
    }
  }

  return (
    <Box>
      <PageHeader title={t('inventory.projectsTitle')} subtitle={t('inventory.projectsSubtitle')} />

      {items.length === 0 ? (
        <StateView
          kind="empty"
          title={t('states.emptyTitle')}
          description={t('states.emptyDescription')}
        />
      ) : (
        <Stack spacing={3}>
          {items.map((project) => (
            <ProjectCard
              key={project.projectId}
              project={project}
              buildings={buildingsByProject.get(project.projectId) ?? []}
            />
          ))}
        </Stack>
      )}
    </Box>
  );
}

function ProjectCard({ project, buildings }: { project: Project; buildings: Building[] }) {
  const { t, locale } = useLocale();
  const format = useFormatters();
  const summary = useApi<InventorySummary>(
    `/api/v1/inventory/units/summary?projectId=${project.projectId}`,
  );
  const data = summary.state.kind === 'ready' ? summary.state.data : undefined;

  return (
    <Panel
      title={locale === 'ar' ? project.name.ar : project.name.en}
      actions={
        <Button component={Link} to={`/units?projectId=${project.projectId}`} variant="outlined">
          {t('nav.units')}
        </Button>
      }
    >
      <Stack spacing={2}>
        <CardGrid min={180}>
          <Field label={t('fields.code')}>
            <Verbatim>{project.code}</Verbatim>
          </Field>
          <Field label={t('organization.city')}>
            {locale === 'ar' ? project.city.ar : project.city.en}
          </Field>
          <Field label={t('fields.status')}>
            <EnumChip
              namespace="projectStatus"
              value={project.status}
              tones={{
                planning: 'neutral',
                selling: 'success',
                onHold: 'warning',
                completed: 'info',
              }}
            />
          </Field>
          <Field label={t('fields.currency')}>
            <Verbatim>{project.currency}</Verbatim>
          </Field>
        </CardGrid>

        {project.description ? (
          <Typography color="text.secondary">
            {locale === 'ar' ? project.description.ar : project.description.en}
          </Typography>
        ) : null}

        <CardGrid min={160}>
          <MetricCard
            label={t('dashboard.totalUnits')}
            value={format.number(data?.total)}
            loading={summary.state.kind === 'loading'}
          />
          <MetricCard
            label={t('dashboard.availableUnits')}
            value={format.number(data?.byStatus.available ?? 0)}
            loading={summary.state.kind === 'loading'}
          />
          <MetricCard
            label={t('dashboard.reservedUnits')}
            value={format.number((data?.byStatus.reserved ?? 0) + (data?.byStatus.held ?? 0))}
            loading={summary.state.kind === 'loading'}
          />
          <MetricCard
            label={t('dashboard.contractedUnits')}
            value={format.number(data?.byStatus.contracted ?? 0)}
            loading={summary.state.kind === 'loading'}
          />
        </CardGrid>

        {buildings.length > 0 ? (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ marginBlockEnd: 1 }}>
              {t('fields.building')}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              {buildings.map((building) => (
                <Button
                  key={building.buildingId}
                  component={Link}
                  to={`/units?projectId=${project.projectId}`}
                  size="small"
                  variant="outlined"
                >
                  {locale === 'ar' ? building.name.ar : building.name.en}
                </Button>
              ))}
            </Stack>
          </Box>
        ) : null}
      </Stack>
    </Panel>
  );
}
