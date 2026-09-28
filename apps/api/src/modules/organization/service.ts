import {
  BranchSchema,
  BusinessDateSchema,
  DepartmentSchema,
  JobTitleSchema,
  LegalEntitySchema,
  ORG_AUDIT_ACTIONS,
  PlacementHistoryEntrySchema,
  PlacementSchema,
  TeamSchema,
  businessDateInZone,
  nowInstant,
  orgUnitAuditAction,
  type ActorContext,
  type Branch,
  type BusinessDate,
  type CreateBranch,
  type CreateDepartment,
  type CreateJobTitle,
  type CreateLegalEntity,
  type CreatePlacement,
  type CreateTeamInput,
  type Department,
  type JobTitle,
  type LegalEntity,
  type OrgChart,
  type OrgUnitKind,
  type PersonReference,
  type Placement,
  type PlacementHistoryEntry,
  type PlacementLifecycle,
  type ReportingLine,
  type Team,
  type TransferPlacement,
  type UpdateBranch,
  type UpdateDepartment,
  type UpdateJobTitle,
  type UpdateLegalEntity,
  type UpdatePlacement,
  type UpdateTeam,
} from '@alola/contracts';
import {
  assertSafeFilter,
  buildChangeSummary,
  buildScopeFilter,
  withScope,
  type ScopeFieldMap,
} from '@alola/security';
import type { ClientSession, Connection, Model } from 'mongoose';
import {
  DomainError,
  auditActor,
  conflict,
  isDuplicateKeyError,
  type AuditRecorder as PlatformAuditRecorder,
  type RequestContext as PlatformRequestContext,
} from '../../platform/audit-port';
import { newId } from '../../platform/ids';
import { withTransaction } from '../../platform/transactions';
import {
  branchModel,
  departmentModel,
  jobTitleModel,
  legalEntityModel,
  placementHistoryModel,
  placementModel,
  teamModel,
  type BranchDocument,
  type DepartmentDocument,
  type JobTitleDocument,
  type LegalEntityDocument,
  type PlacementDocument,
  type PlacementHistoryDocument,
  type TeamDocument,
} from './model';

/**
 * Organization service — `CORE-ORG` foundation (CORE-ORG-001 … 006, ADR-0019).
 *
 * The hierarchy every data scope resolves against (SEC-026), and the reporting line the approval
 * engine and the task foundation escalate along (APPROVAL-005, CORE-TASK-003). Three rules shape it:
 *
 * 1. **Writes are scoped like reads** (CORE-ORG-004). A branch-scoped administrator changes their
 *    branch and nothing else; a unit outside the scope is answered `404`, exactly like an absent one
 *    (SEC-030). Legal entities and job titles are deployment-wide, so only an `all`-scoped actor may
 *    change them.
 * 2. **Nothing referenced is deleted** (CORE-ORG-001, ADR-0009). A unit becomes `inactive`, and only
 *    once nothing active hangs beneath it. A child is only ever created under an active parent.
 * 3. **The structure changes atomically.** Creating a child "touches" its parent inside the same
 *    transaction, and deactivating a parent writes the same document, so a deactivation and a
 *    concurrent creation beneath it can never both succeed: MongoDB serializes the two writes and the
 *    loser retries against the new state.
 *
 * Placements are effective-dated and every change to one appends to its history (CORE-ORG-003).
 */

export type AuditRecorder = PlatformAuditRecorder;
export type RequestContext = PlatformRequestContext;

export class OrgNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(readonly what: string) {
    super('NOT_FOUND');
    this.name = 'OrgNotFoundError';
  }
}

export class OrgCodeConflictError extends Error {
  readonly code = 'CONFLICT';
  readonly issues;
  constructor(readonly code_: string) {
    super('CONFLICT');
    this.name = 'OrgCodeConflictError';
    this.issues = [{ path: ['code'], code: 'CODE_TAKEN' }];
  }
}

export class ReportingCycleError extends Error {
  readonly code = 'VALIDATION_FAILED';
  readonly issues;
  constructor(readonly placementId: string) {
    super('VALIDATION_FAILED');
    this.name = 'ReportingCycleError';
    this.issues = [{ path: ['managerPlacementId'], code: 'REPORTING_CYCLE' }];
  }
}

/**
 * Scope mapping for organization records (SEC-026). A department has no owner and no assignee, so the
 * narrow levels (`self`, `assigned`) resolve to nothing rather than to everything — the org chart is
 * read at team level and above, or not at all.
 */
export const ORG_SCOPE_FIELDS: ScopeFieldMap = {
  team: 'teamId',
  department: 'departmentId',
  branch: 'branchId',
  legalEntity: 'legalEntityId',
};

const LEGAL_ENTITY_SCOPE_FIELDS: ScopeFieldMap = { legalEntity: 'legalEntityId' };

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
    ...(d.costCenterCode ? { costCenterCode: d.costCenterCode } : {}),
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
    ...(d.costCenterCode ? { costCenterCode: d.costCenterCode } : {}),
    projectRefs: d.projectRefs ?? [],
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
    ...(d.endedOn ? { endedOn: d.endedOn } : {}),
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

function toHistoryEntry(d: PlacementHistoryDocument): PlacementHistoryEntry {
  return PlacementHistoryEntrySchema.parse({
    entryId: d.entryId,
    placementId: d.placementId,
    change: d.change,
    effectiveOn: d.effectiveOn,
    ...(d.reason ? { reason: d.reason } : {}),
    ...(d.before ? { before: d.before } : {}),
    after: d.after,
    changedBy: d.changedBy,
    changedAt: iso(d.changedAt),
  });
}

