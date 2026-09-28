import { z } from 'zod';
import { BusinessCodeSchema, EnteredNameSchema, RecordIdSchema } from './identifiers';
import { LocalizedLabelSchema } from './localized';
import { BusinessDateSchema, InstantSchema, isValidTimeZone } from './time';

/**
 * Organization structure — `CORE-ORG` (ADR-0019).
 *
 * Owns the hierarchy and the **placement** of a person inside it: legal entity → branch → department →
 * team, plus job titles and the reporting line. It owns neither authentication (that is `SEC`) nor the
 * employee business profile (that is `HR-EMP`, Phase 8).
 *
 * Two references are deliberately **opaque** here:
 *
 * - `accountId` — a security account in `SEC`. `CORE-ORG` never reads or writes account storage.
 * - `employeeRef` — the future `HR-EMP` record. Nothing validates it and nothing stores employee data
 *   against it; it exists so that Phase 8 can join without a migration.
 *
 * `displayName` is the **organization directory label** — the name this placement is listed under on an
 * org chart or an assignment picker. It is not an employee profile, and it is not a substitute for one.
 *
 * This is the structure the data scopes in `SEC` resolve against (SEC-026) and the reporting line the
 * approval engine escalates along (`APPROVAL-005`), which is why the demonstration needs it first.
 */

export const ORG_STATUSES = ['active', 'inactive'] as const;
export const OrgStatusSchema = z.enum(ORG_STATUSES);
export type OrgStatus = z.infer<typeof OrgStatusSchema>;

/** The organization units with a lifecycle (CORE-ORG-001). Placements have their own. */
export const ORG_UNIT_KINDS = ['legalEntity', 'branch', 'department', 'team', 'jobTitle'] as const;
export const OrgUnitKindSchema = z.enum(ORG_UNIT_KINDS);
export type OrgUnitKind = z.infer<typeof OrgUnitKindSchema>;

/**
 * Why a unit is being deactivated or reactivated. Required: an organization change moves data scopes
 * and escalation paths (SEC-026, APPROVAL-005), so it must be explainable afterwards.
 */
export const OrgLifecycleChangeSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});
export type OrgLifecycleChange = z.infer<typeof OrgLifecycleChangeSchema>;

/** Project references carried by a team (CORE-ORG-006). Opaque inventory identifiers. */
export const ProjectRefsSchema = z.array(RecordIdSchema).max(100);

const TimeZoneFieldSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, { message: 'TIME_ZONE_INVALID' });

/** A partial update must change something; an empty body is a client mistake, not a no-op. */
const notEmpty = (value: Record<string, unknown>) =>
  Object.values(value).some((field) => field !== undefined);
const NOT_EMPTY_ISSUE = { message: 'NOTHING_TO_UPDATE' };

/* ------------------------------------------------------------------ legal entity */

