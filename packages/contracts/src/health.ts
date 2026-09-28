import { z } from 'zod';

/**
 * Per-dependency health (OPS-003). Each dependency reports separately so that a Redis outage is
 * distinguishable from a database outage.
 *
 * - `up`: reachable and working
 * - `down`: configured but unreachable or failing
 * - `not_configured`: no connection settings supplied (normal in early local development)
 */
export const DependencyStatusSchema = z.enum(['up', 'down', 'not_configured']);
export type DependencyStatus = z.infer<typeof DependencyStatusSchema>;

export const DependencyHealthSchema = z.strictObject({
  status: DependencyStatusSchema,
  /** Stable machine code explaining a non-`up` status. Never a connection string or secret. */
  code: z.string().optional(),
});
export type DependencyHealth = z.infer<typeof DependencyHealthSchema>;

export const MongoHealthSchema = DependencyHealthSchema.extend({
  /** Transactions need a replica set; a standalone server silently cannot provide them. */
  transactions: z.boolean().optional(),
});
export type MongoHealth = z.infer<typeof MongoHealthSchema>;

export const LivenessResponseSchema = z.strictObject({
  status: z.literal('ok'),
});
export type LivenessResponse = z.infer<typeof LivenessResponseSchema>;

export const ReadinessResponseSchema = z.strictObject({
  status: z.enum(['ready', 'not_ready']),
  checks: z.strictObject({
    mongodb: MongoHealthSchema,
    redis: DependencyHealthSchema,
    /**
     * Whether the database schema matches this build (OPS-004, OPS-006). `pending` and `mismatch`
     * make the instance not ready: serving requests against a schema the code does not expect is how
     * data gets written in a shape nothing can read back.
     */
    migrations: z
      .strictObject({ status: z.enum(['current', 'pending', 'mismatch', 'unknown']) })
      .optional(),
  }),
});
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
