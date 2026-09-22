import {
  BranchListSchema,
  BranchSchema,
  CreateBranchSchema,
  CreateDepartmentSchema,
  CreateJobTitleSchema,
  CreateLegalEntitySchema,
  CreatePlacementSchema,
  CreateTeamSchema,
  DepartmentListSchema,
  DepartmentSchema,
  JobTitleListSchema,
  JobTitleSchema,
  LegalEntityListSchema,
  LegalEntitySchema,
  OrgChartSchema,
  PlacementListSchema,
  PlacementSchema,
  TeamListSchema,
  TeamSchema,
  UpdatePlacementSchema,
} from '@alola/contracts';
import {
  pathParameter,
  queryParameter,
  requestBody,
  type OpenApiHelpers,
  type PathMap,
} from './shared';

/** Schemas this domain contributes to `components.schemas`. */
export const organizationComponents = {
  LegalEntity: LegalEntitySchema,
  LegalEntityList: LegalEntityListSchema,
  CreateLegalEntityRequest: CreateLegalEntitySchema,
  Branch: BranchSchema,
  BranchList: BranchListSchema,
  CreateBranchRequest: CreateBranchSchema,
  Department: DepartmentSchema,
  DepartmentList: DepartmentListSchema,
  CreateDepartmentRequest: CreateDepartmentSchema,
  Team: TeamSchema,
  TeamList: TeamListSchema,
  CreateTeamRequest: CreateTeamSchema,
  JobTitle: JobTitleSchema,
  JobTitleList: JobTitleListSchema,
  CreateJobTitleRequest: CreateJobTitleSchema,
  Placement: PlacementSchema,
  PlacementList: PlacementListSchema,
  CreatePlacementRequest: CreatePlacementSchema,
  UpdatePlacementRequest: UpdatePlacementSchema,
  OrgChart: OrgChartSchema,
} as const;

const SCOPE_NOTE =
  "Results are constrained by the actor's data scope inside the query, so counts and totals are " +
  'constrained too (SEC-028).';

const MANAGE_NOTE =
  'Requires the administrative org.manage permission: the hierarchy is what every data scope resolves ' +
  'against, so changing it is an authorization change (SEC-026). Audited with a before/after summary.';

export function organizationPaths(h: OpenApiHelpers): PathMap {
  const listEndpoint = (
    operationId: string,
    summary: string,
    component: string,
  ): Record<string, unknown> => ({
    get: {
      operationId,
      summary,
      description: `Requires org.view. ${SCOPE_NOTE}`,
      responses: { '200': h.json(component, summary), ...h.authorizedErrors },
    },
  });

  const createEndpoint = (
    operationId: string,
    summary: string,
    bodyComponent: string,
    resultComponent: string,
  ): Record<string, unknown> => ({
    post: {
      operationId,
      summary,
      description: MANAGE_NOTE,
      requestBody: requestBody(h.ref(bodyComponent)),
      responses: {
        '201': h.json(resultComponent, 'The created record'),
        ...h.conflictErrors,
      },
    },
  });

  return {
    '/api/v1/organization/chart': {
      get: {
        operationId: 'getOrgChart',
        summary: 'The whole visible organization tree in one response',
        description:
          'Requires org.view and org.placement.view for the placements it contains. ' +
          `${SCOPE_NOTE} Intended for an organization screen and for assignment pickers, which need ` +
          'exactly the same data.',
        responses: { '200': h.json('OrgChart', 'The organization tree'), ...h.authorizedErrors },
      },
    },
    '/api/v1/organization/legal-entities': {
      ...listEndpoint('listLegalEntities', 'List legal entities', 'LegalEntityList'),
      ...createEndpoint(
        'createLegalEntity',
        'Create a legal entity',
        'CreateLegalEntityRequest',
        'LegalEntity',
      ),
    },
    '/api/v1/organization/branches': {
      ...listEndpoint('listBranches', 'List branches', 'BranchList'),
      ...createEndpoint('createBranch', 'Create a branch', 'CreateBranchRequest', 'Branch'),
    },
    '/api/v1/organization/departments': {
      ...listEndpoint('listDepartments', 'List departments', 'DepartmentList'),
      ...createEndpoint(
        'createDepartment',
        'Create a department',
        'CreateDepartmentRequest',
        'Department',
      ),
    },
    '/api/v1/organization/teams': {
      ...listEndpoint('listTeams', 'List teams', 'TeamList'),
      ...createEndpoint('createTeam', 'Create a team', 'CreateTeamRequest', 'Team'),
    },
    '/api/v1/organization/job-titles': {
      get: {
        operationId: 'listJobTitles',
        summary: 'List job titles',
        description:
          'Requires org.view. Job titles carry no organization placement, so they are vocabulary ' +
          'rather than scoped records and are not filtered by data scope.',
        responses: { '200': h.json('JobTitleList', 'Job titles'), ...h.authorizedErrors },
      },
      ...createEndpoint(
        'createJobTitle',
        'Create a job title',
        'CreateJobTitleRequest',
        'JobTitle',
      ),
    },
    '/api/v1/organization/placements': {
      get: {
        operationId: 'listPlacements',
        summary: 'List organization placements',
        description:
          `Requires org.placement.view. ${SCOPE_NOTE} A placement holds an opaque security-account ` +
          'reference and an opaque future employee reference; it is not an employee record (ADR-0019).',
        parameters: [
          queryParameter('status', { type: 'string', enum: ['active', 'inactive'] }),
          queryParameter('departmentId', { type: 'string' }),
          queryParameter('teamId', { type: 'string' }),
        ],
        responses: { '200': h.json('PlacementList', 'Placements'), ...h.authorizedErrors },
      },
      post: {
        operationId: 'createPlacement',
        summary: 'Place a person in the organization',
        description:
          'Requires the administrative org.placement.manage permission, because the reporting line ' +
          'decides where an overdue approval escalates (APPROVAL-005). A reporting cycle is refused ' +
          'before anything is written.',
        requestBody: requestBody(h.ref('CreatePlacementRequest')),
        responses: { '201': h.json('Placement', 'The placement'), ...h.conflictErrors },
      },
    },
    '/api/v1/organization/placements/{placementId}': {
      patch: {
        operationId: 'updatePlacement',
        summary: 'Change a placement, its team, its job title, or its manager',
        description:
          'Requires org.placement.manage. Setting the status to inactive is how a person leaves: ' +
          'placements are never deleted, because contracts and audit records already reference them ' +
          '(ADR-0009). A reporting cycle is refused.',
        parameters: [pathParameter('placementId', 'Opaque placement identifier')],
        requestBody: requestBody(h.ref('UpdatePlacementRequest')),
        responses: { '200': h.json('Placement', 'The updated placement'), ...h.conflictErrors },
      },
    },
  };
}
