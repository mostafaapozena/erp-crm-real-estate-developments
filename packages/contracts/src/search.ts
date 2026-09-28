import { z } from 'zod';

/**
 * Global search (CORE-SEARCH-001, ADR-0006).
 *
 * Search is the classic place data scope leaks: one box that looks across every module is tempting to
 * build as one query over a copied index, and that copy is exactly what forgets who may see what. So
 * this search **has no index of its own**. It asks each module that owns a kind of record, through a
 * port, to search *as the actor* — with that module's own permission check and scope filter inside its
 * own query — and merges the answers.
 *
 * Two further rules close the quieter leaks:
 *
 * - **Only unrestricted identifying fields are matched** — a name, a code, a document number, a phone
 *   number. A field the actor may not see (a unit's price, SEC-029) is never searched, because a
 *   search that matches on a hidden value answers questions about it.
 * - **A hit carries a label and an identifier, nothing more.** Opening it goes through the owning
 *   module's scoped read, like any other link.
 */

export const SEARCH_TYPES = [
  'lead',
  'customer',
  'project',
  'unit',
  'reservation',
  'contract',
  'receipt',
  'document',
  'task',
] as const;
export const SearchTypeSchema = z.enum(SEARCH_TYPES);
export type SearchType = z.infer<typeof SearchTypeSchema>;

/** Results per type. Search finds a record; it is not a list screen. */
export const SEARCH_LIMIT_PER_TYPE = 5;

export const SearchQuerySchema = z.strictObject({
  q: z.string().trim().min(2).max(100),
  /** Comma-separated types to search; all the caller may see when absent. */
  types: z
    .string()
    .regex(/^[a-z]+(,[a-z]+)*$/, { message: 'SEARCH_TYPES_INVALID' })
    .optional(),
});

export const SearchHitSchema = z.strictObject({
  type: SearchTypeSchema,
  id: z.string(),
  /** What a person recognizes the record by — a name, a code, a number. Rendered verbatim. */
  label: z.string(),
  /** A bilingual name beside a code (a project), shown in the reader's language. */
  name: z.strictObject({ ar: z.string(), en: z.string() }).optional(),
  /**
   * The record's state as its own enumeration value (a lead's stage, a unit's status); the screen
   * labels it through that type's translations. Never a restricted field.
   */
  status: z.string().optional(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SearchResultSchema = z.strictObject({
  items: z.array(SearchHitSchema),
  /** The types that were searched — those whose read permission the caller holds. */
  searched: z.array(SearchTypeSchema),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;
