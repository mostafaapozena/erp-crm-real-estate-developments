import {
  MAINTENANCE_SWEEPS,
  MaintenanceRunSchema,
  PERMISSIONS,
  type ActorContext,
  type MaintenanceRun,
  type MaintenanceSweep,
} from '@alola/contracts';
import { hostname } from 'node:os';
import { Schema, type Connection, type Model } from 'mongoose';
import type { Logger } from 'pino';
import type { RequestContext } from './audit-port';

/**
 * Scheduled maintenance (OPS-007, ADR-0028).
 *
 * The sweeps that keep time-driven state true — deliver due notifications, remind and escalate tasks,
 * escalate overdue approvals, move instalments to due and overdue, process webhooks and the outbox —
 * run on a timer inside the API process, which already holds the service graph.
 *
 * **Single-runner.** Each sweep has a row in `maintenanceRuns`; running it means taking that row's
 * lease with a conditional update. Two instances ticking together: one takes the lease, the other
 * skips. A crashed runner's lease expires and the next tick takes over.
 *
 * **Idempotent.** Every sweep is already idempotent in its own module — conditional updates and dedupe
 * keys — so a sweep that ran twice changes nothing twice. The lease prevents wasted work and noise,
 * not double effects.
 *
 * Each sweep records when it started and finished, how it ended (a stable code, never a message) and
 * the counts it reported, for the diagnostics page.
 */
export const MAINTENANCE_RUNS_COLLECTION = 'maintenanceRuns';

export interface SweepDefinition {
  name: MaintenanceSweep;
  intervalSeconds: number;
  run(actor: ActorContext, context: RequestContext): Promise<Record<string, number>>;
}

interface RunDocument {
  _id: string;
  holder?: string;
  leaseUntil?: Date;
  nextRunAt: Date;
  lastStartedAt?: Date;
  lastFinishedAt?: Date;
  lastOutcome?: 'succeeded' | 'failed';
  lastErrorCode?: string;
  lastResult?: Record<string, number>;
}

/** The identity scheduled sweeps act as. Their audit records say `system:maintenance`. */
export const MAINTENANCE_ACTOR: ActorContext = {
  accountId: 'system:maintenance',
  kind: 'system',
  roleKeys: [],
  permissions: [...PERMISSIONS],
  deniedPermissions: [],
  scope: {
    level: 'all',
    teamIds: [],
    departmentIds: [],
    branchIds: [],
    projectIds: [],
    legalEntityIds: [],
  },
  grantVersion: 0,
};

export function maintenanceRunModel(connection: Connection): Model<RunDocument> {
  const existing = connection.models[MAINTENANCE_RUNS_COLLECTION] as Model<RunDocument> | undefined;
  if (existing) return existing;
  const schema = new Schema<RunDocument>(
    {
      _id: { type: String, required: true },
      holder: { type: String },
      leaseUntil: { type: Date },
      nextRunAt: { type: Date, required: true },
      lastStartedAt: { type: Date },
      lastFinishedAt: { type: Date },
      lastOutcome: { type: String, enum: ['succeeded', 'failed'] },
      lastErrorCode: { type: String },
      lastResult: { type: Schema.Types.Mixed },
    },
    { collection: MAINTENANCE_RUNS_COLLECTION, strict: 'throw', versionKey: false },
  );
  schema.index({ nextRunAt: 1 }, { name: 'maintenanceRuns_next' });
  return connection.model<RunDocument>(MAINTENANCE_RUNS_COLLECTION, schema);
}

const LEASE_MS = 10 * 60_000;

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'SWEEP_FAILED';
}

export class MaintenanceScheduler {
  private readonly runs;
  private readonly holder: string;
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;

