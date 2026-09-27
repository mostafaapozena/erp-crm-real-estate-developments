/**
 * Number sequences published interface (CORE-DOC-001).
 *
 * Modules issue numbers through `NumberingService.issue`, passing their own transaction session so
 * the number and the document commit together. There is no HTTP route that issues a number.
 */
export {
  COUNTERS_COLLECTION as NUMBER_COUNTERS_COLLECTION,
  ISSUED_NUMBERS_COLLECTION,
  SEQUENCES_COLLECTION as NUMBER_SEQUENCES_COLLECTION,
  counterModel as numberCounterModel,
  issuedNumberModel,
  sequenceModel as numberSequenceModel,
} from './model';
export { NumberingService, render as renderNumber } from './service';
export type { IssueRequest, Issuer, NumberingServiceOptions } from './service';
export { numberingRouter } from './router';
export type { NumberingRouterOptions } from './router';
