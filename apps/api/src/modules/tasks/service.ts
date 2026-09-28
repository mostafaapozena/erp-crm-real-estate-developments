import {
  OPEN_TASK_STATES,
  TASK_AUDIT_ACTIONS,
  TASK_TRANSITIONS,
  TaskSchema,
  businessDateInZone,
  instantFromDate,
  instantInZone,
  type ActorContext,
  type BusinessDate,
  type Task,
  type TaskLinkType,
  type TaskPriority,
  type TaskState,
  type TaskSweepResult,
} from '@alola/contracts';
import {
  assertSafeFilter,
  buildScopeFilter,
  can,
  isMatchNothing,
  type ScopeFieldMap,
} from '@alola/security';
import type { ClientSession, Connection } from 'mongoose';
import {
  DomainError,
  auditActor,
  conflict,
  invalid,
  notFound,
  type AuditRecorder,
  type RequestContext,
} from '../../platform/audit-port';
import { newId } from '../../platform/ids';
import { withTransaction } from '../../platform/transactions';
import { taskModel, type TaskDocument } from './model';

/**
 * Tasks (CORE-TASK-001 … 005).
 *
 * **Who sees a task.** The person it is assigned to, the person it escalated to and the person who
 * created it always see it — that is "my tasks", and it needs no permission. Beyond that, `task.view`
 * reaches the tasks inside the actor's data scope, filtered in the query (SEC-027). A task linked to a
 * record carries that record's placement, so a branch manager sees their branch's tasks; a personal,
 * unlinked task is visible only to its three people and to an `all`-scope viewer.
 *
 * **Who changes a task.** Its assignee moves it along (start, finish, put back); its creator and a
 * holder of `task.manage` in scope also edit, reassign, cancel and reopen it. Cancelling and reopening
 * need a reason. A task is never deleted.
 *
 * **Time.** Due and reminder moments arrive as the organization's wall-clock time and are stored in
 * UTC (CORE-TASK-002, ADR-0008); the organization-calendar due date is kept beside the instant, so a
 * calendar files a task on the day the organization sees, not the day the server does.
 */

/** Where a linked record sits in the organization, as its owning module reports it. */
export interface TaskLinkPlacement {
  legalEntityId: string;
  branchId?: string | undefined;
  departmentId?: string | undefined;
  teamId?: string | undefined;
  projectId?: string | undefined;
}

/** Resolve a linked record **as the actor sees it**; `undefined` (or a not-found throw) when not. */
export type TaskLinkResolver = (
  actor: ActorContext,
  type: TaskLinkType,
  id: string,
) => Promise<TaskLinkPlacement | undefined>;

/** The slice of `CORE-NOTIFY` tasks use. */
export interface TaskNotifier {
  notify(input: {
    type: 'task.assigned' | 'task.dueSoon' | 'task.overdue' | 'task.escalated';
    recipients: { accountIds: readonly string[] };
    params: Record<string, string>;
    source: { type: 'task'; id: string };
    dedupeKey: string;
    urgent?: boolean;
  }): Promise<unknown>;
}

export interface TaskServiceOptions {
  connection: Connection;
  audit: AuditRecorder;
  /** The organization timezone (ADR-0008). */
  timeZone: string;
  resolveLink: TaskLinkResolver;
  /** Only an active account can be given work. */
  isActiveAccount: (accountId: string) => Promise<boolean>;
  /** The assignee's direct manager, from `CORE-ORG` (G-09). `undefined` is reported, never guessed. */
  resolveManager?: (accountId: string) => Promise<string | undefined>;
  /** The `tasks.escalationDelayHours` setting; `null` escalates as soon as a task is overdue. */
  escalationDelayHours?: () => Promise<number | null>;
  notifier?: TaskNotifier;
  now?: () => Date;
}

export const TASK_SCOPE_FIELDS: ScopeFieldMap = {
  owner: 'createdBy',
  assignee: 'assigneeAccountId',
  team: 'teamId',
  department: 'departmentId',
  branch: 'branchId',
  project: 'projectId',
  legalEntity: 'legalEntityId',
};

const OPEN = [...OPEN_TASK_STATES];
const CALENDAR_LIMIT = 500;
const SWEEP_BATCH = 200;

