import {
  BRAND_ASSET_MAX_BYTES,
  COMPANY_AUDIT_ACTIONS,
  CompanyProfileRevisionSchema,
  CompanyProfileSchema,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type ActorContext,
  type BrandAssetSlot,
  type CompanyProfile,
  type CompanyProfileInput,
  type CompanyProfileRevision,
  type Locale,
  type PublicBranding,
  type UpdateCompanyProfile,
} from '@alola/contracts';
import { buildChangeSummary, validateUpload } from '@alola/security';
import { validateBrandColor } from '@alola/ui/brand';
import { createHash } from 'node:crypto';
import type { ClientSession, Connection } from 'mongoose';
import {
  DomainError,
  auditActor,
  conflict,
  invalid,
  isDuplicateKeyError,
  notFound,
  type AuditRecorder,
  type RequestContext,
} from '../../platform/audit-port';
import { newId } from '../../platform/ids';
import { withTransaction } from '../../platform/transactions';
import {
  PRIMARY_PROFILE_KEY,
  brandAssetModel,
  companyProfileModel,
  companyProfileRevisionModel,
  type CompanyProfileDocument,
} from './model';

/**
 * The deployment's company profile (PLAT-022) and the branding derived from it (PLAT-023, THEME-013).
 *
 * One profile per deployment, enforced by a unique index rather than by this code (ADR-0027). Every
 * change — including a new logo — raises the version, writes a whole revision and an audit record, and
 * commits all three together: a document issued under version 7 can always be explained with exactly
 * what version 7 said.
 */
export interface CompanyServiceOptions {
  connection: Connection;
  audit: AuditRecorder;
  /** Used for the neutral branding answered before any profile exists. */
  defaultLocale?: Locale;
  /** True on development and test deployments only (ADR-0026). */
  demonstration?: boolean;
  /** The organization timezone, displayed before a profile sets its own (ADR-0008). */
  timeZone?: string;
}

/** What a template needs to print the company on a document (consumed by `CORE-DOC`). */
export interface CompanyDocumentIdentity {
  version: number;
  legalName: { ar: string; en: string };
  tradeName: { ar: string; en: string };
  commercialRegistration?: string;
  taxRegistration?: string;
  address?: { ar: string; en: string };
  phone?: string;
  email?: string;
  website?: string;
  documentFooter?: { ar: string; en: string };
}

/** The contract shape of a stored profile. */
function toProfile(document: CompanyProfileDocument): CompanyProfile {
  return CompanyProfileSchema.parse({
    legalName: document.legalName,
    tradeName: document.tradeName,
    shortName: document.shortName,
    ...(document.commercialRegistration
      ? { commercialRegistration: document.commercialRegistration }
      : {}),
    ...(document.taxRegistration ? { taxRegistration: document.taxRegistration } : {}),
    otherIdentifiers: document.otherIdentifiers.map(({ kind, value }) => ({ kind, value })),
    ...(document.address ? { address: document.address } : {}),
    country: document.country,
    ...(document.phone ? { phone: document.phone } : {}),
    ...(document.email ? { email: document.email } : {}),
    ...(document.website ? { website: document.website } : {}),
    defaultLocale: document.defaultLocale,
    supportedLocales: document.supportedLocales,
    timeZone: document.timeZone,
    baseCurrency: document.baseCurrency,
    ...(document.primaryColor ? { primaryColor: document.primaryColor } : {}),
    ...(document.documentFooter ? { documentFooter: document.documentFooter } : {}),
    assets: Object.fromEntries(
      Object.entries(document.assets ?? {})
        .filter(([, ref]) => ref !== undefined && ref !== null)
        .map(([slot, ref]) => [
          slot,
          {
            assetId: ref.assetId,
            contentType: ref.contentType,
            sha256: ref.sha256,
            size: ref.size,
          },
        ]),
    ),
    version: document.version,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  });
}

