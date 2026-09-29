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
  QUOTATIONS_COLLECTION,
  RESERVATIONS_COLLECTION,
  SalesRecordUndeletableError,
  contractModel,
  counterModel,
  installmentModel,
  quotationModel,
  reservationModel,
} from './model';
export { QUOTATION_SCOPE_FIELDS, QuotationService } from './quotations';
export type {
  QuotationRecipientPort,
  QuotationServiceOptions,
  QuotationUnitPort,
} from './quotations';
export { amendmentRows, partyIssues, samePlan } from './contract-rules';
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
  ContractCustomerPort,
  CrmPort,
  HistoryPort,
  HoldPort,
  SignedCopyPort,
  UnitSnapshotPort,
  NumberPort,
  OpportunityPort,
  RequestContext,
  ReservationPolicies,
  SalesServiceOptions,
  UnitPort,
} from './service';
export {
  combinedOutcome,
  minimumDepositFor,
  requiredApprovals,
  reservationExceptions,
} from './reservation-rules';
export type { DepositRule } from './reservation-rules';
export { salesRouter } from './router';
export type { SalesRouterOptions } from './router';
