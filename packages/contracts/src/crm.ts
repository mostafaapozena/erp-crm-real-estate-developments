import { z } from 'zod';
import { EnteredNameSchema, NoteSchema, PhoneSchema, RecordIdSchema } from './identifiers';
import { MoneySchema } from './money';
import { PropertyTypeSchema, UsageTypeSchema } from './inventory';
import { BusinessDateSchema, InstantSchema } from './time';

/**
 * CRM — `CRM-*` demonstration slice (ADR-0025).
 *
 * A **lead** is an interest; a **customer** is a person the business has a relationship with. They are
 * separate records because a lead that goes nowhere must not leave a customer behind, and a customer
 * who buys twice must not be two leads. Converting a lead creates or links a customer and keeps the
 * lead as history.
 *
 * Names, phone numbers and notes are **user-entered content**: stored exactly as entered, never
 * translated, never reformatted, and rendered direction-isolated (ADR-0003, I18N-009). A phone number
 * is additionally normalized to digits for duplicate detection, and the normalized form never replaces
 * what was typed.
 */

/* -------------------------------------------------------------------- customer */

export const CustomerSchema = z.strictObject({
  customerId: RecordIdSchema,
  name: EnteredNameSchema,
  primaryPhone: PhoneSchema,
  secondaryPhone: PhoneSchema.optional(),
  email: z.string().trim().email().max(254).optional(),
  /** National identifier as entered. Never reformatted; displayed verbatim and isolated. */
  nationalId: z.string().trim().max(40).optional(),
  address: z.string().trim().max(400).optional(),
  legalEntityId: RecordIdSchema,
  branchId: RecordIdSchema,
  /** The sales owner. `self`- and `assigned`-scoped actors resolve against this. */
  ownerAccountId: z.string().min(1).max(200),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Customer = z.infer<typeof CustomerSchema>;

export const CreateCustomerSchema = z.strictObject({
  name: EnteredNameSchema,
  primaryPhone: PhoneSchema,
  secondaryPhone: PhoneSchema.optional(),
  email: z.string().trim().email().max(254).optional(),
  nationalId: z.string().trim().max(40).optional(),
  address: z.string().trim().max(400).optional(),
  branchId: RecordIdSchema,
  ownerAccountId: z.string().min(1).max(200).optional(),
});
export type CreateCustomer = z.infer<typeof CreateCustomerSchema>;

/* ------------------------------------------------------------------------ lead */

/**
 * Where the lead came from. Facebook, Instagram and WhatsApp appear here as **recorded origins**, not
 * as live integrations: nothing is connected, and a lead from one of them was entered by a person or
 * imported (ADR-0026).
 */
export const LEAD_SOURCES = [
  'facebook',
  'instagram',
  'whatsapp',
  'website',
  'phoneCall',
  'walkIn',
  'referral',
  'broker',
  'other',
] as const;
export const LeadSourceSchema = z.enum(LEAD_SOURCES);
export type LeadSource = z.infer<typeof LeadSourceSchema>;

export const LEAD_STAGES = [
  'new',
  'contacted',
  'qualified',
  'visitScheduled',
  'negotiation',
  'reservation',
  'won',
  'lost',
] as const;
export const LeadStageSchema = z.enum(LEAD_STAGES);
export type LeadStage = z.infer<typeof LeadStageSchema>;

/**
 * Permitted pipeline moves.
 *
 * Deliberately permissive in the middle — a real pipeline goes backwards when a deal cools, and a
 * system that forbids it just teaches people to lie in the notes. The two terminal stages are the
 * strict ones: `won` and `lost` are conclusions, and reopening is an explicit move back to
 * `contacted` rather than a silent edit.
 */
export const LEAD_TRANSITIONS: Readonly<Record<LeadStage, readonly LeadStage[]>> = {
  new: ['contacted', 'qualified', 'lost'],
  contacted: ['qualified', 'visitScheduled', 'negotiation', 'lost'],
  qualified: ['contacted', 'visitScheduled', 'negotiation', 'lost'],
  visitScheduled: ['contacted', 'qualified', 'negotiation', 'reservation', 'lost'],
  negotiation: ['qualified', 'visitScheduled', 'reservation', 'lost'],
  reservation: ['negotiation', 'won', 'lost'],
  won: [],
  lost: ['contacted'],
};

export function canTransitionLead(from: LeadStage, to: LeadStage): boolean {
  return LEAD_TRANSITIONS[from].includes(to);
}

/** A stage that is over. Used for conversion rates and to require a reason on the way out. */
export const TERMINAL_LEAD_STAGES: readonly LeadStage[] = ['won', 'lost'];

export const LeadSchema = z.strictObject({
  leadId: RecordIdSchema,
  name: EnteredNameSchema,
  primaryPhone: PhoneSchema,
  secondaryPhone: PhoneSchema.optional(),
  email: z.string().trim().email().max(254).optional(),
  source: LeadSourceSchema,
  /** Opaque reference to a marketing campaign. No provider is connected (ADR-0026). */
  campaignId: RecordIdSchema.optional(),
  interestedProjectId: RecordIdSchema.optional(),
  preferredPropertyType: PropertyTypeSchema.optional(),
  preferredUsageType: UsageTypeSchema.optional(),
  budgetMin: MoneySchema.optional(),
  budgetMax: MoneySchema.optional(),
  /** The sales owner; the record's `assigned` scope resolves against this. */
  assignedToAccountId: z.string().min(1).max(200),
  legalEntityId: RecordIdSchema,
  branchId: RecordIdSchema,
  departmentId: RecordIdSchema.optional(),
  teamId: RecordIdSchema.optional(),
  notes: NoteSchema.optional(),
  nextFollowUpOn: BusinessDateSchema.optional(),
  stage: LeadStageSchema,
  /** Required when the stage is `lost`; kept if the lead is later reopened. */
  lostReason: z.string().trim().max(500).optional(),
  /** Set once the lead becomes a customer. The lead itself is kept as history. */
  customerId: RecordIdSchema.optional(),
  version: z.number().int().positive(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Lead = z.infer<typeof LeadSchema>;

export const CreateLeadSchema = z.strictObject({
  name: EnteredNameSchema,
  primaryPhone: PhoneSchema,
  secondaryPhone: PhoneSchema.optional(),
  email: z.string().trim().email().max(254).optional(),
  source: LeadSourceSchema,
  campaignId: RecordIdSchema.optional(),
  interestedProjectId: RecordIdSchema.optional(),
  preferredPropertyType: PropertyTypeSchema.optional(),
  preferredUsageType: UsageTypeSchema.optional(),
  budgetMin: MoneySchema.optional(),
  budgetMax: MoneySchema.optional(),
  branchId: RecordIdSchema,
  departmentId: RecordIdSchema.optional(),
  teamId: RecordIdSchema.optional(),
  /** Omitted means "assign to me". Naming someone else needs `crm.lead.assign`. */
  assignedToAccountId: z.string().min(1).max(200).optional(),
  notes: NoteSchema.optional(),
  nextFollowUpOn: BusinessDateSchema.optional(),
});
export type CreateLead = z.infer<typeof CreateLeadSchema>;

export const UpdateLeadSchema = z.strictObject({
  name: EnteredNameSchema.optional(),
  secondaryPhone: PhoneSchema.optional(),
  email: z.string().trim().email().max(254).optional(),
  interestedProjectId: RecordIdSchema.optional(),
  preferredPropertyType: PropertyTypeSchema.optional(),
  preferredUsageType: UsageTypeSchema.optional(),
  budgetMin: MoneySchema.optional(),
  budgetMax: MoneySchema.optional(),
  notes: NoteSchema.optional(),
  nextFollowUpOn: BusinessDateSchema.optional(),
  expectedVersion: z.number().int().positive().optional(),
});
export type UpdateLead = z.infer<typeof UpdateLeadSchema>;

export const ChangeLeadStageSchema = z.strictObject({
  stage: LeadStageSchema,
  /** Mandatory for `lost`; the service refuses the move without it. */
  reason: z.string().trim().max(500).optional(),
  expectedVersion: z.number().int().positive().optional(),
});
export type ChangeLeadStage = z.infer<typeof ChangeLeadStageSchema>;

export const AssignLeadSchema = z.strictObject({
  assignedToAccountId: z.string().min(1).max(200),
  reason: z.string().trim().min(3).max(500),
});
export type AssignLead = z.infer<typeof AssignLeadSchema>;

/* -------------------------------------------------------------------- activity */

export const ACTIVITY_KINDS = [
  'note',
  'call',
  'whatsapp',
  'meeting',
  'siteVisit',
  'followUpScheduled',
  'stageChanged',
  'assignmentChanged',
  'converted',
] as const;
export const ActivityKindSchema = z.enum(ACTIVITY_KINDS);
export type ActivityKind = z.infer<typeof ActivityKindSchema>;

/** Append-only. A lead's timeline is what a sales manager reads to judge whether it is being worked. */
export const ActivitySchema = z.strictObject({
  activityId: RecordIdSchema,
  leadId: RecordIdSchema,
  kind: ActivityKindSchema,
  body: NoteSchema.optional(),
  fromStage: LeadStageSchema.optional(),
  toStage: LeadStageSchema.optional(),
  dueOn: BusinessDateSchema.optional(),
  actorAccountId: z.string().min(1).max(200).optional(),
  occurredAt: InstantSchema,
});
export type Activity = z.infer<typeof ActivitySchema>;

export const CreateActivitySchema = z.strictObject({
  kind: z.enum(['note', 'call', 'whatsapp', 'meeting', 'siteVisit', 'followUpScheduled']),
  body: NoteSchema.optional(),
  /** Setting a due date on a `followUpScheduled` activity also moves the lead's next follow-up. */
  dueOn: BusinessDateSchema.optional(),
});
export type CreateActivity = z.infer<typeof CreateActivitySchema>;

/* --------------------------------------------------------- queries and results */

export const LEAD_PAGE_SIZE_DEFAULT = 25;
export const LEAD_PAGE_SIZE_MAX = 100;

export const LeadQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(LEAD_PAGE_SIZE_MAX).default(LEAD_PAGE_SIZE_DEFAULT),
  cursor: z.string().min(1).max(200).optional(),
  stage: LeadStageSchema.optional(),
  source: LeadSourceSchema.optional(),
  assignedToAccountId: z.string().min(1).max(200).optional(),
  interestedProjectId: RecordIdSchema.optional(),
  branchId: RecordIdSchema.optional(),
  teamId: RecordIdSchema.optional(),
  /** Anchored prefix match on the name or the phone digits. Never a regular expression. */
  search: z.string().trim().max(80).optional(),
  /** Follow-ups due on or before today, within the actor's scope. */
  followUp: z.enum(['due', 'overdue']).optional(),
});
export type LeadQuery = z.infer<typeof LeadQuerySchema>;

export const LeadPageSchema = z.strictObject({
  items: z.array(LeadSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  nextCursor: z.string().optional(),
});
export type LeadPage = z.infer<typeof LeadPageSchema>;

/**
 * Created leads report a possible duplicate rather than refusing one.
 *
 * Two people really do share a phone number — a household, a company switchboard, a broker calling on
 * behalf of several buyers. Refusing the second lead would lose business; saying nothing would let the
 * same buyer be worked twice by two colleagues. So it is a warning attached to a successful create.
 */
export const CreateLeadResultSchema = z.strictObject({
  lead: LeadSchema,
  possibleDuplicate: z
    .strictObject({
      leadId: RecordIdSchema,
      name: EnteredNameSchema,
      stage: LeadStageSchema,
      assignedToAccountId: z.string(),
    })
    .optional(),
});
export type CreateLeadResult = z.infer<typeof CreateLeadResultSchema>;

/** The CRM dashboard, computed inside the actor's scope by the same filter as the rows. */
export const CrmDashboardSchema = z.strictObject({
  totalLeads: z.number().int().nonnegative(),
  newLeads: z.number().int().nonnegative(),
  dueFollowUps: z.number().int().nonnegative(),
  overdueFollowUps: z.number().int().nonnegative(),
  wonLeads: z.number().int().nonnegative(),
  lostLeads: z.number().int().nonnegative(),
  /** Won ÷ (won + lost), as a decimal string. Zero when nothing has concluded. */
  conversionRate: z.string(),
  byStage: z.record(LeadStageSchema, z.number().int().nonnegative()),
  bySource: z.record(LeadSourceSchema, z.number().int().nonnegative()),
  byOwner: z.array(
    z.strictObject({
      accountId: z.string(),
      total: z.number().int().nonnegative(),
      won: z.number().int().nonnegative(),
    }),
  ),
});
export type CrmDashboard = z.infer<typeof CrmDashboardSchema>;

export const CustomerListSchema = z.strictObject({ items: z.array(CustomerSchema) });
export const ActivityListSchema = z.strictObject({ items: z.array(ActivitySchema) });

export const CRM_AUDIT_ACTIONS = {
  leadCreated: 'crm.lead.created',
  leadUpdated: 'crm.lead.updated',
  leadStageChanged: 'crm.lead.stageChanged',
  leadStageRefused: 'crm.lead.stageRefused',
  leadAssigned: 'crm.lead.assigned',
  activityRecorded: 'crm.activity.recorded',
  customerCreated: 'crm.customer.created',
  customerUpdated: 'crm.customer.updated',
} as const;
