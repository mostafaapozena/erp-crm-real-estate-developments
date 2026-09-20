import {
  AUDIT_ACTIONS,
  ActorContextSchema,
  PERMISSIONS,
  ScopeAssignmentSchema,
  type AuditEvent,
  type Permission,
  type ScopeAssignment,
} from '@alola/contracts';
import { createLogger } from '@alola/security';
import { serviceGate } from '@alola/testing';
import type { Express } from 'express';
import mongoose, { type Connection } from 'mongoose';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type ApiModule } from '../../app';
import { noteAuditWrite } from '../../http/audit-context';
import type { GuardOptions } from '../../http/actor';
import { ensureIndexes } from '../../platform/indexes';
import { configureMongoose } from '../../platform/mongo';
import { AUDIT_COLLECTION, AuditService, auditRouter } from '../audit';
import { accountGrantModel, roleModel } from './model';
import { securityRouter } from './router';
import { SecurityService } from './service';

/**
 * Authorization enforced through the real HTTP pipeline against a real MongoDB replica set
 * (SEC-023 … SEC-032, AUDIT-003 … AUDIT-005).
 *
 * The suite drives the application the way a client does: every expectation is about what the API
 * answers and what is stored, never about an internal function call.
 */
const gate = serviceGate(['mongodb']);
const logger = createLogger({ name: 'authz-int', level: 'silent' });

const RUN = `it-authz-${Date.now()}`;

/** Accounts. Each id is an opaque security-account reference, never an employee record (ADR-0019). */
const SUPER = `${RUN}-super`;
const ADMIN = `${RUN}-admin`;
const AUDITOR = `${RUN}-auditor`;
const EXPORTER = `${RUN}-exporter`;
const GRANT_VIEWER = `${RUN}-grantviewer`;
const DENIED = `${RUN}-denied`;
const NOBODY = `${RUN}-nobody`;
const FLIP = `${RUN}-flip`;
const STRANGER = `${RUN}-stranger`;

/** Roles. */
const R_SUPER = `${RUN}-r-super`;
const R_ADMIN = `${RUN}-r-admin`;
const R_AUDITOR = `${RUN}-r-auditor`;
const R_EXPORTER = `${RUN}-r-exporter`;
const R_GRANT_VIEWER = `${RUN}-r-grantviewer`;

const TARGET_ID = `${RUN}-seed-target`;
const ALLOWED_ORIGIN = 'http://localhost:5173';

const scope = (
  level: ScopeAssignment['level'],
  overrides: Partial<ScopeAssignment> = {},
): ScopeAssignment => ScopeAssignmentSchema.parse({ level, ...overrides });

/**
 * Test-only actor resolution: an account id arrives in a header and the actor is then built **on the
 * server** from stored grants, so the authorization path under test is the production one. This is a
 * fixture for exercising authorization, not authentication — session login, MFA, and device trust are
 * `SEC-013`, `SEC-014`, and `SEC-018`, and none of them exists yet.
 */
const ACCOUNT_HEADER = 'x-test-account';

