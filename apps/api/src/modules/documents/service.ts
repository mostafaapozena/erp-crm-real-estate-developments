import {
  BusinessDocumentSchema,
  DOCUMENT_AUDIT_ACTIONS,
  DOCUMENT_CONTENT_TYPES,
  DownloadLinkSchema,
  type ActorContext,
  type BusinessDate,
  type BusinessDocument,
  type DocumentOwnerType,
  type DownloadLink,
  type UploadDocumentQuery,
} from '@alola/contracts';
import {
  MAX_SIGNED_URL_TTL_SECONDS,
  assertSafeFilter,
  buildScopeFilter,
  sanitizeFileName,
  validateUpload,
  withScope,
  type MalwareScanner,
  type PrivateFileStore,
  type ScopeFieldMap,
} from '@alola/security';
import { createHash, randomBytes } from 'node:crypto';
import type { Connection } from 'mongoose';
import {
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
  documentModel,
  documentVersionModel,
  type DocumentDocument,
  type DocumentVersionDocument,
} from './model';

/**
 * Documents attached to business records (CORE-DOC-004, CORE-DOC-006; SEC-005, SEC-008).
 *
 * **A document is as visible as the record it belongs to.** Uploading one asks the owning module —
 * through a port wired at the composition root — for that record *as the actor sees it*; a record
 * outside the actor's scope is answered `404`, and the document inherits the record's scope fields,
 * so every later list and read is scoped inside the query like any other record (SEC-027).
 *
 * A download is a short-lived signed link issued to an authorized actor, and **issuing it is the
 * audited act** — who downloaded or printed which version, when (CORE-DOC-006). The link itself
 * carries no identity; it expires within minutes.
 */

/** Where the owning record sits in the organization, as the owning module reports it. */
export interface OwnerPlacement {
  legalEntityId: string;
  branchId?: string | undefined;
  departmentId?: string | undefined;
  teamId?: string | undefined;
  projectId?: string | undefined;
  ownerAccountId?: string | undefined;
}

/**
 * Resolve an owning record **as the actor sees it**. Throws a not-found error — or returns
 * `undefined` — when the record is absent or outside the actor's scope; never returns someone else's.
 */
export type OwnerResolver = (
  actor: ActorContext,
  type: DocumentOwnerType,
  id: string,
) => Promise<OwnerPlacement | undefined>;

export interface DocumentServiceOptions {
  connection: Connection;
  audit: AuditRecorder;
  store: PrivateFileStore;
  scanner: MalwareScanner;
  resolveOwner: OwnerResolver;
  maxBytes: number;
  /** Lifetime of a download link; at most `MAX_SIGNED_URL_TTL_SECONDS`. */
  linkTtlSeconds?: number;
  now?: () => Date;
}

export const DOCUMENT_SCOPE_FIELDS: ScopeFieldMap = {
  owner: 'createdBy',
  assignee: 'ownerAccountId',
  team: 'teamId',
  department: 'departmentId',
  branch: 'branchId',
  project: 'projectId',
  legalEntity: 'legalEntityId',
};

const iso = (date: Date) => date.toISOString();

function toDocument(
  document: DocumentDocument,
  versions: DocumentVersionDocument[],
): BusinessDocument {
  return BusinessDocumentSchema.parse({
    documentId: document.documentId,
    owner: { type: document.owner.type, id: document.owner.id },
    category: document.category,
    title: document.title,
    state: document.state,
    currentVersion: document.currentVersion,
    versions: versions
      .sort((a, b) => b.version - a.version)
      .map((version) => ({
        version: version.version,
        fileName: version.fileName,
        contentType: version.contentType,
        size: version.size,
        sha256: version.sha256,
        scanStatus: version.scanStatus,
        uploadedAt: iso(version.uploadedAt),
        uploadedBy: version.uploadedBy,
      })),
    ...(document.retainUntil ? { retainUntil: document.retainUntil } : {}),
    legalHold: document.legalHold,
    createdAt: iso(document.createdAt),
    updatedAt: iso(document.updatedAt),
  });
}

export class DocumentService {
  private readonly documents;
  private readonly versions;
  private readonly now: () => Date;
  private readonly linkTtl: number;

  constructor(private readonly options: DocumentServiceOptions) {
    this.documents = documentModel(options.connection);
    this.versions = documentVersionModel(options.connection);
    this.now = options.now ?? (() => new Date());
    this.linkTtl = Math.min(options.linkTtlSeconds ?? 120, MAX_SIGNED_URL_TTL_SECONDS);
  }

