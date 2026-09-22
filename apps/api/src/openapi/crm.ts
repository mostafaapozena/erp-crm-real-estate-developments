import {
  ActivityListSchema,
  ActivitySchema,
  AssignLeadSchema,
  ChangeLeadStageSchema,
  CreateActivitySchema,
  CreateCustomerSchema,
  CreateLeadResultSchema,
  CreateLeadSchema,
  CrmDashboardSchema,
  CustomerListSchema,
  CustomerSchema,
  LEAD_PAGE_SIZE_DEFAULT,
  LEAD_PAGE_SIZE_MAX,
  LEAD_SOURCES,
  LEAD_STAGES,
  LeadPageSchema,
  LeadSchema,
  UpdateLeadSchema,
} from '@alola/contracts';
import {
  pathParameter,
  queryParameter,
  requestBody,
  type OpenApiHelpers,
  type PathMap,
} from './shared';

export const crmComponents = {
  Customer: CustomerSchema,
  CustomerList: CustomerListSchema,
  CreateCustomerRequest: CreateCustomerSchema,
  Lead: LeadSchema,
  LeadPage: LeadPageSchema,
  CreateLeadRequest: CreateLeadSchema,
  CreateLeadResult: CreateLeadResultSchema,
  UpdateLeadRequest: UpdateLeadSchema,
  ChangeLeadStageRequest: ChangeLeadStageSchema,
  AssignLeadRequest: AssignLeadSchema,
  Activity: ActivitySchema,
  ActivityList: ActivityListSchema,
  CreateActivityRequest: CreateActivitySchema,
  CrmDashboard: CrmDashboardSchema,
} as const;

