/**
 * MKT module published interface (ADR-0001).
 *
 * Owns local campaign drafts. **No provider is connected** and no publish operation exists — not a
 * disabled one, not a stubbed one (ADR-0026). `setDemoMetrics` is reachable only from the development
 * seed, never from a router.
 */
export { CAMPAIGNS_COLLECTION, CampaignUndeletableError, campaignModel } from './model';
export {
  MARKETING_SCOPE_FIELDS,
  MarketingConflictError,
  MarketingNotFoundError,
  MarketingService,
  MarketingValidationError,
} from './service';
export type { AuditRecorder, BranchResolver, RequestContext } from './service';
export { marketingRouter } from './router';
export type { MarketingRouterOptions } from './router';
