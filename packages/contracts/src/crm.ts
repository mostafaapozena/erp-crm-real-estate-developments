import { z } from 'zod';
import { EnteredNameSchema, NoteSchema, PhoneSchema, RecordIdSchema } from './identifiers';
import { LocaleSchema } from './localized';
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

/** CRM-PERSON-001: a person or a company. Records written before BMP-1 carry no kind and read as `individual`. */
export const CUSTOMER_KINDS = ['individual', 'company'] as const;
export const CustomerKindSchema = z.enum(CUSTOMER_KINDS);
export type CustomerKind = z.infer<typeof CustomerKindSchema>;

/** CRM-PERSON-002. Which identifier is mandatory, and when, is `BD-34`; none is required here. */
export const IDENTITY_TYPES = [
  'nationalId',
  'passport',
  'commercialRegistration',
  'taxNumber',
] as const;
export const IdentityTypeSchema = z.enum(IDENTITY_TYPES);
export type IdentityType = z.infer<typeof IdentityTypeSchema>;

/**
 * An identity document number, as entered. Letters, digits, spaces and hyphens only — never
 * reformatted, displayed verbatim and isolated (ADR-0003), and matched for duplicates on its
 * letters and digits alone.
 */
export const CustomerIdentitySchema = z.strictObject({
  type: IdentityTypeSchema,
  number: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 -]*$/, { message: 'IDENTITY_NUMBER_EXPECTED' }),
  /** ISO 3166-1 alpha-2, for a passport. */
  issuingCountry: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
});
export type CustomerIdentity = z.infer<typeof CustomerIdentitySchema>;

