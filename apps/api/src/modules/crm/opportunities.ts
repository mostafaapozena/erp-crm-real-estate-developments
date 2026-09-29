import {
  CRM_AUDIT_ACTIONS,
  OPEN_OPPORTUNITY_STAGES,
  OPPORTUNITY_STAGES,
  OpportunitySchema,
  SYSTEM_OPPORTUNITY_STAGES,
  TERMINAL_OPPORTUNITY_STAGES,
  addMoney,
  canTransitionOpportunity,
  divideMoney,
  money,
  multiplyMoney,
  type Activity,
  type ActorContext,
  type ChangeOpportunityStage,
  type CreateActivity,
  type CreateOpportunity,
  type Customer,
  type Lead,
  type Money,
  type Opportunity,
  type OpportunityPage,
  type OpportunityQuery,
  type OpportunityStage,
  type OpportunitySummary,
  type OwnershipChange,
  type TransferOwnership,
  type UpdateOpportunity,
} from '@alola/contracts';
import {
  assertSafeFilter,
  buildChangeSummary,
  buildScopeFilter,
  can,
  withScope,
  type ScopeFieldMap,
} from '@alola/security';
import type { ClientSession, Connection, Types } from 'mongoose';
import {
  auditActor,
  conflict,
  invalid,
  type AuditRecorder,
  type RequestContext,
} from '../../platform/audit-port';
import { newId } from '../../platform/ids';
import { fromDecimal128, toDecimal128 } from '../../platform/money-storage';
import { withTransaction } from '../../platform/transactions';
import { opportunityModel, type OpportunityDocument, type StoredMoney } from './model';
import { CrmNotFoundError, CrmService, type ReasonCodeCheck } from './service';

/**
 * Opportunities (CRM-OPP-001, CRM-OPP-002, CRM-PIPE-001, CRM-OWNER-001, CRM-REPORT-001).
 *
 * An opportunity belongs to a customer and sits in the customer's branch, which never changes; its
 * owner, team and department follow whoever works it. Two stages are **not** a person's to set:
 * `reservation` is entered by creating a reservation, and `won` by activating its contract — so the
 * pipeline report can never claim a sale the sales records do not show.
 */
export const OPPORTUNITY_SCOPE_FIELDS: ScopeFieldMap = {
  owner: 'ownerAccountId',
  assignee: 'ownerAccountId',
  team: 'teamId',
  department: 'departmentId',
  branch: 'branchId',
  project: 'projectId',
  legalEntity: 'legalEntityId',
};

/** The configured win probability per open stage (`BD-27`), or `null` when not configured. */
export type StageProbabilities = () => Promise<Partial<Record<OpportunityStage, string>> | null>;

export interface OpportunityServiceOptions {
  connection: Connection;
  audit: AuditRecorder;
  crm: CrmService;
  probabilities: StageProbabilities;
  isActiveReason?: ReasonCodeCheck;
}

const iso = (date: Date) => date.toISOString();

function toMoney(stored: StoredMoney | undefined): Money | undefined {
  return stored ? { amount: fromDecimal128(stored.amount), currency: stored.currency } : undefined;
}

function fromMoney(value: Money | undefined): StoredMoney | undefined {
  return value ? { amount: toDecimal128(value.amount), currency: value.currency } : undefined;
}

