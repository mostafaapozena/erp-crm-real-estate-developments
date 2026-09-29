import {
  INVENTORY_AUDIT_ACTIONS,
  PlanTemplateSchema,
  addMoney,
  buildInstallmentSchedule,
  money,
  planFromTemplate,
  type ActorContext,
  type BusinessDate,
  type CreatePlanTemplate,
  type Money,
  type PlanTemplate,
  type PlanTemplatePreview,
} from '@alola/contracts';
import { assertSafeFilter, buildChangeSummary } from '@alola/security';
import type { Connection } from 'mongoose';
import {
  auditActor,
  conflict,
  invalid,
  isDuplicateKeyError,
  type AuditRecorder,
  type RequestContext,
} from '../../platform/audit-port';
import { newId } from '../../platform/ids';
import { withTransaction } from '../../platform/transactions';
import { planTemplateModel, type PlanTemplateDocument } from './model';
import { InventoryNotFoundError, type InventoryService } from './service';

/**
 * Payment-plan templates (INV-PLAN-001).
 *
 * A template is shown only through a project the actor can see: it is eligible for a project when it
 * names it, or names no project at all and belongs to the project's legal entity. A template in use is
 * never edited — it is retired and a new code created — so a plan quoted from it last month can always
 * be explained by the template as it was.
 */
export interface PlanTemplateServiceOptions {
  connection: Connection;
  audit: AuditRecorder;
  inventory: InventoryService;
}

const iso = (date: Date) => date.toISOString();

function toTemplate(d: PlanTemplateDocument): PlanTemplate {
  return PlanTemplateSchema.parse({
    templateId: d.templateId,
    code: d.code,
    name: d.name,
    projectIds: d.projectIds,
    legalEntityId: d.legalEntityId,
    downPaymentPercent: d.downPaymentPercent,
    installmentCount: d.installmentCount,
    frequency: d.frequency,
    firstInstallmentAfterMonths: d.firstInstallmentAfterMonths,
    ...(d.finalPaymentPercent ? { finalPaymentPercent: d.finalPaymentPercent } : {}),
    state: d.state,
    createdAt: iso(d.createdAt),
    ...(d.retiredAt ? { retiredAt: iso(d.retiredAt) } : {}),
  });
}

export class PlanTemplateService {
  private readonly connection;
  private readonly templates;

  constructor(private readonly options: PlanTemplateServiceOptions) {
    this.connection = options.connection;
    this.templates = planTemplateModel(options.connection);
  }

  /** Templates eligible for a project the actor can see, or for every project the actor can see. */
  async list(
    actor: ActorContext,
    query: { projectId?: string | undefined; includeRetired?: boolean | undefined },
  ): Promise<PlanTemplate[]> {
    const state: Record<string, unknown> = query.includeRetired ? {} : { state: 'active' };
    if (query.projectId) {
      const project = await this.options.inventory.getProject(actor, query.projectId);
      const filter: Record<string, unknown> = {
        legalEntityId: project.legalEntityId,
        $or: [{ projectIds: { $size: 0 } }, { projectIds: project.projectId }],
        ...state,
      };
      const rows = await this.templates
        .find(filter)
        .sort({ code: 1 })
        .lean<PlanTemplateDocument[]>()
        .exec();
      return rows.map(toTemplate);
    }
    const projects = await this.options.inventory.listProjects(actor);
    if (projects.length === 0) return [];
    const entities = [...new Set(projects.map((project) => project.legalEntityId))];
    const projectIds = projects.map((project) => project.projectId);
    const filter: Record<string, unknown> = {
      legalEntityId: { $in: entities },
      $or: [{ projectIds: { $size: 0 } }, { projectIds: { $in: projectIds } }],
      ...state,
    };
    const rows = await this.templates
      .find(filter)
      .sort({ code: 1 })
      .limit(500)
      .lean<PlanTemplateDocument[]>()
      .exec();
    return rows.map(toTemplate);
  }

