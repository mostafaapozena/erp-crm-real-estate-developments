/**
 * INV module published interface (ADR-0001).
 *
 * Owns projects, buildings, units, and the unit timeline. It knows nothing about reservations or
 * contracts: those modules ask it to move a unit between statuses, passing their own transaction
 * session, and it refuses any move the state machine does not permit.
 */
export {
  BUILDINGS_COLLECTION,
  PROJECTS_COLLECTION,
  UNITS_COLLECTION,
  UNIT_EVENTS_COLLECTION,
  UnitHistoryImmutableError,
  UnitUndeletableError,
  buildingModel,
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
export { inventoryRouter } from './router';
export type { InventoryRouterOptions } from './router';
