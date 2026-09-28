import {
  DOCUMENT_AUDIT_ACTIONS,
  PLACEHOLDER_PATTERN,
  TEMPLATE_PLACEHOLDERS,
  TemplateSchema,
  type ActorContext,
  type BusinessDate,
  type CreateTemplate,
  type Locale,
  type Template,
  type TemplateKind,
  type UpdateTemplateDraft,
} from '@alola/contracts';
import { assertSafeFilter } from '@alola/security';
import type { ClientSession, Connection } from 'mongoose';
import {
  auditActor,
  conflict,
  invalid,
  isDuplicateKeyError,
  notFound,
  type AuditRecorder,
  type RequestContext,
} from '../../platform/audit-port';
import { withTransaction } from '../../platform/transactions';
import { templateModel, type TemplateDocument } from './model';

/**
 * Bilingual, versioned document and message templates (CORE-DOC-002).
 *
 * - A **draft** is freely edited. **Publishing** checks that every placeholder is one the template's
 *   kind supports and that both languages use the same ones; a misspelt placeholder would otherwise
 *   print literally on a customer's contract.
 * - A published version is **immutable** — in this service, and in the model, which refuses any
 *   update touching a published row's content. It is retired, never edited.
 * - Selection picks the published version in force on a date, preferring the most specific match
 *   (project, then unit type).
 *
 * No template content ships with the product: wording is the deployment's own, approved by its
 * owners (`SD-10`). Previews use synthetic values, never a real record.
 */
export interface TemplateServiceOptions {
  connection: Connection;
  audit: AuditRecorder;
}

const iso = (date: Date) => date.toISOString();

/** Placeholders used in a body, in order of first appearance. */
export function placeholdersIn(body: string): string[] {
  return [...new Set([...body.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1] ?? ''))];
}

/** Replace each placeholder with its value. A missing value is left visibly marked, never blank. */
export function renderTemplate(body: string, values: Record<string, string>): string {
  return body.replace(PLACEHOLDER_PATTERN, (_match, key: string) => values[key] ?? `[${key}]`);
}

/** Obviously fictional values for a preview — never a real customer's data. */
function syntheticValue(type: string, locale: Locale): string {
  const ar = locale === 'ar';
  switch (type) {
    case 'money':
      // XXX is ISO 4217's "no currency": a preview must not look like a real amount.
      return '1,000,000.00 XXX';
    case 'date':
      return '01/01/2030';
    case 'number':
      return '42';
    case 'identifier':
      return 'SAMPLE-0001';
    default:
      return ar ? 'نص تجريبي' : 'Sample text';
  }
}

function toTemplate(document: TemplateDocument): Template {
  return TemplateSchema.parse({
    templateKey: document.templateKey,
    kind: document.kind,
    version: document.version,
    state: document.state,
    name: document.name,
    bodies: document.bodies,
    effectiveFrom: document.effectiveFrom,
    ...(document.effectiveTo ? { effectiveTo: document.effectiveTo } : {}),
    selectors: {
      ...(document.selectors?.projectId ? { projectId: document.selectors.projectId } : {}),
      ...(document.selectors?.unitType ? { unitType: document.selectors.unitType } : {}),
    },
    placeholders: document.placeholders,
    ...(document.firstUsedAt ? { firstUsedAt: iso(document.firstUsedAt) } : {}),
    createdAt: iso(document.createdAt),
    ...(document.publishedAt ? { publishedAt: iso(document.publishedAt) } : {}),
  });
}

export class TemplateService {
  private readonly templates;

  constructor(private readonly options: TemplateServiceOptions) {
    this.templates = templateModel(options.connection);
  }

  async listTemplates(
    query: { kind?: TemplateKind; templateKey?: string } = {},
  ): Promise<Template[]> {
    const filter: Record<string, unknown> = {};
    if (query.kind) filter['kind'] = query.kind;
    if (query.templateKey) filter['templateKey'] = query.templateKey;
    assertSafeFilter(filter);
    const rows = await this.templates
      .find(filter)
      .sort({ templateKey: 1, version: -1 })
      .limit(500)
      .lean<TemplateDocument[]>()
      .exec();
    return rows.map(toTemplate);
  }

  async getTemplate(templateKey: string, version: number): Promise<Template> {
    assertSafeFilter({ templateKey });
    const row = await this.templates
      .findOne({ templateKey, version })
      .lean<TemplateDocument>()
      .exec();
    if (!row) throw notFound();
    return toTemplate(row);
  }