/** Letters and digits of an identity number, upper-cased — the form duplicates are matched on. */
export function normalizeIdentityNumber(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/** An e-mail address in the form duplicates are matched on. The entered form is what is displayed. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** CRM-PERSON-003. The channels a customer can be contacted through, and consent is recorded for. */
export const CONTACT_CHANNELS = ['phone', 'whatsapp', 'sms', 'email'] as const;
export const ContactChannelSchema = z.enum(CONTACT_CHANNELS);
export type ContactChannel = z.infer<typeof ContactChannelSchema>;

/** How a consent was captured. The wording and the mandatory mechanism are `SD-09` / `BD-21`. */
export const CONSENT_SOURCES = ['verbal', 'writtenForm', 'onlineForm', 'import'] as const;
export const ConsentSourceSchema = z.enum(CONSENT_SOURCES);

/** The consent in force for one channel: the latest entry of an append-only history. */
export const ConsentStateSchema = z.strictObject({
  channel: ContactChannelSchema,
  granted: z.boolean(),
  source: ConsentSourceSchema,
  recordedAt: InstantSchema,
  recordedBy: z.string().min(1).max(200),
});
export type ConsentState = z.infer<typeof ConsentStateSchema>;

export const CustomerSchema = z.strictObject({
  customerId: RecordIdSchema,
  kind: CustomerKindSchema,
  name: EnteredNameSchema,
  /** The name in the other script, when the customer uses one — entered, never transliterated. */
  alternateName: EnteredNameSchema.optional(),
  primaryPhone: PhoneSchema,
  secondaryPhone: PhoneSchema.optional(),
  email: z.string().trim().email().max(254).optional(),
  /**
   * Field-restricted (SEC-029): absent for an actor without `crm.customer.viewIdentity`, on every read,
   * list and export. A record written before BMP-1 exposes its legacy national ID here.
   */
  identity: CustomerIdentitySchema.optional(),
  address: z.string().trim().max(400).optional(),
  city: z.string().trim().max(80).optional(),
  preferredLanguage: LocaleSchema.optional(),
  preferredChannel: ContactChannelSchema.optional(),
  /** Consent in force per channel. A channel with no entry has no recorded consent. */
  consents: z.array(ConsentStateSchema),
  legalEntityId: RecordIdSchema,
  branchId: RecordIdSchema,
  departmentId: RecordIdSchema.optional(),
  teamId: RecordIdSchema.optional(),
  /** The sales owner. `self`- and `assigned`-scoped actors resolve against this. */
  ownerAccountId: z.string().min(1).max(200),
  version: z.number().int().positive(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Customer = z.infer<typeof CustomerSchema>;

export const CreateCustomerSchema = z.strictObject({
  kind: CustomerKindSchema.default('individual'),
  name: EnteredNameSchema,
  alternateName: EnteredNameSchema.optional(),
  primaryPhone: PhoneSchema,
  secondaryPhone: PhoneSchema.optional(),
  email: z.string().trim().email().max(254).optional(),
  identity: CustomerIdentitySchema.optional(),
  address: z.string().trim().max(400).optional(),
  city: z.string().trim().max(80).optional(),
  preferredLanguage: LocaleSchema.optional(),
  preferredChannel: ContactChannelSchema.optional(),
  branchId: RecordIdSchema,
  /** Naming another owner needs `crm.customer.transfer`; without it the creator owns the customer. */
  ownerAccountId: z.string().min(1).max(200).optional(),
});
export type CreateCustomer = z.input<typeof CreateCustomerSchema>;

/**
 * CRM-PERSON-005: a correction. It states why and the version it read; a stale version is a
 * conflict, never a silent overwrite. Owner, branch and legal entity are not corrected here — the
 * owner moves by transfer, and the placement is fixed by the records that depend on it.
 */
export const UpdateCustomerSchema = z.strictObject({
  kind: CustomerKindSchema.optional(),
  name: EnteredNameSchema.optional(),
  alternateName: EnteredNameSchema.optional(),
  primaryPhone: PhoneSchema.optional(),
  secondaryPhone: PhoneSchema.optional(),
  email: z.string().trim().email().max(254).optional(),
  identity: CustomerIdentitySchema.optional(),
  address: z.string().trim().max(400).optional(),
  city: z.string().trim().max(80).optional(),
  preferredLanguage: LocaleSchema.optional(),
  preferredChannel: ContactChannelSchema.optional(),
  reason: z.string().trim().min(3).max(500),
  expectedVersion: z.number().int().positive(),
});
export type UpdateCustomer = z.infer<typeof UpdateCustomerSchema>;

export const RecordConsentSchema = z.strictObject({
  channel: ContactChannelSchema,
  granted: z.boolean(),
  source: ConsentSourceSchema,
  note: z.string().trim().max(500).optional(),
});
export type RecordConsent = z.infer<typeof RecordConsentSchema>;

/** CRM-OWNER-001: hand a customer to another owner, with a reason kept in the history. */
export const TransferOwnershipSchema = z.strictObject({
  toAccountId: z.string().min(1).max(200),
  reason: z.string().trim().min(3).max(500),
});
export type TransferOwnership = z.infer<typeof TransferOwnershipSchema>;

export const CUSTOMER_PAGE_SIZE_DEFAULT = 25;
export const CUSTOMER_PAGE_SIZE_MAX = 100;

export const CustomerQuerySchema = z.strictObject({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(CUSTOMER_PAGE_SIZE_MAX)
    .default(CUSTOMER_PAGE_SIZE_DEFAULT),
  cursor: z.string().min(1).max(200).optional(),
  /** Anchored prefix match on the name or the phone digits. Never a regular expression. */
  search: z.string().trim().max(80).optional(),
  kind: CustomerKindSchema.optional(),
  branchId: RecordIdSchema.optional(),
  ownerAccountId: z.string().min(1).max(200).optional(),
});
export type CustomerQuery = z.infer<typeof CustomerQuerySchema>;

export const CustomerPageSchema = z.strictObject({
  items: z.array(CustomerSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  nextCursor: z.string().optional(),
});
export type CustomerPage = z.infer<typeof CustomerPageSchema>;

/** What a duplicate matched on. */
export const DUPLICATE_MATCHES = ['phone', 'email', 'identity'] as const;
export const DuplicateMatchSchema = z.enum(DUPLICATE_MATCHES);

/**
 * CRM-PERSON-006. Candidates are shown **only inside the actor's scope**; matches outside it are
 * counted, never described, so a duplicate check cannot become a way to read another branch's
 * customers. Merging is not performed: the rule is `BD-26`.
 */
export const DuplicateReportSchema = z.strictObject({
  candidates: z.array(
    z.strictObject({
      customerId: RecordIdSchema,
      name: EnteredNameSchema,
      matchedOn: z.array(DuplicateMatchSchema).min(1),
    }),
  ),
  outOfScopeMatches: z.number().int().nonnegative(),
});
export type DuplicateReport = z.infer<typeof DuplicateReportSchema>;

export const DuplicateCheckSchema = z
  .strictObject({
    primaryPhone: PhoneSchema.optional(),
    email: z.string().trim().email().max(254).optional(),
    identityNumber: z.string().trim().min(3).max(40).optional(),
    branchId: RecordIdSchema,
  })
  .refine((value) => value.primaryPhone ?? value.email ?? value.identityNumber, {
    message: 'NOTHING_TO_CHECK',
  });
export type DuplicateCheck = z.infer<typeof DuplicateCheckSchema>;

/** One ownership change, append-only (CRM-OWNER-001). */
export const OwnershipChangeSchema = z.strictObject({
  changeId: RecordIdSchema,
  subjectType: z.enum(['customer', 'lead', 'opportunity']),
  subjectId: RecordIdSchema,
  fromAccountId: z.string().max(200).optional(),
  toAccountId: z.string().min(1).max(200),
  reason: z.string().max(500),
  actorAccountId: z.string().min(1).max(200),
  occurredAt: InstantSchema,
});
export type OwnershipChange = z.infer<typeof OwnershipChangeSchema>;
export const OwnershipHistorySchema = z.strictObject({ items: z.array(OwnershipChangeSchema) });

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

/** CRM-LEAD-004. The facts a qualification records; none of them is a score the product invents. */
export const QUALIFICATION_TIMEFRAMES = [
  'immediate',
  'withinThreeMonths',
  'withinSixMonths',
  'later',
  'unknown',
] as const;
export const QUALIFICATION_PURPOSES = ['residence', 'investment', 'business', 'unknown'] as const;
export const DECISION_ROLES = ['decisionMaker', 'influencer', 'unknown'] as const;

export const LeadQualificationSchema = z.strictObject({
  budgetConfirmed: z.boolean(),
  timeframe: z.enum(QUALIFICATION_TIMEFRAMES),
  purpose: z.enum(QUALIFICATION_PURPOSES),
  decisionRole: z.enum(DECISION_ROLES),
  notes: NoteSchema.optional(),
  qualifiedAt: InstantSchema,
  qualifiedBy: z.string().min(1).max(200),
});
export type LeadQualification = z.infer<typeof LeadQualificationSchema>;

/** A reason code from the deployment's `lossReasons` reference list (CRM-LOSS-001). */
export const ReasonCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/, { message: 'REFERENCE_CODE_EXPECTED' });

export const LeadSchema = z.strictObject({
  leadId: RecordIdSchema,
  name: EnteredNameSchema,
  primaryPhone: PhoneSchema,
  secondaryPhone: PhoneSchema.optional(),
  email: z.string().trim().email().max(254).optional(),
  /** The **original** source — immutable, so attribution to where the enquiry began survives (CRM-LEAD-002). */
  source: LeadSourceSchema,
  /** The source now credited, when it differs from the original. Every change is on the timeline. */
  currentSource: LeadSourceSchema.optional(),
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
  /** The `lossReasons` reference code, when one was chosen. */
  lostReasonCode: ReasonCodeSchema.optional(),
  /** Kept for later contact after a loss or a pause (CRM-LOSS-001). */
  nurture: z.boolean(),
  qualification: LeadQualificationSchema.optional(),
  /** Set once the lead becomes a customer. The lead itself is kept as history. */
  customerId: RecordIdSchema.optional(),
  convertedAt: InstantSchema.optional(),
  /** The last activity of any kind — what an ageing report reads (CRM-REPORT-001). */
  lastActivityAt: InstantSchema.optional(),
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
  /** Re-credit the lead to another source. The original `source` never changes. */
  currentSource: LeadSourceSchema.optional(),
  interestedProjectId: RecordIdSchema.optional(),
  preferredPropertyType: PropertyTypeSchema.optional(),
  preferredUsageType: UsageTypeSchema.optional(),
  budgetMin: MoneySchema.optional(),
  budgetMax: MoneySchema.optional(),
  notes: NoteSchema.optional(),
  nextFollowUpOn: BusinessDateSchema.optional(),
  nurture: z.boolean().optional(),
  expectedVersion: z.number().int().positive().optional(),
});
export type UpdateLead = z.infer<typeof UpdateLeadSchema>;

export const ChangeLeadStageSchema = z.strictObject({
  stage: LeadStageSchema,
  /** Mandatory for `lost`; the service refuses the move without it. */
  reason: z.string().trim().max(500).optional(),
  /** A `lossReasons` code for `lost`; checked against the active reference items. */
  reasonCode: ReasonCodeSchema.optional(),
  /** Keep a lost lead for later contact. */
  nurture: z.boolean().optional(),
  expectedVersion: z.number().int().positive().optional(),
});
export type ChangeLeadStage = z.infer<typeof ChangeLeadStageSchema>;

export const QualifyLeadSchema = z.strictObject({
  budgetConfirmed: z.boolean(),
  timeframe: z.enum(QUALIFICATION_TIMEFRAMES),
  purpose: z.enum(QUALIFICATION_PURPOSES),
  decisionRole: z.enum(DECISION_ROLES),
  notes: NoteSchema.optional(),
  expectedVersion: z.number().int().positive().optional(),
});
export type QualifyLead = z.infer<typeof QualifyLeadSchema>;

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
  'email',
  'sms',
  'qualified',
  'sourceChanged',
  'customerCorrected',
  'ownerChanged',
  'consentRecorded',
] as const;
export const ActivityKindSchema = z.enum(ACTIVITY_KINDS);
export type ActivityKind = z.infer<typeof ActivityKindSchema>;

/** The kinds a person records by hand; the rest are written by the system as things happen. */
export const MANUAL_ACTIVITY_KINDS = [
  'note',
  'call',
  'whatsapp',
  'email',
  'sms',
  'meeting',
  'siteVisit',
  'followUpScheduled',
] as const;

/**
 * Append-only. A timeline is what a sales manager reads to judge whether a record is being worked.
 * An activity belongs to a lead, a customer or an opportunity — at least one (CRM-ACTIVITY-001).
 */
export const ActivitySchema = z.strictObject({
  activityId: RecordIdSchema,
  leadId: RecordIdSchema.optional(),
  customerId: RecordIdSchema.optional(),
  opportunityId: RecordIdSchema.optional(),
  kind: ActivityKindSchema,
  body: NoteSchema.optional(),
  /** Stage codes of a lead or an opportunity, as the timeline shows them. */
  fromStage: z.string().max(40).optional(),
  toStage: z.string().max(40).optional(),
  dueOn: BusinessDateSchema.optional(),
  actorAccountId: z.string().min(1).max(200).optional(),
  occurredAt: InstantSchema,
});
export type Activity = z.infer<typeof ActivitySchema>;

export const CreateActivitySchema = z.strictObject({
  kind: z.enum(MANUAL_ACTIVITY_KINDS),
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
  customerId: RecordIdSchema.optional(),
  nurture: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
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
  /**
   * The most recent open lead in the same legal entity sharing the phone or e-mail. Reported only
   * when it is inside the creator's scope; otherwise only `outOfScopeMatches` counts it.
   */
  possibleDuplicate: z
    .strictObject({
      leadId: RecordIdSchema,
      name: EnteredNameSchema,
      stage: LeadStageSchema,
      assignedToAccountId: z.string(),
      matchedOn: z.array(DuplicateMatchSchema).min(1),
    })
    .optional(),
  /** An existing customer with the same phone or e-mail, inside the creator's scope. */
  existingCustomer: z
    .strictObject({ customerId: RecordIdSchema, name: EnteredNameSchema })
    .optional(),
  outOfScopeMatches: z.number().int().nonnegative(),
});
export type CreateLeadResult = z.infer<typeof CreateLeadResultSchema>;

/**
 * Age bands of **open** leads by creation date, in days (CRM-REPORT-001). They describe how old the
 * work is; they are not a service-level target, which no one has set (`SD-04`).
 */
export const LEAD_AGE_BANDS = ['upTo7', 'upTo30', 'upTo90', 'over90'] as const;

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
  openByAge: z.record(z.enum(LEAD_AGE_BANDS), z.number().int().nonnegative()),
  /** Open leads with no activity recorded since they were created. */
  untouchedOpenLeads: z.number().int().nonnegative(),
});
export type CrmDashboard = z.infer<typeof CrmDashboardSchema>;

/* ----------------------------------------------------------------- opportunity */

/**
 * CRM-OPP-001: an opportunity is one prospective sale to one customer — several can run at once, for
 * different projects or unit types. It is its own record: a lead is an enquiry, a reservation is a
 * commitment, and an opportunity is the negotiation in between.
 *
 * The stage codes are the product's; their labels are relabelled per deployment and any win
 * probability per stage is configuration (`BD-27`) — none is shipped.
 */
export const OPPORTUNITY_STAGES = [
  'discovery',
  'unitSelection',
  'proposal',
  'negotiation',
  'reservation',
  'won',
  'lost',
] as const;
export const OpportunityStageSchema = z.enum(OPPORTUNITY_STAGES);
export type OpportunityStage = z.infer<typeof OpportunityStageSchema>;

/** The stages a person moves an opportunity between. `reservation` and `won` are set by sales. */
export const OPEN_OPPORTUNITY_STAGES = [
  'discovery',
  'unitSelection',
  'proposal',
  'negotiation',
] as const;
export const TERMINAL_OPPORTUNITY_STAGES: readonly OpportunityStage[] = ['won', 'lost'];

/**
 * Permitted moves. Backwards moves in the middle are allowed, as for leads. `reservation` is entered
 * only by creating a reservation, and `won` only by activating its contract; a cancelled reservation
 * returns the opportunity to `negotiation`. `lost` needs a reason and may be reopened.
 */
export const OPPORTUNITY_TRANSITIONS: Readonly<
  Record<OpportunityStage, readonly OpportunityStage[]>
> = {
  discovery: ['unitSelection', 'proposal', 'negotiation', 'reservation', 'lost'],
  unitSelection: ['discovery', 'proposal', 'negotiation', 'reservation', 'lost'],
  proposal: ['discovery', 'unitSelection', 'negotiation', 'reservation', 'lost'],
  negotiation: ['unitSelection', 'proposal', 'reservation', 'lost'],
  reservation: ['negotiation', 'won', 'lost'],
  won: [],
  lost: ['discovery'],
};

export function canTransitionOpportunity(from: OpportunityStage, to: OpportunityStage): boolean {
  return OPPORTUNITY_TRANSITIONS[from].includes(to);
}

/** Stages only the sales workflow may set; a person asking for them is refused. */
export const SYSTEM_OPPORTUNITY_STAGES: readonly OpportunityStage[] = ['reservation', 'won'];

export const OpportunitySchema = z.strictObject({
  opportunityId: RecordIdSchema,
  customerId: RecordIdSchema,
  /** The enquiry it came from, when there was one. */
  leadId: RecordIdSchema.optional(),
  /** Attribution copied from the lead and never changed afterwards (CRM-LEAD-002, MM §9 rule 14). */
  source: LeadSourceSchema.optional(),
  campaignId: RecordIdSchema.optional(),
  projectId: RecordIdSchema.optional(),
  propertyType: PropertyTypeSchema.optional(),
  usageType: UsageTypeSchema.optional(),
  budgetMin: MoneySchema.optional(),
  budgetMax: MoneySchema.optional(),
  /** What the sale is expected to be worth, as entered. Never computed from a guessed probability. */
  expectedValue: MoneySchema.optional(),
  expectedCloseOn: BusinessDateSchema.optional(),
  stage: OpportunityStageSchema,
  /**
   * The configured win probability for the stage, as a decimal percentage string. Absent unless the
   * deployment configured one (`sales.opportunityStageProbabilities`, `BD-27`).
   */
  probability: z.string().optional(),
  lostReason: z.string().max(500).optional(),
  lostReasonCode: ReasonCodeSchema.optional(),
  /** The reservation that took it to `reservation`, and the contract that won it. Opaque to CRM. */
  reservationId: RecordIdSchema.optional(),
  contractId: RecordIdSchema.optional(),
  notes: NoteSchema.optional(),
  ownerAccountId: z.string().min(1).max(200),
  legalEntityId: RecordIdSchema,
  branchId: RecordIdSchema,
  departmentId: RecordIdSchema.optional(),
  teamId: RecordIdSchema.optional(),
  stageChangedAt: InstantSchema,
  closedAt: InstantSchema.optional(),
  version: z.number().int().positive(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Opportunity = z.infer<typeof OpportunitySchema>;

const opportunityDetails = {
  projectId: RecordIdSchema.optional(),
  propertyType: PropertyTypeSchema.optional(),
  usageType: UsageTypeSchema.optional(),
  budgetMin: MoneySchema.optional(),
  budgetMax: MoneySchema.optional(),
  expectedValue: MoneySchema.optional(),
  expectedCloseOn: BusinessDateSchema.optional(),
  notes: NoteSchema.optional(),
};

export const CreateOpportunitySchema = z.strictObject({
  customerId: RecordIdSchema,
  ...opportunityDetails,
  /** Naming another owner needs `crm.opportunity.assign`; without it the creator owns it. */
  ownerAccountId: z.string().min(1).max(200).optional(),
});
export type CreateOpportunity = z.infer<typeof CreateOpportunitySchema>;

export const UpdateOpportunitySchema = z.strictObject({
  ...opportunityDetails,
  expectedVersion: z.number().int().positive(),
});
export type UpdateOpportunity = z.infer<typeof UpdateOpportunitySchema>;

export const ChangeOpportunityStageSchema = z.strictObject({
  stage: OpportunityStageSchema,
  reason: z.string().trim().max(500).optional(),
  reasonCode: ReasonCodeSchema.optional(),
  expectedVersion: z.number().int().positive(),
});
export type ChangeOpportunityStage = z.infer<typeof ChangeOpportunityStageSchema>;

export const AssignOpportunitySchema = TransferOwnershipSchema;

/** What a lead's conversion may also open: an opportunity from the lead's own preferences. */
export const ConvertLeadSchema = z.strictObject({
  opportunity: z
    .strictObject({
      expectedValue: MoneySchema.optional(),
      expectedCloseOn: BusinessDateSchema.optional(),
      notes: NoteSchema.optional(),
    })
    .optional(),
});
export type ConvertLead = z.infer<typeof ConvertLeadSchema>;

/** CRM-LEAD-005. Idempotent: converting a converted lead returns the customer it already has. */
export const ConvertLeadResultSchema = z.strictObject({
  lead: LeadSchema,
  customer: CustomerSchema,
  /** False when the lead was already converted, or an existing customer matched its phone. */
  customerCreated: z.boolean(),
  /** The opportunity opened by this conversion, when one was asked for. */
  opportunity: OpportunitySchema.optional(),
});

export const OPPORTUNITY_PAGE_SIZE_DEFAULT = 25;
export const OPPORTUNITY_PAGE_SIZE_MAX = 100;

export const OpportunityQuerySchema = z.strictObject({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(OPPORTUNITY_PAGE_SIZE_MAX)
    .default(OPPORTUNITY_PAGE_SIZE_DEFAULT),
  cursor: z.string().min(1).max(200).optional(),
  stage: OpportunityStageSchema.optional(),
  /** `open` is every stage that is neither won nor lost. */
  status: z.enum(['open', 'won', 'lost']).optional(),
  customerId: RecordIdSchema.optional(),
  projectId: RecordIdSchema.optional(),
  ownerAccountId: z.string().min(1).max(200).optional(),
});
export type OpportunityQuery = z.infer<typeof OpportunityQuerySchema>;

export const OpportunityPageSchema = z.strictObject({
  items: z.array(OpportunitySchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  nextCursor: z.string().optional(),
});
export type OpportunityPage = z.infer<typeof OpportunityPageSchema>;

/**
 * The pipeline in the actor's scope (CRM-REPORT-001): counts and expected value per stage, summed by
 * the database in `Decimal128` and never across currencies. A weighted value appears only when win
 * probabilities are configured; the product does not forecast on a guess.
 */
export const OpportunitySummarySchema = z.strictObject({
  byStage: z.array(
    z.strictObject({
      stage: OpportunityStageSchema,
      count: z.number().int().nonnegative(),
      expectedValue: z.array(MoneySchema),
    }),
  ),
  open: z.number().int().nonnegative(),
  /** Present only with configured probabilities: Σ expected value × probability, per currency. */
  weightedOpenValue: z.array(MoneySchema).optional(),
  probabilitiesConfigured: z.boolean(),
});
export type OpportunitySummary = z.infer<typeof OpportunitySummarySchema>;

export const CustomerListSchema = CustomerPageSchema;
export const ActivityListSchema = z.strictObject({ items: z.array(ActivitySchema) });

export const CRM_AUDIT_ACTIONS = {
  leadCreated: 'crm.lead.created',
  leadUpdated: 'crm.lead.updated',
  leadStageChanged: 'crm.lead.stageChanged',
  leadStageRefused: 'crm.lead.stageRefused',
  leadAssigned: 'crm.lead.assigned',
  /** Work refused to a colleague who could not do it — a lead assignment or a customer transfer. */
  ownerAssignmentRefused: 'crm.owner.assignmentRefused',
  leadQualified: 'crm.lead.qualified',
  leadConverted: 'crm.lead.converted',
  activityRecorded: 'crm.activity.recorded',
  customerCreated: 'crm.customer.created',
  customerUpdated: 'crm.customer.updated',
  customerCorrected: 'crm.customer.corrected',
  customerOwnerTransferred: 'crm.customer.ownerTransferred',
  consentRecorded: 'crm.customer.consentRecorded',
  opportunityCreated: 'crm.opportunity.created',
  opportunityUpdated: 'crm.opportunity.updated',
  opportunityStageChanged: 'crm.opportunity.stageChanged',
  opportunityStageRefused: 'crm.opportunity.stageRefused',
  opportunityAssigned: 'crm.opportunity.assigned',
} as const;
