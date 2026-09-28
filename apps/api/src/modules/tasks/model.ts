import { TASK_PRIORITIES, TASK_STATES, type TaskLinkType } from '@alola/contracts';
import { Schema, type Connection, type Model } from 'mongoose';

/**
 * Task storage (CORE-TASK-001 … 005).
 *
 * `tasks` holds one row per task: who owes it, by when (UTC), about which record, and the
 * organization placement its scope filter reads. A task is completed or cancelled — never deleted —
 * and every change to one is an audit record, which is its history.
 */
export const TASKS_COLLECTION = 'tasks';

export class TaskRecordImmutableError extends Error {
  readonly code = 'CONFLICT';
  constructor(readonly operation: string) {
    super(`Tasks are completed or cancelled, never deleted: "${operation}" is refused.`);
    this.name = 'TaskRecordImmutableError';
  }
}

export interface TaskDocument {
  taskId: string;
  title: string;
  description?: string;
  priority: (typeof TASK_PRIORITIES)[number];
  state: (typeof TASK_STATES)[number];
  assigneeAccountId: string;
  createdBy: string;
  link?: { type: TaskLinkType; id: string };
  /** Data-scope fields: the linked record's placement, or none for a personal task (SEC-027). */
  legalEntityId?: string;
  branchId?: string;
  departmentId?: string;
  teamId?: string;
  projectId?: string;
  dueAt: Date;
  /** The due date in the organization's calendar, fixed when the due moment is set (ADR-0008). */
  dueOn: string;
  remindAt?: Date;
  reminderSentAt?: Date;
  overdueNotifiedAt?: Date;
  escalatedAt?: Date;
  escalatedToAccountId?: string;
  /** Set when an overdue sweep found no manager to escalate to; cleared by a new due date. */
  escalationUnresolvedAt?: Date;
  completedAt?: Date;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const DELETE_OPS = [
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findOneAndReplace',
  'replaceOne',
];

function taskSchema(): Schema<TaskDocument> {
  const schema = new Schema<TaskDocument>(
    {
      taskId: { type: String, required: true },
      title: { type: String, required: true },
      description: { type: String },
      priority: { type: String, required: true, enum: TASK_PRIORITIES },
      state: { type: String, required: true, enum: TASK_STATES },
      assigneeAccountId: { type: String, required: true },
      createdBy: { type: String, required: true },
      link: new Schema(
        { type: { type: String, required: true }, id: { type: String, required: true } },
        { _id: false },
      ),
      legalEntityId: { type: String },
      branchId: { type: String },
      departmentId: { type: String },
      teamId: { type: String },
      projectId: { type: String },
      dueAt: { type: Date, required: true },
      dueOn: { type: String, required: true },
      remindAt: { type: Date },
      reminderSentAt: { type: Date },
      overdueNotifiedAt: { type: Date },
      escalatedAt: { type: Date },
      escalatedToAccountId: { type: String },
      escalationUnresolvedAt: { type: Date },
      completedAt: { type: Date },
      version: { type: Number, required: true },
      createdAt: { type: Date, required: true },
      updatedAt: { type: Date, required: true },
    },
    { collection: TASKS_COLLECTION, strict: 'throw', versionKey: false, timestamps: false },
  );
  schema.index({ taskId: 1 }, { unique: true, name: 'tasks_id_unique' });
  // "My tasks": assigned to me, or escalated to me, by due moment.
  schema.index({ assigneeAccountId: 1, state: 1, dueAt: 1 }, { name: 'tasks_assignee' });
  schema.index({ escalatedToAccountId: 1, state: 1, dueAt: 1 }, { name: 'tasks_escalatedTo' });
  schema.index({ 'link.type': 1, 'link.id': 1 }, { name: 'tasks_link' });
  // The sweep: owed tasks whose reminder or due moment has passed.
  schema.index({ state: 1, remindAt: 1 }, { name: 'tasks_reminder_due' });
  schema.index({ state: 1, dueAt: 1 }, { name: 'tasks_overdue' });
  // Scope-filtered lists and the calendar.
  schema.index({ branchId: 1, dueOn: 1 }, { name: 'tasks_scope_branch' });
  schema.index({ teamId: 1, dueOn: 1 }, { name: 'tasks_scope_team' });
  schema.index({ dueOn: 1, taskId: 1 }, { name: 'tasks_calendar' });
  for (const operation of DELETE_OPS) {
    schema.pre(operation as 'deleteOne', function refuseOperation() {
      throw new TaskRecordImmutableError(operation);
    });
  }
  return schema;
}

export function taskModel(connection: Connection): Model<TaskDocument> {
  return (
    (connection.models[TASKS_COLLECTION] as Model<TaskDocument> | undefined) ??
    connection.model<TaskDocument>(TASKS_COLLECTION, taskSchema())
  );
}
