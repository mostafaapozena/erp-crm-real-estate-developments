import { z } from 'zod';
import { CompanyProfileInputSchema } from './company';
import { BusinessCodeSchema } from './identifiers';
import { LocalizedLabelSchema } from './localized';
import { CreateLegalEntitySchema } from './organization';

/**
 * The file a new client deployment is initialized from (OPS-005, ADR-0027).
 *
 * One JSON file per client, prepared from the client data-intake checklist
 * (`docs/operations/client-data-intake-checklist.md`) and kept with the deployment's records — never in
 * this repository. It carries only what the product cannot run without: the company profile and the
 * organization's legal entities and branches. Everything else — roles, approval thresholds, reference
 * lists, numbering formats — is configured afterwards through the product, so each change is audited.
 */
export const ClientInitBranchSchema = z.strictObject({
  code: BusinessCodeSchema,
  name: LocalizedLabelSchema,
  city: LocalizedLabelSchema,
  costCenterCode: BusinessCodeSchema.optional(),
});

export const ClientInitFileSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    company: CompanyProfileInputSchema,
    legalEntities: z
      .array(CreateLegalEntitySchema.extend({ branches: z.array(ClientInitBranchSchema).max(200) }))
      .min(1)
      .max(20),
  })
  .refine(
    (file) =>
      new Set(file.legalEntities.map((entity) => entity.code)).size === file.legalEntities.length,
    { message: 'DUPLICATE_LEGAL_ENTITY_CODE', path: ['legalEntities'] },
  )
  .refine(
    (file) =>
      file.legalEntities.every(
        (entity) =>
          new Set(entity.branches.map((branch) => branch.code)).size === entity.branches.length,
      ),
    { message: 'DUPLICATE_BRANCH_CODE', path: ['legalEntities'] },
  );
export type ClientInitFile = z.infer<typeof ClientInitFileSchema>;

/** What happened to each item: created now, already present and matching, or present and different. */
export const CLIENT_INIT_OUTCOMES = ['created', 'exists', 'differs'] as const;
export type ClientInitOutcome = (typeof CLIENT_INIT_OUTCOMES)[number];

export interface ClientInitStep {
  item: string;
  outcome: ClientInitOutcome;
  /** For `differs`: which fields do not match. Nothing is overwritten. */
  fields?: string[];
}
