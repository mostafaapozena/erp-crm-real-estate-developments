import {
  ISSUED_AUDIT_ACTIONS,
  ISSUED_DOCUMENT_PERMISSIONS,
  ISSUED_DOCUMENT_TYPES,
  ISSUED_TEMPLATE_VERSIONS,
  IssuedDocumentSchema,
  PERMISSIONS,
  PublicVerificationSchema,
  VerificationTokenSchema,
  type ActorContext,
  type BusinessDate,
  type DocumentOwnerType,
  type IssueDocument,
  type IssuePreview,
  type IssueWarning,
  type IssuedDocument,
  type IssuedDocumentType,
  type Locale,
  type Permission,
  type PublicVerification,
  type TemplateKind,
  type VerificationResult,
} from '@alola/contracts';
import { createFormatters } from '@alola/i18n';
import {
  assertSafeFilter,
  buildScopeFilter,
  can,
  withScope,
  type Logger,
  type ScopeFieldMap,
} from '@alola/security';
import { createHash, randomBytes } from 'node:crypto';
import type { Connection } from 'mongoose';
import {
  DomainError,
  auditActor,
  conflict,
  isDuplicateKeyError,
  notFound,
  type AuditRecorder,
  type RequestContext,
} from '../../platform/audit-port';
import { newId } from '../../platform/ids';
import { renderPdf } from '../../platform/pdf';
import { withTransaction } from '../../platform/transactions';
import { renderTemplate, type DocumentService, type TemplateService } from '../documents';
import { buildDocument, type CompanyForDocument, type SourceData } from './builders';
import { translator } from './labels';
import { issuedDocumentModel, type IssuedDocumentDocument } from './model';

/**
 * Issued documents (CORE-DOC-003, CORE-DOC-005).
 *
 * Generation reads the source through its owning module's **scoped, field-restricted** read (the
 * `sources` port, wired at the composition root), so a person can only generate what they can read,
 * and a PDF prints only what they may see. What it prints restricted — a buyer's identity — is
 * recorded on the file, and the file is then invisible to anyone who may not see that field
 * (`requiredPermissions` in the documents module). A PDF is never a way around a field restriction.
 *
 * Each generation is a **new version**: the file is stored as the next version of the source's
 * generated document, and the previous issue in the same language is marked superseded in the same
 * transaction as the new row. Nothing issued is ever rewritten.
 */

/** A source record, read for one actor, with everything a document needs about it. */
export interface LoadedSource {
  data: SourceData;
  owner: { type: DocumentOwnerType; id: string };
  businessReference: string;
  placement: {
    legalEntityId: string;
    branchId?: string | undefined;
    departmentId?: string | undefined;
    teamId?: string | undefined;
    projectId?: string | undefined;
    ownerAccountId?: string | undefined;
  };
  warnings: IssueWarning[];
  /** Restricted fields the data carries because this actor may see them. */
  restricted: Permission[];
  validUntil?: BusinessDate;
  /** Where approved wording may come from, and the values its placeholders take. */
  registry?: { kind: TemplateKind; projectId?: string; unitType?: string };
}

export interface IssuanceSources {
  /** Throws not-found when the actor cannot read the source (SEC-030). */
  load(actor: ActorContext, type: IssuedDocumentType, sourceId: string): Promise<LoadedSource>;
}

export interface IssuanceServiceOptions {
  connection: Connection;
  logger: Logger;
  audit: AuditRecorder;
  documents: () => DocumentService;
  templates: () => TemplateService;
  sources: IssuanceSources;
  /** The company as documents print it; `undefined` before a profile exists. */
  company: () => Promise<(CompanyForDocument & { timeZone: string }) | undefined>;
  /** The next customer-statement number, from the existing series. */
  statementNumber: () => Promise<string>;
  /** Origin of the web application: the QR code links to `<origin>/verify/<token>`. */
  publicBaseUrl: string;
  today: () => BusinessDate;
  now?: () => Date;
}

export const ISSUED_SCOPE_FIELDS: ScopeFieldMap = {
  owner: 'ownerAccountId',
  assignee: 'ownerAccountId',
  team: 'teamId',
  department: 'departmentId',
  branch: 'branchId',
  project: 'projectId',
  legalEntity: 'legalEntityId',
};

