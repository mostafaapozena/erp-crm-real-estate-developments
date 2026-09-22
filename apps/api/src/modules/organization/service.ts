import {
  BranchSchema,
  DepartmentSchema,
  JobTitleSchema,
  LegalEntitySchema,
  ORG_AUDIT_ACTIONS,
  PlacementSchema,
  TeamSchema,
  type ActorContext,
  type Branch,
  type CreateBranch,
  type CreateDepartment,
  type CreateJobTitle,
  type CreateLegalEntity,
  type CreatePlacement,
  type CreateTeam,
  type Department,
  type JobTitle,
  type LegalEntity,
  type OrgChart,
  type Placement,
  type Team,
  type UpdatePlacement,
} from '@alola/contracts';
import {
  assertSafeFilter,
  buildChangeSummary,
  buildScopeFilter,
  withScope,
  type ScopeFieldMap,
} from '@alola/security';
import type { Connection } from 'mongoose';
import { newId } from '../../platform/ids';
import {
  branchModel,
  departmentModel,
  jobTitleModel,
  legalEntityModel,
  placementModel,
  teamModel,
  type BranchDocument,
  type DepartmentDocument,
  type JobTitleDocument,
  type LegalEntityDocument,
  type PlacementDocument,
  type TeamDocument,
} from './model';

/**
 * Organization service — `CORE-ORG` demonstration slice (ADR-0025).
 *
 * Two jobs beyond storing a hierarchy:
 *
 * 1. **It is what every data scope resolves against.** A `team`-scoped actor is only meaningful once
 *    teams exist and records carry a `teamId`, which is why this module comes before the business ones.
 * 2. **It supplies the reporting line the approval engine escalates along** (`APPROVAL-005`). Before
 *    this existed, an overdue stage was reported as *unresolved* because there was no manager to find.
 *
 * Every mutation is audited. Nothing is deleted: a closed branch or a departed person becomes
 * `inactive` (ADR-0009).
 */

export interface AuditRecorder {
  record(input: {
    action: string;
    outcome: 'succeeded' | 'denied' | 'failed';
    actor: { kind: 'account' | 'system' | 'anonymous'; accountId?: string; roleKeys?: string[] };
    target: { type: string; id?: string };
    changes?: { path: string; from?: string; to?: string }[];
    reason?: string;
    context: {
      correlationId: string;
      ip?: string;
      userAgent?: string;
      method?: string;
      route?: string;
    };
  }): Promise<unknown>;
}

export interface RequestContext {
  correlationId: string;
  ip?: string;
  method?: string;
  route?: string;
}

export class OrgNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(readonly what: string) {
    super('NOT_FOUND');
    this.name = 'OrgNotFoundError';
  }
}

export class OrgCodeConflictError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly code_: string) {
    super('CONFLICT');
    this.name = 'OrgCodeConflictError';
  }
}

export class ReportingCycleError extends Error {
  readonly code = 'VALIDATION_FAILED';
  constructor(readonly placementId: string) {
    super('VALIDATION_FAILED');
    this.name = 'ReportingCycleError';
  }
}

/**
 * Scope mapping for organization records (SEC-026). A department has no owner and no assignee, so the
 * narrow levels (`self`, `assigned`) resolve to nothing rather than to everything — the org chart is
 * read at branch level and above, or not at all.
 */
export const ORG_SCOPE_FIELDS: ScopeFieldMap = {
  team: 'teamId',
  department: 'departmentId',
  branch: 'branchId',
  legalEntity: 'legalEntityId',
};

const PLACEMENT_SCOPE_FIELDS: ScopeFieldMap = {
  owner: 'accountId',
  assignee: 'accountId',
  ...ORG_SCOPE_FIELDS,
};

/** How deep a reporting line may be walked before it is treated as malformed rather than long. */
const MAX_REPORTING_DEPTH = 32;

const iso = (date: Date) => date.toISOString();

