/**
 * CORE-ORG module published interface (ADR-0001, ADR-0019).
 *
 * Owns the organization hierarchy and the placement of people inside it. It holds **no** employee
 * business data and **no** authentication state: `accountId` and `employeeRef` are opaque references
 * to `SEC` and to the future `HR-EMP`.
 *
 * Two things outside this module depend on it and reach it only through here:
 *
 * - data scopes, which resolve against the hierarchy (SEC-026);
 * - approval escalation, through `resolveManagerAccount` (`APPROVAL-005`).
 */
export {
  BRANCHES_COLLECTION,
  DEPARTMENTS_COLLECTION,
  JOB_TITLES_COLLECTION,
  LEGAL_ENTITIES_COLLECTION,
  PLACEMENTS_COLLECTION,
  PLACEMENT_HISTORY_COLLECTION,
  TEAMS_COLLECTION,
  OrgRecordUndeletableError,
  branchModel,
  departmentModel,
  jobTitleModel,
  legalEntityModel,
  placementHistoryModel,
  placementModel,
  teamModel,
} from './model';
export {
  ORG_SCOPE_FIELDS,
  OrgCodeConflictError,
  OrgNotFoundError,
  OrganizationService,
  ReportingCycleError,
} from './service';
export type { AuditRecorder, OrganizationServiceOptions, RequestContext } from './service';
export { organizationRouter } from './router';
export type { OrgRouterOptions } from './router';