/** The editable fields exactly as stored: optional fields absent rather than `undefined`. */
function storedFields(input: CompanyProfileInput, primaryColor: string | undefined) {
  return {
    legalName: input.legalName,
    tradeName: input.tradeName,
    shortName: input.shortName,
    ...(input.commercialRegistration
      ? { commercialRegistration: input.commercialRegistration }
      : {}),
    ...(input.taxRegistration ? { taxRegistration: input.taxRegistration } : {}),
    otherIdentifiers: input.otherIdentifiers,
    ...(input.address ? { address: input.address } : {}),
    country: input.country,
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.email ? { email: input.email } : {}),
    ...(input.website ? { website: input.website } : {}),
    defaultLocale: input.defaultLocale,
    supportedLocales: input.supportedLocales,
    timeZone: input.timeZone,
    baseCurrency: input.baseCurrency,
    ...(primaryColor ? { primaryColor } : {}),
    ...(input.documentFooter ? { documentFooter: input.documentFooter } : {}),
  };
}

const OPTIONAL_FIELDS = [
  'commercialRegistration',
  'taxRegistration',
  'address',
  'phone',
  'email',
  'website',
  'primaryColor',
  'documentFooter',
] as const;

/** The fields an audit summary compares. Images are summarized by hash, never by content. */
function summaryOf(profile: CompanyProfile | undefined): Record<string, unknown> | undefined {
  if (!profile) return undefined;
  return {
    legalName: profile.legalName,
    tradeName: profile.tradeName,
    shortName: profile.shortName,
    commercialRegistration: profile.commercialRegistration,
    taxRegistration: profile.taxRegistration,
    country: profile.country,
    defaultLocale: profile.defaultLocale,
    supportedLocales: profile.supportedLocales.join(','),
    timeZone: profile.timeZone,
    baseCurrency: profile.baseCurrency,
    primaryColor: profile.primaryColor,
    logo: profile.assets.logo?.sha256,
    compactLogo: profile.assets.compactLogo?.sha256,
    favicon: profile.assets.favicon?.sha256,
  };
}

export class CompanyService {
  private readonly profiles;
  private readonly revisions;
  private readonly assets;

  constructor(private readonly options: CompanyServiceOptions) {
    this.profiles = companyProfileModel(options.connection);
    this.revisions = companyProfileRevisionModel(options.connection);
    this.assets = brandAssetModel(options.connection);
  }

  /* --------------------------------------------------------------- reads */

  async getProfile(): Promise<CompanyProfile | undefined> {
    const document = await this.profiles
      .findOne({ profileKey: PRIMARY_PROFILE_KEY })
      .lean<CompanyProfileDocument>()
      .exec();
    return document ? toProfile(document) : undefined;
  }

  async requireProfile(): Promise<CompanyProfile> {
    const profile = await this.getProfile();
    if (!profile) throw notFound();
    return profile;
  }

  async listRevisions(limit = 50): Promise<CompanyProfileRevision[]> {
    const rows = await this.revisions
      .find({})
      .sort({ version: -1 })
      .limit(Math.min(Math.max(limit, 1), 200))
      .lean()
      .exec();
    return rows.map((row) =>
      CompanyProfileRevisionSchema.parse({
        version: row.version,
        changedAt: row.changedAt.toISOString(),
        changedBy: row.changedBy,
        profile: row.profile,
      }),
    );
  }

  /**
   * The public branding every browser reads before sign-in. With no profile yet it answers the neutral
   * product identity (`configured: false`) — never an error, and never another company's name.
   */
  async publicBranding(): Promise<PublicBranding> {
    const profile = await this.getProfile();
    if (!profile) {
      return {
        configured: false,
        demonstration: this.options.demonstration ?? false,
        defaultLocale: this.options.defaultLocale ?? DEFAULT_LOCALE,
        supportedLocales: [...SUPPORTED_LOCALES],
        timeZone: this.options.timeZone ?? 'UTC',
        assets: {},
        version: 0,
      };
    }
    const assets: PublicBranding['assets'] = {};
    for (const [slot, ref] of Object.entries(profile.assets) as [
      BrandAssetSlot,
      NonNullable<CompanyProfile['assets'][BrandAssetSlot]>,
    ][]) {
      // Versioned by content hash, so a replaced logo is fetched again and an unchanged one is cached.
      assets[slot] = {
        url: `/api/v1/branding/assets/${slot}?v=${ref.sha256.slice(0, 16)}`,
        contentType: ref.contentType,
      };
    }
    return {
      configured: true,
      demonstration: this.options.demonstration ?? false,
      shortName: profile.shortName,
      tradeName: profile.tradeName,
      defaultLocale: profile.defaultLocale,
      supportedLocales: profile.supportedLocales,
      timeZone: profile.timeZone,
      ...(profile.primaryColor ? { primaryColor: profile.primaryColor } : {}),
      assets,
      version: profile.version,
    };
  }

