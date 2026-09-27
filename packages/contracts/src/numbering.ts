import { z } from 'zod';
import { BusinessCodeSchema } from './identifiers';
import { BusinessDateSchema, InstantSchema } from './time';

/**
 * Central number sequences (CORE-DOC-001, ADR-0009, ADR-0027).
 *
 * One engine numbers every business document a deployment issues. Its guarantees are the ones an
 * auditor checks first:
 *
 * - **Atomic and gapless within a period.** The counter increment and the ledger entry recording the
 *   issued number commit in one transaction; an issue that fails leaves no number behind.
 * - **Idempotent.** An issue carries an idempotency key; replaying it returns the same number.
 * - **Never reused.** An issued number is immutable. Cancelling the document voids the number; the
 *   number stays in the ledger and the counter never goes back.
 * - **Unique by construction.** The ledger's unique index on type + number refuses a collision, even
 *   one a format change could produce.
 *
 * Official formats per document type are a stakeholder input (`SD-10`); nothing is seeded. A
 * deployment defines and activates its own formats through configuration.
 */

export const SEQUENCE_TYPES = [
  'customer',
  'lead',
  'reservation',
  'contract',
  'receipt',
  'invoice',
  'creditNote',
  'debitNote',
  'journalEntry',
  'payment',
  'cheque',
  'promissoryNote',
  'purchaseRequest',
  'purchaseOrder',
  'supplier',
  'employee',
  'asset',
] as const;
export const SequenceTypeSchema = z.enum(SEQUENCE_TYPES);
export type SequenceType = z.infer<typeof SequenceTypeSchema>;

/** The date part of a number, taken from the issue date in the organization's calendar. */
export const DATE_COMPONENTS = ['none', 'yyyy', 'yy', 'yyyyMM', 'fiscalYear'] as const;
export const RESET_POLICIES = ['never', 'yearly', 'monthly', 'fiscalYearly'] as const;
export const SEQUENCE_STATES = ['draft', 'active', 'retired'] as const;

/** Fixed text around the number. Upper-case letters, digits and `-`, never user data. */
const AffixSchema = z.string().regex(/^[A-Z0-9][A-Z0-9-]{0,11}$/, { message: 'AFFIX_EXPECTED' });

const sequenceFormatFields = {
  prefix: AffixSchema,
  suffix: AffixSchema.optional(),
  separator: z.enum(['-', '/', '']),
  dateComponent: z.enum(DATE_COMPONENTS),
  /** Include the issuing legal entity's code, and number each entity separately (CORE-DOC-001). */
  entityComponent: z.boolean().default(false),
  /** Include the issuing branch's code, and number each branch separately. */
  branchComponent: z.boolean(),
  /** Include the project's code, and number each project separately. */
  projectComponent: z.boolean(),
  padding: z.number().int().min(3).max(10),
  resetPolicy: z.enum(RESET_POLICIES),
  /** The first counter value of every series. */
  startAt: z.number().int().min(1).max(1_000_000),
};

/**
 * A reset without a date component in the number would issue `RCT-00001` again every period, and the
 * ledger would refuse it — so the combination is refused when the format is written instead.
 */
function resetIsVisible(format: {
  resetPolicy: (typeof RESET_POLICIES)[number];
  dateComponent: (typeof DATE_COMPONENTS)[number];
}): boolean {
  switch (format.resetPolicy) {
    case 'never':
      return true;
    case 'yearly':
      return ['yyyy', 'yy', 'yyyyMM'].includes(format.dateComponent);
    case 'monthly':
      return format.dateComponent === 'yyyyMM';
    case 'fiscalYearly':
      return format.dateComponent === 'fiscalYear';
  }
}
const RESET_ISSUE = { message: 'RESET_WITHOUT_DATE_COMPONENT', path: ['dateComponent'] };

export const CreateSequenceSchema = z
  .strictObject({
    type: SequenceTypeSchema,
    ...sequenceFormatFields,
    effectiveFrom: BusinessDateSchema,
  })
  .refine(resetIsVisible, RESET_ISSUE);
export type CreateSequence = z.infer<typeof CreateSequenceSchema>;

export const UpdateSequenceDraftSchema = z
  .strictObject({ ...sequenceFormatFields, effectiveFrom: BusinessDateSchema })
  .refine(resetIsVisible, RESET_ISSUE);
export type UpdateSequenceDraft = z.infer<typeof UpdateSequenceDraftSchema>;

export const SequenceSchema = z.strictObject({
  type: SequenceTypeSchema,
  version: z.number().int().positive(),
  ...sequenceFormatFields,
  effectiveFrom: BusinessDateSchema,
  state: z.enum(SEQUENCE_STATES),
  /** What a number in this format looks like, from sample data: `RCT-CAI-2026-00001`. */
  example: z.string(),
  createdAt: InstantSchema,
  activatedAt: InstantSchema.optional(),
  retiredAt: InstantSchema.optional(),
});
export type Sequence = z.infer<typeof SequenceSchema>;

export const SequenceListSchema = z.strictObject({ items: z.array(SequenceSchema) });

export const ActivateSequenceSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});

/** What issuing — or previewing — a number needs to know. */
export const IssueContextSchema = z.strictObject({
  type: SequenceTypeSchema,
  /** The document's date in the organization's calendar; it decides the period and the date part. */
  issueDate: BusinessDateSchema,
  entityCode: BusinessCodeSchema.optional(),
  branchCode: BusinessCodeSchema.optional(),
  projectCode: BusinessCodeSchema.optional(),
});
export type IssueContext = z.infer<typeof IssueContextSchema>;

export const PreviewNumberSchema = IssueContextSchema;

export const NumberPreviewSchema = z.strictObject({
  type: SequenceTypeSchema,
  version: z.number().int().positive(),
  /** The number the next issue would receive — not reserved; a concurrent issue may take it. */
  next: z.string(),
});

export const ISSUED_NUMBER_STATES = ['issued', 'voided'] as const;

export const IssuedNumberSchema = z.strictObject({
  number: z.string(),
  type: SequenceTypeSchema,
  sequenceVersion: z.number().int().positive(),
  periodKey: z.string(),
  issueDate: BusinessDateSchema,
  source: z.strictObject({ type: z.string(), id: z.string() }),
  state: z.enum(ISSUED_NUMBER_STATES),
  voidReason: z.string().optional(),
  issuedAt: InstantSchema,
  voidedAt: InstantSchema.optional(),
});
export type IssuedNumber = z.infer<typeof IssuedNumberSchema>;

export const IssuedNumberPageSchema = z.strictObject({
  items: z.array(IssuedNumberSchema),
  nextCursor: z.string().optional(),
});

export const IssuedNumberQuerySchema = z.strictObject({
  type: SequenceTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(200).optional(),
});

export const NUMBERING_AUDIT_ACTIONS = {
  sequenceCreated: 'numbering.sequence.created',
  sequenceUpdated: 'numbering.sequence.updated',
  sequenceActivated: 'numbering.sequence.activated',
  numberVoided: 'numbering.number.voided',
} as const;
