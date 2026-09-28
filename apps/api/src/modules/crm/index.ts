/**
 * CRM module published interface (ADR-0001).
 *
 * Owns customers, leads, the CRM timeline, consent and ownership history. The sales module reaches it
 * only through here, to read a customer or a lead and to advance a lead's stage inside a reservation
 * or contract transaction.
 */
export {
  ACTIVITIES_COLLECTION,
  CONSENTS_COLLECTION,
  CUSTOMERS_COLLECTION,
  LEADS_COLLECTION,
  OWNERSHIP_CHANGES_COLLECTION,
  ActivityImmutableError,
  CrmRecordUndeletableError,
  activityModel,
  consentModel,
  customerModel,
  leadModel,
  ownershipChangeModel,
} from './model';
export {
  CUSTOMER_SCOPE_FIELDS,
  CrmConflictError,
  CrmNotFoundError,
  CrmService,
  LEAD_SCOPE_FIELDS,
  LeadStageError,
  LostReasonRequiredError,
  placementInScope,
} from './service';
export type {
  AccountDescriber,
  AuditRecorder,
  BranchResolver,
  CrmServiceOptions,
  ReasonCodeCheck,
  RequestContext,
} from './service';
export { leadImporter } from './importer';
export type { BranchCodeResolver, LeadImportRow } from './importer';
export { crmRouter } from './router';
export type { CrmRouterOptions } from './router';
