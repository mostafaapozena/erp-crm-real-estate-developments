import { z } from 'zod';
import { BusinessCodeSchema, PhoneSchema } from './identifiers';
import { LocaleSchema, SUPPORTED_LOCALES } from './localized';
import { CurrencyCodeSchema } from './money';
import { InstantSchema, isValidTimeZone } from './time';

/**
 * The deployment's company profile and branding (PLAT-022, PLAT-023, ADR-0027).
 *
 * The product is sold to many real-estate companies, and **each company gets its own deployment**:
 * its own database, keys, storage, domain and provider accounts. Inside one deployment there is
 * therefore exactly one company profile — the identity every screen, printed document and
 * authenticator label uses. It is configuration, not code: changing a company's name, logo or colour
 * never needs a rebuild, and no company's identity is ever written into the product's source.
 *
 * What the profile deliberately does **not** hold:
 *
 * - **Secrets.** No provider credential, token, password, key or bank credential — the schema is
 *   strict, so a request carrying one is refused rather than stored. Secrets are deployment
 *   environment configuration (ADR-0015).
 * - **A tenant identifier.** There is no `tenantId` anywhere: a deployment is one company (ADR-0027).
 * - **Legal entities.** Those are `CORE-ORG` records; a company may operate through several.
 */

/** Labels shown on screens and documents, bounded so a template can lay them out. */
const boundedLabel = (max: number) =>
  z.strictObject({
    ar: z.string().trim().min(1).max(max),
    en: z.string().trim().min(1).max(max),
  });

export const CompanyNameSchema = boundedLabel(200);
export const CompanyShortNameSchema = boundedLabel(40);
/** Multi-line bilingual text: an address, a document footer. */
export const CompanyTextSchema = boundedLabel(600);

export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/, { message: 'ISO_3166_ALPHA2' });

export const CompanyIdentifierSchema = z.strictObject({
  /** A stable code chosen by the deployment, e.g. `VAT`, `CHAMBER`. Never a translated label. */
  kind: BusinessCodeSchema,
  value: z.string().trim().min(1).max(60),
});
export type CompanyIdentifier = z.infer<typeof CompanyIdentifierSchema>;

/** `#RRGGBB`. Contrast is validated by the server against every pair in use (THEME-013). */
export const BrandColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, { message: 'BRAND_COLOR_INVALID' });

export const WebsiteSchema = z
  .string()
  .trim()
  .max(200)
  .regex(/^https:\/\/[^\s/$.?#].[^\s]*$/i, { message: 'HTTPS_URL_EXPECTED' });

export const CompanyEmailSchema = z
  .string()
  .trim()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'EMAIL_EXPECTED' });

export const TimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, { message: 'TIME_ZONE_INVALID' });

const profileFields = {
  legalName: CompanyNameSchema,
  tradeName: CompanyNameSchema,
  /** The name on a narrow screen, in the browser tab and in an authenticator application. */
  shortName: CompanyShortNameSchema,
  commercialRegistration: z.string().trim().min(1).max(60).optional(),
  taxRegistration: z.string().trim().min(1).max(60).optional(),
  otherIdentifiers: z.array(CompanyIdentifierSchema).max(10).default([]),
  address: CompanyTextSchema.optional(),
  country: CountryCodeSchema,
  phone: PhoneSchema.optional(),
  email: CompanyEmailSchema.optional(),
  website: WebsiteSchema.optional(),
  defaultLocale: LocaleSchema,
  supportedLocales: z.array(LocaleSchema).min(1).max(SUPPORTED_LOCALES.length),
  timeZone: TimeZoneSchema,
  baseCurrency: CurrencyCodeSchema,
  primaryColor: BrandColorSchema.optional(),
  /** Printed at the foot of generated documents, in the document's language. */
  documentFooter: CompanyTextSchema.optional(),
};

/** The locale rules every profile obeys: no duplicates, and the default is one of the supported. */
function localesAreCoherent(value: {
  defaultLocale: z.infer<typeof LocaleSchema>;
  supportedLocales: readonly z.infer<typeof LocaleSchema>[];
}): boolean {
  return (
    new Set(value.supportedLocales).size === value.supportedLocales.length &&
    value.supportedLocales.includes(value.defaultLocale)
  );
}

const LOCALES_ISSUE = {
  message: 'DEFAULT_LOCALE_NOT_SUPPORTED',
  path: ['supportedLocales'],
};

