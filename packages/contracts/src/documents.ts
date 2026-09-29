import { z } from 'zod';
import { EnteredNameSchema, RecordIdSchema } from './identifiers';
import { LocaleSchema } from './localized';
import { BusinessDateSchema, InstantSchema } from './time';

/**
 * Documents and templates (CORE-DOC-002, CORE-DOC-004, CORE-DOC-006; SEC-005, SEC-008).
 *
 * A **document** is a file attached to a business record — a signed reservation form, an ID copy, a
 * receipt scan — kept in versions that are never overwritten. Who may see it is decided by the record
 * it belongs to: the document inherits that record's data scope when it is uploaded (SEC-027).
 *
 * A **template** is the bilingual text a generated document or message is built from. A published
 * template version is immutable, so a contract generated last year can always be explained with the
 * exact wording it was generated from. No legal wording is shipped: templates are the deployment's own
 * content (`SD-10`), and the product only validates them.
 */

/** The records a document may belong to. */
export const DOCUMENT_OWNER_TYPES = [
  'lead',
  'customer',
  'project',
  'building',
  'unit',
  'reservation',
  'contract',
  'receipt',
  'company',
] as const;
export const DocumentOwnerTypeSchema = z.enum(DOCUMENT_OWNER_TYPES);
export type DocumentOwnerType = z.infer<typeof DocumentOwnerTypeSchema>;

/**
 * Accepted content, decided by the bytes, not the declared type (SEC-005). PDF and images only: an
 * office document is a container that can carry macros, and there is no scanner yet to vouch for one.
 */
export const DOCUMENT_CONTENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;

export const DOCUMENT_STATES = ['active', 'archived', 'quarantined'] as const;
export const SCAN_STATUSES = ['not_scanned', 'clean', 'infected'] as const;

/** The file name as shown and offered on download — sanitized by the server, never a storage key. */
export const DocumentFileNameSchema = z.string().min(1).max(160);

export const DocumentVersionSchema = z.strictObject({
  version: z.number().int().positive(),
  fileName: DocumentFileNameSchema,
  contentType: z.enum(DOCUMENT_CONTENT_TYPES),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** `not_scanned` is untrusted, never clean (SEC-005). `infected` quarantines the document. */
  scanStatus: z.enum(SCAN_STATUSES),
  uploadedAt: InstantSchema,
  uploadedBy: z.string(),
});
export type DocumentVersion = z.infer<typeof DocumentVersionSchema>;

export const BusinessDocumentSchema = z.strictObject({
  documentId: RecordIdSchema,
  owner: z.strictObject({ type: DocumentOwnerTypeSchema, id: z.string().min(1).max(80) }),
  /** A code from the deployment's `documentTypes` reference list. */
  category: z.string().min(1).max(40),
  title: EnteredNameSchema,
  state: z.enum(DOCUMENT_STATES),
  currentVersion: z.number().int().positive(),
  versions: z.array(DocumentVersionSchema),
  /** Retained at least until this date; a legal hold keeps it regardless. */
  retainUntil: BusinessDateSchema.optional(),
  legalHold: z.boolean(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type BusinessDocument = z.infer<typeof BusinessDocumentSchema>;

export const DocumentListSchema = z.strictObject({
  items: z.array(BusinessDocumentSchema),
  nextCursor: z.string().optional(),
});

/** Upload metadata travels in the query string; the body is the file itself. */
export const UploadDocumentQuerySchema = z.strictObject({
  ownerType: DocumentOwnerTypeSchema,
  ownerId: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9_-]+$/),
  category: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  title: EnteredNameSchema,
  fileName: z.string().min(1).max(255),
});
export type UploadDocumentQuery = z.infer<typeof UploadDocumentQuerySchema>;

export const UploadVersionQuerySchema = z.strictObject({
  fileName: z.string().min(1).max(255),
  expectedVersion: z.coerce.number().int().positive(),
});

export const DocumentQuerySchema = z.strictObject({
  ownerType: DocumentOwnerTypeSchema.optional(),
  ownerId: z.string().min(1).max(80).optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(200).optional(),
});

export const ArchiveDocumentSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});

