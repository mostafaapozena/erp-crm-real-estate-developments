/**
 * Service availability for integration tests (TEST-001, ADR-0012).
 *
 * Integration tests that need MongoDB or Redis call `serviceGate` and skip when the service is not
 * configured. The skip is loud: it prints which variable is missing, and the test runner reports the
 * test as skipped. **A skipped test is never a pass**, and `docs/MEMORY.md` records skips as skips.
 */
export type TestService = 'mongodb' | 'redis';

const VARIABLES: Record<TestService, readonly string[]> = {
  mongodb: ['MONGODB_URI', 'MONGODB_DB_NAME'],
  redis: ['REDIS_URL'],
};

export interface ServiceGate {
  available: boolean;
  missing: string[];
  reason: string;
}

export function serviceGate(
  services: readonly TestService[],
  env: Record<string, string | undefined> = process.env,
): ServiceGate {
  const missing = services.flatMap((s) => VARIABLES[s]).filter((v) => !env[v]?.trim());
  const available = missing.length === 0;
  const reason = available
    ? 'all required services configured'
    : `SKIPPED — requires ${services.join(' + ')}; set ${missing.join(', ')} ` +
      '(see docs/architecture/environments.md). A skip is not a pass.';
  if (!available) console.warn(`[integration] ${reason}`);
  return { available, missing, reason };
}