export const CompanyProfileInputSchema = z
  .strictObject(profileFields)
  .refine(localesAreCoherent, LOCALES_ISSUE);
export type CompanyProfileInput = z.infer<typeof CompanyProfileInputSchema>;

/** A full replacement of the editable fields, guarded by the version the editor read. */
export const UpdateCompanyProfileSchema = z
  .strictObject({ ...profileFields, expectedVersion: z.number().int().positive() })
  .refine(localesAreCoherent, LOCALES_ISSUE);
export type UpdateCompanyProfile = z.infer<typeof UpdateCompanyProfileSchema>;

export const BRAND_ASSET_SLOTS = ['logo', 'compactLogo', 'favicon'] as const;
export const BrandAssetSlotSchema = z.enum(BRAND_ASSET_SLOTS);
export type BrandAssetSlot = z.infer<typeof BrandAssetSlotSchema>;

export const BRAND_ASSET_TYPES = ['image/png', 'image/jpeg'] as const;

/** A reference to the current image in one slot. The bytes are served by the branding endpoint. */
export const BrandAssetRefSchema = z.strictObject({
  assetId: z.string().min(1).max(80),
  contentType: z.enum(BRAND_ASSET_TYPES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().positive(),
});
export type BrandAssetRef = z.infer<typeof BrandAssetRefSchema>;

export const CompanyProfileSchema = z.strictObject({
  ...profileFields,
  otherIdentifiers: z.array(CompanyIdentifierSchema).max(10),
  assets: z.strictObject({
    logo: BrandAssetRefSchema.optional(),
    compactLogo: BrandAssetRefSchema.optional(),
    favicon: BrandAssetRefSchema.optional(),
  }),
  /** Increments on every change, including a new image. Documents record the version they used. */
  version: z.number().int().positive(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type CompanyProfile = z.infer<typeof CompanyProfileSchema>;

/** One published brand image as the public endpoint describes it. */
export const PublicBrandAssetSchema = z.strictObject({
  /** Relative to the API origin, versioned by content hash so a browser never shows a stale image. */
  url: z.string().min(1),
  contentType: z.enum(BRAND_ASSET_TYPES),
});

/**
 * What any browser may read **before** sign-in: enough to draw the sign-in screen, the shell and the
 * browser tab in the company's identity. Registration numbers, contact details and the footer are not
 * part of it — they are printed on documents, not broadcast to anonymous callers.
 *
 * `configured: false` means no profile exists yet, and the application renders its neutral product
 * identity. It is never an error.
 */
export const PublicBrandingSchema = z.strictObject({
  configured: z.boolean(),
  /**
   * True only on a development or test deployment, which runs fictional demonstration data
   * (ADR-0026). The sign-in screen states it; a client's staging or production deployment never does.
   */
  demonstration: z.boolean(),
  shortName: CompanyShortNameSchema.optional(),
  tradeName: CompanyNameSchema.optional(),
  defaultLocale: LocaleSchema,
  supportedLocales: z.array(LocaleSchema).min(1),
  primaryColor: BrandColorSchema.optional(),
  assets: z.strictObject({
    logo: PublicBrandAssetSchema.optional(),
    compactLogo: PublicBrandAssetSchema.optional(),
    favicon: PublicBrandAssetSchema.optional(),
  }),
  version: z.number().int().nonnegative(),
});
export type PublicBranding = z.infer<typeof PublicBrandingSchema>;

/** One entry of the profile's append-only revision history. */
export const CompanyProfileRevisionSchema = z.strictObject({
  version: z.number().int().positive(),
  changedAt: InstantSchema,
  changedBy: z.string().min(1),
  /** The profile exactly as it stood after this change. */
  profile: CompanyProfileSchema,
});
export type CompanyProfileRevision = z.infer<typeof CompanyProfileRevisionSchema>;

export const CompanyProfileRevisionListSchema = z.strictObject({
  items: z.array(CompanyProfileRevisionSchema),
});

export const COMPANY_AUDIT_ACTIONS = {
  profileCreated: 'company.profile.created',
  profileUpdated: 'company.profile.updated',
  brandAssetUploaded: 'company.brandAsset.uploaded',
} as const;

/** Largest brand image accepted. A logo is displayed small; a larger file is a mistake or an attack. */
export const BRAND_ASSET_MAX_BYTES = 512 * 1024;
