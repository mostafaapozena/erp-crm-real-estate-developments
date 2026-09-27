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
  OrgLifecycleChangeSchema,
  PlacementHistoryListSchema,
  PlacementLifecycleSchema,
  ReportingLineSchema,
  TransferPlacementSchema,
  UpdateBranchSchema,
  UpdateDepartmentSchema,
  UpdateJobTitleSchema,
  UpdateLegalEntitySchema,
  UpdateTeamSchema,
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
  UpdateLegalEntityRequest: UpdateLegalEntitySchema,
  UpdateBranchRequest: UpdateBranchSchema,
  UpdateDepartmentRequest: UpdateDepartmentSchema,
  UpdateTeamRequest: UpdateTeamSchema,
  UpdateJobTitleRequest: UpdateJobTitleSchema,
  OrgLifecycleChangeRequest: OrgLifecycleChangeSchema,
  TransferPlacementRequest: TransferPlacementSchema,
  PlacementLifecycleRequest: PlacementLifecycleSchema,
  PlacementHistoryList: PlacementHistoryListSchema,
  ReportingLine: ReportingLineSchema,
} as const;

const SCOPE_NOTE =
  "Results are constrained by the actor's data scope inside the query, so counts and totals are " +
  'constrained too (SEC-028).';

const MANAGE_NOTE =
  'Requires the administrative org.manage permission: the hierarchy is what every data scope resolves ' +
  'against, so changing it is an authorization change (SEC-026). Audited with a before/after summary. ' +
  "The parent must be active and inside the actor's data scope (CORE-ORG-002, CORE-ORG-004); legal " +
  'entities and job titles are deployment-wide and need the all scope.';

/** Units with an update and a lifecycle, and their path segment. */
const UNITS = [
  { segment: 'legal-entities', name: 'LegalEntity', noun: 'legal entity' },
  { segment: 'branches', name: 'Branch', noun: 'branch' },
  { segment: 'departments', name: 'Department', noun: 'department' },
  { segment: 'teams', name: 'Team', noun: 'team' },
  { segment: 'job-titles', name: 'JobTitle', noun: 'job title' },
] as const;

const BLOCKERS: Record<(typeof UNITS)[number]['segment'], string> = {
  'legal-entities': 'an active branch',
  branches: 'an active department',
  departments: 'an active team or placement',
  teams: 'an active placement',
  'job-titles': 'an active placement holding it',
};

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
    ...Object.fromEntries(
      UNITS.flatMap((unit): [string, Record<string, unknown>][] => [
        [
          `/api/v1/organization/${unit.segment}/{id}`,
          {
            patch: {
              operationId: `update${unit.name}`,
              summary: `Change a ${unit.noun}: its editable fields only`,
              description:
                `${MANAGE_NOTE} The code and the parent never change, and neither does a legal ` +
                "entity's currency. An empty body is refused (NOTHING_TO_UPDATE). Outside the scope " +
                'the answer is 404, identical to an absent record (SEC-030).',
              parameters: [pathParameter('id', `Opaque ${unit.noun} identifier`)],
              requestBody: requestBody(h.ref(`Update${unit.name}Request`)),
              responses: {
                '200': h.json(unit.name, `The updated ${unit.noun}`),
                ...h.conflictErrors,
              },
            },
          },
        ],
        ...(['deactivate', 'reactivate'] as const).map(
          (change): [string, Record<string, unknown>] => [
            `/api/v1/organization/${unit.segment}/{id}/${change}`,
            {
              post: {
                operationId: `${change}${unit.name}`,
                summary: `${change === 'deactivate' ? 'Deactivate' : 'Reactivate'} a ${unit.noun}`,
                description:
                  change === 'deactivate'
                    ? `${MANAGE_NOTE} Refused with CONFLICT (ACTIVE_CHILDREN) while it has ` +
                      `${BLOCKERS[unit.segment]}. Nothing is ever deleted (ADR-0009).`
                    : `${MANAGE_NOTE} Refused with CONFLICT (PARENT_INACTIVE) while its parent is ` +
                      'inactive.',
                parameters: [pathParameter('id', `Opaque ${unit.noun} identifier`)],
                requestBody: requestBody(h.ref('OrgLifecycleChangeRequest')),
                responses: { '200': h.json(unit.name, `The ${unit.noun}`), ...h.conflictErrors },
              },
            },
          ],
        ),
      ]),
    ),
    '/api/v1/organization/placements/{placementId}': {
      get: {
        operationId: 'getPlacement',
        summary: 'One placement',
        description: `Requires org.placement.view. ${SCOPE_NOTE}`,
        parameters: [pathParameter('placementId', 'Opaque placement identifier')],
        responses: { '200': h.json('Placement', 'The placement'), ...h.notFoundErrors },
      },
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
    '/api/v1/organization/placements/{placementId}/history': {
      get: {
        operationId: 'getPlacementHistory',
        summary: "A placement's append-only history, newest first",
        description:
          'Requires org.placement.view. Every creation, update, transfer, deactivation and ' +
          'reactivation, with its effective date and the organization references before and after, ' +
          'never personal data (CORE-ORG-003).',
        parameters: [pathParameter('placementId', 'Opaque placement identifier')],
        responses: { '200': h.json('PlacementHistoryList', 'The history'), ...h.notFoundErrors },
      },
    },
    '/api/v1/organization/placements/{placementId}/reporting-line': {
      get: {
        operationId: 'getReportingLine',
        summary: 'The placement and the managers above it, nearest first',
        description:
          'Requires org.placement.view. The walk stops, marked interrupted, at a manager who is ' +
          "inactive, not yet effective, or outside the actor's scope: a line the actor may not see " +
          'is not revealed by walking up to it (CORE-ORG-005).',
        parameters: [pathParameter('placementId', 'Opaque placement identifier')],
        responses: { '200': h.json('ReportingLine', 'The reporting line'), ...h.notFoundErrors },
      },
    },
    '/api/v1/organization/placements/{placementId}/transfer': {
      post: {
        operationId: 'transferPlacement',
        summary: 'Move a placement to another department from a date',
        description:
          'Requires org.placement.manage. The legal entity and branch follow the destination ' +
          "department, which must be active and inside the actor's scope; a team must belong to it. " +
          'Without a team the placement leaves its old team. Recorded in the history with the reason.',
        parameters: [pathParameter('placementId', 'Opaque placement identifier')],
        requestBody: requestBody(h.ref('TransferPlacementRequest')),
        responses: { '200': h.json('Placement', 'The transferred placement'), ...h.conflictErrors },
      },
    },
    ...Object.fromEntries(
      (['deactivate', 'reactivate'] as const).map((change): [string, Record<string, unknown>] => [
        `/api/v1/organization/placements/{placementId}/${change}`,
        {
          post: {
            operationId: `${change}Placement`,
            summary:
              change === 'deactivate'
                ? 'End a placement from a date (default today)'
                : 'Resume an ended placement',
            description:
              change === 'deactivate'
                ? 'Requires org.placement.manage. Sets endedOn; people who reported to it keep the ' +
                  'reference, so their escalations report unresolved until they have a new manager.'
                : 'Requires org.placement.manage. Its department, team and job title must still be ' +
                  'active, and the account may hold only one active placement (ACCOUNT_ALREADY_PLACED).',
            parameters: [pathParameter('placementId', 'Opaque placement identifier')],
            requestBody: requestBody(h.ref('PlacementLifecycleRequest')),
            responses: { '200': h.json('Placement', 'The placement'), ...h.conflictErrors },
          },
        },
      ]),
    ),
  };
}
