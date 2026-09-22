import {
  BuildingListSchema,
  BuildingSchema,
  ChangeUnitStatusSchema,
  CreateBuildingSchema,
  CreateProjectSchema,
  CreateUnitSchema,
  InventorySummarySchema,
  PROJECT_STATUSES,
  PROPERTY_TYPES,
  ProjectListSchema,
  ProjectSchema,
  UNIT_PAGE_SIZE_DEFAULT,
  UNIT_PAGE_SIZE_MAX,
  UNIT_STATUSES,
  USAGE_TYPES,
  UnitEventListSchema,
  UnitEventSchema,
  UnitPageSchema,
  UnitSchema,
} from '@alola/contracts';
import {
  pathParameter,
  queryParameter,
  requestBody,
  type OpenApiHelpers,
  type PathMap,
} from './shared';

export const inventoryComponents = {
  Project: ProjectSchema,
  ProjectList: ProjectListSchema,
  CreateProjectRequest: CreateProjectSchema,
  Building: BuildingSchema,
  BuildingList: BuildingListSchema,
  CreateBuildingRequest: CreateBuildingSchema,
  Unit: UnitSchema,
  UnitPage: UnitPageSchema,
  CreateUnitRequest: CreateUnitSchema,
  ChangeUnitStatusRequest: ChangeUnitStatusSchema,
  UnitEvent: UnitEventSchema,
  UnitEventList: UnitEventListSchema,
  InventorySummary: InventorySummarySchema,
} as const;

const PRICING_NOTE =
  'Price fields are present only for an actor holding inventory.unit.viewPricing; otherwise they are ' +
  '**absent**, not null and not masked, on the list, the single read and every other serialization ' +
  'path (SEC-029).';

