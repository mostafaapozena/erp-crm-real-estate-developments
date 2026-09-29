import {
  AvailabilityMatrixSchema,
  CreateHoldSchema,
  CreatePlanTemplateSchema,
  ExtendHoldSchema,
  HOLD_STATES,
  HoldListSchema,
  HoldSchema,
  PlanTemplateListSchema,
  PlanTemplatePreviewRequestSchema,
  PlanTemplatePreviewSchema,
  PlanTemplateSchema,
  PriceVersionListSchema,
  PriceVersionSchema,
  ProposePriceSchema,
  ReleaseHoldSchema,
  RetirePlanTemplateSchema,
  UnitComparisonSchema,
  UpdateBuildingSchema,
  UpdateProjectSchema,
  UpdateUnitSchema,
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
  UpdateProjectRequest: UpdateProjectSchema,
  UpdateBuildingRequest: UpdateBuildingSchema,
  UpdateUnitRequest: UpdateUnitSchema,
  AvailabilityMatrix: AvailabilityMatrixSchema,
  UnitComparison: UnitComparisonSchema,
  PriceVersion: PriceVersionSchema,
  PriceVersionList: PriceVersionListSchema,
  ProposePriceRequest: ProposePriceSchema,
  Hold: HoldSchema,
  HoldList: HoldListSchema,
  CreateHoldRequest: CreateHoldSchema,
  ReleaseHoldRequest: ReleaseHoldSchema,
  CancelPriceRequest: ReleaseHoldSchema,
  ExtendHoldRequest: ExtendHoldSchema,
  PlanTemplate: PlanTemplateSchema,
  PlanTemplateList: PlanTemplateListSchema,
  CreatePlanTemplateRequest: CreatePlanTemplateSchema,
  RetirePlanTemplateRequest: RetirePlanTemplateSchema,
  PlanTemplatePreviewRequest: PlanTemplatePreviewRequestSchema,
  PlanTemplatePreview: PlanTemplatePreviewSchema,
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
      patch: {
        operationId: 'updateProject',
        summary: "Edit a project's descriptive fields",
        description:
          'Requires inventory.project.manage (INV-PROJECT-001). States a reason and the version read ' +
          '(STALE_VERSION otherwise); code, branch and currency never change.',
        parameters: [pathParameter('projectId', 'Opaque project identifier')],
        requestBody: requestBody(h.ref('UpdateProjectRequest')),
        responses: { '200': h.json('Project', 'The project'), ...h.conflictErrors },
      },
    },
    '/api/v1/inventory/buildings/{buildingId}': {
      patch: {
        operationId: 'updateBuilding',
        summary: 'Edit a building',
        description:
          'Requires inventory.project.manage (INV-PROJECT-002). Floors may not fall below the highest ' +
          'unit (FLOOR_BELOW_UNITS).',
        parameters: [pathParameter('buildingId', 'Opaque building identifier')],
        requestBody: requestBody(h.ref('UpdateBuildingRequest')),
        responses: { '200': h.json('Building', 'The building'), ...h.conflictErrors },
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
          queryParameter('areaMin', { type: 'string' }, 'Square metres, inclusive'),
          queryParameter('areaMax', { type: 'string' }, 'Square metres, inclusive'),
          queryParameter(
            'priceMin',
            { type: 'string' },
            'Current price, inclusive. 403 PRICE_FILTER_NOT_PERMITTED without inventory.unit.viewPricing',
          ),
          queryParameter('priceMax', { type: 'string' }, 'Current price, inclusive'),
          queryParameter('bedrooms', { type: 'integer' }),
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
      patch: {
        operationId: 'updateUnit',
        summary: "Edit a unit's non-commercial attributes",
        description:
          'Requires inventory.unit.manage (INV-UNIT-001). Finishing, view, plan summary, outdoor areas, ' +
          'rooms, parking and storage — never code, floor, area, price or status. States a reason and ' +
          'the version read; recorded on the unit timeline.',
        parameters: [pathParameter('unitId', 'Opaque unit identifier')],
        requestBody: requestBody(h.ref('UpdateUnitRequest')),
        responses: { '200': h.json('Unit', 'The unit'), ...h.conflictErrors },
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
          "attempt is audited. Only available ↔ unavailable is a person's move (INV-STATUS-001): a " +
          'held, reserved or contracted unit is refused with STATUS_SET_BY_WORKFLOW, because its hold, ' +
          'reservation or contract moves it inside its own transaction.',
        parameters: [pathParameter('unitId', 'Opaque unit identifier')],
        requestBody: requestBody(h.ref('ChangeUnitStatusRequest')),
        responses: { '200': h.json('Unit', 'The updated unit'), ...h.conflictErrors },
      },
    },
    '/api/v1/inventory/projects/{projectId}/matrix': {
      get: {
        operationId: 'getAvailabilityMatrix',
        summary: 'The availability matrix of a project, building by building and floor by floor',
        description: `Requires inventory.unit.view (INV-SEARCH-002). Highest floor first; counts by status from the same scoped rows. ${PRICING_NOTE}`,
        parameters: [pathParameter('projectId', 'Opaque project identifier')],
        responses: { '200': h.json('AvailabilityMatrix', 'The matrix'), ...h.notFoundErrors },
      },
    },
    '/api/v1/inventory/units/compare': {
      get: {
        operationId: 'compareUnits',
        summary: 'Two to four units side by side',
        description: `Requires inventory.unit.view (INV-SEARCH-003). A unit outside the scope makes the whole answer 404. ${PRICING_NOTE}`,
        parameters: [
          queryParameter(
            'ids',
            { type: 'string' },
            'Two to four unit identifiers, comma-separated',
          ),
        ],
        responses: {
          '200': h.json('UnitComparison', 'The units, in the order asked'),
          ...h.notFoundErrors,
        },
      },
    },
    '/api/v1/inventory/units/{unitId}/prices': {
      get: {
        operationId: 'listUnitPrices',
        summary: "A unit's price versions, newest first",
        description: 'Requires inventory.unit.view and inventory.unit.viewPricing (INV-PRICE-001).',
        parameters: [pathParameter('unitId', 'Opaque unit identifier')],
        responses: { '200': h.json('PriceVersionList', 'The versions'), ...h.notFoundErrors },
      },
      post: {
        operationId: 'proposeUnitPrice',
        summary: 'Propose a new price from a date',
        description:
          'Requires inventory.price.propose and inventory.unit.viewPricing. Idempotent by key. The ' +
          'date is today or later (PRICE_DATE_IN_PAST); one open change per unit (PRICE_CHANGE_PENDING). ' +
          'Submitted to the approval engine as inventory.unit.priceChange; with a policy the version is ' +
          'pendingApproval and takes effect only when approved, without one it is scheduled and ' +
          'applied on its date — today at once (INV-PRICE-003). A version is never edited.',
        parameters: [pathParameter('unitId', 'Opaque unit identifier')],
        requestBody: requestBody(h.ref('ProposePriceRequest')),
        responses: { '201': h.json('PriceVersion', 'The version'), ...h.conflictErrors },
      },
    },
    '/api/v1/inventory/prices/{priceVersionId}/cancel': {
      post: {
        operationId: 'cancelUnitPrice',
        summary: 'Cancel a price version that has not taken effect',
        description:
          'Requires inventory.price.propose and inventory.unit.viewPricing. The record stays.',
        parameters: [pathParameter('priceVersionId', 'Opaque price version identifier')],
        requestBody: requestBody(h.ref('CancelPriceRequest')),
        responses: { '200': h.json('PriceVersion', 'The version'), ...h.conflictErrors },
      },
    },
    '/api/v1/inventory/holds': {
      get: {
        operationId: 'listHolds',
        summary: 'Timed holds inside the scope',
        description: 'Requires inventory.unit.view.',
        parameters: [
          queryParameter('state', { type: 'string', enum: [...HOLD_STATES] }),
          queryParameter('unitId', { type: 'string' }),
          queryParameter('projectId', { type: 'string' }),
          queryParameter('holderAccountId', { type: 'string' }),
          queryParameter('limit', { type: 'integer', minimum: 1, maximum: 100, default: 50 }),
        ],
        responses: { '200': h.json('HoldList', 'Holds'), ...h.authorizedErrors },
      },
      post: {
        operationId: 'createHold',
        summary: 'Hold an available unit for a customer',
        description:
          'Requires inventory.hold.create (INV-HOLD-001). Idempotent by key. The length is the setting ' +
          'sales.unitHoldHours (BD-29); not configured, every hold is refused with ' +
          'HOLD_DURATION_NOT_CONFIGURED. Two simultaneous holds on one unit: one wins, the other is ' +
          'UNIT_NOT_AVAILABLE.',
        requestBody: requestBody(h.ref('CreateHoldRequest')),
        responses: { '201': h.json('Hold', 'The hold'), ...h.conflictErrors },
      },
    },
    '/api/v1/inventory/holds/{holdId}': {
      get: {
        operationId: 'getHold',
        summary: 'Read one hold',
        description: 'Requires inventory.unit.view. Out of scope answers 404.',
        parameters: [pathParameter('holdId', 'Opaque hold identifier')],
        responses: { '200': h.json('Hold', 'The hold'), ...h.notFoundErrors },
      },
    },
    '/api/v1/inventory/holds/{holdId}/release': {
      post: {
        operationId: 'releaseHold',
        summary: 'Release a hold and return the unit to sale',
        description:
          'Requires inventory.hold.create, and the caller must hold it or have inventory.hold.manage ' +
          '(NOT_HOLDER otherwise). The unit returns only if this hold still holds it.',
        parameters: [pathParameter('holdId', 'Opaque hold identifier')],
        requestBody: requestBody(h.ref('ReleaseHoldRequest')),
        responses: { '200': h.json('Hold', 'The hold'), ...h.conflictErrors },
      },
    },
    '/api/v1/inventory/holds/{holdId}/extend': {
      post: {
        operationId: 'extendHold',
        summary: 'Extend a hold by the configured length',
        description:
          'Requires inventory.hold.create and holder or inventory.hold.manage (INV-HOLD-002). Through ' +
          'the approval engine as inventory.hold.extension when a policy applies; otherwise at once. ' +
          'An extension never shortens a hold.',
        parameters: [pathParameter('holdId', 'Opaque hold identifier')],
        requestBody: requestBody(h.ref('ExtendHoldRequest')),
        responses: { '200': h.json('Hold', 'The hold'), ...h.conflictErrors },
      },
    },
    '/api/v1/inventory/plan-templates': {
      get: {
        operationId: 'listPlanTemplates',
        summary: 'Payment-plan templates reachable through a visible project',
        description: 'Requires inventory.project.view (INV-PLAN-001).',
        parameters: [
          queryParameter('projectId', { type: 'string' }),
          queryParameter('includeRetired', { type: 'string', enum: ['true', 'false'] }),
        ],
        responses: { '200': h.json('PlanTemplateList', 'Templates'), ...h.authorizedErrors },
      },
      post: {
        operationId: 'createPlanTemplate',
        summary: 'Create a payment-plan template',
        description:
          'Requires inventory.plan.manage. Percentages as decimal strings; down and final payment may ' +
          'not exceed 100 % together (PERCENTAGES_EXCEED_WHOLE). Never edited: retire and replace.',
        requestBody: requestBody(h.ref('CreatePlanTemplateRequest')),
        responses: { '201': h.json('PlanTemplate', 'The template'), ...h.conflictErrors },
      },
    },
    '/api/v1/inventory/plan-templates/{templateId}/retire': {
      post: {
        operationId: 'retirePlanTemplate',
        summary: 'Retire a template',
        description: 'Requires inventory.plan.manage.',
        parameters: [pathParameter('templateId', 'Opaque template identifier')],
        requestBody: requestBody(h.ref('RetirePlanTemplateRequest')),
        responses: { '200': h.json('PlanTemplate', 'The template'), ...h.conflictErrors },
      },
    },
    '/api/v1/inventory/plan-templates/{templateId}/preview': {
      post: {
        operationId: 'previewPlanTemplate',
        summary: 'Apply a template to a unit and see the plan and schedule',
        description:
          'Requires inventory.unit.viewPricing. A calculation; nothing stored. The schedule is built by ' +
          'the contract code and reconciles exactly; TEMPLATE_NOT_ELIGIBLE for another project.',
        parameters: [pathParameter('templateId', 'Opaque template identifier')],
        requestBody: requestBody(h.ref('PlanTemplatePreviewRequest')),
        responses: { '200': h.json('PlanTemplatePreview', 'The preview'), ...h.conflictErrors },
      },
    },
  };
}
