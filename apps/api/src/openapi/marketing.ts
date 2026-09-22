import {
  CAMPAIGN_PLATFORMS,
  CAMPAIGN_STATES,
  CampaignPageSchema,
  CampaignSchema,
  CreateCampaignSchema,
  MarketingOverviewSchema,
  UpdateCampaignSchema,
} from '@alola/contracts';
import {
  pathParameter,
  queryParameter,
  requestBody,
  type OpenApiHelpers,
  type PathMap,
} from './shared';

export const marketingComponents = {
  Campaign: CampaignSchema,
  CampaignPage: CampaignPageSchema,
  CreateCampaignRequest: CreateCampaignSchema,
  UpdateCampaignRequest: UpdateCampaignSchema,
  MarketingOverview: MarketingOverviewSchema,
} as const;

const NOT_CONNECTED =
  '**No advertising provider is connected.** There is no Meta app review, no business account and no ' +
  'advertising spend, so nothing here can be published and nothing here was measured by a provider. ' +
  'Performance figures are carried under `demoMetrics`, named so they cannot be read as measured, and ' +
  '`providerConnected` is `false` on every response (ADR-0011, ADR-0026).';

export function marketingPaths(h: OpenApiHelpers): PathMap {
  return {
    '/api/v1/marketing/campaigns': {
      get: {
        operationId: 'listCampaigns',
        summary: 'List local campaign drafts',
        description: `Requires marketing.campaign.view. ${NOT_CONNECTED}`,
        parameters: [
          queryParameter('limit', { type: 'integer', minimum: 1, maximum: 100, default: 25 }),
          queryParameter('cursor', { type: 'string' }),
          queryParameter('platform', { type: 'string', enum: [...CAMPAIGN_PLATFORMS] }),
          queryParameter('state', { type: 'string', enum: [...CAMPAIGN_STATES] }),
          queryParameter('projectId', { type: 'string' }),
          queryParameter('ownerAccountId', { type: 'string' }),
        ],
        responses: { '200': h.json('CampaignPage', 'A page of campaigns'), ...h.authorizedErrors },
      },
      post: {
        operationId: 'createCampaign',
        summary: 'Create a local campaign draft',
        description:
          `Requires marketing.campaign.manage. ${NOT_CONNECTED} A new campaign starts at zero on ` +
          'every figure, because nothing has run. There is deliberately **no publish endpoint**: a ' +
          'route named publish would read as a capability whatever its body did.',
        requestBody: requestBody(h.ref('CreateCampaignRequest')),
        responses: { '201': h.json('Campaign', 'The campaign draft'), ...h.conflictErrors },
      },
    },
    '/api/v1/marketing/overview': {
      get: {
        operationId: 'getMarketingOverview',
        summary: 'Budget, spend and lead totals across visible campaigns',
        description:
          `Requires marketing.campaign.view. ${NOT_CONNECTED} costPerLead is **absent** rather than ` +
          'zero when nothing converted: a cost per lead of "0" reads as "free" and an infinity reads ' +
          'as a bug, and both end up in a slide.',
        responses: {
          '200': h.json('MarketingOverview', 'The overview'),
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/marketing/campaigns/{campaignId}': {
      get: {
        operationId: 'getCampaign',
        summary: 'Read one campaign draft',
        description: `Requires marketing.campaign.view. Out of scope answers 404 (SEC-030). ${NOT_CONNECTED}`,
        parameters: [pathParameter('campaignId', 'Opaque campaign identifier')],
        responses: { '200': h.json('Campaign', 'The campaign'), ...h.notFoundErrors },
      },
      patch: {
        operationId: 'updateCampaign',
        summary: 'Edit a campaign draft, or move it between local states',
        description:
          'Requires marketing.campaign.manage. The local states are draft, readyToPublish and ' +
          'archived; readyToPublish is a statement about our own readiness and nothing beyond it ' +
          'exists. Campaigns are archived, never deleted, because a lead’s campaignId points at ' +
          'them. Optimistic concurrency on the stored version.',
        parameters: [pathParameter('campaignId', 'Opaque campaign identifier')],
        requestBody: requestBody(h.ref('UpdateCampaignRequest')),
        responses: { '200': h.json('Campaign', 'The updated campaign'), ...h.conflictErrors },
      },
    },
  };
}
