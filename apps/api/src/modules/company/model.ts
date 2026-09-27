import { BRAND_ASSET_SLOTS, BRAND_ASSET_TYPES, SUPPORTED_LOCALES } from '@alola/contracts';
import { Schema, type Connection, type Model } from 'mongoose';

/**
 * Company profile storage (PLAT-022, PLAT-023, ADR-0027).
 *
 * Three collections:
 *
 * - `companyProfiles` — **exactly one** document per deployment, keyed `primary` under a unique index.
 *   There is no tenant identifier and never will be: a deployment is one company.
 * - `companyProfileRevisions` — the profile as it stood after every change. **Append-only**: a document
 *   generated last year must be explainable with the legal name it was issued under.
 * - `brandAssets` — the images, small enough (≤ 512 KiB) to live beside the profile rather than in
 *   object storage. A replaced image is marked `superseded`, never deleted.
 *
 * None of them can be deleted through the model (ADR-0009).
 */
export const COMPANY_PROFILES_COLLECTION = 'companyProfiles';
export const COMPANY_PROFILE_REVISIONS_COLLECTION = 'companyProfileRevisions';
export const BRAND_ASSETS_COLLECTION = 'brandAssets';

/** The one key a profile may have. Declared so the unique index states the rule in the database. */
export const PRIMARY_PROFILE_KEY = 'primary';

export class CompanyRecordImmutableError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly operation: string) {
    super(`Company records are never deleted or rewritten: "${operation}" is refused (ADR-0009).`);
    this.name = 'CompanyRecordImmutableError';
  }
}

interface Localized {
  ar: string;
  en: string;
}

export interface StoredAssetRef {
  assetId: string;
  contentType: (typeof BRAND_ASSET_TYPES)[number];
  sha256: string;
  size: number;
}

export interface CompanyProfileDocument {
  profileKey: typeof PRIMARY_PROFILE_KEY;
  legalName: Localized;
  tradeName: Localized;
  shortName: Localized;
  commercialRegistration?: string;
  taxRegistration?: string;
  otherIdentifiers: { kind: string; value: string }[];
  address?: Localized;
  country: string;
  phone?: string;
  email?: string;
  website?: string;
  defaultLocale: (typeof SUPPORTED_LOCALES)[number];
  supportedLocales: (typeof SUPPORTED_LOCALES)[number][];
  timeZone: string;
  baseCurrency: string;
  primaryColor?: string;
  documentFooter?: Localized;
  assets: Partial<Record<(typeof BRAND_ASSET_SLOTS)[number], StoredAssetRef>>;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string;
}

export interface CompanyProfileRevisionDocument {
  revisionId: string;
  version: number;
  changedAt: Date;
  changedBy: string;
  /** The contract-shaped profile after the change, stored whole so history needs no reconstruction. */
  profile: Record<string, unknown>;
}

export interface BrandAssetDocument {
  assetId: string;
  slot: (typeof BRAND_ASSET_SLOTS)[number];
  contentType: (typeof BRAND_ASSET_TYPES)[number];
  data: Buffer;
  size: number;
  sha256: string;
  /** `not_scanned` until a malware scanner is configured (SEC-005); PNG and JPEG only, by magic bytes. */
  scanStatus: 'not_scanned' | 'clean';
  state: 'active' | 'superseded';
  uploadedAt: Date;
  uploadedBy: string;
}

const DELETE_OPS = ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const;
const REWRITE_OPS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
] as const;

function refuse<T>(schema: Schema<T>, operations: readonly string[]): Schema<T> {
  for (const operation of operations) {
    schema.pre(operation as 'deleteOne', function refuseOperation() {
      throw new CompanyRecordImmutableError(operation);
    });
  }
  return schema;
}

const localized = new Schema<Localized>(
  { ar: { type: String, required: true }, en: { type: String, required: true } },
  { _id: false },
);

const assetRef = new Schema<StoredAssetRef>(
  {
    assetId: { type: String, required: true },
    contentType: { type: String, required: true, enum: [...BRAND_ASSET_TYPES] },
    sha256: { type: String, required: true },
    size: { type: Number, required: true },
  },
  { _id: false },
);

const identifier = new Schema(
  { kind: { type: String, required: true }, value: { type: String, required: true } },
  { _id: false },
);

