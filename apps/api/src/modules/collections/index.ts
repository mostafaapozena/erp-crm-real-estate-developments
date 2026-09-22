/**
 * COL module published interface (ADR-0001).
 *
 * Owns receipts, cheques and promissory notes, and the reminder centre. It reaches sales, CRM and
 * inventory through ports wired at the composition root.
 *
 * The delivery port has **no connected implementation** and the only one that exists refuses to run
 * outside development. Every reminder response states `deliveryConnected: false` (ADR-0026).
 */
export {
  INSTRUMENTS_COLLECTION,
  RECEIPTS_COLLECTION,
  REMINDERS_COLLECTION,
  InstrumentUndeletableError,
  ReceiptImmutableError,
  instrumentModel,
  receiptModel,
  reminderModel,
} from './model';
export {
  COLLECTION_SCOPE_FIELDS,
  CollectionConflictError,
  CollectionNotFoundError,
  CollectionService,
  CollectionValidationError,
} from './service';
export type {
  AuditRecorder,
  CollectionServiceOptions,
  CustomerPort,
  RequestContext,
  SalesPort,
  UnitLookupPort,
} from './service';
export {
  SimulatedDeliveryNotPermittedError,
  SimulatedReminderDelivery,
  composeReminderMessage,
} from './delivery';
export type { ReminderDeliveryAdapter } from './delivery';
export { collectionRouter } from './router';
export type { CollectionRouterOptions } from './router';
