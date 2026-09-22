import { CAMPAIGN_OBJECTIVES, CAMPAIGN_PLATFORMS, CAMPAIGN_STATES } from '@alola/contracts';
import { Schema, type Connection, type Model, type Types } from 'mongoose';

/**
 * Marketing storage — `MKT-*` demonstration slice (ADR-0025, ADR-0026).
 *
 * One collection. A campaign is a **local draft**: there is no published state, no provider
 * identifier with a value, and no field that could be mistaken for a measured result — the figures
 * live under `demoMetrics`, named so they cannot be.
 *
 * Campaigns are archived, never deleted: a campaign that ran is what a lead's `campaignId` points at,
 * and deleting it would orphan the attribution (ADR-0009).
 */
export const CAMPAIGNS_COLLECTION = 'marketingCampaigns';

export class CampaignUndeletableError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly operation: string) {
    super(`Campaigns are archived, never deleted: "${operation}" is refused (ADR-0009).`);
    this.name = 'CampaignUndeletableError';
  }
}

export interface StoredMoney {
  amount: Types.Decimal128;
  currency: string;
}

export interface CampaignDocument {
  campaignId: string;
  name: string;
  platform: (typeof CAMPAIGN_PLATFORMS)[number];
  objective: (typeof CAMPAIGN_OBJECTIVES)[number];
  state: (typeof CAMPAIGN_STATES)[number];
  budget: StoredMoney;
  startsOn: string;
  endsOn?: string;
  projectId?: string;
  ownerAccountId: string;
  legalEntityId: string;
  branchId: string;
  audienceSummary?: string;
  creativeHeadline?: string;
  creativeBody?: string;
  demoMetrics: {
    impressions: number;
    reach: number;
    clicks: number;
    leads: number;
    spend: StoredMoney;
  };
  externalReference?: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const DELETE_OPS = ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const;

const money = new Schema(
  {
    amount: { type: Schema.Types.Decimal128, required: true },
    currency: { type: String, required: true },
  },
  { _id: false },
);

const demoMetrics = new Schema(
  {
    impressions: { type: Number, required: true },
    reach: { type: Number, required: true },
    clicks: { type: Number, required: true },
    leads: { type: Number, required: true },
    spend: { type: money, required: true },
  },
  { _id: false },
);

function campaignSchema(): Schema<CampaignDocument> {
  const schema = new Schema<CampaignDocument>(
    {
      campaignId: { type: String, required: true, immutable: true },
      name: { type: String, required: true },
      platform: { type: String, required: true, immutable: true, enum: [...CAMPAIGN_PLATFORMS] },
      objective: { type: String, required: true, enum: [...CAMPAIGN_OBJECTIVES] },
      state: { type: String, required: true, enum: [...CAMPAIGN_STATES] },
      budget: { type: money, required: true },
      startsOn: { type: String, required: true, immutable: true },
      endsOn: { type: String },
      projectId: { type: String },
      ownerAccountId: { type: String, required: true },
      legalEntityId: { type: String, required: true, immutable: true },
      branchId: { type: String, required: true, immutable: true },
      audienceSummary: { type: String },
      creativeHeadline: { type: String },
      creativeBody: { type: String },
      demoMetrics: { type: demoMetrics, required: true },
      externalReference: { type: String },
      version: { type: Number, required: true },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: CAMPAIGNS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  for (const operation of DELETE_OPS) {
    schema.pre(operation, function rejectDelete() {
      throw new CampaignUndeletableError(operation);
    });
  }
  schema.index({ campaignId: 1 }, { unique: true, name: 'marketingCampaigns_id_unique' });
  schema.index(
    { legalEntityId: 1, name: 1 },
    { unique: true, name: 'marketingCampaigns_entity_name_unique' },
  );
  schema.index({ state: 1, createdAt: -1, campaignId: -1 }, { name: 'marketingCampaigns_keyset' });
  schema.index({ platform: 1, state: 1 }, { name: 'marketingCampaigns_platform_state' });
  schema.index({ projectId: 1, state: 1 }, { name: 'marketingCampaigns_scope_project' });
  schema.index({ legalEntityId: 1, branchId: 1, state: 1 }, { name: 'marketingCampaigns_scope' });
  schema.index({ ownerAccountId: 1, state: 1 }, { name: 'marketingCampaigns_owner_state' });
  return schema;
}

function model<T>(connection: Connection, name: string, build: () => Schema<T>): Model<T> {
  return (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, build());
}

export function campaignModel(connection: Connection): Model<CampaignDocument> {
  return model(connection, CAMPAIGNS_COLLECTION, campaignSchema);
}