  constructor(
    connection: Connection,
    private readonly sweeps: readonly SweepDefinition[],
    private readonly options: { logger?: Logger; now?: () => Date; holder?: string } = {},
  ) {
    this.runs = maintenanceRunModel(connection);
    this.holder = options.holder ?? `${hostname()}:${String(process.pid)}`;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  /** Start ticking. The timer does not keep the process alive on its own. */
  start(tickSeconds: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), tickSeconds * 1000);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Run every sweep that is due and whose lease this process can take. Returns the ones it ran. */
  async tick(): Promise<MaintenanceSweep[]> {
    if (this.ticking) return [];
    this.ticking = true;
    const ran: MaintenanceSweep[] = [];
    try {
      for (const sweep of this.sweeps) {
        if (await this.runOne(sweep)) ran.push(sweep.name);
      }
    } finally {
      this.ticking = false;
    }
    return ran;
  }

  private async claim(sweep: SweepDefinition): Promise<boolean> {
    const now = this.now();
    try {
      const claimed = await this.runs
        .findOneAndUpdate(
          {
            _id: sweep.name,
            nextRunAt: { $lte: now },
            $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }],
          },
          {
            $set: {
              holder: this.holder,
              leaseUntil: new Date(now.getTime() + LEASE_MS),
              lastStartedAt: now,
            },
            $setOnInsert: { nextRunAt: now },
          },
          { upsert: true, new: true },
        )
        .lean<RunDocument>()
        .exec();
      return claimed?.holder === this.holder;
    } catch (error) {
      // The row exists but is not due or is leased: the upsert collides on _id. Not ours this tick.
      if ((error as { code?: unknown }).code === 11000) return false;
      throw error;
    }
  }

  private async runOne(sweep: SweepDefinition): Promise<boolean> {
    if (!(await this.claim(sweep))) return false;
    const context: RequestContext = {
      correlationId: `maintenance-${sweep.name}-${String(this.now().getTime())}`,
      method: 'SCHEDULE',
      route: `maintenance/${sweep.name}`,
    };
    let outcome: Partial<RunDocument>;
    try {
      const result = await sweep.run(MAINTENANCE_ACTOR, context);
      outcome = { lastOutcome: 'succeeded', lastResult: result };
    } catch (error) {
      this.options.logger?.error(
        { sweep: sweep.name, code: errorCode(error) },
        'maintenance sweep failed',
      );
      outcome = { lastOutcome: 'failed', lastErrorCode: errorCode(error) };
    }
    const finished = this.now();
    await this.runs
      .updateOne(
        { _id: sweep.name, holder: this.holder },
        {
          $set: {
            ...outcome,
            lastFinishedAt: finished,
            nextRunAt: new Date(finished.getTime() + sweep.intervalSeconds * 1000),
          },
          $unset: {
            leaseUntil: 1,
            holder: 1,
            ...(outcome.lastOutcome === 'succeeded' ? { lastErrorCode: 1 } : { lastResult: 1 }),
          },
        },
      )
      .exec();
    return true;
  }

  async status(): Promise<MaintenanceRun[]> {
    const rows = await this.runs.find().lean<RunDocument[]>().exec();
    const byName = new Map(rows.map((row) => [row._id, row]));
    const now = this.now();
    return MAINTENANCE_SWEEPS.map((name) => {
      const row = byName.get(name);
      return MaintenanceRunSchema.parse({
        sweep: name,
        ...(row?.lastStartedAt ? { lastStartedAt: row.lastStartedAt.toISOString() } : {}),
        ...(row?.lastFinishedAt ? { lastFinishedAt: row.lastFinishedAt.toISOString() } : {}),
        ...(row?.lastOutcome ? { lastOutcome: row.lastOutcome } : {}),
        ...(row?.lastErrorCode ? { lastErrorCode: row.lastErrorCode } : {}),
        ...(row?.lastResult ? { lastResult: row.lastResult } : {}),
        ...(row?.nextRunAt ? { nextRunAt: row.nextRunAt.toISOString() } : {}),
        running: Boolean(row?.leaseUntil && row.leaseUntil > now),
      });
    });
  }
}