function toLegalEntity(d: LegalEntityDocument): LegalEntity {
  return LegalEntitySchema.parse({
    legalEntityId: d.legalEntityId,
    code: d.code,
    name: d.name,
    currency: d.currency,
    timeZone: d.timeZone,
    ...(d.taxNumber ? { taxNumber: d.taxNumber } : {}),
    status: d.status,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

function toBranch(d: BranchDocument): Branch {
  return BranchSchema.parse({
    branchId: d.branchId,
    legalEntityId: d.legalEntityId,
    code: d.code,
    name: d.name,
    city: d.city,
    status: d.status,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

function toDepartment(d: DepartmentDocument): Department {
  return DepartmentSchema.parse({
    departmentId: d.departmentId,
    branchId: d.branchId,
    legalEntityId: d.legalEntityId,
    code: d.code,
    name: d.name,
    ...(d.costCenterCode ? { costCenterCode: d.costCenterCode } : {}),
    status: d.status,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

function toTeam(d: TeamDocument): Team {
  return TeamSchema.parse({
    teamId: d.teamId,
    departmentId: d.departmentId,
    branchId: d.branchId,
    legalEntityId: d.legalEntityId,
    code: d.code,
    name: d.name,
    status: d.status,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

function toJobTitle(d: JobTitleDocument): JobTitle {
  return JobTitleSchema.parse({
    jobTitleId: d.jobTitleId,
    code: d.code,
    name: d.name,
    status: d.status,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

function toPlacement(d: PlacementDocument): Placement {
  return PlacementSchema.parse({
    placementId: d.placementId,
    ...(d.accountId ? { accountId: d.accountId } : {}),
    ...(d.employeeRef ? { employeeRef: d.employeeRef } : {}),
    displayName: d.displayName,
    legalEntityId: d.legalEntityId,
    branchId: d.branchId,
    departmentId: d.departmentId,
    ...(d.teamId ? { teamId: d.teamId } : {}),
    jobTitleId: d.jobTitleId,
    ...(d.managerPlacementId ? { managerPlacementId: d.managerPlacementId } : {}),
    status: d.status,
    startedOn: d.startedOn,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

export class OrganizationService {
  private readonly legalEntities;
  private readonly branches;
  private readonly departments;
  private readonly teams;
  private readonly jobTitles;
  private readonly placements;
  private readonly audit;

  constructor(options: { connection: Connection; audit: AuditRecorder }) {
    this.legalEntities = legalEntityModel(options.connection);
    this.branches = branchModel(options.connection);
    this.departments = departmentModel(options.connection);
    this.teams = teamModel(options.connection);
    this.jobTitles = jobTitleModel(options.connection);
    this.placements = placementModel(options.connection);
    this.audit = options.audit;
  }

  private async recordChange(
    actor: ActorContext,
    action: string,
    target: { type: string; id: string },
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown> | undefined,
    context: RequestContext,
  ): Promise<void> {
    await this.audit.record({
      action,
      outcome: 'succeeded',
      actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
      target,
      changes: buildChangeSummary(before, after),
      context,
    });
  }

  /* ---------------------------------------------------------------- reads */

  async listLegalEntities(actor: ActorContext): Promise<LegalEntity[]> {
    const filter = withScope(buildScopeFilter(actor, { legalEntity: 'legalEntityId' }));
    const documents = await this.legalEntities
      .find(filter)
      .sort({ code: 1 })
      .limit(200)
      .lean<LegalEntityDocument[]>()
      .exec();
    return documents.map(toLegalEntity);
  }

  async listBranches(actor: ActorContext): Promise<Branch[]> {
    const filter = withScope(buildScopeFilter(actor, ORG_SCOPE_FIELDS));
    const documents = await this.branches
      .find(filter)
      .sort({ code: 1 })
      .limit(500)
      .lean<BranchDocument[]>()
      .exec();
    return documents.map(toBranch);
  }

  async listDepartments(actor: ActorContext): Promise<Department[]> {
    const filter = withScope(buildScopeFilter(actor, ORG_SCOPE_FIELDS));
    const documents = await this.departments
      .find(filter)
      .sort({ code: 1 })
      .limit(500)
      .lean<DepartmentDocument[]>()
      .exec();
    return documents.map(toDepartment);
  }

  async listTeams(actor: ActorContext): Promise<Team[]> {
    const filter = withScope(buildScopeFilter(actor, ORG_SCOPE_FIELDS));
    const documents = await this.teams
      .find(filter)
      .sort({ code: 1 })
      .limit(500)
      .lean<TeamDocument[]>()
      .exec();
    return documents.map(toTeam);
  }

  /** Job titles carry no organization placement, so they are not scoped — a title is a vocabulary item. */
  async listJobTitles(): Promise<JobTitle[]> {
    const documents = await this.jobTitles
      .find({})
      .sort({ code: 1 })
      .limit(200)
      .lean<JobTitleDocument[]>()
      .exec();
    return documents.map(toJobTitle);
  }

  async listPlacements(
    actor: ActorContext,
    query: { status?: 'active' | 'inactive'; departmentId?: string; teamId?: string } = {},
  ): Promise<Placement[]> {
    const requested: Record<string, unknown> = {};
    if (query.status) requested['status'] = query.status;
    if (query.departmentId) requested['departmentId'] = query.departmentId;
    if (query.teamId) requested['teamId'] = query.teamId;
    assertSafeFilter(requested);
    const filter = withScope(buildScopeFilter(actor, PLACEMENT_SCOPE_FIELDS), requested);
    const documents = await this.placements
      .find(filter)
      .sort({ displayName: 1, placementId: 1 })
      .limit(500)
      .lean<PlacementDocument[]>()
      .exec();
    return documents.map(toPlacement);
  }

  /** The whole visible tree in one response — an org screen and an assignment picker need the same data. */
  async chart(actor: ActorContext): Promise<OrgChart> {
    const [legalEntities, branches, departments, teams, jobTitles, placements] = await Promise.all([
      this.listLegalEntities(actor),
      this.listBranches(actor),
      this.listDepartments(actor),
      this.listTeams(actor),
      this.listJobTitles(),
      this.listPlacements(actor, { status: 'active' }),
    ]);
    return { legalEntities, branches, departments, teams, jobTitles, placements };
  }

  async getPlacementByAccount(accountId: string): Promise<Placement | undefined> {
    assertSafeFilter({ accountId });
    const document = await this.placements
      .findOne({ accountId, status: 'active' })
      .lean<PlacementDocument>()
      .exec();
    return document ? toPlacement(document) : undefined;
  }

  /**
   * The direct manager's **security account**, for approval escalation (`APPROVAL-005`).
   *
   * Returns nothing when the placement has no manager, when the manager is inactive, or when the
   * manager has no system login — all of which are real situations, and each must be reported as
   * *unresolved* rather than escalated to an invented account (ADR-0024).
   */
  async resolveManagerAccount(accountId: string): Promise<string | undefined> {
    const placement = await this.getPlacementByAccount(accountId);
    if (!placement?.managerPlacementId) return undefined;
    assertSafeFilter({ placementId: placement.managerPlacementId });
    const manager = await this.placements
      .findOne({ placementId: placement.managerPlacementId, status: 'active' })
      .lean<PlacementDocument>()
      .exec();
    return manager?.accountId;
  }

  /* -------------------------------------------------------------- writes */

  async createLegalEntity(
    actor: ActorContext,
    input: CreateLegalEntity,
    context: RequestContext,
  ): Promise<LegalEntity> {
    assertSafeFilter({ code: input.code });
    const existing = await this.legalEntities
      .findOne({ code: input.code })
      .lean<LegalEntityDocument>()
      .exec();
    if (existing) throw new OrgCodeConflictError(input.code);

    const now = new Date();
    const created = await this.legalEntities.create({
      legalEntityId: newId('le'),
      code: input.code,
      name: input.name,
      currency: input.currency,
      timeZone: input.timeZone,
      ...(input.taxNumber ? { taxNumber: input.taxNumber } : {}),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    const entity = toLegalEntity(created.toObject());
    await this.recordChange(
      actor,
      ORG_AUDIT_ACTIONS.legalEntityCreated,
      { type: 'legalEntity', id: entity.legalEntityId },
      undefined,
      { code: entity.code, currency: entity.currency, timeZone: entity.timeZone },
      context,
    );
    return entity;
  }

  async createBranch(
    actor: ActorContext,
    input: CreateBranch,
    context: RequestContext,
  ): Promise<Branch> {
    assertSafeFilter({ legalEntityId: input.legalEntityId, code: input.code });
    const parent = await this.legalEntities
      .findOne({ legalEntityId: input.legalEntityId })
      .lean<LegalEntityDocument>()
      .exec();
    if (!parent) throw new OrgNotFoundError('legalEntity');
    const existing = await this.branches
      .findOne({ legalEntityId: input.legalEntityId, code: input.code })
      .lean<BranchDocument>()
      .exec();
    if (existing) throw new OrgCodeConflictError(input.code);

    const now = new Date();
    const created = await this.branches.create({
      branchId: newId('br'),
      legalEntityId: input.legalEntityId,
      code: input.code,
      name: input.name,
      city: input.city,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    const branch = toBranch(created.toObject());
    await this.recordChange(
      actor,
      ORG_AUDIT_ACTIONS.branchCreated,
      { type: 'branch', id: branch.branchId },
      undefined,
      { code: branch.code, legalEntityId: branch.legalEntityId },
      context,
    );
    return branch;
  }

  async createDepartment(
    actor: ActorContext,
    input: CreateDepartment,
    context: RequestContext,
  ): Promise<Department> {
    assertSafeFilter({ branchId: input.branchId, code: input.code });
    const branch = await this.branches
      .findOne({ branchId: input.branchId })
      .lean<BranchDocument>()
      .exec();
    if (!branch) throw new OrgNotFoundError('branch');
    const existing = await this.departments
      .findOne({ branchId: input.branchId, code: input.code })
      .lean<DepartmentDocument>()
      .exec();
    if (existing) throw new OrgCodeConflictError(input.code);

    const now = new Date();
    const created = await this.departments.create({
      departmentId: newId('dept'),
      branchId: branch.branchId,
      // Denormalized from the branch, never taken from the request: the parent decides the entity.
      legalEntityId: branch.legalEntityId,
      code: input.code,
      name: input.name,
      ...(input.costCenterCode ? { costCenterCode: input.costCenterCode } : {}),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    const department = toDepartment(created.toObject());
    await this.recordChange(
      actor,
      ORG_AUDIT_ACTIONS.departmentCreated,
      { type: 'department', id: department.departmentId },
      undefined,
      { code: department.code, branchId: department.branchId },
      context,
    );
    return department;
  }

  async createTeam(actor: ActorContext, input: CreateTeam, context: RequestContext): Promise<Team> {
    assertSafeFilter({ departmentId: input.departmentId, code: input.code });
    const department = await this.departments
      .findOne({ departmentId: input.departmentId })
      .lean<DepartmentDocument>()
      .exec();
    if (!department) throw new OrgNotFoundError('department');
    const existing = await this.teams
      .findOne({ departmentId: input.departmentId, code: input.code })
      .lean<TeamDocument>()
      .exec();
    if (existing) throw new OrgCodeConflictError(input.code);

    const now = new Date();
    const created = await this.teams.create({
      teamId: newId('team'),
      departmentId: department.departmentId,
      branchId: department.branchId,
      legalEntityId: department.legalEntityId,
      code: input.code,
      name: input.name,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    const team = toTeam(created.toObject());
    await this.recordChange(
      actor,
      ORG_AUDIT_ACTIONS.teamCreated,
      { type: 'team', id: team.teamId },
      undefined,
      { code: team.code, departmentId: team.departmentId },
      context,
    );
    return team;
  }

  async createJobTitle(
    actor: ActorContext,
    input: CreateJobTitle,
    context: RequestContext,
  ): Promise<JobTitle> {
    assertSafeFilter({ code: input.code });
    const existing = await this.jobTitles
      .findOne({ code: input.code })
      .lean<JobTitleDocument>()
      .exec();
    if (existing) throw new OrgCodeConflictError(input.code);

    const now = new Date();
    const created = await this.jobTitles.create({
      jobTitleId: newId('job'),
      code: input.code,
      name: input.name,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    const jobTitle = toJobTitle(created.toObject());
    await this.recordChange(
      actor,
      ORG_AUDIT_ACTIONS.jobTitleCreated,
      { type: 'jobTitle', id: jobTitle.jobTitleId },
      undefined,
      { code: jobTitle.code },
      context,
    );
    return jobTitle;
  }

  /**
   * Walk the reporting line upward from `startId`, refusing a cycle.
   *
   * A cycle is not a theoretical concern: A reports to B, B is later moved under A, and every
   * escalation sweep afterwards loops forever. The check runs **before** the write, so a cycle never
   * reaches storage in the first place.
   */
  private async assertNoReportingCycle(
    placementId: string,
    managerPlacementId: string,
  ): Promise<void> {
    if (managerPlacementId === placementId) throw new ReportingCycleError(placementId);
    let cursor: string | undefined = managerPlacementId;
    for (let depth = 0; cursor && depth < MAX_REPORTING_DEPTH; depth += 1) {
      assertSafeFilter({ placementId: cursor });
      const node: PlacementDocument | null = await this.placements
        .findOne({ placementId: cursor })
        .select({ managerPlacementId: 1 })
        .lean<PlacementDocument>()
        .exec();
      if (!node) throw new OrgNotFoundError('managerPlacement');
      if (node.managerPlacementId === placementId) throw new ReportingCycleError(placementId);
      cursor = node.managerPlacementId;
    }
    // A line deeper than the limit is malformed, not merely tall; refusing is safer than looping.
    if (cursor) throw new ReportingCycleError(placementId);
  }

  async createPlacement(
    actor: ActorContext,
    input: CreatePlacement,
    context: RequestContext,
  ): Promise<Placement> {
    assertSafeFilter({ departmentId: input.departmentId, jobTitleId: input.jobTitleId });
    const department = await this.departments
      .findOne({ departmentId: input.departmentId })
      .lean<DepartmentDocument>()
      .exec();
    if (!department) throw new OrgNotFoundError('department');
    const jobTitle = await this.jobTitles
      .findOne({ jobTitleId: input.jobTitleId })
      .lean<JobTitleDocument>()
      .exec();
    if (!jobTitle) throw new OrgNotFoundError('jobTitle');
    if (input.teamId) {
      assertSafeFilter({ teamId: input.teamId });
      const team = await this.teams
        .findOne({ teamId: input.teamId, departmentId: department.departmentId })
        .lean<TeamDocument>()
        .exec();
      if (!team) throw new OrgNotFoundError('team');
    }

    const placementId = newId('plc');
    if (input.managerPlacementId) {
      await this.assertNoReportingCycle(placementId, input.managerPlacementId);
    }

    const now = new Date();
    const created = await this.placements.create({
      placementId,
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.employeeRef ? { employeeRef: input.employeeRef } : {}),
      displayName: input.displayName,
      legalEntityId: department.legalEntityId,
      branchId: department.branchId,
      departmentId: department.departmentId,
      ...(input.teamId ? { teamId: input.teamId } : {}),
      jobTitleId: input.jobTitleId,
      ...(input.managerPlacementId ? { managerPlacementId: input.managerPlacementId } : {}),
      status: 'active',
      startedOn: input.startedOn,
      createdAt: now,
      updatedAt: now,
    });
    const placement = toPlacement(created.toObject());
    await this.recordChange(
      actor,
      ORG_AUDIT_ACTIONS.placementCreated,
      { type: 'placement', id: placement.placementId },
      undefined,
      {
        departmentId: placement.departmentId,
        jobTitleId: placement.jobTitleId,
        managerPlacementId: placement.managerPlacementId,
      },
      context,
    );
    return placement;
  }

  async updatePlacement(
    actor: ActorContext,
    placementId: string,
    input: UpdatePlacement,
    context: RequestContext,
  ): Promise<Placement> {
    assertSafeFilter({ placementId });
    const before = await this.placements.findOne({ placementId }).lean<PlacementDocument>().exec();
    if (!before) throw new OrgNotFoundError('placement');
    if (input.managerPlacementId) {
      await this.assertNoReportingCycle(placementId, input.managerPlacementId);
    }

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.displayName !== undefined) set['displayName'] = input.displayName;
    if (input.teamId !== undefined) set['teamId'] = input.teamId;
    if (input.jobTitleId !== undefined) set['jobTitleId'] = input.jobTitleId;
    if (input.managerPlacementId !== undefined) {
      set['managerPlacementId'] = input.managerPlacementId;
    }
    if (input.status !== undefined) set['status'] = input.status;

    const updated = await this.placements
      .findOneAndUpdate({ placementId }, { $set: set }, { new: true, runValidators: true })
      .lean<PlacementDocument>()
      .exec();
    if (!updated) throw new OrgNotFoundError('placement');
    const placement = toPlacement(updated);
    await this.recordChange(
      actor,
      input.status === 'inactive'
        ? ORG_AUDIT_ACTIONS.placementDeactivated
        : ORG_AUDIT_ACTIONS.placementUpdated,
      { type: 'placement', id: placementId },
      {
        displayName: before.displayName,
        teamId: before.teamId,
        jobTitleId: before.jobTitleId,
        managerPlacementId: before.managerPlacementId,
        status: before.status,
      },
      {
        displayName: placement.displayName,
        teamId: placement.teamId,
        jobTitleId: placement.jobTitleId,
        managerPlacementId: placement.managerPlacementId,
        status: placement.status,
      },
      context,
    );
    return placement;
  }
}
