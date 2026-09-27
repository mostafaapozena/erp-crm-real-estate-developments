import { ORG_STATUSES } from '@alola/contracts';
import { Schema, type Connection, type Model } from 'mongoose';

/**
 * Organization storage — `CORE-ORG` (ADR-0019), demonstration slice (ADR-0025).
 *
 * Six collections holding the hierarchy and the placement of people inside it. Nothing here is an
 * employee record: a placement carries an **opaque** `employeeRef` that nothing validates and against
 * which no personal data is stored. `HR-EMP` (Phase 8) owns that aggregate.
 *
 * **Nothing is deleted** (ADR-0009). A branch that closes or a person who leaves becomes `inactive`,
 * because contracts, reservations and audit records already point at them and a dangling reference is
 * worse than an inactive one. Deletion middleware refuses every path.
 */
export const LEGAL_ENTITIES_COLLECTION = 'orgLegalEntities';
export const BRANCHES_COLLECTION = 'orgBranches';
export const DEPARTMENTS_COLLECTION = 'orgDepartments';
export const TEAMS_COLLECTION = 'orgTeams';
export const JOB_TITLES_COLLECTION = 'orgJobTitles';
export const PLACEMENTS_COLLECTION = 'orgPlacements';
export const PLACEMENT_HISTORY_COLLECTION = 'orgPlacementHistory';

export class OrgRecordUndeletableError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly operation: string) {
    super(
      `Organization records are deactivated, never deleted: "${operation}" is not permitted (ADR-0009).`,
    );
    this.name = 'OrgRecordUndeletableError';
  }
}

export interface StoredLocalizedLabel {
  ar: string;
  en: string;
}

export interface LegalEntityDocument {
  legalEntityId: string;
  code: string;
  name: StoredLocalizedLabel;
  currency: string;
  timeZone: string;
  taxNumber?: string;
  structureVersion?: number;
  status: (typeof ORG_STATUSES)[number];
  createdAt: Date;
  updatedAt: Date;
}

export interface BranchDocument {
  branchId: string;
  legalEntityId: string;
  code: string;
  name: StoredLocalizedLabel;
  city: StoredLocalizedLabel;
  costCenterCode?: string;
  structureVersion?: number;
  status: (typeof ORG_STATUSES)[number];
  createdAt: Date;
  updatedAt: Date;
}

