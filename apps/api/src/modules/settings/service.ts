import {
  BOUND_LIST_LABEL_NAMESPACES,
  BOUND_REFERENCE_LISTS,
  LOCKED_REFERENCE_LISTS,
  ReferenceItemSchema,
  SETTINGS_AUDIT_ACTIONS,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  SettingSchema,
  type ActorContext,
  type BusinessDate,
  type CreateReferenceItem,
  type ReferenceItem,
  type ReferenceList,
  type Setting,
  type SettingDefinition,
  type SettingKey,
  type TaxRate,
  type UpdateReferenceItem,
  type UpdateSetting,
} from '@alola/contracts';
import { resources, type ResourceTree } from '@alola/i18n';
import { assertSafeFilter } from '@alola/security';
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
import { fromDecimal128, toDecimal128 } from '../../platform/money-storage';
import { withTransaction } from '../../platform/transactions';
import {
  referenceItemModel,
  settingRevisionModel,
  settingValueModel,
  type ReferenceItemDocument,
  type SettingValueDocument,
} from './model';

/**
 * Settings, reference data and feature flags (PLAT-024, PLAT-025, PLAT-026, ADR-0027).
 *
 * Other modules read their configuration through this service — `valueOf`, `isEnabled`,
 * `effectiveTaxRate`, `activeCodes` — never through its collections. Every write is guarded by the
 * version the editor read, and records the change, its reason and its audit evidence in one
 * transaction.
 */
export interface SettingsServiceOptions {
  connection: Connection;
  audit: AuditRecorder;
}

const definitionOf = (key: SettingKey): SettingDefinition => SETTING_DEFINITIONS[key];