  /* ---------------------------------------------------------------- helpers */

  /** Validate, scan and store the bytes. Returns what a version row records. */
  private async acceptFile(
    documentId: string,
    version: number,
    file: { bytes: Uint8Array; declaredType: string; fileName: string },
    actor: ActorContext,
    context: RequestContext,
  ) {
    const check = validateUpload(
      { bytes: file.bytes, declaredType: file.declaredType },
      { maxBytes: this.options.maxBytes, allowedTypes: [...DOCUMENT_CONTENT_TYPES] },
    );
    if (!check.ok) throw invalid(check.reason, ['file']);
    const scan = await this.options.scanner.scan(file.bytes);
    if (scan.status === 'infected') {
      // Nothing infected is stored. The refusal itself is evidence, so it is recorded.
      await this.options.audit.record({
        action: DOCUMENT_AUDIT_ACTIONS.quarantined,
        outcome: 'denied',
        actor: auditActor(actor),
        target: { type: 'document', id: documentId },
        reason: 'malware scanner reported the file as infected',
        context,
      });
      throw invalid('FILE_INFECTED', ['file']);
    }
    const storageKey = `documents/${documentId}/v${version}-${randomBytes(8).toString('hex')}`;
    await this.options.store.put({
      key: storageKey,
      body: file.bytes,
      contentType: check.contentType,
    });
    return {
      storageKey,
      fileName: sanitizeFileName(file.fileName, check.contentType),
      contentType: check.contentType,
      size: file.bytes.byteLength,
      sha256: createHash('sha256').update(file.bytes).digest('hex'),
      scanStatus: scan.status,
    };
  }

  private scopedFilter(actor: ActorContext, extra: Record<string, unknown> = {}) {
    assertSafeFilter(extra);
    return withScope(buildScopeFilter(actor, DOCUMENT_SCOPE_FIELDS), extra);
  }

  private async findScoped(actor: ActorContext, documentId: string): Promise<DocumentDocument> {
    const document = await this.documents
      .findOne(this.scopedFilter(actor, { documentId }))
      .lean<DocumentDocument>()
      .exec();
    if (!document) throw notFound();
    return document;
  }

  private async versionsOf(documentIds: string[]): Promise<Map<string, DocumentVersionDocument[]>> {
    const rows = await this.versions
      .find({ documentId: { $in: documentIds } })
      .lean<DocumentVersionDocument[]>()
      .exec();
    const byDocument = new Map<string, DocumentVersionDocument[]>();
    for (const row of rows) {
      byDocument.set(row.documentId, [...(byDocument.get(row.documentId) ?? []), row]);
    }
    return byDocument;
  }

  /* ------------------------------------------------------------------ reads */

  async getDocument(actor: ActorContext, documentId: string): Promise<BusinessDocument> {
    const document = await this.findScoped(actor, documentId);
    return toDocument(document, (await this.versionsOf([documentId])).get(documentId) ?? []);
  }