function profileSchema(): Schema<CompanyProfileDocument> {
  const schema = new Schema<CompanyProfileDocument>(
    {
      profileKey: {
        type: String,
        required: true,
        immutable: true,
        enum: [PRIMARY_PROFILE_KEY],
      },
      legalName: { type: localized, required: true },
      tradeName: { type: localized, required: true },
      shortName: { type: localized, required: true },
      commercialRegistration: { type: String },
      taxRegistration: { type: String },
      otherIdentifiers: { type: [identifier], default: [] },
      address: { type: localized },
      country: { type: String, required: true },
      phone: { type: String },
      email: { type: String },
      website: { type: String },
      defaultLocale: { type: String, required: true, enum: [...SUPPORTED_LOCALES] },
      supportedLocales: { type: [String], required: true, enum: [...SUPPORTED_LOCALES] },
      timeZone: { type: String, required: true },
      baseCurrency: { type: String, required: true },
      primaryColor: { type: String },
      documentFooter: { type: localized },
      assets: {
        type: new Schema(
          {
            logo: { type: assetRef },
            compactLogo: { type: assetRef },
            favicon: { type: assetRef },
          },
          { _id: false },
        ),
        required: true,
        default: {},
      },
      version: { type: Number, required: true },
      createdAt: { type: Date, required: true, immutable: true },
      updatedAt: { type: Date, required: true },
      updatedBy: { type: String, required: true },
    },
    {
      collection: COMPANY_PROFILES_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
      minimize: false,
    },
  );
  // Exactly one profile per deployment: the database refuses a second, whatever races to create it.
  schema.index({ profileKey: 1 }, { unique: true, name: 'companyProfiles_key_unique' });
  return refuse(schema, DELETE_OPS);
}

function revisionSchema(): Schema<CompanyProfileRevisionDocument> {
  const schema = new Schema<CompanyProfileRevisionDocument>(
    {
      revisionId: { type: String, required: true, immutable: true },
      version: { type: Number, required: true, immutable: true },
      changedAt: { type: Date, required: true, immutable: true },
      changedBy: { type: String, required: true, immutable: true },
      profile: { type: Schema.Types.Mixed, required: true, immutable: true },
    },
    {
      collection: COMPANY_PROFILE_REVISIONS_COLLECTION,
      strict: 'throw',
      versionKey: false,
      timestamps: false,
      // A snapshot is stored exactly: an empty `assets` object is part of the profile, not noise.
      minimize: false,
    },
  );
  schema.index({ revisionId: 1 }, { unique: true, name: 'companyProfileRevisions_id_unique' });
  // One revision per version: two concurrent edits can never both record themselves as version N.
  schema.index({ version: 1 }, { unique: true, name: 'companyProfileRevisions_version_unique' });
  return refuse(schema, [...DELETE_OPS, ...REWRITE_OPS]);
}

function brandAssetSchema(): Schema<BrandAssetDocument> {
  const schema = new Schema<BrandAssetDocument>(
    {
      assetId: { type: String, required: true, immutable: true },
      slot: { type: String, required: true, immutable: true, enum: [...BRAND_ASSET_SLOTS] },
      contentType: {
        type: String,
        required: true,
        immutable: true,
        enum: [...BRAND_ASSET_TYPES],
      },
      data: { type: Buffer, required: true, immutable: true },
      size: { type: Number, required: true, immutable: true },
      sha256: { type: String, required: true, immutable: true },
      scanStatus: { type: String, required: true, enum: ['not_scanned', 'clean'] },
      state: { type: String, required: true, enum: ['active', 'superseded'] },
      uploadedAt: { type: Date, required: true, immutable: true },
      uploadedBy: { type: String, required: true, immutable: true },
    },
    { collection: BRAND_ASSETS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  schema.index({ assetId: 1 }, { unique: true, name: 'brandAssets_id_unique' });
  // One active image per slot; superseded images stay as history.
  schema.index(
    { slot: 1 },
    {
      unique: true,
      name: 'brandAssets_slot_active_unique',
      partialFilterExpression: { state: 'active' },
    },
  );
  schema.index({ slot: 1, uploadedAt: -1 }, { name: 'brandAssets_slot_history' });
  return refuse(schema, DELETE_OPS);
}

function model<T>(connection: Connection, name: string, build: () => Schema<T>): Model<T> {
  return (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, build());
}

export function companyProfileModel(connection: Connection): Model<CompanyProfileDocument> {
  return model(connection, COMPANY_PROFILES_COLLECTION, profileSchema);
}

export function companyProfileRevisionModel(
  connection: Connection,
): Model<CompanyProfileRevisionDocument> {
  return model(connection, COMPANY_PROFILE_REVISIONS_COLLECTION, revisionSchema);
}

export function brandAssetModel(connection: Connection): Model<BrandAssetDocument> {
  return model(connection, BRAND_ASSETS_COLLECTION, brandAssetSchema);
}
