import { ACTIVITY_KINDS, LEAD_SOURCES, LEAD_STAGES } from '@alola/contracts';
import { Schema, type Connection, type Model, type Types } from 'mongoose';

/**
 * CRM storage — `CRM-*` demonstration slice (ADR-0025).
 *
 * Three collections: customers, leads, and an append-only lead timeline.
 *
 * A phone number is stored twice: `primaryPhone` exactly as the person typed it, and
 * `primaryPhoneDigits` normalized for duplicate detection and search. The normalized form is never
 * displayed and never replaces the entered one (ADR-0003).
 *
 * Leads and customers are **never deleted**. A lead that goes nowhere is `lost` with a reason, which
 * is information; deleting it destroys the only record that the enquiry ever happened (ADR-0009).
 */
export const CUSTOMERS_COLLECTION = 'crmCustomers';
export const LEADS_COLLECTION = 'crmLeads';
export const ACTIVITIES_COLLECTION = 'crmActivities';

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
    super(`A lead's timeline is append-only: "${operation}" is refused.`);
    this.name = 'ActivityImmutableError';
  }
}

export interface StoredMoney {
  amount: Types.Decimal128;
  currency: string;
}

export interface CustomerDocument {
  customerId: string;
  name: string;
  primaryPhone: string;
  primaryPhoneDigits: string;
  secondaryPhone?: string;
  email?: string;
  nationalId?: string;
  address?: string;
  legalEntityId: string;
  branchId: string;
  ownerAccountId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeadDocument {
  leadId: string;
  name: string;
  primaryPhone: string;
  primaryPhoneDigits: string;
  secondaryPhone?: string;
  email?: string;
  source: (typeof LEAD_SOURCES)[number];
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
  customerId?: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActivityDocument {
  activityId: string;
  leadId: string;
  kind: (typeof ACTIVITY_KINDS)[number];
  body?: string;
  fromStage?: string;
  toStage?: string;
  dueOn?: string;
  actorAccountId?: string;
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

function customerSchema(): Schema<CustomerDocument> {
  const schema = new Schema<CustomerDocument>(
    {
      customerId: { type: String, required: true, immutable: true },
      name: { type: String, required: true },
      primaryPhone: { type: String, required: true },
      primaryPhoneDigits: { type: String, required: true },
      secondaryPhone: { type: String },
      email: { type: String },
      nationalId: { type: String },
      address: { type: String },
      legalEntityId: { type: String, required: true, immutable: true },
      branchId: { type: String, required: true, immutable: true },
      ownerAccountId: { type: String, required: true },
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
   * same group legitimately hold the same person as a customer, and merging them is a Phase 3
   * decision (`CRM-OWNER`), not something to force here.
   */
  schema.index(
    { legalEntityId: 1, primaryPhoneDigits: 1 },
    { unique: true, name: 'crmCustomers_entity_phone_unique' },
  );
  schema.index({ ownerAccountId: 1, createdAt: -1 }, { name: 'crmCustomers_owner_created' });
  schema.index({ branchId: 1, name: 1 }, { name: 'crmCustomers_branch_name' });
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
      source: { type: String, required: true, immutable: true, enum: [...LEAD_SOURCES] },
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
      customerId: { type: String },
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
      leadId: { type: String, required: true, immutable: true },
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
  for (const operation of MUTATING_QUERY_OPS) {
    schema.pre(operation, function rejectMutation() {
      throw new ActivityImmutableError(operation);
    });
  }
  schema.pre('save', function rejectResave() {
    if (!this.isNew) throw new ActivityImmutableError('save (existing document)');
  });
  schema.index({ activityId: 1 }, { unique: true, name: 'crmActivities_id_unique' });
  schema.index({ leadId: 1, occurredAt: -1 }, { name: 'crmActivities_lead_time' });
  schema.index({ actorAccountId: 1, occurredAt: -1 }, { name: 'crmActivities_actor_time' });
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