describe.skipIf(!gate.available)(`authorization over HTTP — ${gate.reason}`, () => {
  let connection: Connection;
  let audit: AuditService;
  let security: SecurityService;
  let app: Express;

  /** Requests as an account; a request without one carries no actor at all. */
  const as = (accountId?: string) => {
    const withAccount = <T extends { set: (field: string, value: string) => T }>(call: T): T =>
      accountId ? call.set(ACCOUNT_HEADER, accountId) : call;
    return {
      get: (path: string) => withAccount(request(app).get(path)),
      post: (path: string) => withAccount(request(app).post(path).set('Origin', ALLOWED_ORIGIN)),
      put: (path: string) => withAccount(request(app).put(path).set('Origin', ALLOWED_ORIGIN)),
      patch: (path: string) => withAccount(request(app).patch(path).set('Origin', ALLOWED_ORIGIN)),
      delete: (path: string) =>
        withAccount(request(app).delete(path).set('Origin', ALLOWED_ORIGIN)),
    };
  };

  async function seedRole(key: string, permissions: Permission[]): Promise<void> {
    const now = new Date();
    await roleModel(connection).create({
      key,
      name: { ar: `دور ${key}`, en: `role ${key}` },
      permissions: [...permissions].sort(),
      isAdministrative: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  async function seedGrant(
    accountId: string,
    roleKeys: string[],
    level: ScopeAssignment['level'],
    deniedPermissions: Permission[] = [],
    scopeOverrides: Partial<ScopeAssignment> = {},
  ): Promise<void> {
    await accountGrantModel(connection).create({
      accountId,
      roleKeys,
      deniedPermissions,
      scope: scope(level, scopeOverrides),
      version: 1,
      updatedAt: new Date(),
      updatedBy: `${RUN}-bootstrap`,
    });
  }

  /** The same denial recorder the application wires in `main.ts` (AUDIT-005). */
  const guard = (): GuardOptions => ({
    onDenied: (denial) =>
      audit
        .record({
          action: AUDIT_ACTIONS.authorizationDenied,
          outcome: 'denied',
          actor: denial.actor
            ? {
                kind: denial.actor.kind,
                accountId: denial.actor.accountId,
                roleKeys: denial.actor.roleKeys,
              }
            : { kind: 'anonymous' },
          target: { type: 'endpoint', id: `${denial.method} ${denial.route}` },
          reason: `missing permission: ${denial.requiredPermission}`,
          context: {
            correlationId: denial.correlationId,
            method: denial.method,
            route: denial.route,
          },
        })
        .then(() => undefined),
  });

  beforeAll(async () => {
    configureMongoose();
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'],
      serverSelectionTimeoutMS: 10_000,
    });
    await connection.asPromise();
    await ensureIndexes(connection, logger);

    audit = new AuditService({ connection, logger, onRecorded: noteAuditWrite });
    security = new SecurityService({ connection, audit });

    // Bootstrap: the first roles and grants cannot be created through an API that requires permissions
    // nobody holds yet. Everything after this point goes through HTTP.
    await seedRole(R_SUPER, [...PERMISSIONS]);
    await seedRole(R_ADMIN, [
      'security.role.view',
      'security.role.create',
      'security.grant.view',
      'security.grant.assign',
      'audit.view',
    ]);
    await seedRole(R_AUDITOR, ['audit.view']);
    await seedRole(R_EXPORTER, ['audit.view', 'audit.export']);
    await seedRole(R_GRANT_VIEWER, ['security.grant.view']);

    await seedGrant(SUPER, [R_SUPER], 'all');
    // A team scope, while audit records carry no team reference: the fail-closed case.
    await seedGrant(ADMIN, [R_ADMIN], 'team', [], { teamIds: [`${RUN}-team`] });
    await seedGrant(AUDITOR, [R_AUDITOR], 'self');
    await seedGrant(EXPORTER, [R_EXPORTER], 'all');
    await seedGrant(GRANT_VIEWER, [R_GRANT_VIEWER], 'self');
    // Holds the admin role but is explicitly denied one of its permissions: deny must win.
    await seedGrant(DENIED, [R_ADMIN], 'self', ['security.role.view']);
    // A grant with no roles: identified, authorized for nothing.
    await seedGrant(NOBODY, [], 'self', ['audit.view']);
    await seedGrant(FLIP, [], 'self');

    const seed = (accountId: string) =>
      audit.record({
        action: AUDIT_ACTIONS.grantUpdated,
        outcome: 'succeeded',
        actor: { kind: 'account', accountId, roleKeys: [R_ADMIN] },
        target: { type: 'accountGrant', id: TARGET_ID },
        changes: [{ path: 'roleKeys', from: '[]', to: `["${R_AUDITOR}"]` }],
        reason: 'seeded',
        context: {
          correlationId: `${RUN}-seed`,
          ip: '203.0.113.7',
          userAgent: 'vitest-seed',
          method: 'PUT',
          route: '/api/v1/security/accounts/:accountId/grants',
        },
      });
    await seed(AUDITOR);
    await seed(AUDITOR);
    await seed(STRANGER);

    const modules: ApiModule[] = [
      { basePath: '/audit', router: auditRouter({ getService: () => audit, guard: guard() }) },
      {
        basePath: '/security',
        router: securityRouter({ getService: () => security, guard: guard() }),
      },
    ];

    app = createApp({
      config: { CORS_ALLOWED_ORIGINS: [ALLOWED_ORIGIN], TRUST_PROXY_HOPS: 0, APP_ENV: 'test' },
      logger,
      mongo: { health: () => Promise.resolve({ status: 'up', transactions: true }) },
      redis: { health: () => Promise.resolve({ status: 'up' }) },
      rateLimiter: new RateLimiterMemory({ points: 100_000, duration: 60 }),
      actorResolver: (req) => {
        const accountId = req.header(ACCOUNT_HEADER);
        return accountId ? security.resolveActor(accountId) : Promise.resolve(undefined);
      },
      modules,
    });
  });

  afterAll(async () => {
    if (!connection) return;
    // Audit records have no delete path in the application (AUDIT-001), so the test removes its own
    // records the way a privileged operator would — the documented limit of application immutability.
    await connection.db?.collection(AUDIT_COLLECTION).deleteMany({
      $or: [
        { 'actor.accountId': { $regex: `^${RUN}` } },
        { 'context.correlationId': { $regex: `^${RUN}` } },
        { 'target.id': { $regex: `^${RUN}` } },
      ],
    });
    // Roles and grants are configuration rather than evidence, so the models delete them normally.
    await roleModel(connection).deleteMany({ key: { $regex: `^${RUN}` } });
    await accountGrantModel(connection).deleteMany({ accountId: { $regex: `^${RUN}` } });
    await connection.close();
  });

  /** Filter isolating the seeded events from the read events each test produces. */
  const seededQuery = `action=${AUDIT_ACTIONS.grantUpdated}&targetId=${TARGET_ID}`;

  async function denialEvents(permission: Permission): Promise<AuditEvent[]> {
    const reader = ActorContextSchema.parse({
      accountId: SUPER,
      permissions: [...PERMISSIONS],
      scope: scope('all'),
    });
    const page = await audit.query(reader, {
      limit: 100,
      action: AUDIT_ACTIONS.authorizationDenied,
      outcome: 'denied',
    });
    return page.items.filter((event) => (event.reason ?? '').includes(permission));
  }

  describe('SEC-025: default deny', () => {
    it('answers 401 when the request carries no actor', async () => {
      const res = await as().get('/api/v1/audit/events');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('answers 401 for an account that has no grant record at all', async () => {
      const res = await as(`${RUN}-unknown-account`).get('/api/v1/audit/events');
      expect(res.status).toBe(401);
    });

    it('answers 403 for an identified account holding no permissions', async () => {
      const res = await as(NOBODY).get('/api/v1/audit/events');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('never names the missing permission or the policy in the response', async () => {
      const res = await as(NOBODY).get('/api/v1/security/roles');
      expect(res.status).toBe(403);
      expect(Object.keys(res.body.error).sort()).toEqual(['code', 'correlationId']);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('security.role.view');
      expect(body).not.toContain('permission');
      expect(body).not.toContain('scope');
    });

    it('guards every module route, so there is no unprotected read surface', async () => {
      const res = await as(NOBODY).get(`/api/v1/security/accounts/${AUDITOR}/grants`);
      expect(res.status).toBe(403);
    });

    it('lets an explicit denial win over a role that grants the permission', async () => {
      expect((await as(ADMIN).get('/api/v1/security/roles')).status).toBe(200);
      expect((await as(DENIED).get('/api/v1/security/roles')).status).toBe(403);
      // The same account still holds the rest of the role.
      expect((await as(DENIED).get(`/api/v1/security/accounts/${NOBODY}/grants`)).status).toBe(200);
    });
  });

  describe('SEC-025: authority is never taken from the request', () => {
    it('ignores headers and cookies claiming roles or permissions', async () => {
      const res = await as(NOBODY)
        .get('/api/v1/security/roles')
        .set('x-roles', R_SUPER)
        .set('x-permissions', 'security.role.view')
        .set('Cookie', `roles=${R_SUPER}; permissions=security.role.view`);
      expect(res.status).toBe(403);
    });

    it('rejects a role body that tries to set server-owned fields', async () => {
      const key = `${RUN}-r-massassign`;
      const res = await as(SUPER)
        .post('/api/v1/security/roles')
        .send({
          key,
          name: { ar: 'اسم', en: 'name' },
          permissions: ['audit.view'],
          isAdministrative: true,
          version: 99,
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(await roleModel(connection).findOne({ key }).exec()).toBeNull();
    });

    it('rejects a grant body carrying server-owned fields', async () => {
      const res = await as(SUPER)
        .put(`/api/v1/security/accounts/${STRANGER}/grants`)
        .send({
          roleKeys: [R_AUDITOR],
          deniedPermissions: [],
          scope: { level: 'self' },
          version: 42,
          updatedBy: SUPER,
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(await security.getGrant(STRANGER)).toBeUndefined();
    });

    it('rejects MongoDB operators in a path parameter and in a filter', async () => {
      const injected = await as(SUPER).get(
        `/api/v1/security/accounts/${encodeURIComponent('{"$ne":null}')}/grants`,
      );
      expect(injected.status).toBe(400);
      const operator = await as(SUPER).get('/api/v1/audit/events?actorAccountId[$ne]=');
      expect(operator.status).toBe(400);
      const unknownFilter = await as(SUPER).get('/api/v1/audit/events?isAdmin=true');
      expect(unknownFilter.status).toBe(400);
    });

    it('caps the page size instead of trusting the requested limit', async () => {
      const res = await as(SUPER).get('/api/v1/audit/events?limit=5000');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('SEC-026, SEC-027, SEC-028: the scope is applied inside the query', () => {
    it('returns only the actor’s own records at self scope, with a scoped total', async () => {
      const res = await as(AUDITOR).get(`/api/v1/audit/events?${seededQuery}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      expect(res.body.items).toHaveLength(2);
      for (const item of res.body.items as AuditEvent[]) {
        expect(item.actor.accountId).toBe(AUDITOR);
      }
    });

    it('returns every record at “all” scope, so the difference is the scope and not the data', async () => {
      const res = await as(SUPER).get(`/api/v1/audit/events?${seededQuery}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect((res.body.items as AuditEvent[]).map((item) => item.actor.accountId)).toContain(
        STRANGER,
      );
    });

    it('returns nothing when a scope cannot be satisfied, instead of everything', async () => {
      const res = await as(ADMIN).get(`/api/v1/audit/events?${seededQuery}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('keeps the scoped total consistent across pages', async () => {
      const first = await as(SUPER).get(`/api/v1/audit/events?${seededQuery}&limit=2`);
      expect(first.body.items).toHaveLength(2);
      expect(first.body.total).toBe(3);
      expect(first.body.nextCursor).toBeDefined();
      const second = await as(SUPER).get(
        `/api/v1/audit/events?${seededQuery}&limit=2&cursor=${encodeURIComponent(
          first.body.nextCursor as string,
        )}`,
      );
      expect(second.body.items).toHaveLength(1);
      expect(second.body.nextCursor).toBeUndefined();
      const ids = [...first.body.items, ...second.body.items].map(
        (item: AuditEvent) => item.eventId,
      );
      expect(new Set(ids).size).toBe(3);
    });
  });

  describe('SEC-030: an out-of-scope record is indistinguishable from an absent one', () => {
    it('answers 404, not 403, for a record outside the actor’s scope', async () => {
      const all = await as(SUPER).get(`/api/v1/audit/events?${seededQuery}`);
      const items = all.body.items as AuditEvent[];
      const foreign = items.find((item) => item.actor.accountId === STRANGER);
      const own = items.find((item) => item.actor.accountId === AUDITOR);
      expect(foreign?.eventId).toBeDefined();
      expect(own?.eventId).toBeDefined();

      const outOfScope = await as(AUDITOR).get(`/api/v1/audit/events/${foreign?.eventId}`);
      const absent = await as(AUDITOR).get(`/api/v1/audit/events/${RUN}-absent`);
      expect(outOfScope.status).toBe(404);
      expect(absent.status).toBe(404);
      // The two answers are identical apart from the correlation ID, so neither confirms existence.
      expect(outOfScope.body.error.code).toBe(absent.body.error.code);
      expect(Object.keys(outOfScope.body.error).sort()).toEqual(
        Object.keys(absent.body.error).sort(),
      );

      const allowed = await as(AUDITOR).get(`/api/v1/audit/events/${own?.eventId}`);
      expect(allowed.status).toBe(200);
      expect(allowed.body.eventId).toBe(own?.eventId);
    });
  });

  describe('SEC-029: field restrictions apply to everything the server serializes', () => {
    it('removes restricted audit fields from a list response', async () => {
      const res = await as(AUDITOR).get(`/api/v1/audit/events?${seededQuery}`);
      for (const item of res.body.items as AuditEvent[]) {
        expect(item).not.toHaveProperty('changes');
        expect(item.context).not.toHaveProperty('ip');
        expect(item.context).not.toHaveProperty('userAgent');
        expect(item.context.correlationId).toBeDefined();
      }
    });

    it('includes the same fields for an actor entitled to them', async () => {
      const res = await as(SUPER).get(`/api/v1/audit/events?${seededQuery}`);
      const seeded = (res.body.items as AuditEvent[]).find((item) => item.reason === 'seeded');
      expect(seeded?.changes).toBeDefined();
      expect(seeded?.context.ip).toBe('203.0.113.7');
    });

    it('removes restricted fields from a single record and from an export', async () => {
      const list = await as(AUDITOR).get(`/api/v1/audit/events?${seededQuery}&limit=1`);
      const eventId = (list.body.items as AuditEvent[])[0]?.eventId;
      const one = await as(AUDITOR).get(`/api/v1/audit/events/${eventId}`);
      expect(one.status).toBe(200);
      expect(one.body).not.toHaveProperty('changes');

      const exported = await as(EXPORTER).get(`/api/v1/audit/events/export?${seededQuery}`);
      expect(exported.status).toBe(200);
      expect(exported.headers['content-type']).toContain('application/x-ndjson');
      expect(exported.headers['x-export-truncated']).toBe('false');
      const rows = exported.text
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AuditEvent);
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row).not.toHaveProperty('changes');
        expect(row.context).not.toHaveProperty('ip');
      }
    });

    it('requires a separate permission to export at all', async () => {
      expect((await as(AUDITOR).get('/api/v1/audit/events/export')).status).toBe(403);
    });

    it('removes a grant’s denial list from an actor who may only view grants', async () => {
      const viewer = await as(GRANT_VIEWER).get(`/api/v1/security/accounts/${NOBODY}/grants`);
      expect(viewer.status).toBe(200);
      expect(viewer.body.roleKeys).toEqual([]);
      expect(viewer.body).not.toHaveProperty('deniedPermissions');

      const assigner = await as(ADMIN).get(`/api/v1/security/accounts/${NOBODY}/grants`);
      expect(assigner.status).toBe(200);
      expect(assigner.body.deniedPermissions).toEqual(['audit.view']);
    });
  });

  describe('SEC-031: privilege escalation is refused', () => {
    it('refuses to let an actor modify their own grants', async () => {
      const before = await security.getGrant(ADMIN);
      const res = await as(ADMIN)
        .put(`/api/v1/security/accounts/${ADMIN}/grants`)
        .send({ roleKeys: [R_SUPER], deniedPermissions: [], scope: { level: 'all' } });
      expect(res.status).toBe(403);
      const after = await security.getGrant(ADMIN);
      expect(after?.version).toBe(before?.version);
      expect(after?.roleKeys).toEqual([R_ADMIN]);
    });

    it('refuses to grant permissions the actor does not hold', async () => {
      const target = `${RUN}-escalation-target`;
      const res = await as(ADMIN)
        .put(`/api/v1/security/accounts/${target}/grants`)
        .send({ roleKeys: [R_SUPER], deniedPermissions: [], scope: { level: 'self' } });
      expect(res.status).toBe(403);
      expect(await security.getGrant(target)).toBeUndefined();
    });

    it('records a refused escalation attempt as evidence', async () => {
      const target = `${RUN}-escalation-evidence`;
      const res = await as(ADMIN)
        .put(`/api/v1/security/accounts/${target}/grants`)
        .send({ roleKeys: [R_SUPER], deniedPermissions: [], scope: { level: 'self' } });
      expect(res.status).toBe(403);

      const events = await as(SUPER).get(
        `/api/v1/audit/events?action=${AUDIT_ACTIONS.authorizationDenied}&targetId=${target}&outcome=denied`,
      );
      expect(events.body.total).toBe(1);
      const event = (events.body.items as AuditEvent[])[0] as AuditEvent;
      expect(event.actor.accountId).toBe(ADMIN);
      expect(event.target.type).toBe('accountGrant');
      expect(event.reason).toContain('privilege escalation refused');
    });

    it('refuses to grant a scope wider than the actor’s own', async () => {
      const target = `${RUN}-scope-target`;
      const tooWide = await as(ADMIN)
        .put(`/api/v1/security/accounts/${target}/grants`)
        .send({ roleKeys: [R_AUDITOR], deniedPermissions: [], scope: { level: 'all' } });
      expect(tooWide.status).toBe(403);
      expect(await security.getGrant(target)).toBeUndefined();

      const withinScope = await as(ADMIN)
        .put(`/api/v1/security/accounts/${target}/grants`)
        .send({ roleKeys: [R_AUDITOR], deniedPermissions: [], scope: { level: 'self' } });
      expect(withinScope.status).toBe(200);
      expect(withinScope.body.roleKeys).toEqual([R_AUDITOR]);
      expect(withinScope.body.updatedBy).toBe(ADMIN);
    });

    it('allows the same assignment for an actor holding the explicit “assign any” permission', async () => {
      const target = `${RUN}-assignany-target`;
      const res = await as(SUPER)
        .put(`/api/v1/security/accounts/${target}/grants`)
        .send({ roleKeys: [R_SUPER], deniedPermissions: [], scope: { level: 'all' } });
      expect(res.status).toBe(200);
      expect(res.body.scope.level).toBe('all');
    });

    it('refuses to mint a role carrying permissions the actor lacks', async () => {
      const key = `${RUN}-r-escalation`;
      const res = await as(ADMIN)
        .post('/api/v1/security/roles')
        .send({
          key,
          name: { ar: 'تصعيد', en: 'escalation' },
          permissions: ['security.grant.assignAny'],
        });
      expect(res.status).toBe(403);
      expect(await roleModel(connection).findOne({ key }).exec()).toBeNull();
    });

    it('allows a role built only from permissions the actor holds, once', async () => {
      const key = `${RUN}-r-allowed`;
      const body = { key, name: { ar: 'مسموح', en: 'allowed' }, permissions: ['audit.view'] };
      const res = await as(ADMIN).post('/api/v1/security/roles').send(body);
      expect(res.status).toBe(201);
      expect(res.body.permissions).toEqual(['audit.view']);
      expect(res.body.isAdministrative).toBe(false);
      const second = await as(ADMIN).post('/api/v1/security/roles').send(body);
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('CONFLICT');
    });

    it('flags an administrative role as administrative', async () => {
      const key = `${RUN}-r-administrative`;
      const res = await as(SUPER)
        .post('/api/v1/security/roles')
        .send({
          key,
          name: { ar: 'إداري', en: 'administrative' },
          permissions: ['security.grant.assign'],
        });
      expect(res.status).toBe(201);
      expect(res.body.isAdministrative).toBe(true);
    });
  });

  describe('SEC-032: a grant change takes effect on the next request', () => {
    it('applies a new grant immediately, with no cache to invalidate', async () => {
      expect((await as(FLIP).get('/api/v1/security/roles')).status).toBe(403);

      const assigned = await as(SUPER)
        .put(`/api/v1/security/accounts/${FLIP}/grants`)
        .send({ roleKeys: [R_ADMIN], deniedPermissions: [], scope: { level: 'self' } });
      expect(assigned.status).toBe(200);
      expect(assigned.body.version).toBe(2);
      expect((await as(FLIP).get('/api/v1/security/roles')).status).toBe(200);

      const revoked = await as(SUPER)
        .put(`/api/v1/security/accounts/${FLIP}/grants`)
        .send({ roleKeys: [], deniedPermissions: [], scope: { level: 'self' } });
      expect(revoked.body.version).toBe(3);
      expect((await as(FLIP).get('/api/v1/security/roles')).status).toBe(403);
    });

    it('rejects an assignment naming a role that does not exist', async () => {
      const target = `${RUN}-unknown-role-target`;
      const res = await as(SUPER)
        .put(`/api/v1/security/accounts/${target}/grants`)
        .send({ roleKeys: [`${RUN}-missing`], deniedPermissions: [], scope: { level: 'self' } });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(await security.getGrant(target)).toBeUndefined();
    });
  });

  describe('AUDIT-004, AUDIT-005: authorization activity is evidence', () => {
    it('records every denial as a security event with the actor and the endpoint', async () => {
      await as(NOBODY).get('/api/v1/security/roles');
      const fromNobody = (await denialEvents('security.role.view')).filter(
        (event) => event.actor.accountId === NOBODY,
      );
      expect(fromNobody.length).toBeGreaterThan(0);
      const event = fromNobody[0] as AuditEvent;
      expect(event.outcome).toBe('denied');
      expect(event.target.type).toBe('endpoint');
      expect(event.target.id).toContain('/api/v1/security/roles');
      expect(event.actor.kind).toBe('account');
    });

    it('records an anonymous denial without inventing an account', async () => {
      await as().get('/api/v1/security/roles');
      const anonymous = (await denialEvents('security.role.view')).filter(
        (event) => event.actor.kind === 'anonymous',
      );
      expect(anonymous.length).toBeGreaterThan(0);
      expect(anonymous[0]?.actor.accountId).toBeUndefined();
    });

    it('records a role creation with a change summary', async () => {
      const key = `${RUN}-r-audited`;
      await as(SUPER)
        .post('/api/v1/security/roles')
        .send({ key, name: { ar: 'مراجع', en: 'audited' }, permissions: ['audit.view'] });
      const res = await as(SUPER).get(
        `/api/v1/audit/events?action=${AUDIT_ACTIONS.roleCreated}&targetType=role&targetId=${key}`,
      );
      expect(res.body.total).toBe(1);
      const event = (res.body.items as AuditEvent[])[0] as AuditEvent;
      expect(event.actor.accountId).toBe(SUPER);
      expect(event.context.method).toBe('POST');
      const paths = (event.changes ?? []).map((change) => change.path);
      expect(paths).toContain('key');
      expect(paths).toContain('permissions');
    });

    it('records a grant change with before and after summaries', async () => {
      const target = `${RUN}-audited-grant`;
      await as(SUPER)
        .put(`/api/v1/security/accounts/${target}/grants`)
        .send({ roleKeys: [R_AUDITOR], deniedPermissions: [], scope: { level: 'self' } });
      await as(SUPER)
        .put(`/api/v1/security/accounts/${target}/grants`)
        .send({
          roleKeys: [R_EXPORTER],
          deniedPermissions: ['audit.export'],
          scope: { level: 'team' },
        });

      const res = await as(SUPER).get(
        `/api/v1/audit/events?action=${AUDIT_ACTIONS.grantUpdated}&targetId=${target}`,
      );
      expect(res.body.total).toBe(2);
      const latest = (res.body.items as AuditEvent[])[0] as AuditEvent;
      const roleChange = (latest.changes ?? []).find((change) => change.path === 'roleKeys');
      expect(roleChange?.from).toContain(R_AUDITOR);
      expect(roleChange?.to).toContain(R_EXPORTER);
      expect((latest.changes ?? []).find((change) => change.path === 'scope.level')).toEqual({
        path: 'scope.level',
        from: 'self',
        to: 'team',
      });
    });

    it('records reading audit data as a sensitive read', async () => {
      const correlationId = `${RUN}-read-marker`;
      await as(SUPER)
        .get(`/api/v1/audit/events?${seededQuery}`)
        .set('x-correlation-id', correlationId);
      const res = await as(SUPER).get(
        `/api/v1/audit/events?action=${AUDIT_ACTIONS.auditRead}&correlationId=${correlationId}`,
      );
      expect(res.body.total).toBe(1);
      expect((res.body.items as AuditEvent[])[0]?.reason).toContain('total=');
    });

    it('records an export before any row leaves the server', async () => {
      const correlationId = `${RUN}-export-marker`;
      await as(EXPORTER)
        .get(`/api/v1/audit/events/export?${seededQuery}`)
        .set('x-correlation-id', correlationId);
      const res = await as(SUPER).get(
        `/api/v1/audit/events?action=${AUDIT_ACTIONS.auditExported}&correlationId=${correlationId}`,
      );
      expect(res.body.total).toBe(1);
      expect((res.body.items as AuditEvent[])[0]?.reason).toContain('rows=3');
    });
  });

  describe('AUDIT-001, AUDIT-003 over HTTP', () => {
    it('exposes no endpoint that changes or removes an audit record', async () => {
      const list = await as(SUPER).get(`/api/v1/audit/events?${seededQuery}&limit=1`);
      const eventId = (list.body.items as AuditEvent[])[0]?.eventId as string;
      const attempts = [
        as(SUPER).put(`/api/v1/audit/events/${eventId}`),
        as(SUPER).patch(`/api/v1/audit/events/${eventId}`),
        as(SUPER).delete(`/api/v1/audit/events/${eventId}`),
        as(SUPER).post('/api/v1/audit/events'),
      ];
      for (const attempt of attempts) {
        const res = await attempt.send({ reason: 'tampered' });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
      const after = await as(SUPER).get(`/api/v1/audit/events/${eventId}`);
      expect(after.status).toBe(200);
      expect(after.body.reason).toBe('seeded');
    });

    it('audits the mutations it serves, which is what keeps AUDIT-003 satisfied', async () => {
      const target = `${RUN}-audit003`;
      const res = await as(SUPER)
        .put(`/api/v1/security/accounts/${target}/grants`)
        .send({ roleKeys: [R_AUDITOR], deniedPermissions: [], scope: { level: 'self' } });
      // A 200 is itself the evidence: an unaudited mutation is turned into a 500 by the pipeline.
      expect(res.status).toBe(200);
      const events = await as(SUPER).get(
        `/api/v1/audit/events?action=${AUDIT_ACTIONS.grantUpdated}&targetId=${target}`,
      );
      expect(events.body.total).toBe(1);
    });
  });
});
