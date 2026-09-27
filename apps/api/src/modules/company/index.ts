/**
 * Company profile module published interface (PLAT-022, PLAT-023, ADR-0027).
 *
 * The deployment's one company profile, its revision history, and its brand images. Other modules
 * read the company through `CompanyService` — `documentIdentity` for documents,
 * `authenticatorIssuer` for second-factor enrolment — never through the collections.
 */
export {
  BRAND_ASSETS_COLLECTION,
  COMPANY_PROFILES_COLLECTION,
  COMPANY_PROFILE_REVISIONS_COLLECTION,
  PRIMARY_PROFILE_KEY,
  brandAssetModel,
  companyProfileModel,
  companyProfileRevisionModel,
} from './model';
export { CompanyService } from './service';
export type { CompanyDocumentIdentity, CompanyServiceOptions } from './service';
export { brandingRouter, companyRouter } from './router';
export type { CompanyRouterOptions } from './router';