export function inventoryPaths(h: OpenApiHelpers): PathMap {
  return {
    '/api/v1/inventory/projects': {
      get: {
        operationId: 'listProjects',
        summary: 'List projects',
        description:
          "Requires inventory.project.view. Constrained by the actor's data scope inside the query.",
        parameters: [queryParameter('status', { type: 'string', enum: [...PROJECT_STATUSES] })],
        responses: { '200': h.json('ProjectList', 'Projects'), ...h.authorizedErrors },
      },
      post: {
        operationId: 'createProject',
        summary: 'Create a project',
        description:
          'Requires inventory.project.manage. The legal entity is taken from the named branch, never ' +
          'from the request body. A duplicate project code is a conflict.',
        requestBody: requestBody(h.ref('CreateProjectRequest')),
        responses: { '201': h.json('Project', 'The project'), ...h.conflictErrors },
      },
    },
    '/api/v1/inventory/projects/{projectId}': {
      get: {
        operationId: 'getProject',
        summary: 'Read one project',
        description:
          'Requires inventory.project.view. A project outside the scope answers 404, identically to ' +
          'one that does not exist (SEC-030).',
        parameters: [pathParameter('projectId', 'Opaque project identifier')],
        responses: { '200': h.json('Project', 'The project'), ...h.notFoundErrors },
      },
    },
    '/api/v1/inventory/buildings': {
      get: {
        operationId: 'listBuildings',
        summary: 'List buildings',
        description: 'Requires inventory.project.view.',
        parameters: [queryParameter('projectId', { type: 'string' })],
        responses: { '200': h.json('BuildingList', 'Buildings'), ...h.authorizedErrors },
      },
      post: {
        operationId: 'createBuilding',
        summary: 'Create a building',
        description:
          'Requires inventory.project.manage. Placement is inherited from the project. A building ' +
          'code is unique within its project.',
        requestBody: requestBody(h.ref('CreateBuildingRequest')),
        responses: { '201': h.json('Building', 'The building'), ...h.conflictErrors },
      },
    },
    '/api/v1/inventory/units': {
      get: {
        operationId: 'listUnits',
        summary: 'List units with keyset pagination',
        description:
          `Requires inventory.unit.view. ${PRICING_NOTE} Ordering is code asc, unitId asc, so pages ` +
          'never repeat or skip a row. The total is computed with the same filter as the rows, so it ' +
          'can never count an out-of-scope unit (SEC-028). The code filter is an anchored prefix ' +
          'match on an escaped literal, never a caller-supplied regular expression.',
        parameters: [
          queryParameter('limit', {
            type: 'integer',
            minimum: 1,
            maximum: UNIT_PAGE_SIZE_MAX,
            default: UNIT_PAGE_SIZE_DEFAULT,
          }),
          queryParameter('cursor', { type: 'string' }),
          queryParameter('projectId', { type: 'string' }),
          queryParameter('buildingId', { type: 'string' }),
          queryParameter('status', { type: 'string', enum: [...UNIT_STATUSES] }),
          queryParameter('propertyType', { type: 'string', enum: [...PROPERTY_TYPES] }),
          queryParameter('usageType', { type: 'string', enum: [...USAGE_TYPES] }),
          queryParameter('floor', { type: 'integer' }),
          queryParameter('code', { type: 'string' }, 'Anchored prefix match on the unit code'),
        ],
        responses: { '200': h.json('UnitPage', 'A page of units'), ...h.authorizedErrors },
      },
      post: {
        operationId: 'createUnit',
        summary: 'Create a unit',
        description:
          'Requires inventory.unit.manage. The price per square metre is **derived** from the current ' +
          'price and the area and cannot be supplied. A price in a currency other than the project’s ' +
          'is refused rather than converted. A new unit starts available.',
        requestBody: requestBody(h.ref('CreateUnitRequest')),
        responses: { '201': h.json('Unit', 'The unit'), ...h.conflictErrors },
      },
    },
    '/api/v1/inventory/units/summary': {
      get: {
        operationId: 'getInventorySummary',
        summary: 'Availability counts by status and usage type',
        description:
          'Requires inventory.unit.view. The scope filter is the first aggregation stage, so the ' +
          'counts are constrained by exactly the condition that constrains the rows (SEC-028).',
        parameters: [queryParameter('projectId', { type: 'string' })],
        responses: {
          '200': h.json('InventorySummary', 'Counts within the scope'),
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/inventory/units/{unitId}': {
      get: {
        operationId: 'getUnit',
        summary: 'Read one unit',
        description: `Requires inventory.unit.view. ${PRICING_NOTE}`,
        parameters: [pathParameter('unitId', 'Opaque unit identifier')],
        responses: { '200': h.json('Unit', 'The unit'), ...h.notFoundErrors },
      },
    },
    '/api/v1/inventory/units/{unitId}/history': {
      get: {
        operationId: 'listUnitEvents',
        summary: "A unit's business timeline",
        description:
          'Requires inventory.unit.view, and the unit itself must be visible. Append-only and ' +
          'separate from the audit trail: this is what a sales person reads on the unit page, while ' +
          'the audit trail is the security record an investigator reads.',
        parameters: [pathParameter('unitId', 'Opaque unit identifier')],
        responses: { '200': h.json('UnitEventList', 'The timeline'), ...h.notFoundErrors },
      },
    },
    '/api/v1/inventory/units/{unitId}/status': {
      post: {
        operationId: 'changeUnitStatus',
        summary: 'Withdraw a unit from sale, or return it',
        description:
          'Requires inventory.unit.manage. The update is conditional on the status that was read, so ' +
          'two simultaneous attempts cannot both succeed — the second is told the transition is ' +
          'refused and changes nothing. A move the state machine does not permit is refused and the ' +
          'attempt is audited. Reserving and contracting are **not** done here: those belong to the ' +
          'reservation and contract workflows, which move the unit inside their own transaction.',
        parameters: [pathParameter('unitId', 'Opaque unit identifier')],
        requestBody: requestBody(h.ref('ChangeUnitStatusRequest')),
        responses: { '200': h.json('Unit', 'The updated unit'), ...h.conflictErrors },
      },
    },
  };
}
