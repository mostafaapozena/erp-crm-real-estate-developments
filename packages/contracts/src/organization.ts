import { z } from 'zod';
import { BusinessCodeSchema, EnteredNameSchema, RecordIdSchema } from './identifiers';
import { LocalizedLabelSchema } from './localized';
import { InstantSchema } from './time';

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

/* ------------------------------------------------------------------ legal entity */

export const LegalEntitySchema = z.strictObject({
  legalEntityId: RecordIdSchema,
  code: BusinessCodeSchema,
  name: LocalizedLabelSchema,
  /** ISO 4217. Every money value inside this entity is denominated in it. */
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** IANA zone used to display instants for this entity (ADR-0008). */
  timeZone: z.string().min(1).max(64),
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

/* ----------------------------------------------------------------------- branch */

export const BranchSchema = z.strictObject({
  branchId: RecordIdSchema,
  legalEntityId: RecordIdSchema,
  code: BusinessCodeSchema,
  name: LocalizedLabelSchema,
  city: LocalizedLabelSchema,
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
});
export type CreateBranch = z.infer<typeof CreateBranchSchema>;

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

/* ------------------------------------------------------------------------- team */

export const TeamSchema = z.strictObject({
  teamId: RecordIdSchema,
  departmentId: RecordIdSchema,
  branchId: RecordIdSchema,
  legalEntityId: RecordIdSchema,
  code: BusinessCodeSchema,
  name: LocalizedLabelSchema,
  status: OrgStatusSchema,
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Team = z.infer<typeof TeamSchema>;

export const CreateTeamSchema = z.strictObject({
  departmentId: RecordIdSchema,
  code: BusinessCodeSchema,
  name: LocalizedLabelSchema,
});
export type CreateTeam = z.infer<typeof CreateTeamSchema>;

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
  startedOn: z.string(),
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
  startedOn: z.string(),
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

export const ORG_AUDIT_ACTIONS = {
  legalEntityCreated: 'org.legalEntity.created',
  branchCreated: 'org.branch.created',
  departmentCreated: 'org.department.created',
  teamCreated: 'org.team.created',
  jobTitleCreated: 'org.jobTitle.created',
  placementCreated: 'org.placement.created',
  placementUpdated: 'org.placement.updated',
  placementDeactivated: 'org.placement.deactivated',
} as const;
