import {
  AssignTaskSchema,
  CreateTaskSchema,
  ReassignTasksSchema,
  TASK_CALENDAR_MAX_DAYS,
  TaskPageSchema,
  TaskSchema,
  TaskSweepResultSchema,
  TaskTransitionSchema,
  UpdateTaskSchema,
} from '@alola/contracts';
import { z } from 'zod';
import {
  pathParameter,
  queryParameter,
  requestBody,
  type OpenApiHelpers,
  type PathMap,
} from './shared';

/** Schemas tasks contribute (CORE-TASK-001 … 005). */
export const taskComponents = {
  Task: TaskSchema,
  TaskPage: TaskPageSchema,
  TaskCalendar: z.strictObject({ items: z.array(TaskSchema), truncated: z.boolean() }),
  CreateTask: CreateTaskSchema,
  UpdateTask: UpdateTaskSchema,
  TaskTransition: TaskTransitionSchema,
  AssignTask: AssignTaskSchema,
  ReassignTasks: ReassignTasksSchema,
  ReassignTasksResult: z.strictObject({ reassigned: z.number().int().nonnegative() }),
  TaskSweepResult: TaskSweepResultSchema,
} as const;

const VISIBILITY =
  'A task is always visible to its assignee, the person it escalated to, and its creator. With ' +
  'task.view, also every task inside the caller’s data scope — a linked task carries its ' +
  'record’s placement. A task the caller cannot see is answered as absent (404).';
const CHANGE =
  'The caller must be the task’s creator or hold task.manage within scope; otherwise 403. ' +
  'expectedVersion must match (409 STALE_VERSION).';

export function taskPaths(h: OpenApiHelpers): PathMap {
  const view = [
    queryParameter('view', { type: 'string', enum: ['mine', 'scope'], default: 'mine' }),
  ];
  const id = [pathParameter('taskId', 'Opaque task identifier')];
  const absent = { '404': h.json('ErrorResponse', 'Absent, or outside the caller’s reach') };
  const stale = { '409': h.json('ErrorResponse', 'Stale version, or a disallowed transition') };
  return {
    '/api/v1/tasks': {
      get: {
        operationId: 'listTasks',
        summary: 'Tasks, soonest due first',
        description: `${VISIBILITY} view=scope requires task.view.`,
        parameters: [
          ...view,
          queryParameter('state', {
            type: 'string',
            enum: ['open', 'closed', 'all'],
            default: 'open',
          }),
          queryParameter('linkType', { type: 'string' }),
          queryParameter('linkId', { type: 'string' }),
          queryParameter('overdueOnly', { type: 'string', enum: ['true', 'false'] }),
          queryParameter('limit', { type: 'integer', minimum: 1, maximum: 100, default: 50 }),
          queryParameter('cursor', { type: 'string' }),
        ],
        responses: { '200': h.json('TaskPage', 'A page of tasks'), ...h.authorizedErrors },
      },
      post: {
        operationId: 'createTask',
        summary: 'Create a task',
        description:
          'Requires task.create. Due and reminder moments are wall-clock times in the organization ' +
          'timezone, stored as UTC (CORE-TASK-002). A linked record is resolved as the caller sees it ' +
          '(404 when outside scope); the assignee must be an active account (ASSIGNEE_INACTIVE).',
        requestBody: requestBody(h.ref('CreateTask')),
        responses: { '201': h.json('Task', 'The task'), ...absent, ...h.authorizedErrors },
      },
    },
    '/api/v1/tasks/calendar': {
      get: {
        operationId: 'getTaskCalendar',
        summary: 'Tasks by organization-calendar day',
        description: `${VISIBILITY} At most ${String(TASK_CALENDAR_MAX_DAYS)} days; cancelled tasks are omitted.`,
        parameters: [
          queryParameter('from', { type: 'string', format: 'date' }),
          queryParameter('to', { type: 'string', format: 'date' }),
          ...view,
        ],
        responses: { '200': h.json('TaskCalendar', 'The tasks in range'), ...h.authorizedErrors },
      },
    },
    '/api/v1/tasks/{taskId}': {
      get: {
        operationId: 'getTask',
        summary: 'One task',
        description: VISIBILITY,
        parameters: id,
        responses: { '200': h.json('Task', 'The task'), ...absent, ...h.authorizedErrors },
      },
      patch: {
        operationId: 'updateTask',
        summary: 'Edit a task',
        description: `${CHANGE} A new due moment restarts the overdue notice and escalation.`,
        parameters: id,
        requestBody: requestBody(h.ref('UpdateTask')),
        responses: {
          '200': h.json('Task', 'The task'),
          ...absent,
          ...stale,
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/tasks/{taskId}/transition': {
      post: {
        operationId: 'transitionTask',
        summary: 'Start, finish, reopen or cancel a task',
        description:
          'The assignee may start, finish, or put back a task; cancelling and reopening a finished ' +
          `task need a reason and the creator or task.manage. ${CHANGE}`,
        parameters: id,
        requestBody: requestBody(h.ref('TaskTransition')),
        responses: {
          '200': h.json('Task', 'The task'),
          ...absent,
          ...stale,
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/tasks/{taskId}/assign': {
      post: {
        operationId: 'assignTask',
        summary: 'Give a task to someone else',
        description: `${CHANGE} The new assignee must be active and is notified.`,
        parameters: id,
        requestBody: requestBody(h.ref('AssignTask')),
        responses: {
          '200': h.json('Task', 'The task'),
          ...absent,
          ...stale,
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/tasks/reassign': {
      post: {
        operationId: 'reassignTasks',
        summary: 'Move all of one person’s open tasks to another',
        description:
          'Requires the administrative task.reassign (CORE-TASK-005). Moves open tasks assigned or ' +
          'escalated to the person, within the caller’s scope; finished tasks are untouched; each ' +
          'move is audited with the reason.',
        requestBody: requestBody(h.ref('ReassignTasks')),
        responses: {
          '200': h.json('ReassignTasksResult', 'How many moved'),
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/tasks/sweep': {
      post: {
        operationId: 'sweepTasks',
        summary: 'Send due reminders and escalate overdue tasks, now',
        description:
          'Requires the administrative task.sweep. Idempotent: reminders, overdue notices and ' +
          'escalations each happen once per due moment. An assignee without a resolvable manager is ' +
          'reported as unresolved, never escalated to a guess (CORE-TASK-003).',
        responses: {
          '200': h.json('TaskSweepResult', 'What the sweep did'),
          ...h.authorizedErrors,
        },
      },
    },
  };
}
