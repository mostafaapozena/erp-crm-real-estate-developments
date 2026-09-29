import {
  ACTIVITY_KINDS,
  CONSENT_SOURCES,
  CONTACT_CHANNELS,
  CUSTOMER_KINDS,
  DECISION_ROLES,
  IDENTITY_TYPES,
  LEAD_SOURCES,
  LEAD_STAGES,
  OPPORTUNITY_STAGES,
  QUALIFICATION_PURPOSES,
  QUALIFICATION_TIMEFRAMES,
  SUPPORTED_LOCALES,
} from '@alola/contracts';
import { Schema, type Connection, type Model, type Types } from 'mongoose';

/**
 * CRM storage (`CRM-*`).
 *
 * Customers, leads, and an append-only timeline; since BMP-1 also an append-only consent history and
 * an append-only ownership history.
 *
 * A phone number is stored twice: `primaryPhone` exactly as the person typed it, and
 * `primaryPhoneDigits` normalized for duplicate detection and search. The normalized form is never
 * displayed and never replaces the entered one (ADR-0003). E-mail addresses and identity numbers
 * follow the same rule.
 *
 * Every field added in BMP-1 is optional in storage, so a record written by the demonstration slice
 * reads unchanged: a customer with no `kind` is an individual, one with no `version` is at version 1,
 * and a legacy `nationalId` is presented as its identity.
 *
 * Leads and customers are **never deleted**. A lead that goes nowhere is `lost` with a reason, which
 * is information; deleting it destroys the only record that the enquiry ever happened (ADR-0009).
 */
export const CUSTOMERS_COLLECTION = 'crmCustomers';
export const LEADS_COLLECTION = 'crmLeads';
export const ACTIVITIES_COLLECTION = 'crmActivities';
export const CONSENTS_COLLECTION = 'crmConsents';
export const OWNERSHIP_CHANGES_COLLECTION = 'crmOwnershipChanges';
export const OPPORTUNITIES_COLLECTION = 'crmOpportunities';

export class CrmRecordUndeletableError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly operation: string) {
    super(`CRM records are closed, never deleted: "${operation}" is refused (ADR-0009).`);
    this.name = 'CrmRecordUndeletableError';
  }
}

export class ActivityImmutableError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly operation: string) {
    super(`A CRM history is append-only: "${operation}" is refused.`);
    this.name = 'ActivityImmutableError';
  }
}

export interface StoredMoney {
  amount: Types.Decimal128;
  currency: string;
}

export interface StoredIdentity {
  type: (typeof IDENTITY_TYPES)[number];
  number: string;
  /** Letters and digits, upper-cased: what duplicates are matched on. Never displayed. */
  numberNormalized: string;
  issuingCountry?: string;
}

