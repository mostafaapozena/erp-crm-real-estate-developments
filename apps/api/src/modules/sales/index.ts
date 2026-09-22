/**
 * SALE module published interface (ADR-0001).
 *
 * Owns reservations, contracts, and the installment schedule. It reaches inventory and CRM through
 * ports wired at the composition root, never by importing them, and it exposes two entry points for
 * the collections module: `applyPaymentToInstallment` and `recomputeContractTotals`, both of which
 * take the caller's transaction session so a receipt and the balance it changes commit together.
 */
export {
  CONTRACTS_COLLECTION,
  COUNTERS_COLLECTION,
  INSTALLMENTS_COLLECTION,
  RESERVATIONS_COLLECTION,
  SalesRecordUndeletableError,
  contractModel,
  counterModel,
  installmentModel,
  reservationModel,
} from './model';
export {
  INSTALLMENT_SCOPE_FIELDS,
  IdempotencyConflictError,
  SALES_SCOPE_FIELDS,
  SalesConflictError,
  SalesNotFoundError,
  SalesService,
  SalesValidationError,
} from './service';
export type {
  ApprovalPort,
  AuditRecorder,
  CrmPort,
  RequestContext,
  SalesServiceOptions,
  UnitPort,
} from './service';
export { salesRouter } from './router';
export type { SalesRouterOptions } from './router';
