import {
  CancelContractSchema,
  CancelReservationSchema,
  ContractQuerySchema,
  CreateContractSchema,
  CreateReservationSchema,
  InstallmentQuerySchema,
  PreviewScheduleSchema,
  RecordIdSchema,
  ReservationQuerySchema,
  type ActorContext,
} from '@alola/contracts';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors';
import { currentActor, requirePermission, type GuardOptions } from '../../http/actor';
import { markAuditExempt } from '../../http/audit-context';
import { correlationIdOf } from '../../http/correlation';
import { validate, validated } from '../../http/validate';
import type { RequestContext, SalesService } from './service';

/**
 * Sales HTTP surface — `SALE-*` demonstration slice.
 *
 * The schedule preview is a `POST` that changes nothing, so it declares itself audit-exempt: the
 * mutation-audit invariant would otherwise turn a successful preview into a 500 (AUDIT-003). It is one
 * of the few routes where that flag is correct, and the reason is that a preview is a calculation.
 */
export interface SalesRouterOptions {
  getService: () => SalesService;
  guard?: GuardOptions;
}

const ReservationParamsSchema = z.strictObject({ reservationId: RecordIdSchema });
const ContractParamsSchema = z.strictObject({ contractId: RecordIdSchema });
const CustomerParamsSchema = z.strictObject({ customerId: RecordIdSchema });

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

