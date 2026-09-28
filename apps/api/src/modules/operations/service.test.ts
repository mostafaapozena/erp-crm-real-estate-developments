import { describe, expect, it } from 'vitest';
import { OperationsService, type OperationsServiceOptions } from './service';

/** OPS-006: diagnostics say what is set and healthy, never what a value is. */
describe('OperationsService.diagnostics', () => {
  const SECRET = 'value-that-must-never-appear-very-secret';
  const options = (
    overrides: Partial<OperationsServiceOptions> = {},
  ): OperationsServiceOptions => ({
    build: { version: '0.1.0', commit: 'abc1234', builtAt: '2026-10-01T00:00:00.000Z' },
    appEnv: 'production',
    startedAt: new Date('2026-10-01T09:00:00.000Z'),
    now: () => new Date('2026-10-01T09:01:30.000Z'),
    migrations: () =>
      Promise.resolve({
        databaseVersion: '0001-foundation-baseline',
        codeVersion: '0001-foundation-baseline',
        pending: [],
        changed: [],
        unknown: [],
      }),
    maintenance: { enabled: true, status: () => Promise.resolve([]) },
    readHeartbeat: () => Promise.resolve(null),
    integrationStates: () =>
      Promise.resolve([{ state: 'noAdapter' }, { state: 'noAdapter' }, { state: 'error' }]),
    configurationNames: ['MONGODB_URI', 'KMS_KEY_ID', 'S3_BUCKET'],
    environment: { MONGODB_URI: SECRET, KMS_KEY_ID: '', S3_BUCKET: undefined },
    ...overrides,
  });

  it('reduces configuration to set or not set, and counts integration states', async () => {
    const report = await new OperationsService(options()).diagnostics();
    expect(report.configuration).toEqual({
      MONGODB_URI: true,
      KMS_KEY_ID: false,
      S3_BUCKET: false,
    });
    expect(JSON.stringify(report)).not.toContain('very-secret');
    expect(report.integrations).toEqual({ noAdapter: 2, error: 1 });
    expect(report.uptimeSeconds).toBe(90);
    expect(report.worker).toEqual({ status: 'absent' });
  });

  it('reports a live worker from its heartbeat, and a garbled one as absent', async () => {
    const heartbeat = JSON.stringify({
      at: '2026-10-01T09:01:00.000Z',
      build: { version: '0.1.0', commit: 'abc1234', builtAt: '2026-10-01T00:00:00.000Z' },
      deadLetters: 3,
    });
    const alive = await new OperationsService(
      options({ readHeartbeat: () => Promise.resolve(heartbeat) }),
    ).diagnostics();
    expect(alive.worker).toMatchObject({ status: 'alive', heartbeat: { deadLetters: 3 } });
    const garbled = await new OperationsService(
      options({ readHeartbeat: () => Promise.resolve('{not json') }),
    ).diagnostics();
    expect(garbled.worker).toEqual({ status: 'absent' });
  });
});
