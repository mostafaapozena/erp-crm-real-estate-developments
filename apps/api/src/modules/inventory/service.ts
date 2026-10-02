import {
  BuildingSchema,
  INVENTORY_AUDIT_ACTIONS,
  ProjectSchema,
  UnitEventSchema,
  UnitSchema,
  UNIT_STATUSES,
  canTransitionUnit,
  divideMoney,
  isManualUnitTransition,
  type ActorContext,
  type AvailabilityMatrix,
  type DecimalString,
  type Building,
  type ChangeUnitStatus,
  type CreateBuilding,
  type CreateProject,
  type CreateUnit,
  type InventorySummary,
  type Money,
  type Project,
  type ProjectStatus,
  type Unit,
  type UnitEvent,
  type UnitPage,
  type UnitQuery,
  type UnitStatus,
  type UpdateBuilding,
  type UpdateProject,
  type UpdateUnit,
} from '@alola/contracts';
import {
  assertSafeFilter,
  buildChangeSummary,
  buildCatalogueScopeFilter,
  can,
  restrictDocument,
  restrictDocuments,
  withScope,
  type ScopeFieldMap,
} from '@alola/security';
import type { ClientSession, Connection } from 'mongoose';
import { auditActor, conflict, DomainError, invalid } from '../../platform/audit-port';
import { fromDecimal128, toDecimal128 } from '../../platform/money-storage';
import { withTransaction } from '../../platform/transactions';
import { newId } from '../../platform/ids';
import {
  buildingModel,
  projectModel,
  unitEventModel,
  unitModel,
  type BuildingDocument,
  type ProjectDocument,
  type StoredMoney,
  type UnitDocument,
  type UnitEventDocument,
} from './model';

/**
 * Inventory service — `INV-*` demonstration slice (ADR-0025).
 *
 * The property this module exists to guarantee is that **a unit cannot be sold twice**. Everything
 * else here is bookkeeping around that one invariant, and it is enforced in three places rather than
 * one, because a single check is a single thing to forget:
 *
 * 1. `canTransitionUnit` refuses a move the state machine does not permit.
 * 2. Every status change is a **conditional update** naming the status it read, so two concurrent
 *    attempts cannot both match a document. The loser changes nothing and is told so.
 * 3. A partial unique index stops one reservation from holding two units.
 *
 * Pricing is field-restricted (SEC-029): an actor without `inventory.unit.viewPricing` receives units
 * with the price fields **absent**, on the list, the single read, and the summary alike.
 */

export interface AuditRecorder {
  record(
    input: {
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
    },
    options?: { session?: ClientSession },
  ): Promise<unknown>;
}

export interface RequestContext {
  correlationId: string;
  ip?: string;
  method?: string;
  route?: string;
}

/**
 * Where a project sits in the organization.
 *
 * A port rather than an import of `CORE-ORG`: inventory needs one fact about a branch — which legal
 * entity it belongs to — and taking it as a function keeps the dependency visible at the composition
 * root instead of buried in a call chain. It also means this service is testable without an
 * organization.
 */
export type BranchResolver = (branchId: string) => Promise<{ legalEntityId: string } | undefined>;

export class InventoryNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(readonly what: string) {
    super('NOT_FOUND');
    this.name = 'InventoryNotFoundError';
  }
}

export class InventoryConflictError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly what: string) {
    super('CONFLICT');
    this.name = 'InventoryConflictError';
  }
}

/** A move the unit state machine does not permit, or one whose expected version no longer holds. */
export class UnitTransitionError extends Error {
  readonly code = 'CONFLICT';
  constructor(
    readonly from: UnitStatus,
    readonly to: UnitStatus,
  ) {
    super('CONFLICT');
    this.name = 'UnitTransitionError';
  }
}

export const INVENTORY_SCOPE_FIELDS: ScopeFieldMap = {
  project: 'projectId',
  branch: 'branchId',
  legalEntity: 'legalEntityId',
};

/** Square metres are rounded to two places for display; the stored area keeps what was entered. */
const PRICE_SCALE = 2;

const iso = (date: Date) => date.toISOString();

function toMoney(stored: StoredMoney): Money {
  return { amount: fromDecimal128(stored.amount), currency: stored.currency };
}

function fromMoney(value: Money): StoredMoney {
  return { amount: toDecimal128(value.amount), currency: value.currency };
}