function toOpportunity(
  d: OpportunityDocument,
  probabilities: Partial<Record<OpportunityStage, string>> | null,
): Opportunity {
  const probability = probabilities?.[d.stage];
  const budgetMin = toMoney(d.budgetMin);
  const budgetMax = toMoney(d.budgetMax);
  const expectedValue = toMoney(d.expectedValue);
  return OpportunitySchema.parse({
    opportunityId: d.opportunityId,
    customerId: d.customerId,
    ...(d.leadId ? { leadId: d.leadId } : {}),
    ...(d.source ? { source: d.source } : {}),
    ...(d.campaignId ? { campaignId: d.campaignId } : {}),
    ...(d.projectId ? { projectId: d.projectId } : {}),
    ...(d.propertyType ? { propertyType: d.propertyType } : {}),
    ...(d.usageType ? { usageType: d.usageType } : {}),
    ...(budgetMin ? { budgetMin } : {}),
    ...(budgetMax ? { budgetMax } : {}),
    ...(expectedValue ? { expectedValue } : {}),
    ...(d.expectedCloseOn ? { expectedCloseOn: d.expectedCloseOn } : {}),
    stage: d.stage,
    ...(probability !== undefined ? { probability } : {}),
    ...(d.lostReason ? { lostReason: d.lostReason } : {}),
    ...(d.lostReasonCode ? { lostReasonCode: d.lostReasonCode } : {}),
    ...(d.reservationId ? { reservationId: d.reservationId } : {}),
    ...(d.contractId ? { contractId: d.contractId } : {}),
    ...(d.notes ? { notes: d.notes } : {}),
    ownerAccountId: d.ownerAccountId,
    legalEntityId: d.legalEntityId,
    branchId: d.branchId,
    ...(d.departmentId ? { departmentId: d.departmentId } : {}),
    ...(d.teamId ? { teamId: d.teamId } : {}),
    stageChangedAt: iso(d.stageChangedAt),
    ...(d.closedAt ? { closedAt: iso(d.closedAt) } : {}),
    version: d.version,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

/** An amount written with exactly scale decimals, as the database's own sums are. */
function fixedScale(value: Money, scale: number): Money {
  const [whole = '0', fraction = ''] = value.amount.split('.');
  return money(`${whole}.${fraction.padEnd(scale, '0')}`, value.currency);
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | undefined {
  try {
    const [text, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!text || !id) return undefined;
    const createdAt = new Date(text);
    return Number.isNaN(createdAt.getTime()) ? undefined : { createdAt, id };
  } catch {
    return undefined;
  }
}

export class OpportunityService {
  private readonly connection;
  private readonly opportunities;
  private readonly audit;
  private readonly crm;

  constructor(private readonly options: OpportunityServiceOptions) {
    this.connection = options.connection;
    this.opportunities = opportunityModel(options.connection);
    this.audit = options.audit;
    this.crm = options.crm;
  }

  private async present(documents: OpportunityDocument[]): Promise<Opportunity[]> {
    const probabilities = await this.options.probabilities();
    return documents.map((document) => toOpportunity(document, probabilities));
  }

  private async scoped(actor: ActorContext, opportunityId: string): Promise<OpportunityDocument> {
    assertSafeFilter({ opportunityId });
    const document = await this.opportunities
      .findOne(withScope(buildScopeFilter(actor, OPPORTUNITY_SCOPE_FIELDS), { opportunityId }))
      .lean<OpportunityDocument>()
      .exec();
    if (!document) throw new CrmNotFoundError('opportunity');
    return document;
  }

  async get(actor: ActorContext, opportunityId: string): Promise<Opportunity> {
    const [opportunity] = await this.present([await this.scoped(actor, opportunityId)]);
    return opportunity as Opportunity;
  }

  /** For sales, inside its own transaction: the fact, with no actor and no scope. */
  async findUnscoped(
    opportunityId: string,
    session?: ClientSession,
  ): Promise<Opportunity | undefined> {
    assertSafeFilter({ opportunityId });
    const document = await this.opportunities
      .findOne({ opportunityId })
      .session(session ?? null)
      .lean<OpportunityDocument>()
      .exec();
    return document ? toOpportunity(document, null) : undefined;
  }

  async list(actor: ActorContext, query: OpportunityQuery): Promise<OpportunityPage> {
    const requested: Record<string, unknown> = {};
    for (const key of ['stage', 'customerId', 'projectId', 'ownerAccountId'] as const) {
      const value = query[key];
      if (value !== undefined) requested[key] = value;
    }
    assertSafeFilter(requested);
    if (query.status === 'open') requested['stage'] = { $nin: TERMINAL_OPPORTUNITY_STAGES };
    if (query.status === 'won') requested['stage'] = 'won';
    if (query.status === 'lost') requested['stage'] = 'lost';
    const filter = withScope(buildScopeFilter(actor, OPPORTUNITY_SCOPE_FIELDS), requested);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const paged = cursor
      ? {
          $and: [
            filter,
            {
              $or: [
                { createdAt: { $lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, opportunityId: { $lt: cursor.id } },
              ],
            },
          ],
        }
      : filter;
    const [documents, total] = await Promise.all([
      this.opportunities
        .find(paged)
        .sort({ createdAt: -1, opportunityId: -1 })
        .limit(query.limit + 1)
        .lean<OpportunityDocument[]>()
        .exec(),
      this.opportunities.countDocuments(filter).exec(),
    ]);
    const page = documents.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: await this.present(page),
      total,
      limit: query.limit,
      ...(documents.length > query.limit && last
        ? { nextCursor: encodeCursor(last.createdAt, last.opportunityId) }
        : {}),
    };
  }

  private async write(
    actor: ActorContext,
    document: OpportunityDocument,
    context: RequestContext,
    session: ClientSession,
    namedOwner: boolean,
  ): Promise<void> {
    await this.opportunities.create([document], { session });
    await this.crm.appendActivity(
      actor,
      {
        opportunityId: document.opportunityId,
        customerId: document.customerId,
        ...(document.leadId ? { leadId: document.leadId } : {}),
        kind: 'stageChanged',
        toStage: document.stage,
      },
      session,
    );
    if (namedOwner) {
      await this.crm.recordOwnershipChange(
        actor,
        {
          subjectType: 'opportunity',
          subjectId: document.opportunityId,
          toAccountId: document.ownerAccountId,
          reason: 'assigned when opened',
        },
        session,
      );
    }
    await this.audit.record(
      {
        action: CRM_AUDIT_ACTIONS.opportunityCreated,
        outcome: 'succeeded',
        actor: auditActor(actor),
        target: { type: 'opportunity', id: document.opportunityId },
        changes: buildChangeSummary(undefined, {
          customerId: document.customerId,
          stage: document.stage,
          ownerAccountId: document.ownerAccountId,
          ...(document.projectId ? { projectId: document.projectId } : {}),
          ...(document.leadId ? { leadId: document.leadId } : {}),
        }),
        context,
      },
      { session },
    );
  }

  /** CRM-OPP-001: open an opportunity for a customer the actor can see. */
  async create(
    actor: ActorContext,
    input: CreateOpportunity,
    context: RequestContext,
  ): Promise<Opportunity> {
    // The customer must be visible: an opportunity is never opened on someone the actor cannot see.
    const customer = await this.crm.getCustomer(actor, input.customerId);
    const namesSomeoneElse =
      input.ownerAccountId !== undefined &&
      input.ownerAccountId !== actor.accountId &&
      can(actor, 'crm.opportunity.assign');
    const ownerAccountId = namesSomeoneElse ? (input.ownerAccountId as string) : actor.accountId;
    const placement = namesSomeoneElse
      ? await this.crm.assertEligibleOwner(
          actor,
          ownerAccountId,
          'crm.opportunity.view',
          customer.branchId,
          { type: 'opportunity' },
          context,
        )
      : await this.crm.ownPlacement(actor, customer.branchId);
    const document = this.newDocument(customer, ownerAccountId, placement, input);
    await withTransaction(this.connection, (session) =>
      this.write(actor, document, context, session, namesSomeoneElse),
    );
    const [opportunity] = await this.present([document]);
    return opportunity as Opportunity;
  }

  /**
   * Open an opportunity from a lead inside the lead's conversion transaction (CRM-LEAD-005): the
   * lead's preferences, budget and attribution carry over, and the lead's owner keeps the work.
   */
  async createFromLead(
    actor: ActorContext,
    lead: Lead,
    customer: Customer,
    extras: { expectedValue?: Money; expectedCloseOn?: string; notes?: string },
    context: RequestContext,
    session: ClientSession,
  ): Promise<Opportunity> {
    const document = this.newDocument(
      customer,
      lead.assignedToAccountId,
      {
        ...(lead.departmentId ? { departmentId: lead.departmentId } : {}),
        ...(lead.teamId ? { teamId: lead.teamId } : {}),
      },
      {
        ...(lead.interestedProjectId ? { projectId: lead.interestedProjectId } : {}),
        ...(lead.preferredPropertyType ? { propertyType: lead.preferredPropertyType } : {}),
        ...(lead.preferredUsageType ? { usageType: lead.preferredUsageType } : {}),
        ...(lead.budgetMin ? { budgetMin: lead.budgetMin } : {}),
        ...(lead.budgetMax ? { budgetMax: lead.budgetMax } : {}),
        ...extras,
      },
      {
        leadId: lead.leadId,
        source: lead.currentSource ?? lead.source,
        ...(lead.campaignId ? { campaignId: lead.campaignId } : {}),
      },
    );
    await this.write(actor, document, context, session, false);
    const [opportunity] = await this.present([document]);
    return opportunity as Opportunity;
  }

  private newDocument(
    customer: Customer,
    ownerAccountId: string,
    placement: { departmentId?: string; teamId?: string },
    details: {
      projectId?: string;
      propertyType?: string;
      usageType?: string;
      budgetMin?: Money;
      budgetMax?: Money;
      expectedValue?: Money;
      expectedCloseOn?: string;
      notes?: string;
    },
    origin: { leadId?: string; source?: OpportunityDocument['source']; campaignId?: string } = {},
  ): OpportunityDocument {
    const now = new Date();
    return {
      opportunityId: newId('opp'),
      customerId: customer.customerId,
      ...(origin.leadId ? { leadId: origin.leadId } : {}),
      ...(origin.source ? { source: origin.source } : {}),
      ...(origin.campaignId ? { campaignId: origin.campaignId } : {}),
      ...(details.projectId ? { projectId: details.projectId } : {}),
      ...(details.propertyType ? { propertyType: details.propertyType } : {}),
      ...(details.usageType ? { usageType: details.usageType } : {}),
      ...(details.budgetMin ? { budgetMin: fromMoney(details.budgetMin) } : {}),
      ...(details.budgetMax ? { budgetMax: fromMoney(details.budgetMax) } : {}),
      ...(details.expectedValue ? { expectedValue: fromMoney(details.expectedValue) } : {}),
      ...(details.expectedCloseOn ? { expectedCloseOn: details.expectedCloseOn } : {}),
      ...(details.notes ? { notes: details.notes } : {}),
      stage: 'discovery',
      ownerAccountId,
      legalEntityId: customer.legalEntityId,
      branchId: customer.branchId,
      ...placement,
      stageChangedAt: now,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  async update(
    actor: ActorContext,
    opportunityId: string,
    input: UpdateOpportunity,
    context: RequestContext,
  ): Promise<Opportunity> {
    const before = await this.scoped(actor, opportunityId);
    if (TERMINAL_OPPORTUNITY_STAGES.includes(before.stage)) throw conflict('OPPORTUNITY_CLOSED');
    if (before.version !== input.expectedVersion) throw conflict('STALE_VERSION');
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of [
      'projectId',
      'propertyType',
      'usageType',
      'expectedCloseOn',
      'notes',
    ] as const) {
      if (input[key] !== undefined) set[key] = input[key];
    }
    for (const key of ['budgetMin', 'budgetMax', 'expectedValue'] as const) {
      if (input[key] !== undefined) set[key] = fromMoney(input[key]);
    }
    if (Object.keys(set).length === 1) throw invalid('NOTHING_TO_CHANGE');
    const updated = await withTransaction(this.connection, async (session) => {
      const result = await this.opportunities
        .findOneAndUpdate(
          { opportunityId, version: before.version },
          { $set: set, $inc: { version: 1 } },
          { returnDocument: 'after', runValidators: true, session },
        )
        .lean<OpportunityDocument>()
        .exec();
      if (!result) throw conflict('STALE_VERSION');
      await this.audit.record(
        {
          action: CRM_AUDIT_ACTIONS.opportunityUpdated,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'opportunity', id: opportunityId },
          changes: buildChangeSummary(
            {
              projectId: before.projectId,
              expectedCloseOn: before.expectedCloseOn,
              expectedValue: before.expectedValue
                ? fromDecimal128(before.expectedValue.amount)
                : undefined,
            },
            {
              projectId: result.projectId,
              expectedCloseOn: result.expectedCloseOn,
              expectedValue: result.expectedValue
                ? fromDecimal128(result.expectedValue.amount)
                : undefined,
            },
          ),
          context,
        },
        { session },
      );
      return result;
    });
    return (await this.present([updated]))[0] as Opportunity;
  }

  /** CRM-PIPE-001 for opportunities: a person's move, never into a stage sales owns. */
  async changeStage(
    actor: ActorContext,
    opportunityId: string,
    input: ChangeOpportunityStage,
    context: RequestContext,
  ): Promise<Opportunity> {
    const before = await this.scoped(actor, opportunityId);
    if (before.version !== input.expectedVersion) throw conflict('STALE_VERSION');
    const refuse = async (issue: string): Promise<never> => {
      await this.audit.record({
        action: CRM_AUDIT_ACTIONS.opportunityStageRefused,
        outcome: 'denied',
        actor: auditActor(actor),
        target: { type: 'opportunity', id: opportunityId },
        reason: `refused stage move ${before.stage} -> ${input.stage}: ${issue}`,
        context,
      });
      throw conflict(issue, ['stage']);
    };
    if (SYSTEM_OPPORTUNITY_STAGES.includes(input.stage)) return refuse('STAGE_SET_BY_SALES');
    // Leaving `reservation` is the reservation's business: cancelling it returns the opportunity.
    if (before.stage === 'reservation') return refuse('STAGE_SET_BY_SALES');
    if (!canTransitionOpportunity(before.stage, input.stage)) return refuse('STAGE_NOT_ALLOWED');
    if (input.stage === 'lost' && !input.reason?.trim())
      throw invalid('REASON_REQUIRED', ['reason']);
    if (input.reasonCode !== undefined) {
      if (input.stage !== 'lost') throw invalid('REASON_CODE_ONLY_FOR_LOST', ['reasonCode']);
      const active = this.options.isActiveReason
        ? await this.options.isActiveReason('lossReasons', input.reasonCode)
        : false;
      if (!active) throw invalid('REASON_CODE_UNKNOWN', ['reasonCode']);
    }
    return this.move(actor, before, input.stage, context, {
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    });
  }

  private async move(
    actor: ActorContext,
    before: OpportunityDocument,
    to: OpportunityStage,
    context: RequestContext,
    extra: { reason?: string; reasonCode?: string; reservationId?: string; contractId?: string },
    session?: ClientSession,
  ): Promise<Opportunity> {
    const now = new Date();
    const set: Record<string, unknown> = { stage: to, stageChangedAt: now, updatedAt: now };
    const unset: Record<string, ''> = {};
    if (to === 'lost') {
      set['lostReason'] = extra.reason;
      set['closedAt'] = now;
      if (extra.reasonCode) set['lostReasonCode'] = extra.reasonCode;
    }
    if (to === 'won') set['closedAt'] = now;
    if (before.stage === 'lost' && to !== 'lost') {
      unset['closedAt'] = '';
      unset['lostReason'] = '';
      unset['lostReasonCode'] = '';
    }
    if (extra.reservationId) set['reservationId'] = extra.reservationId;
    if (extra.contractId) set['contractId'] = extra.contractId;
    // Returning to negotiation releases the link to a reservation that no longer holds.
    if (before.stage === 'reservation' && to === 'negotiation') unset['reservationId'] = '';

    const work = async (tx: ClientSession) => {
      const result = await this.opportunities
        .findOneAndUpdate(
          { opportunityId: before.opportunityId, stage: before.stage, version: before.version },
          {
            $set: set,
            $inc: { version: 1 },
            ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
          },
          { returnDocument: 'after', runValidators: true, session: tx },
        )
        .lean<OpportunityDocument>()
        .exec();
      // The stage and version are in the filter, so a concurrent move loses instead of overwriting.
      if (!result) throw conflict('STALE_VERSION');
      await this.crm.appendActivity(
        actor,
        {
          opportunityId: before.opportunityId,
          customerId: before.customerId,
          kind: 'stageChanged',
          fromStage: before.stage,
          toStage: to,
          ...(extra.reason ? { body: extra.reason } : {}),
        },
        tx,
      );
      await this.audit.record(
        {
          action: CRM_AUDIT_ACTIONS.opportunityStageChanged,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'opportunity', id: before.opportunityId },
          changes: buildChangeSummary(
            { stage: before.stage },
            { stage: to, ...(extra.reasonCode ? { reasonCode: extra.reasonCode } : {}) },
          ),
          ...(extra.reason ? { reason: extra.reason } : {}),
          context,
        },
        { session: tx },
      );
      return result;
    };
    const updated = session ? await work(session) : await withTransaction(this.connection, work);
    return (await this.present([updated]))[0] as Opportunity;
  }

  /**
   * The sales workflow's move, inside its own transaction: to `reservation` when a reservation is
   * taken, to `won` when its contract is activated, back to `negotiation` when a reservation is
   * cancelled or expires. Refuses a move the pipeline does not permit, so the sale fails with it.
   */
  async advanceInternal(
    actor: ActorContext,
    opportunityId: string,
    to: 'reservation' | 'won' | 'negotiation',
    links: { reservationId?: string; contractId?: string },
    reason: string,
    context: RequestContext,
    session: ClientSession,
  ): Promise<Opportunity> {
    assertSafeFilter({ opportunityId });
    const before = await this.opportunities
      .findOne({ opportunityId })
      .session(session)
      .lean<OpportunityDocument>()
      .exec();
    if (!before) throw new CrmNotFoundError('opportunity');
    if (!canTransitionOpportunity(before.stage, to)) {
      throw conflict('OPPORTUNITY_NOT_OPEN', ['opportunityId']);
    }
    return this.move(actor, before, to, context, { reason, ...links }, session);
  }

  /** CRM-OWNER-001: hand an opportunity to an eligible colleague. */
  async assign(
    actor: ActorContext,
    opportunityId: string,
    input: TransferOwnership,
    context: RequestContext,
  ): Promise<Opportunity> {
    const before = await this.scoped(actor, opportunityId);
    if (input.toAccountId === before.ownerAccountId)
      throw invalid('ALREADY_OWNER', ['toAccountId']);
    if (TERMINAL_OPPORTUNITY_STAGES.includes(before.stage)) throw conflict('OPPORTUNITY_CLOSED');
    const placement = await this.crm.assertEligibleOwner(
      actor,
      input.toAccountId,
      'crm.opportunity.view',
      before.branchId,
      { type: 'opportunity', id: opportunityId },
      context,
    );
    const moved = CrmService.placementUpdate(placement);
    const updated = await withTransaction(this.connection, async (session) => {
      const result = await this.opportunities
        .findOneAndUpdate(
          { opportunityId, version: before.version },
          {
            $set: { ownerAccountId: input.toAccountId, ...moved.set, updatedAt: new Date() },
            $unset: moved.unset,
            $inc: { version: 1 },
          },
          { returnDocument: 'after', runValidators: true, session },
        )
        .lean<OpportunityDocument>()
        .exec();
      if (!result) throw conflict('STALE_VERSION');
      await this.crm.recordOwnershipChange(
        actor,
        {
          subjectType: 'opportunity',
          subjectId: opportunityId,
          fromAccountId: before.ownerAccountId,
          toAccountId: input.toAccountId,
          reason: input.reason,
        },
        session,
      );
      await this.audit.record(
        {
          action: CRM_AUDIT_ACTIONS.opportunityAssigned,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'opportunity', id: opportunityId },
          changes: buildChangeSummary(
            { ownerAccountId: before.ownerAccountId },
            { ownerAccountId: input.toAccountId },
          ),
          reason: input.reason,
          context,
        },
        { session },
      );
      return result;
    });
    return (await this.present([updated]))[0] as Opportunity;
  }

  async ownershipHistory(actor: ActorContext, opportunityId: string): Promise<OwnershipChange[]> {
    await this.scoped(actor, opportunityId);
    return this.crm.ownershipHistory('opportunity', opportunityId);
  }

  async activities(actor: ActorContext, opportunityId: string): Promise<Activity[]> {
    await this.scoped(actor, opportunityId);
    return this.crm.listOpportunityActivities(opportunityId);
  }

  async addActivity(
    actor: ActorContext,
    opportunityId: string,
    input: CreateActivity,
    context: RequestContext,
  ): Promise<Activity> {
    const opportunity = await this.scoped(actor, opportunityId);
    return withTransaction(this.connection, async (session) => {
      const activity = await this.crm.appendActivity(
        actor,
        {
          opportunityId,
          customerId: opportunity.customerId,
          kind: input.kind,
          ...(input.body ? { body: input.body } : {}),
          ...(input.dueOn ? { dueOn: input.dueOn } : {}),
        },
        session,
      );
      await this.audit.record(
        {
          action: CRM_AUDIT_ACTIONS.activityRecorded,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'opportunity', id: opportunityId },
          changes: buildChangeSummary(undefined, { kind: input.kind }),
          context,
        },
        { session },
      );
      return activity;
    });
  }

  /**
   * CRM-REPORT-001: the pipeline in scope. Expected values are summed by the database per stage and
   * currency; the weighted value exists only when every open stage has a configured probability.
   */
  async summary(actor: ActorContext): Promise<OpportunitySummary> {
    const scopeFilter = withScope(buildScopeFilter(actor, OPPORTUNITY_SCOPE_FIELDS));
    const rows = await this.opportunities
      .aggregate<{
        _id: { stage: OpportunityStage; currency: string | null };
        count: number;
        total: Types.Decimal128 | null;
      }>([
        { $match: scopeFilter },
        {
          $group: {
            _id: { stage: '$stage', currency: '$expectedValue.currency' },
            count: { $sum: 1 },
            total: { $sum: '$expectedValue.amount' },
          },
        },
      ])
      .exec();
    const probabilities = await this.options.probabilities();
    const byStage = OPPORTUNITY_STAGES.map((stage) => {
      const stageRows = rows.filter((row) => row._id.stage === stage);
      return {
        stage,
        count: stageRows.reduce((sum, row) => sum + row.count, 0),
        expectedValue: stageRows
          .filter((row) => row._id.currency && row.total)
          .map((row) =>
            money(fromDecimal128(row.total as Types.Decimal128), row._id.currency as string),
          )
          .sort((a, b) => a.currency.localeCompare(b.currency)),
      };
    });
    const open = byStage
      .filter((row) => !TERMINAL_OPPORTUNITY_STAGES.includes(row.stage))
      .reduce((sum, row) => sum + row.count, 0);
    const configured =
      probabilities !== null &&
      OPEN_OPPORTUNITY_STAGES.every((stage) => probabilities[stage] !== undefined);
    let weighted: Money[] | undefined;
    if (configured) {
      const totals = new Map<string, Money>();
      for (const row of byStage) {
        const rate = probabilities[row.stage];
        if (rate === undefined) continue;
        for (const value of row.expectedValue) {
          // Σ value × rate ÷ 100, in decimal arithmetic, rounded to the piastre only at the end.
          const part = multiplyMoney(value, rate);
          const running = totals.get(value.currency);
          totals.set(value.currency, running ? addMoney(running, part) : part);
        }
      }
      weighted = [...totals.values()]
        .map((total) => fixedScale(divideMoney(total, '100', 2), 2))
        .sort((a, b) => a.currency.localeCompare(b.currency));
    }
    return {
      byStage,
      open,
      ...(weighted ? { weightedOpenValue: weighted } : {}),
      probabilitiesConfigured: configured,
    };
  }
}
