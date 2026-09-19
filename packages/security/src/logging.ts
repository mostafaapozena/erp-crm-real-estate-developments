import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

/**
 * Structured logging with redaction configured once, at the logger instance (PLAT-006, SEC-007).
 *
 * Redaction is by path, so it applies to every log line regardless of which module writes it. A value
 * is removed, not masked, so no fragment of a secret reaches a log sink.
 */
export const REDACTED = '[REDACTED]';

const SENSITIVE_KEYS = [
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'apiKey',
  'secret',
  'clientSecret',
  'authorization',
  'cookie',
  'otp',
  'mfaCode',
  'cardNumber',
  'cvv',
  'iban',
  'accountNumber',
  'nationalId',
  'connectionString',
] as const;

export const REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((key) => `*.${key}`),
  ...SENSITIVE_KEYS.map((key) => `*.*.${key}`),
];

export interface CreateLoggerOptions {
  name: string;
  level: LoggerOptions['level'];
  /** Base fields added to every line, e.g. the environment. Never secrets. */
  base?: Record<string, string>;
}

export function createLogger(
  options: CreateLoggerOptions,
  destination?: DestinationStream,
): Logger {
  const config: LoggerOptions = {
    name: options.name,
    level: options.level ?? 'info',
    base: { service: options.name, ...options.base },
    redact: { paths: [...REDACT_PATHS], censor: REDACTED },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  };
  return destination ? pino(config, destination) : pino(config);
}

export type { Logger } from 'pino';
