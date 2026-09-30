import {
  ActivitySchema,
  CONTACT_CHANNELS,
  CRM_AUDIT_ACTIONS,
  CustomerSchema,
  LEAD_AGE_BANDS,
  LeadSchema,
  OwnershipChangeSchema,
  TERMINAL_LEAD_STAGES,
  canTransitionLead,
  instantFromDate,
  normalizeEmail,
  normalizeIdentityNumber,
  normalizePhone,
  type Activity,
  type ActorContext,
  type AssignLead,
  type BusinessDate,
  type ChangeLeadStage,
  type ConsentState,
  type ContactChannel,
  type CreateActivity,
  type CreateCustomer,
  type CreateLead,
  type CreateLeadResult,
  type CrmDashboard,
  type Customer,
  type CustomerPage,
  type CustomerQuery,
  type DuplicateCheck,
  type DuplicateReport,
  type Lead,
  type LeadPage,
  type LeadQuery,
  type LeadStage,
  type Money,
  type OwnershipChange,
  type Permission,
  type QualifyLead,
  type RecordConsent,
  type TransferOwnership,
  type UpdateCustomer,
} from '@alola/contracts';
import {
  assertSafeFilter,
  assertWritableFields,
  buildChangeSummary,
  buildScopeFilter,
  can,
  restrictDocument,
  restrictDocuments,
  withScope,
  type ScopeFieldMap,
} from '@alola/security';
import type { ClientSession, Connection } from 'mongoose';
import {
  auditActor,
  conflict,
  invalid,
  isDuplicateKeyError,
  type AuditRecorder,
  type RequestContext,
} from '../../platform/audit-port';
import { newId } from '../../platform/ids';
import { fromDecimal128, toDecimal128 } from '../../platform/money-storage';
import { withTransaction } from '../../platform/transactions';
import {
  activityModel,
  consentModel,
  customerModel,
  leadModel,
  ownershipChangeModel,
  type ActivityDocument,
  type ConsentDocument,
  type CustomerDocument,
  type LeadDocument,
  type OwnershipChangeDocument,
  type StoredIdentity,
  type StoredMoney,
} from './model';

export type { AuditRecorder, RequestContext } from '../../platform/audit-port';

/**
 * CRM service (`CRM-*`).
 *
 * Decisions worth stating, because each one is the opposite of the obvious implementation:
 *
 * 1. **A duplicate phone number on a lead is a warning, not a refusal.** Households, switchboards and
 *    brokers genuinely share numbers. A **customer**, by contrast, is one identity per phone inside a
 *    legal entity, because two records would split one buyer's contracts (`BD-26`).
 * 2. **A duplicate check never reads outside the actor's scope.** Matches outside it are counted, never
 *    described — otherwise "is this a duplicate?" becomes "tell me about another branch's customer".
 * 3. **The pipeline may go backwards.** Only `won` and `lost` are strict, and `lost` demands a reason.
 * 4. **Ownership is stored, never claimed.** An owner comes from the actor unless they hold the
 *    permission to hand work out, and even then only to an active colleague inside their own scope who
 *    can see the work (CRM-ASSIGN-001).
 */

export type BranchResolver = (branchId: string) => Promise<{ legalEntityId: string } | undefined>;

/** What CRM needs to know about a colleague before handing them work. Wired to SEC and CORE-ORG. */
export type AccountDescriber = (accountId: string) => Promise<
  | {
      active: boolean;
      permissions: readonly Permission[];
      placement?: {
        legalEntityId: string;
        branchId: string;
        departmentId?: string;
        teamId?: string;
      };
    }
  | undefined
>;

/** Whether a reference code is an active item of a list (PLAT-025). */
export type ReasonCodeCheck = (list: 'lossReasons', code: string) => Promise<boolean>;

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

/**
 * Customers carry their owner's team and department since BMP-1, so a team leader sees the team's
 * customers. A customer written before then has neither, and is visible by owner, branch and entity.
 */
export const CUSTOMER_SCOPE_FIELDS: ScopeFieldMap = {
  owner: 'ownerAccountId',
  assignee: 'ownerAccountId',
  team: 'teamId',
  department: 'departmentId',
  branch: 'branchId',
  legalEntity: 'legalEntityId',
};

const iso = (date: Date) => date.toISOString();
const DAY_MS = 86_400_000;

function toMoney(stored: StoredMoney | undefined): Money | undefined {
  return stored ? { amount: fromDecimal128(stored.amount), currency: stored.currency } : undefined;
}