  private async record(
    actor: ActorContext,
    action: string,
    id: string,
    context: RequestContext,
    session: ClientSession,
    reason?: string,
  ): Promise<void> {
    await this.options.audit.record(
      {
        action,
        outcome: 'succeeded',
        actor: auditActor(actor),
        target: { type: 'template', id },
        ...(reason ? { reason } : {}),
        context,
      },
      { session },
    );
  }

  async createDraft(
    actor: ActorContext,
    input: CreateTemplate,
    context: RequestContext,
  ): Promise<Template> {
    assertSafeFilter({ templateKey: input.templateKey });
    try {
      return await withTransaction(this.options.connection, async (session) => {
        const latest = await this.templates
          .findOne({ templateKey: input.templateKey })
          .sort({ version: -1 })
          .session(session)
          .lean<TemplateDocument>()
          .exec();
        // A key names one template: its kind never changes between versions.
        if (latest && latest.kind !== input.kind)
          throw conflict('TEMPLATE_KIND_MISMATCH', ['kind']);
        const now = new Date();
        const { templateKey, kind, ...content } = input;
        const [created] = await this.templates.create(
          [
            {
              templateKey,
              kind,
              version: (latest?.version ?? 0) + 1,
              state: 'draft',
              ...content,
              placeholders: placeholdersIn(`${content.bodies.ar}\n${content.bodies.en}`),
              createdAt: now,
              createdBy: actor.accountId,
              updatedAt: now,
              updatedBy: actor.accountId,
            },
          ],
          { session },
        );
        if (!created) throw new Error('Template insert returned nothing.');
        const template = toTemplate(created.toObject());
        await this.record(
          actor,
          DOCUMENT_AUDIT_ACTIONS.templateCreated,
          `${templateKey}@${template.version}`,
          context,
          session,
        );
        return template;
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) throw conflict('STALE_VERSION', ['templateKey']);
      throw error;
    }
  }

  async updateDraft(
    actor: ActorContext,
    templateKey: string,
    version: number,
    input: UpdateTemplateDraft,
    context: RequestContext,
  ): Promise<Template> {
    assertSafeFilter({ templateKey });
    return withTransaction(this.options.connection, async (session) => {
      const existing = await this.templates
        .findOne({ templateKey, version })
        .session(session)
        .lean<TemplateDocument>()
        .exec();
      if (!existing) throw notFound();
      if (existing.state !== 'draft') throw conflict('TEMPLATE_NOT_DRAFT', ['version']);
      const updated = await this.templates
        .findOneAndUpdate(
          { templateKey, version, state: 'draft' },
          {
            $set: {
              ...input,
              placeholders: placeholdersIn(`${input.bodies.ar}\n${input.bodies.en}`),
              updatedAt: new Date(),
              updatedBy: actor.accountId,
            },
            ...(input.effectiveTo === undefined ? { $unset: { effectiveTo: 1 } } : {}),
          },
          { returnDocument: 'after', session, runValidators: true },
        )
        .lean<TemplateDocument>()
        .exec();
      if (!updated) throw conflict('TEMPLATE_NOT_DRAFT', ['version']);
      await this.record(
        actor,
        DOCUMENT_AUDIT_ACTIONS.templateUpdated,
        `${templateKey}@${version}`,
        context,
        session,
      );
      return toTemplate(updated);
    });
  }

  /**
   * Publish a draft (CORE-DOC-002). Refused unless every placeholder is one its kind supports and
   * the Arabic and English bodies use exactly the same ones. After this, the version never changes.
   */
  async publish(
    actor: ActorContext,
    templateKey: string,
    version: number,
    reason: string,
    context: RequestContext,
  ): Promise<Template> {
    assertSafeFilter({ templateKey });
    return withTransaction(this.options.connection, async (session) => {
      const draft = await this.templates
        .findOne({ templateKey, version })
        .session(session)
        .lean<TemplateDocument>()
        .exec();
      if (!draft) throw notFound();
      if (draft.state !== 'draft') throw conflict('TEMPLATE_NOT_DRAFT', ['version']);
      const allowed = TEMPLATE_PLACEHOLDERS[draft.kind];
      for (const locale of ['ar', 'en'] as const) {
        const unknown = placeholdersIn(draft.bodies[locale]).find((key) => !(key in allowed));
        if (unknown) throw invalid('UNKNOWN_PLACEHOLDER', ['bodies', locale, unknown]);
      }
      const arabic = new Set(placeholdersIn(draft.bodies.ar));
      const english = new Set(placeholdersIn(draft.bodies.en));
      if (arabic.size !== english.size || [...arabic].some((key) => !english.has(key))) {
        throw invalid('PLACEHOLDERS_DIFFER_BY_LANGUAGE', ['bodies']);
      }
      const now = new Date();
      const published = await this.templates
        .findOneAndUpdate(
          { templateKey, version, state: 'draft' },
          {
            $set: {
              state: 'published',
              publishedAt: now,
              publishedBy: actor.accountId,
              updatedAt: now,
              updatedBy: actor.accountId,
            },
          },
          { returnDocument: 'after', session },
        )
        .lean<TemplateDocument>()
        .exec();
      if (!published) throw conflict('TEMPLATE_NOT_DRAFT', ['version']);
      await this.record(
        actor,
        DOCUMENT_AUDIT_ACTIONS.templatePublished,
        `${templateKey}@${version}`,
        context,
        session,
        reason,
      );
      return toTemplate(published);
    });
  }

  async retire(
    actor: ActorContext,
    templateKey: string,
    version: number,
    reason: string,
    context: RequestContext,
  ): Promise<Template> {
    assertSafeFilter({ templateKey });
    return withTransaction(this.options.connection, async (session) => {
      const now = new Date();
      const retired = await this.templates
        .findOneAndUpdate(
          { templateKey, version, state: 'published' },
          {
            $set: { state: 'retired', retiredAt: now, updatedAt: now, updatedBy: actor.accountId },
          },
          { returnDocument: 'after', session },
        )
        .lean<TemplateDocument>()
        .exec();
      if (!retired) {
        const exists = await this.templates
          .findOne({ templateKey, version })
          .session(session)
          .lean()
          .exec();
        throw exists ? conflict('TEMPLATE_NOT_PUBLISHED', ['version']) : notFound();
      }
      await this.record(
        actor,
        DOCUMENT_AUDIT_ACTIONS.templateRetired,
        `${templateKey}@${version}`,
        context,
        session,
        reason,
      );
      return toTemplate(retired);
    });
  }

  /**
   * The published version to use for a document of `kind` dated `on`: in force on that date, with
   * selectors that match, preferring a project match over a unit-type match over none.
   */
  async select(
    kind: TemplateKind,
    criteria: { on: BusinessDate; projectId?: string; unitType?: string },
  ): Promise<Template | undefined> {
    const rows = await this.templates
      .find({ kind, state: 'published', effectiveFrom: { $lte: criteria.on } })
      .lean<TemplateDocument[]>()
      .exec();
    const eligible = rows
      .filter((row) => !row.effectiveTo || row.effectiveTo >= criteria.on)
      .filter((row) => !row.selectors?.projectId || row.selectors.projectId === criteria.projectId)
      .filter((row) => !row.selectors?.unitType || row.selectors.unitType === criteria.unitType)
      .map((row) => ({
        row,
        score: (row.selectors?.projectId ? 2 : 0) + (row.selectors?.unitType ? 1 : 0),
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          (b.row.publishedAt?.getTime() ?? 0) - (a.row.publishedAt?.getTime() ?? 0),
      );
    const chosen = eligible[0]?.row;
    return chosen ? toTemplate(chosen) : undefined;
  }

  /** Render a version with synthetic sample values, in one language. Reads only. */
  async preview(templateKey: string, version: number, locale: Locale): Promise<string> {
    const template = await this.getTemplate(templateKey, version);
    const types = TEMPLATE_PLACEHOLDERS[template.kind];
    const values = Object.fromEntries(
      placeholdersIn(template.bodies[locale]).map((key) => [
        key,
        syntheticValue(types[key] ?? 'text', locale),
      ]),
    );
    return renderTemplate(template.bodies[locale], values);
  }

  /** Mark a version as used by a real document. Only the first use is recorded. */
  async markUsed(templateKey: string, version: number): Promise<void> {
    assertSafeFilter({ templateKey });
    await this.templates
      .updateOne(
        { templateKey, version, state: 'published', firstUsedAt: { $exists: false } },
        { $set: { firstUsedAt: new Date() } },
      )
      .exec();
  }
}