/** An audit summary value: bounded JSON, so a large array cannot overflow the record. */
function summarize(value: unknown): string {
  const text = value === null || value === undefined ? 'not configured' : JSON.stringify(value);
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

function defaultLabel(list: ReferenceList, code: string): { ar: string; en: string } {
  const namespace = BOUND_LIST_LABEL_NAMESPACES[list];
  const lookup = (locale: 'ar' | 'en') => {
    const group = namespace
      ? (resources[locale].common as unknown as Record<string, ResourceTree | undefined>)[namespace]
      : undefined;
    const label = typeof group === 'object' ? group[code] : undefined;
    return typeof label === 'string' ? label : code;
  };
  return { ar: lookup('ar'), en: lookup('en') };
}

export class SettingsService {
  private readonly values;
  private readonly revisions;
  private readonly items;

  constructor(private readonly options: SettingsServiceOptions) {
    this.values = settingValueModel(options.connection);
    this.revisions = settingRevisionModel(options.connection);
    this.items = referenceItemModel(options.connection);
  }

  /* ---------------------------------------------------------------- settings */

  private toSetting(key: SettingKey, stored: SettingValueDocument | undefined): Setting {
    const definition = definitionOf(key);
    const configured = stored !== undefined && stored.value !== null && stored.value !== undefined;
    return SettingSchema.parse({
      key,
      category: definition.category,
      value: configured ? stored.value : definition.defaultValue,
      defaultValue: definition.defaultValue,
      configured,
      ...(definition.decision ? { decision: definition.decision } : {}),
      ...(definition.lockedBy ? { lockedBy: definition.lockedBy } : {}),
      version: stored?.version ?? 0,
      ...(stored ? { updatedAt: stored.updatedAt.toISOString(), updatedBy: stored.updatedBy } : {}),
    });
  }

  async listSettings(): Promise<Setting[]> {
    const stored = await this.values.find({}).lean<SettingValueDocument[]>().exec();
    const byKey = new Map(stored.map((row) => [row.key, row]));
    return SETTING_KEYS.map((key) => this.toSetting(key, byKey.get(key)));
  }

  async getSetting(key: SettingKey): Promise<Setting> {
    const stored = await this.values.findOne({ key }).lean<SettingValueDocument>().exec();
    return this.toSetting(key, stored ?? undefined);
  }

  /** The value in force. `null` means *not configured*: the consumer must not guess a number. */
  async valueOf<T = unknown>(key: SettingKey): Promise<T | null> {
    return (await this.getSetting(key)).value as T | null;
  }

  /** A feature flag's state. Unknown keys are refused by the type, never answered `true`. */
  async isEnabled(key: SettingKey & `feature.${string}`): Promise<boolean> {
    return (await this.valueOf<boolean>(key)) === true;
  }

  async settingHistory(key: SettingKey) {
    const rows = await this.revisions.find({ key }).sort({ version: -1 }).limit(200).lean().exec();
    return rows.map((row) => ({
      key: row.key as SettingKey,
      version: row.version,
      value: row.value ?? null,
      reason: row.reason,
      changedAt: row.changedAt.toISOString(),
      changedBy: row.changedBy,
    }));
  }

  /**
   * Change one setting (PLAT-024, PLAT-026). The value is validated against the setting's **own**
   * schema; a locked feature cannot be switched on by configuration at all. `null` returns the
   * setting to its default and is recorded like any other change.
   */
  async updateSetting(
    actor: ActorContext,
    key: SettingKey,
    input: UpdateSetting,
    context: RequestContext,
  ): Promise<Setting> {
    const definition = definitionOf(key);
    if (definition.lockedBy) throw conflict('FEATURE_LOCKED', ['value']);
    let value: unknown = null;
    if (input.value !== null) {
      const parsed = definition.schema.safeParse(input.value);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw invalid(
          issue?.message && /^[A-Z_]+$/.test(issue.message)
            ? issue.message
            : 'SETTING_VALUE_INVALID',
          [
            'value',
            ...(issue?.path ?? []).map((part) => (typeof part === 'symbol' ? String(part) : part)),
          ],
        );
      }
      value = parsed.data;
    }
    try {
      return await withTransaction(this.options.connection, async (session) => {
        const now = new Date();
        const before = await this.values
          .findOne({ key })
          .session(session)
          .lean<SettingValueDocument>()
          .exec();
        let saved: SettingValueDocument | null;
        if (input.expectedVersion === 0) {
          if (before) throw conflict('STALE_VERSION', ['expectedVersion']);
          const [created] = await this.values.create(
            [{ key, value, version: 1, updatedAt: now, updatedBy: actor.accountId }],
            { session },
          );
          saved = created ? created.toObject() : null;
        } else {
          saved = await this.values
            .findOneAndUpdate(
              { key, version: input.expectedVersion },
              { $set: { value, updatedAt: now, updatedBy: actor.accountId }, $inc: { version: 1 } },
              { returnDocument: 'after', session },
            )
            .lean<SettingValueDocument>()
            .exec();
        }
        if (!saved) throw conflict('STALE_VERSION', ['expectedVersion']);
        await this.revisions.create(
          [
            {
              revisionId: newId('setr'),
              key,
              version: saved.version,
              value,
              reason: input.reason,
              changedAt: now,
              changedBy: actor.accountId,
            },
          ],
          { session },
        );
        await this.options.audit.record(
          {
            action: SETTINGS_AUDIT_ACTIONS.settingChanged,
            outcome: 'succeeded',
            actor: auditActor(actor),
            target: { type: 'setting', id: key },
            changes: [{ path: key, from: summarize(before?.value), to: summarize(value) }],
            reason: input.reason,
            context,
          },
          { session },
        );
        return this.toSetting(key, saved);
      });
    } catch (error) {
      // Two first-time writers racing on version 0: the unique key decides, the loser is stale.
      if (isDuplicateKeyError(error)) throw conflict('STALE_VERSION', ['expectedVersion']);
      throw error;
    }
  }

  /* ---------------------------------------------------------- reference data */

  private toItem(
    list: ReferenceList,
    code: string,
    stored: ReferenceItemDocument | undefined,
    fallbackOrder: number,
  ): ReferenceItem {
    const bound = BOUND_REFERENCE_LISTS[list] !== undefined;
    const label = stored?.label ?? defaultLabel(list, code);
    return ReferenceItemSchema.parse({
      list,
      code,
      label: { ar: label.ar, en: label.en },
      ...(stored?.description
        ? { description: { ar: stored.description.ar, en: stored.description.en } }
        : {}),
      sortOrder: stored?.sortOrder ?? fallbackOrder,
      active: stored?.active ?? true,
      bound,
      ...(stored?.taxRates
        ? {
            taxRates: stored.taxRates.map((rate) => ({
              ratePercent: fromDecimal128(rate.ratePercent),
              effectiveFrom: rate.effectiveFrom,
            })),
          }
        : {}),
      version: stored?.version ?? 0,
      ...(stored ? { updatedAt: stored.updatedAt.toISOString() } : {}),
    });
  }

  /**
   * A list's items, ordered. For a bound list every product code is present — overridden where the
   * deployment has relabelled or reordered it, otherwise with the product's own bilingual label.
   */
  async listItems(
    list: ReferenceList,
    options: { includeInactive?: boolean } = {},
  ): Promise<ReferenceItem[]> {
    const stored = await this.items.find({ list }).lean<ReferenceItemDocument[]>().exec();
    const byCode = new Map(stored.map((row) => [row.code, row]));
    const boundCodes = BOUND_REFERENCE_LISTS[list];
    const items = boundCodes
      ? boundCodes.map((code, index) => this.toItem(list, code, byCode.get(code), (index + 1) * 10))
      : stored.map((row) => this.toItem(list, row.code, row, 100));
    return items
      .filter((item) => options.includeInactive === true || item.active)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  }

  /** The active codes of a list — what a module validates a submitted code against. */
  async activeCodes(list: ReferenceList): Promise<string[]> {
    return (await this.listItems(list)).map((item) => item.code);
  }

  private assertCodeExists(list: ReferenceList, code: string): void {
    const bound = BOUND_REFERENCE_LISTS[list];
    if (bound && !bound.includes(code)) throw notFound();
  }

  async createItem(
    actor: ActorContext,
    list: ReferenceList,
    input: CreateReferenceItem,
    context: RequestContext,
  ): Promise<ReferenceItem> {
    // A bound list's codes are the product's; a deployment relabels them, it does not add to them.
    if (BOUND_REFERENCE_LISTS[list]) throw conflict('LIST_BOUND_TO_PRODUCT', ['code']);
    assertSafeFilter({ code: input.code });
    try {
      return await withTransaction(this.options.connection, async (session) => {
        const now = new Date();
        const [created] = await this.items.create(
          [
            {
              list,
              code: input.code,
              label: input.label,
              ...(input.description ? { description: input.description } : {}),
              sortOrder: input.sortOrder,
              active: true,
              version: 1,
              createdAt: now,
              createdBy: actor.accountId,
              updatedAt: now,
              updatedBy: actor.accountId,
            },
          ],
          { session },
        );
        if (!created) throw new Error('Reference insert returned no document.');
        await this.options.audit.record(
          {
            action: SETTINGS_AUDIT_ACTIONS.referenceCreated,
            outcome: 'succeeded',
            actor: auditActor(actor),
            target: { type: `referenceData.${list}`, id: input.code },
            changes: [
              { path: 'label.en', to: input.label.en },
              { path: 'label.ar', to: input.label.ar },
            ],
            context,
          },
          { session },
        );
        return this.toItem(list, input.code, created.toObject(), input.sortOrder);
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) throw conflict('CODE_TAKEN', ['code']);
      throw error;
    }
  }

  /**
   * Relabel, describe or reorder an item. The code never changes, so every record already carrying it
   * keeps its meaning; only how it is displayed changes, and the change is audited.
   */
  async updateItem(
    actor: ActorContext,
    list: ReferenceList,
    code: string,
    input: UpdateReferenceItem,
    context: RequestContext,
  ): Promise<ReferenceItem> {
    assertSafeFilter({ code });
    this.assertCodeExists(list, code);
    const set: Record<string, unknown> = {};
    if (input.label) set['label'] = input.label;
    if (input.description) set['description'] = input.description;
    if (input.sortOrder !== undefined) set['sortOrder'] = input.sortOrder;
    if (Object.keys(set).length === 0) throw invalid('NOTHING_TO_UPDATE');
    return this.writeItem(actor, list, code, input.expectedVersion, set, context, {
      action: SETTINGS_AUDIT_ACTIONS.referenceUpdated,
    });
  }

  async setItemActive(
    actor: ActorContext,
    list: ReferenceList,
    code: string,
    active: boolean,
    reason: string,
    context: RequestContext,
  ): Promise<ReferenceItem> {
    assertSafeFilter({ code });
    this.assertCodeExists(list, code);
    if (!active && LOCKED_REFERENCE_LISTS.includes(list)) throw conflict('ITEM_LOCKED', ['code']);
    const current = await this.items.findOne({ list, code }).lean<ReferenceItemDocument>().exec();
    if (!current && !BOUND_REFERENCE_LISTS[list]) throw notFound();
    if ((current?.active ?? true) === active) {
      throw conflict(active ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE', ['active']);
    }
    return this.writeItem(actor, list, code, current?.version ?? 0, { active }, context, {
      action: active
        ? SETTINGS_AUDIT_ACTIONS.referenceReactivated
        : SETTINGS_AUDIT_ACTIONS.referenceDeactivated,
      reason,
    });
  }

  /**
   * Write an item guarded by its version. A bound item that was never overridden has version 0 and is
   * created on its first change, with the product's defaults for whatever the change leaves alone.
   */
  private async writeItem(
    actor: ActorContext,
    list: ReferenceList,
    code: string,
    expectedVersion: number,
    set: Record<string, unknown>,
    context: RequestContext,
    audit: { action: string; reason?: string },
  ): Promise<ReferenceItem> {
    try {
      return await withTransaction(this.options.connection, async (session) => {
        const now = new Date();
        const before = await this.items
          .findOne({ list, code })
          .session(session)
          .lean<ReferenceItemDocument>()
          .exec();
        let saved: ReferenceItemDocument | null;
        if (expectedVersion === 0) {
          if (before || !BOUND_REFERENCE_LISTS[list]) {
            throw before ? conflict('STALE_VERSION', ['expectedVersion']) : notFound();
          }
          const [created] = await this.items.create(
            [
              {
                list,
                code,
                active: true,
                ...set,
                version: 1,
                createdAt: now,
                createdBy: actor.accountId,
                updatedAt: now,
                updatedBy: actor.accountId,
              },
            ],
            { session },
          );
          saved = created ? created.toObject() : null;
        } else {
          saved = await this.items
            .findOneAndUpdate(
              { list, code, version: expectedVersion },
              {
                $set: { ...set, updatedAt: now, updatedBy: actor.accountId },
                $inc: { version: 1 },
              },
              { returnDocument: 'after', session, runValidators: true },
            )
            .lean<ReferenceItemDocument>()
            .exec();
        }
        if (!saved) {
          if (!before) throw notFound();
          throw conflict('STALE_VERSION', ['expectedVersion']);
        }
        const summary = (row: ReferenceItemDocument | null) =>
          Object.fromEntries(
            Object.keys(set).map((field) => [
              field,
              row ? (row as unknown as Record<string, unknown>)[field] : undefined,
            ]),
          );
        await this.options.audit.record(
          {
            action: audit.action,
            outcome: 'succeeded',
            actor: auditActor(actor),
            target: { type: `referenceData.${list}`, id: code },
            changes: Object.keys(set).map((field) => ({
              path: field,
              from: summarize(summary(before)[field]),
              to: summarize(summary(saved)[field]),
            })),
            ...(audit.reason ? { reason: audit.reason } : {}),
            context,
          },
          { session },
        );
        const index = BOUND_REFERENCE_LISTS[list]?.indexOf(code) ?? -1;
        return this.toItem(list, code, saved, index >= 0 ? (index + 1) * 10 : 100);
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) throw conflict('STALE_VERSION', ['expectedVersion']);
      throw error;
    }
  }

  /**
   * Add a tax rate in force from a date (PLAT-025). Rates are never edited and never backdated past
   * the latest one: a rate that has governed a document stays exactly what it was. The values
   * themselves are `SD-08` — none is seeded.
   */
  async addTaxRate(
    actor: ActorContext,
    code: string,
    rate: TaxRate,
    context: RequestContext,
  ): Promise<ReferenceItem> {
    assertSafeFilter({ code });
    return withTransaction(this.options.connection, async (session) => {
      const item = await this.items
        .findOne({ list: 'taxCodes', code })
        .session(session)
        .lean<ReferenceItemDocument>()
        .exec();
      if (!item) throw notFound();
      if (!item.active) throw conflict('ITEM_INACTIVE', ['code']);
      const latest = item.taxRates?.at(-1)?.effectiveFrom;
      if (latest !== undefined && rate.effectiveFrom <= latest) {
        throw conflict('RATE_NOT_FORWARD', ['effectiveFrom']);
      }
      const updated = await this.items
        .findOneAndUpdate(
          { list: 'taxCodes', code, version: item.version },
          {
            $push: {
              taxRates: {
                ratePercent: toDecimal128(rate.ratePercent),
                effectiveFrom: rate.effectiveFrom,
              },
            },
            $set: { updatedAt: new Date(), updatedBy: actor.accountId },
            $inc: { version: 1 },
          },
          { returnDocument: 'after', session },
        )
        .lean<ReferenceItemDocument>()
        .exec();
      if (!updated) throw conflict('STALE_VERSION', ['code']);
      await this.options.audit.record(
        {
          action: SETTINGS_AUDIT_ACTIONS.taxRateAdded,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'referenceData.taxCodes', id: code },
          changes: [{ path: `rate@${rate.effectiveFrom}`, to: rate.ratePercent }],
          context,
        },
        { session },
      );
      return this.toItem('taxCodes', code, updated, 100);
    });
  }

  /** The rate in force on a date, or `undefined` when none was in force. Never interpolated. */
  async effectiveTaxRate(code: string, on: BusinessDate): Promise<string | undefined> {
    assertSafeFilter({ code });
    const item = await this.items
      .findOne({ list: 'taxCodes', code })
      .lean<ReferenceItemDocument>()
      .exec();
    const rate = [...(item?.taxRates ?? [])]
      .filter((entry) => entry.effectiveFrom <= on)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
      .at(-1);
    return rate ? fromDecimal128(rate.ratePercent) : undefined;
  }
}