const iso = (date: Date) => date.toISOString();

/** `dd/MM/yyyy`, the product's date format in both languages (`SD-23`), for notification text. */
const displayDate = (date: string) => date.split('-').reverse().join('/');

export class TaskService {
  private readonly tasks;
  private readonly now: () => Date;

  constructor(private readonly options: TaskServiceOptions) {
    this.tasks = taskModel(options.connection);
    this.now = options.now ?? (() => new Date());
  }

  /* ---------------------------------------------------------------- helpers */

  private toTask(document: TaskDocument): Task {
    const now = this.now();
    return TaskSchema.parse({
      taskId: document.taskId,
      title: document.title,
      ...(document.description ? { description: document.description } : {}),
      priority: document.priority,
      state: document.state,
      assigneeAccountId: document.assigneeAccountId,
      createdBy: document.createdBy,
      ...(document.link ? { link: { type: document.link.type, id: document.link.id } } : {}),
      dueAt: iso(document.dueAt),
      dueOn: document.dueOn,
      ...(document.remindAt ? { remindAt: iso(document.remindAt) } : {}),
      ...(document.reminderSentAt ? { reminderSentAt: iso(document.reminderSentAt) } : {}),
      overdue: OPEN.includes(document.state as (typeof OPEN)[number]) && document.dueAt <= now,
      ...(document.escalatedAt ? { escalatedAt: iso(document.escalatedAt) } : {}),
      ...(document.escalatedToAccountId
        ? { escalatedToAccountId: document.escalatedToAccountId }
        : {}),
      ...(document.completedAt ? { completedAt: iso(document.completedAt) } : {}),
      version: document.version,
      createdAt: iso(document.createdAt),
      updatedAt: iso(document.updatedAt),
    });
  }

  /** The three people a task always belongs to. */
  private mine(actor: ActorContext): Record<string, unknown> {
    return {
      $or: [
        { assigneeAccountId: actor.accountId },
        { escalatedToAccountId: actor.accountId },
        { createdBy: actor.accountId },
      ],
    };
  }

  /**
   * What an actor may see: their own tasks, plus — with `permission` — everything in their scope.
   * The scope is a query condition, never a filter applied afterwards (SEC-027).
   */
  private visible(actor: ActorContext, permission: 'task.view' | 'task.manage' = 'task.view') {
    const branches: Record<string, unknown>[] = [this.mine(actor)];
    if (can(actor, permission)) {
      const scope = buildScopeFilter(actor, TASK_SCOPE_FIELDS);
      if (!isMatchNothing(scope)) branches.push(scope);
    }
    return branches.length === 1 ? branches[0]! : { $or: branches };
  }

  private async findVisible(actor: ActorContext, taskId: string): Promise<TaskDocument> {
    assertSafeFilter({ taskId });
    const document = await this.tasks
      .findOne({ $and: [{ taskId }, this.visible(actor)] })
      .lean<TaskDocument>()
      .exec();
    if (!document) throw notFound();
    return document;
  }

  /** Creator, or `task.manage` inside scope. Anyone else who can see the task is refused. */
  private canManage(actor: ActorContext, task: TaskDocument): Promise<boolean> {
    if (task.createdBy === actor.accountId) return Promise.resolve(true);
    if (!can(actor, 'task.manage')) return Promise.resolve(false);
    const scope = buildScopeFilter(actor, TASK_SCOPE_FIELDS);
    if (isMatchNothing(scope)) return Promise.resolve(false);
    return this.tasks
      .exists({ $and: [{ taskId: task.taskId }, scope] })
      .exec()
      .then((found) => found !== null);
  }

  private async assertAssignable(accountId: string): Promise<void> {
    if (!(await this.options.isActiveAccount(accountId))) {
      throw invalid('ASSIGNEE_INACTIVE', ['assigneeAccountId']);
    }
  }

  private moment(value: { date: BusinessDate; time: string }): Date {
    return new Date(instantInZone(value.date, value.time, this.options.timeZone));
  }