export function crmPaths(h: OpenApiHelpers): PathMap {
  return {
    '/api/v1/crm/customers': {
      get: {
        operationId: 'listCustomers',
        summary: 'List customers',
        description:
          "Requires crm.customer.view. Constrained by the actor's data scope inside the query; the " +
          'search is an anchored prefix match on the name or on the phone digits, never a regular ' +
          'expression.',
        parameters: [queryParameter('search', { type: 'string' })],
        responses: { '200': h.json('CustomerList', 'Customers'), ...h.authorizedErrors },
      },
      post: {
        operationId: 'createCustomer',
        summary: 'Create a customer',
        description:
          'Requires crm.customer.manage. A second customer with the same phone number inside one ' +
          'legal entity is refused: two records would split their contracts and payment history ' +
          'across two identities. The phone number is stored exactly as entered and normalized ' +
          'separately for matching.',
        requestBody: requestBody(h.ref('CreateCustomerRequest')),
        responses: { '201': h.json('Customer', 'The customer'), ...h.conflictErrors },
      },
    },
    '/api/v1/crm/customers/{customerId}': {
      get: {
        operationId: 'getCustomer',
        summary: 'Read one customer',
        description: 'Requires crm.customer.view. Out of scope answers 404, not 403 (SEC-030).',
        parameters: [pathParameter('customerId', 'Opaque customer identifier')],
        responses: { '200': h.json('Customer', 'The customer'), ...h.notFoundErrors },
      },
    },
    '/api/v1/crm/leads': {
      get: {
        operationId: 'listLeads',
        summary: 'List leads with keyset pagination',
        description:
          'Requires crm.lead.view. Ordering is createdAt desc, leadId desc. The total uses the same ' +
          'filter as the rows (SEC-028). followUp=due returns follow-ups due today or earlier; ' +
          'followUp=overdue returns only those already past, and both exclude concluded leads.',
        parameters: [
          queryParameter('limit', {
            type: 'integer',
            minimum: 1,
            maximum: LEAD_PAGE_SIZE_MAX,
            default: LEAD_PAGE_SIZE_DEFAULT,
          }),
          queryParameter('cursor', { type: 'string' }),
          queryParameter('stage', { type: 'string', enum: [...LEAD_STAGES] }),
          queryParameter('source', { type: 'string', enum: [...LEAD_SOURCES] }),
          queryParameter('assignedToAccountId', { type: 'string' }),
          queryParameter('interestedProjectId', { type: 'string' }),
          queryParameter('branchId', { type: 'string' }),
          queryParameter('teamId', { type: 'string' }),
          queryParameter(
            'search',
            { type: 'string' },
            'Anchored prefix on the name or phone digits',
          ),
          queryParameter('followUp', { type: 'string', enum: ['due', 'overdue'] }),
        ],
        responses: { '200': h.json('LeadPage', 'A page of leads'), ...h.authorizedErrors },
      },
      post: {
        operationId: 'createLead',
        summary: 'Create a lead',
        description:
          'Requires crm.lead.create. The lead is assigned to the caller unless they also hold ' +
          'crm.lead.assign, in which case assignedToAccountId is honoured; without that permission ' +
          'the field is ignored rather than rejected. A lead sharing a phone number with another live ' +
          'lead in the same legal entity is **created**, with the match reported as possibleDuplicate ' +
          '— households, switchboards and brokers really do share numbers.',
        requestBody: requestBody(h.ref('CreateLeadRequest')),
        responses: {
          '201': h.json('CreateLeadResult', 'The lead, and any possible duplicate found'),
          ...h.conflictErrors,
        },
      },
    },
    '/api/v1/crm/dashboard': {
      get: {
        operationId: 'getCrmDashboard',
        summary: 'Pipeline, follow-up and conversion figures',
        description:
          "Requires crm.lead.view. Every figure is computed from the actor's scope filter as the " +
          'first aggregation stage, so a dashboard cannot report numbers the list would not show ' +
          '(SEC-028).',
        responses: { '200': h.json('CrmDashboard', 'The dashboard'), ...h.authorizedErrors },
      },
    },
    '/api/v1/crm/leads/{leadId}': {
      get: {
        operationId: 'getLead',
        summary: 'Read one lead',
        description: 'Requires crm.lead.view. Out of scope answers 404, not 403 (SEC-030).',
        parameters: [pathParameter('leadId', 'Opaque lead identifier')],
        responses: { '200': h.json('Lead', 'The lead'), ...h.notFoundErrors },
      },
      patch: {
        operationId: 'updateLead',
        summary: 'Edit a lead',
        description:
          'Requires crm.lead.edit. Optimistic concurrency: the stored version is in the update ' +
          'filter, so a concurrent edit loses rather than silently overwriting. The stage and the ' +
          'owner are **not** editable here; each has its own endpoint and its own permission.',
        parameters: [pathParameter('leadId', 'Opaque lead identifier')],
        requestBody: requestBody(h.ref('UpdateLeadRequest')),
        responses: { '200': h.json('Lead', 'The updated lead'), ...h.conflictErrors },
      },
    },
    '/api/v1/crm/leads/{leadId}/stage': {
      post: {
        operationId: 'changeLeadStage',
        summary: 'Move a lead through the pipeline',
        description:
          'Requires crm.lead.edit. A move the pipeline does not permit is refused and the attempt is ' +
          'audited. Moving to lost **requires** a reason. won and lost are terminal; reopening a lost ' +
          'lead is an explicit move back to contacted, never a silent edit.',
        parameters: [pathParameter('leadId', 'Opaque lead identifier')],
        requestBody: requestBody(h.ref('ChangeLeadStageRequest')),
        responses: { '200': h.json('Lead', 'The updated lead'), ...h.conflictErrors },
      },
    },
    '/api/v1/crm/leads/{leadId}/assign': {
      post: {
        operationId: 'assignLead',
        summary: 'Hand a lead to another sales owner',
        description:
          'Requires crm.lead.assign, which a representative does not hold. The reassignment is ' +
          'audited and appears on the lead timeline.',
        parameters: [pathParameter('leadId', 'Opaque lead identifier')],
        requestBody: requestBody(h.ref('AssignLeadRequest')),
        responses: { '200': h.json('Lead', 'The reassigned lead'), ...h.conflictErrors },
      },
    },
    '/api/v1/crm/leads/{leadId}/activities': {
      get: {
        operationId: 'listLeadActivities',
        summary: "A lead's timeline",
        description:
          'Requires crm.lead.view, and the lead itself must be visible. Append-only: no endpoint ' +
          'edits or deletes an activity, and the storage refuses it too.',
        parameters: [pathParameter('leadId', 'Opaque lead identifier')],
        responses: { '200': h.json('ActivityList', 'The timeline'), ...h.notFoundErrors },
      },
      post: {
        operationId: 'addLeadActivity',
        summary: 'Record a call, note, meeting, visit or follow-up',
        description:
          'Requires crm.activity.create. A followUpScheduled activity with a due date also moves the ' +
          "lead's next follow-up, so the two can never disagree.",
        parameters: [pathParameter('leadId', 'Opaque lead identifier')],
        requestBody: requestBody(h.ref('CreateActivityRequest')),
        responses: { '201': h.json('Activity', 'The activity'), ...h.notFoundErrors },
      },
    },
  };
}
