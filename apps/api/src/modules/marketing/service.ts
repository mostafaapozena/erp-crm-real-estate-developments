import {
  CampaignSchema,
  MARKETING_AUDIT_ACTIONS,
  addMoney,
  canTransitionCampaign,
  compareMoney,
  divideMoney,
  isNegativeMoney,
  money,
  type ActorContext,
  type Campaign,
  type CampaignPage,
  type CampaignQuery,
  type CreateCampaign,
  type MarketingOverview,
  type Money,
  type UpdateCampaign,
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
import { campaignModel, type CampaignDocument, type StoredMoney } from './model';

/**
 * Marketing service — `MKT-*` demonstration slice (ADR-0025, ADR-0026).
 *
 * There is **no publish operation**, because nothing can be published: no Meta app review, no business
 * account, no advertising spend. The state machine stops at `readyToPublish`, which is a statement
 * about our own readiness, and `externalReference` is never written.
 *
 * Performance figures are stored under `demoMetrics` and are whatever a person or a seed entered.
 * When an adapter exists, measured figures arrive in a separate structure with their own provenance
 * and this one is deleted rather than quietly repurposed.
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

export class MarketingNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(readonly what: string) {
    super('NOT_FOUND');
    this.name = 'MarketingNotFoundError';
  }
}

export class MarketingConflictError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly what: string) {
    super('CONFLICT');
    this.name = 'MarketingConflictError';
  }
}

export class MarketingValidationError extends Error {
  readonly code = 'VALIDATION_FAILED';
  constructor(readonly what: string) {
    super('VALIDATION_FAILED');
    this.name = 'MarketingValidationError';
  }
}

export const MARKETING_SCOPE_FIELDS: ScopeFieldMap = {
  owner: 'ownerAccountId',
  assignee: 'ownerAccountId',
  branch: 'branchId',
  project: 'projectId',
  legalEntity: 'legalEntityId',
};

const iso = (date: Date) => date.toISOString();

function toMoney(stored: StoredMoney): Money {
  return { amount: fromDecimal128(stored.amount), currency: stored.currency };
}

function fromMoney(value: Money): StoredMoney {
  return { amount: toDecimal128(value.amount), currency: value.currency };
}

function toCampaign(d: CampaignDocument): Campaign {
  return CampaignSchema.parse({
    campaignId: d.campaignId,
    name: d.name,
    platform: d.platform,
    objective: d.objective,
    state: d.state,
    budget: toMoney(d.budget),
    startsOn: d.startsOn,
    ...(d.endsOn ? { endsOn: d.endsOn } : {}),
    ...(d.projectId ? { projectId: d.projectId } : {}),
    ownerAccountId: d.ownerAccountId,
    legalEntityId: d.legalEntityId,
    branchId: d.branchId,
    ...(d.audienceSummary ? { audienceSummary: d.audienceSummary } : {}),
    ...(d.creativeHeadline ? { creativeHeadline: d.creativeHeadline } : {}),
    ...(d.creativeBody ? { creativeBody: d.creativeBody } : {}),
    demoMetrics: {
      impressions: d.demoMetrics.impressions,
      reach: d.demoMetrics.reach,
      clicks: d.demoMetrics.clicks,
      leads: d.demoMetrics.leads,
      spend: toMoney(d.demoMetrics.spend),
    },
    // Never written, so never present. Included here only to make that explicit.
    ...(d.externalReference ? { externalReference: d.externalReference } : {}),
    version: d.version,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  });
}

function encodeCursor(date: Date, id: string): string {
  return Buffer.from(`${date.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { date: Date; id: string } | undefined {
  try {
    const [text, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!text || !id) return undefined;
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? undefined : { date, id };
  } catch {
    return undefined;
  }
}

export class MarketingService {
  private readonly campaigns;
  private readonly audit;
  private readonly resolveBranch;

  constructor(options: {
    connection: Connection;
    audit: AuditRecorder;
    resolveBranch: BranchResolver;
  }) {
    this.campaigns = campaignModel(options.connection);
    this.audit = options.audit;
    this.resolveBranch = options.resolveBranch;
  }

  async listCampaigns(actor: ActorContext, query: CampaignQuery): Promise<CampaignPage> {
    const requested: Record<string, unknown> = {};
    for (const key of ['platform', 'state', 'projectId', 'ownerAccountId'] as const) {
      const value = query[key];
      if (value !== undefined) requested[key] = value;
    }
    assertSafeFilter(requested);
    const filter = withScope(buildScopeFilter(actor, MARKETING_SCOPE_FIELDS), requested);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const paged = cursor
      ? {
          $and: [
            filter,
            {
              $or: [
                { createdAt: { $lt: cursor.date } },
                { createdAt: cursor.date, campaignId: { $lt: cursor.id } },
              ],
            },
          ],
        }
      : filter;
    const [documents, total] = await Promise.all([
      this.campaigns
        .find(paged)
        .sort({ createdAt: -1, campaignId: -1 })
        .limit(query.limit + 1)
        .lean<CampaignDocument[]>()
        .exec(),
      this.campaigns.countDocuments(filter).exec(),
    ]);
    const page = documents.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toCampaign),
      total,
      limit: query.limit,
      ...(documents.length > query.limit && last
        ? { nextCursor: encodeCursor(last.createdAt, last.campaignId) }
        : {}),
      // Constant, and on every response: no provider is connected (ADR-0026).
      providerConnected: false,
    };
  }

  async getCampaign(actor: ActorContext, campaignId: string): Promise<Campaign> {
    assertSafeFilter({ campaignId });
    const filter = withScope(buildScopeFilter(actor, MARKETING_SCOPE_FIELDS), { campaignId });
    const document = await this.campaigns.findOne(filter).lean<CampaignDocument>().exec();
    if (!document) throw new MarketingNotFoundError('campaign');
    return toCampaign(document);
  }

  async createCampaign(
    actor: ActorContext,
    input: CreateCampaign,
    context: RequestContext,
  ): Promise<Campaign> {
    assertSafeFilter({ branchId: input.branchId });
    const branch = await this.resolveBranch(input.branchId);
    if (!branch) throw new MarketingNotFoundError('branch');
    if (isNegativeMoney(input.budget)) throw new MarketingValidationError('negativeBudget');
    if (input.endsOn && input.endsOn < input.startsOn) {
      throw new MarketingValidationError('endsBeforeStarts');
    }

    const now = new Date();
    const document: CampaignDocument = {
      campaignId: newId('cmp'),
      name: input.name,
      platform: input.platform,
      objective: input.objective,
      state: 'draft',
      budget: fromMoney(input.budget),
      startsOn: input.startsOn,
      ...(input.endsOn ? { endsOn: input.endsOn } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ownerAccountId: actor.accountId,
      legalEntityId: branch.legalEntityId,
      branchId: input.branchId,
      ...(input.audienceSummary ? { audienceSummary: input.audienceSummary } : {}),
      ...(input.creativeHeadline ? { creativeHeadline: input.creativeHeadline } : {}),
      ...(input.creativeBody ? { creativeBody: input.creativeBody } : {}),
      // A new campaign has measured nothing, because nothing ran.
      demoMetrics: {
        impressions: 0,
        reach: 0,
        clicks: 0,
        leads: 0,
        spend: fromMoney(money('0', input.budget.currency)),
      },
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    let created;
    try {
      created = await this.campaigns.create(document);
    } catch (error) {
      if ((error as { code?: unknown }).code === 11000) {
        throw new MarketingConflictError('duplicateCampaignName');
      }
      throw error;
    }
    const campaign = toCampaign(created.toObject());
    await this.audit.record({
      action: MARKETING_AUDIT_ACTIONS.campaignCreated,
      outcome: 'succeeded',
      actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
      target: { type: 'campaign', id: campaign.campaignId },
      changes: buildChangeSummary(undefined, {
        platform: campaign.platform,
        objective: campaign.objective,
        state: campaign.state,
      }),
      context,
    });
    return campaign;
  }

  async updateCampaign(
    actor: ActorContext,
    campaignId: string,
    input: UpdateCampaign,
    context: RequestContext,
  ): Promise<Campaign> {
    const current = await this.getCampaign(actor, campaignId);
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      throw new MarketingConflictError('staleVersion');
    }
    if (input.state && !canTransitionCampaign(current.state, input.state)) {
      await this.audit.record({
        action: MARKETING_AUDIT_ACTIONS.campaignRefused,
        outcome: 'denied',
        actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
        target: { type: 'campaign', id: campaignId },
        reason: `refused transition ${current.state} -> ${input.state}`,
        context,
      });
      throw new MarketingConflictError('invalidTransition');
    }
    if (input.budget && isNegativeMoney(input.budget)) {
      throw new MarketingValidationError('negativeBudget');
    }

    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of [
      'name',
      'objective',
      'endsOn',
      'projectId',
      'audienceSummary',
      'creativeHeadline',
      'creativeBody',
      'state',
    ] as const) {
      if (input[key] !== undefined) set[key] = input[key];
    }
    if (input.budget) set['budget'] = fromMoney(input.budget);

    const updated = await this.campaigns
      .findOneAndUpdate(
        { campaignId, version: current.version },
        { $set: set, $inc: { version: 1 } },
        { new: true, runValidators: true },
      )
      .lean<CampaignDocument>()
      .exec();
    if (!updated) throw new MarketingConflictError('staleVersion');

    const campaign = toCampaign(updated);
    await this.audit.record({
      action: MARKETING_AUDIT_ACTIONS.campaignUpdated,
      outcome: 'succeeded',
      actor: { kind: actor.kind, accountId: actor.accountId, roleKeys: actor.roleKeys },
      target: { type: 'campaign', id: campaignId },
      changes: buildChangeSummary(
        { state: current.state, objective: current.objective },
        { state: campaign.state, objective: campaign.objective },
      ),
      context,
    });
    return campaign;
  }

  async overview(actor: ActorContext): Promise<MarketingOverview> {
    const filter = withScope(buildScopeFilter(actor, MARKETING_SCOPE_FIELDS));
    const documents = await this.campaigns
      .find(filter)
      .limit(1000)
      .lean<CampaignDocument[]>()
      .exec();

    const currency = documents[0]?.budget.currency ?? 'EGP';
    const zero = money('0', currency);
    let totalBudget = zero;
    let totalSpend = zero;
    let totalLeads = 0;
    const byPlatform = new Map<string, { campaigns: number; spend: Money; leads: number }>();

    for (const document of documents) {
      totalBudget = addMoney(totalBudget, toMoney(document.budget));
      totalSpend = addMoney(totalSpend, toMoney(document.demoMetrics.spend));
      totalLeads += document.demoMetrics.leads;
      const entry = byPlatform.get(document.platform) ?? { campaigns: 0, spend: zero, leads: 0 };
      entry.campaigns += 1;
      entry.spend = addMoney(entry.spend, toMoney(document.demoMetrics.spend));
      entry.leads += document.demoMetrics.leads;
      byPlatform.set(document.platform, entry);
    }

    return {
      campaigns: documents.length,
      totalBudget,
      totalSpend,
      totalLeads,
      /**
       * Absent rather than zero when nothing converted. A cost per lead of "0" reads as "free", and
       * an infinity reads as a bug; both end up in a slide. No leads means the figure does not exist.
       */
      ...(totalLeads > 0 && compareMoney(totalSpend, zero) > 0
        ? { costPerLead: divideMoney(totalSpend, String(totalLeads), 2) }
        : {}),
      byPlatform: [...byPlatform.entries()].map(([platform, entry]) => ({
        platform: platform as MarketingOverview['byPlatform'][number]['platform'],
        campaigns: entry.campaigns,
        spend: entry.spend,
        leads: entry.leads,
      })),
      providerConnected: false,
    };
  }

  /** Seed-only: set the demonstration figures on an existing campaign. Never reachable over HTTP. */
  async setDemoMetrics(
    campaignId: string,
    metrics: { impressions: number; reach: number; clicks: number; leads: number; spend: Money },
  ): Promise<void> {
    assertSafeFilter({ campaignId });
    await this.campaigns
      .updateOne(
        { campaignId },
        {
          $set: {
            demoMetrics: {
              impressions: metrics.impressions,
              reach: metrics.reach,
              clicks: metrics.clicks,
              leads: metrics.leads,
              spend: fromMoney(metrics.spend),
            },
            updatedAt: new Date(),
          },
          $inc: { version: 1 },
        },
      )
      .exec();
  }
}
