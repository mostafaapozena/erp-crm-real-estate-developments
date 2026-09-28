import type { ActorContext, CompanyProfileInput } from '@alola/contracts';
import type { DomainServices } from '../../apps/api/src/platform/domain-services';
import {
  COMPANY_PROFILE,
  LEGAL_ENTITY,
  SUPERSEDED_CAMPAIGN_HEADLINE,
  SUPERSEDED_LEGAL_ENTITY_NAMES,
} from './dataset';
import type { SeedLedger } from './ledger';

/**
 * The demonstration deployment's identity: the ALOLA company profile, and the demonstration legal
 * entity and campaign headline that still carry the superseded name.
 *
 * Everything goes through the product's own services, as the seeded accounts — the administrator
 * writes the profile and renames the legal entity, the marketing manager edits the campaign — so each
 * change is validated, permission-checked, scoped and audited exactly as the same change made on
 * screen would be. Nothing is deleted and no history is rewritten: the legal entity's earlier name
 * stays in its audit record.
 *
 * It is idempotent and conservative. A profile that already exists is never overwritten (changing a
 * live company's identity is an act for Settings → Company identity), and a legal entity or headline
 * is changed only while it still carries the exact superseded value.
 */
export type IdentityOutcome = 'created' | 'updated' | 'unchanged' | 'kept (differs)' | 'not found';

export interface IdentityReport {
  companyProfile: IdentityOutcome;
  legalEntity: IdentityOutcome;
  campaignHeadline: IdentityOutcome;
}

const sameLabel = (a: { ar: string; en: string }, b: { ar: string; en: string }) =>
  a.ar === b.ar && a.en === b.en;

export async function applyDemoIdentity(options: {
  services: DomainServices;
  admin: ActorContext;
  marketing: ActorContext;
  ledger: SeedLedger;
  timeZone: string;
  context: { correlationId: string; method: string; route: string };
}): Promise<IdentityReport> {
  const { services, admin, marketing, ledger, timeZone, context } = options;
  const report: IdentityReport = {
    companyProfile: 'unchanged',
    legalEntity: 'unchanged',
    campaignHeadline: 'unchanged',
  };

  /* ------------------------------------------------------------ company profile */

  const company = services.company();
  const existing = await company.getProfile();
  if (!existing) {
    const input: CompanyProfileInput = {
      ...COMPANY_PROFILE,
      otherIdentifiers: [],
      supportedLocales: [...COMPANY_PROFILE.supportedLocales],
      timeZone,
    };
    await company.createProfile(admin, input, context);
    report.companyProfile = 'created';
  } else if (!sameLabel(existing.tradeName, COMPANY_PROFILE.tradeName)) {
    report.companyProfile = 'kept (differs)';
  }

  /* --------------------------------------------------------------- legal entity */

  const organization = services.organization();
  const entities = await organization.listLegalEntities(admin);
  const entity = entities.find((candidate) => candidate.code === LEGAL_ENTITY.code);
  if (!entity) {
    report.legalEntity = 'not found';
  } else if (SUPERSEDED_LEGAL_ENTITY_NAMES.some((name) => sameLabel(entity.name, name))) {
    await organization.updateLegalEntity(
      admin,
      entity.legalEntityId,
      { name: { ...LEGAL_ENTITY.name } },
      context,
    );
    report.legalEntity = 'updated';
  } else if (!sameLabel(entity.name, LEGAL_ENTITY.name)) {
    report.legalEntity = 'kept (differs)';
  }

  /* ----------------------------------------------------------- campaign headline */

  const campaignId = ledger.existing('campaign:search-brand');
  if (!campaignId) {
    report.campaignHeadline = 'not found';
  } else {
    const marketingService = services.marketing();
    const campaign = await marketingService.getCampaign(marketing, campaignId);
    if (campaign.creativeHeadline === SUPERSEDED_CAMPAIGN_HEADLINE) {
      await marketingService.updateCampaign(
        marketing,
        campaignId,
        { creativeHeadline: LEGAL_ENTITY.name.ar, expectedVersion: campaign.version },
        context,
      );
      report.campaignHeadline = 'updated';
    }
  }

  return report;
}
