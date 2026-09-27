import { SUPPORTED_LOCALES, isValidTimeZone } from '@alola/contracts';
import { z } from 'zod';

/**
 * Environment configuration contract (OPS-001, ADR-0012, ADR-0018).
 *
 * Every variable a server process reads is declared here. `.env.example` must list exactly these
 * variables (OPS-002) — a unit test compares the two.
 *
 * Validation failures name the variable and the problem, never the value: values may be secrets.
 */

const APP_ENVIRONMENTS = ['development', 'test', 'staging', 'production'] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Treat empty strings as "not set", so `KEY=` in a `.env` file behaves like an absent key. */
const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().optional(),
);

const originList = z
  .string()
  .trim()
  .min(1, { message: 'must list at least one origin' })
  .transform((value, ctx) => {
    const origins = value
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    for (const origin of origins) {
      if (origin === '*') {
        ctx.addIssue({ code: 'custom', message: 'wildcard origin is not allowed' });
        return z.NEVER;
      }
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'each entry must be an absolute origin URL' });
        return z.NEVER;
      }
      if (parsed.origin !== origin) {
        ctx.addIssue({
          code: 'custom',
          message: 'each entry must be a bare origin (scheme://host[:port]) with no path',
        });
        return z.NEVER;
      }
    }
    return origins;
  });

const mongoUri = optionalString.refine(
  (value) => value === undefined || /^mongodb(\+srv)?:\/\//.test(value),
  { message: 'must start with mongodb:// or mongodb+srv://' },
);

const redisUrl = optionalString.refine(
  (value) => value === undefined || /^rediss?:\/\//.test(value),
  { message: 'must start with redis:// or rediss://' },
);

const sharedShape = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(APP_ENVIRONMENTS).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  /** ADR-0008: every server process runs in UTC. */
  TZ: z.literal('UTC', { message: 'must be exactly UTC (ADR-0008)' }),
  ORG_TIMEZONE: z
    .string()
    .trim()
    .refine(isValidTimeZone, { message: 'must be a valid IANA timezone, e.g. UTC' }),
  MONGODB_URI: mongoUri,
  MONGODB_DB_NAME: optionalString,
  REDIS_URL: redisUrl,
};

/**
 * Authentication settings (`SEC-013` … `SEC-017`, ADR-0023). Every one has a defensible default except
 * the signing secret, which has none: a default signing key is a shared key.
 */
const authShape = {
  /** HS256 key for access tokens and MFA challenges. At least 32 bytes. Never a literal in code. */
  AUTH_TOKEN_SIGNING_SECRET: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(32, { message: 'must be at least 32 characters of random material' }).optional(),
  ),
  /** Short by design: revocation is immediate, but a stolen token should also simply expire. */
  AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  AUTH_SESSION_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(300).max(86_400).default(1800),
  AUTH_SESSION_ABSOLUTE_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .min(900)
    .max(2_592_000)
    .default(43_200),
  AUTH_ACTIVATION_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(600)
    .max(1_209_600)
    .default(259_200),
  AUTH_PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(1800),
  AUTH_MFA_CHALLENGE_TTL_SECONDS: z.coerce.number().int().min(60).max(1800).default(300),
  /**
   * Shown in the authenticator app next to the account name **only when no company profile exists**;
   * a configured deployment uses its profile's short name (ADR-0027). Neutral by default: no client's
   * name is written into reusable product source.
   */
  AUTH_TOTP_ISSUER: z.string().trim().min(1).max(64).default('Real Estate ERP'),
  /** Argon2id cost. Raise as hardware improves; a successful login rehashes transparently. */
  ARGON2_MEMORY_COST: z.coerce.number().int().min(19_456).max(1_048_576).default(19_456),
  ARGON2_TIME_COST: z.coerce.number().int().min(2).max(10).default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(16).default(1),
  /**
   * 32-byte base64 key used to encrypt MFA secrets in **development and test only**, so an enrolment
   * survives a restart. Staging and production refuse it and require `KMS_KEY_ID` (`SEC-033`).
   */
  DEV_ENCRYPTION_KEY: optionalString,
};