export interface CustomerDocument {
  customerId: string;
  kind?: (typeof CUSTOMER_KINDS)[number];
  name: string;
  alternateName?: string;
  primaryPhone: string;
  primaryPhoneDigits: string;
  secondaryPhone?: string;
  email?: string;
  emailNormalized?: string;
  identity?: StoredIdentity;
  /** Written by the demonstration slice; read as a national-ID identity. Never written since BMP-1. */
  nationalId?: string;
  address?: string;
  city?: string;
  preferredLanguage?: (typeof SUPPORTED_LOCALES)[number];
  preferredChannel?: (typeof CONTACT_CHANNELS)[number];
  legalEntityId: string;
  branchId: string;
  departmentId?: string;
  teamId?: string;
  ownerAccountId: string;
  version?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredQualification {
  budgetConfirmed: boolean;
  timeframe: (typeof QUALIFICATION_TIMEFRAMES)[number];
  purpose: (typeof QUALIFICATION_PURPOSES)[number];
  decisionRole: (typeof DECISION_ROLES)[number];
  notes?: string;
  qualifiedAt: Date;
  qualifiedBy: string;
}

export interface LeadDocument {
  leadId: string;
  name: string;
  primaryPhone: string;
  primaryPhoneDigits: string;
  secondaryPhone?: string;
  email?: string;
  emailNormalized?: string;
  source: (typeof LEAD_SOURCES)[number];
  currentSource?: (typeof LEAD_SOURCES)[number];
  campaignId?: string;
  interestedProjectId?: string;
  preferredPropertyType?: string;
  preferredUsageType?: string;
  budgetMin?: StoredMoney;
  budgetMax?: StoredMoney;
  assignedToAccountId: string;
  legalEntityId: string;
  branchId: string;
  departmentId?: string;
  teamId?: string;
  notes?: string;
  /** A calendar date, stored as `YYYY-MM-DD` and never as a timestamp (ADR-0008). */
  nextFollowUpOn?: string;
  stage: (typeof LEAD_STAGES)[number];
  lostReason?: string;
  lostReasonCode?: string;
  nurture?: boolean;
  qualification?: StoredQualification;
  customerId?: string;
  convertedAt?: Date;
  lastActivityAt?: Date;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActivityDocument {
  activityId: string;
  leadId?: string;
  customerId?: string;
  opportunityId?: string;
  kind: (typeof ACTIVITY_KINDS)[number];
  body?: string;
  fromStage?: string;
  toStage?: string;
  dueOn?: string;
  actorAccountId?: string;
  occurredAt: Date;
}

export interface OpportunityDocument {
  opportunityId: string;
  customerId: string;
  leadId?: string;
  source?: (typeof LEAD_SOURCES)[number];
  campaignId?: string;
  projectId?: string;
  propertyType?: string;
  usageType?: string;
  budgetMin?: StoredMoney;
  budgetMax?: StoredMoney;
  expectedValue?: StoredMoney;
  expectedCloseOn?: string;
  stage: (typeof OPPORTUNITY_STAGES)[number];
  lostReason?: string;
  lostReasonCode?: string;
  reservationId?: string;
  contractId?: string;
  notes?: string;
  ownerAccountId: string;
  legalEntityId: string;
  branchId: string;
  departmentId?: string;
  teamId?: string;
  stageChangedAt: Date;
  closedAt?: Date;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** One consent statement for one channel. The latest per channel is the consent in force. */
export interface ConsentDocument {
  consentId: string;
  customerId: string;
  channel: (typeof CONTACT_CHANNELS)[number];
  granted: boolean;
  source: (typeof CONSENT_SOURCES)[number];
  note?: string;
  recordedBy: string;
  recordedAt: Date;
}

export interface OwnershipChangeDocument {
  changeId: string;
  subjectType: 'customer' | 'lead' | 'opportunity';
  subjectId: string;
  fromAccountId?: string;
  toAccountId: string;
  reason: string;
  actorAccountId: string;
  occurredAt: Date;
}

const MUTATING_QUERY_OPS = [
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
] as const;

const DELETE_OPS = ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const;

const money = new Schema(
  {
    amount: { type: Schema.Types.Decimal128, required: true },
    currency: { type: String, required: true },
  },
  { _id: false },
);

const identity = new Schema(
  {
    type: { type: String, required: true, enum: [...IDENTITY_TYPES] },
    number: { type: String, required: true },
    numberNormalized: { type: String, required: true },
    issuingCountry: { type: String },
  },
  { _id: false },
);

const qualification = new Schema(
  {
    budgetConfirmed: { type: Boolean, required: true },
    timeframe: { type: String, required: true, enum: [...QUALIFICATION_TIMEFRAMES] },
    purpose: { type: String, required: true, enum: [...QUALIFICATION_PURPOSES] },
    decisionRole: { type: String, required: true, enum: [...DECISION_ROLES] },
    notes: { type: String },
    qualifiedAt: { type: Date, required: true },
    qualifiedBy: { type: String, required: true },
  },
  { _id: false },
);

/** Refuse every update, replace and delete, and a re-save of a loaded document. */
function appendOnly<T>(schema: Schema<T>): Schema<T> {
  for (const operation of MUTATING_QUERY_OPS) {
    schema.pre(operation, function rejectMutation() {
      throw new ActivityImmutableError(operation);
    });
  }
  schema.pre('save', function rejectResave() {
    if (!this.isNew) throw new ActivityImmutableError('save (existing document)');
  });
  return schema;
}

function customerSchema(): Schema<CustomerDocument> {
  const schema = new Schema<CustomerDocument>(
    {
      customerId: { type: String, required: true, immutable: true },
      kind: { type: String, enum: [...CUSTOMER_KINDS] },
      name: { type: String, required: true },
      alternateName: { type: String },
      primaryPhone: { type: String, required: true },
      primaryPhoneDigits: { type: String, required: true },
      secondaryPhone: { type: String },
      email: { type: String },
      emailNormalized: { type: String },
      identity: { type: identity },
      nationalId: { type: String },
      address: { type: String },
      city: { type: String },
      preferredLanguage: { type: String, enum: [...SUPPORTED_LOCALES] },
      preferredChannel: { type: String, enum: [...CONTACT_CHANNELS] },
      legalEntityId: { type: String, required: true, immutable: true },
      branchId: { type: String, required: true, immutable: true },
      departmentId: { type: String },
      teamId: { type: String },
      ownerAccountId: { type: String, required: true },
      version: { type: Number },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: CUSTOMERS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  for (const operation of DELETE_OPS) {
    schema.pre(operation, function rejectDelete() {
      throw new CrmRecordUndeletableError(operation);
    });
  }
  schema.index({ customerId: 1 }, { unique: true, name: 'crmCustomers_id_unique' });
  /**
   * One customer per phone number **within a legal entity**. Not globally: two companies under the
   * same group legitimately hold the same person as a customer. Merging is `BD-26`.
   */
  schema.index(
    { legalEntityId: 1, primaryPhoneDigits: 1 },
    { unique: true, name: 'crmCustomers_entity_phone_unique' },
  );
  // Duplicate candidates (CRM-PERSON-006): deliberately **not** unique.
  schema.index({ legalEntityId: 1, emailNormalized: 1 }, { name: 'crmCustomers_entity_email' });
  schema.index(
    { legalEntityId: 1, 'identity.numberNormalized': 1 },
    { name: 'crmCustomers_entity_identity' },
  );
  schema.index({ ownerAccountId: 1, createdAt: -1 }, { name: 'crmCustomers_owner_created' });
  schema.index({ branchId: 1, name: 1 }, { name: 'crmCustomers_branch_name' });
  schema.index({ teamId: 1, name: 1 }, { name: 'crmCustomers_scope_team' });
  schema.index({ departmentId: 1, name: 1 }, { name: 'crmCustomers_scope_department' });
  schema.index({ name: 1, customerId: 1 }, { name: 'crmCustomers_name_keyset' });
  return schema;
}

function leadSchema(): Schema<LeadDocument> {
  const schema = new Schema<LeadDocument>(
    {
      leadId: { type: String, required: true, immutable: true },
      name: { type: String, required: true },
      primaryPhone: { type: String, required: true },
      primaryPhoneDigits: { type: String, required: true },
      secondaryPhone: { type: String },
      email: { type: String },
      emailNormalized: { type: String },
      // The original source is attribution evidence: it never changes (CRM-LEAD-002).
      source: { type: String, required: true, immutable: true, enum: [...LEAD_SOURCES] },
      currentSource: { type: String, enum: [...LEAD_SOURCES] },
      campaignId: { type: String, immutable: true },
      interestedProjectId: { type: String },
      preferredPropertyType: { type: String },
      preferredUsageType: { type: String },
      budgetMin: { type: money },
      budgetMax: { type: money },
      assignedToAccountId: { type: String, required: true },
      legalEntityId: { type: String, required: true, immutable: true },
      branchId: { type: String, required: true, immutable: true },
      departmentId: { type: String },
      teamId: { type: String },
      notes: { type: String },
      nextFollowUpOn: { type: String },
      stage: { type: String, required: true, enum: [...LEAD_STAGES] },
      lostReason: { type: String },
      lostReasonCode: { type: String },
      nurture: { type: Boolean },
      qualification: { type: qualification },
      customerId: { type: String },
      convertedAt: { type: Date },
      lastActivityAt: { type: Date },
      version: { type: Number, required: true },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: LEADS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  for (const operation of DELETE_OPS) {
    schema.pre(operation, function rejectDelete() {
      throw new CrmRecordUndeletableError(operation);
    });
  }
  schema.index({ leadId: 1 }, { unique: true, name: 'crmLeads_id_unique' });
  // Duplicate detection: deliberately **not** unique — the same number may legitimately appear twice.
  schema.index({ legalEntityId: 1, primaryPhoneDigits: 1 }, { name: 'crmLeads_entity_phone' });
  schema.index({ legalEntityId: 1, emailNormalized: 1 }, { name: 'crmLeads_entity_email' });
  // The pipeline board and the owner's own queue.
  schema.index({ stage: 1, createdAt: -1, leadId: -1 }, { name: 'crmLeads_stage_keyset' });
  schema.index(
    { assignedToAccountId: 1, stage: 1, createdAt: -1 },
    { name: 'crmLeads_owner_stage' },
  );
  // Follow-up queues: due today, overdue.
  schema.index({ nextFollowUpOn: 1, stage: 1 }, { name: 'crmLeads_followUp' });
  // Data scope (SEC-026), one index per level that resolves to a field on this record.
  schema.index({ legalEntityId: 1, branchId: 1, stage: 1 }, { name: 'crmLeads_scope_branch' });
  schema.index({ teamId: 1, stage: 1 }, { name: 'crmLeads_scope_team' });
  schema.index({ departmentId: 1, stage: 1 }, { name: 'crmLeads_scope_department' });
  schema.index({ interestedProjectId: 1, stage: 1 }, { name: 'crmLeads_scope_project' });
  schema.index({ source: 1, createdAt: -1 }, { name: 'crmLeads_source_created' });
  schema.index({ createdAt: -1, leadId: -1 }, { name: 'crmLeads_created_keyset' });
  schema.index({ customerId: 1 }, { name: 'crmLeads_customer' });
  return schema;
}

function activitySchema(): Schema<ActivityDocument> {
  const schema = new Schema<ActivityDocument>(
    {
      activityId: { type: String, required: true, immutable: true },
      leadId: { type: String, immutable: true },
      customerId: { type: String, immutable: true },
      opportunityId: { type: String, immutable: true },
      kind: { type: String, required: true, immutable: true, enum: [...ACTIVITY_KINDS] },
      body: { type: String, immutable: true },
      fromStage: { type: String, immutable: true },
      toStage: { type: String, immutable: true },
      dueOn: { type: String, immutable: true },
      actorAccountId: { type: String, immutable: true },
      occurredAt: { type: Date, required: true, immutable: true },
    },
    { collection: ACTIVITIES_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  // An activity belongs to something. The contract says so; the storage refuses the orphan too.
  schema.pre('validate', function requireSubject() {
    if (!this.leadId && !this.customerId && !this.opportunityId) {
      throw new Error('ACTIVITY_SUBJECT_REQUIRED');
    }
  });
  appendOnly(schema);
  schema.index({ activityId: 1 }, { unique: true, name: 'crmActivities_id_unique' });
  schema.index({ leadId: 1, occurredAt: -1 }, { name: 'crmActivities_lead_time' });
  schema.index({ customerId: 1, occurredAt: -1 }, { name: 'crmActivities_customer_time' });
  schema.index({ opportunityId: 1, occurredAt: -1 }, { name: 'crmActivities_opportunity_time' });
  schema.index({ actorAccountId: 1, occurredAt: -1 }, { name: 'crmActivities_actor_time' });
  return schema;
}

function consentSchema(): Schema<ConsentDocument> {
  const schema = new Schema<ConsentDocument>(
    {
      consentId: { type: String, required: true, immutable: true },
      customerId: { type: String, required: true, immutable: true },
      channel: { type: String, required: true, immutable: true, enum: [...CONTACT_CHANNELS] },
      granted: { type: Boolean, required: true, immutable: true },
      source: { type: String, required: true, immutable: true, enum: [...CONSENT_SOURCES] },
      note: { type: String, immutable: true },
      recordedBy: { type: String, required: true, immutable: true },
      recordedAt: { type: Date, required: true, immutable: true },
    },
    { collection: CONSENTS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  appendOnly(schema);
  schema.index({ consentId: 1 }, { unique: true, name: 'crmConsents_id_unique' });
  // The consent in force is the latest per channel.
  schema.index(
    { customerId: 1, channel: 1, recordedAt: -1, consentId: -1 },
    { name: 'crmConsents_customer_channel_latest' },
  );
  return schema;
}

function ownershipChangeSchema(): Schema<OwnershipChangeDocument> {
  const schema = new Schema<OwnershipChangeDocument>(
    {
      changeId: { type: String, required: true, immutable: true },
      subjectType: {
        type: String,
        required: true,
        immutable: true,
        enum: ['customer', 'lead', 'opportunity'],
      },
      subjectId: { type: String, required: true, immutable: true },
      fromAccountId: { type: String, immutable: true },
      toAccountId: { type: String, required: true, immutable: true },
      reason: { type: String, required: true, immutable: true },
      actorAccountId: { type: String, required: true, immutable: true },
      occurredAt: { type: Date, required: true, immutable: true },
    },
    {
      collection: OWNERSHIP_CHANGES_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
    },
  );
  appendOnly(schema);
  schema.index({ changeId: 1 }, { unique: true, name: 'crmOwnershipChanges_id_unique' });
  schema.index(
    { subjectType: 1, subjectId: 1, occurredAt: -1 },
    { name: 'crmOwnershipChanges_subject_time' },
  );
  schema.index({ toAccountId: 1, occurredAt: -1 }, { name: 'crmOwnershipChanges_to_time' });
  return schema;
}

function opportunitySchema(): Schema<OpportunityDocument> {
  const schema = new Schema<OpportunityDocument>(
    {
      opportunityId: { type: String, required: true, immutable: true },
      customerId: { type: String, required: true, immutable: true },
      leadId: { type: String, immutable: true },
      // Attribution is copied once from the lead and never rewritten (Master Mapping §9 rule 14).
      source: { type: String, immutable: true, enum: [...LEAD_SOURCES] },
      campaignId: { type: String, immutable: true },
      projectId: { type: String },
      propertyType: { type: String },
      usageType: { type: String },
      budgetMin: { type: money },
      budgetMax: { type: money },
      expectedValue: { type: money },
      expectedCloseOn: { type: String },
      stage: { type: String, required: true, enum: [...OPPORTUNITY_STAGES] },
      lostReason: { type: String },
      lostReasonCode: { type: String },
      reservationId: { type: String },
      contractId: { type: String },
      notes: { type: String },
      ownerAccountId: { type: String, required: true },
      legalEntityId: { type: String, required: true, immutable: true },
      branchId: { type: String, required: true, immutable: true },
      departmentId: { type: String },
      teamId: { type: String },
      stageChangedAt: { type: Date, required: true },
      closedAt: { type: Date },
      version: { type: Number, required: true },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: OPPORTUNITIES_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  for (const operation of DELETE_OPS) {
    schema.pre(operation, function rejectDelete() {
      throw new CrmRecordUndeletableError(operation);
    });
  }
  schema.index({ opportunityId: 1 }, { unique: true, name: 'crmOpportunities_id_unique' });
  schema.index({ createdAt: -1, opportunityId: -1 }, { name: 'crmOpportunities_created_keyset' });
  schema.index({ customerId: 1, stage: 1 }, { name: 'crmOpportunities_customer_stage' });
  schema.index({ leadId: 1 }, { name: 'crmOpportunities_lead' });
  schema.index({ reservationId: 1 }, { name: 'crmOpportunities_reservation' });
  schema.index({ ownerAccountId: 1, stage: 1 }, { name: 'crmOpportunities_owner_stage' });
  schema.index({ projectId: 1, stage: 1 }, { name: 'crmOpportunities_scope_project' });
  schema.index(
    { legalEntityId: 1, branchId: 1, stage: 1 },
    { name: 'crmOpportunities_scope_branch' },
  );
  schema.index({ teamId: 1, stage: 1 }, { name: 'crmOpportunities_scope_team' });
  schema.index({ departmentId: 1, stage: 1 }, { name: 'crmOpportunities_scope_department' });
  return schema;
}

function model<T>(connection: Connection, name: string, build: () => Schema<T>): Model<T> {
  return (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, build());
}

export function customerModel(connection: Connection): Model<CustomerDocument> {
  return model(connection, CUSTOMERS_COLLECTION, customerSchema);
}

export function leadModel(connection: Connection): Model<LeadDocument> {
  return model(connection, LEADS_COLLECTION, leadSchema);
}

export function activityModel(connection: Connection): Model<ActivityDocument> {
  return model(connection, ACTIVITIES_COLLECTION, activitySchema);
}

export function consentModel(connection: Connection): Model<ConsentDocument> {
  return model(connection, CONSENTS_COLLECTION, consentSchema);
}

export function ownershipChangeModel(connection: Connection): Model<OwnershipChangeDocument> {
  return model(connection, OWNERSHIP_CHANGES_COLLECTION, ownershipChangeSchema);
}

export function opportunityModel(connection: Connection): Model<OpportunityDocument> {
  return model(connection, OPPORTUNITIES_COLLECTION, opportunitySchema);
}