/** Which registry kind may supply approved wording for each type (CORE-DOC-002). */
const REGISTRY_KIND: Partial<Record<IssuedDocumentType, TemplateKind>> = {
  reservation: 'reservationForm',
  contractSummary: 'contract',
  installmentSchedule: 'installmentSchedule',
  receipt: 'receipt',
  customerStatement: 'customerStatement',
};

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

/** `3F9A-12C4-77B0-E1D2`: the first 64 bits of the content checksum, easy to read aloud. */
function fingerprintOf(contentSha256: string): string {
  return (contentSha256.slice(0, 16).toUpperCase().match(/.{4}/g) ?? []).join('-');
}

export class IssuanceService {
  private readonly issued;
  private readonly now: () => Date;

  constructor(private readonly options: IssuanceServiceOptions) {
    this.issued = issuedDocumentModel(options.connection);
    this.now = options.now ?? (() => new Date());
  }

  /* ---------------------------------------------------------------- access */

  /** The types whose source this actor may read. */
  private readableTypes(actor: ActorContext): IssuedDocumentType[] {
    return ISSUED_DOCUMENT_TYPES.filter((type) =>
      ISSUED_DOCUMENT_PERMISSIONS[type].every((permission) => can(actor, permission)),
    );
  }

  private assertTypeAccess(actor: ActorContext, type: IssuedDocumentType): void {
    if (!this.readableTypes(actor).includes(type)) throw new DomainError('FORBIDDEN');
  }

  /**
   * Scope, readable types and restricted fields — all inside the query (SEC-028, SEC-029). Callers
   * check their raw values with `assertSafeFilter` first; dotted paths are built here, never taken
   * from input.
   */
  private visibleFilter(actor: ActorContext, extra: Record<string, unknown>) {
    const held = PERMISSIONS.filter((permission) => can(actor, permission));
    return {
      $and: [
        withScope(buildScopeFilter(actor, ISSUED_SCOPE_FIELDS), extra),
        { type: { $in: this.readableTypes(actor) } },
        { restricted: { $not: { $elemMatch: { $nin: held } } } },
      ],
    };
  }

  private toIssued(document: IssuedDocumentDocument): IssuedDocument {
    return IssuedDocumentSchema.parse({
      issueId: document.issueId,
      type: document.type,
      source: { type: document.source.type, id: document.source.id },
      businessReference: document.businessReference,
      locale: document.locale,
      version: document.version,
      state: document.state,
      template: {
        key: document.template.key,
        version: document.template.version,
        ...(document.template.registry
          ? {
              registry: {
                templateKey: document.template.registry.templateKey,
                version: document.template.registry.version,
              },
            }
          : {}),
      },
      companyVersion: document.companyVersion,
      documentId: document.documentId,
      documentVersion: document.documentVersion,
      fileSha256: document.fileSha256,
      contentSha256: document.contentSha256,
      fingerprint: document.fingerprint,
      pages: document.pages,
      restricted: document.restricted,
      ...(document.validUntil ? { validUntil: document.validUntil } : {}),
      issuedAt: document.issuedAt.toISOString(),
      issuedBy: document.issuedBy,
      ...(document.supersededAt ? { supersededAt: document.supersededAt.toISOString() } : {}),
      ...(document.supersededByIssueId
        ? { supersededByIssueId: document.supersededByIssueId }
        : {}),
      ...(document.revokedAt ? { revokedAt: document.revokedAt.toISOString() } : {}),
      ...(document.revokedBy ? { revokedBy: document.revokedBy } : {}),
      ...(document.revocationReason ? { revocationReason: document.revocationReason } : {}),
      verificationUrl: this.verificationUrl(document.verificationToken),
    });
  }

  private verificationUrl(token: string): string {
    return `${this.options.publicBaseUrl.replace(/\/+$/, '')}/verify/${token}`;
  }

  private async nextVersions(
    type: IssuedDocumentType,
    sourceId: string,
  ): Promise<Record<Locale, number>> {
    const [ar, en] = await Promise.all(
      (['ar', 'en'] as const).map((locale) =>
        this.issued
          .findOne({ type, 'source.id': sourceId, locale })
          .sort({ version: -1 })
          .lean<IssuedDocumentDocument>()
          .exec(),
      ),
    );
    return { ar: (ar?.version ?? 0) + 1, en: (en?.version ?? 0) + 1 };
  }

  /* ----------------------------------------------------------------- reads */