  async listDocuments(
    actor: ActorContext,
    query: {
      ownerType?: DocumentOwnerType;
      ownerId?: string;
      includeArchived?: boolean;
      limit: number;
      cursor?: string;
    },
  ): Promise<{ items: BusinessDocument[]; nextCursor?: string }> {
    // Values are checked as plain fields; the dotted paths are built here, never taken from input.
    assertSafeFilter({
      ...(query.ownerType ? { ownerType: query.ownerType } : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
    });
    const requested: Record<string, unknown> = {};
    if (query.ownerType) requested['owner.type'] = query.ownerType;
    if (query.ownerId) requested['owner.id'] = query.ownerId;
    if (!query.includeArchived) requested['state'] = 'active';
    let filter: Record<string, unknown> = withScope(
      buildScopeFilter(actor, DOCUMENT_SCOPE_FIELDS),
      requested,
    );
    if (query.cursor) {
      const [time, id] = Buffer.from(query.cursor, 'base64url').toString('utf8').split('|');
      const at = time ? new Date(time) : undefined;
      if (!at || Number.isNaN(at.getTime()) || !id) throw invalid('CURSOR_INVALID', ['cursor']);
      filter = {
        $and: [
          filter,
          { $or: [{ updatedAt: { $lt: at } }, { updatedAt: at, documentId: { $lt: id } }] },
        ],
      };
    }
    const rows = await this.documents
      .find(filter)
      .sort({ updatedAt: -1, documentId: -1 })
      .limit(query.limit + 1)
      .lean<DocumentDocument[]>()
      .exec();
    const page = rows.slice(0, query.limit);
    const versions = await this.versionsOf(page.map((row) => row.documentId));
    const last = page.at(-1);
    return {
      items: page.map((row) => toDocument(row, versions.get(row.documentId) ?? [])),
      ...(rows.length > query.limit && last
        ? {
            nextCursor: Buffer.from(`${iso(last.updatedAt)}|${last.documentId}`, 'utf8').toString(
              'base64url',
            ),
          }
        : {}),
    };
  }

  /* ----------------------------------------------------------------- writes */

  /**
   * Attach a new document to a record. The record is looked up **as the actor sees it**: outside the
   * actor's scope it does not exist, and nothing is stored.
   */
  async upload(
    actor: ActorContext,
    input: UploadDocumentQuery,
    file: { bytes: Uint8Array; declaredType: string },
    context: RequestContext,
  ): Promise<BusinessDocument> {
    const owner = await this.options.resolveOwner(actor, input.ownerType, input.ownerId);
    if (!owner) throw notFound();
    const documentId = newId('doc');
    const accepted = await this.acceptFile(
      documentId,
      1,
      { ...file, fileName: input.fileName },
      actor,
      context,
    );
    return withTransaction(this.options.connection, async (session) => {
      const now = this.now();
      const [created] = await this.documents.create(
        [
          {
            documentId,
            owner: { type: input.ownerType, id: input.ownerId },
            category: input.category,
            title: input.title,
            legalEntityId: owner.legalEntityId,
            ...(owner.branchId ? { branchId: owner.branchId } : {}),
            ...(owner.departmentId ? { departmentId: owner.departmentId } : {}),
            ...(owner.teamId ? { teamId: owner.teamId } : {}),
            ...(owner.projectId ? { projectId: owner.projectId } : {}),
            ...(owner.ownerAccountId ? { ownerAccountId: owner.ownerAccountId } : {}),
            createdBy: actor.accountId,
            state: 'active',
            currentVersion: 1,
            legalHold: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
        { session },
      );
      const [version] = await this.versions.create(
        [{ documentId, version: 1, ...accepted, uploadedAt: now, uploadedBy: actor.accountId }],
        { session },
      );
      if (!created || !version) throw new Error('Document insert returned nothing.');
      await this.options.audit.record(
        {
          action: DOCUMENT_AUDIT_ACTIONS.uploaded,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'document', id: documentId },
          changes: [
            { path: 'owner', to: `${input.ownerType}:${input.ownerId}` },
            { path: 'category', to: input.category },
            { path: 'sha256', to: accepted.sha256 },
            { path: 'scanStatus', to: accepted.scanStatus },
          ],
          context,
        },
        { session },
      );
      return toDocument(created.toObject(), [version.toObject()]);
    });
  }

  /** A new file for an existing document. The previous versions are kept (CORE-DOC-004). */
  async addVersion(
    actor: ActorContext,
    documentId: string,
    input: { fileName: string; expectedVersion: number },
    file: { bytes: Uint8Array; declaredType: string },
    context: RequestContext,
  ): Promise<BusinessDocument> {
    const current = await this.findScoped(actor, documentId);
    if (current.state !== 'active') throw conflict('DOCUMENT_NOT_ACTIVE', ['state']);
    if (current.currentVersion !== input.expectedVersion) {
      throw conflict('STALE_VERSION', ['expectedVersion']);
    }
    const next = input.expectedVersion + 1;
    const accepted = await this.acceptFile(
      documentId,
      next,
      { ...file, fileName: input.fileName },
      actor,
      context,
    );
    try {
      return await withTransaction(this.options.connection, async (session) => {
        const now = this.now();
        const updated = await this.documents
          .findOneAndUpdate(
            { documentId, currentVersion: input.expectedVersion, state: 'active' },
            { $set: { currentVersion: next, updatedAt: now } },
            { returnDocument: 'after', session },
          )
          .lean<DocumentDocument>()
          .exec();
        if (!updated) throw conflict('STALE_VERSION', ['expectedVersion']);
        await this.versions.create(
          [
            {
              documentId,
              version: next,
              ...accepted,
              uploadedAt: now,
              uploadedBy: actor.accountId,
            },
          ],
          { session },
        );
        await this.options.audit.record(
          {
            action: DOCUMENT_AUDIT_ACTIONS.versionAdded,
            outcome: 'succeeded',
            actor: auditActor(actor),
            target: { type: 'document', id: documentId },
            changes: [
              { path: 'currentVersion', from: String(input.expectedVersion), to: String(next) },
              { path: 'sha256', to: accepted.sha256 },
            ],
            context,
          },
          { session },
        );
        const versions = await this.versions.find({ documentId }).session(session).lean().exec();
        return toDocument(updated, versions);
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) throw conflict('STALE_VERSION', ['expectedVersion']);
      throw error;
    }
  }

  /**
   * Issue a short-lived link to one version (CORE-DOC-006). The issuing is recorded — who, which
   * version, download or print, and the file's scan status — before the link is returned.
   */
  async downloadLink(
    actor: ActorContext,
    documentId: string,
    request: { version?: number | undefined; purpose: 'download' | 'print' },
    context: RequestContext,
  ): Promise<DownloadLink> {
    const document = await this.findScoped(actor, documentId);
    if (document.state === 'quarantined') throw conflict('DOCUMENT_QUARANTINED', ['state']);
    const wanted = request.version ?? document.currentVersion;
    const version = await this.versions
      .findOne({ documentId, version: wanted })
      .lean<DocumentVersionDocument>()
      .exec();
    if (!version) throw notFound();
    const url = await this.options.store.createSignedDownloadUrl(version.storageKey, this.linkTtl, {
      fileName: version.fileName,
      contentType: version.contentType,
    });
    await this.options.audit.record({
      action:
        request.purpose === 'print'
          ? DOCUMENT_AUDIT_ACTIONS.printed
          : DOCUMENT_AUDIT_ACTIONS.downloaded,
      outcome: 'succeeded',
      actor: auditActor(actor),
      target: { type: 'document', id: documentId },
      changes: [
        { path: 'version', to: String(wanted) },
        { path: 'scanStatus', to: version.scanStatus },
      ],
      context,
    });
    return DownloadLinkSchema.parse({
      url,
      expiresAt: new Date(this.now().getTime() + this.linkTtl * 1000).toISOString(),
      fileName: version.fileName,
      contentType: version.contentType,
      scanStatus: version.scanStatus,
    });
  }

  /** Withdraw a document from everyday lists. It is kept, downloadable, and its versions stay. */
  async archive(
    actor: ActorContext,
    documentId: string,
    reason: string,
    context: RequestContext,
  ): Promise<BusinessDocument> {
    await this.findScoped(actor, documentId);
    return withTransaction(this.options.connection, async (session) => {
      const updated = await this.documents
        .findOneAndUpdate(
          { documentId, state: 'active' },
          { $set: { state: 'archived', updatedAt: this.now() } },
          { returnDocument: 'after', session },
        )
        .lean<DocumentDocument>()
        .exec();
      if (!updated) throw conflict('DOCUMENT_NOT_ACTIVE', ['state']);
      await this.options.audit.record(
        {
          action: DOCUMENT_AUDIT_ACTIONS.archived,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'document', id: documentId },
          changes: [{ path: 'state', from: 'active', to: 'archived' }],
          reason,
          context,
        },
        { session },
      );
      const versions = await this.versions.find({ documentId }).session(session).lean().exec();
      return toDocument(updated, versions);
    });
  }

  /** Set the retention date and legal hold. Retention policy values themselves are `SD-18`. */
  async setRetention(
    actor: ActorContext,
    documentId: string,
    input: { retainUntil?: BusinessDate | undefined; legalHold: boolean; reason: string },
    context: RequestContext,
  ): Promise<BusinessDocument> {
    const before = await this.findScoped(actor, documentId);
    return withTransaction(this.options.connection, async (session) => {
      const updated = await this.documents
        .findOneAndUpdate(
          { documentId },
          {
            $set: {
              legalHold: input.legalHold,
              updatedAt: this.now(),
              ...(input.retainUntil ? { retainUntil: input.retainUntil } : {}),
            },
            ...(input.retainUntil ? {} : { $unset: { retainUntil: 1 } }),
          },
          { returnDocument: 'after', session },
        )
        .lean<DocumentDocument>()
        .exec();
      if (!updated) throw notFound();
      await this.options.audit.record(
        {
          action: DOCUMENT_AUDIT_ACTIONS.retentionChanged,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'document', id: documentId },
          changes: [
            { path: 'legalHold', from: String(before.legalHold), to: String(input.legalHold) },
            {
              path: 'retainUntil',
              ...(before.retainUntil ? { from: before.retainUntil } : {}),
              ...(input.retainUntil ? { to: input.retainUntil } : {}),
            },
          ],
          reason: input.reason,
          context,
        },
        { session },
      );
      const versions = await this.versions.find({ documentId }).session(session).lean().exec();
      return toDocument(updated, versions);
    });
  }
}
