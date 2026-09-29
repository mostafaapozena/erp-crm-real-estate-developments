/**
 * INV module published interface (ADR-0001).
 *
 * Owns projects, buildings, units, the unit timeline, price versions, timed holds and payment-plan
 * templates. It knows nothing about reservations or contracts: those modules ask it to move a unit
 * between statuses — or to hand a hold's unit to a reservation — passing their own transaction
 * session, and it refuses any move the state machine does not permit.
 */
export {
  BUILDINGS_COLLECTION,
  HOLDS_COLLECTION,
  PLAN_TEMPLATES_COLLECTION,
  PRICE_VERSIONS_COLLECTION,
  PROJECTS_COLLECTION,
  UNITS_COLLECTION,
  UNIT_EVENTS_COLLECTION,
  UnitHistoryImmutableError,
  UnitUndeletableError,
  buildingModel,
  holdModel,
  planTemplateModel,
  priceVersionModel,
  projectModel,
  unitEventModel,
  unitModel,
} from './model';
export {
  INVENTORY_SCOPE_FIELDS,
  InventoryConflictError,
  InventoryNotFoundError,
  InventoryService,
  UnitTransitionError,
} from './service';
export type { AuditRecorder, BranchResolver, RequestContext, UnitStatusChange } from './service';
export { INVENTORY_APPROVAL_OPERATIONS, approvalPercentage } from './approval-port';
export type { InventoryApprovalPort } from './approval-port';
export { PriceService } from './pricing';
export type { PriceServiceOptions } from './pricing';
export { HoldService } from './holds';
export type { HoldServiceOptions } from './holds';
export { PlanTemplateService } from './templates';
export type { PlanTemplateServiceOptions } from './templates';
export { inventoryRouter } from './router';
export type { InventoryRouterOptions } from './router';
