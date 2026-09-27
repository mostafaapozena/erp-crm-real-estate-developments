import {
  IssuedNumberSchema,
  NUMBERING_AUDIT_ACTIONS,
  SequenceSchema,
  type ActorContext,
  type BusinessDate,
  type CreateSequence,
  type IssueContext,
  type IssuedNumber,
  type Sequence,
  type SequenceType,
  type UpdateSequenceDraft,
} from '@alola/contracts';
import { assertSafeFilter } from '@alola/security';
import { createHash } from 'node:crypto';
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
import {
  counterModel,
  issuedNumberModel,
  sequenceModel,
  type CounterDocument,
  type IssuedNumberDocument,
  type SequenceDocument,
} from './model';

/**
 * Central number sequences (CORE-DOC-001).
 *
 * Issuing is a **module operation**, not a route: a receipt number is issued by the collections module
 * inside the transaction that records the receipt, so the number and the document commit together —
 * or neither does, and no gap is left. Administrators define and activate formats; nobody can burn a
 * number from outside a document.
 */
export interface NumberingServiceOptions {
  connection: Connection;
  audit: AuditRecorder;
  /** Month (1–12) the fiscal year starts, or `null` when not configured (`SD-21`). */
  fiscalYearStartMonth?: () => Promise<number | null>;
}

/** Who issues a number: a module acting for an account, or the system. */
export interface Issuer {
  accountId: string;
}

export interface IssueRequest extends IssueContext {
  idempotencyKey: string;
  /** The document the number belongs to. */
  source: { type: string; id: string };
}

const iso = (date: Date) => date.toISOString();

function toSequence(d: SequenceDocument): Sequence {
  return SequenceSchema.parse({
    type: d.type,
    version: d.version,
    prefix: d.prefix,
    ...(d.suffix ? { suffix: d.suffix } : {}),
    separator: d.separator,
    dateComponent: d.dateComponent,
    entityComponent: d.entityComponent ?? false,
    branchComponent: d.branchComponent,
    projectComponent: d.projectComponent,
    padding: d.padding,
    resetPolicy: d.resetPolicy,
    startAt: d.startAt,
    effectiveFrom: d.effectiveFrom,
    state: d.state,
    example: render(
      d,
      { year: 2026, month: 1, fiscalStartYear: 2026 },
      { entityCode: 'LE', branchCode: 'BR', projectCode: 'PRJ' },
      d.startAt,
    ),
    createdAt: iso(d.createdAt),
    ...(d.activatedAt ? { activatedAt: iso(d.activatedAt) } : {}),
    ...(d.retiredAt ? { retiredAt: iso(d.retiredAt) } : {}),
  });
}

function toIssued(d: IssuedNumberDocument): IssuedNumber {
  return IssuedNumberSchema.parse({
    number: d.number,
    type: d.type,
    sequenceVersion: d.sequenceVersion,
    periodKey: d.periodKey,
    issueDate: d.issueDate,
    source: { type: d.source.type, id: d.source.id },
    state: d.state,
    ...(d.voidReason ? { voidReason: d.voidReason } : {}),
    issuedAt: iso(d.issuedAt),
    ...(d.voidedAt ? { voidedAt: iso(d.voidedAt) } : {}),
  });
}

interface DateParts {
  year: number;
  month: number;
  /** The calendar year the fiscal year containing the date started in. */
  fiscalStartYear: number;
}

function dateParts(issueDate: BusinessDate, fiscalStartMonth: number | null): DateParts {
  const [yearText = '0', monthText = '1'] = issueDate.split('-');
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const start = fiscalStartMonth ?? 1;
  return { year, month, fiscalStartYear: month >= start ? year : year - 1 };
}

function dateToken(
  format: SequenceDocument['dateComponent'],
  parts: DateParts,
): string | undefined {
  switch (format) {
    case 'none':
      return undefined;
    case 'yyyy':
      return String(parts.year);
    case 'yy':
      return String(parts.year).slice(-2);
    case 'yyyyMM':
      return `${parts.year}${String(parts.month).padStart(2, '0')}`;
    case 'fiscalYear':
      return String(parts.fiscalStartYear);
  }
}