export const apiEnvSchema = z.object({
  ...sharedShape,
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CORS_ALLOWED_ORIGINS: originList,
  DEFAULT_LOCALE: z.enum(SUPPORTED_LOCALES).default('ar'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(300),
  S3_BUCKET: optionalString,
  S3_REGION: optionalString,
  /**
   * Directory for the **development and test** file store (CORE-DOC-004). Refused in staging and
   * production, which use private object storage. Defaults to `.local-storage` at the repository root.
   */
  FILE_STORAGE_DIR: optionalString,
  KMS_KEY_ID: optionalString,
  ...authShape,
});

export const workerEnvSchema = z.object({
  ...sharedShape,
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** Variables that must be present in production (staging mirrors production). */
const REQUIRED_OUTSIDE_DEVELOPMENT = ['MONGODB_URI', 'MONGODB_DB_NAME', 'REDIS_URL'] as const;
const REQUIRED_FOR_API_OUTSIDE_DEVELOPMENT = [
  'S3_BUCKET',
  'S3_REGION',
  'KMS_KEY_ID',
  'AUTH_TOKEN_SIGNING_SECRET',
] as const;

/** Every variable any server process reads — used to check `.env.example` completeness. */
export const ENV_VARIABLES: readonly string[] = [
  ...new Set([...Object.keys(apiEnvSchema.shape), ...Object.keys(workerEnvSchema.shape)]),
].sort();

export interface ConfigProblem {
  variable: string;
  problem: string;
}

export class ConfigError extends Error {
  constructor(readonly problems: ConfigProblem[]) {
    super(
      [
        'Configuration is invalid. Fix these variables (values are not shown):',
        ...problems.map((p) => `  - ${p.variable}: ${p.problem}`),
        'See .env.example and docs/architecture/environments.md.',
      ].join('\n'),
    );
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

function crossFieldProblems(
  config: {
    APP_ENV: AppEnvironment;
    MONGODB_URI?: string | undefined;
    MONGODB_DB_NAME?: string | undefined;
  },
  env: Env,
  extraRequired: readonly string[],
): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const strict = config.APP_ENV === 'production' || config.APP_ENV === 'staging';
  if (strict) {
    for (const variable of [...REQUIRED_OUTSIDE_DEVELOPMENT, ...extraRequired]) {
      if (!env[variable]?.trim()) {
        problems.push({ variable, problem: `is required when APP_ENV=${config.APP_ENV}` });
      }
    }
  }
  if (config.MONGODB_URI && !config.MONGODB_DB_NAME) {
    problems.push({ variable: 'MONGODB_DB_NAME', problem: 'is required when MONGODB_URI is set' });
  }
  // The development encryption key is refused outside development, so a `.env` copied to a server
  // cannot quietly become the key protecting real second factors (ADR-0023).
  if (
    (config.APP_ENV === 'production' || config.APP_ENV === 'staging') &&
    env['DEV_ENCRYPTION_KEY']?.trim()
  ) {
    problems.push({
      variable: 'DEV_ENCRYPTION_KEY',
      problem: `must not be set when APP_ENV=${config.APP_ENV}; configure KMS_KEY_ID instead`,
    });
  }
  // ADR-0018 production guard: a non-production process must never point at a production database.
  if (
    config.APP_ENV !== 'production' &&
    config.MONGODB_DB_NAME &&
    /prod/i.test(config.MONGODB_DB_NAME)
  ) {
    problems.push({
      variable: 'MONGODB_DB_NAME',
      problem: `looks like a production database; refused when APP_ENV=${config.APP_ENV}`,
    });
  }
  return problems;
}

function parse<T extends z.ZodType>(schema: T, env: Env): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => {
        const variable = String(issue.path[0] ?? '(root)');
        const missing = issue.code === 'invalid_type' && !env[variable]?.trim();
        return { variable, problem: missing ? 'is required' : issue.message };
      }),
    );
  }
  return result.data;
}

export function loadApiConfig(env: Env = process.env): ApiEnv {
  const config = parse(apiEnvSchema, env);
  const problems = crossFieldProblems(config, env, REQUIRED_FOR_API_OUTSIDE_DEVELOPMENT);
  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}

export function loadWorkerConfig(env: Env = process.env): WorkerEnv {
  const config = parse(workerEnvSchema, env);
  const problems = crossFieldProblems(config, env, []);
  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}

/**
 * ADR-0008: the environment says UTC *and* the runtime agrees. Both checks, because a process can be
 * started with a TZ that was applied after the runtime cached its zone.
 */
export function assertUtcRuntime(): void {
  if (new Date(0).getTimezoneOffset() !== 0) {
    throw new ConfigError([
      { variable: 'TZ', problem: 'process runtime is not UTC; start the process with TZ=UTC' },
    ]);
  }
}
