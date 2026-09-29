import {
  CONTRACT_STATES,
  CancelContractSchema,
  CancelReservationSchema,
  ExtendReservationSchema,
  ContractPageSchema,
  ContractSchema,
  ContractSummarySchema,
  CreateContractSchema,
  CreateReservationSchema,
  CustomerFinancialSummarySchema,
  INSTALLMENT_STATES,
  InstallmentListSchema,
  InstallmentPageSchema,
  InstallmentSchema,
  PaymentPlanSchema,
  PreviewScheduleSchema,
  RESERVATION_STATES,
  ReservationPageSchema,
  ReservationSchema,
  SchedulePreviewSchema,
  ScheduleRowSchema,
} from '@alola/contracts';
import { z } from 'zod';
import {
  pathParameter,
  queryParameter,
  requestBody,
  type OpenApiHelpers,
  type PathMap,
} from './shared';

/** The contract-creation response carries the schedule it generated, so one call shows the result. */
const CreateContractResultSchema = z.strictObject({
  contract: ContractSchema,
  installments: z.array(InstallmentSchema),
});

export const salesComponents = {
  PaymentPlan: PaymentPlanSchema,
  ScheduleRow: ScheduleRowSchema,
  SchedulePreview: SchedulePreviewSchema,
  PreviewScheduleRequest: PreviewScheduleSchema,
  Reservation: ReservationSchema,
  ReservationPage: ReservationPageSchema,
  CreateReservationRequest: CreateReservationSchema,
  CancelReservationRequest: CancelReservationSchema,
  ExtendReservationRequest: ExtendReservationSchema,
  Contract: ContractSchema,
  ContractPage: ContractPageSchema,
  CreateContractRequest: CreateContractSchema,
  CreateContractResult: CreateContractResultSchema,
  CancelContractRequest: CancelContractSchema,
  Installment: InstallmentSchema,
  InstallmentPage: InstallmentPageSchema,
  InstallmentList: InstallmentListSchema,
  ContractSummary: ContractSummarySchema,
  CustomerFinancialSummary: CustomerFinancialSummarySchema,
} as const;