function periodKey(policy: SequenceDocument['resetPolicy'], parts: DateParts): string {
  switch (policy) {
    case 'never':
      return 'all';
    case 'yearly':
      return String(parts.year);
    case 'monthly':
      return `${parts.year}-${String(parts.month).padStart(2, '0')}`;
    case 'fiscalYearly':
      return `FY${parts.fiscalStartYear}`;
  }
}

/** The organization codes a number may carry. */
export interface NumberCodes {
  entityCode?: string | undefined;
  branchCode?: string | undefined;
  projectCode?: string | undefined;
}

/** `PREFIX-ENTITY-BRANCH-PROJECT-DATE-00042-SUFFIX`, with the configured separator and parts. */
export function render(
  sequence: Pick<
    SequenceDocument,
    | 'prefix'
    | 'suffix'
    | 'separator'
    | 'dateComponent'
    | 'entityComponent'
    | 'branchComponent'
    | 'projectComponent'
    | 'padding'
  >,
  parts: DateParts,
  codes: NumberCodes,
  value: number,
): string {
  return [
    sequence.prefix,
    sequence.entityComponent ? codes.entityCode : undefined,
    sequence.branchComponent ? codes.branchCode : undefined,
    sequence.projectComponent ? codes.projectCode : undefined,
    dateToken(sequence.dateComponent, parts),
    String(value).padStart(sequence.padding, '0'),
    sequence.suffix,
  ]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(sequence.separator);
}

function usesFiscalYear(sequence: SequenceDocument): boolean {
  return sequence.dateComponent === 'fiscalYear' || sequence.resetPolicy === 'fiscalYearly';
}

export class NumberingService {
  private readonly sequences;
  private readonly counters;
  private readonly issued;

  constructor(private readonly options: NumberingServiceOptions) {
    this.sequences = sequenceModel(options.connection);
    this.counters = counterModel(options.connection);
    this.issued = issuedNumberModel(options.connection);
  }

  /* ------------------------------------------------------------- formats */

  async listSequences(type?: SequenceType): Promise<Sequence[]> {
    const rows = await this.sequences
      .find(type ? { type } : {})
      .sort({ type: 1, version: -1 })
      .limit(500)
      .lean<SequenceDocument[]>()
      .exec();
    return rows.map(toSequence);
  }

  private async record(
    actor: ActorContext,
    action: string,
    id: string,
    changes: { path: string; from?: string; to?: string }[],
    context: RequestContext,
    session: ClientSession,
    reason?: string,
  ): Promise<void> {
    await this.options.audit.record(
      {
        action,
        outcome: 'succeeded',
        actor: auditActor(actor),
        target: { type: 'numberSequence', id },
        changes,
        ...(reason ? { reason } : {}),
        context,
      },
      { session },
    );
  }