  /** Safe metadata before generating: nothing from the document body, nothing restricted. */
  async preview(
    actor: ActorContext,
    type: IssuedDocumentType,
    sourceId: string,
  ): Promise<IssuePreview> {
    this.assertTypeAccess(actor, type);
    const source = await this.options.sources.load(actor, type, sourceId);
    const warnings = [...source.warnings];
    const kind = REGISTRY_KIND[type];
    // Only a reservation and a contract carry legal wording; a missing one is worth a warning there.
    if (kind && (type === 'reservation' || type === 'contractSummary')) {
      const template = await this.options.templates().select(kind, {
        on: this.options.today(),
        ...(source.registry?.projectId ? { projectId: source.registry.projectId } : {}),
      });
      if (!template) warnings.push('noApprovedWording');
    }
    return {
      type,
      businessReference: type === 'customerStatement' ? '' : source.businessReference,
      nextVersion: await this.nextVersions(type, sourceId),
      warnings: [...new Set(warnings)],
      restricted: source.restricted,
    };
  }

  async list(
    actor: ActorContext,
    query: { sourceType: string; sourceId: string },
  ): Promise<{ items: IssuedDocument[] }> {
    assertSafeFilter({ sourceType: query.sourceType, sourceId: query.sourceId });
    const rows = await this.issued
      .find(
        this.visibleFilter(actor, { 'source.type': query.sourceType, 'source.id': query.sourceId }),
      )
      .sort({ issuedAt: -1, version: -1 })
      .limit(200)
      .lean<IssuedDocumentDocument[]>()
      .exec();
    return { items: rows.map((row) => this.toIssued(row)) };
  }

  async get(actor: ActorContext, issueId: string): Promise<IssuedDocument> {
    assertSafeFilter({ issueId });
    const row = await this.issued
      .findOne(this.visibleFilter(actor, { issueId }))
      .lean<IssuedDocumentDocument>()
      .exec();
    if (!row) throw notFound();
    return this.toIssued(row);
  }

  /* ---------------------------------------------------------------- writes */