  /** The current image in a slot, for the public branding endpoint. */
  async activeAsset(
    slot: BrandAssetSlot,
  ): Promise<{ contentType: string; data: Buffer; sha256: string } | undefined> {
    const asset = await this.assets.findOne({ slot, state: 'active' }).lean().exec();
    if (!asset) return undefined;
    const data = Buffer.isBuffer(asset.data)
      ? asset.data
      : Buffer.from((asset.data as unknown as { buffer: ArrayBuffer }).buffer);
    return { contentType: asset.contentType, data, sha256: asset.sha256 };
  }

  /**
   * The name an authenticator application shows next to the account (SEC-017). The deployment's short
   * English name when configured — authenticator applications render Latin text reliably — otherwise
   * `undefined`, and identity falls back to its configured neutral issuer.
   */
  async authenticatorIssuer(): Promise<string | undefined> {
    const profile = await this.getProfile();
    return profile?.shortName.en;
  }

  /** The company as a document prints it. `CORE-DOC` templates read this, never the raw collection. */
  async documentIdentity(): Promise<CompanyDocumentIdentity | undefined> {
    const profile = await this.getProfile();
    if (!profile) return undefined;
    return {
      version: profile.version,
      legalName: profile.legalName,
      tradeName: profile.tradeName,
      ...(profile.commercialRegistration
        ? { commercialRegistration: profile.commercialRegistration }
        : {}),
      ...(profile.taxRegistration ? { taxRegistration: profile.taxRegistration } : {}),
      ...(profile.address ? { address: profile.address } : {}),
      ...(profile.phone ? { phone: profile.phone } : {}),
      ...(profile.email ? { email: profile.email } : {}),
      ...(profile.website ? { website: profile.website } : {}),
      ...(profile.documentFooter ? { documentFooter: profile.documentFooter } : {}),
    };
  }

  /* -------------------------------------------------------------- writes */

  /** THEME-013: a colour that fails any contrast pair in use is refused before anything is written. */
  private checkedColor(input: string | undefined): string | undefined {
    if (input === undefined) return undefined;
    const result = validateBrandColor(input);
    if (!result.ok) throw invalid(result.reason, ['primaryColor']);
    return result.primary;
  }

  private async appendRevision(
    profile: CompanyProfile,
    actor: ActorContext,
    session: ClientSession,
  ): Promise<void> {
    await this.revisions.create(
      [
        {
          revisionId: newId('cpr'),
          version: profile.version,
          changedAt: new Date(profile.updatedAt),
          changedBy: actor.accountId,
          profile,
        },
      ],
      { session },
    );
  }

  /**
   * Create the deployment's profile. Refused once one exists — a deployment is one company, and
   * replacing its identity is an update with its own version and history, never a second profile.
   */
  async createProfile(
    actor: ActorContext,
    input: CompanyProfileInput,
    context: RequestContext,
  ): Promise<CompanyProfile> {
    const primaryColor = this.checkedColor(input.primaryColor);
    try {
      return await withTransaction(this.options.connection, async (session) => {
        const now = new Date();
        const [created] = await this.profiles.create(
          [
            {
              profileKey: PRIMARY_PROFILE_KEY,
              ...storedFields(input, primaryColor),
              assets: {},
              version: 1,
              createdAt: now,
              updatedAt: now,
              updatedBy: actor.accountId,
            },
          ],
          { session },
        );
        if (!created) throw new Error('Profile insert returned no document.');
        const profile = toProfile(created.toObject());
        await this.appendRevision(profile, actor, session);
        await this.options.audit.record(
          {
            action: COMPANY_AUDIT_ACTIONS.profileCreated,
            outcome: 'succeeded',
            actor: auditActor(actor),
            target: { type: 'companyProfile', id: PRIMARY_PROFILE_KEY },
            changes: buildChangeSummary(undefined, summaryOf(profile)),
            context,
          },
          { session },
        );
        return profile;
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) throw conflict('PROFILE_EXISTS');
      throw error;
    }
  }

  /**
   * Replace the editable fields, guarded by the version the editor read. A stale version is a conflict
   * and changes nothing; an absent optional field is removed, because the request is the whole profile.
   */
  async updateProfile(
    actor: ActorContext,
    input: UpdateCompanyProfile,
    context: RequestContext,
  ): Promise<CompanyProfile> {
    const primaryColor = this.checkedColor(input.primaryColor);
    const { expectedVersion, ...fields } = input;
    return withTransaction(this.options.connection, async (session) => {
      const before = await this.profiles
        .findOne({ profileKey: PRIMARY_PROFILE_KEY })
        .session(session)
        .lean<CompanyProfileDocument>()
        .exec();
      if (!before) throw notFound();
      if (before.version !== expectedVersion) throw conflict('STALE_VERSION', ['expectedVersion']);

      const set = { ...storedFields(fields, primaryColor) };
      const unset = Object.fromEntries(
        OPTIONAL_FIELDS.filter((field) => !(field in set)).map((field) => [field, 1]),
      );
      const updated = await this.profiles
        .findOneAndUpdate(
          { profileKey: PRIMARY_PROFILE_KEY, version: expectedVersion },
          {
            $set: { ...set, updatedAt: new Date(), updatedBy: actor.accountId },
            ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
            $inc: { version: 1 },
          },
          { returnDocument: 'after', session, runValidators: true },
        )
        .lean<CompanyProfileDocument>()
        .exec();
      if (!updated) throw conflict('STALE_VERSION', ['expectedVersion']);

      const profile = toProfile(updated);
      await this.appendRevision(profile, actor, session);
      await this.options.audit.record(
        {
          action: COMPANY_AUDIT_ACTIONS.profileUpdated,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'companyProfile', id: PRIMARY_PROFILE_KEY },
          changes: buildChangeSummary(summaryOf(toProfile(before)), summaryOf(profile)),
          context,
        },
        { session },
      );
      return profile;
    });
  }

