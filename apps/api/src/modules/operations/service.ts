import {
  DiagnosticsSchema,
  WorkerHeartbeatSchema,
  type BuildInfo,
  type Diagnostics,
  type MaintenanceRun,
} from '@alola/contracts';

/**
 * Operational diagnostics (OPS-006). Everything an operator needs to judge a deployment's health in
 * one read, **redacted by construction**: each input arrives through a port that already returns
 * only states, counts and identifiers, and configuration is reduced to "set" or "not set" here.
 */
export interface OperationsServiceOptions {
  build: BuildInfo;
  appEnv: string;
  startedAt: Date;
  migrations: () => Promise<{
    databaseVersion: string;
    codeVersion: string;
    pending: string[];
    changed: string[];
    unknown: string[];
  }>;
  maintenance: { enabled: boolean; status: () => Promise<MaintenanceRun[]> };
  /** The worker heartbeat's raw value, or null when it has expired. */
  readHeartbeat: () => Promise<string | null>;
  integrationStates: () => Promise<{ state: string }[]>;
  /** Variable names to report on, and where to look them up. Values never leave this function. */
  configurationNames: readonly string[];
  environment: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
}

export class OperationsService {
  constructor(private readonly options: OperationsServiceOptions) {}

  private async worker(): Promise<Diagnostics['worker']> {
    const raw = await this.options.readHeartbeat().catch(() => null);
    if (!raw) return { status: 'absent' };
    try {
      return { status: 'alive', heartbeat: WorkerHeartbeatSchema.parse(JSON.parse(raw)) };
    } catch {
      return { status: 'absent' };
    }
  }

  async diagnostics(): Promise<Diagnostics> {
    const now = this.options.now?.() ?? new Date();
    const [migrations, runs, worker, states] = await Promise.all([
      this.options.migrations(),
      this.options.maintenance.status(),
      this.worker(),
      this.options.integrationStates(),
    ]);
    const integrations: Record<string, number> = {};
    for (const { state } of states) integrations[state] = (integrations[state] ?? 0) + 1;
    const configuration = Object.fromEntries(
      this.options.configurationNames.map((name) => [
        name,
        (this.options.environment[name] ?? '').trim() !== '',
      ]),
    );
    return DiagnosticsSchema.parse({
      build: this.options.build,
      appEnv: this.options.appEnv,
      nodeVersion: process.version,
      uptimeSeconds: Math.max(
        0,
        Math.floor((now.getTime() - this.options.startedAt.getTime()) / 1000),
      ),
      migrations: {
        databaseVersion: migrations.databaseVersion,
        codeVersion: migrations.codeVersion,
        pending: migrations.pending,
        changed: migrations.changed,
        unknown: migrations.unknown,
      },
      maintenance: { enabled: this.options.maintenance.enabled, runs },
      worker,
      integrations,
      configuration,
    });
  }
}
