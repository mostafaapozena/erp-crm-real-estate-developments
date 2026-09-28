import {
  ActivitySchema,
  CRM_AUDIT_ACTIONS,
  CustomerSchema,
  LeadSchema,
  TERMINAL_LEAD_STAGES,
  canTransitionLead,
  normalizePhone,
  type Activity,
  type ActorContext,
  type AssignLead,
  type BusinessDate,
  type ChangeLeadStage,
  type CreateActivity,
  type CreateCustomer,
  type CreateLead,
  type CreateLeadResult,
  type CrmDashboard,
  type Customer,
  type Lead,
  type LeadPage,
  type LeadQuery,
  type LeadStage,
  type Money,
} from '@alola/contracts';
import {
  assertSafeFilter,
  buildChangeSummary,
  buildScopeFilter,
  withScope,
  type ScopeFieldMap,
} from '@alola/security';
import type { ClientSession, Connection } from 'mongoose';
import { newId } from '../../platform/ids';
import { fromDecimal128, toDecimal128 } from '../../platform/money-storage';
import {
  activityModel,
  customerModel,
  leadModel,
  type ActivityDocument,
  type CustomerDocument,
  type LeadDocument,
  type StoredMoney,
} from './model';

/**
 * CRM service — `CRM-*` demonstration slice (ADR-0025).
 *
 * Three decisions worth stating, because each one is the opposite of the obvious implementation:
 *
 * 1. **A duplicate phone number is a warning, not a refusal.** Households, switchboards and brokers
 *    genuinely share numbers. Refusing loses business; saying nothing lets two colleagues work the
 *    same buyer. So the create succeeds and reports what it found.
 * 2. **The pipeline may go backwards.** A deal that cools moves back a stage. A system that forbids
 *    it teaches people to lie in the notes, and then the pipeline report is worthless. Only `won` and
 *    `lost` are strict, and `lost` demands a reason.
 * 3. **Ownership is stored, never claimed.** `assignedToAccountId` comes from the actor unless they
 *    hold `crm.lead.assign`; nothing in a request body can hand a lead to someone else.
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

export type BranchResolver = (branchId: string) => Promise<{ legalEntityId: string } | undefined>;

export class CrmNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(readonly what: string) {
    super('NOT_FOUND');
    this.name = 'CrmNotFoundError';
  }
}

export class CrmConflictError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly what: string) {
    super('CONFLICT');
    this.name = 'CrmConflictError';
  }
}

export class LeadStageError extends Error {
  readonly code = 'CONFLICT';
  constructor(
    readonly from: LeadStage,
    readonly to: LeadStage,
  ) {
    super('CONFLICT');
    this.name = 'LeadStageError';
  }
}

/** A `lost` move with no reason. A validation failure, not a conflict: the input is incomplete. */
export class LostReasonRequiredError extends Error {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('VALIDATION_FAILED');
    this.name = 'LostReasonRequiredError';
  }
}

/**
 * Scope mapping for leads (SEC-026).
 *
 * `self` and `assigned` both resolve to the sales owner, which is what a representative's scope means
 * here: their own leads. `project` resolves against the project the lead is interested in, which is
 * how a project-scoped actor sees a pipeline without seeing the rest of the branch.
 */
export const LEAD_SCOPE_FIELDS: ScopeFieldMap = {
  owner: 'assignedToAccountId',
  assignee: 'assignedToAccountId',
  team: 'teamId',
  department: 'departmentId',
  branch: 'branchId',
  project: 'interestedProjectId',
  legalEntity: 'legalEntityId',
};

export const CUSTOMER_SCOPE_FIELDS: ScopeFieldMap = {
  owner: 'ownerAccountId',
  assignee: 'ownerAccountId',
  branch: 'branchId',
  legalEntity: 'legalEntityId',
};

const iso = (date: Date) => date.toISOString();

function toMoney(stored: StoredMoney | undefined): Money | undefined {
  return stored ? { amount: fromDecimal128(stored.amount), currency: stored.currency } : undefined;
}

function fromMoney(value: Money | undefined): StoredMoney | undefined {
  return value ? { amount: toDecimal128(value.amount), currency: value.currency } : undefined;
}

