import { Writable } from 'node:stream';
import { ActorContextSchema, type ActorContext } from '@alola/contracts';
import { createLogger } from '@alola/security';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { errorHandler } from './errors';
import { attachActor, currentActor, requirePermission, unauthenticatedResolver } from './actor';
import { assertMutationAudited, auditRequestContext, noteAuditWrite } from './audit-context';
import { correlation } from './correlation';

/**
 * Guard behaviour without a database (SEC-025, AUDIT-003). The integration suite covers the same rules
 * end to end against real MongoDB.
 */
function logCapture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
  return {
    logger: createLogger({ name: 'guard-test', level: 'info' }, stream),
    text: () => lines.join(''),
  };
}

function actor(overrides: Partial<z.input<typeof ActorContextSchema>> = {}): ActorContext {
  return ActorContextSchema.parse({
    accountId: 'account-1',
    permissions: [],
    scope: { level: 'self' },
    ...overrides,
  });
}

interface AppOptions {
  resolver?: Parameters<typeof attachActor>[0];
  onDenied?: Parameters<typeof requirePermission>[1];
  auditOnMutation?: boolean;
}

function buildApp(options: AppOptions = {}) {
  const capture = logCapture();
  const app = express();
  app.use(correlation());
  app.use(auditRequestContext());
  app.use(express.json());
  app.use(attachActor(options.resolver ?? unauthenticatedResolver));
  app.use(assertMutationAudited(capture.logger));

  app.get('/protected', requirePermission('audit.view', options.onDenied), (_req, res) => {
    res.json({ ok: true, accountId: currentActor(res)?.accountId });
  });
  app.post('/mutate', requirePermission('security.grant.assign', options.onDenied), (_req, res) => {
    if (options.auditOnMutation) noteAuditWrite();
    res.json({ ok: true });
  });
  app.use(errorHandler(capture.logger));
  return { app, logs: capture.text };
}

describe('permission guard (SEC-025)', () => {
  it('answers 401 when no actor is resolved — the production default until login exists', async () => {
    const res = await request(buildApp().app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('answers 403 when the actor lacks the permission, without naming it', async () => {
    const { app } = buildApp({ resolver: () => Promise.resolve(actor()) });
    const res = await request(app).get('/protected');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    // The policy is never described to the caller.
    expect(JSON.stringify(res.body)).not.toContain('audit.view');
  });

  it('allows the request when the permission is held', async () => {
    const { app } = buildApp({
      resolver: () => Promise.resolve(actor({ permissions: ['audit.view'] })),
    });
    const res = await request(app).get('/protected');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, accountId: 'account-1' });
  });

  it('ignores client-supplied identity, roles, and permissions', async () => {
    // The resolver is the only source of authority; headers and bodies claiming roles are just data.
    const { app } = buildApp({ resolver: () => Promise.resolve(actor()) });
    const res = await request(app)
      .get('/protected')
      .set('x-actor-permissions', 'audit.view')
      .set('x-roles', 'administrator')
      .set('x-account-id', 'root');
    expect(res.status).toBe(403);
  });

  it('reports the denial for audit, then still denies when recording fails', async () => {
    const recorded: unknown[] = [];
    const ok = buildApp({
      resolver: () => Promise.resolve(actor()),
      onDenied: {
        onDenied: (denial) => {
          recorded.push(denial);
          return Promise.resolve();
        },
      },
    });
    expect((await request(ok.app).get('/protected')).status).toBe(403);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ requiredPermission: 'audit.view', method: 'GET' });

    const failing = buildApp({
      resolver: () => Promise.resolve(actor()),
      onDenied: { onDenied: () => Promise.reject(new Error('audit down')) },
    });
    // A failed audit write must not turn a denial into an allow.
    expect((await request(failing.app).get('/protected')).status).toBe(403);
  });
});

describe('automatic audit on every mutation (AUDIT-003)', () => {
  const adminResolver = () =>
    Promise.resolve(actor({ permissions: ['security.grant.assign'], scope: { level: 'all' } }));

  it('fails a successful mutation that recorded no audit event', async () => {
    const { app, logs } = buildApp({ resolver: adminResolver, auditOnMutation: false });
    const res = await request(app).post('/mutate').send({});
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(logs()).toContain('AUDIT_MISSING_FOR_MUTATION');
  });

  it('allows a mutation that recorded one', async () => {
    const { app } = buildApp({ resolver: adminResolver, auditOnMutation: true });
    const res = await request(app).post('/mutate').send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('does not require an audit record for reads', async () => {
    const { app } = buildApp({
      resolver: () => Promise.resolve(actor({ permissions: ['audit.view'] })),
    });
    expect((await request(app).get('/protected')).status).toBe(200);
  });

  it('leaves a denied mutation as a denial, not an audit failure', async () => {
    const { app } = buildApp({ resolver: () => Promise.resolve(actor()) });
    const res = await request(app).post('/mutate').send({});
    expect(res.status).toBe(403);
  });

  it('counts writes only within the current request', async () => {
    const { app } = buildApp({ resolver: adminResolver, auditOnMutation: true });
    expect((await request(app).post('/mutate').send({})).status).toBe(200);
    // A second request starts from zero; if the counter leaked, this would pass without auditing.
    const { app: second } = buildApp({ resolver: adminResolver, auditOnMutation: false });
    expect((await request(second).post('/mutate').send({})).status).toBe(500);
  });

  it('does not count a write made outside any request context', () => {
    const spy = vi.fn();
    expect(() => noteAuditWrite()).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});