  /** A new draft format. It numbers nothing until it is activated. */
  async createDraft(
    actor: ActorContext,
    input: CreateSequence,
    context: RequestContext,
  ): Promise<Sequence> {
    try {
      return await withTransaction(this.options.connection, async (session) => {
        const latest = await this.sequences
          .findOne({ type: input.type })
          .sort({ version: -1 })
          .session(session)
          .lean<SequenceDocument>()
          .exec();
        const now = new Date();
        const { type, ...format } = input;
        const [created] = await this.sequences.create(
          [
            {
              type,
              version: (latest?.version ?? 0) + 1,
              ...format,
              state: 'draft',
              createdAt: now,
              createdBy: actor.accountId,
              updatedAt: now,
              updatedBy: actor.accountId,
            },
          ],
          { session },
        );
        if (!created) throw new Error('Sequence insert returned no document.');
        const sequence = toSequence(created.toObject());
        await this.record(
          actor,
          NUMBERING_AUDIT_ACTIONS.sequenceCreated,
          `${type}@${sequence.version}`,
          [{ path: 'example', to: sequence.example }],
          context,
          session,
        );
        return sequence;
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) throw conflict('STALE_VERSION', ['type']);
      throw error;
    }
  }

  /** Only a draft can change: an active or retired format is what issued numbers were built from. */
  async updateDraft(
    actor: ActorContext,
    type: SequenceType,
    version: number,
    input: UpdateSequenceDraft,
    context: RequestContext,
  ): Promise<Sequence> {
    return withTransaction(this.options.connection, async (session) => {
      const current = await this.sequences
        .findOne({ type, version })
        .session(session)
        .lean<SequenceDocument>()
        .exec();
      if (!current) throw notFound();
      if (current.state !== 'draft') throw conflict('SEQUENCE_NOT_DRAFT', ['version']);
      const updated = await this.sequences
        .findOneAndUpdate(
          { type, version, state: 'draft' },
          {
            $set: { ...input, updatedAt: new Date(), updatedBy: actor.accountId },
            ...(input.suffix === undefined ? { $unset: { suffix: 1 } } : {}),
          },
          { returnDocument: 'after', session, runValidators: true },
        )
        .lean<SequenceDocument>()
        .exec();
      if (!updated) throw conflict('SEQUENCE_NOT_DRAFT', ['version']);
      const sequence = toSequence(updated);
      await this.record(
        actor,
        NUMBERING_AUDIT_ACTIONS.sequenceUpdated,
        `${type}@${version}`,
        [{ path: 'example', from: toSequence(current).example, to: sequence.example }],
        context,
        session,
      );
      return sequence;
    });
  }

  /**
   * Make a draft the format new numbers are issued in, retiring the previous one. The counter is keyed
   * without the version, so the series continues rather than restarting.
   */
  async activate(
    actor: ActorContext,
    type: SequenceType,
    version: number,
    reason: string,
    context: RequestContext,
  ): Promise<Sequence> {
    try {
      return await withTransaction(this.options.connection, async (session) => {
        const draft = await this.sequences
          .findOne({ type, version })
          .session(session)
          .lean<SequenceDocument>()
          .exec();
        if (!draft) throw notFound();
        if (draft.state !== 'draft') throw conflict('SEQUENCE_NOT_DRAFT', ['version']);
        const now = new Date();
        const previous = await this.sequences
          .findOneAndUpdate(
            { type, state: 'active' },
            {
              $set: {
                state: 'retired',
                retiredAt: now,
                updatedAt: now,
                updatedBy: actor.accountId,
              },
            },
            { returnDocument: 'before', session },
          )
          .lean<SequenceDocument>()
          .exec();
        const activated = await this.sequences
          .findOneAndUpdate(
            { type, version, state: 'draft' },
            {
              $set: {
                state: 'active',
                activatedAt: now,
                updatedAt: now,
                updatedBy: actor.accountId,
              },
            },
            { returnDocument: 'after', session },
          )
          .lean<SequenceDocument>()
          .exec();
        if (!activated) throw conflict('SEQUENCE_NOT_DRAFT', ['version']);
        await this.record(
          actor,
          NUMBERING_AUDIT_ACTIONS.sequenceActivated,
          `${type}@${version}`,
          [
            {
              path: 'active',
              ...(previous ? { from: `${type}@${previous.version}` } : {}),
              to: `${type}@${version}`,
            },
          ],
          context,
          session,
          reason,
        );
        return toSequence(activated);
      });
    } catch (error) {
      // Two activations of one type racing: the partial unique index lets exactly one through.
      if (isDuplicateKeyError(error)) throw conflict('STALE_STATE', ['version']);
      throw error;
    }
  }

  /* -------------------------------------------------------------- issuing */

  private async activeSequence(type: SequenceType, session?: ClientSession) {
    const query = this.sequences.findOne({ type, state: 'active' });
    if (session) query.session(session);
    const sequence = await query.lean<SequenceDocument>().exec();
    if (!sequence) throw conflict('NO_ACTIVE_SEQUENCE', ['type']);
    return sequence;
  }

  private async partsFor(sequence: SequenceDocument, issueDate: BusinessDate): Promise<DateParts> {
    const fiscalStart = usesFiscalYear(sequence)
      ? ((await this.options.fiscalYearStartMonth?.()) ?? null)
      : null;
    // A fiscal-year format cannot guess when the fiscal year starts (`SD-21`).
    if (usesFiscalYear(sequence) && fiscalStart === null) {
      throw conflict('FISCAL_YEAR_NOT_CONFIGURED', ['type']);
    }
    return dateParts(issueDate, fiscalStart);
  }

  private scopeKey(sequence: SequenceDocument, input: IssueContext): string {
    if (sequence.entityComponent && !input.entityCode) {
      throw invalid('ENTITY_CODE_REQUIRED', ['entityCode']);
    }
    if (sequence.branchComponent && !input.branchCode)
      throw invalid('BRANCH_CODE_REQUIRED', ['branchCode']);
    if (sequence.projectComponent && !input.projectCode) {
      throw invalid('PROJECT_CODE_REQUIRED', ['projectCode']);
    }
    const parts = [
      sequence.entityComponent ? `e:${input.entityCode}` : undefined,
      sequence.branchComponent ? `b:${input.branchCode}` : undefined,
      sequence.projectComponent ? `p:${input.projectCode}` : undefined,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join('|') : 'all';
  }

  /** The number the next issue would receive. Nothing is reserved. */
  async preview(
    input: IssueContext,
  ): Promise<{ type: SequenceType; version: number; next: string }> {
    const sequence = await this.activeSequence(input.type);
    if (sequence.effectiveFrom > input.issueDate)
      throw conflict('SEQUENCE_NOT_EFFECTIVE', ['issueDate']);
    const parts = await this.partsFor(sequence, input.issueDate);
    const period = periodKey(sequence.resetPolicy, parts);
    const scope = this.scopeKey(sequence, input);
    const counter = await this.counters
      .findOne({ counterKey: `${input.type}|${period}|${scope}` })
      .lean<CounterDocument>()
      .exec();
    const value = sequence.startAt + (counter?.issued ?? 0);
    return {
      type: input.type,
      version: sequence.version,
      next: render(sequence, parts, input, value),
    };
  }

  /**
   * Issue the next number (CORE-DOC-001). Pass the caller's `session` to issue inside the transaction
   * that creates the document: then the number exists exactly when the document does. Without one,
   * the issue is its own transaction.
   *
   * Replaying an idempotency key returns the number it already produced; replaying it with a
   * different request is a conflict. A number that would collide with one already issued — which only
   * a careless format change can cause — is refused, and nothing is consumed.
   */
  async issue(issuer: Issuer, input: IssueRequest, session?: ClientSession): Promise<IssuedNumber> {
    assertSafeFilter({ idempotencyKey: input.idempotencyKey, type: input.type });
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          input.type,
          input.issueDate,
          input.entityCode ?? '',
          input.branchCode ?? '',
          input.projectCode ?? '',
          input.source.type,
          input.source.id,
        ]),
      )
      .digest('hex');