  async create(
    actor: ActorContext,
    input: CreatePlanTemplate,
    context: RequestContext,
  ): Promise<PlanTemplate> {
    // Every named project must be visible to the author and belong to the template's legal entity.
    for (const projectId of input.projectIds) {
      const project = await this.options.inventory.getProject(actor, projectId);
      if (project.legalEntityId !== input.legalEntityId) {
        throw invalid('PROJECT_OUTSIDE_LEGAL_ENTITY', ['projectIds']);
      }
    }
    if (input.projectIds.length === 0) {
      const projects = await this.options.inventory.listProjects(actor);
      if (!projects.some((project) => project.legalEntityId === input.legalEntityId)) {
        throw invalid('LEGAL_ENTITY_NOT_VISIBLE', ['legalEntityId']);
      }
    }
    const now = new Date();
    const document: PlanTemplateDocument = {
      templateId: newId('ptpl'),
      code: input.code,
      name: input.name,
      projectIds: input.projectIds,
      legalEntityId: input.legalEntityId,
      downPaymentPercent: input.downPaymentPercent,
      installmentCount: input.installmentCount,
      frequency: input.frequency,
      firstInstallmentAfterMonths: input.firstInstallmentAfterMonths,
      ...(input.finalPaymentPercent ? { finalPaymentPercent: input.finalPaymentPercent } : {}),
      state: 'active',
      createdBy: actor.accountId,
      createdAt: now,
    };
    try {
      await withTransaction(this.connection, async (session) => {
        await this.templates.create([document], { session });
        await this.options.audit.record(
          {
            action: INVENTORY_AUDIT_ACTIONS.planTemplateCreated,
            outcome: 'succeeded',
            actor: auditActor(actor),
            target: { type: 'planTemplate', id: document.templateId },
            changes: buildChangeSummary(undefined, {
              code: document.code,
              downPaymentPercent: document.downPaymentPercent,
              installmentCount: String(document.installmentCount),
              frequency: document.frequency,
            }),
            context,
          },
          { session },
        );
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) throw conflict('CODE_TAKEN', ['code']);
      throw error;
    }
    return toTemplate(document);
  }

  private async visible(actor: ActorContext, templateId: string): Promise<PlanTemplateDocument> {
    assertSafeFilter({ templateId });
    const document = await this.templates
      .findOne({ templateId })
      .lean<PlanTemplateDocument>()
      .exec();
    if (!document) throw new InventoryNotFoundError('planTemplate');
    const visible = (await this.list(actor, { includeRetired: true })).some(
      (template) => template.templateId === templateId,
    );
    // A template the actor cannot reach through any project is absent, not forbidden (SEC-030).
    if (!visible) throw new InventoryNotFoundError('planTemplate');
    return document;
  }

  async retire(
    actor: ActorContext,
    templateId: string,
    reason: string,
    context: RequestContext,
  ): Promise<PlanTemplate> {
    await this.visible(actor, templateId);
    const updated = await withTransaction(this.connection, async (session) => {
      const result = await this.templates
        .findOneAndUpdate(
          { templateId, state: 'active' },
          { $set: { state: 'retired', retiredAt: new Date() } },
          { returnDocument: 'after', session },
        )
        .lean<PlanTemplateDocument>()
        .exec();
      if (!result) throw conflict('TEMPLATE_RETIRED');
      await this.options.audit.record(
        {
          action: INVENTORY_AUDIT_ACTIONS.planTemplateRetired,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'planTemplate', id: templateId },
          changes: buildChangeSummary({ state: 'active' }, { state: 'retired' }),
          reason,
          context,
        },
        { session },
      );
      return result;
    });
    return toTemplate(updated);
  }

  /**
   * The plan and schedule a template gives on one unit's current price, computed by the same code a
   * contract uses. Refused for a template the unit's project is not eligible for.
   */
  async preview(
    actor: ActorContext,
    templateId: string,
    input: { unitId: string; contractDate: BusinessDate },
  ): Promise<PlanTemplatePreview> {
    const template = await this.visible(actor, templateId);
    if (template.state !== 'active') throw conflict('TEMPLATE_RETIRED');
    const unit = await this.options.inventory.getUnit(actor, input.unitId);
    const eligible =
      template.legalEntityId === unit.legalEntityId &&
      (template.projectIds.length === 0 || template.projectIds.includes(unit.projectId));
    if (!eligible) throw conflict('TEMPLATE_NOT_ELIGIBLE', ['unitId']);
    const price = unit.currentPrice;
    if (!price) throw conflict('PRICE_NOT_VISIBLE');
    const plan = planFromTemplate(toTemplate(template), price, input.contractDate);
    const rows = buildInstallmentSchedule(price, plan);
    const rowsTotal = rows.reduce<Money>(
      (running, row) => addMoney(running, row.amount),
      money('0', price.currency),
    );
    return {
      templateId,
      unitId: unit.unitId,
      unitPrice: price,
      plan,
      schedule: { rows, total: price, rowsTotal },
    };
  }

  /** A template by id, unscoped — for sales when it records which template a plan came from. */
  async findUnscoped(templateId: string): Promise<PlanTemplate | undefined> {
    assertSafeFilter({ templateId });
    const document = await this.templates
      .findOne({ templateId })
      .lean<PlanTemplateDocument>()
      .exec();
    return document ? toTemplate(document) : undefined;
  }
}
