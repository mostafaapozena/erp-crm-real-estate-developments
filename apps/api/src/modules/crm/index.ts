/**
 * CRM module published interface (ADR-0001).
 *
 * Owns customers, leads and the lead timeline. The sales module reaches it only through here, to read
 * a lead and to advance its stage inside a reservation or contract transaction.
 */
export {
  ACTIVITIES_COLLECTION,
  CUSTOMERS_COLLECTION,
  LEADS_COLLECTION,
  ActivityImmutableError,
  CrmRecordUndeletableError,
  activityModel,
  customerModel,
  leadModel,
} from './model';
export {
  CUSTOMER_SCOPE_FIELDS,
  CrmConflictError,
  CrmNotFoundError,
  CrmService,
  LEAD_SCOPE_FIELDS,
  LeadStageError,
  LostReasonRequiredError,
} from './service';
export type { AuditRecorder, BranchResolver, RequestContext } from './service';
export { crmRouter } from './router';
export type { CrmRouterOptions } from './router';