/** The organization references of a placement — what its history records. Never personal data. */
function placementRefs(d: PlacementDocument): Record<string, string> {
  return {
    legalEntityId: d.legalEntityId,
    branchId: d.branchId,
    departmentId: d.departmentId,
    ...(d.teamId ? { teamId: d.teamId } : {}),
    jobTitleId: d.jobTitleId,
    ...(d.managerPlacementId ? { managerPlacementId: d.managerPlacementId } : {}),
    status: d.status,
    startedOn: d.startedOn,
    ...(d.endedOn ? { endedOn: d.endedOn } : {}),
  };
}

type UnitDocument =
  LegalEntityDocument | BranchDocument | DepartmentDocument | TeamDocument | JobTitleDocument;

interface UnitSpec {
  model: Model<UnitDocument>;
  idField: string;
  /** Scope mapping on this unit's own collection; `undefined` means deployment-wide (`all` only). */
  scopeFields: ScopeFieldMap | undefined;
  parent?: { kind: OrgUnitKind; field: string };
  /** Collections whose active rows block a deactivation. */
  children: { model: Model<unknown>; field: string }[];
}

export interface OrganizationServiceOptions {
  connection: Connection;
  audit: AuditRecorder;
  /** Today in the organization's calendar (ADR-0008). Defaults to UTC. */
  today?: () => BusinessDate;
}

export class OrganizationService {
  private readonly legalEntities;
  private readonly branches;
  private readonly departments;
  private readonly teams;
  private readonly jobTitles;
  private readonly placements;
  private readonly history;
  private readonly audit;
  private readonly connection;
  private readonly today: () => BusinessDate;
  private readonly units: Record<OrgUnitKind, UnitSpec>;

  constructor(options: OrganizationServiceOptions) {
    this.connection = options.connection;
    this.legalEntities = legalEntityModel(options.connection);
    this.branches = branchModel(options.connection);
    this.departments = departmentModel(options.connection);
    this.teams = teamModel(options.connection);
    this.jobTitles = jobTitleModel(options.connection);
    this.placements = placementModel(options.connection);
    this.history = placementHistoryModel(options.connection);
    this.audit = options.audit;
    this.today = options.today ?? (() => businessDateInZone(nowInstant(), 'UTC'));
    const asUnit = <T>(model: Model<T>) => model as unknown as Model<UnitDocument>;
    const asAny = <T>(model: Model<T>) => model as unknown as Model<unknown>;
    this.units = {
      legalEntity: {
        model: asUnit(this.legalEntities),
        idField: 'legalEntityId',
        scopeFields: undefined,
        children: [{ model: asAny(this.branches), field: 'legalEntityId' }],
      },
      branch: {
        model: asUnit(this.branches),
        idField: 'branchId',
        scopeFields: ORG_SCOPE_FIELDS,
        parent: { kind: 'legalEntity', field: 'legalEntityId' },
        children: [{ model: asAny(this.departments), field: 'branchId' }],
      },
      department: {
        model: asUnit(this.departments),
        idField: 'departmentId',
        scopeFields: ORG_SCOPE_FIELDS,
        parent: { kind: 'branch', field: 'branchId' },
        children: [
          { model: asAny(this.teams), field: 'departmentId' },
          { model: asAny(this.placements), field: 'departmentId' },
        ],
      },
      team: {
        model: asUnit(this.teams),
        idField: 'teamId',
        scopeFields: ORG_SCOPE_FIELDS,
        parent: { kind: 'department', field: 'departmentId' },
        children: [{ model: asAny(this.placements), field: 'teamId' }],
      },
      jobTitle: {
        model: asUnit(this.jobTitles),
        idField: 'jobTitleId',
        scopeFields: undefined,
        children: [{ model: asAny(this.placements), field: 'jobTitleId' }],
      },
    };
  }

  /* -------------------------------------------------------------- helpers */

  private async record(
    actor: ActorContext,
    action: string,
    target: { type: string; id: string },
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown> | undefined,
    context: RequestContext,
    session?: ClientSession,
    reason?: string,
  ): Promise<void> {
    await this.audit.record(
      {
        action,
        outcome: 'succeeded',
        actor: auditActor(actor),
        target,
        changes: buildChangeSummary(before, after),
        ...(reason ? { reason } : {}),
        context,
      },
      session ? { session } : undefined,
    );
  }

  /** Deployment-wide units — legal entities and job titles — change only under the `all` scope. */
  private assertDeploymentWide(actor: ActorContext): void {
    if (actor.scope.level !== 'all') throw new DomainError('FORBIDDEN');
  }

  /** The filter that finds `id` of `kind` **inside the actor's scope**, or nothing. */
  private scopedUnitFilter(actor: ActorContext, kind: OrgUnitKind, id: string) {
    const spec = this.units[kind];
    assertSafeFilter({ [spec.idField]: id });
    const target = { [spec.idField]: id };
    if (!spec.scopeFields) {
      this.assertDeploymentWide(actor);
      return target;
    }
    return withScope(buildScopeFilter(actor, spec.scopeFields), target);
  }

