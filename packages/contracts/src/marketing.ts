import { z } from 'zod';
import { EnteredNameSchema, NoteSchema, RecordIdSchema } from './identifiers';
import { MoneySchema } from './money';
import { BusinessDateSchema, InstantSchema } from './time';

/**
 * Marketing — `MKT-*` demonstration slice (ADR-0025, ADR-0026).
 *
 * **Nothing is connected to Meta.** There is no app review, no business account, and no advertising
 * spend, so nothing here can be published and nothing here was measured by a provider. What exists is
 * a local campaign record: the shape the product will keep once an adapter is written, filled with
 * figures a person entered or a seed produced.
 *
 * The honesty is structural, not a label bolted on:
 *
 * - There is **no `published` state** and no publish endpoint. A campaign is a local draft, and the
 *   vocabulary stops at `readyToPublish` — a statement about *our* readiness, not the provider's.
 * - Every performance figure lives under `demoMetrics`, named so it cannot be read as measured.
 * - `externalReference` exists and is always absent, so connecting a provider later adds a value
 *   rather than reinterpreting one.
 */

export const CAMPAIGN_PLATFORMS = ['facebook', 'instagram', 'google', 'tiktok', 'other'] as const;
export const CampaignPlatformSchema = z.enum(CAMPAIGN_PLATFORMS);
export type CampaignPlatform = z.infer<typeof CampaignPlatformSchema>;

export const CAMPAIGN_OBJECTIVES = [
  'leadGeneration',
  'awareness',
  'traffic',
  'engagement',
  'conversions',
] as const;
export const CampaignObjectiveSchema = z.enum(CAMPAIGN_OBJECTIVES);
export type CampaignObjective = z.infer<typeof CampaignObjectiveSchema>;

/**
 * Local lifecycle only. `readyToPublish` means a person has finished configuring it here; it says
 * nothing about any provider, and there is deliberately no state beyond it (ADR-0026).
 */
export const CAMPAIGN_STATES = ['draft', 'readyToPublish', 'archived'] as const;
export const CampaignStateSchema = z.enum(CAMPAIGN_STATES);
export type CampaignState = z.infer<typeof CampaignStateSchema>;

export const CAMPAIGN_TRANSITIONS: Readonly<Record<CampaignState, readonly CampaignState[]>> = {
  draft: ['readyToPublish', 'archived'],
  readyToPublish: ['draft', 'archived'],
  archived: ['draft'],
};

export function canTransitionCampaign(from: CampaignState, to: CampaignState): boolean {
  return CAMPAIGN_TRANSITIONS[from].includes(to);
}

/**
 * Figures shown on the marketing screens.
 *
 * Named `demoMetrics` rather than `metrics` so that no caller, screen or report can read them as
 * something a provider measured. When an adapter exists these become a separate, clearly-sourced
 * structure and this one is deleted.
 */
export const DemoMetricsSchema = z.strictObject({
  impressions: z.number().int().nonnegative(),
  reach: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  leads: z.number().int().nonnegative(),
  spend: MoneySchema,
});
export type DemoMetrics = z.infer<typeof DemoMetricsSchema>;

export const CampaignSchema = z.strictObject({
  campaignId: RecordIdSchema,
  name: EnteredNameSchema,
  platform: CampaignPlatformSchema,
  objective: CampaignObjectiveSchema,
  state: CampaignStateSchema,
  budget: MoneySchema,
  startsOn: BusinessDateSchema,
  endsOn: BusinessDateSchema.optional(),
  projectId: RecordIdSchema.optional(),
  /** The marketing owner. `self` and `assigned` scopes resolve against this. */
  ownerAccountId: z.string().min(1).max(200),
  legalEntityId: RecordIdSchema,
  branchId: RecordIdSchema,
  /** Free text describing who the campaign targets. No audience is created anywhere. */
  audienceSummary: NoteSchema.optional(),
  /** Metadata about the creative: a headline and a description. No file is uploaded (`CORE-DOC`). */
  creativeHeadline: z.string().trim().max(200).optional(),
  creativeBody: NoteSchema.optional(),
  demoMetrics: DemoMetricsSchema,
  /**
   * The provider's own campaign identifier. **Always absent**, because nothing is published. It is in
   * the schema so that connecting a provider adds a value rather than reinterpreting a field.
   */
  externalReference: z.string().max(200).optional(),
  version: z.number().int().positive(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Campaign = z.infer<typeof CampaignSchema>;

export const CreateCampaignSchema = z.strictObject({
  name: EnteredNameSchema,
  platform: CampaignPlatformSchema,
  objective: CampaignObjectiveSchema,
  budget: MoneySchema,
  startsOn: BusinessDateSchema,
  endsOn: BusinessDateSchema.optional(),
  branchId: RecordIdSchema,
  projectId: RecordIdSchema.optional(),
  audienceSummary: NoteSchema.optional(),
  creativeHeadline: z.string().trim().max(200).optional(),
  creativeBody: NoteSchema.optional(),
});
export type CreateCampaign = z.infer<typeof CreateCampaignSchema>;

export const UpdateCampaignSchema = z.strictObject({
  name: EnteredNameSchema.optional(),
  objective: CampaignObjectiveSchema.optional(),
  budget: MoneySchema.optional(),
  endsOn: BusinessDateSchema.optional(),
  projectId: RecordIdSchema.optional(),
  audienceSummary: NoteSchema.optional(),
  creativeHeadline: z.string().trim().max(200).optional(),
  creativeBody: NoteSchema.optional(),
  state: CampaignStateSchema.optional(),
  expectedVersion: z.number().int().positive().optional(),
});
export type UpdateCampaign = z.infer<typeof UpdateCampaignSchema>;

export const CampaignQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(200).optional(),
  platform: CampaignPlatformSchema.optional(),
  state: CampaignStateSchema.optional(),
  projectId: RecordIdSchema.optional(),
  ownerAccountId: z.string().min(1).max(200).optional(),
});
export type CampaignQuery = z.infer<typeof CampaignQuerySchema>;

export const CampaignPageSchema = z.strictObject({
  items: z.array(CampaignSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  nextCursor: z.string().optional(),
  /** Always `false`. Stated on the response so no screen can imply otherwise (ADR-0026). */
  providerConnected: z.literal(false),
});
export type CampaignPage = z.infer<typeof CampaignPageSchema>;

/**
 * The marketing overview.
 *
 * `costPerLead` is spend ÷ leads as a decimal string, and is **absent** when no leads were recorded —
 * a division by zero rendered as "0" or "∞" is the kind of number that ends up in a board pack.
 */
export const MarketingOverviewSchema = z.strictObject({
  campaigns: z.number().int().nonnegative(),
  totalBudget: MoneySchema,
  totalSpend: MoneySchema,
  totalLeads: z.number().int().nonnegative(),
  costPerLead: MoneySchema.optional(),
  byPlatform: z.array(
    z.strictObject({
      platform: CampaignPlatformSchema,
      campaigns: z.number().int().nonnegative(),
      spend: MoneySchema,
      leads: z.number().int().nonnegative(),
    }),
  ),
  providerConnected: z.literal(false),
});
export type MarketingOverview = z.infer<typeof MarketingOverviewSchema>;

export const MARKETING_AUDIT_ACTIONS = {
  campaignCreated: 'marketing.campaign.created',
  campaignUpdated: 'marketing.campaign.updated',
  campaignRefused: 'marketing.campaign.refused',
} as const;
