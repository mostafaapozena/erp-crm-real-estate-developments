/**
 * Documents and templates published interface (CORE-DOC-002, CORE-DOC-004, CORE-DOC-006).
 *
 * A document is attached to a record through `OwnerResolver`, wired at the composition root to each
 * owning module's **scoped** getter — this module imports no business module (ADR-0001).
 */
export {
  DOCUMENTS_COLLECTION,
  DOCUMENT_TEMPLATES_COLLECTION,
  DOCUMENT_VERSIONS_COLLECTION,
  documentModel,
  documentVersionModel,
  templateModel,
} from './model';
export { DOCUMENT_SCOPE_FIELDS, DocumentService } from './service';
export type { DocumentServiceOptions, OwnerPlacement, OwnerResolver } from './service';
export { TemplateService, placeholdersIn, renderTemplate } from './templates';
export type { TemplateServiceOptions } from './templates';
export { documentRouter, fileRouter, templateRouter } from './router';
export type { DocumentRouterOptions } from './router';