export const RetentionSchema = z.strictObject({
  retainUntil: BusinessDateSchema.optional(),
  legalHold: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});

/** A short-lived link to one version. Issuing it is what is audited as the download (CORE-DOC-006). */
export const DownloadLinkSchema = z.strictObject({
  url: z.string().min(1),
  expiresAt: InstantSchema,
  fileName: DocumentFileNameSchema,
  contentType: z.enum(DOCUMENT_CONTENT_TYPES),
  scanStatus: z.enum(SCAN_STATUSES),
});
export type DownloadLink = z.infer<typeof DownloadLinkSchema>;

export const DownloadRequestSchema = z.strictObject({
  version: z.number().int().positive().optional(),
  /** `download` saves the file; `print` is recorded separately, because G-03 asks who printed. */
  purpose: z.enum(['download', 'print']).default('download'),
});

/* --------------------------------------------------------------- templates */

export const TEMPLATE_KINDS = [
  'reservationForm',
  'contract',
  'contractAmendment',
  'installmentSchedule',
  'receipt',
  'invoice',
  'customerStatement',
  'internalForm',
  'message',
] as const;
export const TemplateKindSchema = z.enum(TEMPLATE_KINDS);
export type TemplateKind = z.infer<typeof TemplateKindSchema>;

export const PLACEHOLDER_TYPES = ['text', 'money', 'date', 'number', 'identifier'] as const;

/**
 * Every placeholder a template may use, by kind. A template naming anything else is refused when it
 * is published — a misspelt placeholder would otherwise print literally on a customer's contract.
 */
const COMPANY_PLACEHOLDERS = {
  'company.legalName': 'text',
  'company.tradeName': 'text',
  'company.commercialRegistration': 'identifier',
  'company.taxRegistration': 'identifier',
  'company.address': 'text',
  'company.phone': 'identifier',
  'company.footer': 'text',
  'document.number': 'identifier',
  'document.date': 'date',
} as const;
const CUSTOMER_PLACEHOLDERS = {
  'customer.name': 'text',
  'customer.phone': 'identifier',
} as const;
const UNIT_PLACEHOLDERS = {
  'project.name': 'text',
  'unit.code': 'identifier',
  'unit.area': 'number',
} as const;

export const TEMPLATE_PLACEHOLDERS: Record<
  TemplateKind,
  Record<string, (typeof PLACEHOLDER_TYPES)[number]>
> = {
  reservationForm: {
    ...COMPANY_PLACEHOLDERS,
    ...CUSTOMER_PLACEHOLDERS,
    ...UNIT_PLACEHOLDERS,
    'reservation.amount': 'money',
    'reservation.expiresOn': 'date',
  },
  contract: {
    ...COMPANY_PLACEHOLDERS,
    ...CUSTOMER_PLACEHOLDERS,
    ...UNIT_PLACEHOLDERS,
    'contract.totalPrice': 'money',
    'contract.signedOn': 'date',
    'contract.downPayment': 'money',
    'contract.installmentCount': 'number',
  },
  contractAmendment: {
    ...COMPANY_PLACEHOLDERS,
    ...CUSTOMER_PLACEHOLDERS,
    'contract.number': 'identifier',
    'amendment.summary': 'text',
    'amendment.effectiveOn': 'date',
  },
  installmentSchedule: {
    ...COMPANY_PLACEHOLDERS,
    ...CUSTOMER_PLACEHOLDERS,
    'contract.number': 'identifier',
    'schedule.total': 'money',
    'schedule.count': 'number',
  },
  receipt: {
    ...COMPANY_PLACEHOLDERS,
    ...CUSTOMER_PLACEHOLDERS,
    'receipt.amount': 'money',
    'receipt.method': 'text',
    'contract.number': 'identifier',
  },
  invoice: {
    ...COMPANY_PLACEHOLDERS,
    ...CUSTOMER_PLACEHOLDERS,
    'invoice.total': 'money',
    'invoice.tax': 'money',
    'invoice.dueOn': 'date',
  },
  customerStatement: {
    ...COMPANY_PLACEHOLDERS,
    ...CUSTOMER_PLACEHOLDERS,
    'statement.balance': 'money',
    'statement.asOf': 'date',
  },
  internalForm: { ...COMPANY_PLACEHOLDERS, 'form.subject': 'text' },
  message: {
    'company.tradeName': 'text',
    ...CUSTOMER_PLACEHOLDERS,
    'installment.amount': 'money',
    'installment.dueOn': 'date',
    'contract.number': 'identifier',
  },
};