  /**
   * Generate, store and record one document in one language. The file is rendered before anything is
   * written; the stored version, the new row and the superseding of the previous row follow.
   */
  async issue(
    actor: ActorContext,
    input: IssueDocument,
    context: RequestContext,
  ): Promise<IssuedDocument> {
    this.assertTypeAccess(actor, input.type);
    const company = await this.options.company();
    if (!company) throw conflict('COMPANY_PROFILE_REQUIRED', ['type']);
    const source = await this.options.sources.load(actor, input.type, input.sourceId);
    let data = source.data;
    let reference = source.businessReference;
    if (data.type === 'customerStatement') {
      reference = await this.options.statementNumber();
      data = { ...data, statementNumber: reference };
    }

    const issuedAt = this.now();
    const today = this.options.today();
    const locale = input.locale;
    const t = translator(locale);
    const f = createFormatters(locale, { timeZone: company.timeZone });
    const issuedOn = f.businessDate(today);
    const version = (await this.nextVersions(input.type, input.sourceId))[locale];
    const issueId = newId('iss');
    const token = randomBytes(32).toString('base64url');

    // Approved wording, when the client has published it for this kind (CORE-DOC-002).
    const kind = REGISTRY_KIND[input.type];
    const template = kind
      ? await this.options.templates().select(kind, {
          on: today,
          ...(source.registry?.projectId ? { projectId: source.registry.projectId } : {}),
        })
      : undefined;
    const registry = template
      ? {
          body: renderTemplate(template.bodies[locale], {
            'company.legalName': company.legalName[locale],
            'company.tradeName': company.tradeName[locale],
            ...(company.commercialRegistration
              ? { 'company.commercialRegistration': company.commercialRegistration }
              : {}),
            ...(company.taxRegistration
              ? { 'company.taxRegistration': company.taxRegistration }
              : {}),
            ...(company.address ? { 'company.address': company.address[locale] } : {}),
            ...(company.phone ? { 'company.phone': company.phone } : {}),
            ...(company.documentFooter ? { 'company.footer': company.documentFooter[locale] } : {}),
            'document.number': reference,
            'document.date': issuedOn,
          }),
        }
      : undefined;

    // The content checksum covers everything the page says, and the issue it belongs to.
    const contentSha256 = sha256(
      JSON.stringify({
        issueId,
        type: input.type,
        source: input.sourceId,
        reference,
        locale,
        version,
        template: ISSUED_TEMPLATE_VERSIONS[input.type],
        registry: template ? `${template.templateKey}@${template.version}` : null,
        company: company.version,
        data,
      }),
    );
    const fingerprint = fingerprintOf(contentSha256);
    const model = buildDocument(
      {
        locale,
        t,
        f,
        company,
        verification: { url: this.verificationUrl(token), fingerprint },
        issuedAt,
        issuedOn,
        version,
        ...(registry ? { registry } : {}),
      },
      data,
    );
    const rendered = await renderPdf(model);
    const fileSha256 = sha256(rendered.bytes);

    // Store the file: the next version of this source's generated document, or a new document.
    const restricted = [...source.restricted].sort();
    const restrictionKey = restricted.join(',');
    const documents = this.options.documents();
    const previous = await this.issued
      .findOne({ type: input.type, 'source.id': input.sourceId, locale, restrictionKey })
      .sort({ version: -1 })
      .lean<IssuedDocumentDocument>()
      .exec();
    const fileName = `${input.type}-${reference}-${locale}-v${version}.pdf`;
    const file = { bytes: rendered.bytes, declaredType: 'application/pdf' };
    let stored: { documentId: string; version: number } | undefined;
    if (previous) {
      const existing = await documents
        .getDocument(actor, previous.documentId)
        .catch(() => undefined);
      if (existing?.state === 'active') {
        const next = await documents.addVersion(
          actor,
          previous.documentId,
          { fileName, expectedVersion: existing.currentVersion },
          file,
          context,
        );
        stored = { documentId: next.documentId, version: next.currentVersion };
      }
    }
    if (!stored) {
      const created = await documents.upload(
        actor,
        {
          ownerType: source.owner.type,
          ownerId: source.owner.id,
          category: `generated-${input.type}`,
          title: `${t(`pdf.type.${input.type}`)} ${reference}`,
          fileName,
        },
        file,
        context,
        { requiredPermissions: restricted },
      );
      stored = { documentId: created.documentId, version: created.currentVersion };
    }

    try {
      const row = await withTransaction(this.options.connection, async (session) => {
        const [created] = await this.issued.create(
          [
            {
              issueId,
              type: input.type,
              source: { type: source.owner.type, id: input.sourceId },
              businessReference: reference,
              locale,
              version,
              state: 'issued',
              template: {
                key: `builtin:${input.type}`,
                version: ISSUED_TEMPLATE_VERSIONS[input.type],
                ...(template
                  ? { registry: { templateKey: template.templateKey, version: template.version } }
                  : {}),
              },
              companyVersion: company.version,
              companyName: { ar: company.tradeName.ar, en: company.tradeName.en },
              documentId: stored.documentId,
              documentVersion: stored.version,
              fileSha256,
              contentSha256,
              fingerprint,
              pages: rendered.pages,
              restricted,
              restrictionKey,
              ...(source.validUntil ? { validUntil: source.validUntil } : {}),
              verificationToken: token,
              legalEntityId: source.placement.legalEntityId,
              ...(source.placement.branchId ? { branchId: source.placement.branchId } : {}),
              ...(source.placement.departmentId
                ? { departmentId: source.placement.departmentId }
                : {}),
              ...(source.placement.teamId ? { teamId: source.placement.teamId } : {}),
              ...(source.placement.projectId ? { projectId: source.placement.projectId } : {}),
              ...(source.placement.ownerAccountId
                ? { ownerAccountId: source.placement.ownerAccountId }
                : {}),
              issuedAt,
              issuedOn: today,
              issuedBy: actor.accountId,
            },
          ],
          { session },
        );
        if (!created) throw new Error('Issued document insert returned nothing.');
        // Every earlier issue of this document in this language no longer stands.
        const superseded = await this.issued
          .updateMany(
            {
              type: input.type,
              'source.id': input.sourceId,
              locale,
              state: 'issued',
              issueId: { $ne: issueId },
            },
            { $set: { state: 'superseded', supersededAt: issuedAt, supersededByIssueId: issueId } },
            { session },
          )
          .exec();
        await this.options.audit.record(
          {
            action: ISSUED_AUDIT_ACTIONS.issued,
            outcome: 'succeeded',
            actor: auditActor(actor),
            target: { type: 'issuedDocument', id: issueId },
            changes: [
              { path: 'type', to: input.type },
              { path: 'source', to: `${source.owner.type}:${input.sourceId}` },
              { path: 'locale', to: locale },
              { path: 'version', to: String(version) },
              {
                path: 'template',
                to: `builtin:${input.type}@${ISSUED_TEMPLATE_VERSIONS[input.type]}`,
              },
              { path: 'fileSha256', to: fileSha256 },
              { path: 'restricted', to: restrictionKey || 'none' },
            ],
            context,
          },
          { session },
        );
        if (superseded.modifiedCount > 0) {
          await this.options.audit.record(
            {
              action: ISSUED_AUDIT_ACTIONS.superseded,
              outcome: 'succeeded',
              actor: auditActor(actor),
              target: { type: 'issuedDocument', id: issueId },
              reason: `${superseded.modifiedCount} earlier issue(s) superseded by version ${version}`,
              context,
            },
            { session },
          );
        }
        return created.toObject();
      });
      if (template) await this.options.templates().markUsed(template.templateKey, template.version);
      return this.toIssued(row);
    } catch (error) {
      if (isDuplicateKeyError(error)) throw conflict('STALE_VERSION', ['sourceId']);
      throw error;
    }
  }

