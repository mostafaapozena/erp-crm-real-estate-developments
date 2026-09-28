/**
 * Tasks published interface (CORE-TASK-001 … 005).
 *
 * Modules reach tasks only through `TaskService`; linked records are resolved through a port wired at
 * the composition root, and notices go through `CORE-NOTIFY`.
 */
export { TASKS_COLLECTION, taskModel } from './model';
export { TASK_SCOPE_FIELDS, TaskService } from './service';
export type {
  TaskLinkPlacement,
  TaskLinkResolver,
  TaskNotifier,
  TaskServiceOptions,
} from './service';
export { taskRouter } from './router';
export type { TaskRouterOptions } from './router';