function toProject(d: ProjectDocument): Project {
  return ProjectSchema.parse({
    projectId: d.projectId,
    legalEntityId: d.legalEntityId,
    branchId: d.branchId,
    code: d.code,
    name: d.name,
    city: d.city,
    ...(d.description ? { description: d.description } : {}),
    status: d.status,
    currency: d.currency,
    version: d.version ?? 1,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

function toBuilding(d: BuildingDocument): Building {
  return BuildingSchema.parse({
    buildingId: d.buildingId,
    projectId: d.projectId,
    legalEntityId: d.legalEntityId,
    branchId: d.branchId,
    code: d.code,
    name: d.name,
    ...(d.zone ? { zone: d.zone } : {}),
    floors: d.floors,
    version: d.version ?? 1,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

function toUnit(d: UnitDocument): Unit {
  return UnitSchema.parse({
    unitId: d.unitId,
    projectId: d.projectId,
    buildingId: d.buildingId,
    legalEntityId: d.legalEntityId,
    branchId: d.branchId,
    code: d.code,
    floor: d.floor,
    propertyType: d.propertyType,
    usageType: d.usageType,
    area: fromDecimal128(d.area),
    ...(d.gardenArea ? { gardenArea: fromDecimal128(d.gardenArea) } : {}),
    ...(d.roofArea ? { roofArea: fromDecimal128(d.roofArea) } : {}),
    ...(d.bedrooms !== undefined ? { bedrooms: d.bedrooms } : {}),
    ...(d.bathrooms !== undefined ? { bathrooms: d.bathrooms } : {}),
    ...(d.parkingSpaces !== undefined ? { parkingSpaces: d.parkingSpaces } : {}),
    ...(d.storageRooms !== undefined ? { storageRooms: d.storageRooms } : {}),
    basePrice: toMoney(d.basePrice),
    currentPrice: toMoney(d.currentPrice),
    pricePerSquareMeter: toMoney(d.pricePerSquareMeter),
    status: d.status,
    finishingStatus: d.finishingStatus,
    ...(d.view ? { view: d.view } : {}),
    ...(d.paymentPlanSummary ? { paymentPlanSummary: d.paymentPlanSummary } : {}),
    ...(d.heldByReservationId ? { heldByReservationId: d.heldByReservationId } : {}),
    ...(d.heldByHoldId ? { heldByHoldId: d.heldByHoldId } : {}),
    ...(d.contractId ? { contractId: d.contractId } : {}),
    version: d.version,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

function toUnitEvent(d: UnitEventDocument): UnitEvent {
  return UnitEventSchema.parse({
    eventId: d.eventId,
    unitId: d.unitId,
    projectId: d.projectId,
    kind: d.kind,
    ...(d.fromStatus ? { fromStatus: d.fromStatus } : {}),
    ...(d.toStatus ? { toStatus: d.toStatus } : {}),
    ...(d.reason ? { reason: d.reason } : {}),
    ...(d.sourceType ? { sourceType: d.sourceType } : {}),
    ...(d.sourceId ? { sourceId: d.sourceId } : {}),
    ...(d.actorAccountId ? { actorAccountId: d.actorAccountId } : {}),
    occurredAt: iso(d.occurredAt),
  });
}

/** The optional attributes of a unit as stored: areas as `Decimal128`, counts as integers. */
function attributesOf(input: {
  gardenArea?: DecimalString | undefined;
  roofArea?: DecimalString | undefined;
  bedrooms?: number | undefined;
  bathrooms?: number | undefined;
  parkingSpaces?: number | undefined;
  storageRooms?: number | undefined;
}): Partial<UnitDocument> {
  return {
    ...(input.gardenArea !== undefined ? { gardenArea: toDecimal128(input.gardenArea) } : {}),
    ...(input.roofArea !== undefined ? { roofArea: toDecimal128(input.roofArea) } : {}),
    ...(input.bedrooms !== undefined ? { bedrooms: input.bedrooms } : {}),
    ...(input.bathrooms !== undefined ? { bathrooms: input.bathrooms } : {}),
    ...(input.parkingSpaces !== undefined ? { parkingSpaces: input.parkingSpaces } : {}),
    ...(input.storageRooms !== undefined ? { storageRooms: input.storageRooms } : {}),
  };
}

/** The stored version filter; a record written before BMP-1 has none and is at version 1. */
function versionFilter(expected: number): Record<string, unknown> {
  return expected === 1
    ? { $or: [{ version: 1 }, { version: { $exists: false } }] }
    : { version: expected };
}

function encodeCursor(code: string, unitId: string): string {
  return Buffer.from(`${code}|${unitId}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { code: string; unitId: string } | undefined {
  try {
    const [code, unitId] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    return code && unitId ? { code, unitId } : undefined;
  } catch {
    return undefined;
  }
}

/** A unit-status change requested by another module, inside that module's transaction. */
export interface UnitStatusChange {
  unitId: string;
  from: UnitStatus;
  to: UnitStatus;
  reason: string;
  sourceType?: string;
  sourceId?: string;
  /** Set when the move takes or releases a hold; `null` clears it. */
  reservationId?: string | null;
  contractId?: string | null;
  /** Set when a timed hold takes the unit; `null` clears it (INV-HOLD-001). */
  holdId?: string | null;
  /**
   * Require that the unit is held by exactly this hold or reservation, so a workflow can only release
   * what it itself took — never a unit someone else has since committed.
   */
  expectHoldId?: string;
  expectReservationId?: string;
}

export class InventoryService {
  private readonly connection;
  private readonly projects;
  private readonly buildings;
  private readonly units;
  private readonly unitEvents;
  private readonly audit;
  private readonly resolveBranch;

  constructor(options: {
    connection: Connection;
    audit: AuditRecorder;
    resolveBranch: BranchResolver;
  }) {
    this.connection = options.connection;
    this.projects = projectModel(options.connection);
    this.buildings = buildingModel(options.connection);
    this.units = unitModel(options.connection);
    this.unitEvents = unitEventModel(options.connection);
    this.audit = options.audit;
    this.resolveBranch = options.resolveBranch;
  }

  /* ------------------------------------------------------------- projects */

  async listProjects(actor: ActorContext, status?: ProjectStatus): Promise<Project[]> {
    const requested: Record<string, unknown> = {};
    if (status) requested['status'] = status;
    assertSafeFilter(requested);
    const filter = withScope(buildCatalogueScopeFilter(actor, INVENTORY_SCOPE_FIELDS), requested);
    const documents = await this.projects
      .find(filter)
      .sort({ code: 1 })
      .limit(500)
      .lean<ProjectDocument[]>()
      .exec();
    return documents.map(toProject);
  }

  /** Projects by code or name prefix, inside the actor's scope (CORE-SEARCH-001). */
  async searchProjects(
    actor: ActorContext,
    term: string,
    limit: number,
  ): Promise<{ id: string; label: string; name: { ar: string; en: string }; status: string }[]> {
    const pattern = { $regex: `^${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' };
    const filter = withScope(buildCatalogueScopeFilter(actor, INVENTORY_SCOPE_FIELDS), {
      $or: [{ code: pattern }, { 'name.ar': pattern }, { 'name.en': pattern }],
    });
    const rows = await this.projects
      .find(filter, { projectId: 1, code: 1, name: 1, status: 1 })
      .sort({ code: 1 })
      .limit(limit)
      .lean<ProjectDocument[]>()
      .exec();
    return rows.map((row) => ({
      id: row.projectId,
      label: row.code,
      name: { ar: row.name.ar, en: row.name.en },
      status: row.status,
    }));
  }

  /**
   * Units by code prefix, inside the actor's scope (CORE-SEARCH-001). **Only the code is matched**:
   * price fields are restricted (SEC-029), and a search that matched on them would answer questions
   * about a value the actor may not see.
   */
  /**
   * Units for an export (CORE-IMPORT-003): the same scoped query as the list, the same field
   * restriction as every other read. Price columns exist only for an actor who may see prices — for
   * anyone else they are absent from the file, not blank (SEC-029).
   */
  async exportUnits(
    actor: ActorContext,
    limit: number,
  ): Promise<{ columns: string[]; rows: (string | number | null | undefined)[][] }> {
    const documents = await this.units
      .find(withScope(buildCatalogueScopeFilter(actor, INVENTORY_SCOPE_FIELDS)))
      .sort({ code: 1, unitId: 1 })
      .limit(limit)
      .lean<UnitDocument[]>()
      .exec();
    const units = restrictDocuments('unit', actor, documents.map(toUnit)) as Unit[];
    // The rule restrictDocuments applies to each unit, decided once for the header.
    const pricing = can(actor, 'inventory.unit.viewPricing');
    const columns = [
      'code',
      'project_id',
      'floor',
      'property_type',
      'usage_type',
      'area',
      'finishing_status',
      'status',
      ...(pricing ? ['base_price', 'current_price', 'price_per_square_meter', 'currency'] : []),
    ];
    return {
      columns,
      rows: units.map((unit) => [
        unit.code,
        unit.projectId,
        unit.floor,
        unit.propertyType,
        unit.usageType,
        unit.area,
        unit.finishingStatus,
        unit.status,
        ...(pricing
          ? [
              unit.basePrice?.amount,
              unit.currentPrice?.amount,
              unit.pricePerSquareMeter?.amount,
              unit.basePrice?.currency,
            ]
          : []),
      ]),
    };
  }

  async searchUnits(
    actor: ActorContext,
    term: string,
    limit: number,
  ): Promise<{ id: string; label: string; status: string }[]> {
    const filter = withScope(buildCatalogueScopeFilter(actor, INVENTORY_SCOPE_FIELDS), {
      code: { $regex: `^${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' },
    });
    const rows = await this.units
      .find(filter, { unitId: 1, code: 1, status: 1 })
      .sort({ code: 1 })
      .limit(limit)
      .lean<UnitDocument[]>()
      .exec();
    return rows.map((row) => ({ id: row.unitId, label: row.code, status: row.status }));
  }

  async getProject(actor: ActorContext, projectId: string): Promise<Project> {
    assertSafeFilter({ projectId });
    const filter = withScope(buildCatalogueScopeFilter(actor, INVENTORY_SCOPE_FIELDS), {
      projectId,
    });
    const document = await this.projects.findOne(filter).lean<ProjectDocument>().exec();
    // Out of scope and absent are the same answer (SEC-030).
    if (!document) throw new InventoryNotFoundError('project');
    return toProject(document);
  }

  async createProject(
    actor: ActorContext,
    input: CreateProject,
    context: RequestContext,
  ): Promise<Project> {
    assertSafeFilter({ code: input.code, branchId: input.branchId });
    const branch = await this.resolveBranch(input.branchId);
    if (!branch) throw new InventoryNotFoundError('branch');
    const existing = await this.projects.findOne({ code: input.code }).lean().exec();
    if (existing) throw new InventoryConflictError('projectCode');

    const now = new Date();
    const created = await this.projects.create({
      projectId: newId('prj'),
      // From the branch, never from the request: the organization decides the legal entity.
      legalEntityId: branch.legalEntityId,
      branchId: input.branchId,
      code: input.code,
      name: input.name,
      city: input.city,
      ...(input.description ? { description: input.description } : {}),
      status: input.status ?? 'planning',
      currency: input.currency,
      createdAt: now,
      updatedAt: now,
    });
    const project = toProject(created.toObject());
    await this.audit.record({
      action: INVENTORY_AUDIT_ACTIONS.projectCreated,
      outcome: 'succeeded',
      actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
      target: { type: 'project', id: project.projectId },
      changes: buildChangeSummary(undefined, {
        code: project.code,
        currency: project.currency,
        branchId: project.branchId,
      }),
      context,
    });
    return project;
  }

  /* ------------------------------------------------------------ buildings */

  async listBuildings(actor: ActorContext, projectId?: string): Promise<Building[]> {
    const requested: Record<string, unknown> = {};
    if (projectId) requested['projectId'] = projectId;
    assertSafeFilter(requested);
    const filter = withScope(buildCatalogueScopeFilter(actor, INVENTORY_SCOPE_FIELDS), requested);
    const documents = await this.buildings
      .find(filter)
      .sort({ code: 1 })
      .limit(500)
      .lean<BuildingDocument[]>()
      .exec();
    return documents.map(toBuilding);
  }

  async createBuilding(
    actor: ActorContext,
    input: CreateBuilding,
    context: RequestContext,
  ): Promise<Building> {
    assertSafeFilter({ projectId: input.projectId, code: input.code });
    const project = await this.projects
      .findOne({ projectId: input.projectId })
      .lean<ProjectDocument>()
      .exec();
    if (!project) throw new InventoryNotFoundError('project');
    const existing = await this.buildings
      .findOne({ projectId: input.projectId, code: input.code })
      .lean()
      .exec();
    if (existing) throw new InventoryConflictError('buildingCode');

    const now = new Date();
    const created = await this.buildings.create({
      buildingId: newId('bld'),
      projectId: project.projectId,
      // Taken from the project, never from the request: the parent decides the placement.
      legalEntityId: project.legalEntityId,
      branchId: project.branchId,
      code: input.code,
      name: input.name,
      ...(input.zone ? { zone: input.zone } : {}),
      floors: input.floors,
      createdAt: now,
      updatedAt: now,
    });
    const building = toBuilding(created.toObject());
    await this.audit.record({
      action: INVENTORY_AUDIT_ACTIONS.buildingCreated,
      outcome: 'succeeded',
      actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
      target: { type: 'building', id: building.buildingId },
      changes: buildChangeSummary(undefined, {
        code: building.code,
        projectId: building.projectId,
      }),
      context,
    });
    return building;
  }

  /* ----------------------------------------------------------------- units */

  private queryFilter(actor: ActorContext, query: UnitQuery): Record<string, unknown> {
    const requested: Record<string, unknown> = {};
    for (const key of [
      'projectId',
      'buildingId',
      'status',
      'propertyType',
      'usageType',
      'finishingStatus',
    ] as const) {
      const value = query[key];
      if (value !== undefined) requested[key] = value;
    }
    if (query.floor !== undefined) requested['floor'] = query.floor;
    if (query.bedrooms !== undefined) requested['bedrooms'] = query.bedrooms;
    assertSafeFilter(requested);
    const priced = query.priceMin !== undefined || query.priceMax !== undefined;
    // A filter on a hidden value reveals it one bisection at a time (SEC-029).
    if (priced && !can(actor, 'inventory.unit.viewPricing')) {
      throw new DomainError('FORBIDDEN', [
        { path: ['priceMin'], code: 'PRICE_FILTER_NOT_PERMITTED' },
      ]);
    }
    const range = (min?: DecimalString, max?: DecimalString) => ({
      ...(min !== undefined ? { $gte: toDecimal128(min) } : {}),
      ...(max !== undefined ? { $lte: toDecimal128(max) } : {}),
    });
    if (query.areaMin !== undefined || query.areaMax !== undefined) {
      requested['area'] = range(query.areaMin, query.areaMax);
    }
    if (priced) requested['currentPrice.amount'] = range(query.priceMin, query.priceMax);
    const base = withScope(buildCatalogueScopeFilter(actor, INVENTORY_SCOPE_FIELDS), requested);
    if (!query.code) return base;
    /**
     * Anchored prefix match on an escaped literal. A raw user string in a regular expression is a
     * denial-of-service waiting to happen, and an unanchored one cannot use the index.
     */
    const escaped = query.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { $and: [base, { code: { $regex: `^${escaped}`, $options: 'i' } }] };
  }

  async listUnits(actor: ActorContext, query: UnitQuery): Promise<UnitPage> {
    const filter = this.queryFilter(actor, query);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    // Deterministic order: code asc, unitId asc. Keyset paging, so rows never repeat or skip.
    const paged = cursor
      ? {
          $and: [
            filter,
            {
              $or: [
                { code: { $gt: cursor.code } },
                { code: cursor.code, unitId: { $gt: cursor.unitId } },
              ],
            },
          ],
        }
      : filter;

    const [documents, total] = await Promise.all([
      this.units
        .find(paged)
        .sort({ code: 1, unitId: 1 })
        .limit(query.limit + 1)
        .lean<UnitDocument[]>()
        .exec(),
      // The same filter answers the total, so a count can never include an out-of-scope row (SEC-028).
      this.units.countDocuments(filter).exec(),
    ]);

    const page = documents.slice(0, query.limit);
    const last = page[page.length - 1];
    const items = restrictDocuments('unit', actor, page.map(toUnit)) as Unit[];
    return {
      items,
      total,
      limit: query.limit,
      ...(documents.length > query.limit && last
        ? { nextCursor: encodeCursor(last.code, last.unitId) }
        : {}),
    };
  }

  async getUnit(actor: ActorContext, unitId: string): Promise<Unit> {
    assertSafeFilter({ unitId });
    const filter = withScope(buildCatalogueScopeFilter(actor, INVENTORY_SCOPE_FIELDS), { unitId });
    const document = await this.units.findOne(filter).lean<UnitDocument>().exec();
    if (!document) throw new InventoryNotFoundError('unit');
    return restrictDocument('unit', actor, toUnit(document)) as Unit;
  }

  /** Read a unit without the actor's scope — for another module inside its own transaction. */
  async findUnitForUpdate(unitId: string, session?: ClientSession): Promise<Unit | undefined> {
    assertSafeFilter({ unitId });
    const query = this.units.findOne({ unitId });
    if (session) query.session(session);
    const document = await query.lean<UnitDocument>().exec();
    return document ? toUnit(document) : undefined;
  }

  async listUnitEvents(actor: ActorContext, unitId: string): Promise<UnitEvent[]> {
    // Reading history requires the unit itself to be visible, which this call proves.
    await this.getUnit(actor, unitId);
    const documents = await this.unitEvents
      .find({ unitId })
      .sort({ occurredAt: -1, eventId: -1 })
      .limit(200)
      .lean<UnitEventDocument[]>()
      .exec();
    return documents.map(toUnitEvent);
  }

  async summary(actor: ActorContext, projectId?: string): Promise<InventorySummary> {
    const requested: Record<string, unknown> = {};
    if (projectId) requested['projectId'] = projectId;
    assertSafeFilter(requested);
    const filter = withScope(buildCatalogueScopeFilter(actor, INVENTORY_SCOPE_FIELDS), requested);
    /**
     * The scope filter is the **first** aggregation stage, so the counts are constrained by exactly
     * the same condition as the rows. A summary computed over everything and filtered afterwards is
     * the classic scope leak: the rows look right and the totals give the game away (SEC-028).
     */
    const [byStatus, byUsage, total] = await Promise.all([
      this.units.aggregate<{ _id: string; count: number }>([
        { $match: filter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      this.units.aggregate<{ _id: string; count: number }>([
        { $match: filter },
        { $group: { _id: '$usageType', count: { $sum: 1 } } },
      ]),
      this.units.countDocuments(filter).exec(),
    ]);
    const asRecord = (rows: { _id: string; count: number }[]) =>
      Object.fromEntries(rows.map((row) => [row._id, row.count]));
    return {
      ...(projectId ? { projectId } : {}),
      total,
      byStatus: asRecord(byStatus) as InventorySummary['byStatus'],
      byUsageType: asRecord(byUsage) as InventorySummary['byUsageType'],
    };
  }

  async createUnit(actor: ActorContext, input: CreateUnit, context: RequestContext): Promise<Unit> {
    assertSafeFilter({ buildingId: input.buildingId, code: input.code });
    const building = await this.buildings
      .findOne({ buildingId: input.buildingId })
      .lean<BuildingDocument>()
      .exec();
    if (!building) throw new InventoryNotFoundError('building');
    const project = await this.projects
      .findOne({ projectId: building.projectId })
      .lean<ProjectDocument>()
      .exec();
    if (!project) throw new InventoryNotFoundError('project');

    if (input.basePrice.currency !== project.currency) {
      throw new InventoryConflictError('currencyMismatch');
    }
    const currentPrice = input.currentPrice ?? input.basePrice;
    if (currentPrice.currency !== project.currency) {
      throw new InventoryConflictError('currencyMismatch');
    }
    if (input.floor > building.floors) throw new InventoryConflictError('floorAboveBuilding');

    const existing = await this.units
      .findOne({ projectId: project.projectId, code: input.code })
      .lean()
      .exec();
    if (existing) throw new InventoryConflictError('unitCode');

    const now = new Date();
    const unitId = newId('unit');
    const created = await this.units.create({
      unitId,
      projectId: project.projectId,
      buildingId: building.buildingId,
      legalEntityId: project.legalEntityId,
      branchId: project.branchId,
      code: input.code,
      floor: input.floor,
      propertyType: input.propertyType,
      usageType: input.usageType,
      area: toDecimal128(input.area),
      basePrice: fromMoney(input.basePrice),
      currentPrice: fromMoney(currentPrice),
      // Derived, never supplied: a price per square metre that disagrees with price ÷ area is a lie.
      pricePerSquareMeter: fromMoney(divideMoney(currentPrice, input.area, PRICE_SCALE)),
      status: 'available',
      finishingStatus: input.finishingStatus,
      ...(input.view ? { view: input.view } : {}),
      ...(input.paymentPlanSummary ? { paymentPlanSummary: input.paymentPlanSummary } : {}),
      ...attributesOf(input),
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    await this.unitEvents.create({
      eventId: newId('uev'),
      unitId,
      projectId: project.projectId,
      kind: 'created',
      toStatus: 'available',
      ...(actor.accountId ? { actorAccountId: actor.accountId } : {}),
      occurredAt: now,
    });

    const unit = toUnit(created.toObject());
    await this.audit.record({
      action: INVENTORY_AUDIT_ACTIONS.unitCreated,
      outcome: 'succeeded',
      actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
      target: { type: 'unit', id: unitId },
      changes: buildChangeSummary(undefined, {
        code: unit.code,
        projectId: unit.projectId,
        status: unit.status,
      }),
      context,
    });
    return restrictDocument('unit', actor, unit) as Unit;
  }

  /**
   * Move a unit between statuses.
   *
   * The update is **conditional on the status the caller read**. Two simultaneous attempts to reserve
   * the same available unit therefore cannot both succeed: the first changes the document, the
   * second's filter no longer matches, and it is told the transition is refused rather than silently
   * overwriting. That is the whole double-sale defence, and it costs one extra clause in a filter.
   *
   * `session` lets another module make this part of its own transaction — a reservation takes a hold
   * and writes its own record in one commit, or neither happens.
   */
  async applyStatusChange(
    actor: ActorContext,
    change: UnitStatusChange,
    context: RequestContext,
    session?: ClientSession,
  ): Promise<Unit> {
    assertSafeFilter({ unitId: change.unitId });
    if (!canTransitionUnit(change.from, change.to)) {
      await this.audit.record(
        {
          action: INVENTORY_AUDIT_ACTIONS.unitStatusRefused,
          outcome: 'denied',
          actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
          target: { type: 'unit', id: change.unitId },
          reason: `refused transition ${change.from} -> ${change.to}`,
          context,
        },
        session ? { session } : {},
      );
      throw new UnitTransitionError(change.from, change.to);
    }

    const set: Record<string, unknown> = { status: change.to, updatedAt: new Date() };
    const unset: Record<string, ''> = {};
    if (change.reservationId === null) unset['heldByReservationId'] = '';
    else if (change.reservationId) set['heldByReservationId'] = change.reservationId;
    if (change.contractId === null) unset['contractId'] = '';
    else if (change.contractId) set['contractId'] = change.contractId;
    if (change.holdId === null) unset['heldByHoldId'] = '';
    else if (change.holdId) set['heldByHoldId'] = change.holdId;

    const update = await this.units
      .findOneAndUpdate(
        {
          unitId: change.unitId,
          status: change.from,
          ...(change.expectHoldId ? { heldByHoldId: change.expectHoldId } : {}),
          ...(change.expectReservationId
            ? { heldByReservationId: change.expectReservationId }
            : {}),
        },
        {
          $set: set,
          $inc: { version: 1 },
          ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
        },
        { returnDocument: 'after', runValidators: true, ...(session ? { session } : {}) },
      )
      .lean<UnitDocument>()
      .exec();

    if (!update) {
      // Either the unit is gone or someone else moved it first. Both are a refused transition.
      await this.audit.record(
        {
          action: INVENTORY_AUDIT_ACTIONS.unitStatusRefused,
          outcome: 'denied',
          actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
          target: { type: 'unit', id: change.unitId },
          reason: `unit was not in status ${change.from}`,
          context,
        },
        session ? { session } : {},
      );
      throw new UnitTransitionError(change.from, change.to);
    }

    await this.unitEvents.create(
      [
        {
          eventId: newId('uev'),
          unitId: change.unitId,
          projectId: update.projectId,
          kind: 'statusChanged',
          fromStatus: change.from,
          toStatus: change.to,
          reason: change.reason,
          ...(change.sourceType ? { sourceType: change.sourceType } : {}),
          ...(change.sourceId ? { sourceId: change.sourceId } : {}),
          ...(actor.accountId ? { actorAccountId: actor.accountId } : {}),
          occurredAt: new Date(),
        },
      ],
      session ? { session } : {},
    );

    await this.audit.record(
      {
        action: INVENTORY_AUDIT_ACTIONS.unitStatusChanged,
        outcome: 'succeeded',
        actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
        target: { type: 'unit', id: change.unitId },
        changes: buildChangeSummary({ status: change.from }, { status: change.to }),
        reason: change.reason,
        context,
      },
      session ? { session } : {},
    );

    return toUnit(update);
  }

  /** The person-initiated status change: withdraw a unit from sale, or return it. */
  async changeStatus(
    actor: ActorContext,
    unitId: string,
    input: ChangeUnitStatus,
    context: RequestContext,
  ): Promise<Unit> {
    const current = await this.getUnit(actor, unitId);
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      throw new InventoryConflictError('staleVersion');
    }
    if (!isManualUnitTransition(current.status, input.status)) {
      // A hold, a reservation or a contract moves the unit through its own workflow. Freeing a unit
      // here while its reservation still stands is exactly how a unit gets sold twice.
      await this.audit.record({
        action: INVENTORY_AUDIT_ACTIONS.unitStatusRefused,
        outcome: 'denied',
        actor: auditActor(actor),
        target: { type: 'unit', id: unitId },
        reason: `manual move ${current.status} -> ${input.status} refused: set by its workflow`,
        context,
      });
      throw conflict('STATUS_SET_BY_WORKFLOW', ['status']);
    }
    const updated = await this.applyStatusChange(
      actor,
      { unitId, from: current.status, to: input.status, reason: input.reason },
      context,
    );
    return restrictDocument('unit', actor, updated) as Unit;
  }
  /** One building inside the actor's catalogue scope; out of scope is not found (SEC-030). */
  async getBuilding(actor: ActorContext, buildingId: string): Promise<Building> {
    assertSafeFilter({ buildingId });
    const document = await this.buildings
      .findOne(withScope(buildCatalogueScopeFilter(actor, INVENTORY_SCOPE_FIELDS), { buildingId }))
      .lean<BuildingDocument>()
      .exec();
    if (!document) throw new InventoryNotFoundError('building');
    return toBuilding(document);
  }

  /* --------------------------------------------------------------- editing */

  /** INV-PROJECT-001: descriptive fields, with a reason and the version read. */
  async updateProject(
    actor: ActorContext,
    projectId: string,
    input: UpdateProject,
    context: RequestContext,
  ): Promise<Project> {
    const before = await this.getProject(actor, projectId);
    if (before.version !== input.expectedVersion) throw conflict('STALE_VERSION');
    const set: Record<string, unknown> = {};
    for (const key of ['name', 'city', 'description', 'status'] as const) {
      if (input[key] !== undefined && JSON.stringify(input[key]) !== JSON.stringify(before[key])) {
        set[key] = input[key];
      }
    }
    if (Object.keys(set).length === 0) throw invalid('NOTHING_TO_CHANGE');
    const updated = await withTransaction(this.connection, async (session) => {
      const result = await this.projects
        .findOneAndUpdate(
          { projectId, ...versionFilter(input.expectedVersion) },
          { $set: { ...set, version: input.expectedVersion + 1, updatedAt: new Date() } },
          { returnDocument: 'after', runValidators: true, session },
        )
        .lean<ProjectDocument>()
        .exec();
      if (!result) throw conflict('STALE_VERSION');
      await this.audit.record(
        {
          action: INVENTORY_AUDIT_ACTIONS.projectUpdated,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'project', id: projectId },
          changes: buildChangeSummary(
            Object.fromEntries(Object.keys(set).map((key) => [key, before[key as keyof Project]])),
            set,
          ),
          reason: input.reason,
          context,
        },
        { session },
      );
      return result;
    });
    return toProject(updated);
  }

  /** INV-PROJECT-002: a building's floors may not fall below its highest unit. */
  async updateBuilding(
    actor: ActorContext,
    buildingId: string,
    input: UpdateBuilding,
    context: RequestContext,
  ): Promise<Building> {
    assertSafeFilter({ buildingId });
    const document = await this.buildings
      .findOne(withScope(buildCatalogueScopeFilter(actor, INVENTORY_SCOPE_FIELDS), { buildingId }))
      .lean<BuildingDocument>()
      .exec();
    if (!document) throw new InventoryNotFoundError('building');
    const before = toBuilding(document);
    if (before.version !== input.expectedVersion) throw conflict('STALE_VERSION');
    if (input.floors !== undefined && input.floors < before.floors) {
      const highest = await this.units
        .findOne({ buildingId }, { floor: 1 })
        .sort({ floor: -1 })
        .lean<UnitDocument>()
        .exec();
      if (highest && highest.floor > input.floors) throw conflict('FLOOR_BELOW_UNITS', ['floors']);
    }
    const set: Record<string, unknown> = {};
    for (const key of ['name', 'zone', 'floors'] as const) {
      if (input[key] !== undefined && JSON.stringify(input[key]) !== JSON.stringify(before[key])) {
        set[key] = input[key];
      }
    }
    if (Object.keys(set).length === 0) throw invalid('NOTHING_TO_CHANGE');
    const updated = await withTransaction(this.connection, async (session) => {
      const result = await this.buildings
        .findOneAndUpdate(
          { buildingId, ...versionFilter(input.expectedVersion) },
          { $set: { ...set, version: input.expectedVersion + 1, updatedAt: new Date() } },
          { returnDocument: 'after', runValidators: true, session },
        )
        .lean<BuildingDocument>()
        .exec();
      if (!result) throw conflict('STALE_VERSION');
      await this.audit.record(
        {
          action: INVENTORY_AUDIT_ACTIONS.buildingUpdated,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'building', id: buildingId },
          changes: buildChangeSummary(
            Object.fromEntries(Object.keys(set).map((key) => [key, before[key as keyof Building]])),
            set,
          ),
          reason: input.reason,
          context,
        },
        { session },
      );
      return result;
    });
    return toBuilding(updated);
  }

  /**
   * INV-UNIT-001: the attributes a customer does not sign for. Code, floor, area, price and status are
   * each changed only by their own path.
   */
  async updateUnit(
    actor: ActorContext,
    unitId: string,
    input: UpdateUnit,
    context: RequestContext,
  ): Promise<Unit> {
    const before = await this.getUnit(actor, unitId);
    if (before.version !== input.expectedVersion) throw conflict('STALE_VERSION');
    const set: Record<string, unknown> = {
      ...attributesOf(input),
      ...(input.finishingStatus !== undefined ? { finishingStatus: input.finishingStatus } : {}),
      ...(input.view !== undefined ? { view: input.view } : {}),
      ...(input.paymentPlanSummary !== undefined
        ? { paymentPlanSummary: input.paymentPlanSummary }
        : {}),
    };
    if (Object.keys(set).length === 0) throw invalid('NOTHING_TO_CHANGE');
    const updated = await withTransaction(this.connection, async (session) => {
      const now = new Date();
      const result = await this.units
        .findOneAndUpdate(
          { unitId, version: input.expectedVersion },
          { $set: { ...set, updatedAt: now }, $inc: { version: 1 } },
          { returnDocument: 'after', runValidators: true, session },
        )
        .lean<UnitDocument>()
        .exec();
      // The version is in the filter: a status move or another edit in between wins.
      if (!result) throw conflict('STALE_VERSION');
      await this.unitEvents.create(
        [
          {
            eventId: newId('uev'),
            unitId,
            projectId: result.projectId,
            kind: 'attributesChanged',
            reason: input.reason,
            actorAccountId: actor.accountId,
            occurredAt: now,
          },
        ],
        { session },
      );
      const changed = Object.keys(set);
      await this.audit.record(
        {
          action: INVENTORY_AUDIT_ACTIONS.unitUpdated,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'unit', id: unitId },
          changes: buildChangeSummary(
            Object.fromEntries(changed.map((key) => [key, before[key as keyof Unit]])),
            Object.fromEntries(changed.map((key) => [key, toUnit(result)[key as keyof Unit]])),
          ),
          reason: input.reason,
          context,
        },
        { session },
      );
      return result;
    });
    return restrictDocument('unit', actor, toUnit(updated)) as Unit;
  }

  /* ------------------------------------------------- matrix and comparison */

  /**
   * INV-SEARCH-002: every unit of a project the actor can see, drawn building by building and floor by
   * floor. Counts are taken from the same scoped rows; price only with price visibility.
   */
  async availabilityMatrix(actor: ActorContext, projectId: string): Promise<AvailabilityMatrix> {
    await this.getProject(actor, projectId);
    const scope = buildCatalogueScopeFilter(actor, INVENTORY_SCOPE_FIELDS);
    const [buildings, units] = await Promise.all([
      this.buildings
        .find(withScope(scope, { projectId }))
        .sort({ code: 1 })
        .lean<BuildingDocument[]>()
        .exec(),
      this.units
        .find(withScope(scope, { projectId }))
        .sort({ floor: -1, code: 1 })
        .limit(5000)
        .lean<UnitDocument[]>()
        .exec(),
    ]);
    const pricing = can(actor, 'inventory.unit.viewPricing');
    const counts = Object.fromEntries(UNIT_STATUSES.map((status) => [status, 0])) as Record<
      UnitStatus,
      number
    >;
    type Cell = AvailabilityMatrix['buildings'][number]['floors'][number]['units'][number];
    const byBuilding = new Map<string, Map<number, Cell[]>>();
    for (const unit of units) {
      counts[unit.status] += 1;
      const floors = byBuilding.get(unit.buildingId) ?? new Map<number, Cell[]>();
      const cells = floors.get(unit.floor) ?? [];
      cells.push({
        unitId: unit.unitId,
        code: unit.code,
        status: unit.status,
        propertyType: unit.propertyType,
        area: fromDecimal128(unit.area),
        ...(unit.bedrooms !== undefined ? { bedrooms: unit.bedrooms } : {}),
        ...(pricing ? { currentPrice: toMoney(unit.currentPrice) } : {}),
      });
      floors.set(unit.floor, cells);
      byBuilding.set(unit.buildingId, floors);
    }
    return {
      projectId,
      buildings: buildings.map((building) => {
        const floors = byBuilding.get(building.buildingId) ?? new Map<number, Cell[]>();
        return {
          buildingId: building.buildingId,
          code: building.code,
          name: building.name,
          floors: [...floors.entries()]
            .sort(([a], [b]) => b - a)
            .map(([floor, cells]) => ({ floor, units: cells })),
        };
      }),
      counts,
    };
  }

  /** INV-SEARCH-003: two to four units side by side, each exactly as the actor may see it. */
  async compareUnits(actor: ActorContext, unitIds: readonly string[]): Promise<Unit[]> {
    if (new Set(unitIds).size !== unitIds.length) throw invalid('DUPLICATE_UNIT', ['ids']);
    const documents = await this.units
      .find(
        withScope(buildCatalogueScopeFilter(actor, INVENTORY_SCOPE_FIELDS), {
          unitId: { $in: [...unitIds] },
        }),
      )
      .lean<UnitDocument[]>()
      .exec();
    // One unit out of scope is not found, exactly as a single read would answer (SEC-030).
    if (documents.length !== unitIds.length) throw new InventoryNotFoundError('unit');
    const order = new Map(unitIds.map((id, index) => [id, index]));
    documents.sort((a, b) => (order.get(a.unitId) ?? 0) - (order.get(b.unitId) ?? 0));
    return restrictDocuments('unit', actor, documents.map(toUnit)) as Unit[];
  }

  /** The project a unit belongs to, unscoped — for another module's transaction. */
  async findProjectUnscoped(projectId: string): Promise<Project | undefined> {
    assertSafeFilter({ projectId });
    const document = await this.projects.findOne({ projectId }).lean<ProjectDocument>().exec();
    return document ? toProject(document) : undefined;
  }
}