  private async record(
    actor: ActorContext,
    action: string,
    taskId: string,
    context: RequestContext,
    changes: { path: string; from?: string; to?: string }[],
    options: { reason?: string; session?: ClientSession } = {},
  ) {
    await this.options.audit.record(
      {
        action,
        outcome: 'succeeded',
        actor: auditActor(actor),
        target: { type: 'task', id: taskId },
        changes,
        ...(options.reason ? { reason: options.reason } : {}),
        context,
      },
      options.session ? { session: options.session } : undefined,
    );
  }

  /** Tell a new assignee. Deduplicated per task, assignee and version, so a replay notifies no one twice. */
  private async notifyAssigned(task: TaskDocument): Promise<void> {
    if (task.assigneeAccountId === task.createdBy && task.version === 1) return;
    await this.options.notifier?.notify({
      type: 'task.assigned',
      recipients: { accountIds: [task.assigneeAccountId] },
      params: { title: task.title, dueOn: displayDate(task.dueOn) },
      source: { type: 'task', id: task.taskId },
      dedupeKey: `task:${task.taskId}:assigned:${task.assigneeAccountId}:${task.version}`,
      urgent: task.priority === 'urgent',
    });
  }

  /* ------------------------------------------------------------------ reads */

  async getTask(actor: ActorContext, taskId: string): Promise<Task> {
    return this.toTask(await this.findVisible(actor, taskId));
  }

