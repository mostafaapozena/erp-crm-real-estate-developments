import {
  ActivityListSchema,
  ActivitySchema,
  AssignLeadSchema,
  CUSTOMER_KINDS,
  CUSTOMER_PAGE_SIZE_DEFAULT,
  CUSTOMER_PAGE_SIZE_MAX,
  ChangeLeadStageSchema,
  ConvertLeadResultSchema,
  CreateActivitySchema,
  CreateCustomerSchema,
  CreateLeadResultSchema,
  CreateLeadSchema,
  CrmDashboardSchema,
  CustomerListSchema,
  CustomerSchema,
  DuplicateCheckSchema,
  DuplicateReportSchema,
  LEAD_PAGE_SIZE_DEFAULT,
  LEAD_PAGE_SIZE_MAX,
  LEAD_SOURCES,
  LEAD_STAGES,
  LeadPageSchema,
  LeadSchema,
  OwnershipHistorySchema,
  QualifyLeadSchema,
  RecordConsentSchema,
  TransferOwnershipSchema,
  UpdateCustomerSchema,
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
  CorrectCustomerRequest: UpdateCustomerSchema,
  RecordConsentRequest: RecordConsentSchema,
  TransferOwnershipRequest: TransferOwnershipSchema,
  OwnershipHistory: OwnershipHistorySchema,
  DuplicateCheckRequest: DuplicateCheckSchema,
  DuplicateReport: DuplicateReportSchema,
  QualifyLeadRequest: QualifyLeadSchema,
  ConvertLeadResult: ConvertLeadResultSchema,
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
        parameters: [
          queryParameter('limit', {
            type: 'integer',
            minimum: 1,
            maximum: CUSTOMER_PAGE_SIZE_MAX,
            default: CUSTOMER_PAGE_SIZE_DEFAULT,
          }),
          queryParameter('cursor', { type: 'string' }),
          queryParameter('search', { type: 'string' }),
          queryParameter('kind', { type: 'string', enum: [...CUSTOMER_KINDS] }),
          queryParameter('branchId', { type: 'string' }),
          queryParameter('ownerAccountId', { type: 'string' }),
        ],
        responses: {
          '200': h.json('CustomerList', 'A page of customers ordered by name'),
          ...h.authorizedErrors,
        },
      },
      post: {
        operationId: 'createCustomer',
        summary: 'Create a customer',
        description:
          'Requires crm.customer.manage. A second customer with the same phone number inside one ' +
          'legal entity is refused (DUPLICATE_CUSTOMER_PHONE): two records would split their ' +
          'contracts and payment history across two identities. Naming another owner needs ' +
          'crm.customer.transfer and an eligible colleague; writing an identity needs ' +
          'crm.customer.viewIdentity (SEC-029).',
        requestBody: requestBody(h.ref('CreateCustomerRequest')),
        responses: { '201': h.json('Customer', 'The customer'), ...h.conflictErrors },
      },
    },
    '/api/v1/crm/customers/duplicate-check': {
      post: {
        operationId: 'checkCustomerDuplicates',
        summary: 'Find customers matching a phone, e-mail or identity number',
        description:
          'Requires crm.customer.view. A read sent as POST so contact details stay out of URLs; ' +
          "nothing is stored. Matches inside the actor's scope are listed; matches outside it are " +
          'only counted (CRM-PERSON-006).',
        requestBody: requestBody(h.ref('DuplicateCheckRequest')),
        responses: { '200': h.json('DuplicateReport', 'The matches'), ...h.authorizedErrors },
      },
    },
    '/api/v1/crm/customers/{customerId}': {
      get: {
        operationId: 'getCustomer',
        summary: 'Read one customer',
        description:
          'Requires crm.customer.view. Out of scope answers 404, not 403 (SEC-030). The identity is ' +
          'absent without crm.customer.viewIdentity (SEC-029).',
        parameters: [pathParameter('customerId', 'Opaque customer identifier')],
        responses: { '200': h.json('Customer', 'The customer'), ...h.notFoundErrors },
      },
      patch: {
        operationId: 'correctCustomer',
        summary: "Correct a customer's details",
        description:
          'Requires crm.customer.manage. States a reason and the version read; a stale version is ' +
          'STALE_VERSION. Contact and identity values never enter the audit record — only the fact ' +
          'that they changed (CRM-PERSON-005).',
        parameters: [pathParameter('customerId', 'Opaque customer identifier')],
        requestBody: requestBody(h.ref('CorrectCustomerRequest')),
        responses: { '200': h.json('Customer', 'The corrected customer'), ...h.conflictErrors },
      },
    },
    '/api/v1/crm/customers/{customerId}/consents': {
      post: {
        operationId: 'recordCustomerConsent',
        summary: 'Record a consent or its withdrawal for one channel',
        description:
          'Requires crm.customer.manage. Appended, never edited; the latest statement per channel is ' +
          'in force and is what the notification foundation checks before any external message.',
        parameters: [pathParameter('customerId', 'Opaque customer identifier')],
        requestBody: requestBody(h.ref('RecordConsentRequest')),
        responses: { '201': h.json('Customer', 'The customer'), ...h.notFoundErrors },
      },
    },
    '/api/v1/crm/customers/{customerId}/transfer': {
      post: {
        operationId: 'transferCustomer',
        summary: 'Hand a customer to another owner',
        description:
          'Requires crm.customer.transfer. The new owner must be active, able to read customers, ' +
          "placed in the customer's branch and inside the actor's scope; otherwise an ASSIGNEE_* " +
          'conflict is returned and the refusal is audited (CRM-OWNER-001).',
        parameters: [pathParameter('customerId', 'Opaque customer identifier')],
        requestBody: requestBody(h.ref('TransferOwnershipRequest')),
        responses: { '200': h.json('Customer', 'The customer'), ...h.conflictErrors },
      },
    },
    '/api/v1/crm/customers/{customerId}/duplicates': {
      get: {
        operationId: 'listCustomerDuplicates',
        summary: 'Other customers sharing this e-mail or identity number',
        description:
          'Requires crm.customer.view. Scoped as the duplicate check. Nothing is merged (BD-26).',
        parameters: [pathParameter('customerId', 'Opaque customer identifier')],
        responses: { '200': h.json('DuplicateReport', 'The matches'), ...h.notFoundErrors },
      },
    },
    '/api/v1/crm/customers/{customerId}/ownership': {
      get: {
        operationId: 'getCustomerOwnershipHistory',
        summary: "A customer's ownership history",
        description: 'Requires crm.customer.view. Append-only.',
        parameters: [pathParameter('customerId', 'Opaque customer identifier')],
        responses: { '200': h.json('OwnershipHistory', 'The history'), ...h.notFoundErrors },
      },
    },
    '/api/v1/crm/customers/{customerId}/activities': {
      get: {
        operationId: 'listCustomerActivities',
        summary: "A customer's timeline",
        description: 'Requires crm.customer.view, and the customer itself must be visible.',
        parameters: [pathParameter('customerId', 'Opaque customer identifier')],
        responses: { '200': h.json('ActivityList', 'The timeline'), ...h.notFoundErrors },
      },
      post: {
        operationId: 'addCustomerActivity',
        summary: 'Record a call, message, meeting, visit or note on a customer',
        description: 'Requires crm.activity.create.',
        parameters: [pathParameter('customerId', 'Opaque customer identifier')],
        requestBody: requestBody(h.ref('CreateActivityRequest')),
        responses: { '201': h.json('Activity', 'The activity'), ...h.notFoundErrors },
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
          queryParameter('customerId', { type: 'string' }),
          queryParameter('nurture', { type: 'string', enum: ['true', 'false'] }),
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
          'Requires crm.lead.assign, which a representative does not hold. The new owner must be ' +
          "active, hold crm.lead.view, be placed in the lead's branch and inside the actor's scope " +
          '(ASSIGNEE_UNKNOWN, ASSIGNEE_INACTIVE, ASSIGNEE_CANNOT_SEE_RECORD, ASSIGNEE_NOT_PLACED, ' +
          "ASSIGNEE_OUTSIDE_SCOPE, ASSIGNEE_OUTSIDE_BRANCH). The lead moves to the new owner's team; " +
          'the change is audited, kept in the ownership history and shown on the timeline.',
        parameters: [pathParameter('leadId', 'Opaque lead identifier')],
        requestBody: requestBody(h.ref('AssignLeadRequest')),
        responses: { '200': h.json('Lead', 'The reassigned lead'), ...h.conflictErrors },
      },
    },
    '/api/v1/crm/leads/{leadId}/qualify': {
      post: {
        operationId: 'qualifyLead',
        summary: 'Record a qualification',
        description:
          'Requires crm.lead.edit. Records budget confirmation, timeframe, purpose and decision role, ' +
          'and moves the lead to qualified when the pipeline permits it (CRM-LEAD-004). A concluded ' +
          'lead is LEAD_CONCLUDED.',
        parameters: [pathParameter('leadId', 'Opaque lead identifier')],
        requestBody: requestBody(h.ref('QualifyLeadRequest')),
        responses: { '200': h.json('Lead', 'The lead'), ...h.conflictErrors },
      },
    },
    '/api/v1/crm/leads/{leadId}/convert': {
      post: {
        operationId: 'convertLead',
        summary: 'Make the lead a customer',
        description:
          "Requires crm.lead.convert. Idempotent. A customer already holding the lead's phone in the " +
          "legal entity is linked rather than duplicated — unless it is outside the actor's scope, " +
          'which is CUSTOMER_OUTSIDE_SCOPE without describing it. A lost lead is LEAD_LOST.',
        parameters: [pathParameter('leadId', 'Opaque lead identifier')],
        responses: {
          '200': h.json('ConvertLeadResult', 'The lead and its customer'),
          ...h.conflictErrors,
        },
      },
    },
    '/api/v1/crm/leads/{leadId}/ownership': {
      get: {
        operationId: 'getLeadOwnershipHistory',
        summary: "A lead's ownership history",
        description: 'Requires crm.lead.view. Append-only.',
        parameters: [pathParameter('leadId', 'Opaque lead identifier')],
        responses: { '200': h.json('OwnershipHistory', 'The history'), ...h.notFoundErrors },
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
