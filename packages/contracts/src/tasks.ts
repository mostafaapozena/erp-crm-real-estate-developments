import { z } from 'zod';
import { DocumentOwnerTypeSchema } from './documents';
import { RecordIdSchema } from './identifiers';
import { BusinessDateSchema, InstantSchema, LocalTimeSchema } from './time';

/**
 * Tasks (CORE-TASK-001 … 005).
 *
 * A task is a piece of work owed by one person by a moment in time, optionally about one business
 * record. The foundation guarantees:
 *
 * - **An owner, a due moment, a priority and an optional link** (CORE-TASK-001). A linked task is as
 *   visible as the record it is about: the link is resolved *as the creator sees it*, and the task
 *   inherits that record's organization placement for its own scope.
 * - **Times are entered in the organization's calendar and stored in UTC** (CORE-TASK-002, ADR-0008).
 *   "Due 17:00 on the 5th" means 17:00 where the organization is, whatever the server's clock says.
 * - **An overdue task escalates to the assignee's direct manager** (CORE-TASK-003, G-09) — once, and
 *   reported *unresolved* rather than sent to an invented manager when no reporting line exists.
 * - **A calendar** (CORE-TASK-004) reads the same scoped query by local date.
 * - **An offboarded person's open tasks can be moved** in one audited action (CORE-TASK-005, G-08).
 *
 * Tasks are never deleted: a task is completed or cancelled, and both are kept.
 */

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const TaskPrioritySchema = z.enum(TASK_PRIORITIES);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TASK_STATES = ['open', 'inProgress', 'done', 'cancelled'] as const;
export const TaskStateSchema = z.enum(TASK_STATES);
export type TaskState = z.infer<typeof TaskStateSchema>;
/** States in which a task is still owed. */
export const OPEN_TASK_STATES = ['open', 'inProgress'] as const satisfies readonly TaskState[];

/** Records a task can be about — the same set a document can belong to, except company papers. */
export const TaskLinkTypeSchema = DocumentOwnerTypeSchema.exclude(['company']);
export type TaskLinkType = z.infer<typeof TaskLinkTypeSchema>;

/** A moment in the organization's calendar: a date and a wall-clock time. */
export const LocalMomentSchema = z.strictObject({
  date: BusinessDateSchema,
  time: LocalTimeSchema,
});

const TitleSchema = z.string().trim().min(1).max(200);
const DescriptionSchema = z.string().trim().max(2000);
const ReasonSchema = z.string().trim().min(3).max(300);

export const TaskSchema = z.strictObject({
  taskId: RecordIdSchema,
  title: z.string(),
  description: z.string().optional(),
  priority: TaskPrioritySchema,
  state: TaskStateSchema,
  assigneeAccountId: z.string(),
  createdBy: z.string(),
  link: z.strictObject({ type: TaskLinkTypeSchema, id: z.string() }).optional(),
  dueAt: InstantSchema,
  /** The due date in the organization's calendar — what a calendar files the task under. */
  dueOn: BusinessDateSchema,
  remindAt: InstantSchema.optional(),
  reminderSentAt: InstantSchema.optional(),
  overdue: z.boolean(),
  escalatedAt: InstantSchema.optional(),
  escalatedToAccountId: z.string().optional(),
  completedAt: InstantSchema.optional(),
  version: z.number().int().positive(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskSchema = z.strictObject({
  title: TitleSchema,
  description: DescriptionSchema.optional(),
  priority: TaskPrioritySchema.default('normal'),
  assigneeAccountId: RecordIdSchema,
  link: z.strictObject({ type: TaskLinkTypeSchema, id: RecordIdSchema }).optional(),
  due: LocalMomentSchema,
  reminder: LocalMomentSchema.optional(),
});
export type CreateTaskInput = z.input<typeof CreateTaskSchema>;

export const UpdateTaskSchema = z
  .strictObject({
    expectedVersion: z.number().int().positive(),
    title: TitleSchema.optional(),
    description: DescriptionSchema.optional(),
    priority: TaskPrioritySchema.optional(),
    due: LocalMomentSchema.optional(),
    /** `null` removes the reminder. */
    reminder: LocalMomentSchema.nullable().optional(),
  })
  .refine(
    (input) =>
      input.title !== undefined ||
      input.description !== undefined ||
      input.priority !== undefined ||
      input.due !== undefined ||
      input.reminder !== undefined,
    { message: 'NOTHING_TO_CHANGE' },
  );
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

export const TaskTransitionSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  state: TaskStateSchema,
  /** Required to cancel or to reopen: both undo a commitment someone else may rely on. */
  reason: ReasonSchema.optional(),
});

/**
 * The moves a task may make. Done and cancelled are kept for ever; a finished task can be reopened
 * (with a reason) but a cancelled one cannot — raise a new task instead, so the cancellation stands.
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  open: ['inProgress', 'done', 'cancelled'],
  inProgress: ['open', 'done', 'cancelled'],
  done: ['open'],
  cancelled: [],
};

export const AssignTaskSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  assigneeAccountId: RecordIdSchema,
  reason: ReasonSchema,
});

export const ReassignTasksSchema = z
  .strictObject({
    fromAccountId: RecordIdSchema,
    toAccountId: RecordIdSchema,
    reason: ReasonSchema,
  })
  .refine((input) => input.fromAccountId !== input.toAccountId, { message: 'SAME_ACCOUNT' });

export const TaskListQuerySchema = z.strictObject({
  /** `mine`: assigned to or escalated to the caller. `scope`: everything the caller's scope reaches. */
  view: z.enum(['mine', 'scope']).default('mine'),
  state: z.enum(['open', 'closed', 'all']).default('open'),
  linkType: TaskLinkTypeSchema.optional(),
  linkId: RecordIdSchema.optional(),
  overdueOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(200).optional(),
});

/** At most six weeks: one month as a calendar grid shows it. */
export const TASK_CALENDAR_MAX_DAYS = 42;

export const TaskCalendarQuerySchema = z
  .strictObject({
    from: BusinessDateSchema,
    to: BusinessDateSchema,
    view: z.enum(['mine', 'scope']).default('mine'),
  })
  .refine((query) => query.from <= query.to, { message: 'RANGE_INVERTED' })
  .refine(
    (query) =>
      (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000 < TASK_CALENDAR_MAX_DAYS,
    { message: 'RANGE_TOO_LONG' },
  );

export const TaskPageSchema = z.strictObject({
  items: z.array(TaskSchema),
  nextCursor: z.string().optional(),
});

export const TaskSweepResultSchema = z.strictObject({
  reminded: z.number().int().nonnegative(),
  overdueNotified: z.number().int().nonnegative(),
  escalated: z.number().int().nonnegative(),
  /** Overdue tasks whose assignee has no resolvable, active manager. Reported, never guessed. */
  unresolved: z.number().int().nonnegative(),
});
export type TaskSweepResult = z.infer<typeof TaskSweepResultSchema>;

export const TASK_AUDIT_ACTIONS = {
  created: 'task.created',
  updated: 'task.updated',
  transitioned: 'task.transitioned',
  assigned: 'task.assigned',
  reassigned: 'task.reassigned',
  escalated: 'task.escalated',
  swept: 'task.swept',
} as const;