  /**
   * Replace the image in one slot. The bytes are checked against their magic numbers (SEC-005); the
   * declared type is never trusted. The previous image is superseded, not deleted, and the profile's
   * version rises so every cached copy of the branding refreshes.
   */
  async uploadAsset(
    actor: ActorContext,
    slot: BrandAssetSlot,
    file: { bytes: Uint8Array; declaredType: string },
    context: RequestContext,
  ): Promise<CompanyProfile> {
    const check = validateUpload(file, {
      maxBytes: BRAND_ASSET_MAX_BYTES,
      allowedTypes: ['image/png', 'image/jpeg'],
    });
    if (!check.ok) throw invalid(check.reason, ['file']);
    const contentType = check.contentType as 'image/png' | 'image/jpeg';
    const sha256 = createHash('sha256').update(file.bytes).digest('hex');
    const data = Buffer.from(file.bytes);

    return withTransaction(this.options.connection, async (session) => {
      const before = await this.profiles
        .findOne({ profileKey: PRIMARY_PROFILE_KEY })
        .session(session)
        .lean<CompanyProfileDocument>()
        .exec();
      if (!before) throw notFound();

      await this.assets
        .updateMany({ slot, state: 'active' }, { $set: { state: 'superseded' } }, { session })
        .exec();
      const assetId = newId('brand');
      const now = new Date();
      await this.assets.create(
        [
          {
            assetId,
            slot,
            contentType,
            data,
            size: data.byteLength,
            sha256,
            scanStatus: 'not_scanned',
            state: 'active',
            uploadedAt: now,
            uploadedBy: actor.accountId,
          },
        ],
        { session },
      );
      const updated = await this.profiles
        .findOneAndUpdate(
          { profileKey: PRIMARY_PROFILE_KEY, version: before.version },
          {
            $set: {
              [`assets.${slot}`]: { assetId, contentType, sha256, size: data.byteLength },
              updatedAt: now,
              updatedBy: actor.accountId,
            },
            $inc: { version: 1 },
          },
          { returnDocument: 'after', session },
        )
        .lean<CompanyProfileDocument>()
        .exec();
      if (!updated) throw conflict('STALE_VERSION');

      const profile = toProfile(updated);
      await this.appendRevision(profile, actor, session);
      await this.options.audit.record(
        {
          action: COMPANY_AUDIT_ACTIONS.brandAssetUploaded,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'brandAsset', id: assetId },
          changes: [
            {
              path: slot,
              ...(before.assets?.[slot]?.sha256 ? { from: before.assets[slot].sha256 } : {}),
              to: sha256,
            },
          ],
          context,
        },
        { session },
      );
      return profile;
    });
  }
}

export { DomainError };
