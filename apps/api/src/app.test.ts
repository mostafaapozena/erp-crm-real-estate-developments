import { Writable } from 'node:stream';
import { createLogger } from '@alola/security';
import { Router } from 'express';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp, type AppDependencies } from './app';
import { AppError } from './errors';
import { currentCorrelationId } from './http/correlation';
import { validate, validated } from './http/validate';

const ALLOWED = 'http://localhost:5173';

function logCapture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
  return {
    logger: createLogger({ name: 'api-test', level: 'info' }, stream),
    text: () => lines.join(''),
  };
}

const testModule = () => {
  const router = Router();
  router.post(
    '/echo',
    validate({ body: z.strictObject({ name: z.string().min(1), amount: z.string() }) }),
    (_req, res) => {
      res.json({ received: validated(res, 'body'), correlationId: currentCorrelationId() });
    },
  );
  router.get('/boom', () => {
    throw new Error('database password is hunter2');
  });
  router.get('/conflict', () => {
    throw new AppError('CONFLICT', 409);
  });
  return { basePath: '/test' as const, router };
};

function buildApp(overrides: Partial<AppDependencies> = {}) {
  const capture = logCapture();
  const app = createApp({
    config: { CORS_ALLOWED_ORIGINS: [ALLOWED], TRUST_PROXY_HOPS: 0, APP_ENV: 'test' },
    logger: capture.logger,
    mongo: {
      health: () => Promise.resolve({ status: 'not_configured', code: 'MONGODB_URI_NOT_SET' }),
    },
    redis: {
      health: () => Promise.resolve({ status: 'not_configured', code: 'REDIS_URL_NOT_SET' }),
    },
    rateLimiter: new RateLimiterMemory({ points: 1000, duration: 60 }),
    modules: [testModule()],
    ...overrides,
  });
  return { app, logs: capture.text };
}

describe('health (OPS-003)', () => {
  it('reports liveness', async () => {
    const res = await request(buildApp().app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('reports each dependency separately and is not ready without services', async () => {
    const res = await request(buildApp().app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: 'not_ready',
      checks: {
        mongodb: { status: 'not_configured', code: 'MONGODB_URI_NOT_SET' },
        redis: { status: 'not_configured', code: 'REDIS_URL_NOT_SET' },
      },
    });
  });

  it('distinguishes a Redis outage from a database outage', async () => {
    const { app } = buildApp({
      mongo: { health: () => Promise.resolve({ status: 'up', transactions: true }) },
      redis: { health: () => Promise.resolve({ status: 'down', code: 'REDIS_UNREACHABLE' }) },
    });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.checks.mongodb).toEqual({ status: 'up', transactions: true });
    expect(res.body.checks.redis).toEqual({ status: 'down', code: 'REDIS_UNREACHABLE' });
  });

  it('is ready when every dependency is up', async () => {
    const { app } = buildApp({
      mongo: { health: () => Promise.resolve({ status: 'up', transactions: true }) },
      redis: { health: () => Promise.resolve({ status: 'up' }) },
    });
    expect((await request(app).get('/health/ready')).status).toBe(200);
  });

  it('treats a throwing probe as down instead of crashing', async () => {
    const { app } = buildApp({ redis: { health: () => Promise.reject(new Error('x')) } });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.checks.redis.status).toBe('down');
  });
});