  /**
   * Revoke an issued document: its verification page reports it revoked from now on. The row, the
   * file and the audit trail stay; revocation is a statement about the document, not its removal.
   */
  async revoke(
    actor: ActorContext,
    issueId: string,
    reason: string,
    context: RequestContext,
  ): Promise<IssuedDocument> {
    const current = await this.get(actor, issueId);
    if (current.state === 'revoked') throw conflict('ALREADY_REVOKED', ['issueId']);
    return withTransaction(this.options.connection, async (session) => {
      const now = this.now();
      const updated = await this.issued
        .findOneAndUpdate(
          { issueId, state: current.state },
          {
            $set: {
              state: 'revoked',
              revokedAt: now,
              revokedBy: actor.accountId,
              revocationReason: reason,
            },
          },
          { returnDocument: 'after', session },
        )
        .lean<IssuedDocumentDocument>()
        .exec();
      if (!updated) throw conflict('STALE_VERSION', ['issueId']);
      await this.options.audit.record(
        {
          action: ISSUED_AUDIT_ACTIONS.revoked,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'issuedDocument', id: issueId },
          changes: [{ path: 'state', from: current.state, to: 'revoked' }],
          reason,
          context,
        },
        { session },
      );
      return this.toIssued(updated);
    });
  }

  /* ---------------------------------------------------------- verification */

  /**
   * The public answer for a scanned QR code (CORE-DOC-005). Anonymous. Reveals only the approved
   * fields; a token that matches nothing — malformed, guessed or forged — gets the same bare
   * `invalid`, so the answer cannot be used to learn anything about what exists.
   *
   * Recorded without the caller's address or browser: a verification is evidence that a document was
   * checked, not a record of who checked it.
   */
  async verify(token: string, correlationId: string): Promise<PublicVerification> {
    const checkedAt = this.now().toISOString();
    const record = async (issueId: string, result: VerificationResult) =>
      this.options.audit.record({
        action: ISSUED_AUDIT_ACTIONS.verified,
        outcome: 'succeeded',
        actor: { kind: 'anonymous' },
        target: { type: 'issuedDocument', id: issueId },
        reason: result,
        context: { correlationId, route: '/api/v1/public/verify/:token', method: 'GET' },
      });
    if (!VerificationTokenSchema.safeParse(token).success) {
      await record('invalid', 'invalid');
      return PublicVerificationSchema.parse({ result: 'invalid', checkedAt });
    }
    const document = await this.issued
      .findOne({ verificationToken: token })
      .lean<IssuedDocumentDocument>()
      .exec();
    if (!document) {
      await record('invalid', 'invalid');
      return PublicVerificationSchema.parse({ result: 'invalid', checkedAt });
    }
    let result: VerificationResult = 'valid';
    if (document.state === 'revoked') result = 'revoked';
    else if (document.state === 'superseded') result = 'superseded';
    else if (document.validUntil && document.validUntil < this.options.today()) result = 'expired';
    await record(document.issueId, result);
    return PublicVerificationSchema.parse({
      result,
      company: document.companyName,
      documentType: document.type,
      businessReference: document.businessReference,
      issuedOn: document.issuedOn,
      version: document.version,
      fingerprint: document.fingerprint,
      checkedAt,
    });
  }
}
