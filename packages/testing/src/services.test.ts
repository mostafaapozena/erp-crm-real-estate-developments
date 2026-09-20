import { describe, expect, it, vi } from 'vitest';
import { serviceGate } from './services';

describe('serviceGate (TEST-001)', () => {
  it('reports every missing variable and warns loudly', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gate = serviceGate(['mongodb', 'redis'], {});
    expect(gate.available).toBe(false);
    expect(gate.missing).toEqual(['MONGODB_URI', 'MONGODB_DB_NAME', 'REDIS_URL']);
    expect(gate.reason).toContain('A skip is not a pass');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('fails instead of skipping in gate mode', () => {
    expect(() => serviceGate(['mongodb'], { ALOLA_REQUIRE_INTEGRATION_SERVICES: '1' })).toThrow(
      /PHASE GATE FAILED.*MONGODB_URI, MONGODB_DB_NAME/,
    );
    expect(
      serviceGate(['redis'], {
        ALOLA_REQUIRE_INTEGRATION_SERVICES: '1',
        REDIS_URL: 'redis://localhost:6379',
      }).available,
    ).toBe(true);
  });

  it('is available when configured', () => {
    expect(serviceGate(['redis'], { REDIS_URL: 'redis://localhost:6379' }).available).toBe(true);
  });
});