describe('correlation IDs (PLAT-007)', () => {
  it('generates one per request and exposes it to handlers', async () => {
    const res = await request(buildApp().app)
      .post('/api/v1/test/echo')
      .send({ name: 'a', amount: '1.00' });
    const id = res.headers['x-correlation-id'];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.correlationId).toBe(id);
  });

  it('propagates a well-formed incoming ID and replaces a malformed one', async () => {
    const { app } = buildApp();
    const kept = await request(app).get('/health/live').set('x-correlation-id', 'upstream-123456');
    expect(kept.headers['x-correlation-id']).toBe('upstream-123456');
    const replaced = await request(app)
      .get('/health/live')
      .set('x-correlation-id', 'bad id <script>alert(1)</script>');
    expect(replaced.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('security headers and CORS (SEC-001)', () => {
  it('sets Helmet headers and hides the framework', async () => {
    const res = await request(buildApp().app).get('/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('allows only listed origins', async () => {
    const { app } = buildApp();
    const allowed = await request(app).get('/health/live').set('Origin', ALLOWED);
    expect(allowed.headers['access-control-allow-origin']).toBe(ALLOWED);
    const denied = await request(app).get('/health/live').set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('validation (SEC-004)', () => {
  it('accepts a valid body', async () => {
    const res = await request(buildApp().app)
      .post('/api/v1/test/echo')
      .send({ name: 'a', amount: '1.00' });
    expect(res.status).toBe(200);
    expect(res.body.received).toEqual({ name: 'a', amount: '1.00' });
  });

  it('rejects unknown fields instead of dropping them', async () => {
    const res = await request(buildApp().app)
      .post('/api/v1/test/echo')
      .send({ name: 'a', amount: '1', isAdmin: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.issues).toEqual([{ path: ['body'], code: 'unrecognized_keys' }]);
  });

  it('returns machine codes and paths, never prose', async () => {
    const res = await request(buildApp().app).post('/api/v1/test/echo').send({ name: '' });
    expect(res.status).toBe(400);
    for (const issue of res.body.error.issues) {
      expect(Object.keys(issue).sort()).toEqual(['code', 'path']);
    }
  });

  it('rejects malformed JSON and oversized bodies with stable codes', async () => {
    const { app } = buildApp();
    const malformed = await request(app)
      .post('/api/v1/test/echo')
      .set('Content-Type', 'application/json')
      .send('{"name":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('MALFORMED_REQUEST');
    const huge = await request(app)
      .post('/api/v1/test/echo')
      .send({ name: 'x'.repeat(200 * 1024), amount: '1' });
    expect(huge.status).toBe(413);
    expect(huge.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('centralized errors (PLAT-008)', () => {
  it('returns NOT_FOUND with the correlation ID for unknown routes', async () => {
    const res = await request(buildApp().app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', correlationId: res.headers['x-correlation-id'] },
    });
  });

  it('maps expected failures to their code', async () => {
    const res = await request(buildApp().app).get('/api/v1/test/conflict');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('hides unexpected error messages from the client but logs them with the correlation ID', async () => {
    const { app, logs } = buildApp();
    const res = await request(app).get('/api/v1/test/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
    expect(logs()).toContain(res.headers['x-correlation-id']);
  });
});

describe('rate limiting (SEC-003)', () => {
  it('returns RATE_LIMITED with Retry-After once the budget is spent', async () => {
    const { app } = buildApp({ rateLimiter: new RateLimiterMemory({ points: 2, duration: 60 }) });
    await request(app).get('/api/v1/openapi.json');
    await request(app).get('/api/v1/openapi.json');
    const res = await request(app).get('/api/v1/openapi.json');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('never throttles health probes', async () => {
    const { app } = buildApp({ rateLimiter: new RateLimiterMemory({ points: 1, duration: 60 }) });
    for (let i = 0; i < 3; i += 1)
      expect((await request(app).get('/health/live')).status).toBe(200);
  });
});

describe('CSRF origin guard (SEC-002)', () => {
  it('rejects a cookie-bearing state change from a foreign origin', async () => {
    const res = await request(buildApp().app)
      .post('/api/v1/test/echo')
      .set('Cookie', 'session=abc')
      .set('Origin', 'https://evil.example')
      .send({ name: 'a', amount: '1' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });

  it('allows the same request from an allowed origin, and cookie-less requests', async () => {
    const { app } = buildApp();
    const allowed = await request(app)
      .post('/api/v1/test/echo')
      .set('Cookie', 'session=abc')
      .set('Origin', ALLOWED)
      .send({ name: 'a', amount: '1' });
    expect(allowed.status).toBe(200);
    const noCookie = await request(app).post('/api/v1/test/echo').send({ name: 'a', amount: '1' });
    expect(noCookie.status).toBe(200);
  });
});

describe('request logs (PLAT-006, SEC-007)', () => {
  it('redact credentials from logged request headers', async () => {
    const { app, logs } = buildApp();
    await request(app)
      .post('/api/v1/test/echo')
      .set('Authorization', 'Bearer very-secret-token-value')
      .set('Cookie', 'session=very-secret-cookie')
      .set('Origin', ALLOWED)
      .send({ name: 'a', amount: '1' });
    const text = logs();
    expect(text).toContain('/api/v1/test/echo');
    expect(text).not.toContain('very-secret-token-value');
    expect(text).not.toContain('very-secret-cookie');
  });
});

describe('OpenAPI (PLAT-010)', () => {
  it('serves an OpenAPI 3.1 document whose references all resolve', async () => {
    const res = await request(buildApp().app).get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/health/live', '/health/ready']),
    );
    const refs = [...JSON.stringify(res.body).matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g)];
    expect(refs.length).toBeGreaterThan(0);
    for (const [, name] of refs) expect(res.body.components.schemas[name as string]).toBeDefined();
    expect(res.body.components.schemas.ReadinessResponse.properties.checks).toBeDefined();
  });
});
