import type { DependencyHealth, LivenessResponse, MongoHealth } from '@alola/contracts';
import type { ApiEnv } from '@alola/config';
import type { Logger } from '@alola/security';
import cors from 'cors';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { RateLimiterAbstract } from 'rate-limiter-flexible';
import { readiness, type HealthProbe } from './health';
import { CORRELATION_HEADER, correlation, correlationIdOf } from './http/correlation';
import { csrfOriginGuard } from './http/csrf';
import { errorHandler, notFound } from './http/errors';
import { rateLimit } from './http/rate-limit';
import { buildOpenApiDocument } from './openapi';

/**
 * A domain module's published HTTP surface. The modular monolith mounts modules here; a module never
 * reaches into another module's router or internals (ADR-0001).
 */
export interface ApiModule {
  basePath: `/${string}`;
  router: Router;
}

export interface AppDependencies {
  config: Pick<ApiEnv, 'CORS_ALLOWED_ORIGINS' | 'TRUST_PROXY_HOPS' | 'APP_ENV'>;
  logger: Logger;
  mongo: HealthProbe<MongoHealth>;
  redis: HealthProbe<DependencyHealth>;
  rateLimiter: RateLimiterAbstract;
  modules?: readonly ApiModule[];
}

export const JSON_BODY_LIMIT = '100kb';

/**
 * Request pipeline, in order (docs/architecture/overview.md §5):
 * correlation ID → structured request log → security headers → CORS → health → rate limit →
 * body parsing → CSRF origin guard → versioned routes → not found → centralized errors.
 */
export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deps.config.TRUST_PROXY_HOPS);

  app.use(correlation());
  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (_req, res) => correlationIdOf(res as express.Response),
      customProps: (_req, res) => ({ correlationId: correlationIdOf(res as express.Response) }),
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
    }),
  );

  // SEC-001: security headers. The API serves JSON only, so the CSP forbids everything.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  // SEC-001: strict CORS allow-list. Unlisted origins receive no CORS headers, so browsers block them.
  const allowedOrigins = new Set(deps.config.CORS_ALLOWED_ORIGINS);
  app.use(
    cors({
      origin: (origin, callback) => {
        callback(null, origin === undefined || allowedOrigins.has(origin));
      },
      credentials: true,
      exposedHeaders: [CORRELATION_HEADER, 'Retry-After'],
      maxAge: 600,
    }),
  );

  // OPS-003: health endpoints sit before the rate limiter so probes are never throttled.
  app.get('/health/live', (_req, res) => {
    const body: LivenessResponse = { status: 'ok' };
    res.json(body);
  });
  app.get('/health/ready', async (_req, res) => {
    const report = await readiness(deps.mongo, deps.redis);
    res.status(report.status === 'ready' ? 200 : 503).json(report);
  });

  app.use(rateLimit(deps.rateLimiter, (req) => `ip:${req.ip ?? 'unknown'}`));
  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));
  app.use(csrfOriginGuard(deps.config.CORS_ALLOWED_ORIGINS));

  const v1 = Router();
  const openApiDocument = buildOpenApiDocument();
  v1.get('/openapi.json', (_req, res) => {
    res.json(openApiDocument);
  });
  for (const module of deps.modules ?? []) v1.use(module.basePath, module.router);
  app.use('/api/v1', v1);

  app.use(notFound());
  app.use(errorHandler(deps.logger));
  return app;
}