export function salesRouter(options: SalesRouterOptions): Router {
  const router = Router();
  const base = '/api/v1/sales';

  /* ------------------------------------------------------------- preview */

  router.post(
    '/schedule/preview',
    requirePermission('sales.reservation.view', options.guard),
    validate({ body: PreviewScheduleSchema }),
    (_req, res) => {
      const body = validated<typeof PreviewScheduleSchema._output>(res, 'body');
      // A calculation, not a mutation: nothing is stored and nothing is audited.
      markAuditExempt(res);
      res.json(options.getService().previewSchedule(body.total, body.paymentPlan));
    },
  );

  /* -------------------------------------------------------- reservations */

  router.get(
    '/reservations',
    requirePermission('sales.reservation.view', options.guard),
    validate({ query: ReservationQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof ReservationQuerySchema._output>(res, 'query');
      res.json(await options.getService().listReservations(actorOf(res), query));
    },
  );

  router.post(
    '/reservations',
    requirePermission('sales.reservation.create', options.guard),
    validate({ body: CreateReservationSchema }),
    async (req, res) => {
      const body = validated<typeof CreateReservationSchema._output>(res, 'body');
      const result = await options
        .getService()
        .createReservation(actorOf(res), body, requestContext(req, res, `${base}/reservations`));
      // A replay stored nothing, so it recorded no audit event either.
      if (result.replayed) markAuditExempt(res);
      res.status(result.replayed ? 200 : 201).json(result.reservation);
    },
  );

  /** The maintenance sweep: release holds whose deadline has passed. Idempotent. */
  router.post(
    '/reservations/expire',
    requirePermission('sales.reservation.cancel', options.guard),
    async (req, res) => {
      const result = await options
        .getService()
        .expireReservations(actorOf(res), requestContext(req, res, `${base}/reservations/expire`));
      if (result.expired === 0) markAuditExempt(res);
      res.json(result);
    },
  );

  router.get(
    '/reservations/:reservationId',
    requirePermission('sales.reservation.view', options.guard),
    validate({ params: ReservationParamsSchema }),
    async (_req, res) => {
      const { reservationId } = validated<typeof ReservationParamsSchema._output>(res, 'params');
      res.json(await options.getService().getReservation(actorOf(res), reservationId));
    },
  );

  router.post(
    '/reservations/:reservationId/confirm',
    requirePermission('sales.reservation.confirm', options.guard),
    validate({ params: ReservationParamsSchema }),
    async (req, res) => {
      const { reservationId } = validated<typeof ReservationParamsSchema._output>(res, 'params');
      res.json(
        await options
          .getService()
          .confirmReservation(
            actorOf(res),
            reservationId,
            requestContext(req, res, `${base}/reservations/:reservationId/confirm`),
          ),
      );
    },
  );

  router.post(
    '/reservations/:reservationId/cancel',
    requirePermission('sales.reservation.cancel', options.guard),
    validate({ params: ReservationParamsSchema, body: CancelReservationSchema }),
    async (req, res) => {
      const { reservationId } = validated<typeof ReservationParamsSchema._output>(res, 'params');
      const body = validated<typeof CancelReservationSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .cancelReservation(
            actorOf(res),
            reservationId,
            body.reason,
            requestContext(req, res, `${base}/reservations/:reservationId/cancel`),
          ),
      );
    },
  );

  /* ------------------------------------------------------------ contracts */

  router.get(
    '/contracts',
    requirePermission('sales.contract.view', options.guard),
    validate({ query: ContractQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof ContractQuerySchema._output>(res, 'query');
      res.json(await options.getService().listContracts(actorOf(res), query));
    },
  );

  router.post(
    '/contracts',
    requirePermission('sales.contract.create', options.guard),
    validate({ body: CreateContractSchema }),
    async (req, res) => {
      const body = validated<typeof CreateContractSchema._output>(res, 'body');
      const result = await options
        .getService()
        .createContract(actorOf(res), body, requestContext(req, res, `${base}/contracts`));
      if (result.replayed) markAuditExempt(res);
      res
        .status(result.replayed ? 200 : 201)
        .json({ contract: result.contract, installments: result.installments });
    },
  );

  router.get(
    '/contracts/:contractId',
    requirePermission('sales.contract.view', options.guard),
    validate({ params: ContractParamsSchema }),
    async (_req, res) => {
      const { contractId } = validated<typeof ContractParamsSchema._output>(res, 'params');
      res.json(await options.getService().getContract(actorOf(res), contractId));
    },
  );

  router.get(
    '/contracts/:contractId/installments',
    requirePermission('sales.contract.view', options.guard),
    validate({ params: ContractParamsSchema }),
    async (_req, res) => {
      const { contractId } = validated<typeof ContractParamsSchema._output>(res, 'params');
      res.json({
        items: await options.getService().listContractInstallments(actorOf(res), contractId),
      });
    },
  );

  router.post(
    '/contracts/:contractId/cancel',
    requirePermission('sales.contract.cancel', options.guard),
    validate({ params: ContractParamsSchema, body: CancelContractSchema }),
    async (req, res) => {
      const { contractId } = validated<typeof ContractParamsSchema._output>(res, 'params');
      const body = validated<typeof CancelContractSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .cancelContract(
            actorOf(res),
            contractId,
            body,
            requestContext(req, res, `${base}/contracts/:contractId/cancel`),
          ),
      );
    },
  );

  /* --------------------------------------------------------- installments */

  router.get(
    '/installments',
    requirePermission('collection.installment.view', options.guard),
    validate({ query: InstallmentQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof InstallmentQuerySchema._output>(res, 'query');
      res.json(await options.getService().listInstallments(actorOf(res), query));
    },
  );

  /**
   * Move installments into `due` and `overdue`. Idempotent; a second run on the same day changes
   * nothing. A run that moved rows is audited by the service; a run that moved none is exempt,
   * because there is nothing to record.
   */
  router.post(
    '/installments/refresh',
    requirePermission('collection.installment.view', options.guard),
    async (req, res) => {
      const result = await options
        .getService()
        .refreshInstallmentStates(
          actorOf(res),
          requestContext(req, res, `${base}/installments/refresh`),
        );
      if (result.due === 0 && result.overdue === 0) markAuditExempt(res);
      res.json(result);
    },
  );

  router.get(
    '/customers/:customerId/summary',
    requirePermission('sales.contract.view', options.guard),
    validate({ params: CustomerParamsSchema }),
    async (_req, res) => {
      const { customerId } = validated<typeof CustomerParamsSchema._output>(res, 'params');
      res.json(await options.getService().customerSummary(actorOf(res), customerId));
    },
  );

  return router;
}