  /**
   * Lock-by-write: bump the parent's structure version inside the caller's transaction, refusing an
   * absent, out-of-scope or inactive parent. A concurrent deactivation writes the same document, so
   * the two cannot both commit.
   */
  private async touchActiveParent<T extends UnitDocument>(
    actor: ActorContext | undefined,
    kind: OrgUnitKind,
    id: string,
    session: ClientSession,
  ): Promise<T> {
    const spec = this.units[kind];
    assertSafeFilter({ [spec.idField]: id });
    const base = actor
      ? this.scopedUnitFilter(actor, kind, id)
      : ({ [spec.idField]: id } as Record<string, unknown>);
    const touched = await spec.model
      .findOneAndUpdate(
        { $and: [base, { status: 'active' }] },
        { $inc: { structureVersion: 1 } },
        { returnDocument: 'after', session },
      )
      .lean<T>()
      .exec();
    if (touched) return touched;
    // Distinguish "inactive" (a conflict the caller can act on) from "absent or out of scope" (404).
    const exists = await spec.model.findOne(base).session(session).lean<T>().exec();
    if (!exists) throw new OrgNotFoundError(kind);
    throw conflict('PARENT_INACTIVE', [spec.idField]);
  }

  private async insertUnit<T>(
    model: Model<T>,
    document: Record<string, unknown>,
    code: string,
    session: ClientSession,
  ): Promise<T> {
    try {
      const insertable = model as unknown as Model<Record<string, unknown>>;
      const [created] = await insertable.create([document], { session });
      if (!created) throw new Error('Insert returned no document.');
      return created.toObject() as unknown as T;
    } catch (error) {
      if (isDuplicateKeyError(error)) throw new OrgCodeConflictError(code);
      throw error;
    }
  }

  /* ---------------------------------------------------------------- reads */

