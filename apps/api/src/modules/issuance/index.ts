/**
 * Issued documents published interface (CORE-DOC-003, CORE-DOC-005).
 *
 * Generates business PDFs from records read through the owning modules' scoped ports (wired at the
 * composition root — this module imports no business module, ADR-0001), stores each file as a version
 * in the documents module, and answers the public QR verification.
 */
export {
  ISSUED_DOCUMENTS_COLLECTION,
  IssuedDocumentUndeletableError,
  issuedDocumentModel,
} from './model';
export { ISSUED_SCOPE_FIELDS, IssuanceService } from './service';
export type { IssuanceServiceOptions, IssuanceSources, LoadedSource } from './service';
export type { CompanyForDocument, SourceData } from './builders';
export { issuanceRouter, verificationRouter } from './router';
export type { IssuanceRouterOptions, VerificationRouterOptions } from './router';