function toCustomer(d: CustomerDocument): Customer {
  return CustomerSchema.parse({
    customerId: d.customerId,
    name: d.name,
    primaryPhone: d.primaryPhone,
    ...(d.secondaryPhone ? { secondaryPhone: d.secondaryPhone } : {}),
    ...(d.email ? { email: d.email } : {}),
    ...(d.nationalId ? { nationalId: d.nationalId } : {}),
    ...(d.address ? { address: d.address } : {}),
    legalEntityId: d.legalEntityId,
    branchId: d.branchId,
    ownerAccountId: d.ownerAccountId,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

function toLead(d: LeadDocument): Lead {
  const budgetMin = toMoney(d.budgetMin);
  const budgetMax = toMoney(d.budgetMax);
  return LeadSchema.parse({
    leadId: d.leadId,
    name: d.name,
    primaryPhone: d.primaryPhone,
    ...(d.secondaryPhone ? { secondaryPhone: d.secondaryPhone } : {}),
    ...(d.email ? { email: d.email } : {}),
    source: d.source,
    ...(d.campaignId ? { campaignId: d.campaignId } : {}),
    ...(d.interestedProjectId ? { interestedProjectId: d.interestedProjectId } : {}),
    ...(d.preferredPropertyType ? { preferredPropertyType: d.preferredPropertyType } : {}),
    ...(d.preferredUsageType ? { preferredUsageType: d.preferredUsageType } : {}),
    ...(budgetMin ? { budgetMin } : {}),
    ...(budgetMax ? { budgetMax } : {}),
    assignedToAccountId: d.assignedToAccountId,
    legalEntityId: d.legalEntityId,
    branchId: d.branchId,
    ...(d.departmentId ? { departmentId: d.departmentId } : {}),
    ...(d.teamId ? { teamId: d.teamId } : {}),
    ...(d.notes ? { notes: d.notes } : {}),
    ...(d.nextFollowUpOn ? { nextFollowUpOn: d.nextFollowUpOn } : {}),
    stage: d.stage,
    ...(d.lostReason ? { lostReason: d.lostReason } : {}),
    ...(d.customerId ? { customerId: d.customerId } : {}),
    version: d.version,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

function toActivity(d: ActivityDocument): Activity {
  return ActivitySchema.parse({
    activityId: d.activityId,
    leadId: d.leadId,
    kind: d.kind,
    ...(d.body ? { body: d.body } : {}),
    ...(d.fromStage ? { fromStage: d.fromStage } : {}),
    ...(d.toStage ? { toStage: d.toStage } : {}),
    ...(d.dueOn ? { dueOn: d.dueOn } : {}),
    ...(d.actorAccountId ? { actorAccountId: d.actorAccountId } : {}),
    occurredAt: iso(d.occurredAt),
  });
}

function encodeCursor(createdAt: Date, leadId: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${leadId}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; leadId: string } | undefined {
  try {
    const [iso_, leadId] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!iso_ || !leadId) return undefined;
    const createdAt = new Date(iso_);
    return Number.isNaN(createdAt.getTime()) ? undefined : { createdAt, leadId };
  } catch {
    return undefined;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class CrmService {
  private readonly customers;
  private readonly leads;
  private readonly activities;
  private readonly audit;
  private readonly resolveBranch;
  private readonly today: () => BusinessDate;

  constructor(options: {
    connection: Connection;
    audit: AuditRecorder;
    resolveBranch: BranchResolver;
    /** Injected so a test can fix "today" without moving the process clock. */
    today: () => BusinessDate;
  }) {
    this.customers = customerModel(options.connection);
    this.leads = leadModel(options.connection);
    this.activities = activityModel(options.connection);
    this.audit = options.audit;
    this.resolveBranch = options.resolveBranch;
    this.today = options.today;
  }

  /* ------------------------------------------------------------- customers */

  async listCustomers(actor: ActorContext, search?: string): Promise<Customer[]> {
    const base = withScope(buildScopeFilter(actor, CUSTOMER_SCOPE_FIELDS));
    const filter = search
      ? {
          $and: [
            base,
            {
              $or: [
                { name: { $regex: `^${escapeRegex(search)}`, $options: 'i' } },
                { primaryPhoneDigits: { $regex: `^${escapeRegex(normalizePhone(search))}` } },
              ],
            },
          ],
        }
      : base;
    const documents = await this.customers
      .find(filter)
      .sort({ name: 1, customerId: 1 })
      .limit(100)
      .lean<CustomerDocument[]>()
      .exec();
    return documents.map(toCustomer);
  }

  /**
   * Customers by name or phone prefix, inside the actor's scope (CORE-SEARCH-001). Only the name is
   * returned: a phone number is matched, never echoed.
   */
  async searchCustomers(
    actor: ActorContext,
    term: string,
    limit: number,
  ): Promise<{ id: string; label: string }[]> {
    const digits = normalizePhone(term);
    const filter = withScope(buildScopeFilter(actor, CUSTOMER_SCOPE_FIELDS), {
      $or: [
        { name: { $regex: `^${escapeRegex(term)}`, $options: 'i' } },
        ...(digits.length >= 3
          ? [{ primaryPhoneDigits: { $regex: `^${escapeRegex(digits)}` } }]
          : []),
      ],
    });
    const rows = await this.customers
      .find(filter, { customerId: 1, name: 1 })
      .sort({ name: 1, customerId: 1 })
      .limit(limit)
      .lean<CustomerDocument[]>()
      .exec();
    return rows.map((row) => ({ id: row.customerId, label: row.name }));
  }

  async getCustomer(actor: ActorContext, customerId: string): Promise<Customer> {
    assertSafeFilter({ customerId });
    const filter = withScope(buildScopeFilter(actor, CUSTOMER_SCOPE_FIELDS), { customerId });
    const document = await this.customers.findOne(filter).lean<CustomerDocument>().exec();
    if (!document) throw new CrmNotFoundError('customer');
    return toCustomer(document);
  }

  async createCustomer(
    actor: ActorContext,
    input: CreateCustomer,
    context: RequestContext,
    session?: ClientSession,
  ): Promise<Customer> {
    assertSafeFilter({ branchId: input.branchId });
    const branch = await this.resolveBranch(input.branchId);
    if (!branch) throw new CrmNotFoundError('branch');

    const digits = normalizePhone(input.primaryPhone);
    const existing = await this.customers
      .findOne({ legalEntityId: branch.legalEntityId, primaryPhoneDigits: digits })
      .lean<CustomerDocument>()
      .exec();
    // Unlike a lead, a customer really is unique by phone inside one legal entity: a second record
    // would split their contracts and their payment history across two identities.
    if (existing) throw new CrmConflictError('duplicateCustomerPhone');

    const now = new Date();
    const document: CustomerDocument = {
      customerId: newId('cus'),
      name: input.name,
      primaryPhone: input.primaryPhone,
      primaryPhoneDigits: digits,
      ...(input.secondaryPhone ? { secondaryPhone: input.secondaryPhone } : {}),
      ...(input.email ? { email: input.email } : {}),
      ...(input.nationalId ? { nationalId: input.nationalId } : {}),
      ...(input.address ? { address: input.address } : {}),
      legalEntityId: branch.legalEntityId,
      branchId: input.branchId,
      ownerAccountId: input.ownerAccountId ?? actor.accountId,
      createdAt: now,
      updatedAt: now,
    };
    // `create` takes an array when a session is involved; the single-document overload has no options.
    const [stored] = await this.customers.create([document], session ? { session } : {});
    if (!stored) throw new CrmConflictError('customerNotCreated');
    const customer = toCustomer(stored.toObject());
    await this.audit.record(
      {
        action: CRM_AUDIT_ACTIONS.customerCreated,
        outcome: 'succeeded',
        actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
        target: { type: 'customer', id: customer.customerId },
        // The change summary redacts sensitive values; a phone number is not put in the audit body.
        changes: buildChangeSummary(undefined, {
          branchId: customer.branchId,
          ownerAccountId: customer.ownerAccountId,
        }),
        context,
      },
      session ? { session } : {},
    );
    return customer;
  }

  /**
   * One customer, with no actor and no scope, for another module inside its own transaction.
   *
   * The caller has already been authorized for its own operation; what it needs here is a fact about
   * the customer — which legal entity they belong to — that must come from storage rather than from a
   * request body. Narrow on purpose, so it cannot become a way around `getCustomer`'s scoping.
   */
  async findCustomerUnscoped(
    customerId: string,
    session?: ClientSession,
  ): Promise<Customer | undefined> {
    assertSafeFilter({ customerId });
    const document = await this.customers
      .findOne({ customerId })
      .session(session ?? null)
      .lean<CustomerDocument>()
      .exec();
    return document ? toCustomer(document) : undefined;
  }

  /** Find or create the customer behind a lead, inside a caller's transaction. */
  async ensureCustomerForLead(
    actor: ActorContext,
    lead: Lead,
    context: RequestContext,
    session?: ClientSession,
  ): Promise<Customer> {
    if (lead.customerId) {
      const existing = await this.customers
        .findOne({ customerId: lead.customerId })
        .session(session ?? null)
        .lean<CustomerDocument>()
        .exec();
      if (existing) return toCustomer(existing);
    }
    const digits = normalizePhone(lead.primaryPhone);
    const byPhone = await this.customers
      .findOne({ legalEntityId: lead.legalEntityId, primaryPhoneDigits: digits })
      .session(session ?? null)
      .lean<CustomerDocument>()
      .exec();
    if (byPhone) return toCustomer(byPhone);

    return this.createCustomer(
      actor,
      {
        name: lead.name,
        primaryPhone: lead.primaryPhone,
        ...(lead.secondaryPhone ? { secondaryPhone: lead.secondaryPhone } : {}),
        ...(lead.email ? { email: lead.email } : {}),
        branchId: lead.branchId,
        ownerAccountId: lead.assignedToAccountId,
      },
      context,
      session,
    );
  }

  /* ----------------------------------------------------------------- leads */

  private leadFilter(actor: ActorContext, query: LeadQuery): Record<string, unknown> {
    const requested: Record<string, unknown> = {};
    for (const key of [
      'stage',
      'source',
      'assignedToAccountId',
      'interestedProjectId',
      'branchId',
      'teamId',
    ] as const) {
      const value = query[key];
      if (value !== undefined) requested[key] = value;
    }
    assertSafeFilter(requested);
    const clauses: Record<string, unknown>[] = [
      withScope(buildScopeFilter(actor, LEAD_SCOPE_FIELDS), requested),
    ];

    if (query.search) {
      const digits = normalizePhone(query.search);
      const or: Record<string, unknown>[] = [
        { name: { $regex: `^${escapeRegex(query.search)}`, $options: 'i' } },
      ];
      if (digits) or.push({ primaryPhoneDigits: { $regex: `^${escapeRegex(digits)}` } });
      clauses.push({ $or: or });
    }
    if (query.followUp) {
      const today = this.today();
      // Business dates compare correctly as `YYYY-MM-DD` strings; no timezone conversion is involved.
      clauses.push({
        nextFollowUpOn: query.followUp === 'due' ? { $lte: today } : { $lt: today },
        stage: { $nin: TERMINAL_LEAD_STAGES },
      });
    }
    return clauses.length === 1 ? clauses[0]! : { $and: clauses };
  }

  async listLeads(actor: ActorContext, query: LeadQuery): Promise<LeadPage> {
    const filter = this.leadFilter(actor, query);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    // Newest first, tie-broken by id, so pages neither repeat nor skip as leads arrive.
    const paged = cursor
      ? {
          $and: [
            filter,
            {
              $or: [
                { createdAt: { $lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, leadId: { $lt: cursor.leadId } },
              ],
            },
          ],
        }
      : filter;

    const [documents, total] = await Promise.all([
      this.leads
        .find(paged)
        .sort({ createdAt: -1, leadId: -1 })
        .limit(query.limit + 1)
        .lean<LeadDocument[]>()
        .exec(),
      this.leads.countDocuments(filter).exec(),
    ]);
    const page = documents.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toLead),
      total,
      limit: query.limit,
      ...(documents.length > query.limit && last
        ? { nextCursor: encodeCursor(last.createdAt, last.leadId) }
        : {}),
    };
  }

  /** Leads by name or phone prefix, inside the actor's scope (CORE-SEARCH-001). */
  /**
   * Leads for an export (CORE-IMPORT-003): the list's scoped query, bounded by the caller. Contact
   * details leave the system only through here, with `crm.lead.export` and an audit record.
   */
  async exportLeads(
    actor: ActorContext,
    limit: number,
  ): Promise<{ columns: string[]; rows: (string | number | null | undefined)[][] }> {
    const documents = await this.leads
      .find(withScope(buildScopeFilter(actor, LEAD_SCOPE_FIELDS)))
      .sort({ createdAt: 1, leadId: 1 })
      .limit(limit)
      .lean<LeadDocument[]>()
      .exec();
    return {
      columns: [
        'lead_id',
        'name',
        'primary_phone',
        'email',
        'source',
        'stage',
        'next_follow_up_on',
        'created_at',
      ],
      rows: documents.map((lead) => [
        lead.leadId,
        lead.name,
        lead.primaryPhone,
        lead.email,
        lead.source,
        lead.stage,
        lead.nextFollowUpOn,
        lead.createdAt.toISOString(),
      ]),
    };
  }

  async searchLeads(
    actor: ActorContext,
    term: string,
    limit: number,
  ): Promise<{ id: string; label: string; status: string }[]> {
    const digits = normalizePhone(term);
    const filter = withScope(buildScopeFilter(actor, LEAD_SCOPE_FIELDS), {
      $or: [
        { name: { $regex: `^${escapeRegex(term)}`, $options: 'i' } },
        ...(digits.length >= 3
          ? [{ primaryPhoneDigits: { $regex: `^${escapeRegex(digits)}` } }]
          : []),
      ],
    });
    const rows = await this.leads
      .find(filter, { leadId: 1, name: 1, stage: 1 })
      .sort({ name: 1, leadId: 1 })
      .limit(limit)
      .lean<LeadDocument[]>()
      .exec();
    return rows.map((row) => ({ id: row.leadId, label: row.name, status: row.stage }));
  }

  async getLead(actor: ActorContext, leadId: string): Promise<Lead> {
    assertSafeFilter({ leadId });
    const filter = withScope(buildScopeFilter(actor, LEAD_SCOPE_FIELDS), { leadId });
    const document = await this.leads.findOne(filter).lean<LeadDocument>().exec();
    if (!document) throw new CrmNotFoundError('lead');
    return toLead(document);
  }

  /** Read a lead without the actor's scope — for another module inside its own transaction. */
  async findLead(leadId: string, session?: ClientSession): Promise<Lead | undefined> {
    assertSafeFilter({ leadId });
    const document = await this.leads
      .findOne({ leadId })
      .session(session ?? null)
      .lean<LeadDocument>()
      .exec();
    return document ? toLead(document) : undefined;
  }

  async createLead(
    actor: ActorContext,
    input: CreateLead,
    context: RequestContext,
    options: { mayAssign: boolean },
  ): Promise<CreateLeadResult> {
    assertSafeFilter({ branchId: input.branchId });
    const branch = await this.resolveBranch(input.branchId);
    if (!branch) throw new CrmNotFoundError('branch');

    // Ownership is never taken from the body without the permission that allows handing work out.
    const assignedToAccountId =
      options.mayAssign && input.assignedToAccountId ? input.assignedToAccountId : actor.accountId;

    const digits = normalizePhone(input.primaryPhone);
    const duplicate = await this.leads
      .findOne({
        legalEntityId: branch.legalEntityId,
        primaryPhoneDigits: digits,
        stage: { $nin: TERMINAL_LEAD_STAGES },
      })
      .sort({ createdAt: -1 })
      .lean<LeadDocument>()
      .exec();

    const now = new Date();
    const leadId = newId('lead');
    const document: LeadDocument = {
      leadId,
      name: input.name,
      primaryPhone: input.primaryPhone,
      primaryPhoneDigits: digits,
      ...(input.secondaryPhone ? { secondaryPhone: input.secondaryPhone } : {}),
      ...(input.email ? { email: input.email } : {}),
      source: input.source,
      ...(input.campaignId ? { campaignId: input.campaignId } : {}),
      ...(input.interestedProjectId ? { interestedProjectId: input.interestedProjectId } : {}),
      ...(input.preferredPropertyType
        ? { preferredPropertyType: input.preferredPropertyType }
        : {}),
      ...(input.preferredUsageType ? { preferredUsageType: input.preferredUsageType } : {}),
      ...(fromMoney(input.budgetMin) ? { budgetMin: fromMoney(input.budgetMin) } : {}),
      ...(fromMoney(input.budgetMax) ? { budgetMax: fromMoney(input.budgetMax) } : {}),
      assignedToAccountId,
      legalEntityId: branch.legalEntityId,
      branchId: input.branchId,
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
      ...(input.teamId ? { teamId: input.teamId } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
      ...(input.nextFollowUpOn ? { nextFollowUpOn: input.nextFollowUpOn } : {}),
      stage: 'new',
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const created = await this.leads.create(document);
    const lead = toLead(created.toObject());

    await this.activities.create({
      activityId: newId('act'),
      leadId,
      kind: 'note',
      body: input.notes,
      toStage: 'new',
      ...(actor.accountId ? { actorAccountId: actor.accountId } : {}),
      occurredAt: now,
    });

    await this.audit.record({
      action: CRM_AUDIT_ACTIONS.leadCreated,
      outcome: 'succeeded',
      actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
      target: { type: 'lead', id: leadId },
      changes: buildChangeSummary(undefined, {
        source: lead.source,
        branchId: lead.branchId,
        assignedToAccountId: lead.assignedToAccountId,
        stage: lead.stage,
      }),
      context,
    });

    return {
      lead,
      ...(duplicate
        ? {
            possibleDuplicate: {
              leadId: duplicate.leadId,
              name: duplicate.name,
              stage: duplicate.stage,
              assignedToAccountId: duplicate.assignedToAccountId,
            },
          }
        : {}),
    };
  }

  async updateLead(
    actor: ActorContext,
    leadId: string,
    input: Record<string, unknown> & { expectedVersion?: number },
    context: RequestContext,
  ): Promise<Lead> {
    const before = await this.getLead(actor, leadId);
    if (input.expectedVersion !== undefined && input.expectedVersion !== before.version) {
      throw new CrmConflictError('staleVersion');
    }
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of [
      'name',
      'secondaryPhone',
      'email',
      'interestedProjectId',
      'preferredPropertyType',
      'preferredUsageType',
      'notes',
      'nextFollowUpOn',
    ] as const) {
      if (input[key] !== undefined) set[key] = input[key];
    }
    if (input['budgetMin'] !== undefined) set['budgetMin'] = fromMoney(input['budgetMin'] as Money);
    if (input['budgetMax'] !== undefined) set['budgetMax'] = fromMoney(input['budgetMax'] as Money);

    const updated = await this.leads
      .findOneAndUpdate(
        { leadId, version: before.version },
        { $set: set, $inc: { version: 1 } },
        { new: true, runValidators: true },
      )
      .lean<LeadDocument>()
      .exec();
    // The version in the filter makes a concurrent edit lose rather than silently overwrite.
    if (!updated) throw new CrmConflictError('staleVersion');
    const lead = toLead(updated);

    await this.audit.record({
      action: CRM_AUDIT_ACTIONS.leadUpdated,
      outcome: 'succeeded',
      actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
      target: { type: 'lead', id: leadId },
      changes: buildChangeSummary(
        { nextFollowUpOn: before.nextFollowUpOn, interestedProjectId: before.interestedProjectId },
        {
          nextFollowUpOn: lead.nextFollowUpOn,
          interestedProjectId: lead.interestedProjectId,
        },
      ),
      context,
    });
    return lead;
  }

  async changeStage(
    actor: ActorContext,
    leadId: string,
    input: ChangeLeadStage,
    context: RequestContext,
  ): Promise<Lead> {
    const before = await this.getLead(actor, leadId);
    if (input.expectedVersion !== undefined && input.expectedVersion !== before.version) {
      throw new CrmConflictError('staleVersion');
    }
    if (!canTransitionLead(before.stage, input.stage)) {
      await this.audit.record({
        action: CRM_AUDIT_ACTIONS.leadStageRefused,
        outcome: 'denied',
        actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
        target: { type: 'lead', id: leadId },
        reason: `refused stage move ${before.stage} -> ${input.stage}`,
        context,
      });
      throw new LeadStageError(before.stage, input.stage);
    }
    // A lost lead with no reason is the single most useless record in a CRM.
    if (input.stage === 'lost' && !input.reason?.trim()) throw new LostReasonRequiredError();

    const set: Record<string, unknown> = { stage: input.stage, updatedAt: new Date() };
    if (input.stage === 'lost') set['lostReason'] = input.reason;

    const updated = await this.leads
      .findOneAndUpdate(
        { leadId, stage: before.stage },
        { $set: set, $inc: { version: 1 } },
        { new: true, runValidators: true },
      )
      .lean<LeadDocument>()
      .exec();
    if (!updated) throw new LeadStageError(before.stage, input.stage);

    await this.activities.create({
      activityId: newId('act'),
      leadId,
      kind: 'stageChanged',
      ...(input.reason ? { body: input.reason } : {}),
      fromStage: before.stage,
      toStage: input.stage,
      ...(actor.accountId ? { actorAccountId: actor.accountId } : {}),
      occurredAt: new Date(),
    });
    await this.audit.record({
      action: CRM_AUDIT_ACTIONS.leadStageChanged,
      outcome: 'succeeded',
      actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
      target: { type: 'lead', id: leadId },
      changes: buildChangeSummary({ stage: before.stage }, { stage: input.stage }),
      ...(input.reason ? { reason: input.reason } : {}),
      context,
    });
    return toLead(updated);
  }

  /** Move a lead to a stage from inside another module's transaction — reservation, contract. */
  async advanceStageInternal(
    actor: ActorContext,
    leadId: string,
    to: LeadStage,
    reason: string,
    context: RequestContext,
    session: ClientSession,
  ): Promise<void> {
    const current = await this.leads
      .findOne({ leadId })
      .session(session)
      .lean<LeadDocument>()
      .exec();
    if (!current) return;
    if (!canTransitionLead(current.stage, to)) return;
    await this.leads
      .updateOne(
        { leadId, stage: current.stage },
        { $set: { stage: to, updatedAt: new Date() }, $inc: { version: 1 } },
        { session },
      )
      .exec();
    await this.activities.create(
      [
        {
          activityId: newId('act'),
          leadId,
          kind: 'stageChanged',
          body: reason,
          fromStage: current.stage,
          toStage: to,
          ...(actor.accountId ? { actorAccountId: actor.accountId } : {}),
          occurredAt: new Date(),
        },
      ],
      { session },
    );
    await this.audit.record(
      {
        action: CRM_AUDIT_ACTIONS.leadStageChanged,
        outcome: 'succeeded',
        actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
        target: { type: 'lead', id: leadId },
        changes: buildChangeSummary({ stage: current.stage }, { stage: to }),
        reason,
        context,
      },
      { session },
    );
  }

  async assignLead(
    actor: ActorContext,
    leadId: string,
    input: AssignLead,
    context: RequestContext,
  ): Promise<Lead> {
    const before = await this.getLead(actor, leadId);
    const updated = await this.leads
      .findOneAndUpdate(
        { leadId, version: before.version },
        {
          $set: { assignedToAccountId: input.assignedToAccountId, updatedAt: new Date() },
          $inc: { version: 1 },
        },
        { new: true, runValidators: true },
      )
      .lean<LeadDocument>()
      .exec();
    if (!updated) throw new CrmConflictError('staleVersion');

    await this.activities.create({
      activityId: newId('act'),
      leadId,
      kind: 'assignmentChanged',
      body: input.reason,
      ...(actor.accountId ? { actorAccountId: actor.accountId } : {}),
      occurredAt: new Date(),
    });
    await this.audit.record({
      action: CRM_AUDIT_ACTIONS.leadAssigned,
      outcome: 'succeeded',
      actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
      target: { type: 'lead', id: leadId },
      changes: buildChangeSummary(
        { assignedToAccountId: before.assignedToAccountId },
        { assignedToAccountId: input.assignedToAccountId },
      ),
      reason: input.reason,
      context,
    });
    return toLead(updated);
  }

  /* ------------------------------------------------------------ activities */

  async listActivities(actor: ActorContext, leadId: string): Promise<Activity[]> {
    // Visibility of the timeline follows visibility of the lead.
    await this.getLead(actor, leadId);
    const documents = await this.activities
      .find({ leadId })
      .sort({ occurredAt: -1, activityId: -1 })
      .limit(200)
      .lean<ActivityDocument[]>()
      .exec();
    return documents.map(toActivity);
  }

  async addActivity(
    actor: ActorContext,
    leadId: string,
    input: CreateActivity,
    context: RequestContext,
  ): Promise<Activity> {
    const lead = await this.getLead(actor, leadId);
    const now = new Date();
    const created = await this.activities.create({
      activityId: newId('act'),
      leadId,
      kind: input.kind,
      ...(input.body ? { body: input.body } : {}),
      ...(input.dueOn ? { dueOn: input.dueOn } : {}),
      ...(actor.accountId ? { actorAccountId: actor.accountId } : {}),
      occurredAt: now,
    });

    // A scheduled follow-up is the lead's next follow-up: one fact, not two that can disagree.
    if (input.kind === 'followUpScheduled' && input.dueOn) {
      await this.leads
        .updateOne(
          { leadId },
          { $set: { nextFollowUpOn: input.dueOn, updatedAt: now }, $inc: { version: 1 } },
        )
        .exec();
    }

    await this.audit.record({
      action: CRM_AUDIT_ACTIONS.activityRecorded,
      outcome: 'succeeded',
      actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
      target: { type: 'lead', id: leadId },
      changes: buildChangeSummary(
        { nextFollowUpOn: lead.nextFollowUpOn },
        { kind: input.kind, nextFollowUpOn: input.dueOn ?? lead.nextFollowUpOn },
      ),
      context,
    });
    return toActivity(created.toObject());
  }

  /* ------------------------------------------------------------- dashboard */

  async dashboard(actor: ActorContext): Promise<CrmDashboard> {
    const scopeFilter = withScope(buildScopeFilter(actor, LEAD_SCOPE_FIELDS));
    const today = this.today();

    /**
     * Every figure below is computed from the **same** scope filter as the first aggregation stage.
     * A dashboard is exactly where a scope leak hides: the list looks correct and the headline number
     * quietly counts the whole company (SEC-028).
     */
    const [byStage, bySource, byOwner, dueFollowUps, overdueFollowUps, total] = await Promise.all([
      this.leads.aggregate<{ _id: string; count: number }>([
        { $match: scopeFilter },
        { $group: { _id: '$stage', count: { $sum: 1 } } },
      ]),
      this.leads.aggregate<{ _id: string; count: number }>([
        { $match: scopeFilter },
        { $group: { _id: '$source', count: { $sum: 1 } } },
      ]),
      this.leads.aggregate<{ _id: string; total: number; won: number }>([
        { $match: scopeFilter },
        {
          $group: {
            _id: '$assignedToAccountId',
            total: { $sum: 1 },
            won: { $sum: { $cond: [{ $eq: ['$stage', 'won'] }, 1, 0] } },
          },
        },
        { $sort: { won: -1, total: -1 } },
        { $limit: 20 },
      ]),
      this.leads.countDocuments({
        $and: [
          scopeFilter,
          { nextFollowUpOn: { $lte: today }, stage: { $nin: TERMINAL_LEAD_STAGES } },
        ],
      }),
      this.leads.countDocuments({
        $and: [
          scopeFilter,
          { nextFollowUpOn: { $lt: today }, stage: { $nin: TERMINAL_LEAD_STAGES } },
        ],
      }),
      this.leads.countDocuments(scopeFilter),
    ]);

    const stageCounts = Object.fromEntries(byStage.map((r) => [r._id, r.count]));
    const won = stageCounts['won'] ?? 0;
    const lost = stageCounts['lost'] ?? 0;
    const concluded = won + lost;
    // A string, produced by integer arithmetic then formatted — never a float percentage (ADR-0007).
    const conversionRate =
      concluded === 0 ? '0' : (Math.round((won / concluded) * 10_000) / 10_000).toFixed(4);

    return {
      totalLeads: total,
      newLeads: stageCounts['new'] ?? 0,
      dueFollowUps,
      overdueFollowUps,
      wonLeads: won,
      lostLeads: lost,
      conversionRate,
      byStage: stageCounts as CrmDashboard['byStage'],
      bySource: Object.fromEntries(
        bySource.map((r) => [r._id, r.count]),
      ) as CrmDashboard['bySource'],
      byOwner: byOwner.map((r) => ({ accountId: r._id, total: r.total, won: r.won })),
    };
  }
}