export const TEMPLATE_STATES = ['draft', 'published', 'retired'] as const;

/** `{{ key }}` — a placeholder reference in a template body. */
export const PLACEHOLDER_PATTERN =
  /\{\{\s*([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+)\s*\}\}/g;

const TemplateBodySchema = z.string().trim().min(1).max(50_000);

const templateFields = {
  name: z.strictObject({
    ar: z.string().trim().min(1).max(160),
    en: z.string().trim().min(1).max(160),
  }),
  /** Both languages, always: a document is generated in the customer's language (CORE-DOC-002). */
  bodies: z.strictObject({ ar: TemplateBodySchema, en: TemplateBodySchema }),
  effectiveFrom: BusinessDateSchema,
  effectiveTo: BusinessDateSchema.optional(),
  /** Narrows where the version applies; the most specific published match wins. */
  selectors: z
    .strictObject({
      projectId: RecordIdSchema.optional(),
      unitType: z.string().min(1).max(40).optional(),
    })
    .default({}),
};

export const CreateTemplateSchema = z
  .strictObject({
    templateKey: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/, { message: 'TEMPLATE_KEY_EXPECTED' }),
    kind: TemplateKindSchema,
    ...templateFields,
  })
  .refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
    message: 'EFFECTIVE_RANGE_INVERTED',
    path: ['effectiveTo'],
  });
export type CreateTemplate = z.infer<typeof CreateTemplateSchema>;

export const UpdateTemplateDraftSchema = z
  .strictObject(templateFields)
  .refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
    message: 'EFFECTIVE_RANGE_INVERTED',
    path: ['effectiveTo'],
  });
export type UpdateTemplateDraft = z.infer<typeof UpdateTemplateDraftSchema>;

export const TemplateSchema = z.strictObject({
  templateKey: z.string(),
  kind: TemplateKindSchema,
  version: z.number().int().positive(),
  state: z.enum(TEMPLATE_STATES),
  name: templateFields.name,
  bodies: templateFields.bodies,
  effectiveFrom: BusinessDateSchema,
  effectiveTo: BusinessDateSchema.optional(),
  selectors: z.strictObject({ projectId: z.string().optional(), unitType: z.string().optional() }),
  /** The placeholders the bodies use — derived, never declared by hand. */
  placeholders: z.array(z.string()),
  /** Set the first time a real document is generated from it. */
  firstUsedAt: InstantSchema.optional(),
  createdAt: InstantSchema,
  publishedAt: InstantSchema.optional(),
});
export type Template = z.infer<typeof TemplateSchema>;

export const TemplateListSchema = z.strictObject({ items: z.array(TemplateSchema) });

export const PublishTemplateSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});

export const PreviewTemplateSchema = z.strictObject({ locale: LocaleSchema });

export const TemplatePreviewSchema = z.strictObject({
  locale: LocaleSchema,
  /** The body with synthetic sample values — never a real customer's data. */
  text: z.string(),
});

export const DOCUMENT_AUDIT_ACTIONS = {
  uploaded: 'document.uploaded',
  versionAdded: 'document.versionAdded',
  downloaded: 'document.downloaded',
  printed: 'document.printed',
  archived: 'document.archived',
  retentionChanged: 'document.retentionChanged',
  quarantined: 'document.quarantined',
  templateCreated: 'template.created',
  templateUpdated: 'template.updated',
  templatePublished: 'template.published',
  templateRetired: 'template.retired',
} as const;

/** Largest file accepted. A scanned contract is a few megabytes; anything larger is a mistake. */
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