export function salesPaths(h: OpenApiHelpers): PathMap {
  return {
    '/api/v1/sales/schedule/preview': {
      post: {
        operationId: 'previewSchedule',
        summary: 'Generate an installment schedule without storing anything',
        description:
          'Requires sales.reservation.view. Pure calculation: the preview a person approves on screen ' +
          'is produced by exactly the code that later stores the schedule, so the two cannot disagree. ' +
          'The response includes rowsTotal so a caller can see the reconciliation rather than trust it. ' +
          'A plan that cannot reconcile is refused here rather than at save time.',
        requestBody: requestBody(h.ref('PreviewScheduleRequest')),
        responses: {
          '200': h.json('SchedulePreview', 'The generated rows and their total'),
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/sales/reservations': {
      get: {
        operationId: 'listReservations',
        summary: 'List reservations',
        description:
          'Requires sales.reservation.view. Keyset pagination on createdAt desc; the total uses the ' +
          'same filter as the rows (SEC-028).',
        parameters: [
          queryParameter('limit', { type: 'integer', minimum: 1, maximum: 100, default: 25 }),
          queryParameter('cursor', { type: 'string' }),
          queryParameter('state', { type: 'string', enum: [...RESERVATION_STATES] }),
          queryParameter('projectId', { type: 'string' }),
          queryParameter('customerId', { type: 'string' }),
          queryParameter('unitId', { type: 'string' }),
          queryParameter('salesOwnerAccountId', { type: 'string' }),
        ],
        responses: {
          '200': h.json('ReservationPage', 'A page of reservations'),
          ...h.authorizedErrors,
        },
      },
      post: {
        operationId: 'createReservation',
        summary: 'Reserve a unit',
        description:
          'Requires sales.reservation.create. The reservation and the hold it takes on the unit ' +
          'commit in **one transaction**: a hold without a reservation is a unit nobody can sell, and ' +
          'the reverse is a double sale. A unit that is not available is refused. Idempotent: ' +
          'replaying the key returns the original reservation with 200 rather than taking a second ' +
          'hold, and replaying it with different input is a 409. When the agreed price is below the ' +
          'unit price and an approval policy applies, the reservation moves to pendingApproval and ' +
          'cannot be confirmed until the engine records an approval — including by the person who ' +
          'raised it. Since BMP-1: validity is sales.reservationValidityDays (BD-01), refused with ' +
          'RESERVATION_VALIDITY_NOT_CONFIGURED while unset; a discount above ' +
          'sales.maximumDiscountPercent (BD-03) needs a sales.reservation.priceOverride policy and a ' +
          'deposit below sales.reservationMinimumDeposit (BD-02) a sales.reservation.exception policy, ' +
          'or the request is refused (DISCOUNT_ABOVE_MAXIMUM, DEPOSIT_BELOW_MINIMUM) before anything is ' +
          'written; holdId converts a timed hold the actor holds; opportunityId moves the opportunity to ' +
          'reservation; concurrent requests for one unit: exactly one wins, the rest are ' +
          'UNIT_NOT_AVAILABLE; the number comes from CORE-DOC-001 when a format is active.',
        requestBody: requestBody(h.ref('CreateReservationRequest')),
        responses: {
          '201': h.json('Reservation', 'The reservation'),
          '200': h.json('Reservation', 'The original reservation, replayed'),
          ...h.conflictErrors,
        },
      },
    },
    '/api/v1/sales/reservations/expire': {
      post: {
        operationId: 'expireReservations',
        summary: 'Release holds whose deadline has passed',
        description:
          'Requires sales.reservation.cancel. Idempotent: the state is part of every update filter, ' +
          'so a second run finds nothing to do. One reservation that cannot be released is logged and ' +
          'the sweep continues.',
        responses: {
          '200': {
            description: 'How many holds were released',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { expired: { type: 'integer' } } },
              },
            },
          },
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/sales/reservations/{reservationId}': {
      get: {
        operationId: 'getReservation',
        summary: 'Read one reservation',
        description: 'Requires sales.reservation.view. Out of scope answers 404 (SEC-030).',
        parameters: [pathParameter('reservationId', 'Opaque reservation identifier')],
        responses: { '200': h.json('Reservation', 'The reservation'), ...h.notFoundErrors },
      },
    },
    '/api/v1/sales/reservations/{reservationId}/confirm': {
      post: {
        operationId: 'confirmReservation',
        summary: 'Confirm a reservation and move the unit from held to reserved',
        description:
          'Requires sales.reservation.confirm. A reservation awaiting a discount approval is refused ' +
          'until the engine records an approval, and the refusal is audited. The state is in the ' +
          'update filter, so two simultaneous confirmations cannot both apply.',
        parameters: [pathParameter('reservationId', 'Opaque reservation identifier')],
        responses: {
          '200': h.json('Reservation', 'The confirmed reservation'),
          ...h.conflictErrors,
        },
      },
    },
    '/api/v1/sales/reservations/{reservationId}/extend': {
      post: {
        operationId: 'extendReservation',
        summary: 'Extend a live reservation',
        description:
          'Requires sales.reservation.extend (SALE-RESERVE-003). Through the approval engine as ' +
          'sales.reservation.extension when a policy applies (pendingExtension until decided); at ' +
          'once otherwise. Extended from the later of today and the current expiry.',
        parameters: [pathParameter('reservationId', 'Opaque reservation identifier')],
        requestBody: requestBody(h.ref('ExtendReservationRequest')),
        responses: { '200': h.json('Reservation', 'The reservation'), ...h.conflictErrors },
      },
    },
    '/api/v1/sales/reservations/{reservationId}/cancel': {
      post: {
        operationId: 'cancelReservation',
        summary: 'Cancel a reservation and return the unit to the market',
        description:
          'Requires sales.reservation.cancel (SALE-RESERVE-005). With a policy governing ' +
          'sales.reservation.cancellation the reservation keeps its unit and carries ' +
          'pendingCancellation until the decision; otherwise it is cancelled at once, kept with its ' +
          'reason — never deleted (ADR-0009) — the unit returns to available, the opportunity to ' +
          'negotiation, and an agreed deposit becomes refundHandoff=pending for BMP-2, all in one ' +
          'transaction.',
        parameters: [pathParameter('reservationId', 'Opaque reservation identifier')],
        requestBody: requestBody(h.ref('CancelReservationRequest')),
        responses: {
          '200': h.json('Reservation', 'The cancelled reservation'),
          ...h.conflictErrors,
        },
      },
    },
    '/api/v1/sales/contracts': {
      get: {
        operationId: 'listContracts',
        summary: 'List contracts',
        description: 'Requires sales.contract.view.',
        parameters: [
          queryParameter('limit', { type: 'integer', minimum: 1, maximum: 100, default: 25 }),
          queryParameter('cursor', { type: 'string' }),
          queryParameter('state', { type: 'string', enum: [...CONTRACT_STATES] }),
          queryParameter('projectId', { type: 'string' }),
          queryParameter('customerId', { type: 'string' }),
          queryParameter('salesOwnerAccountId', { type: 'string' }),
        ],
        responses: { '200': h.json('ContractPage', 'A page of contracts'), ...h.authorizedErrors },
      },
      post: {
        operationId: 'createContract',
        summary: 'Convert a confirmed reservation into a contract and its schedule',
        description:
          'Requires sales.contract.create. The contract, every installment, the unit becoming ' +
          'contracted and the reservation becoming converted are **one transaction**. The contract ' +
          'number is allocated from an atomic counter and is immutable in the schema, not only in the ' +
          'service. The schedule is asserted to reconcile to the contract total before anything is ' +
          'stored. The reservation amount is credited against the earliest rows, because that is where ' +
          'a customer expects to see the deposit they paid. Idempotent on the key.',
        requestBody: requestBody(h.ref('CreateContractRequest')),
        responses: {
          '201': h.json('CreateContractResult', 'The contract and its generated schedule'),
          '200': h.json('CreateContractResult', 'The original contract, replayed'),
          ...h.conflictErrors,
        },
      },
    },
    '/api/v1/sales/contracts/{contractId}': {
      get: {
        operationId: 'getContract',
        summary: 'Read one contract',
        description: 'Requires sales.contract.view. Out of scope answers 404 (SEC-030).',
        parameters: [pathParameter('contractId', 'Opaque contract identifier')],
        responses: { '200': h.json('Contract', 'The contract'), ...h.notFoundErrors },
      },
    },
    '/api/v1/sales/contracts/{contractId}/installments': {
      get: {
        operationId: 'listContractInstallments',
        summary: "A contract's full schedule, in sequence",
        description: 'Requires sales.contract.view, and the contract itself must be visible.',
        parameters: [pathParameter('contractId', 'Opaque contract identifier')],
        responses: { '200': h.json('InstallmentList', 'The schedule'), ...h.notFoundErrors },
      },
    },
    '/api/v1/sales/contracts/{contractId}/cancel': {
      post: {
        operationId: 'cancelContract',
        summary: 'Cancel a contract',
        description:
          'Requires sales.contract.cancel. **Refused when any money has been collected**: reversing ' +
          'collected money is a refund, which is an accounting operation with its own controls, and a ' +
          'cancellation that stranded receipts would put the books out by exactly that amount. ' +
          'Installments are cancelled rather than deleted, and the unit optionally returns to the ' +
          'market in the same transaction.',
        parameters: [pathParameter('contractId', 'Opaque contract identifier')],
        requestBody: requestBody(h.ref('CancelContractRequest')),
        responses: { '200': h.json('Contract', 'The cancelled contract'), ...h.conflictErrors },
      },
    },
    '/api/v1/sales/installments': {
      get: {
        operationId: 'listInstallments',
        summary: 'The collection queues: due, overdue, and upcoming',
        description:
          'Requires collection.installment.view. bucket=overdue is strictly before today; bucket=due ' +
          'is today or earlier; bucket=upcoming is a forward window, 15 days by default, which is the ' +
          'reminder window. All three exclude paid and cancelled rows. Ordering is dueOn asc.',
        parameters: [
          queryParameter('limit', { type: 'integer', minimum: 1, maximum: 200, default: 50 }),
          queryParameter('cursor', { type: 'string' }),
          queryParameter('contractId', { type: 'string' }),
          queryParameter('customerId', { type: 'string' }),
          queryParameter('projectId', { type: 'string' }),
          queryParameter('state', { type: 'string', enum: [...INSTALLMENT_STATES] }),
          queryParameter('bucket', { type: 'string', enum: ['due', 'overdue', 'upcoming'] }),
          queryParameter('withinDays', { type: 'integer', minimum: 1, maximum: 365 }),
        ],
        responses: {
          '200': h.json('InstallmentPage', 'A page of installments'),
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/sales/installments/refresh': {
      post: {
        operationId: 'refreshInstallmentStates',
        summary: 'Move installments into due and overdue',
        description:
          'Requires collection.installment.view. Idempotent: each state is in its own filter, so a ' +
          'second run on the same day changes nothing. A run that moved rows records an audit event; ' +
          'a run that moved none records nothing rather than inventing evidence of a change.',
        responses: {
          '200': {
            description: 'How many rows moved into each state',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { due: { type: 'integer' }, overdue: { type: 'integer' } },
                },
              },
            },
          },
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/sales/contracts/summary': {
      get: {
        operationId: 'getContractSummary',
        summary: 'Contract portfolio totals, per currency',
        description:
          'Requires sales.contract.view. Totalled by the database in Decimal128 over every contract ' +
          "inside the actor's data scope — the scope is part of the match, so a total never includes " +
          'a contract the actor cannot open. One row per currency; currencies are never added together.',
        parameters: [queryParameter('state', { type: 'string', enum: [...CONTRACT_STATES] })],
        responses: {
          '200': h.json('ContractSummary', 'The totals'),
          ...h.authorizedErrors,
        },
      },
    },
    '/api/v1/sales/customers/{customerId}/summary': {
      get: {
        operationId: 'getCustomerFinancialSummary',
        summary: "A customer's contracted, paid, outstanding and overdue totals",
        description:
          'Requires sales.contract.view. Computed inside the scope, from the contracts and ' +
          'installments the actor can see.',
        parameters: [pathParameter('customerId', 'Opaque customer identifier')],
        responses: {
          '200': h.json('CustomerFinancialSummary', 'The summary'),
          ...h.notFoundErrors,
        },
      },
    },
  };
}
