import { z } from 'zod';
import { InstantSchema } from './time';

/**
 * Operational readiness (OPS-006, OPS-007).
 *
 * What an operator needs to know that the running system will not tell a user: which build is
 * running, whether the database schema matches it, whether the worker is alive and how many jobs
 * died, whether each scheduled sweep ran and how it ended, and which providers are healthy. All of it
 * is **redacted by construction**: configuration is reported as present or absent, never as a value.
 */

export const BuildInfoSchema = z.strictObject({
  version: z.string(),
  /** Short commit hash at build time, `+dirty` when built from uncommitted changes. */
  commit: z.string(),
  builtAt: z.string(),
});
export type BuildInfo = z.infer<typeof BuildInfoSchema>;

/** The Redis key the worker refreshes while it is alive. */
export const WORKER_HEARTBEAT_KEY = 'alola:worker:heartbeat';
/** How long a heartbeat stays valid; the worker refreshes it three times as often. */
export const WORKER_HEARTBEAT_TTL_SECONDS = 90;

export const WorkerHeartbeatSchema = z.strictObject({
  at: InstantSchema,
  build: BuildInfoSchema,
  /** Jobs that used every attempt and wait for an operator. */
  deadLetters: z.number().int().nonnegative(),
});
export type WorkerHeartbeat = z.infer<typeof WorkerHeartbeatSchema>;

export const MAINTENANCE_SWEEPS = [
  'notifications.dispatch',
  'tasks.sweep',
  'approvals.escalate',
  'installments.refresh',
  'integrations.sweep',
  'inventory.sweep',
] as const;
export const MaintenanceSweepSchema = z.enum(MAINTENANCE_SWEEPS);
export type MaintenanceSweep = z.infer<typeof MaintenanceSweepSchema>;

export const MaintenanceRunSchema = z.strictObject({
  sweep: MaintenanceSweepSchema,
  lastStartedAt: InstantSchema.optional(),
  lastFinishedAt: InstantSchema.optional(),
  lastOutcome: z.enum(['succeeded', 'failed']).optional(),
  /** A stable code, never a message or a stack. */
  lastErrorCode: z.string().optional(),
  /** Counts the sweep reported, e.g. `{ escalated: 2 }`. */
  lastResult: z.record(z.string(), z.number()).optional(),
  nextRunAt: InstantSchema.optional(),
  /** True while one instance holds the lease. */
  running: z.boolean(),
});
export type MaintenanceRun = z.infer<typeof MaintenanceRunSchema>;

export const DiagnosticsSchema = z.strictObject({
  build: BuildInfoSchema,
  appEnv: z.string(),
  nodeVersion: z.string(),
  uptimeSeconds: z.number().int().nonnegative(),
  migrations: z.strictObject({
    databaseVersion: z.string(),
    codeVersion: z.string(),
    pending: z.array(z.string()),
    changed: z.array(z.string()),
    unknown: z.array(z.string()),
  }),
  maintenance: z.strictObject({
    enabled: z.boolean(),
    runs: z.array(MaintenanceRunSchema),
  }),
  worker: z.strictObject({
    status: z.enum(['alive', 'absent']),
    heartbeat: WorkerHeartbeatSchema.optional(),
  }),
  integrations: z.record(z.string(), z.number().int().nonnegative()),
  /** Each configuration variable as set or not set — never its value. */
  configuration: z.record(z.string(), z.boolean()),
});
export type Diagnostics = z.infer<typeof DiagnosticsSchema>;