    const replay = async (inner?: ClientSession): Promise<IssuedNumber | undefined> => {
      const query = this.issued.findOne({ idempotencyKey: input.idempotencyKey });
      if (inner) query.session(inner);
      const existing = await query.lean<IssuedNumberDocument>().exec();
      if (!existing) return undefined;
      if (existing.fingerprint !== fingerprint)
        throw conflict('IDEMPOTENCY_KEY_REUSED', ['idempotencyKey']);
      return toIssued(existing);
    };

    const work = async (inner: ClientSession): Promise<IssuedNumber> => {
      const previous = await replay(inner);
      if (previous) return previous;
      const sequence = await this.activeSequence(input.type, inner);
      if (sequence.effectiveFrom > input.issueDate)
        throw conflict('SEQUENCE_NOT_EFFECTIVE', ['issueDate']);
      const parts = await this.partsFor(sequence, input.issueDate);
      const period = periodKey(sequence.resetPolicy, parts);
      const scope = this.scopeKey(sequence, input);
      const counterKey = `${input.type}|${period}|${scope}`;
      const now = new Date();
      const counter = await this.counters
        .findOneAndUpdate(
          { counterKey },
          {
            $inc: { issued: 1 },
            $set: { updatedAt: now },
            $setOnInsert: { counterKey, type: input.type, periodKey: period, scopeKey: scope },
          },
          { upsert: true, returnDocument: 'after', session: inner },
        )
        .lean<CounterDocument>()
        .exec();
      if (!counter) throw new Error('Counter upsert returned nothing.');
      const value = sequence.startAt + counter.issued - 1;
      const number = render(sequence, parts, input, value);
      try {
        const [created] = await this.issued.create(
          [
            {
              number,
              type: input.type,
              sequenceVersion: sequence.version,
              periodKey: period,
              scopeKey: scope,
              counterValue: value,
              issueDate: input.issueDate,
              idempotencyKey: input.idempotencyKey,
              fingerprint,
              source: input.source,
              state: 'issued',
              issuedAt: now,
              issuedBy: issuer.accountId,
            },
          ],
          { session: inner },
        );
        if (!created) throw new Error('Ledger insert returned nothing.');
        return toIssued(created.toObject());
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          const keyPattern = (error as { keyPattern?: Record<string, unknown> }).keyPattern ?? {};
          if ('number' in keyPattern) throw conflict('NUMBER_COLLISION', ['type']);
        }
        throw error;
      }
    };

    if (session) return work(session);
    try {
      return await withTransaction(this.options.connection, work);
    } catch (error) {
      // A concurrent replay of the same key committed first: answer with what it produced.
      if (isDuplicateKeyError(error)) {
        const settled = await replay();
        if (settled) return settled;
      }
      throw error;
    }
  }

  /**
   * Void an issued number when its document is cancelled. The number stays in the ledger forever and
   * is never issued again (ADR-0009): a gap in a numbered series must always have an explanation.
   */
  async voidNumber(
    actor: ActorContext,
    type: SequenceType,
    number: string,
    reason: string,
    context: RequestContext,
    session?: ClientSession,
  ): Promise<IssuedNumber> {
    assertSafeFilter({ type, number });
    const work = async (inner: ClientSession) => {
      const updated = await this.issued
        .findOneAndUpdate(
          { type, number, state: 'issued' },
          {
            $set: {
              state: 'voided',
              voidReason: reason,
              voidedAt: new Date(),
              voidedBy: actor.accountId,
            },
          },
          { returnDocument: 'after', session: inner },
        )
        .lean<IssuedNumberDocument>()
        .exec();
      if (!updated) {
        const exists = await this.issued.findOne({ type, number }).session(inner).lean().exec();
        throw exists ? conflict('ALREADY_VOIDED', ['number']) : notFound();
      }
      await this.options.audit.record(
        {
          action: NUMBERING_AUDIT_ACTIONS.numberVoided,
          outcome: 'succeeded',
          actor: auditActor(actor),
          target: { type: 'issuedNumber', id: `${type}:${number}` },
          changes: [{ path: 'state', from: 'issued', to: 'voided' }],
          reason,
          context,
        },
        { session: inner },
      );
      return toIssued(updated);
    };
    return session ? work(session) : withTransaction(this.options.connection, work);
  }

  /** The ledger, newest first, with an opaque keyset cursor. */
  async listIssued(query: {
    type?: SequenceType;
    limit: number;
    cursor?: string;
  }): Promise<{ items: IssuedNumber[]; nextCursor?: string }> {
    const filter: Record<string, unknown> = query.type ? { type: query.type } : {};
    if (query.cursor) {
      const [time, number] = Buffer.from(query.cursor, 'base64url').toString('utf8').split('|');
      const at = time ? new Date(time) : undefined;
      if (!at || Number.isNaN(at.getTime()) || !number) throw invalid('CURSOR_INVALID', ['cursor']);
      filter['$or'] = [{ issuedAt: { $lt: at } }, { issuedAt: at, number: { $lt: number } }];
    }
    const rows = await this.issued
      .find(filter)
      .sort({ issuedAt: -1, number: -1 })
      .limit(query.limit + 1)
      .lean<IssuedNumberDocument[]>()
      .exec();
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toIssued),
      ...(rows.length > query.limit && last
        ? {
            nextCursor: Buffer.from(`${iso(last.issuedAt)}|${last.number}`, 'utf8').toString(
              'base64url',
            ),
          }
        : {}),
    };
  }
}