  async listLegalEntities(actor: ActorContext): Promise<LegalEntity[]> {
    const filter = withScope(buildScopeFilter(actor, LEGAL_ENTITY_SCOPE_FIELDS));
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

  /**
   * One branch, unscoped, for another module resolving where a record it is creating belongs.
   *
   * Deliberately not scope-filtered: the caller has already been authorized for its own operation, and
   * a record's placement must be derived from the organization rather than trusted from a request. The
   * only thing exposed is the branch's own identifiers, and only for an **active** branch.
   */
  async findBranch(
    branchId: string,
  ): Promise<{ branchId: string; legalEntityId: string } | undefined> {
    assertSafeFilter({ branchId });
    const document = await this.branches
      .findOne({ branchId, status: 'active' })
      .lean<BranchDocument>()
      .exec();
    return document
      ? { branchId: document.branchId, legalEntityId: document.legalEntityId }
      : undefined;
  }

  /**
   * Names for account references the caller already holds (ADR-0031).
   *
   * Deliberately **not** scope-filtered, and deliberately narrow. A sales representative must see who
   * owns a lead in their branch even when that colleague's placement is outside their own scope, and
   * the answer is only what the organization directory already labels the person with: the display
   * name and the job title of an **active** placement. No contact detail, login identifier, placement
   * reference or employee data is returned, and nothing is returned for a reference that is not
   * asked for — account references are random, so there is nothing to enumerate.
   */
  async lookupPeople(accountIds: readonly string[]): Promise<PersonReference[]> {
    if (accountIds.length === 0) return [];
    const ids = [...new Set(accountIds)];
    for (const accountId of ids) assertSafeFilter({ accountId });
    const placements = await this.placements
      .find({ accountId: { $in: ids }, status: 'active' })
      .sort({ startedOn: -1, placementId: 1 })
      .limit(ids.length * 2)
      .lean<PlacementDocument[]>()
      .exec();
    const titleIds = [...new Set(placements.map((placement) => placement.jobTitleId))];
    const titles = titleIds.length
      ? await this.jobTitles
          .find({ jobTitleId: { $in: titleIds } })
          .lean<JobTitleDocument[]>()
          .exec()
      : [];
    const titleById = new Map(titles.map((title) => [title.jobTitleId, title.name]));
    const people = new Map<string, PersonReference>();
    for (const placement of placements) {
      if (!placement.accountId || people.has(placement.accountId)) continue;
      const jobTitle = titleById.get(placement.jobTitleId);
      people.set(placement.accountId, {
        accountId: placement.accountId,
        displayName: placement.displayName,
        ...(jobTitle ? { jobTitle: { ar: jobTitle.ar, en: jobTitle.en } } : {}),
      });
    }
    return [...people.values()];
  }

  async getPlacementByAccount(accountId: string): Promise<Placement | undefined> {
    assertSafeFilter({ accountId });
    const document = await this.placements
      .findOne({ accountId, status: 'active' })
      .lean<PlacementDocument>()
      .exec();
    return document ? toPlacement(document) : undefined;
  }

  /** True when a placement is active and effective today — started, and not ended. */
  private isEffective(placement: PlacementDocument, today: BusinessDate): boolean {
    return (
      placement.status === 'active' &&
      placement.startedOn <= today &&
      (placement.endedOn === undefined || placement.endedOn >= today)
    );
  }

  /**
   * The direct manager's **security account**, for escalation (`APPROVAL-005`, `CORE-TASK-003`).
   *
   * Returns nothing when the placement has no manager, when the manager is inactive or not yet
   * effective, or when the manager has no system login — all real situations, and each must be
   * reported as *unresolved* rather than escalated to an invented or skipped-over account (ADR-0024).
   */
  async resolveManagerAccount(accountId: string): Promise<string | undefined> {
    const placement = await this.getPlacementByAccount(accountId);
    if (!placement?.managerPlacementId) return undefined;
    assertSafeFilter({ placementId: placement.managerPlacementId });
    const manager = await this.placements
      .findOne({ placementId: placement.managerPlacementId })
      .lean<PlacementDocument>()
      .exec();
    if (!manager || !this.isEffective(manager, this.today())) return undefined;
    return manager.accountId;
  }

  private async findScopedPlacement(
    actor: ActorContext,
    placementId: string,
    session?: ClientSession,
  ): Promise<PlacementDocument> {
    assertSafeFilter({ placementId });
    const query = this.placements.findOne(
      withScope(buildScopeFilter(actor, PLACEMENT_SCOPE_FIELDS), { placementId }),
    );
    if (session) query.session(session);
    const document = await query.lean<PlacementDocument>().exec();
    if (!document) throw new OrgNotFoundError('placement');
    return document;
  }

  async getPlacement(actor: ActorContext, placementId: string): Promise<Placement> {
    return toPlacement(await this.findScopedPlacement(actor, placementId));
  }

  async placementHistory(
    actor: ActorContext,
    placementId: string,
  ): Promise<PlacementHistoryEntry[]> {
    await this.findScopedPlacement(actor, placementId);
    const rows = await this.history
      .find({ placementId })
      .sort({ changedAt: -1, entryId: -1 })
      .limit(500)
      .lean<PlacementHistoryDocument[]>()
      .exec();
    return rows.map(toHistoryEntry);
  }

  /**
   * The placement and the managers above it, nearest first (CORE-ORG-005). The walk stops — marked
   * `interrupted` — at a manager that is inactive, not yet effective, or outside the actor's scope:
   * a line the actor may not see is not revealed by walking up to it.
   */
  async reportingLine(actor: ActorContext, placementId: string): Promise<ReportingLine> {
    const start = await this.findScopedPlacement(actor, placementId);
    const items: Placement[] = [toPlacement(start)];
    const today = this.today();
    const scope = buildScopeFilter(actor, PLACEMENT_SCOPE_FIELDS);
    let cursor = start.managerPlacementId;
    let interrupted = false;
    for (let depth = 0; cursor && depth < MAX_REPORTING_DEPTH; depth += 1) {
      assertSafeFilter({ placementId: cursor });
      const manager: PlacementDocument | null = await this.placements
        .findOne(withScope(scope, { placementId: cursor }))
        .lean<PlacementDocument>()
        .exec();
      if (!manager || !this.isEffective(manager, today)) {
        interrupted = true;
        break;
      }
      items.push(toPlacement(manager));
      cursor = manager.managerPlacementId;
    }
    return { items, interrupted };
  }

  /* ------------------------------------------------------------ unit writes */

  async createLegalEntity(
    actor: ActorContext,
    input: CreateLegalEntity,
    context: RequestContext,
  ): Promise<LegalEntity> {
    this.assertDeploymentWide(actor);
    assertSafeFilter({ code: input.code });
    return withTransaction(this.connection, async (session) => {
      const now = new Date();
      const created = await this.insertUnit<LegalEntityDocument>(
        this.legalEntities,
        {
          legalEntityId: newId('le'),
          code: input.code,
          name: input.name,
          currency: input.currency,
          timeZone: input.timeZone,
          ...(input.taxNumber ? { taxNumber: input.taxNumber } : {}),
          status: 'active',
          createdAt: now,
          updatedAt: now,
        },
        input.code,
        session,
      );
      const entity = toLegalEntity(created);
      await this.record(
        actor,
        ORG_AUDIT_ACTIONS.legalEntityCreated,
        { type: 'legalEntity', id: entity.legalEntityId },
        undefined,
        { code: entity.code, currency: entity.currency, timeZone: entity.timeZone },
        context,
        session,
      );
      return entity;
    });
  }

  async createBranch(
    actor: ActorContext,
    input: CreateBranch,
    context: RequestContext,
  ): Promise<Branch> {
    assertSafeFilter({ legalEntityId: input.legalEntityId, code: input.code });
    return withTransaction(this.connection, async (session) => {
      // The legal entity must be active and inside the actor's legal-entity scope.
      const parentFilter = withScope(buildScopeFilter(actor, LEGAL_ENTITY_SCOPE_FIELDS), {
        legalEntityId: input.legalEntityId,
      });
      const parent = await this.legalEntities
        .findOneAndUpdate(
          { $and: [parentFilter, { status: 'active' }] },
          { $inc: { structureVersion: 1 } },
          { returnDocument: 'after', session },
        )
        .lean<LegalEntityDocument>()
        .exec();
      if (!parent) {
        const exists = await this.legalEntities
          .findOne(parentFilter)
          .session(session)
          .lean()
          .exec();
        if (!exists) throw new OrgNotFoundError('legalEntity');
        throw conflict('PARENT_INACTIVE', ['legalEntityId']);
      }
      const now = new Date();
      const created = await this.insertUnit<BranchDocument>(
        this.branches,
        {
          branchId: newId('br'),
          legalEntityId: parent.legalEntityId,
          code: input.code,
          name: input.name,
          city: input.city,
          ...(input.costCenterCode ? { costCenterCode: input.costCenterCode } : {}),
          status: 'active',
          createdAt: now,
          updatedAt: now,
        },
        input.code,
        session,
      );
      const branch = toBranch(created);
      await this.record(
        actor,
        ORG_AUDIT_ACTIONS.branchCreated,
        { type: 'branch', id: branch.branchId },
        undefined,
        { code: branch.code, legalEntityId: branch.legalEntityId },
        context,
        session,
      );
      return branch;
    });
  }

  async createDepartment(
    actor: ActorContext,
    input: CreateDepartment,
    context: RequestContext,
  ): Promise<Department> {
    assertSafeFilter({ branchId: input.branchId, code: input.code });
    return withTransaction(this.connection, async (session) => {
      const branch = await this.touchActiveParent<BranchDocument>(
        actor,
        'branch',
        input.branchId,
        session,
      );
      const now = new Date();
      const created = await this.insertUnit<DepartmentDocument>(
        this.departments,
        {
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
        },
        input.code,
        session,
      );
      const department = toDepartment(created);
      await this.record(
        actor,
        ORG_AUDIT_ACTIONS.departmentCreated,
        { type: 'department', id: department.departmentId },
        undefined,
        { code: department.code, branchId: department.branchId },
        context,
        session,
      );
      return department;
    });
  }

  async createTeam(
    actor: ActorContext,
    input: CreateTeamInput,
    context: RequestContext,
  ): Promise<Team> {
    assertSafeFilter({ departmentId: input.departmentId, code: input.code });
    return withTransaction(this.connection, async (session) => {
      const department = await this.touchActiveParent<DepartmentDocument>(
        actor,
        'department',
        input.departmentId,
        session,
      );
      const now = new Date();
      const created = await this.insertUnit<TeamDocument>(
        this.teams,
        {
          teamId: newId('team'),
          departmentId: department.departmentId,
          branchId: department.branchId,
          legalEntityId: department.legalEntityId,
          code: input.code,
          name: input.name,
          ...(input.costCenterCode ? { costCenterCode: input.costCenterCode } : {}),
          projectRefs: input.projectRefs ?? [],
          status: 'active',
          createdAt: now,
          updatedAt: now,
        },
        input.code,
        session,
      );
      const team = toTeam(created);
      await this.record(
        actor,
        ORG_AUDIT_ACTIONS.teamCreated,
        { type: 'team', id: team.teamId },
        undefined,
        { code: team.code, departmentId: team.departmentId },
        context,
        session,
      );
      return team;
    });
  }

  async createJobTitle(
    actor: ActorContext,
    input: CreateJobTitle,
    context: RequestContext,
  ): Promise<JobTitle> {
    this.assertDeploymentWide(actor);
    assertSafeFilter({ code: input.code });
    return withTransaction(this.connection, async (session) => {
      const now = new Date();
      const created = await this.insertUnit<JobTitleDocument>(
        this.jobTitles,
        {
          jobTitleId: newId('job'),
          code: input.code,
          name: input.name,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        },
        input.code,
        session,
      );
      const jobTitle = toJobTitle(created);
      await this.record(
        actor,
        ORG_AUDIT_ACTIONS.jobTitleCreated,
        { type: 'jobTitle', id: jobTitle.jobTitleId },
        undefined,
        { code: jobTitle.code },
        context,
        session,
      );
      return jobTitle;
    });
  }

  /**
   * Change a unit's editable fields — never its code, its parent or (for a legal entity) its currency,
   * which the update schemas do not even accept. The unit must be inside the actor's scope.
   */
  private async updateUnit<T extends UnitDocument>(
    kind: OrgUnitKind,
    actor: ActorContext,
    id: string,
    changes: Record<string, unknown>,
    context: RequestContext,
  ): Promise<T> {
    const spec = this.units[kind];
    const filter = this.scopedUnitFilter(actor, kind, id);
    const set = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined),
    );
    return withTransaction(this.connection, async (session) => {
      const before = await spec.model.findOne(filter).session(session).lean<T>().exec();
      if (!before) throw new OrgNotFoundError(kind);
      const updated = await spec.model
        .findOneAndUpdate(
          filter,
          { $set: { ...set, updatedAt: new Date() } },
          { returnDocument: 'after', session, runValidators: true },
        )
        .lean<T>()
        .exec();
      if (!updated) throw new OrgNotFoundError(kind);
      const pick = (document: T) =>
        Object.fromEntries(
          Object.keys(set).map((key) => [
            key,
            (document as unknown as Record<string, unknown>)[key],
          ]),
        );
      await this.record(
        actor,
        orgUnitAuditAction(kind, 'updated'),
        { type: kind, id },
        pick(before),
        pick(updated),
        context,
        session,
      );
      return updated;
    });
  }

  async updateLegalEntity(
    actor: ActorContext,
    id: string,
    input: UpdateLegalEntity,
    context: RequestContext,
  ): Promise<LegalEntity> {
    return toLegalEntity(
      await this.updateUnit<LegalEntityDocument>('legalEntity', actor, id, input, context),
    );
  }

  async updateBranch(
    actor: ActorContext,
    id: string,
    input: UpdateBranch,
    context: RequestContext,
  ): Promise<Branch> {
    return toBranch(await this.updateUnit<BranchDocument>('branch', actor, id, input, context));
  }

  async updateDepartment(
    actor: ActorContext,
    id: string,
    input: UpdateDepartment,
    context: RequestContext,
  ): Promise<Department> {
    return toDepartment(
      await this.updateUnit<DepartmentDocument>('department', actor, id, input, context),
    );
  }

  async updateTeam(
    actor: ActorContext,
    id: string,
    input: UpdateTeam,
    context: RequestContext,
  ): Promise<Team> {
    return toTeam(await this.updateUnit<TeamDocument>('team', actor, id, input, context));
  }

  async updateJobTitle(
    actor: ActorContext,
    id: string,
    input: UpdateJobTitle,
    context: RequestContext,
  ): Promise<JobTitle> {
    return toJobTitle(
      await this.updateUnit<JobTitleDocument>('jobTitle', actor, id, input, context),
    );
  }

  /**
   * Deactivate or reactivate a unit (CORE-ORG-001, CORE-ORG-002).
   *
   * Deactivation is refused while anything active hangs beneath the unit — a branch with an active
   * department, a department with an active team or placement, a job title someone still holds.
   * Reactivation is refused while the parent is inactive. Both run in one transaction whose write to
   * the unit conflicts with any concurrent creation beneath it.
   */
  async setUnitStatus(
    kind: OrgUnitKind,
    actor: ActorContext,
    id: string,
    to: 'active' | 'inactive',
    reason: string,
    context: RequestContext,
  ): Promise<LegalEntity | Branch | Department | Team | JobTitle> {
    const spec = this.units[kind];
    const filter = this.scopedUnitFilter(actor, kind, id);
    const from = to === 'active' ? 'inactive' : 'active';
    const updated = await withTransaction(this.connection, async (session) => {
      const current = await spec.model.findOne(filter).session(session).lean<UnitDocument>().exec();
      if (!current) throw new OrgNotFoundError(kind);
      if (current.status === to) {
        throw conflict(to === 'active' ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE', ['status']);
      }
      if (to === 'inactive') {
        for (const child of spec.children) {
          const active = await child.model
            .countDocuments({ [child.field]: id, status: 'active' })
            .session(session)
            .exec();
          if (active > 0) throw conflict('ACTIVE_CHILDREN', ['status']);
        }
      } else if (spec.parent) {
        const parentId = (current as unknown as Record<string, string | undefined>)[
          spec.parent.field
        ];
        if (!parentId) throw new OrgNotFoundError(spec.parent.kind);
        // Unscoped: the unit is already in scope, and its parent's state is a fact about the unit.
        await this.touchActiveParent(undefined, spec.parent.kind, parentId, session);
      }
      const result = await spec.model
        .findOneAndUpdate(
          { $and: [filter, { status: from }] },
          { $set: { status: to, updatedAt: new Date() }, $inc: { structureVersion: 1 } },
          { returnDocument: 'after', session },
        )
        .lean<UnitDocument>()
        .exec();
      if (!result) throw conflict('STALE_STATE', ['status']);
      await this.record(
        actor,
        orgUnitAuditAction(kind, to === 'active' ? 'reactivated' : 'deactivated'),
        { type: kind, id },
        { status: from },
        { status: to },
        context,
        session,
        reason,
      );
      return result;
    });
    switch (kind) {
      case 'legalEntity':
        return toLegalEntity(updated as LegalEntityDocument);
      case 'branch':
        return toBranch(updated as BranchDocument);
      case 'department':
        return toDepartment(updated as DepartmentDocument);
      case 'team':
        return toTeam(updated as TeamDocument);
      case 'jobTitle':
        return toJobTitle(updated as JobTitleDocument);
    }
  }

  /* -------------------------------------------------------- placement writes */

  /**
   * Walk the reporting line upward from `managerPlacementId`, refusing a cycle and an inactive
   * manager. A cycle is not theoretical: A reports to B, B is later moved under A, and every
   * escalation sweep afterwards loops. The check runs **before** the write.
   */
  private async assertValidManager(
    placementId: string,
    managerPlacementId: string,
    session: ClientSession,
  ): Promise<void> {
    if (managerPlacementId === placementId) throw new ReportingCycleError(placementId);
    assertSafeFilter({ placementId: managerPlacementId });
    const manager = await this.placements
      .findOne({ placementId: managerPlacementId })
      .session(session)
      .lean<PlacementDocument>()
      .exec();
    if (!manager) throw new OrgNotFoundError('managerPlacement');
    if (manager.status !== 'active') throw conflict('MANAGER_INACTIVE', ['managerPlacementId']);
    let cursor: string | undefined = manager.managerPlacementId;
    for (let depth = 0; cursor && depth < MAX_REPORTING_DEPTH; depth += 1) {
      if (cursor === placementId) throw new ReportingCycleError(placementId);
      assertSafeFilter({ placementId: cursor });
      const node: PlacementDocument | null = await this.placements
        .findOne({ placementId: cursor })
        .select({ managerPlacementId: 1 })
        .session(session)
        .lean<PlacementDocument>()
        .exec();
      cursor = node?.managerPlacementId;
    }
    // A line deeper than the limit is malformed, not merely tall; refusing is safer than looping.
    if (cursor) throw new ReportingCycleError(placementId);
  }

  /** Touch the team (it must belong to the department and be active) inside the transaction. */
  private async touchTeamOf(
    departmentId: string,
    teamId: string,
    session: ClientSession,
  ): Promise<void> {
    const team = await this.touchActiveParent<TeamDocument>(undefined, 'team', teamId, session);
    if (team.departmentId !== departmentId) throw conflict('TEAM_NOT_IN_DEPARTMENT', ['teamId']);
  }

  private async appendHistory(
    entry: Omit<PlacementHistoryDocument, 'entryId' | 'changedAt'>,
    session: ClientSession,
  ): Promise<void> {
    await this.history.create([{ ...entry, entryId: newId('plh'), changedAt: new Date() }], {
      session,
    });
  }

  async createPlacement(
    actor: ActorContext,
    input: CreatePlacement,
    context: RequestContext,
  ): Promise<Placement> {
    assertSafeFilter({ departmentId: input.departmentId, jobTitleId: input.jobTitleId });
    const placementId = newId('plc');
    try {
      return await withTransaction(this.connection, async (session) => {
        const department = await this.touchActiveParent<DepartmentDocument>(
          actor,
          'department',
          input.departmentId,
          session,
        );
        await this.touchActiveParent(undefined, 'jobTitle', input.jobTitleId, session);
        if (input.teamId) await this.touchTeamOf(department.departmentId, input.teamId, session);
        if (input.managerPlacementId) {
          await this.assertValidManager(placementId, input.managerPlacementId, session);
        }
        const now = new Date();
        const [created] = await this.placements.create(
          [
            {
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
            },
          ],
          { session },
        );
        if (!created) throw new Error('Placement insert returned no document.');
        const document = created.toObject();
        await this.appendHistory(
          {
            placementId,
            change: 'created',
            effectiveOn: input.startedOn,
            after: placementRefs(document),
            changedBy: actor.accountId,
          },
          session,
        );
        await this.record(
          actor,
          ORG_AUDIT_ACTIONS.placementCreated,
          { type: 'placement', id: placementId },
          undefined,
          placementRefs(document),
          context,
          session,
        );
        return toPlacement(document);
      });
    } catch (error) {
      // One active placement per security account: the partial unique index decides.
      if (isDuplicateKeyError(error)) throw conflict('ACCOUNT_ALREADY_PLACED', ['accountId']);
      throw error;
    }
  }

  async updatePlacement(
    actor: ActorContext,
    placementId: string,
    input: UpdatePlacement,
    context: RequestContext,
  ): Promise<Placement> {
    // A status change is a lifecycle event with its own rules and history entry.
    if (input.status !== undefined) {
      const { status, ...rest } = input;
      if (Object.values(rest).some((value) => value !== undefined)) {
        await this.updatePlacement(actor, placementId, rest, context);
      }
      return status === 'inactive'
        ? this.deactivatePlacement(actor, placementId, { reason: 'status set by update' }, context)
        : this.reactivatePlacement(actor, placementId, { reason: 'status set by update' }, context);
    }
    return withTransaction(this.connection, async (session) => {
      const before = await this.findScopedPlacement(actor, placementId, session);
      if (input.teamId !== undefined) {
        await this.touchTeamOf(before.departmentId, input.teamId, session);
      }
      if (input.jobTitleId !== undefined) {
        await this.touchActiveParent(undefined, 'jobTitle', input.jobTitleId, session);
      }
      if (input.managerPlacementId !== undefined) {
        await this.assertValidManager(placementId, input.managerPlacementId, session);
      }
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (input.displayName !== undefined) set['displayName'] = input.displayName;
      if (input.teamId !== undefined) set['teamId'] = input.teamId;
      if (input.jobTitleId !== undefined) set['jobTitleId'] = input.jobTitleId;
      if (input.managerPlacementId !== undefined) {
        set['managerPlacementId'] = input.managerPlacementId;
      }
      const updated = await this.placements
        .findOneAndUpdate({ placementId }, { $set: set }, { returnDocument: 'after', session })
        .lean<PlacementDocument>()
        .exec();
      if (!updated) throw new OrgNotFoundError('placement');
      await this.appendHistory(
        {
          placementId,
          change: 'updated',
          effectiveOn: this.today(),
          before: placementRefs(before),
          after: placementRefs(updated),
          changedBy: actor.accountId,
        },
        session,
      );
      await this.record(
        actor,
        ORG_AUDIT_ACTIONS.placementUpdated,
        { type: 'placement', id: placementId },
        { ...placementRefs(before), displayName: before.displayName },
        { ...placementRefs(updated), displayName: updated.displayName },
        context,
        session,
      );
      return toPlacement(updated);
    });
  }

  /**
   * Move a placement to another department from a date (CORE-ORG-003). Legal entity and branch follow
   * the department. Both the placement and the destination must be inside the actor's scope.
   */
  async transferPlacement(
    actor: ActorContext,
    placementId: string,
    input: TransferPlacement,
    context: RequestContext,
  ): Promise<Placement> {
    const effectiveOn = BusinessDateSchema.parse(input.effectiveOn);
    return withTransaction(this.connection, async (session) => {
      const before = await this.findScopedPlacement(actor, placementId, session);
      if (before.status !== 'active') throw conflict('PLACEMENT_INACTIVE', ['status']);
      if (effectiveOn < before.startedOn) throw conflict('BEFORE_START', ['effectiveOn']);
      const department = await this.touchActiveParent<DepartmentDocument>(
        actor,
        'department',
        input.departmentId,
        session,
      );
      if (input.teamId) await this.touchTeamOf(department.departmentId, input.teamId, session);
      if (input.jobTitleId) {
        await this.touchActiveParent(undefined, 'jobTitle', input.jobTitleId, session);
      }
      if (input.managerPlacementId) {
        await this.assertValidManager(placementId, input.managerPlacementId, session);
      }
      const updated = await this.placements
        .findOneAndUpdate(
          { placementId, status: 'active' },
          {
            $set: {
              legalEntityId: department.legalEntityId,
              branchId: department.branchId,
              departmentId: department.departmentId,
              ...(input.jobTitleId ? { jobTitleId: input.jobTitleId } : {}),
              ...(input.managerPlacementId ? { managerPlacementId: input.managerPlacementId } : {}),
              ...(input.teamId ? { teamId: input.teamId } : {}),
              updatedAt: new Date(),
            },
            // A team belongs to one department: moving department without naming a team leaves none.
            ...(input.teamId ? {} : { $unset: { teamId: 1 } }),
          },
          { returnDocument: 'after', session },
        )
        .lean<PlacementDocument>()
        .exec();
      if (!updated) throw conflict('STALE_STATE', ['status']);
      await this.appendHistory(
        {
          placementId,
          change: 'transferred',
          effectiveOn,
          reason: input.reason,
          before: placementRefs(before),
          after: placementRefs(updated),
          changedBy: actor.accountId,
        },
        session,
      );
      await this.record(
        actor,
        ORG_AUDIT_ACTIONS.placementTransferred,
        { type: 'placement', id: placementId },
        placementRefs(before),
        placementRefs(updated),
        context,
        session,
        input.reason,
      );
      return toPlacement(updated);
    });
  }

  /**
   * End a placement from a date (default: today). People who reported to it keep the reference, so
   * their escalations report *unresolved* until they are given a new manager — never silently skip a
   * level (CORE-ORG-005).
   */
  async deactivatePlacement(
    actor: ActorContext,
    placementId: string,
    input: PlacementLifecycle,
    context: RequestContext,
  ): Promise<Placement> {
    const endedOn = input.effectiveOn ?? this.today();
    return withTransaction(this.connection, async (session) => {
      const before = await this.findScopedPlacement(actor, placementId, session);
      if (before.status !== 'active') throw conflict('ALREADY_INACTIVE', ['status']);
      if (endedOn < before.startedOn) throw conflict('BEFORE_START', ['effectiveOn']);
      const updated = await this.placements
        .findOneAndUpdate(
          { placementId, status: 'active' },
          { $set: { status: 'inactive', endedOn, updatedAt: new Date() } },
          { returnDocument: 'after', session },
        )
        .lean<PlacementDocument>()
        .exec();
      if (!updated) throw conflict('STALE_STATE', ['status']);
      await this.appendHistory(
        {
          placementId,
          change: 'deactivated',
          effectiveOn: endedOn,
          reason: input.reason,
          before: placementRefs(before),
          after: placementRefs(updated),
          changedBy: actor.accountId,
        },
        session,
      );
      await this.record(
        actor,
        ORG_AUDIT_ACTIONS.placementDeactivated,
        { type: 'placement', id: placementId },
        { status: before.status },
        { status: updated.status, endedOn },
        context,
        session,
        input.reason,
      );
      return toPlacement(updated);
    });
  }

  /**
   * Resume an ended placement. Its department, team and job title must still be active, and the
   * account must not have acquired another active placement meanwhile (one per account).
   */
  async reactivatePlacement(
    actor: ActorContext,
    placementId: string,
    input: PlacementLifecycle,
    context: RequestContext,
  ): Promise<Placement> {
    const effectiveOn = input.effectiveOn ?? this.today();
    try {
      return await withTransaction(this.connection, async (session) => {
        const before = await this.findScopedPlacement(actor, placementId, session);
        if (before.status !== 'inactive') throw conflict('ALREADY_ACTIVE', ['status']);
        await this.touchActiveParent(undefined, 'department', before.departmentId, session);
        await this.touchActiveParent(undefined, 'jobTitle', before.jobTitleId, session);
        if (before.teamId) await this.touchTeamOf(before.departmentId, before.teamId, session);
        const updated = await this.placements
          .findOneAndUpdate(
            { placementId, status: 'inactive' },
            {
              $set: { status: 'active', updatedAt: new Date() },
              $unset: { endedOn: 1 },
            },
            { returnDocument: 'after', session },
          )
          .lean<PlacementDocument>()
          .exec();
        if (!updated) throw conflict('STALE_STATE', ['status']);
        await this.appendHistory(
          {
            placementId,
            change: 'reactivated',
            effectiveOn,
            reason: input.reason,
            before: placementRefs(before),
            after: placementRefs(updated),
            changedBy: actor.accountId,
          },
          session,
        );
        await this.record(
          actor,
          ORG_AUDIT_ACTIONS.placementReactivated,
          { type: 'placement', id: placementId },
          { status: before.status },
          { status: updated.status },
          context,
          session,
          input.reason,
        );
        return toPlacement(updated);
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) throw conflict('ACCOUNT_ALREADY_PLACED', ['accountId']);
      throw error;
    }
  }

  /** Every unit kind has the same lifecycle surface; the router maps one route to this. */
  deactivateUnit(
    kind: OrgUnitKind,
    actor: ActorContext,
    id: string,
    reason: string,
    ctx: RequestContext,
  ) {
    return this.setUnitStatus(kind, actor, id, 'inactive', reason, ctx);
  }

  reactivateUnit(
    kind: OrgUnitKind,
    actor: ActorContext,
    id: string,
    reason: string,
    ctx: RequestContext,
  ) {
    return this.setUnitStatus(kind, actor, id, 'active', reason, ctx);
  }
}