export const LegalEntitySchema = z.strictObject({
  legalEntityId: RecordIdSchema,
  code: BusinessCodeSchema,
  name: LocalizedLabelSchema,
  /** ISO 4217. Every money value inside this entity is denominated in it. */
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** IANA zone used to display instants for this entity (ADR-0008). */
  timeZone: TimeZoneFieldSchema,
  /** Shown on documents. Not validated against any registry — that is a Phase 6 concern. */
  taxNumber: z.string().trim().max(40).optional(),
  status: OrgStatusSchema,
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type LegalEntity = z.infer<typeof LegalEntitySchema>;

export const CreateLegalEntitySchema = z.strictObject({
  code: BusinessCodeSchema,
  name: LocalizedLabelSchema,
  currency: LegalEntitySchema.shape.currency,
  timeZone: LegalEntitySchema.shape.timeZone,
  taxNumber: z.string().trim().max(40).optional(),
});
export type CreateLegalEntity = z.infer<typeof CreateLegalEntitySchema>;

/**
 * The currency is not editable: every money value inside the entity is denominated in it, and changing
 * it would silently reinterpret them. The code is not editable either — it is the stable identifier
 * documents and imports refer to.
 */
export const UpdateLegalEntitySchema = z
  .strictObject({
    name: LocalizedLabelSchema.optional(),
    timeZone: TimeZoneFieldSchema.optional(),
    taxNumber: z.string().trim().max(40).optional(),
  })
  .refine(notEmpty, NOT_EMPTY_ISSUE);
export type UpdateLegalEntity = z.infer<typeof UpdateLegalEntitySchema>;

/* ----------------------------------------------------------------------- branch */

export const BranchSchema = z.strictObject({
  branchId: RecordIdSchema,
  legalEntityId: RecordIdSchema,
  code: BusinessCodeSchema,
  name: LocalizedLabelSchema,
  city: LocalizedLabelSchema,
  /** Cost-centre reference for Phase 6 accounting (CORE-ORG-006). Carried, never interpreted here. */
  costCenterCode: BusinessCodeSchema.optional(),
  status: OrgStatusSchema,
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Branch = z.infer<typeof BranchSchema>;

export const CreateBranchSchema = z.strictObject({
  legalEntityId: RecordIdSchema,
  code: BusinessCodeSchema,
  name: LocalizedLabelSchema,
  city: LocalizedLabelSchema,
  costCenterCode: BusinessCodeSchema.optional(),
});
export type CreateBranch = z.infer<typeof CreateBranchSchema>;

export const UpdateBranchSchema = z
  .strictObject({
    name: LocalizedLabelSchema.optional(),
    city: LocalizedLabelSchema.optional(),
    costCenterCode: BusinessCodeSchema.optional(),
  })
  .refine(notEmpty, NOT_EMPTY_ISSUE);
export type UpdateBranch = z.infer<typeof UpdateBranchSchema>;

/* ------------------------------------------------------------------- department */

export const DepartmentSchema = z.strictObject({
  departmentId: RecordIdSchema,
  branchId: RecordIdSchema,
  legalEntityId: RecordIdSchema,
  code: BusinessCodeSchema,
  name: LocalizedLabelSchema,
  /**
   * Cost-centre reference, carried so that Phase 6 accounting can attribute cost without a migration.
   * `CORE-ORG` stores it and gives it no meaning: the chart of accounts is `SD-08`, which is open.
   */
  costCenterCode: BusinessCodeSchema.optional(),
  status: OrgStatusSchema,
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Department = z.infer<typeof DepartmentSchema>;

export const CreateDepartmentSchema = z.strictObject({
  branchId: RecordIdSchema,
  code: BusinessCodeSchema,
  name: LocalizedLabelSchema,
  costCenterCode: BusinessCodeSchema.optional(),
});
export type CreateDepartment = z.infer<typeof CreateDepartmentSchema>;

export const UpdateDepartmentSchema = z
  .strictObject({
    name: LocalizedLabelSchema.optional(),
    costCenterCode: BusinessCodeSchema.optional(),
  })
  .refine(notEmpty, NOT_EMPTY_ISSUE);
export type UpdateDepartment = z.infer<typeof UpdateDepartmentSchema>;

/* ------------------------------------------------------------------------- team */

export const TeamSchema = z.strictObject({
  teamId: RecordIdSchema,
  departmentId: RecordIdSchema,
  branchId: RecordIdSchema,
  legalEntityId: RecordIdSchema,
  code: BusinessCodeSchema,
  name: LocalizedLabelSchema,
  costCenterCode: BusinessCodeSchema.optional(),
  /**
   * The projects this team works on (CORE-ORG-006): the organization side of the `project` data scope.
   * Opaque inventory identifiers — `CORE-ORG` depends on no business module (overview §4 rule 4).
   */
  projectRefs: ProjectRefsSchema,
  status: OrgStatusSchema,
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Team = z.infer<typeof TeamSchema>;

export const CreateTeamSchema = z.strictObject({
  departmentId: RecordIdSchema,
  code: BusinessCodeSchema,
  name: LocalizedLabelSchema,
  costCenterCode: BusinessCodeSchema.optional(),
  projectRefs: ProjectRefsSchema.default([]),
});
export type CreateTeam = z.infer<typeof CreateTeamSchema>;
/** What a caller may pass: `projectRefs` defaults to none. */
export type CreateTeamInput = z.input<typeof CreateTeamSchema>;

export const UpdateTeamSchema = z
  .strictObject({
    name: LocalizedLabelSchema.optional(),
    costCenterCode: BusinessCodeSchema.optional(),
    projectRefs: ProjectRefsSchema.optional(),
  })
  .refine(notEmpty, NOT_EMPTY_ISSUE);
export type UpdateTeam = z.infer<typeof UpdateTeamSchema>;

/* -------------------------------------------------------------------- job title */

export const JobTitleSchema = z.strictObject({
  jobTitleId: RecordIdSchema,
  code: BusinessCodeSchema,
  name: LocalizedLabelSchema,
  status: OrgStatusSchema,
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type JobTitle = z.infer<typeof JobTitleSchema>;

export const CreateJobTitleSchema = z.strictObject({
  code: BusinessCodeSchema,
  name: LocalizedLabelSchema,
});
export type CreateJobTitle = z.infer<typeof CreateJobTitleSchema>;

export const UpdateJobTitleSchema = z.strictObject({ name: LocalizedLabelSchema });
export type UpdateJobTitle = z.infer<typeof UpdateJobTitleSchema>;

/* -------------------------------------------------------------------- placement */

export const PlacementSchema = z.strictObject({
  placementId: RecordIdSchema,
  /** Opaque `SEC` account reference. Absent for a placement that has no system login. */
  accountId: z.string().min(1).max(200).optional(),
  /** Opaque future `HR-EMP` reference. Nothing validates it; no employee data is stored against it. */
  employeeRef: z.string().min(1).max(200).optional(),
  /** Organization directory label — not an employee profile. */
  displayName: EnteredNameSchema,
  legalEntityId: RecordIdSchema,
  branchId: RecordIdSchema,
  departmentId: RecordIdSchema,
  teamId: RecordIdSchema.optional(),
  jobTitleId: RecordIdSchema,
  /** Direct reporting line. Self-reference and cycles are refused when the placement is written. */
  managerPlacementId: RecordIdSchema.optional(),
  status: OrgStatusSchema,
  /** First day the placement is effective, in the organization's calendar (ADR-0008). */
  startedOn: BusinessDateSchema,
  /** Last day it was effective. Present once the placement has ended. */
  endedOn: BusinessDateSchema.optional(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Placement = z.infer<typeof PlacementSchema>;

export const CreatePlacementSchema = z.strictObject({
  accountId: z.string().min(1).max(200).optional(),
  employeeRef: z.string().min(1).max(200).optional(),
  displayName: EnteredNameSchema,
  departmentId: RecordIdSchema,
  teamId: RecordIdSchema.optional(),
  jobTitleId: RecordIdSchema,
  managerPlacementId: RecordIdSchema.optional(),
  startedOn: BusinessDateSchema,
});
export type CreatePlacement = z.infer<typeof CreatePlacementSchema>;

export const UpdatePlacementSchema = z.strictObject({
  displayName: EnteredNameSchema.optional(),
  teamId: RecordIdSchema.optional(),
  jobTitleId: RecordIdSchema.optional(),
  managerPlacementId: RecordIdSchema.optional(),
  status: OrgStatusSchema.optional(),
});
export type UpdatePlacement = z.infer<typeof UpdatePlacementSchema>;

/**
 * Move a placement to another department (and optionally team, title and manager) from a date. The
 * legal entity and branch follow the new department; they are never taken from the request.
 */
export const TransferPlacementSchema = z.strictObject({
  departmentId: RecordIdSchema,
  teamId: RecordIdSchema.optional(),
  jobTitleId: RecordIdSchema.optional(),
  managerPlacementId: RecordIdSchema.optional(),
  effectiveOn: BusinessDateSchema,
  reason: z.string().trim().min(3).max(500),
});
export type TransferPlacement = z.infer<typeof TransferPlacementSchema>;

/** End or resume a placement from a date, with the reason (CORE-ORG-003). */
export const PlacementLifecycleSchema = z.strictObject({
  effectiveOn: BusinessDateSchema.optional(),
  reason: z.string().trim().min(3).max(500),
});
export type PlacementLifecycle = z.infer<typeof PlacementLifecycleSchema>;

export const PLACEMENT_CHANGES = [
  'created',
  'updated',
  'transferred',
  'deactivated',
  'reactivated',
] as const;

/**
 * One entry of a placement's append-only history (CORE-ORG-003). `before` and `after` hold the
 * placement's organization references — department, team, title, manager, status — never personal data.
 */
export const PlacementHistoryEntrySchema = z.strictObject({
  entryId: RecordIdSchema,
  placementId: RecordIdSchema,
  change: z.enum(PLACEMENT_CHANGES),
  effectiveOn: BusinessDateSchema,
  reason: z.string().max(500).optional(),
  before: z.record(z.string(), z.string()).optional(),
  after: z.record(z.string(), z.string()),
  changedBy: z.string().min(1),
  changedAt: InstantSchema,
});
export type PlacementHistoryEntry = z.infer<typeof PlacementHistoryEntrySchema>;

export const PlacementHistoryListSchema = z.strictObject({
  items: z.array(PlacementHistoryEntrySchema),
});

/**
 * A placement and every manager above it, nearest first (CORE-ORG-005). Bounded: a line deeper than
 * the limit is malformed, not tall.
 */
export const ReportingLineSchema = z.strictObject({
  items: z.array(PlacementSchema),
  /** True when the walk stopped at an inactive or not-yet-effective manager. */
  interrupted: z.boolean(),
});
export type ReportingLine = z.infer<typeof ReportingLineSchema>;

/* ------------------------------------------------------- shared scope reference */

/**
 * The organization placement a business record belongs to.
 *
 * Every scoped record — a lead, a reservation, a contract, a receipt — embeds this, because
 * `buildScopeFilter` resolves a data scope against **fields on the record** (SEC-027). Without it a
 * team-scoped or branch-scoped actor fails closed to "no records", which is safe but useless.
 */
export const OrgScopeSchema = z.strictObject({
  legalEntityId: RecordIdSchema,
  branchId: RecordIdSchema,
  departmentId: RecordIdSchema.optional(),
  teamId: RecordIdSchema.optional(),
  projectId: RecordIdSchema.optional(),
});
export type OrgScope = z.infer<typeof OrgScopeSchema>;

/* ----------------------------------------------------------------- list wrappers */

export const LegalEntityListSchema = z.strictObject({ items: z.array(LegalEntitySchema) });
export const BranchListSchema = z.strictObject({ items: z.array(BranchSchema) });
export const DepartmentListSchema = z.strictObject({ items: z.array(DepartmentSchema) });
export const TeamListSchema = z.strictObject({ items: z.array(TeamSchema) });
export const JobTitleListSchema = z.strictObject({ items: z.array(JobTitleSchema) });
export const PlacementListSchema = z.strictObject({ items: z.array(PlacementSchema) });

/** The whole tree in one response — what an organization screen and an assignment picker both need. */
export const OrgChartSchema = z.strictObject({
  legalEntities: z.array(LegalEntitySchema),
  branches: z.array(BranchSchema),
  departments: z.array(DepartmentSchema),
  teams: z.array(TeamSchema),
  jobTitles: z.array(JobTitleSchema),
  placements: z.array(PlacementSchema),
});
export type OrgChart = z.infer<typeof OrgChartSchema>;

/* ---------------------------------------------------------------- people lookup */

/**
 * Turning account references into names (the UI redesign, ADR-0031).
 *
 * Records carry opaque account references — a lead's assignee, a receipt's collector, a contract's
 * sales owner. A screen must show the person, not `acc_…`. The lookup answers only for the
 * references the caller already holds (they came from records the caller was authorized to read),
 * and only with the organization directory label and job title — never contact details, login
 * identifiers, placement or employee data.
 */
export const PEOPLE_LOOKUP_MAX = 100;

export const AccountReferenceSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_:.-]+$/, { message: 'ACCOUNT_REFERENCE_INVALID' });

export const PeopleLookupQuerySchema = z.strictObject({
  /** Comma-separated account references, at most `PEOPLE_LOOKUP_MAX`. */
  ids: z
    .string()
    .min(1)
    .max(PEOPLE_LOOKUP_MAX * 201)
    .transform((value) => [...new Set(value.split(',').filter((id) => id.length > 0))])
    .pipe(z.array(AccountReferenceSchema).min(1).max(PEOPLE_LOOKUP_MAX)),
});

export const PersonReferenceSchema = z.strictObject({
  accountId: z.string().min(1).max(200),
  /** The organization directory label of the person's active placement. */
  displayName: EnteredNameSchema,
  jobTitle: LocalizedLabelSchema.optional(),
});
export type PersonReference = z.infer<typeof PersonReferenceSchema>;

/** References with no active placement are simply absent; the client shows a neutral fallback. */
export const PeopleLookupResultSchema = z.strictObject({
  items: z.array(PersonReferenceSchema),
});
export type PeopleLookupResult = z.infer<typeof PeopleLookupResultSchema>;

export const ORG_AUDIT_ACTIONS = {
  legalEntityCreated: 'org.legalEntity.created',
  branchCreated: 'org.branch.created',
  departmentCreated: 'org.department.created',
  teamCreated: 'org.team.created',
  jobTitleCreated: 'org.jobTitle.created',
  placementCreated: 'org.placement.created',
  placementUpdated: 'org.placement.updated',
  placementDeactivated: 'org.placement.deactivated',
  placementReactivated: 'org.placement.reactivated',
  placementTransferred: 'org.placement.transferred',
} as const;

/** `org.<kind>.updated`, `org.<kind>.deactivated`, `org.<kind>.reactivated` for every unit kind. */
export function orgUnitAuditAction(
  kind: OrgUnitKind,
  change: 'updated' | 'deactivated' | 'reactivated',
): string {
  return `org.${kind}.${change}`;
}