  async listTasks(
    actor: ActorContext,
    query: {
      view: 'mine' | 'scope';
      state: 'open' | 'closed' | 'all';
      linkType?: TaskLinkType;
      linkId?: string;
      overdueOnly?: boolean;
      limit: number;
      cursor?: string;
    },
  ): Promise<{ items: Task[]; nextCursor?: string }> {
    if (query.view === 'scope' && !can(actor, 'task.view')) throw new DomainError('FORBIDDEN');
    assertSafeFilter({
      ...(query.linkType ? { linkType: query.linkType } : {}),
      ...(query.linkId ? { linkId: query.linkId } : {}),
    });
    const conditions: Record<string, unknown>[] = [
      query.view === 'mine' ? this.mine(actor) : this.visible(actor),
    ];
    if (query.state === 'open') conditions.push({ state: { $in: OPEN } });
    if (query.state === 'closed') conditions.push({ state: { $in: ['done', 'cancelled'] } });
    if (query.linkType) conditions.push({ 'link.type': query.linkType });
    if (query.linkId) conditions.push({ 'link.id': query.linkId });
    if (query.overdueOnly) conditions.push({ state: { $in: OPEN }, dueAt: { $lte: this.now() } });
    if (query.cursor) {
      const [time, id] = Buffer.from(query.cursor, 'base64url').toString('utf8').split('|');
      const at = time ? new Date(time) : undefined;
      if (!at || Number.isNaN(at.getTime()) || !id) throw invalid('CURSOR_INVALID', ['cursor']);
      conditions.push({ $or: [{ dueAt: { $gt: at } }, { dueAt: at, taskId: { $gt: id } }] });
    }
    const rows = await this.tasks
      .find({ $and: conditions })
      .sort({ dueAt: 1, taskId: 1 })
      .limit(query.limit + 1)
      .lean<TaskDocument[]>()
      .exec();
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => this.toTask(row)),
      ...(rows.length > query.limit && last
        ? {
            nextCursor: Buffer.from(`${iso(last.dueAt)}|${last.taskId}`, 'utf8').toString(
              'base64url',
            ),
          }
        : {}),
    };
  }

  /** Tasks due on each organization-calendar day of a range (CORE-TASK-004). */
  async calendar(
    actor: ActorContext,
    query: { from: BusinessDate; to: BusinessDate; view: 'mine' | 'scope' },
  ): Promise<{ items: Task[]; truncated: boolean }> {
    if (query.view === 'scope' && !can(actor, 'task.view')) throw new DomainError('FORBIDDEN');
    const rows = await this.tasks
      .find({
        $and: [
          query.view === 'mine' ? this.mine(actor) : this.visible(actor),
          { dueOn: { $gte: query.from, $lte: query.to } },
          { state: { $ne: 'cancelled' } },
        ],
      })
      .sort({ dueOn: 1, dueAt: 1, taskId: 1 })
      .limit(CALENDAR_LIMIT + 1)
      .lean<TaskDocument[]>()
      .exec();
    return {
      items: rows.slice(0, CALENDAR_LIMIT).map((row) => this.toTask(row)),
      truncated: rows.length > CALENDAR_LIMIT,
    };
  }

  /* ----------------------------------------------------------------- writes */

  async createTask(
    actor: ActorContext,
    input: {
      title: string;
      description?: string | undefined;
      priority: TaskPriority;
      assigneeAccountId: string;
      link?: { type: TaskLinkType; id: string } | undefined;
      due: { date: BusinessDate; time: string };
      reminder?: { date: BusinessDate; time: string } | undefined;
    },
    context: RequestContext,
  ): Promise<Task> {
    // A linked record is resolved as the creator sees it: outside their scope it does not exist.
    const placement = input.link
      ? await this.options.resolveLink(actor, input.link.type, input.link.id).catch(() => undefined)
      : undefined;
    if (input.link && !placement) throw notFound();
    await this.assertAssignable(input.assigneeAccountId);

    const dueAt = this.moment(input.due);
    const remindAt = input.reminder ? this.moment(input.reminder) : undefined;
    if (remindAt && remindAt > dueAt) throw invalid('REMINDER_AFTER_DUE', ['reminder']);

    const now = this.now();
    const document: TaskDocument = {
      taskId: newId('task'),
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      priority: input.priority,
      state: 'open',
      assigneeAccountId: input.assigneeAccountId,
      createdBy: actor.accountId,
      ...(input.link ? { link: { type: input.link.type, id: input.link.id } } : {}),
      ...(placement
        ? {
            legalEntityId: placement.legalEntityId,
            ...(placement.branchId ? { branchId: placement.branchId } : {}),
            ...(placement.departmentId ? { departmentId: placement.departmentId } : {}),
            ...(placement.teamId ? { teamId: placement.teamId } : {}),
            ...(placement.projectId ? { projectId: placement.projectId } : {}),
          }
        : {}),
      dueAt,
      dueOn: businessDateInZone(instantFromDate(dueAt), this.options.timeZone),
      ...(remindAt ? { remindAt } : {}),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await withTransaction(this.options.connection, async (session) => {
      await this.tasks.create([document], { session });
      await this.record(
        actor,
        TASK_AUDIT_ACTIONS.created,
        document.taskId,
        context,
        [
          { path: 'assignee', to: document.assigneeAccountId },
          { path: 'dueAt', to: iso(dueAt) },
          { path: 'priority', to: document.priority },
          ...(input.link ? [{ path: 'link', to: `${input.link.type}:${input.link.id}` }] : []),
        ],
        { session },
      );
    });
    await this.notifyAssigned(document);
    return this.toTask(document);
  }

  /**
   * Apply a change under optimistic concurrency. `expectedVersion` must match, and the task must
   * still be in a state that permits the change; otherwise nothing is written and the answer is 409.
   */
  private async apply(
    task: TaskDocument,
    expectedVersion: number,
    set: Partial<TaskDocument>,
    unset: (keyof TaskDocument)[],
    audit: (session: ClientSession) => Promise<void>,
  ): Promise<TaskDocument> {
    if (task.version !== expectedVersion) throw conflict('STALE_VERSION', ['expectedVersion']);
    return withTransaction(this.options.connection, async (session) => {
      const updated = await this.tasks
        .findOneAndUpdate(
          { taskId: task.taskId, version: expectedVersion },
          {
            $set: { ...set, updatedAt: this.now() },
            $inc: { version: 1 },
            ...(unset.length > 0
              ? { $unset: Object.fromEntries(unset.map((key) => [key, 1])) }
              : {}),
          },
          { new: true, session },
        )
        .lean<TaskDocument>()
        .exec();
      if (!updated) throw conflict('STALE_VERSION', ['expectedVersion']);
      await audit(session);
      return updated;
    });
  }

  async updateTask(
    actor: ActorContext,
    taskId: string,
    input: {
      expectedVersion: number;
      title?: string | undefined;
      description?: string | undefined;
      priority?: TaskPriority | undefined;
      due?: { date: BusinessDate; time: string } | undefined;
      reminder?: { date: BusinessDate; time: string } | null | undefined;
    },
    context: RequestContext,
  ): Promise<Task> {
    const task = await this.findVisible(actor, taskId);
    if (!(await this.canManage(actor, task))) throw new DomainError('FORBIDDEN');
    if (!OPEN.includes(task.state as (typeof OPEN)[number]))
      throw conflict('TASK_CLOSED', ['state']);

    const set: Partial<TaskDocument> = {};
    const unset: (keyof TaskDocument)[] = [];
    const changes: { path: string; from?: string; to?: string }[] = [];
    if (input.title !== undefined && input.title !== task.title) {
      set.title = input.title;
      changes.push({ path: 'title', from: task.title, to: input.title });
    }
    if (input.description !== undefined) {
      if (input.description) set.description = input.description;
      else unset.push('description');
      changes.push({ path: 'description', to: input.description ? 'changed' : 'removed' });
    }
    if (input.priority !== undefined && input.priority !== task.priority) {
      set.priority = input.priority;
      changes.push({ path: 'priority', from: task.priority, to: input.priority });
    }
    let dueAt = task.dueAt;
    if (input.due) {
      dueAt = this.moment(input.due);
      if (dueAt.getTime() !== task.dueAt.getTime()) {
        set.dueAt = dueAt;
        set.dueOn = businessDateInZone(instantFromDate(dueAt), this.options.timeZone);
        // A new due moment is a new commitment: overdue notice and escalation start afresh.
        unset.push('overdueNotifiedAt', 'escalatedAt', 'escalatedToAccountId');
        changes.push({ path: 'dueAt', from: iso(task.dueAt), to: iso(dueAt) });
      }
    }
    let remindAt = task.remindAt;
    if (input.reminder === null) {
      remindAt = undefined;
      unset.push('remindAt', 'reminderSentAt');
      changes.push({ path: 'remindAt', to: 'removed' });
    } else if (input.reminder) {
      remindAt = this.moment(input.reminder);
      set.remindAt = remindAt;
      unset.push('reminderSentAt');
      changes.push({ path: 'remindAt', to: iso(remindAt) });
    }
    if (remindAt && remindAt > dueAt) throw invalid('REMINDER_AFTER_DUE', ['reminder']);
    if (changes.length === 0) throw invalid('NOTHING_TO_CHANGE');

    const updated = await this.apply(task, input.expectedVersion, set, unset, (session) =>
      this.record(actor, TASK_AUDIT_ACTIONS.updated, taskId, context, changes, { session }),
    );
    return this.toTask(updated);
  }

  async transition(
    actor: ActorContext,
    taskId: string,
    input: { expectedVersion: number; state: TaskState; reason?: string | undefined },
    context: RequestContext,
  ): Promise<Task> {
    const task = await this.findVisible(actor, taskId);
    if (!TASK_TRANSITIONS[task.state].includes(input.state)) {
      throw conflict('TRANSITION_NOT_ALLOWED', ['state']);
    }
    const undoing = input.state === 'cancelled' || task.state === 'done';
    const isAssignee = task.assigneeAccountId === actor.accountId;
    // The assignee moves their own work along; cancelling and reopening belong to whoever set it.
    const allowed = undoing
      ? await this.canManage(actor, task)
      : isAssignee || (await this.canManage(actor, task));
    if (!allowed) throw new DomainError('FORBIDDEN');
    if (undoing && !input.reason) throw invalid('REASON_REQUIRED', ['reason']);

    const closing = input.state === 'done' || input.state === 'cancelled';
    const updated = await this.apply(
      task,
      input.expectedVersion,
      { state: input.state, ...(closing ? { completedAt: this.now() } : {}) },
      closing ? [] : ['completedAt'],
      (session) =>
        this.record(
          actor,
          TASK_AUDIT_ACTIONS.transitioned,
          taskId,
          context,
          [{ path: 'state', from: task.state, to: input.state }],
          { session, ...(input.reason ? { reason: input.reason } : {}) },
        ),
    );
    return this.toTask(updated);
  }

  async assign(
    actor: ActorContext,
    taskId: string,
    input: { expectedVersion: number; assigneeAccountId: string; reason: string },
    context: RequestContext,
  ): Promise<Task> {
    const task = await this.findVisible(actor, taskId);
    if (!(await this.canManage(actor, task))) throw new DomainError('FORBIDDEN');
    if (!OPEN.includes(task.state as (typeof OPEN)[number]))
      throw conflict('TASK_CLOSED', ['state']);
    if (input.assigneeAccountId === task.assigneeAccountId) throw invalid('NOTHING_TO_CHANGE');
    await this.assertAssignable(input.assigneeAccountId);
    const updated = await this.apply(
      task,
      input.expectedVersion,
      { assigneeAccountId: input.assigneeAccountId },
      // The new assignee's manager is a different person: escalation starts afresh.
      ['escalatedAt', 'escalatedToAccountId'],
      (session) =>
        this.record(
          actor,
          TASK_AUDIT_ACTIONS.assigned,
          taskId,
          context,
          [{ path: 'assignee', from: task.assigneeAccountId, to: input.assigneeAccountId }],
          { session, reason: input.reason },
        ),
    );
    await this.notifyAssigned(updated);
    return this.toTask(updated);
  }

  /**
   * Move every open task from one person to another — used when someone is offboarded
   * (CORE-TASK-005, G-08). Tasks they were assigned and tasks escalated to them both move; finished
   * and cancelled tasks keep their history untouched. Each moved task is its own audited change.
   */
  async reassignAll(
    actor: ActorContext,
    input: { fromAccountId: string; toAccountId: string; reason: string },
    context: RequestContext,
  ): Promise<{ reassigned: number }> {
    assertSafeFilter({ fromAccountId: input.fromAccountId, toAccountId: input.toAccountId });
    await this.assertAssignable(input.toAccountId);
    const scope = buildScopeFilter(actor, TASK_SCOPE_FIELDS);
    if (isMatchNothing(scope)) return { reassigned: 0 };
    const affected = await this.tasks
      .find({
        $and: [
          { state: { $in: OPEN } },
          {
            $or: [
              { assigneeAccountId: input.fromAccountId },
              { escalatedToAccountId: input.fromAccountId },
            ],
          },
          scope,
        ],
      })
      .lean<TaskDocument[]>()
      .exec();

    let reassigned = 0;
    for (const task of affected) {
      const set: Partial<TaskDocument> = {};
      const changes: { path: string; from?: string; to?: string }[] = [];
      if (task.assigneeAccountId === input.fromAccountId) {
        set.assigneeAccountId = input.toAccountId;
        changes.push({ path: 'assignee', from: input.fromAccountId, to: input.toAccountId });
      }
      if (task.escalatedToAccountId === input.fromAccountId) {
        set.escalatedToAccountId = input.toAccountId;
        changes.push({ path: 'escalatedTo', from: input.fromAccountId, to: input.toAccountId });
      }
      try {
        const updated = await this.apply(task, task.version, set, [], (session) =>
          this.record(actor, TASK_AUDIT_ACTIONS.reassigned, task.taskId, context, changes, {
            session,
            reason: input.reason,
          }),
        );
        reassigned += 1;
        if (set.assigneeAccountId) await this.notifyAssigned(updated);
      } catch (error) {
        // A task changed by someone else in the meantime is left to the next run, not overwritten.
        if (!(error instanceof DomainError && error.code === 'CONFLICT')) throw error;
      }
    }
    return { reassigned };
  }

  /* ------------------------------------------------------------------ sweep */

  /**
   * Send due reminders, tell assignees their task is overdue, and escalate overdue tasks to the
   * assignee's manager (CORE-TASK-002, CORE-TASK-003). Safe to run as often as wanted: every step is a
   * conditional update, and every notice carries a deduplication key tied to the moment it concerns.
   */
  async sweep(actor: ActorContext, context: RequestContext): Promise<TaskSweepResult> {
    const now = this.now();
    const result: TaskSweepResult = {
      reminded: 0,
      overdueNotified: 0,
      escalated: 0,
      unresolved: 0,
    };

    const reminders = await this.tasks
      .find({ state: { $in: OPEN }, remindAt: { $lte: now }, reminderSentAt: { $exists: false } })
      .limit(SWEEP_BATCH)
      .lean<TaskDocument[]>()
      .exec();
    for (const task of reminders) {
      if (!task.remindAt) continue;
      // Notify first: the key makes a repeat harmless, so a crash between the two loses nothing.
      await this.options.notifier?.notify({
        type: 'task.dueSoon',
        recipients: { accountIds: [task.assigneeAccountId] },
        params: { title: task.title, dueOn: displayDate(task.dueOn) },
        source: { type: 'task', id: task.taskId },
        dedupeKey: `task:${task.taskId}:reminder:${iso(task.remindAt)}`,
        urgent: task.priority === 'urgent',
      });
      const marked = await this.tasks
        .updateOne(
          { taskId: task.taskId, remindAt: task.remindAt, reminderSentAt: { $exists: false } },
          { $set: { reminderSentAt: now } },
        )
        .exec();
      if (marked.modifiedCount === 1) result.reminded += 1;
    }

    const overdue = await this.tasks
      .find({ state: { $in: OPEN }, dueAt: { $lte: now }, overdueNotifiedAt: { $exists: false } })
      .limit(SWEEP_BATCH)
      .lean<TaskDocument[]>()
      .exec();
    for (const task of overdue) {
      await this.options.notifier?.notify({
        type: 'task.overdue',
        recipients: { accountIds: [task.assigneeAccountId] },
        params: { title: task.title },
        source: { type: 'task', id: task.taskId },
        dedupeKey: `task:${task.taskId}:overdue:${iso(task.dueAt)}`,
        urgent: task.priority === 'urgent',
      });
      const marked = await this.tasks
        .updateOne(
          { taskId: task.taskId, dueAt: task.dueAt, overdueNotifiedAt: { $exists: false } },
          { $set: { overdueNotifiedAt: now } },
        )
        .exec();
      if (marked.modifiedCount === 1) result.overdueNotified += 1;
    }

    const delayHours = (await this.options.escalationDelayHours?.()) ?? 0;
    const escalateBefore = new Date(now.getTime() - delayHours * 3_600_000);
    const toEscalate = await this.tasks
      .find({
        state: { $in: OPEN },
        dueAt: { $lte: escalateBefore },
        escalatedAt: { $exists: false },
      })
      .limit(SWEEP_BATCH)
      .lean<TaskDocument[]>()
      .exec();
    for (const task of toEscalate) {
      const manager = await this.options.resolveManager?.(task.assigneeAccountId);
      // No manager, or a person who manages themselves: reported, never sent to an invented account.
      if (!manager || manager === task.assigneeAccountId) {
        result.unresolved += 1;
        continue;
      }
      const escalated = await withTransaction(this.options.connection, async (session) => {
        const updated = await this.tasks
          .findOneAndUpdate(
            { taskId: task.taskId, version: task.version, escalatedAt: { $exists: false } },
            {
              $set: { escalatedAt: now, escalatedToAccountId: manager, updatedAt: now },
              $inc: { version: 1 },
            },
            { new: true, session },
          )
          .lean<TaskDocument>()
          .exec();
        if (!updated) return false;
        await this.record(
          actor,
          TASK_AUDIT_ACTIONS.escalated,
          task.taskId,
          context,
          [
            { path: 'escalatedTo', to: manager },
            { path: 'dueAt', to: iso(task.dueAt) },
          ],
          { session },
        );
        return true;
      });
      if (!escalated) continue;
      result.escalated += 1;
      await this.options.notifier?.notify({
        type: 'task.escalated',
        recipients: { accountIds: [manager] },
        params: { title: task.title },
        source: { type: 'task', id: task.taskId },
        dedupeKey: `task:${task.taskId}:escalated:${iso(task.dueAt)}`,
        urgent: true,
      });
    }

    await this.options.audit.record({
      action: TASK_AUDIT_ACTIONS.swept,
      outcome: 'succeeded',
      actor: auditActor(actor),
      target: { type: 'task' },
      changes: Object.entries(result).map(([path, value]) => ({ path, to: String(value) })),
      context,
    });
    return result;
  }
}
