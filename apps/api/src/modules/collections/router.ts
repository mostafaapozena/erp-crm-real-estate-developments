import {
  ChangeInstrumentStateSchema,
  CreateInstrumentSchema,
  GenerateRemindersSchema,
  InstrumentQuerySchema,
  ReceiptQuerySchema,
  RecordReceiptSchema,
  RecordIdSchema,
  ReminderActionSchema,
  ReminderQuerySchema,
  ReverseReceiptSchema,
  type ActorContext,
} from '@alola/contracts';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors';
import { currentActor, requirePermission, type GuardOptions } from '../../http/actor';
import { markAuditExempt } from '../../http/audit-context';
import { correlationIdOf } from '../../http/correlation';
import { validate, validated } from '../../http/validate';
import type { CollectionService, RequestContext } from './service';

/**
 * Collections HTTP surface — `COL-*` demonstration slice.
 *
 * There is deliberately **no** endpoint that edits a posted receipt. The only transition available is
 * reversal, and it needs its own permission (`collection.receipt.cancel`) and a reason.
 *
 * Every reminder response carries `deliveryConnected`, which is `false`, because no provider is
 * connected and the interface must never imply one (ADR-0026).
 */
export interface CollectionRouterOptions {
  getService: () => CollectionService;
  guard?: GuardOptions;
}

const ReceiptParamsSchema = z.strictObject({ receiptId: RecordIdSchema });
const InstrumentParamsSchema = z.strictObject({ instrumentId: RecordIdSchema });
const ReminderParamsSchema = z.strictObject({ reminderId: RecordIdSchema });

function requestContext(req: Request, res: Response, route: string): RequestContext {
  return {
    correlationId: correlationIdOf(res),
    method: req.method,
    route,
    ...(req.ip ? { ip: req.ip } : {}),
  };
}

function actorOf(res: Response): ActorContext {
  const actor = currentActor(res);
  if (!actor) throw new AppError('UNAUTHENTICATED', 401);
  return actor;
}

export function collectionRouter(options: CollectionRouterOptions): Router {
  const router = Router();
  const base = '/api/v1/collections';

  /* --------------------------------------------------------------- receipts */

  router.get(
    '/receipts',
    requirePermission('collection.receipt.view', options.guard),
    validate({ query: ReceiptQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof ReceiptQuerySchema._output>(res, 'query');
      res.json(await options.getService().listReceipts(actorOf(res), query));
    },
  );

  router.post(
    '/receipts',
    requirePermission('collection.receipt.create', options.guard),
    validate({ body: RecordReceiptSchema }),
    async (req, res) => {
      const body = validated<typeof RecordReceiptSchema._output>(res, 'body');
      const result = await options
        .getService()
        .recordReceipt(actorOf(res), body, requestContext(req, res, `${base}/receipts`));
      if (result.replayed) markAuditExempt(res);
      res.status(result.replayed ? 200 : 201).json(result.receipt);
    },
  );

  router.get(
    '/receipts/:receiptId',
    requirePermission('collection.receipt.view', options.guard),
    validate({ params: ReceiptParamsSchema }),
    async (_req, res) => {
      const { receiptId } = validated<typeof ReceiptParamsSchema._output>(res, 'params');
      res.json(await options.getService().getReceipt(actorOf(res), receiptId));
    },
  );

  router.post(
    '/receipts/:receiptId/reverse',
    requirePermission('collection.receipt.cancel', options.guard),
    validate({ params: ReceiptParamsSchema, body: ReverseReceiptSchema }),
    async (req, res) => {
      const { receiptId } = validated<typeof ReceiptParamsSchema._output>(res, 'params');
      const body = validated<typeof ReverseReceiptSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .reverseReceipt(
            actorOf(res),
            receiptId,
            body.reason,
            requestContext(req, res, `${base}/receipts/:receiptId/reverse`),
          ),
      );
    },
  );

  /* ------------------------------------------------------------ instruments */

  router.get(
    '/instruments',
    requirePermission('collection.instrument.view', options.guard),
    validate({ query: InstrumentQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof InstrumentQuerySchema._output>(res, 'query');
      res.json(await options.getService().listInstruments(actorOf(res), query));
    },
  );

  router.post(
    '/instruments',
    requirePermission('collection.instrument.manage', options.guard),
    validate({ body: CreateInstrumentSchema }),
    async (req, res) => {
      const body = validated<typeof CreateInstrumentSchema._output>(res, 'body');
      const created = await options
        .getService()
        .createInstrument(actorOf(res), body, requestContext(req, res, `${base}/instruments`));
      res.status(201).json(created);
    },
  );

  router.get(
    '/instruments/:instrumentId',
    requirePermission('collection.instrument.view', options.guard),
    validate({ params: InstrumentParamsSchema }),
    async (_req, res) => {
      const { instrumentId } = validated<typeof InstrumentParamsSchema._output>(res, 'params');
      res.json(await options.getService().getInstrument(actorOf(res), instrumentId));
    },
  );

  router.post(
    '/instruments/:instrumentId/state',
    requirePermission('collection.instrument.manage', options.guard),
    validate({ params: InstrumentParamsSchema, body: ChangeInstrumentStateSchema }),
    async (req, res) => {
      const { instrumentId } = validated<typeof InstrumentParamsSchema._output>(res, 'params');
      const body = validated<typeof ChangeInstrumentStateSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .changeInstrumentState(
            actorOf(res),
            instrumentId,
            body,
            requestContext(req, res, `${base}/instruments/:instrumentId/state`),
          ),
      );
    },
  );

  /* -------------------------------------------------------------- reminders */

  router.get(
    '/reminders',
    requirePermission('collection.reminder.view', options.guard),
    validate({ query: ReminderQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof ReminderQuerySchema._output>(res, 'query');
      const page = await options.getService().listReminders(actorOf(res), query);
      // Stated on the response, not only in the interface: no provider is connected (ADR-0026).
      res.json({ ...page, deliveryConnected: options.getService().deliveryConnected() });
    },
  );

  router.post(
    '/reminders/generate',
    requirePermission('collection.reminder.manage', options.guard),
    validate({ body: GenerateRemindersSchema }),
    async (req, res) => {
      const body = validated<typeof GenerateRemindersSchema._output>(res, 'body');
      const result = await options
        .getService()
        .generateReminders(
          actorOf(res),
          body,
          requestContext(req, res, `${base}/reminders/generate`),
        );
      // A sweep that created nothing changed nothing, so it has nothing to audit (AUDIT-003).
      if (result.created === 0) markAuditExempt(res);
      res.json(result);
    },
  );

  router.get(
    '/reminders/:reminderId',
    requirePermission('collection.reminder.view', options.guard),
    validate({ params: ReminderParamsSchema }),
    async (_req, res) => {
      const { reminderId } = validated<typeof ReminderParamsSchema._output>(res, 'params');
      res.json(await options.getService().getReminder(actorOf(res), reminderId));
    },
  );

  router.post(
    '/reminders/:reminderId/act',
    requirePermission('collection.reminder.manage', options.guard),
    validate({ params: ReminderParamsSchema, body: ReminderActionSchema }),
    async (req, res) => {
      const { reminderId } = validated<typeof ReminderParamsSchema._output>(res, 'params');
      const body = validated<typeof ReminderActionSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .actOnReminder(
            actorOf(res),
            reminderId,
            body,
            requestContext(req, res, `${base}/reminders/:reminderId/act`),
          ),
      );
    },
  );

  return router;
}