function fromMoney(value: Money | undefined): StoredMoney | undefined {
  return value ? { amount: toDecimal128(value.amount), currency: value.currency } : undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toIdentity(d: CustomerDocument): Customer['identity'] {
  if (d.identity) {
    return {
      type: d.identity.type,
      number: d.identity.number,
      ...(d.identity.issuingCountry ? { issuingCountry: d.identity.issuingCountry } : {}),
    };
  }
  // A record from the demonstration slice: its national ID becomes its identity, read-only.
  return d.nationalId ? { type: 'nationalId', number: d.nationalId } : undefined;
}

function storedIdentity(identity: NonNullable<CreateCustomer['identity']>): StoredIdentity {
  return {
    type: identity.type,
    number: identity.number,
    numberNormalized: normalizeIdentityNumber(identity.number),
    ...(identity.issuingCountry ? { issuingCountry: identity.issuingCountry } : {}),
  };
}

function toCustomer(d: CustomerDocument, consents: ConsentState[]): Customer {
  const identity = toIdentity(d);
  return CustomerSchema.parse({
    customerId: d.customerId,
    kind: d.kind ?? 'individual',
    name: d.name,
    ...(d.alternateName ? { alternateName: d.alternateName } : {}),
    primaryPhone: d.primaryPhone,
    ...(d.secondaryPhone ? { secondaryPhone: d.secondaryPhone } : {}),
    ...(d.email ? { email: d.email } : {}),
    ...(identity ? { identity } : {}),
    ...(d.address ? { address: d.address } : {}),
    ...(d.city ? { city: d.city } : {}),
    ...(d.preferredLanguage ? { preferredLanguage: d.preferredLanguage } : {}),
    ...(d.preferredChannel ? { preferredChannel: d.preferredChannel } : {}),
    consents,
    legalEntityId: d.legalEntityId,
    branchId: d.branchId,
    ...(d.departmentId ? { departmentId: d.departmentId } : {}),
    ...(d.teamId ? { teamId: d.teamId } : {}),
    ownerAccountId: d.ownerAccountId,
    version: d.version ?? 1,
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
    ...(d.currentSource ? { currentSource: d.currentSource } : {}),
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
    ...(d.lostReasonCode ? { lostReasonCode: d.lostReasonCode } : {}),
    nurture: d.nurture ?? false,
    ...(d.qualification
      ? {
          qualification: {
            budgetConfirmed: d.qualification.budgetConfirmed,
            timeframe: d.qualification.timeframe,
            purpose: d.qualification.purpose,
            decisionRole: d.qualification.decisionRole,
            ...(d.qualification.notes ? { notes: d.qualification.notes } : {}),
            qualifiedAt: iso(d.qualification.qualifiedAt),
            qualifiedBy: d.qualification.qualifiedBy,
          },
        }
      : {}),
    ...(d.customerId ? { customerId: d.customerId } : {}),
    ...(d.convertedAt ? { convertedAt: iso(d.convertedAt) } : {}),
    ...(d.lastActivityAt ? { lastActivityAt: iso(d.lastActivityAt) } : {}),
    version: d.version,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

function toActivity(d: ActivityDocument): Activity {
  return ActivitySchema.parse({
    activityId: d.activityId,
    ...(d.leadId ? { leadId: d.leadId } : {}),
    ...(d.customerId ? { customerId: d.customerId } : {}),
    ...(d.opportunityId ? { opportunityId: d.opportunityId } : {}),
    kind: d.kind,
    ...(d.body ? { body: d.body } : {}),
    ...(d.fromStage ? { fromStage: d.fromStage } : {}),
    ...(d.toStage ? { toStage: d.toStage } : {}),
    ...(d.dueOn ? { dueOn: d.dueOn } : {}),
    ...(d.actorAccountId ? { actorAccountId: d.actorAccountId } : {}),
    occurredAt: iso(d.occurredAt),
  });
}

function toOwnershipChange(d: OwnershipChangeDocument): OwnershipChange {
  return OwnershipChangeSchema.parse({
    changeId: d.changeId,
    subjectType: d.subjectType,
    subjectId: d.subjectId,
    ...(d.fromAccountId ? { fromAccountId: d.fromAccountId } : {}),
    toAccountId: d.toAccountId,
    reason: d.reason,
    actorAccountId: d.actorAccountId,
    occurredAt: iso(d.occurredAt),
  });
}

function encodeCursor(first: string, id: string): string {
  return Buffer.from(`${first}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { first: string; id: string } | undefined {
  try {
    const [first, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    return first && id ? { first, id } : undefined;
  } catch {
    return undefined;
  }
}

/** The filter that matches a stored version, treating a record with no version as version 1. */
function versionFilter(expected: number): Record<string, unknown> {
  return expected === 1
    ? { $or: [{ version: 1 }, { version: { $exists: false } }] }
    : { version: expected };
}

/**
 * Whether a colleague's organization placement lies inside the actor's data scope. Project scope has
 * no placement to compare with and fails closed; `self` and `assigned` cover only the actor.
 */
export function placementInScope(
  actor: ActorContext,
  accountId: string,
  placement: { legalEntityId: string; branchId: string; departmentId?: string; teamId?: string },
): boolean {
  if (accountId === actor.accountId) return true;
  const scope = actor.scope;
  switch (scope.level) {
    case 'all':
      return true;
    case 'legalEntity':
      return scope.legalEntityIds.includes(placement.legalEntityId);
    case 'branch':
      return scope.branchIds.includes(placement.branchId);
    case 'department':
      return !!placement.departmentId && scope.departmentIds.includes(placement.departmentId);
    case 'team':
      return !!placement.teamId && scope.teamIds.includes(placement.teamId);
    case 'project':
    case 'assigned':
    case 'self':
      return false;
  }
}

export interface CrmServiceOptions {
  connection: Connection;
  audit: AuditRecorder;
  resolveBranch: BranchResolver;
  /** Injected so a test can fix "today" without moving the process clock. */
  today: () => BusinessDate;
  /** Absent means nobody can be named as another's owner: the actor always owns what they create. */
  describeAccount?: AccountDescriber;
  /** Absent means no reason code can be verified, so none is accepted. */
  isActiveReason?: ReasonCodeCheck;
  /** Injected for tests; the wall clock otherwise. Used for ageing only. */
  now?: () => Date;
}

export class CrmService {
  private readonly connection;
  private readonly customers;
  private readonly leads;
  private readonly activities;
  private readonly consents;
  private readonly ownershipChanges;
  private readonly audit;
  private readonly resolveBranch;
  private readonly today: () => BusinessDate;
  private readonly now: () => Date;

  constructor(private readonly options: CrmServiceOptions) {
    this.connection = options.connection;
    this.customers = customerModel(options.connection);
    this.leads = leadModel(options.connection);
    this.activities = activityModel(options.connection);
    this.consents = consentModel(options.connection);
    this.ownershipChanges = ownershipChangeModel(options.connection);
    this.audit = options.audit;
    this.resolveBranch = options.resolveBranch;
    this.today = options.today;
    this.now = options.now ?? (() => new Date());
  }

  /* ------------------------------------------------------------ eligibility */

  /**
   * Refuse to hand work to someone who could not do it (CRM-ASSIGN-001): an unknown or inactive
   * account, one without the read permission for the work, one with no placement, one outside the
   * actor's own scope, or one placed in another branch than the record — whose branch is fixed.
   */
  async assertEligibleOwner(
    actor: ActorContext,
    accountId: string,
    permission: Permission,
    branchId: string,
    subject: { type: string; id?: string },
    context: RequestContext,
  ): Promise<{ departmentId?: string; teamId?: string }> {
    const refuse = async (issue: string): Promise<never> => {
      await this.audit.record({
        action: CRM_AUDIT_ACTIONS.ownerAssignmentRefused,
        outcome: 'denied',
        actor: auditActor(actor),
        target: subject,
        reason: `owner refused: ${issue}`,
        context,
      });
      throw conflict(issue, ['assignedToAccountId']);
    };
    const described = this.options.describeAccount
      ? await this.options.describeAccount(accountId)
      : undefined;
    if (!described) return refuse('ASSIGNEE_UNKNOWN');
    if (!described.active) return refuse('ASSIGNEE_INACTIVE');
    if (!described.permissions.includes(permission)) return refuse('ASSIGNEE_CANNOT_SEE_RECORD');
    if (!described.placement) return refuse('ASSIGNEE_NOT_PLACED');
    if (!placementInScope(actor, accountId, described.placement)) {
      return refuse('ASSIGNEE_OUTSIDE_SCOPE');
    }
    if (described.placement.branchId !== branchId) return refuse('ASSIGNEE_OUTSIDE_BRANCH');
    return {
      ...(described.placement.departmentId
        ? { departmentId: described.placement.departmentId }
        : {}),
      ...(described.placement.teamId ? { teamId: described.placement.teamId } : {}),
    };
  }

  /**
   * The update that moves a record to a new owner's placement: team and department follow the owner,
   * and one the new owner does not have is removed rather than left pointing at the old team.
   */
  static placementUpdate(placement: { departmentId?: string; teamId?: string }): {
    set: Record<string, string>;
    unset: Record<string, ''>;
  } {
    const set: Record<string, string> = {};
    const unset: Record<string, ''> = {};
    if (placement.teamId) set['teamId'] = placement.teamId;
    else unset['teamId'] = '';
    if (placement.departmentId) set['departmentId'] = placement.departmentId;
    else unset['departmentId'] = '';
    return { set, unset };
  }

  /** Whether a customer is inside the actor's scope — asked before a conversion links to one. */
  private async customerVisible(actor: ActorContext, customerId: string): Promise<boolean> {
    const count = await this.customers
      .countDocuments(withScope(buildScopeFilter(actor, CUSTOMER_SCOPE_FIELDS), { customerId }))
      .exec();
    return count > 0;
  }

  /** The actor's own team and department, when their placement is in the record's branch. */
  async ownPlacement(
    actor: ActorContext,
    branchId: string,
  ): Promise<{ departmentId?: string; teamId?: string }> {
    const described = this.options.describeAccount
      ? await this.options.describeAccount(actor.accountId)
      : undefined;
    const placement = described?.placement;
    if (!placement || placement.branchId !== branchId) return {};
    return {
      ...(placement.departmentId ? { departmentId: placement.departmentId } : {}),
      ...(placement.teamId ? { teamId: placement.teamId } : {}),
    };
  }

  /* ------------------------------------------------------------- customers */

  /** The consent in force per channel for each customer: the latest entry of each history. */
  private async consentStates(customerIds: string[]): Promise<Map<string, ConsentState[]>> {
    const result = new Map<string, ConsentState[]>();
    if (customerIds.length === 0) return result;
    const rows = await this.consents
      .find({ customerId: { $in: customerIds } })
      .sort({ recordedAt: -1, consentId: -1 })
      .lean<ConsentDocument[]>()
      .exec();
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.customerId}|${row.channel}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const list = result.get(row.customerId) ?? [];
      list.push({
        channel: row.channel,
        granted: row.granted,
        source: row.source,
        recordedAt: instantFromDate(row.recordedAt),
        recordedBy: row.recordedBy,
      });
      result.set(row.customerId, list);
    }
    for (const list of result.values()) {
      list.sort(
        (a, b) => CONTACT_CHANNELS.indexOf(a.channel) - CONTACT_CHANNELS.indexOf(b.channel),
      );
    }
    return result;
  }

  private async present(actor: ActorContext, document: CustomerDocument): Promise<Customer> {
    const consents = await this.consentStates([document.customerId]);
    return restrictDocument(
      'customer',
      actor,
      toCustomer(document, consents.get(document.customerId) ?? []),
    ) as Customer;
  }

  async listCustomers(actor: ActorContext, query: CustomerQuery): Promise<CustomerPage> {
    const requested: Record<string, unknown> = {};
    for (const key of ['branchId', 'ownerAccountId'] as const) {
      const value = query[key];
      if (value !== undefined) requested[key] = value;
    }
    assertSafeFilter(requested);
    // A record from before BMP-1 has no kind and is an individual. Operators are added after the
    // safety check, from validated enumeration values only.
    if (query.kind === 'company') requested['kind'] = 'company';
    if (query.kind === 'individual') requested['kind'] = { $ne: 'company' };
    // Identifiers the contract validated one by one; the operator is added here, never taken as input.
    if (query.ids) requested['customerId'] = { $in: [...new Set(query.ids.split(','))] };
    const clauses: Record<string, unknown>[] = [
      withScope(buildScopeFilter(actor, CUSTOMER_SCOPE_FIELDS), requested),
    ];
    if (query.search) {
      const digits = normalizePhone(query.search);
      clauses.push({
        $or: [
          { name: { $regex: `^${escapeRegex(query.search)}`, $options: 'i' } },
          ...(digits.length >= 3
            ? [{ primaryPhoneDigits: { $regex: `^${escapeRegex(digits)}` } }]
            : []),
        ],
      });
    }
    const filter = clauses.length === 1 ? clauses[0]! : { $and: clauses };
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const paged = cursor
      ? {
          $and: [
            filter,
            {
              $or: [
                { name: { $gt: cursor.first } },
                { name: cursor.first, customerId: { $gt: cursor.id } },
              ],
            },
          ],
        }
      : filter;
    const [documents, total] = await Promise.all([
      this.customers
        .find(paged)
        .sort({ name: 1, customerId: 1 })
        .limit(query.limit + 1)
        .lean<CustomerDocument[]>()
        .exec(),
      this.customers.countDocuments(filter).exec(),
    ]);
    const page = documents.slice(0, query.limit);
    const last = page[page.length - 1];
    const consents = await this.consentStates(page.map((row) => row.customerId));
    const items = restrictDocuments(
      'customer',
      actor,
      page.map((row) => toCustomer(row, consents.get(row.customerId) ?? [])),
    ) as Customer[];
    return {
      items,
      total,
      limit: query.limit,
      ...(documents.length > query.limit && last
        ? { nextCursor: encodeCursor(last.name, last.customerId) }
        : {}),
    };
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

  private async scopedCustomer(actor: ActorContext, customerId: string): Promise<CustomerDocument> {
    assertSafeFilter({ customerId });
    const filter = withScope(buildScopeFilter(actor, CUSTOMER_SCOPE_FIELDS), { customerId });
    const document = await this.customers.findOne(filter).lean<CustomerDocument>().exec();
    if (!document) throw new CrmNotFoundError('customer');
    return document;
  }

  async getCustomer(actor: ActorContext, customerId: string): Promise<Customer> {
    return this.present(actor, await this.scopedCustomer(actor, customerId));
  }

  async createCustomer(
    actor: ActorContext,
    input: CreateCustomer,
    context: RequestContext,
    session?: ClientSession,
  ): Promise<Customer> {
    assertSafeFilter({ branchId: input.branchId });
    // Writing a field one may not read is refused, not silently accepted (SEC-029).
    if (input.identity) assertWritableFields('customer', actor, { identity: input.identity });
    const branch = await this.resolveBranch(input.branchId);
    if (!branch) throw new CrmNotFoundError('branch');

    const ownerAccountId =
      input.ownerAccountId && can(actor, 'crm.customer.transfer')
        ? input.ownerAccountId
        : actor.accountId;
    const placement =
      ownerAccountId === actor.accountId
        ? await this.ownPlacement(actor, input.branchId)
        : await this.assertEligibleOwner(
            actor,
            ownerAccountId,
            'crm.customer.view',
            input.branchId,
            { type: 'customer' },
            context,
          );

    const digits = normalizePhone(input.primaryPhone);
    const existing = await this.customers
      .findOne({ legalEntityId: branch.legalEntityId, primaryPhoneDigits: digits })
      .session(session ?? null)
      .lean<CustomerDocument>()
      .exec();
    // One identity per phone inside a legal entity: a second record would split one buyer's contracts.
    if (existing) throw conflict('DUPLICATE_CUSTOMER_PHONE', ['primaryPhone']);

    const now = new Date();
    const document: CustomerDocument = {
      customerId: newId('cus'),
      kind: input.kind ?? 'individual',
      name: input.name,
      ...(input.alternateName ? { alternateName: input.alternateName } : {}),
      primaryPhone: input.primaryPhone,
      primaryPhoneDigits: digits,
      ...(input.secondaryPhone ? { secondaryPhone: input.secondaryPhone } : {}),
      ...(input.email ? { email: input.email, emailNormalized: normalizeEmail(input.email) } : {}),
      ...(input.identity ? { identity: storedIdentity(input.identity) } : {}),
      ...(input.address ? { address: input.address } : {}),
      ...(input.city ? { city: input.city } : {}),
      ...(input.preferredLanguage ? { preferredLanguage: input.preferredLanguage } : {}),
      ...(input.preferredChannel ? { preferredChannel: input.preferredChannel } : {}),
      legalEntityId: branch.legalEntityId,
      branchId: input.branchId,
      ...placement,
      ownerAccountId,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const write = async (tx: ClientSession): Promise<CustomerDocument> => {
      const [stored] = await this.customers.create([document], { session: tx });
      if (!stored) throw new CrmConflictError('customerNotCreated');
      await this.audit.record(
        {
          action: CRM_AUDIT_ACTIONS.customerCreated,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'customer', id: document.customerId },
          // Contact and identity values stay out of the audit body; the owner and placement go in.
          changes: buildChangeSummary(undefined, {
            kind: document.kind,
            branchId: document.branchId,
            ownerAccountId: document.ownerAccountId,
            ...(document.identity ? { identityNumber: 'set' } : {}),
          }),
          context,
        },
        { session: tx },
      );
      return stored.toObject();
    };

    try {
      const stored = session
        ? await write(session)
        : await withTransaction(this.connection, (tx) => write(tx));
      return this.present(actor, stored);
    } catch (error) {
      // Two clerks entering the same buyer at once: the unique index answers, not a 500.
      if (isDuplicateKeyError(error)) throw conflict('DUPLICATE_CUSTOMER_PHONE', ['primaryPhone']);
      throw error;
    }
  }

  /** CRM-PERSON-005: a correction with a reason and the version it read. */
  async correctCustomer(
    actor: ActorContext,
    customerId: string,
    input: UpdateCustomer,
    context: RequestContext,
  ): Promise<Customer> {
    const before = await this.scopedCustomer(actor, customerId);
    if (input.identity) assertWritableFields('customer', actor, { identity: input.identity });
    if ((before.version ?? 1) !== input.expectedVersion) throw conflict('STALE_VERSION');

    const set: Record<string, unknown> = { updatedAt: new Date() };
    const unset: Record<string, ''> = {};
    const changedBefore: Record<string, unknown> = {};
    const changedAfter: Record<string, unknown> = {};
    const track = (key: string, from: unknown, to: unknown) => {
      changedBefore[key] = from;
      changedAfter[key] = to;
    };

    for (const key of [
      'kind',
      'name',
      'alternateName',
      'secondaryPhone',
      'address',
      'city',
      'preferredLanguage',
      'preferredChannel',
    ] as const) {
      const value = input[key];
      if (value !== undefined && value !== before[key]) {
        set[key] = value;
        track(key, before[key], value);
      }
    }
    if (input.primaryPhone !== undefined && input.primaryPhone !== before.primaryPhone) {
      const digits = normalizePhone(input.primaryPhone);
      if (digits !== before.primaryPhoneDigits) {
        const clash = await this.customers
          .findOne({
            legalEntityId: before.legalEntityId,
            primaryPhoneDigits: digits,
            customerId: { $ne: customerId },
          })
          .lean()
          .exec();
        if (clash) throw conflict('DUPLICATE_CUSTOMER_PHONE', ['primaryPhone']);
      }
      set['primaryPhone'] = input.primaryPhone;
      set['primaryPhoneDigits'] = digits;
      // A phone number is contact data: the change is recorded, the numbers are not.
      track('primaryPhone', 'previous', 'changed');
    }
    if (input.email !== undefined && input.email !== before.email) {
      set['email'] = input.email;
      set['emailNormalized'] = normalizeEmail(input.email);
      track('email', 'previous', 'changed');
    }
    if (input.identity !== undefined) {
      set['identity'] = storedIdentity(input.identity);
      // A legacy national ID is superseded by the corrected identity, never kept beside it.
      if (before.nationalId) unset['nationalId'] = '';
      track('identityNumber', 'previous', 'changed');
      track('identityType', toIdentity(before)?.type, input.identity.type);
    }
    if (Object.keys(changedAfter).length === 0) throw invalid('NOTHING_TO_CHANGE');

    const expected = input.expectedVersion;
    const updated = await withTransaction(this.connection, async (session) => {
      const result = await this.customers
        .findOneAndUpdate(
          { customerId, ...versionFilter(expected) },
          {
            $set: { ...set, version: expected + 1 },
            ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
          },
          { returnDocument: 'after', runValidators: true, session },
        )
        .lean<CustomerDocument>()
        .exec();
      // The version is in the filter, so a concurrent correction loses instead of overwriting.
      if (!result) throw conflict('STALE_VERSION');
      await this.activities.create(
        [
          {
            activityId: newId('act'),
            customerId,
            kind: 'customerCorrected',
            body: input.reason,
            actorAccountId: actor.accountId,
            occurredAt: new Date(),
          },
        ],
        { session },
      );
      await this.audit.record(
        {
          action: CRM_AUDIT_ACTIONS.customerCorrected,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'customer', id: customerId },
          changes: buildChangeSummary(changedBefore, changedAfter),
          reason: input.reason,
          context,
        },
        { session },
      );
      return result;
    });
    return this.present(actor, updated);
  }

  /** CRM-PERSON-003: a consent statement, appended; the latest per channel is in force. */
  async recordConsent(
    actor: ActorContext,
    customerId: string,
    input: RecordConsent,
    context: RequestContext,
  ): Promise<Customer> {
    const customer = await this.scopedCustomer(actor, customerId);
    await withTransaction(this.connection, async (session) => {
      const now = new Date();
      await this.consents.create(
        [
          {
            consentId: newId('cns'),
            customerId,
            channel: input.channel,
            granted: input.granted,
            source: input.source,
            ...(input.note ? { note: input.note } : {}),
            recordedBy: actor.accountId,
            recordedAt: now,
          },
        ],
        { session },
      );
      await this.activities.create(
        [
          {
            activityId: newId('act'),
            customerId,
            kind: 'consentRecorded',
            body: `${input.channel}:${input.granted ? 'granted' : 'withdrawn'}`,
            actorAccountId: actor.accountId,
            occurredAt: now,
          },
        ],
        { session },
      );
      await this.audit.record(
        {
          action: CRM_AUDIT_ACTIONS.consentRecorded,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'customer', id: customerId },
          changes: buildChangeSummary(undefined, {
            channel: input.channel,
            granted: String(input.granted),
            source: input.source,
          }),
          context,
        },
        { session },
      );
    });
    return this.present(actor, customer);
  }

  /** Whether a customer's consent for a channel is in force — for `CORE-NOTIFY`, which asks before sending. */
  async hasConsent(customerId: string, channel: ContactChannel): Promise<boolean> {
    assertSafeFilter({ customerId });
    const latest = await this.consents
      .findOne({ customerId, channel })
      .sort({ recordedAt: -1, consentId: -1 })
      .lean<ConsentDocument>()
      .exec();
    return latest?.granted === true;
  }

  /** CRM-OWNER-001: hand a customer to a colleague, keeping the history. */
  async transferCustomer(
    actor: ActorContext,
    customerId: string,
    input: TransferOwnership,
    context: RequestContext,
  ): Promise<Customer> {
    const before = await this.scopedCustomer(actor, customerId);
    if (input.toAccountId === before.ownerAccountId)
      throw invalid('ALREADY_OWNER', ['toAccountId']);
    const placement = await this.assertEligibleOwner(
      actor,
      input.toAccountId,
      'crm.customer.view',
      before.branchId,
      { type: 'customer', id: customerId },
      context,
    );
    const expected = before.version ?? 1;
    const moved = CrmService.placementUpdate(placement);
    const updated = await withTransaction(this.connection, async (session) => {
      const now = new Date();
      const result = await this.customers
        .findOneAndUpdate(
          { customerId, ownerAccountId: before.ownerAccountId, ...versionFilter(expected) },
          {
            $set: {
              ownerAccountId: input.toAccountId,
              ...moved.set,
              version: expected + 1,
              updatedAt: now,
            },
            // A new owner outside the old team takes the customer out of that team's view.
            $unset: moved.unset,
          },
          { returnDocument: 'after', runValidators: true, session },
        )
        .lean<CustomerDocument>()
        .exec();
      if (!result) throw conflict('STALE_VERSION');
      await this.recordOwnershipChange(
        actor,
        {
          subjectType: 'customer',
          subjectId: customerId,
          fromAccountId: before.ownerAccountId,
          toAccountId: input.toAccountId,
          reason: input.reason,
        },
        session,
      );
      await this.activities.create(
        [
          {
            activityId: newId('act'),
            customerId,
            kind: 'ownerChanged',
            body: input.reason,
            actorAccountId: actor.accountId,
            occurredAt: now,
          },
        ],
        { session },
      );
      await this.audit.record(
        {
          action: CRM_AUDIT_ACTIONS.customerOwnerTransferred,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'customer', id: customerId },
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
    return this.present(actor, updated);
  }

  /** Append one ownership change. Shared by customers, leads and (package 3) opportunities. */
  async recordOwnershipChange(
    actor: ActorContext,
    change: {
      subjectType: OwnershipChange['subjectType'];
      subjectId: string;
      fromAccountId?: string;
      toAccountId: string;
      reason: string;
    },
    session: ClientSession,
  ): Promise<void> {
    await this.ownershipChanges.create(
      [
        {
          changeId: newId('own'),
          subjectType: change.subjectType,
          subjectId: change.subjectId,
          ...(change.fromAccountId ? { fromAccountId: change.fromAccountId } : {}),
          toAccountId: change.toAccountId,
          reason: change.reason,
          actorAccountId: actor.accountId,
          occurredAt: new Date(),
        },
      ],
      { session },
    );
  }

  async customerOwnershipHistory(
    actor: ActorContext,
    customerId: string,
  ): Promise<OwnershipChange[]> {
    await this.scopedCustomer(actor, customerId);
    return this.ownershipHistory('customer', customerId);
  }

  async leadOwnershipHistory(actor: ActorContext, leadId: string): Promise<OwnershipChange[]> {
    await this.getLead(actor, leadId);
    return this.ownershipHistory('lead', leadId);
  }

  /** The history of one subject. The caller has already proved the subject is visible. */
  async ownershipHistory(
    subjectType: OwnershipChange['subjectType'],
    subjectId: string,
  ): Promise<OwnershipChange[]> {
    assertSafeFilter({ subjectId });
    const rows = await this.ownershipChanges
      .find({ subjectType, subjectId })
      .sort({ occurredAt: -1, changeId: -1 })
      .limit(200)
      .lean<OwnershipChangeDocument[]>()
      .exec();
    return rows.map(toOwnershipChange);
  }

  /* ----------------------------------------------------------- duplicates */

  /**
   * Customers in one legal entity matching any of the keys, split into the ones the actor may see and
   * a count of the rest (CRM-PERSON-006). The unscoped query only ever reads identifiers and names,
   * and only the in-scope subset leaves this method described.
   */
  private async matchCustomers(
    actor: ActorContext,
    legalEntityId: string,
    keys: { phoneDigits?: string; email?: string; identity?: string },
    excludeCustomerId?: string,
  ): Promise<DuplicateReport> {
    const or: Record<string, unknown>[] = [];
    if (keys.phoneDigits) or.push({ primaryPhoneDigits: keys.phoneDigits });
    if (keys.email) or.push({ emailNormalized: keys.email });
    if (keys.identity) or.push({ 'identity.numberNormalized': keys.identity });
    if (or.length === 0) return { candidates: [], outOfScopeMatches: 0 };
    const base: Record<string, unknown> = { legalEntityId, $or: or };
    if (excludeCustomerId) base['customerId'] = { $ne: excludeCustomerId };
    const all = await this.customers
      .find(base, {
        customerId: 1,
        name: 1,
        primaryPhoneDigits: 1,
        emailNormalized: 1,
        identity: 1,
      })
      .limit(50)
      .lean<CustomerDocument[]>()
      .exec();
    if (all.length === 0) return { candidates: [], outOfScopeMatches: 0 };
    const visibleIds = new Set(
      (
        await this.customers
          .find(
            withScope(buildScopeFilter(actor, CUSTOMER_SCOPE_FIELDS), {
              customerId: { $in: all.map((row) => row.customerId) },
            }),
            { customerId: 1 },
          )
          .lean<CustomerDocument[]>()
          .exec()
      ).map((row) => row.customerId),
    );
    const candidates: DuplicateReport['candidates'] = [];
    for (const row of all) {
      if (!visibleIds.has(row.customerId)) continue;
      const matchedOn: ('phone' | 'email' | 'identity')[] = [];
      if (keys.phoneDigits && row.primaryPhoneDigits === keys.phoneDigits) matchedOn.push('phone');
      if (keys.email && row.emailNormalized === keys.email) matchedOn.push('email');
      if (keys.identity && row.identity?.numberNormalized === keys.identity) {
        matchedOn.push('identity');
      }
      candidates.push({ customerId: row.customerId, name: row.name, matchedOn });
    }
    return { candidates, outOfScopeMatches: all.length - candidates.length };
  }

  async customerDuplicates(actor: ActorContext, customerId: string): Promise<DuplicateReport> {
    const customer = await this.scopedCustomer(actor, customerId);
    const identity =
      customer.identity?.numberNormalized ??
      (customer.nationalId ? normalizeIdentityNumber(customer.nationalId) : undefined);
    return this.matchCustomers(
      actor,
      customer.legalEntityId,
      {
        // Its own phone is unique in the entity; the check still reports e-mail and identity matches.
        ...(customer.emailNormalized ? { email: customer.emailNormalized } : {}),
        ...(identity ? { identity } : {}),
      },
      customerId,
    );
  }

  async checkDuplicates(actor: ActorContext, input: DuplicateCheck): Promise<DuplicateReport> {
    assertSafeFilter({ branchId: input.branchId });
    const branch = await this.resolveBranch(input.branchId);
    if (!branch) throw new CrmNotFoundError('branch');
    return this.matchCustomers(actor, branch.legalEntityId, {
      ...(input.primaryPhone ? { phoneDigits: normalizePhone(input.primaryPhone) } : {}),
      ...(input.email ? { email: normalizeEmail(input.email) } : {}),
      ...(input.identityNumber ? { identity: normalizeIdentityNumber(input.identityNumber) } : {}),
    });
  }

  /**
   * One customer, with no actor and no scope, for another module inside its own transaction.
   *
   * The caller has already been authorized for its own operation; what it needs here is a fact about
   * the customer that must come from storage rather than from a request body. Identity is **not**
   * returned: a module that needs it asks through a scoped, field-restricted read.
   */
  async findCustomerUnscoped(
    customerId: string,
    session?: ClientSession,
  ): Promise<Omit<Customer, 'identity'> | undefined> {
    assertSafeFilter({ customerId });
    const document = await this.customers
      .findOne({ customerId })
      .session(session ?? null)
      .lean<CustomerDocument>()
      .exec();
    if (!document) return undefined;
    const { identity: _identity, ...rest } = toCustomer(document, []);
    return rest;
  }

  /**
   * The customer's identity for a document snapshot (SALE-CONTRACT-001), through the actor's scope and
   * field restriction: an actor who may not see the identity gets none.
   */
  async customerForSnapshot(actor: ActorContext, customerId: string): Promise<Customer> {
    return this.getCustomer(actor, customerId);
  }

  /** Find or create the customer behind a lead, inside a caller's transaction. */
  async ensureCustomerForLead(
    actor: ActorContext,
    lead: Lead,
    context: RequestContext,
    session?: ClientSession,
  ): Promise<Customer> {
    return (await this.customerForLead(actor, lead, context, session)).customer;
  }

  private async customerForLead(
    actor: ActorContext,
    lead: Lead,
    context: RequestContext,
    session?: ClientSession,
  ): Promise<{ customer: Customer; created: boolean }> {
    if (lead.customerId) {
      const existing = await this.customers
        .findOne({ customerId: lead.customerId })
        .session(session ?? null)
        .lean<CustomerDocument>()
        .exec();
      if (existing) return { customer: await this.present(actor, existing), created: false };
    }
    const digits = normalizePhone(lead.primaryPhone);
    const byPhone = await this.customers
      .findOne({ legalEntityId: lead.legalEntityId, primaryPhoneDigits: digits })
      .session(session ?? null)
      .lean<CustomerDocument>()
      .exec();
    if (byPhone) return { customer: await this.present(actor, byPhone), created: false };

    const now = new Date();
    const document: CustomerDocument = {
      customerId: newId('cus'),
      kind: 'individual',
      name: lead.name,
      primaryPhone: lead.primaryPhone,
      primaryPhoneDigits: digits,
      ...(lead.secondaryPhone ? { secondaryPhone: lead.secondaryPhone } : {}),
      ...(lead.email ? { email: lead.email, emailNormalized: normalizeEmail(lead.email) } : {}),
      legalEntityId: lead.legalEntityId,
      branchId: lead.branchId,
      // The customer inherits the lead's placement and owner: the same person keeps working it.
      ...(lead.departmentId ? { departmentId: lead.departmentId } : {}),
      ...(lead.teamId ? { teamId: lead.teamId } : {}),
      ownerAccountId: lead.assignedToAccountId,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const [stored] = await this.customers.create([document], session ? { session } : {});
    if (!stored) throw new CrmConflictError('customerNotCreated');
    await this.audit.record(
      {
        action: CRM_AUDIT_ACTIONS.customerCreated,
        outcome: 'succeeded',
        actor: auditActor(actor),
        target: { type: 'customer', id: document.customerId },
        changes: buildChangeSummary(undefined, {
          kind: document.kind,
          branchId: document.branchId,
          ownerAccountId: document.ownerAccountId,
          fromLead: lead.leadId,
        }),
        context,
      },
      session ? { session } : {},
    );
    return { customer: await this.present(actor, stored.toObject()), created: true };
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
      'customerId',
    ] as const) {
      const value = query[key];
      if (value !== undefined) requested[key] = value;
    }
    assertSafeFilter(requested);
    if (query.nurture === true) requested['nurture'] = true;
    if (query.nurture === false) requested['nurture'] = { $ne: true };
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
    const createdAt = cursor ? new Date(cursor.first) : undefined;
    // Newest first, tie-broken by id, so pages neither repeat nor skip as leads arrive.
    const paged =
      cursor && createdAt && !Number.isNaN(createdAt.getTime())
        ? {
            $and: [
              filter,
              {
                $or: [{ createdAt: { $lt: createdAt } }, { createdAt, leadId: { $lt: cursor.id } }],
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
        ? { nextCursor: encodeCursor(last.createdAt.toISOString(), last.leadId) }
        : {}),
    };
  }

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

  /** Leads by name or phone prefix, inside the actor's scope (CORE-SEARCH-001). */
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

  /**
   * CRM-LEAD-001: the lead, its first activity and its audit record commit together.
   * CRM-LEAD-003: phone and e-mail are matched against open leads and against customers of the same
   * legal entity, reported inside the creator's scope and counted outside it.
   */
  async createLead(
    actor: ActorContext,
    input: CreateLead,
    context: RequestContext,
    options: { mayAssign: boolean },
  ): Promise<CreateLeadResult> {
    assertSafeFilter({ branchId: input.branchId });
    const branch = await this.resolveBranch(input.branchId);
    if (!branch) throw new CrmNotFoundError('branch');

    // Ownership is never taken from the body without the permission that allows handing work out,
    // and even then only to someone who may do the work.
    const namesSomeoneElse =
      options.mayAssign &&
      input.assignedToAccountId !== undefined &&
      input.assignedToAccountId !== actor.accountId;
    const assignedToAccountId = namesSomeoneElse
      ? (input.assignedToAccountId as string)
      : actor.accountId;
    const assigneePlacement = namesSomeoneElse
      ? await this.assertEligibleOwner(
          actor,
          assignedToAccountId,
          'crm.lead.view',
          input.branchId,
          { type: 'lead' },
          context,
        )
      : {};

    const digits = normalizePhone(input.primaryPhone);
    const email = input.email ? normalizeEmail(input.email) : undefined;
    const matchKeys: Record<string, unknown>[] = [{ primaryPhoneDigits: digits }];
    if (email) matchKeys.push({ emailNormalized: email });
    const duplicateCandidates = await this.leads
      .find({
        legalEntityId: branch.legalEntityId,
        $or: matchKeys,
        stage: { $nin: TERMINAL_LEAD_STAGES },
      })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean<LeadDocument[]>()
      .exec();
    const visibleLeadIds = new Set(
      duplicateCandidates.length === 0
        ? []
        : (
            await this.leads
              .find(
                withScope(buildScopeFilter(actor, LEAD_SCOPE_FIELDS), {
                  leadId: { $in: duplicateCandidates.map((row) => row.leadId) },
                }),
                { leadId: 1 },
              )
              .lean<LeadDocument[]>()
              .exec()
          ).map((row) => row.leadId),
    );
    const visibleDuplicate = duplicateCandidates.find((row) => visibleLeadIds.has(row.leadId));
    const customerMatches = await this.matchCustomers(actor, branch.legalEntityId, {
      phoneDigits: digits,
      ...(email ? { email } : {}),
    });

    const now = new Date();
    const leadId = newId('lead');
    const document: LeadDocument = {
      leadId,
      name: input.name,
      primaryPhone: input.primaryPhone,
      primaryPhoneDigits: digits,
      ...(input.secondaryPhone ? { secondaryPhone: input.secondaryPhone } : {}),
      ...(input.email ? { email: input.email, emailNormalized: email } : {}),
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
      // Naming an owner places the lead where that owner works.
      ...assigneePlacement,
      ...(input.notes ? { notes: input.notes } : {}),
      ...(input.nextFollowUpOn ? { nextFollowUpOn: input.nextFollowUpOn } : {}),
      stage: 'new',
      nurture: false,
      lastActivityAt: now,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const lead = await withTransaction(this.connection, async (session) => {
      const [created] = await this.leads.create([document], { session });
      if (!created) throw new CrmConflictError('leadNotCreated');
      await this.activities.create(
        [
          {
            activityId: newId('act'),
            leadId,
            kind: 'note',
            ...(input.notes ? { body: input.notes } : {}),
            toStage: 'new',
            actorAccountId: actor.accountId,
            occurredAt: now,
          },
        ],
        { session },
      );
      if (namesSomeoneElse) {
        await this.recordOwnershipChange(
          actor,
          {
            subjectType: 'lead',
            subjectId: leadId,
            toAccountId: assignedToAccountId,
            reason: 'assigned at creation',
          },
          session,
        );
      }
      await this.audit.record(
        {
          action: CRM_AUDIT_ACTIONS.leadCreated,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'lead', id: leadId },
          changes: buildChangeSummary(undefined, {
            source: document.source,
            branchId: document.branchId,
            assignedToAccountId: document.assignedToAccountId,
            stage: document.stage,
          }),
          context,
        },
        { session },
      );
      return toLead(created.toObject());
    });

    const outOfScopeLeads = duplicateCandidates.length - visibleLeadIds.size;
    const existingCustomer = customerMatches.candidates[0];
    return {
      lead,
      ...(visibleDuplicate
        ? {
            possibleDuplicate: {
              leadId: visibleDuplicate.leadId,
              name: visibleDuplicate.name,
              stage: visibleDuplicate.stage,
              assignedToAccountId: visibleDuplicate.assignedToAccountId,
              matchedOn: [
                ...(visibleDuplicate.primaryPhoneDigits === digits ? (['phone'] as const) : []),
                ...(email && visibleDuplicate.emailNormalized === email
                  ? (['email'] as const)
                  : []),
              ],
            },
          }
        : {}),
      ...(existingCustomer
        ? {
            existingCustomer: {
              customerId: existingCustomer.customerId,
              name: existingCustomer.name,
            },
          }
        : {}),
      outOfScopeMatches: outOfScopeLeads + customerMatches.outOfScopeMatches,
    };
  }

  /**
   * The import rows whose phone an open lead already holds in the same legal entity. Only whether a
   * match exists is used — the preview marks the row; it never shows whose lead it is.
   */
  async markExistingLeadPhones<
    T extends { primaryPhone: string; legalEntityId?: string | undefined },
  >(rows: readonly T[]): Promise<T[]> {
    const keyed = rows.filter((row) => row.legalEntityId);
    if (keyed.length === 0) return [];
    const existing = await this.leads
      .find(
        {
          stage: { $nin: TERMINAL_LEAD_STAGES },
          $or: keyed.map((row) => ({
            legalEntityId: row.legalEntityId,
            primaryPhoneDigits: normalizePhone(row.primaryPhone),
          })),
        },
        { legalEntityId: 1, primaryPhoneDigits: 1 },
      )
      .lean<LeadDocument[]>()
      .exec();
    const held = new Set(existing.map((row) => `${row.legalEntityId}|${row.primaryPhoneDigits}`));
    return keyed.filter((row) =>
      held.has(`${row.legalEntityId}|${normalizePhone(row.primaryPhone)}`),
    );
  }

  /**
   * Write imported leads inside the import's transaction (CRM-LEAD-006). The importer owns every lead;
   * a branch outside a branch- or entity-scoped importer's scope refuses the whole file.
   */
  async importLeads(
    actor: ActorContext,
    rows: readonly {
      name: string;
      primaryPhone: string;
      secondaryPhone?: string;
      email?: string;
      source: Lead['source'];
      branchId?: string;
      legalEntityId?: string;
      notes?: string;
    }[],
    session: ClientSession,
    context: RequestContext,
  ): Promise<void> {
    const scope = actor.scope;
    for (const row of rows) {
      if (!row.branchId || !row.legalEntityId) throw invalid('UNKNOWN_BRANCH', ['branch_code']);
      const outside =
        (scope.level === 'branch' && !scope.branchIds.includes(row.branchId)) ||
        (scope.level === 'legalEntity' && !scope.legalEntityIds.includes(row.legalEntityId)) ||
        scope.level === 'project';
      if (outside) throw conflict('BRANCH_OUTSIDE_SCOPE', ['branch_code']);
    }
    const placements = new Map<string, { departmentId?: string; teamId?: string }>();
    const now = new Date();
    for (const row of rows) {
      const branchId = row.branchId as string;
      if (!placements.has(branchId))
        placements.set(branchId, await this.ownPlacement(actor, branchId));
      const leadId = newId('lead');
      const email = row.email ? normalizeEmail(row.email) : undefined;
      await this.leads.create(
        [
          {
            leadId,
            name: row.name,
            primaryPhone: row.primaryPhone,
            primaryPhoneDigits: normalizePhone(row.primaryPhone),
            ...(row.secondaryPhone ? { secondaryPhone: row.secondaryPhone } : {}),
            ...(row.email ? { email: row.email, emailNormalized: email } : {}),
            source: row.source,
            assignedToAccountId: actor.accountId,
            legalEntityId: row.legalEntityId,
            branchId,
            ...placements.get(branchId),
            ...(row.notes ? { notes: row.notes } : {}),
            stage: 'new',
            nurture: false,
            lastActivityAt: now,
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        ],
        { session },
      );
      await this.activities.create(
        [
          {
            activityId: newId('act'),
            leadId,
            kind: 'note',
            ...(row.notes ? { body: row.notes } : {}),
            toStage: 'new',
            actorAccountId: actor.accountId,
            occurredAt: now,
          },
        ],
        { session },
      );
      await this.audit.record(
        {
          action: CRM_AUDIT_ACTIONS.leadCreated,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'lead', id: leadId },
          changes: buildChangeSummary(undefined, {
            source: row.source,
            branchId,
            assignedToAccountId: actor.accountId,
            stage: 'new',
            imported: 'true',
          }),
          context,
        },
        { session },
      );
    }
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
    const now = new Date();
    const set: Record<string, unknown> = { updatedAt: now };
    for (const key of [
      'name',
      'secondaryPhone',
      'interestedProjectId',
      'preferredPropertyType',
      'preferredUsageType',
      'notes',
      'nextFollowUpOn',
      'nurture',
    ] as const) {
      if (input[key] !== undefined) set[key] = input[key];
    }
    if (typeof input['email'] === 'string') {
      set['email'] = input['email'];
      set['emailNormalized'] = normalizeEmail(input['email']);
    }
    const sourceChange =
      input['currentSource'] !== undefined &&
      input['currentSource'] !== (before.currentSource ?? before.source)
        ? (input['currentSource'] as string)
        : undefined;
    if (sourceChange) set['currentSource'] = sourceChange;
    if (input['budgetMin'] !== undefined) set['budgetMin'] = fromMoney(input['budgetMin'] as Money);
    if (input['budgetMax'] !== undefined) set['budgetMax'] = fromMoney(input['budgetMax'] as Money);

    const updated = await withTransaction(this.connection, async (session) => {
      const result = await this.leads
        .findOneAndUpdate(
          { leadId, version: before.version },
          { $set: set, $inc: { version: 1 } },
          { returnDocument: 'after', runValidators: true, session },
        )
        .lean<LeadDocument>()
        .exec();
      // The version in the filter makes a concurrent edit lose rather than silently overwrite.
      if (!result) throw new CrmConflictError('staleVersion');
      if (sourceChange) {
        await this.activities.create(
          [
            {
              activityId: newId('act'),
              leadId,
              kind: 'sourceChanged',
              fromStage: before.currentSource ?? before.source,
              toStage: sourceChange,
              actorAccountId: actor.accountId,
              occurredAt: now,
            },
          ],
          { session },
        );
      }
      await this.audit.record(
        {
          action: CRM_AUDIT_ACTIONS.leadUpdated,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'lead', id: leadId },
          changes: buildChangeSummary(
            {
              nextFollowUpOn: before.nextFollowUpOn,
              interestedProjectId: before.interestedProjectId,
              currentSource: before.currentSource ?? before.source,
              nurture: before.nurture,
            },
            {
              nextFollowUpOn: result.nextFollowUpOn,
              interestedProjectId: result.interestedProjectId,
              currentSource: result.currentSource ?? result.source,
              nurture: result.nurture ?? false,
            },
          ),
          context,
        },
        { session },
      );
      return result;
    });
    return toLead(updated);
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
        actor: auditActor(actor),
        target: { type: 'lead', id: leadId },
        reason: `refused stage move ${before.stage} -> ${input.stage}`,
        context,
      });
      throw new LeadStageError(before.stage, input.stage);
    }
    // A lost lead with no reason is the single most useless record in a CRM.
    if (input.stage === 'lost' && !input.reason?.trim()) throw new LostReasonRequiredError();
    if (input.reasonCode !== undefined) {
      if (input.stage !== 'lost') throw invalid('REASON_CODE_ONLY_FOR_LOST', ['reasonCode']);
      const active = this.options.isActiveReason
        ? await this.options.isActiveReason('lossReasons', input.reasonCode)
        : false;
      if (!active) throw invalid('REASON_CODE_UNKNOWN', ['reasonCode']);
    }

    const now = new Date();
    const set: Record<string, unknown> = {
      stage: input.stage,
      updatedAt: now,
      lastActivityAt: now,
    };
    if (input.stage === 'lost') {
      set['lostReason'] = input.reason;
      if (input.reasonCode) set['lostReasonCode'] = input.reasonCode;
      if (input.nurture !== undefined) set['nurture'] = input.nurture;
    }

    const updated = await withTransaction(this.connection, async (session) => {
      const result = await this.leads
        .findOneAndUpdate(
          { leadId, stage: before.stage },
          { $set: set, $inc: { version: 1 } },
          { returnDocument: 'after', runValidators: true, session },
        )
        .lean<LeadDocument>()
        .exec();
      if (!result) throw new LeadStageError(before.stage, input.stage);
      await this.activities.create(
        [
          {
            activityId: newId('act'),
            leadId,
            kind: 'stageChanged',
            ...(input.reason ? { body: input.reason } : {}),
            fromStage: before.stage,
            toStage: input.stage,
            actorAccountId: actor.accountId,
            occurredAt: now,
          },
        ],
        { session },
      );
      await this.audit.record(
        {
          action: CRM_AUDIT_ACTIONS.leadStageChanged,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'lead', id: leadId },
          changes: buildChangeSummary(
            { stage: before.stage },
            { stage: input.stage, ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}) },
          ),
          ...(input.reason ? { reason: input.reason } : {}),
          context,
        },
        { session },
      );
      return result;
    });
    return toLead(updated);
  }

  /**
   * CRM-LEAD-004: record what was learned, and move the lead to `qualified` when the pipeline permits
   * it. A lead already further along keeps its stage and gains the record.
   */
  async qualifyLead(
    actor: ActorContext,
    leadId: string,
    input: QualifyLead,
    context: RequestContext,
  ): Promise<Lead> {
    const before = await this.getLead(actor, leadId);
    if (input.expectedVersion !== undefined && input.expectedVersion !== before.version) {
      throw new CrmConflictError('staleVersion');
    }
    if (TERMINAL_LEAD_STAGES.includes(before.stage)) throw conflict('LEAD_CONCLUDED');
    const moves = before.stage !== 'qualified' && canTransitionLead(before.stage, 'qualified');
    const now = new Date();
    const updated = await withTransaction(this.connection, async (session) => {
      const result = await this.leads
        .findOneAndUpdate(
          { leadId, version: before.version },
          {
            $set: {
              qualification: {
                budgetConfirmed: input.budgetConfirmed,
                timeframe: input.timeframe,
                purpose: input.purpose,
                decisionRole: input.decisionRole,
                ...(input.notes ? { notes: input.notes } : {}),
                qualifiedAt: now,
                qualifiedBy: actor.accountId,
              },
              ...(moves ? { stage: 'qualified' } : {}),
              lastActivityAt: now,
              updatedAt: now,
            },
            $inc: { version: 1 },
          },
          { returnDocument: 'after', runValidators: true, session },
        )
        .lean<LeadDocument>()
        .exec();
      if (!result) throw new CrmConflictError('staleVersion');
      await this.activities.create(
        [
          {
            activityId: newId('act'),
            leadId,
            kind: 'qualified',
            ...(input.notes ? { body: input.notes } : {}),
            ...(moves ? { fromStage: before.stage, toStage: 'qualified' } : {}),
            actorAccountId: actor.accountId,
            occurredAt: now,
          },
        ],
        { session },
      );
      await this.audit.record(
        {
          action: CRM_AUDIT_ACTIONS.leadQualified,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'lead', id: leadId },
          changes: buildChangeSummary(
            { stage: before.stage },
            {
              stage: result.stage,
              timeframe: input.timeframe,
              purpose: input.purpose,
              budgetConfirmed: String(input.budgetConfirmed),
            },
          ),
          context,
        },
        { session },
      );
      return result;
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
    const now = new Date();
    await this.leads
      .updateOne(
        { leadId, stage: current.stage },
        { $set: { stage: to, updatedAt: now, lastActivityAt: now }, $inc: { version: 1 } },
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
          actorAccountId: actor.accountId,
          occurredAt: now,
        },
      ],
      { session },
    );
    await this.audit.record(
      {
        action: CRM_AUDIT_ACTIONS.leadStageChanged,
        outcome: 'succeeded',
        actor: auditActor(actor),
        target: { type: 'lead', id: leadId },
        changes: buildChangeSummary({ stage: current.stage }, { stage: to }),
        reason,
        context,
      },
      { session },
    );
  }

  /** CRM-ASSIGN-001: to an eligible colleague only, with a reason and a history. */
  async assignLead(
    actor: ActorContext,
    leadId: string,
    input: AssignLead,
    context: RequestContext,
  ): Promise<Lead> {
    const before = await this.getLead(actor, leadId);
    if (input.assignedToAccountId === before.assignedToAccountId) {
      throw invalid('ALREADY_OWNER', ['assignedToAccountId']);
    }
    const placement = await this.assertEligibleOwner(
      actor,
      input.assignedToAccountId,
      'crm.lead.view',
      before.branchId,
      { type: 'lead', id: leadId },
      context,
    );
    const now = new Date();
    const moved = CrmService.placementUpdate(placement);
    const updated = await withTransaction(this.connection, async (session) => {
      const result = await this.leads
        .findOneAndUpdate(
          { leadId, version: before.version },
          {
            $set: {
              assignedToAccountId: input.assignedToAccountId,
              ...moved.set,
              updatedAt: now,
              lastActivityAt: now,
            },
            $inc: { version: 1 },
            // The lead goes where its new owner works; an owner with no team takes it out of the old one.
            $unset: moved.unset,
          },
          { returnDocument: 'after', runValidators: true, session },
        )
        .lean<LeadDocument>()
        .exec();
      if (!result) throw new CrmConflictError('staleVersion');
      await this.recordOwnershipChange(
        actor,
        {
          subjectType: 'lead',
          subjectId: leadId,
          fromAccountId: before.assignedToAccountId,
          toAccountId: input.assignedToAccountId,
          reason: input.reason,
        },
        session,
      );
      await this.activities.create(
        [
          {
            activityId: newId('act'),
            leadId,
            kind: 'assignmentChanged',
            body: input.reason,
            actorAccountId: actor.accountId,
            occurredAt: now,
          },
        ],
        { session },
      );
      await this.audit.record(
        {
          action: CRM_AUDIT_ACTIONS.leadAssigned,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'lead', id: leadId },
          changes: buildChangeSummary(
            { assignedToAccountId: before.assignedToAccountId },
            { assignedToAccountId: input.assignedToAccountId },
          ),
          reason: input.reason,
          context,
        },
        { session },
      );
      return result;
    });
    return toLead(updated);
  }

  /**
   * CRM-LEAD-005: make the lead's buyer a customer. Idempotent — a converted lead returns its
   * customer — and a customer who already exists by phone is linked rather than duplicated. The lead
   * stays as history; its stage is not changed by conversion.
   */
  async convertLead<T = never>(
    actor: ActorContext,
    leadId: string,
    context: RequestContext,
    /**
     * Opens an opportunity in the same transaction (CRM-LEAD-005). Supplied by the opportunity
     * service, so CRM's customer and lead code needs no knowledge of opportunities.
     */
    openOpportunity?: (lead: Lead, customer: Customer, session: ClientSession) => Promise<T>,
  ): Promise<{
    lead: Lead;
    customer: Customer;
    customerCreated: boolean;
    replayed: boolean;
    opportunity?: T;
  }> {
    const before = await this.getLead(actor, leadId);
    if (before.customerId) {
      // The customer is described only through the actor's own scope, like any other read.
      if (!(await this.customerVisible(actor, before.customerId))) {
        throw conflict('CUSTOMER_OUTSIDE_SCOPE');
      }
      return {
        lead: before,
        customer: await this.getCustomer(actor, before.customerId),
        customerCreated: false,
        replayed: true,
      };
    }
    if (before.stage === 'lost') throw conflict('LEAD_LOST');

    // A customer already holding this phone in the entity is linked — but only if the actor may see
    // them. Otherwise the conversion is refused without describing who they are (CRM-PERSON-006).
    const match = await this.customers
      .findOne(
        {
          legalEntityId: before.legalEntityId,
          primaryPhoneDigits: normalizePhone(before.primaryPhone),
        },
        { customerId: 1 },
      )
      .lean<CustomerDocument>()
      .exec();
    if (match && !(await this.customerVisible(actor, match.customerId))) {
      throw conflict('CUSTOMER_OUTSIDE_SCOPE');
    }

    try {
      return await withTransaction(this.connection, async (session) => {
        const { customer, created } = await this.customerForLead(actor, before, context, session);
        const now = new Date();
        const result = await this.leads
          .findOneAndUpdate(
            { leadId, version: before.version, customerId: { $exists: false } },
            {
              $set: {
                customerId: customer.customerId,
                convertedAt: now,
                lastActivityAt: now,
                updatedAt: now,
              },
              $inc: { version: 1 },
            },
            { returnDocument: 'after', runValidators: true, session },
          )
          .lean<LeadDocument>()
          .exec();
        if (!result) throw conflict('STALE_VERSION');
        const opportunity = openOpportunity
          ? await openOpportunity(toLead(result), customer, session)
          : undefined;
        await this.activities.create(
          [
            {
              activityId: newId('act'),
              leadId,
              kind: 'converted',
              actorAccountId: actor.accountId,
              occurredAt: now,
            },
            {
              activityId: newId('act'),
              customerId: customer.customerId,
              leadId,
              kind: 'converted',
              actorAccountId: actor.accountId,
              occurredAt: now,
            },
          ],
          { session, ordered: true },
        );
        await this.audit.record(
          {
            action: CRM_AUDIT_ACTIONS.leadConverted,
            outcome: 'succeeded',
            actor: auditActor(actor),
            target: { type: 'lead', id: leadId },
            changes: buildChangeSummary(
              { customerId: undefined },
              { customerId: customer.customerId, customerCreated: String(created) },
            ),
            context,
          },
          { session },
        );
        return {
          lead: toLead(result),
          customer,
          customerCreated: created,
          replayed: false,
          ...(opportunity !== undefined ? { opportunity } : {}),
        };
      });
    } catch (error) {
      // Two conversions racing on one lead create one customer: the loser reads what the winner made.
      if (isDuplicateKeyError(error)) {
        const again = await this.getLead(actor, leadId);
        if (again.customerId) return this.convertLead(actor, leadId, context);
        throw conflict('DUPLICATE_CUSTOMER_PHONE', ['primaryPhone']);
      }
      throw error;
    }
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

  async listCustomerActivities(actor: ActorContext, customerId: string): Promise<Activity[]> {
    await this.scopedCustomer(actor, customerId);
    const documents = await this.activities
      .find({ customerId })
      .sort({ occurredAt: -1, activityId: -1 })
      .limit(200)
      .lean<ActivityDocument[]>()
      .exec();
    return documents.map(toActivity);
  }

  /** Activities of an opportunity. The caller has already proved the opportunity is visible. */
  async listOpportunityActivities(opportunityId: string): Promise<Activity[]> {
    assertSafeFilter({ opportunityId });
    const documents = await this.activities
      .find({ opportunityId })
      .sort({ occurredAt: -1, activityId: -1 })
      .limit(200)
      .lean<ActivityDocument[]>()
      .exec();
    return documents.map(toActivity);
  }

  /** Append an activity for another CRM aggregate inside its caller's transaction. */
  async appendActivity(
    actor: ActorContext,
    activity: Omit<ActivityDocument, 'activityId' | 'occurredAt' | 'actorAccountId'>,
    session: ClientSession,
  ): Promise<Activity> {
    const [created] = await this.activities.create(
      [
        {
          activityId: newId('act'),
          ...activity,
          actorAccountId: actor.accountId,
          occurredAt: new Date(),
        },
      ],
      { session },
    );
    if (!created) throw new CrmConflictError('activityNotCreated');
    return toActivity(created.toObject());
  }

  async addActivity(
    actor: ActorContext,
    leadId: string,
    input: CreateActivity,
    context: RequestContext,
  ): Promise<Activity> {
    const lead = await this.getLead(actor, leadId);
    const now = new Date();
    return withTransaction(this.connection, async (session) => {
      const [created] = await this.activities.create(
        [
          {
            activityId: newId('act'),
            leadId,
            ...(lead.customerId ? { customerId: lead.customerId } : {}),
            kind: input.kind,
            ...(input.body ? { body: input.body } : {}),
            ...(input.dueOn ? { dueOn: input.dueOn } : {}),
            actorAccountId: actor.accountId,
            occurredAt: now,
          },
        ],
        { session },
      );
      if (!created) throw new CrmConflictError('activityNotCreated');

      // A scheduled follow-up is the lead's next follow-up: one fact, not two that can disagree.
      await this.leads
        .updateOne(
          { leadId },
          {
            $set: {
              lastActivityAt: now,
              updatedAt: now,
              ...(input.kind === 'followUpScheduled' && input.dueOn
                ? { nextFollowUpOn: input.dueOn }
                : {}),
            },
            $inc: { version: 1 },
          },
          { session },
        )
        .exec();

      await this.audit.record(
        {
          action: CRM_AUDIT_ACTIONS.activityRecorded,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'lead', id: leadId },
          changes: buildChangeSummary(
            { nextFollowUpOn: lead.nextFollowUpOn },
            { kind: input.kind, nextFollowUpOn: input.dueOn ?? lead.nextFollowUpOn },
          ),
          context,
        },
        { session },
      );
      return toActivity(created.toObject());
    });
  }

  async addCustomerActivity(
    actor: ActorContext,
    customerId: string,
    input: CreateActivity,
    context: RequestContext,
  ): Promise<Activity> {
    await this.scopedCustomer(actor, customerId);
    return withTransaction(this.connection, async (session) => {
      const [created] = await this.activities.create(
        [
          {
            activityId: newId('act'),
            customerId,
            kind: input.kind,
            ...(input.body ? { body: input.body } : {}),
            ...(input.dueOn ? { dueOn: input.dueOn } : {}),
            actorAccountId: actor.accountId,
            occurredAt: new Date(),
          },
        ],
        { session },
      );
      if (!created) throw new CrmConflictError('activityNotCreated');
      await this.audit.record(
        {
          action: CRM_AUDIT_ACTIONS.activityRecorded,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'customer', id: customerId },
          changes: buildChangeSummary(undefined, { kind: input.kind }),
          context,
        },
        { session },
      );
      return toActivity(created.toObject());
    });
  }

  /* ------------------------------------------------------------- dashboard */

  async dashboard(actor: ActorContext): Promise<CrmDashboard> {
    const scopeFilter = withScope(buildScopeFilter(actor, LEAD_SCOPE_FIELDS));
    const today = this.today();
    const now = this.now().getTime();
    const open = { stage: { $nin: TERMINAL_LEAD_STAGES } };
    const ageBoundary = (days: number) => new Date(now - days * DAY_MS);

    /**
     * Every figure below is computed from the **same** scope filter as the first aggregation stage.
     * A dashboard is exactly where a scope leak hides: the list looks correct and the headline number
     * quietly counts the whole company (SEC-028).
     */
    const [
      byStage,
      bySource,
      byOwner,
      dueFollowUps,
      overdueFollowUps,
      total,
      byAge,
      untouchedOpenLeads,
    ] = await Promise.all([
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
        $and: [scopeFilter, { nextFollowUpOn: { $lte: today }, ...open }],
      }),
      this.leads.countDocuments({
        $and: [scopeFilter, { nextFollowUpOn: { $lt: today }, ...open }],
      }),
      this.leads.countDocuments(scopeFilter),
      this.leads.aggregate<{ _id: string; count: number }>([
        { $match: { $and: [scopeFilter, open] } },
        {
          $group: {
            _id: {
              $switch: {
                branches: [
                  { case: { $gte: ['$createdAt', ageBoundary(7)] }, then: 'upTo7' },
                  { case: { $gte: ['$createdAt', ageBoundary(30)] }, then: 'upTo30' },
                  { case: { $gte: ['$createdAt', ageBoundary(90)] }, then: 'upTo90' },
                ],
                default: 'over90',
              },
            },
            count: { $sum: 1 },
          },
        },
      ]),
      // "Untouched" is a fact — nothing recorded since creation — not a missed target.
      this.leads.countDocuments({
        $and: [
          scopeFilter,
          open,
          {
            $or: [
              { lastActivityAt: { $exists: false } },
              { $expr: { $lte: ['$lastActivityAt', '$createdAt'] } },
            ],
          },
        ],
      }),
    ]);

    const stageCounts = Object.fromEntries(byStage.map((r) => [r._id, r.count]));
    const won = stageCounts['won'] ?? 0;
    const lost = stageCounts['lost'] ?? 0;
    const concluded = won + lost;
    // A string, produced by integer arithmetic then formatted — never a float percentage (ADR-0007).
    const conversionRate =
      concluded === 0 ? '0' : (Math.round((won / concluded) * 10_000) / 10_000).toFixed(4);
    const ageCounts = Object.fromEntries(byAge.map((r) => [r._id, r.count]));

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
      openByAge: Object.fromEntries(
        LEAD_AGE_BANDS.map((band) => [band, ageCounts[band] ?? 0]),
      ) as CrmDashboard['openByAge'],
      untouchedOpenLeads,
    };
  }
}
