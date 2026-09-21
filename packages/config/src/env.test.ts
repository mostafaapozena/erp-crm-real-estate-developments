import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConfigError, ENV_VARIABLES, loadApiConfig, loadWorkerConfig } from './env';

const baseEnv = {
  TZ: 'UTC',
  ORG_TIMEZONE: 'UTC',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
};

function problemsOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error('expected a ConfigError');
}

describe('API configuration (OPS-001)', () => {
  it('loads a minimal development configuration with safe defaults and no services', () => {
    const config = loadApiConfig(baseEnv);
    expect(config.APP_ENV).toBe('development');
    expect(config.DEFAULT_LOCALE).toBe('ar');
    expect(config.PORT).toBe(4000);
    expect(config.MONGODB_URI).toBeUndefined();
    expect(config.CORS_ALLOWED_ORIGINS).toEqual(['http://localhost:5173']);
  });

  it('names each missing required variable', () => {
    const problems = problemsOf(() => loadApiConfig({}));
    const variables = problems.map((p) => p.variable);
    expect(variables).toEqual(
      expect.arrayContaining(['TZ', 'ORG_TIMEZONE', 'CORS_ALLOWED_ORIGINS']),
    );
  });

  it('requires TZ to be exactly UTC', () => {
    const problems = problemsOf(() => loadApiConfig({ ...baseEnv, TZ: 'Africa/Cairo' }));
    expect(problems).toEqual([expect.objectContaining({ variable: 'TZ' })]);
  });

  it('rejects an invalid organization timezone', () => {
    const problems = problemsOf(() => loadApiConfig({ ...baseEnv, ORG_TIMEZONE: 'Mars/Base' }));
    expect(problems[0]?.variable).toBe('ORG_TIMEZONE');
  });

  it('rejects wildcard and path-bearing CORS origins', () => {
    expect(
      problemsOf(() => loadApiConfig({ ...baseEnv, CORS_ALLOWED_ORIGINS: '*' }))[0]?.variable,
    ).toBe('CORS_ALLOWED_ORIGINS');
    expect(
      problemsOf(() =>
        loadApiConfig({ ...baseEnv, CORS_ALLOWED_ORIGINS: 'https://app.example.com/path' }),
      )[0]?.variable,
    ).toBe('CORS_ALLOWED_ORIGINS');
  });

  it('treats empty values as unset', () => {
    const config = loadApiConfig({ ...baseEnv, MONGODB_URI: '', REDIS_URL: '  ' });
    expect(config.MONGODB_URI).toBeUndefined();
    expect(config.REDIS_URL).toBeUndefined();
  });

  it('requires data services, files, and encryption in production', () => {
    const problems = problemsOf(() => loadApiConfig({ ...baseEnv, APP_ENV: 'production' }));
    expect(problems.map((p) => p.variable).sort()).toEqual(
      [
        // Authentication cannot run on a default signing key, so production must supply one (ADR-0023).
        'AUTH_TOKEN_SIGNING_SECRET',
        'KMS_KEY_ID',
        'MONGODB_DB_NAME',
        'MONGODB_URI',
        'REDIS_URL',
        'S3_BUCKET',
        'S3_REGION',
      ].sort(),
    );
  });

  it('rejects a short token signing secret without echoing it', () => {
    const problems = problemsOf(() =>
      loadApiConfig({ ...baseEnv, AUTH_TOKEN_SIGNING_SECRET: 'too-short-secret' }),
    );
    expect(problems.map((p) => p.variable)).toEqual(['AUTH_TOKEN_SIGNING_SECRET']);
    expect(JSON.stringify(problems)).not.toContain('too-short-secret');
  });

  it('refuses the development encryption key in staging and production (SEC-033 is not implemented)', () => {
    for (const APP_ENV of ['staging', 'production'] as const) {
      const problems = problemsOf(() =>
        loadApiConfig({
          ...baseEnv,
          APP_ENV,
          MONGODB_URI: 'mongodb+srv://cluster.invalid/',
          MONGODB_DB_NAME: 'alola_app',
          REDIS_URL: 'rediss://cache.invalid:6379',
          S3_BUCKET: 'bucket',
          S3_REGION: 'me-south-1',
          KMS_KEY_ID: 'arn:aws:kms:me-south-1:000000000000:key/placeholder',
          AUTH_TOKEN_SIGNING_SECRET: 'x'.repeat(48),
          DEV_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
        }),
      );
      expect(problems.map((p) => p.variable)).toEqual(['DEV_ENCRYPTION_KEY']);
    }
  });

  it('accepts the authentication defaults in development', () => {
    const config = loadApiConfig({ ...baseEnv, AUTH_TOKEN_SIGNING_SECRET: 'y'.repeat(48) });
    expect(config.AUTH_ACCESS_TOKEN_TTL_SECONDS).toBe(600);
    expect(config.AUTH_SESSION_IDLE_TIMEOUT_SECONDS).toBe(1800);
    expect(config.AUTH_SESSION_ABSOLUTE_TIMEOUT_SECONDS).toBe(43_200);
    // OWASP minimum; the schema refuses anything weaker.
    expect(config.ARGON2_MEMORY_COST).toBe(19_456);
    expect(config.ARGON2_TIME_COST).toBe(2);
  });

  it('refuses Argon2 parameters below the approved minimum', () => {
    expect(
      problemsOf(() => loadApiConfig({ ...baseEnv, ARGON2_MEMORY_COST: '4096' })),
    ).toHaveLength(1);
    expect(problemsOf(() => loadApiConfig({ ...baseEnv, ARGON2_TIME_COST: '1' }))).toHaveLength(1);
  });

  it('refuses a production-looking database outside production (ADR-0018)', () => {
    const problems = problemsOf(() =>
      loadApiConfig({
        ...baseEnv,
        MONGODB_URI: 'mongodb+srv://cluster.invalid/',
        MONGODB_DB_NAME: 'alola_PROD',
      }),
    );
    expect(problems[0]?.variable).toBe('MONGODB_DB_NAME');
  });

  it('never includes variable values in error messages', () => {
    // Assembled at runtime so the fake credential does not trip the repository secret scan.
    const secret = ['mongodb+srv://user', 'SuperSecretPassw0rd@cluster.invalid/'].join(':');
    try {
      loadApiConfig({ ...baseEnv, MONGODB_URI: secret, MONGODB_DB_NAME: 'alola_prod' });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('SuperSecretPassw0rd');
      expect(String(error)).not.toContain(secret);
    }
    try {
      loadApiConfig({ ...baseEnv, REDIS_URL: 'http://user:AnotherSecret@host' });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('AnotherSecret');
    }
  });
});

describe('worker configuration', () => {
  it('loads with defaults', () => {
    expect(loadWorkerConfig({ TZ: 'UTC', ORG_TIMEZONE: 'UTC' }).WORKER_CONCURRENCY).toBe(4);
  });
});

describe('.env.example completeness (OPS-002)', () => {
  const examplePath = fileURLToPath(new URL('../../../.env.example', import.meta.url));
  const example = readFileSync(examplePath, 'utf8');
  const entries = example
    .split(/\r?\n/)
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => {
      const index = line.indexOf('=');
      return { key: line.slice(0, index), value: line.slice(index + 1) };
    });

  it('lists exactly the variables the configuration schema reads', () => {
    expect(entries.map((e) => e.key).sort()).toEqual([...ENV_VARIABLES]);
  });

  it('contains no credential-bearing connection string', () => {
    for (const { value } of entries) {
      expect(value).not.toMatch(/:\/\/[^:/\s<]+:[^@\s>]+@/);
    }
  });

  it('is itself a valid development configuration', () => {
    const env = Object.fromEntries(entries.map((e) => [e.key, e.value]));
    expect(() => loadApiConfig(env)).not.toThrow();
    expect(() => loadWorkerConfig(env)).not.toThrow();
  });
});