export interface DepartmentDocument {
  departmentId: string;
  branchId: string;
  legalEntityId: string;
  code: string;
  name: StoredLocalizedLabel;
  costCenterCode?: string;
  structureVersion?: number;
  status: (typeof ORG_STATUSES)[number];
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamDocument {
  teamId: string;
  departmentId: string;
  branchId: string;
  legalEntityId: string;
  code: string;
  name: StoredLocalizedLabel;
  costCenterCode?: string;
  /** Absent on teams created before CORE-ORG-006; read as an empty list. */
  projectRefs?: string[];
  structureVersion?: number;
  status: (typeof ORG_STATUSES)[number];
  createdAt: Date;
  updatedAt: Date;
}

export interface JobTitleDocument {
  jobTitleId: string;
  code: string;
  name: StoredLocalizedLabel;
  structureVersion?: number;
  status: (typeof ORG_STATUSES)[number];
  createdAt: Date;
  updatedAt: Date;
}

export interface PlacementDocument {
  placementId: string;
  accountId?: string;
  employeeRef?: string;
  displayName: string;
  legalEntityId: string;
  branchId: string;
  departmentId: string;
  teamId?: string;
  jobTitleId: string;
  managerPlacementId?: string;
  status: (typeof ORG_STATUSES)[number];
  startedOn: string;
  endedOn?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** One change to a placement, as it happened (CORE-ORG-003). Append-only. */
export interface PlacementHistoryDocument {
  entryId: string;
  placementId: string;
  change: 'created' | 'updated' | 'transferred' | 'deactivated' | 'reactivated';
  effectiveOn: string;
  reason?: string;
  before?: Record<string, string>;
  after: Record<string, string>;
  changedBy: string;
  changedAt: Date;
}

const DELETE_OPS = ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const;
const REWRITE_OPS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
] as const;

const localizedLabel = new Schema(
  { ar: { type: String, required: true }, en: { type: String, required: true } },
  { _id: false },
);

function refuseDeletion<T>(schema: Schema<T>): Schema<T> {
  for (const operation of DELETE_OPS) {
    schema.pre(operation, function rejectDelete() {
      throw new OrgRecordUndeletableError(operation);
    });
  }
  return schema;
}

function legalEntitySchema(): Schema<LegalEntityDocument> {
  const schema = new Schema<LegalEntityDocument>(
    {
      legalEntityId: { type: String, required: true, immutable: true },
      code: { type: String, required: true, immutable: true },
      name: { type: localizedLabel, required: true },
      currency: { type: String, required: true, immutable: true },
      timeZone: { type: String, required: true },
      taxNumber: { type: String },
      status: { type: String, required: true, enum: [...ORG_STATUSES] },
      /** Incremented by every structural change beneath or to the unit — the write that serializes them. */
      structureVersion: { type: Number },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    {
      collection: LEGAL_ENTITIES_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
    },
  );
  schema.index({ legalEntityId: 1 }, { unique: true, name: 'orgLegalEntities_id_unique' });
  schema.index({ code: 1 }, { unique: true, name: 'orgLegalEntities_code_unique' });
  schema.index({ status: 1, code: 1 }, { name: 'orgLegalEntities_status_code' });
  return refuseDeletion(schema);
}

function branchSchema(): Schema<BranchDocument> {
  const schema = new Schema<BranchDocument>(
    {
      branchId: { type: String, required: true, immutable: true },
      legalEntityId: { type: String, required: true, immutable: true },
      code: { type: String, required: true, immutable: true },
      name: { type: localizedLabel, required: true },
      city: { type: localizedLabel, required: true },
      costCenterCode: { type: String },
      status: { type: String, required: true, enum: [...ORG_STATUSES] },
      /** Incremented by every structural change beneath or to the unit — the write that serializes them. */
      structureVersion: { type: Number },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: BRANCHES_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  schema.index({ branchId: 1 }, { unique: true, name: 'orgBranches_id_unique' });
  // Codes are unique per legal entity, not globally: two companies may both have a "CAIRO" branch.
  schema.index(
    { legalEntityId: 1, code: 1 },
    { unique: true, name: 'orgBranches_entity_code_unique' },
  );
  schema.index({ legalEntityId: 1, status: 1 }, { name: 'orgBranches_entity_status' });
  return refuseDeletion(schema);
}

function departmentSchema(): Schema<DepartmentDocument> {
  const schema = new Schema<DepartmentDocument>(
    {
      departmentId: { type: String, required: true, immutable: true },
      branchId: { type: String, required: true, immutable: true },
      legalEntityId: { type: String, required: true, immutable: true },
      code: { type: String, required: true, immutable: true },
      name: { type: localizedLabel, required: true },
      costCenterCode: { type: String },
      status: { type: String, required: true, enum: [...ORG_STATUSES] },
      /** Incremented by every structural change beneath or to the unit — the write that serializes them. */
      structureVersion: { type: Number },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: DEPARTMENTS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  schema.index({ departmentId: 1 }, { unique: true, name: 'orgDepartments_id_unique' });
  schema.index(
    { branchId: 1, code: 1 },
    { unique: true, name: 'orgDepartments_branch_code_unique' },
  );
  schema.index({ legalEntityId: 1, branchId: 1, status: 1 }, { name: 'orgDepartments_scope' });
  // "Does this branch still have active departments?" — asked before a branch is deactivated.
  schema.index({ branchId: 1, status: 1 }, { name: 'orgDepartments_branch_status' });
  return refuseDeletion(schema);
}

function teamSchema(): Schema<TeamDocument> {
  const schema = new Schema<TeamDocument>(
    {
      teamId: { type: String, required: true, immutable: true },
      departmentId: { type: String, required: true, immutable: true },
      branchId: { type: String, required: true, immutable: true },
      legalEntityId: { type: String, required: true, immutable: true },
      code: { type: String, required: true, immutable: true },
      name: { type: localizedLabel, required: true },
      costCenterCode: { type: String },
      projectRefs: { type: [String], default: undefined },
      status: { type: String, required: true, enum: [...ORG_STATUSES] },
      /** Incremented by every structural change beneath or to the unit — the write that serializes them. */
      structureVersion: { type: Number },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: TEAMS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  schema.index({ teamId: 1 }, { unique: true, name: 'orgTeams_id_unique' });
  schema.index({ departmentId: 1, code: 1 }, { unique: true, name: 'orgTeams_dept_code_unique' });
  schema.index({ legalEntityId: 1, branchId: 1, departmentId: 1 }, { name: 'orgTeams_scope' });
  schema.index({ departmentId: 1, status: 1 }, { name: 'orgTeams_department_status' });
  schema.index({ projectRefs: 1 }, { name: 'orgTeams_projects' });
  return refuseDeletion(schema);
}

function jobTitleSchema(): Schema<JobTitleDocument> {
  const schema = new Schema<JobTitleDocument>(
    {
      jobTitleId: { type: String, required: true, immutable: true },
      code: { type: String, required: true, immutable: true },
      name: { type: localizedLabel, required: true },
      status: { type: String, required: true, enum: [...ORG_STATUSES] },
      /** Incremented by every structural change beneath or to the unit — the write that serializes them. */
      structureVersion: { type: Number },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: JOB_TITLES_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  schema.index({ jobTitleId: 1 }, { unique: true, name: 'orgJobTitles_id_unique' });
  schema.index({ code: 1 }, { unique: true, name: 'orgJobTitles_code_unique' });
  return refuseDeletion(schema);
}

function placementSchema(): Schema<PlacementDocument> {
  const schema = new Schema<PlacementDocument>(
    {
      placementId: { type: String, required: true, immutable: true },
      accountId: { type: String },
      employeeRef: { type: String },
      displayName: { type: String, required: true },
      legalEntityId: { type: String, required: true },
      branchId: { type: String, required: true },
      departmentId: { type: String, required: true },
      teamId: { type: String },
      jobTitleId: { type: String, required: true },
      managerPlacementId: { type: String },
      status: { type: String, required: true, enum: [...ORG_STATUSES] },
      startedOn: { type: String, required: true },
      endedOn: { type: String },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: PLACEMENTS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  schema.index({ placementId: 1 }, { unique: true, name: 'orgPlacements_id_unique' });
  /**
   * One **active** placement per security account. Partial, so a person who leaves and returns gets a
   * new placement without the old inactive one blocking it — and so nothing has to be deleted to make
   * room (ADR-0009).
   */
  schema.index(
    { accountId: 1 },
    {
      unique: true,
      name: 'orgPlacements_account_active_unique',
      partialFilterExpression: { accountId: { $type: 'string' }, status: 'active' },
    },
  );
  // Resolving an actor's placement, and therefore their manager, on an escalation sweep.
  schema.index({ accountId: 1, status: 1 }, { name: 'orgPlacements_account_status' });
  schema.index({ managerPlacementId: 1, status: 1 }, { name: 'orgPlacements_manager' });
  schema.index(
    { legalEntityId: 1, branchId: 1, departmentId: 1, teamId: 1 },
    { name: 'orgPlacements_scope' },
  );
  schema.index({ status: 1, displayName: 1 }, { name: 'orgPlacements_status_name' });
  // Asked before a department, team or job title is deactivated.
  schema.index({ departmentId: 1, status: 1 }, { name: 'orgPlacements_department_status' });
  schema.index({ teamId: 1, status: 1 }, { name: 'orgPlacements_team_status' });
  schema.index({ jobTitleId: 1, status: 1 }, { name: 'orgPlacements_jobTitle_status' });
  return refuseDeletion(schema);
}

/**
 * Placement history — append-only (CORE-ORG-003). Every update and deletion path is refused by the
 * model: an organization's past is evidence for the approvals, scopes and escalations it governed.
 */
function placementHistorySchema(): Schema<PlacementHistoryDocument> {
  const schema = new Schema<PlacementHistoryDocument>(
    {
      entryId: { type: String, required: true, immutable: true },
      placementId: { type: String, required: true, immutable: true },
      change: {
        type: String,
        required: true,
        immutable: true,
        enum: ['created', 'updated', 'transferred', 'deactivated', 'reactivated'],
      },
      effectiveOn: { type: String, required: true, immutable: true },
      reason: { type: String, immutable: true },
      before: { type: Schema.Types.Mixed, immutable: true },
      after: { type: Schema.Types.Mixed, required: true, immutable: true },
      changedBy: { type: String, required: true, immutable: true },
      changedAt: { type: Date, required: true, immutable: true },
    },
    {
      collection: PLACEMENT_HISTORY_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
      minimize: false,
    },
  );
  schema.index({ entryId: 1 }, { unique: true, name: 'orgPlacementHistory_id_unique' });
  schema.index(
    { placementId: 1, changedAt: -1, entryId: -1 },
    { name: 'orgPlacementHistory_placement' },
  );
  for (const operation of [...DELETE_OPS, ...REWRITE_OPS]) {
    schema.pre(operation as 'deleteOne', function rejectRewrite() {
      throw new OrgRecordUndeletableError(operation);
    });
  }
  return schema;
}

function model<T>(connection: Connection, name: string, build: () => Schema<T>): Model<T> {
  return (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, build());
}

export function legalEntityModel(connection: Connection): Model<LegalEntityDocument> {
  return model(connection, LEGAL_ENTITIES_COLLECTION, legalEntitySchema);
}

export function branchModel(connection: Connection): Model<BranchDocument> {
  return model(connection, BRANCHES_COLLECTION, branchSchema);
}

export function departmentModel(connection: Connection): Model<DepartmentDocument> {
  return model(connection, DEPARTMENTS_COLLECTION, departmentSchema);
}

export function teamModel(connection: Connection): Model<TeamDocument> {
  return model(connection, TEAMS_COLLECTION, teamSchema);
}

export function jobTitleModel(connection: Connection): Model<JobTitleDocument> {
  return model(connection, JOB_TITLES_COLLECTION, jobTitleSchema);
}

export function placementModel(connection: Connection): Model<PlacementDocument> {
  return model(connection, PLACEMENTS_COLLECTION, placementSchema);
}

export function placementHistoryModel(connection: Connection): Model<PlacementHistoryDocument> {
  return model(connection, PLACEMENT_HISTORY_COLLECTION, placementHistorySchema);
}
