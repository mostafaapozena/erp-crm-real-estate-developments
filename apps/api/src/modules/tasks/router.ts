import {
  AssignTaskSchema,
  CreateTaskSchema,
  ReassignTasksSchema,
  RecordIdSchema,
  TaskCalendarQuerySchema,
  TaskListQuerySchema,
  TaskTransitionSchema,
  UpdateTaskSchema,
} from '@alola/contracts';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuthenticated, requirePermission, type GuardOptions } from '../../http/actor';
import { requestContextOf, requireActor } from '../../http/request-context';
import { validate, validated } from '../../http/validate';
import type { TaskService } from './service';

/**
 * Tasks HTTP surface (CORE-TASK).
 *
 * Reading one's own tasks needs only a session. Creating needs `task.create`; the service decides
 * per task who may change it (assignee, creator, or `task.manage` in scope), and refuses a task the
 * caller cannot see with `404`. Moving someone's whole workload and running the sweep by hand are
 * administrative.
 */
export interface TaskRouterOptions {
  getService: () => TaskService;
  guard?: GuardOptions;
}

const IdParamsSchema = z.strictObject({ taskId: RecordIdSchema });

export function taskRouter(options: TaskRouterOptions): Router {
  const router = Router();
  const base = '/api/v1/tasks';
  const service = () => options.getService();
  const idParams = (res: Parameters<typeof validated>[0]) =>
    validated<typeof IdParamsSchema._output>(res, 'params').taskId;

  router.get(
    '/',
    requireAuthenticated(options.guard),
    validate({ query: TaskListQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof TaskListQuerySchema._output>(res, 'query');
      res.json(await service().listTasks(requireActor(res), query));
    },
  );

  router.get(
    '/calendar',
    requireAuthenticated(options.guard),
    validate({ query: TaskCalendarQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof TaskCalendarQuerySchema._output>(res, 'query');
      res.json(await service().calendar(requireActor(res), query));
    },
  );

  router.post(
    '/',
    requirePermission('task.create', options.guard),
    validate({ body: CreateTaskSchema }),
    async (req, res) => {
      const body = validated<typeof CreateTaskSchema._output>(res, 'body');
      res
        .status(201)
        .json(
          await service().createTask(requireActor(res), body, requestContextOf(req, res, base)),
        );
    },
  );

  router.post(
    '/reassign',
    requirePermission('task.reassign', options.guard),
    validate({ body: ReassignTasksSchema }),
    async (req, res) => {
      const body = validated<typeof ReassignTasksSchema._output>(res, 'body');
      res.json(
        await service().reassignAll(
          requireActor(res),
          body,
          requestContextOf(req, res, `${base}/reassign`),
        ),
      );
    },
  );

  router.post('/sweep', requirePermission('task.sweep', options.guard), async (req, res) => {
    res.json(await service().sweep(requireActor(res), requestContextOf(req, res, `${base}/sweep`)));
  });

  router.get(
    '/:taskId',
    requireAuthenticated(options.guard),
    validate({ params: IdParamsSchema }),
    async (_req, res) => {
      res.json(await service().getTask(requireActor(res), idParams(res)));
    },
  );

  router.patch(
    '/:taskId',
    requireAuthenticated(options.guard),
    validate({ params: IdParamsSchema, body: UpdateTaskSchema }),
    async (req, res) => {
      const body = validated<typeof UpdateTaskSchema._output>(res, 'body');
      res.json(
        await service().updateTask(
          requireActor(res),
          idParams(res),
          body,
          requestContextOf(req, res, `${base}/:taskId`),
        ),
      );
    },
  );

  router.post(
    '/:taskId/transition',
    requireAuthenticated(options.guard),
    validate({ params: IdParamsSchema, body: TaskTransitionSchema }),
    async (req, res) => {
      const body = validated<typeof TaskTransitionSchema._output>(res, 'body');
      res.json(
        await service().transition(
          requireActor(res),
          idParams(res),
          body,
          requestContextOf(req, res, `${base}/:taskId/transition`),
        ),
      );
    },
  );

  router.post(
    '/:taskId/assign',
    requireAuthenticated(options.guard),
    validate({ params: IdParamsSchema, body: AssignTaskSchema }),
    async (req, res) => {
      const body = validated<typeof AssignTaskSchema._output>(res, 'body');
      res.json(
        await service().assign(
          requireActor(res),
          idParams(res),
          body,
          requestContextOf(req, res, `${base}/:taskId/assign`),
        ),
      );
    },
  );

  return router;
}
