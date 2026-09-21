import { Writable } from 'node:stream';
import {
  AUDIT_ACTIONS,
  IDENTITY_AUDIT_ACTIONS,
  PERMISSIONS,
  ScopeAssignmentSchema,
  type AuditEvent,
  type ScopeAssignment,
} from '@alola/contracts';
import { createLogger, currentTotpCode } from '@alola/security';
import { serviceGate } from '@alola/testing';
import type { Express } from 'express';
import { Redis } from 'ioredis';
import mongoose, { type Connection } from 'mongoose';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type ApiModule } from '../../app';
import type { ActorResolver, GuardOptions } from '../../http/actor';
import { noteAuditWrite } from '../../http/audit-context';
import { ensureIndexes } from '../../platform/indexes';
import { configureMongoose } from '../../platform/mongo';
import { AUDIT_COLLECTION, AuditService, auditRouter } from '../audit';
import {
  ACCOUNT_GRANTS_COLLECTION,
  ROLES_COLLECTION,
  SecurityService,
  bootstrapGrant,
  bootstrapRole,
  securityRouter,
} from '../security';
import { cookiePolicyFor } from './cookies';
import {
  accountModel,
  accountTokenModel,
  refreshTokenModel,
  sessionModel,
  type SecurityAccountDocument,
} from './model';
import { accountAdminRouter, authRouter, meRouter } from './router';
import { IdentityService } from './service';
import { AuthThrottle } from './throttle';
import { DevKeyEncryptor, PasswordHasher, TokenIssuer } from '@alola/security';

/**
 * Identity and authentication end to end (`SEC-011` … `SEC-022`) against a real MongoDB replica set and a
 * real Redis instance. Every expectation is about what the API answers or what is stored — never about an
 * internal call.
 *
 * The service clock is injectable, so idle and absolute session expiry are tested by moving time rather
 * than by waiting.
 */
const gate = serviceGate(['mongodb', 'redis']);
const RUN = `it-identity-${Date.now()}`;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const TOTP_ISSUER = 'ALOLA TEST';

/** Long enough to satisfy the policy, and distinct per purpose so a mix-up shows up as a failure. */
const FIRST_PASSWORD = 'seven-blue-harbour-lanterns';
const SECOND_PASSWORD = 'nine-quiet-almond-terraces';

const TTL = {
  sessionIdleSeconds: 1800,
  sessionAbsoluteSeconds: 43_200,
  activationSeconds: 259_200,
  passwordResetSeconds: 1800,
};

const scope = (level: ScopeAssignment['level']): ScopeAssignment =>
  ScopeAssignmentSchema.parse({ level });

function logCapture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
  return {
    logger: createLogger({ name: 'identity-int', level: 'info' }, stream),
    text: () => lines.join(''),
  };
}

describe.skipIf(!gate.available)(`identity and authentication — ${gate.reason}`, () => {
  let connection: Connection;
  let redis: Redis;
  let audit: AuditService;
  let security: SecurityService;
  let identity: IdentityService;
  let app: Express;
  let logs: () => string;
  /** The service's view of time; tests move it to reach an expiry deterministically. */
  let clock: Date;

  /** The administrator's own second factor: an account with administrative permissions must have one. */
  let adminTotpSecret = '';
  const R_ADMIN = `${RUN}-r-admin`;
  const R_PLAIN = `${RUN}-r-plain`;
  const ADMIN_LOGIN = `${RUN}-admin@example.com`;
  let adminAccountId = '';

  const api = () => request(app);

  /**
   * Distinct client addresses per call, from the documentation range. The per-IP limiter is real, and
   * without this every test in the file would be spending one shared budget — which is also why the app
   * under test trusts one proxy hop here.
   */
  let addressCounter = 0;
  function nextAddress(): string {
    addressCounter += 1;
    return `198.51.100.${(addressCounter % 250) + 1}`;
  }

  /**
   * A POST that carries a cookie must also carry an allowed Origin (the CSRF guard, `SEC-002`). Pass
   * `ip` when a test needs several calls to look like they come from one client.
   */
  const post = (path: string, ip?: string) =>
    api()
      .post(path)
      .set('Origin', ALLOWED_ORIGIN)
      .set('X-Forwarded-For', ip ?? nextAddress());

  /** `Set-Cookie` is a list; supertest's types describe it as one string. */
  function setCookies(res: { headers: Record<string, unknown> }): string[] {
    const raw: unknown = res.headers['set-cookie'];
    return Array.isArray(raw) ? raw.map(String) : [];
  }

  function refreshCookieFrom(res: { headers: Record<string, unknown> }): string {
    const raw = setCookies(res);
    const cookie = raw.find((entry) => entry.startsWith('alola_rt='));
    expect(cookie, 'refresh cookie was not set').toBeDefined();
    return (cookie as string).split(';')[0] as string;
  }

  interface Signed {
    accessToken: string;
    cookie: string;
    accountId: string;
    sessionId: string;
  }

  /** Create an account, activate it, and sign in. Returns everything a later request needs. */
  async function provision(
    localPart: string,
    options: { roleKeys?: string[]; password?: string; employeeRef?: string } = {},
  ): Promise<Signed & { loginIdentifier: string }> {
    const loginIdentifier = `${RUN}-${localPart}@example.com`;
    const password = options.password ?? FIRST_PASSWORD;
    const created = await identity.createAccount(
      adminActor(),
      {
        loginIdentifier,
        displayName: localPart,
        personalAccountAttested: true,
        ...(options.employeeRef ? { employeeRef: options.employeeRef } : {}),
      },
      context(),
    );
    await identity.activateAccount(created.activationToken, password, context());
    if (options.roleKeys?.length) {
      await grant(created.account.accountId, options.roleKeys);
    }
    const signedIn = await signIn(loginIdentifier, password);
    return { ...signedIn, loginIdentifier };
  }

  async function signIn(loginIdentifier: string, password: string): Promise<Signed> {
    const res = await post('/api/v1/auth/login').send({ loginIdentifier, password });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('authenticated');
    return {
      accessToken: res.body.accessToken,
      cookie: refreshCookieFrom(res),
      accountId: res.body.account.accountId,
      sessionId: res.body.sessionId,
    };
  }

  /**
   * Sign in as the administrator. Its permissions make a second factor mandatory (`SEC-017`), so this is
   * the two-step flow, and the clock moves on one TOTP step each time so a code is never reused.
   */
  async function adminSignIn(): Promise<Signed> {
    advanceClock(31_000);
    const challenge = await post('/api/v1/auth/login').send({
      loginIdentifier: ADMIN_LOGIN,
      password: FIRST_PASSWORD,
    });
    expect(challenge.status, JSON.stringify(challenge.body)).toBe(200);
    expect(challenge.body.status).toBe('mfaRequired');
    expect(challenge.body.stage).toBe('verify');
    const verified = await post('/api/v1/auth/mfa/verify').send({
      challengeToken: challenge.body.challengeToken,
      code: currentTotpCode({
        secret: adminTotpSecret,
        issuer: TOTP_ISSUER,
        label: ADMIN_LOGIN,
        now: clock,
      }),
    });
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    return {
      accessToken: verified.body.accessToken,
      cookie: refreshCookieFrom(verified),
      accountId: verified.body.account.accountId,
      sessionId: verified.body.sessionId,
    };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function context() {
    return { correlationId: `${RUN}-${Math.random().toString(36).slice(2)}`, method: 'POST' };
  }

  function adminActor() {
    return {
      accountId: adminAccountId || `${RUN}-bootstrap`,
      kind: 'account' as const,
      roleKeys: [R_ADMIN],
      permissions: [...PERMISSIONS],
      deniedPermissions: [],
      scope: scope('all'),
      grantVersion: 1,
    };
  }

  async function grant(accountId: string, roleKeys: string[]): Promise<void> {
    await bootstrapGrant(connection, {
      accountId,
      roleKeys,
      scope: scope('all'),
      updatedBy: `${RUN}-bootstrap`,
    });
  }

  /** Events this run produced, read straight from the collection so nothing is filtered on the way. */
  async function eventsFor(accountId: string): Promise<AuditEvent[]> {
    return (await connection.db
      ?.collection(AUDIT_COLLECTION)
      .find({ 'actor.accountId': accountId })
      .toArray()) as unknown as AuditEvent[];
  }

  async function allRunEvents(): Promise<Record<string, unknown>[]> {
    return (await connection.db
      ?.collection(AUDIT_COLLECTION)
      .find({ 'context.correlationId': { $regex: `^${RUN}` } })
      .toArray()) as unknown as Record<string, unknown>[];
  }

  beforeAll(async () => {
    configureMongoose();
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'],
      serverSelectionTimeoutMS: 10_000,
    });
    await connection.asPromise();
    await ensureIndexes(connection, createLogger({ name: 'idx', level: 'silent' }));
    redis = new Redis(process.env['REDIS_URL'] as string, { maxRetriesPerRequest: 2 });
    // Counters are shared state with a TTL; a previous run's must not decide this one's outcome.
    const stale = await redis.keys('throttle-*198.51.100.*');
    if (stale.length > 0) await redis.del(...stale);

    const capture = logCapture();
    logs = capture.text;
    clock = new Date();

    audit = new AuditService({
      connection,
      logger: capture.logger,
      onRecorded: noteAuditWrite,
    });
    security = new SecurityService({ connection, audit });

    // Roles: one that makes MFA mandatory (it holds administrative permissions), one that does not.
    await bootstrapRole(connection, {
      key: R_ADMIN,
      name: { ar: 'مسؤول', en: 'administrator' },
      permissions: [...PERMISSIONS],
      isAdministrative: true,
    });
    await bootstrapRole(connection, {
      key: R_PLAIN,
      name: { ar: 'مستخدم', en: 'user' },
      // `audit.view` is not privileged, so an account holding only this needs no second factor.
      permissions: ['audit.view'],
    });

    identity = new IdentityService({
      connection,
      logger: capture.logger,
      audit,
      hasher: new PasswordHasher(),
      tokens: new TokenIssuer({
        secret: 'integration-test-signing-secret-of-sufficient-length',
        issuer: 'alola-erp-api',
        audience: 'alola-erp',
        accessTokenTtlSeconds: 600,
        mfaChallengeTtlSeconds: 300,
      }),
      encryptor: new DevKeyEncryptor('test', Buffer.alloc(32, 5).toString('base64')),
      throttle: new AuthThrottle(redis),
      resolveGrants: (accountId) => security.resolveActor(accountId),
      ttl: TTL,
      totpIssuer: TOTP_ISSUER,
      now: () => clock,
    });

    const guard: GuardOptions = {
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
    };

    const actorResolver: ActorResolver = async (req) => {
      const header = req.get('authorization');
      if (!header || !/^Bearer /.test(header)) return undefined;
      try {
        return (await identity.resolveSession(header.slice(7).trim()))?.actor;
      } catch {
        return undefined;
      }
    };

    const identityOptions = {
      getService: () => identity,
      cookiePolicy: cookiePolicyFor('test'),
      guard,
    };
    const modules: ApiModule[] = [
      { basePath: '/audit', router: auditRouter({ getService: () => audit, guard }) },
      { basePath: '/auth', router: authRouter(identityOptions) },
      { basePath: '/me', router: meRouter(identityOptions) },
      { basePath: '/security', router: securityRouter({ getService: () => security, guard }) },
      { basePath: '/security', router: accountAdminRouter(identityOptions) },
    ];

    app = createApp({
      // One trusted hop, so `X-Forwarded-For` identifies the client the way it does behind a proxy.
      config: { CORS_ALLOWED_ORIGINS: [ALLOWED_ORIGIN], TRUST_PROXY_HOPS: 1, APP_ENV: 'test' },
      logger: capture.logger,
      mongo: { health: () => Promise.resolve({ status: 'up', transactions: true }) },
      redis: { health: () => Promise.resolve({ status: 'up' }) },
      rateLimiter: new RateLimiterMemory({ points: 100_000, duration: 60 }),
      actorResolver,
      modules,
    });

    // The administrator used to create the other accounts is itself an account, created by the
    // bootstrap path — there is no default administrator anywhere in the repository.
    const bootstrap = await identity.createBootstrapAccount(
      { loginIdentifier: ADMIN_LOGIN, displayName: 'bootstrap administrator' },
      context(),
    );
    adminAccountId = bootstrap.account.accountId;
    await identity.activateAccount(bootstrap.activationToken, FIRST_PASSWORD, context());
    await grant(adminAccountId, [R_ADMIN]);

    // Holding administrative permissions, the first sign-in is refused until a second factor exists.
    const firstAttempt = await post('/api/v1/auth/login').send({
      loginIdentifier: ADMIN_LOGIN,
      password: FIRST_PASSWORD,
    });
    expect(
      firstAttempt.body.status,
      `login answered ${firstAttempt.status}: ${JSON.stringify(firstAttempt.body)}`,
    ).toBe('mfaRequired');
    expect(firstAttempt.body.stage).toBe('enrol');
    const enrolment = await post('/api/v1/auth/mfa/enrol').send({
      challengeToken: firstAttempt.body.challengeToken,
    });
    adminTotpSecret = enrolment.body.secret;
    const enrolled = await post('/api/v1/auth/mfa/confirm').send({
      challengeToken: firstAttempt.body.challengeToken,
      code: currentTotpCode({
        secret: adminTotpSecret,
        issuer: TOTP_ISSUER,
        label: ADMIN_LOGIN,
        now: clock,
      }),
    });
    expect(enrolled.status, JSON.stringify(enrolled.body)).toBe(201);
  });

  /** Time only moves forward, which is what keeps TOTP replay protection meaningful across tests. */
  function advanceClock(milliseconds: number): void {
    clock = new Date(clock.getTime() + milliseconds);
  }

  afterAll(async () => {
    if (!connection) return;
    // Audit records have no delete path in the application (AUDIT-001); the test removes its own the way
    // a privileged operator would, which is the documented limit of application-level immutability.
    await connection.db?.collection(AUDIT_COLLECTION).deleteMany({
      $or: [
        { 'context.correlationId': { $regex: `^${RUN}` } },
        { 'target.id': { $regex: `^${RUN}` } },
      ],
    });
    const accounts = await accountModel(connection)
      .find({ loginIdentifier: { $regex: `^${RUN}` } })
      .lean<SecurityAccountDocument[]>()
      .exec();
    const ids = accounts.map((account) => account.accountId);
    await Promise.all([
      accountModel(connection)
        .deleteMany({ accountId: { $in: ids } })
        .exec(),
      sessionModel(connection)
        .deleteMany({ accountId: { $in: ids } })
        .exec(),
      refreshTokenModel(connection)
        .deleteMany({ accountId: { $in: ids } })
        .exec(),
      accountTokenModel(connection)
        .deleteMany({ accountId: { $in: ids } })
        .exec(),
      connection.db?.collection(ACCOUNT_GRANTS_COLLECTION).deleteMany({ accountId: { $in: ids } }),
      connection.db?.collection(ROLES_COLLECTION).deleteMany({ key: { $regex: `^${RUN}` } }),
      connection.db?.collection(AUDIT_COLLECTION).deleteMany({ 'actor.accountId': { $in: ids } }),
    ]);
    // Redis throttle counters this run created.
    const keys = [
      ...(await redis.keys(`throttle-*${RUN}*`)),
      ...(await redis.keys('throttle-*198.51.100.*')),
    ];
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
    await connection.close();
  });

  /* =============================================== SEC-011, SEC-022: accounts */

  describe('SEC-011: the security account, and what it is not', () => {
    it('creates an invited account with an activation token and no credential in the response', async () => {
      const admin = await adminSignIn();
      const res = await post('/api/v1/security/accounts')
        .set(auth(admin.accessToken))
        .send({
          loginIdentifier: `${RUN}-created@example.com`,
          displayName: 'created by an administrator',
          employeeRef: `${RUN}-emp-1`,
          personalAccountAttested: true,
        });
      expect(res.status).toBe(201);
      expect(res.body.account.state).toBe('invited');
      expect(res.body.account.employeeRef).toBe(`${RUN}-emp-1`);
      expect(res.body.activationToken).toEqual(expect.any(String));

      const serialized = JSON.stringify(res.body);
      for (const forbidden of ['passwordHash', 'argon2', 'mfa.secret', 'ciphertext']) {
        expect(serialized).not.toContain(forbidden);
      }
    });

    it('refuses employee business data on the account (ADR-0019)', async () => {
      const admin = await adminSignIn();
      const res = await post('/api/v1/security/accounts')
        .set(auth(admin.accessToken))
        .send({
          loginIdentifier: `${RUN}-hr@example.com`,
          displayName: 'hr fields',
          personalAccountAttested: true,
          // These belong to HR-EMP and CORE-ORG, and the account schema is strict.
          salary: '10000.00',
          departmentId: 'dept-1',
          jobTitle: 'agent',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a body that tries to set state, version, or the credential generation', async () => {
      const admin = await adminSignIn();
      for (const extra of [
        { state: 'active' },
        { credentialVersion: 99 },
        { version: 5 },
        { passwordHash: 'x' },
      ]) {
        const res = await post('/api/v1/security/accounts')
          .set(auth(admin.accessToken))
          .send({
            loginIdentifier: `${RUN}-mass-${Math.random().toString(36).slice(2)}@example.com`,
            displayName: 'mass assignment',
            personalAccountAttested: true,
            ...extra,
          });
        expect(res.status).toBe(400);
      }
    });

    it('treats login identifiers case- and whitespace-insensitively for uniqueness (SEC-022)', async () => {
      const admin = await adminSignIn();
      const base = `${RUN}-Unique@Example.com`;
      const first = await post('/api/v1/security/accounts')
        .set(auth(admin.accessToken))
        .send({ loginIdentifier: base, displayName: 'first', personalAccountAttested: true });
      expect(first.status).toBe(201);
      expect(first.body.account.loginIdentifier).toBe(`${RUN}-unique@example.com`.toLowerCase());

      const duplicate = await post('/api/v1/security/accounts')
        .set(auth(admin.accessToken))
        .send({
          loginIdentifier: `  ${RUN}-UNIQUE@example.com  `,
          displayName: 'second',
          personalAccountAttested: true,
        });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('CONFLICT');
    });

    it('allows one live account per employee, and a replacement once the old one is terminated', async () => {
      const admin = await adminSignIn();
      const employeeRef = `${RUN}-emp-shared`;
      const first = await post('/api/v1/security/accounts')
        .set(auth(admin.accessToken))
        .send({
          loginIdentifier: `${RUN}-emp-a@example.com`,
          displayName: 'a',
          employeeRef,
          personalAccountAttested: true,
        });
      expect(first.status).toBe(201);

      const second = await post('/api/v1/security/accounts')
        .set(auth(admin.accessToken))
        .send({
          loginIdentifier: `${RUN}-emp-b@example.com`,
          displayName: 'b',
          employeeRef,
          personalAccountAttested: true,
        });
      expect(second.status).toBe(409);

      // Offboard the first, and the same person may be given a new account.
      const offboarded = await post(
        `/api/v1/security/accounts/${first.body.account.accountId}/offboard`,
      )
        .set(auth(admin.accessToken))
        .send({ reason: 'left the company', recordHandoverAcknowledged: true });
      expect(offboarded.status).toBe(200);

      const replacement = await post('/api/v1/security/accounts')
        .set(auth(admin.accessToken))
        .send({
          loginIdentifier: `${RUN}-emp-c@example.com`,
          displayName: 'c',
          employeeRef,
          personalAccountAttested: true,
        });
      expect(replacement.status).toBe(201);
    });

    it('requires the personal-account attestation (SEC-022)', async () => {
      const admin = await adminSignIn();
      const res = await post('/api/v1/security/accounts')
        .set(auth(admin.accessToken))
        .send({ loginIdentifier: `${RUN}-shared@example.com`, displayName: 'shared mailbox' });
      expect(res.status).toBe(400);
    });
  });

  /* ========================================= SEC-012: invitation and activation */

  describe('SEC-012: invitation and activation', () => {
    it('activates with the token, sets the first password, and refuses the token afterwards', async () => {
      const created = await identity.createAccount(
        adminActor(),
        {
          loginIdentifier: `${RUN}-activate@example.com`,
          displayName: 'activation',
          personalAccountAttested: true,
        },
        context(),
      );
      const first = await post('/api/v1/auth/activate').send({
        token: created.activationToken,
        password: FIRST_PASSWORD,
      });
      expect(first.status).toBe(200);
      expect(first.body.state).toBe('active');

      const replay = await post('/api/v1/auth/activate').send({
        token: created.activationToken,
        password: SECOND_PASSWORD,
      });
      expect(replay.status).toBe(400);
    });

    it('refuses a password that fails the policy and leaves the account invited', async () => {
      const created = await identity.createAccount(
        adminActor(),
        {
          loginIdentifier: `${RUN}-weak@example.com`,
          displayName: 'weak password',
          personalAccountAttested: true,
        },
        context(),
      );
      const res = await post('/api/v1/auth/activate').send({
        token: created.activationToken,
        password: 'password123',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect((await identity.getAccount(created.account.accountId)).state).toBe('invited');
    });

    it('refuses an expired activation token', async () => {
      const created = await identity.createAccount(
        adminActor(),
        {
          loginIdentifier: `${RUN}-expired@example.com`,
          displayName: 'expired invitation',
          personalAccountAttested: true,
        },
        context(),
      );
      advanceClock((TTL.activationSeconds + 60) * 1000);
      const res = await post('/api/v1/auth/activate').send({
        token: created.activationToken,
        password: FIRST_PASSWORD,
      });
      expect(res.status).toBe(400);
    });

    it('refuses to sign in to an account that was never activated, indistinguishably', async () => {
      await identity.createAccount(
        adminActor(),
        {
          loginIdentifier: `${RUN}-pending@example.com`,
          displayName: 'pending',
          personalAccountAttested: true,
        },
        context(),
      );
      const pending = await post('/api/v1/auth/login').send({
        loginIdentifier: `${RUN}-pending@example.com`,
        password: FIRST_PASSWORD,
      });
      const unknown = await post('/api/v1/auth/login').send({
        loginIdentifier: `${RUN}-never-existed@example.com`,
        password: FIRST_PASSWORD,
      });
      expect(pending.status).toBe(401);
      expect(pending.body.error.code).toBe('UNAUTHENTICATED');
      expect(Object.keys(pending.body.error).sort()).toEqual(
        Object.keys(unknown.body.error).sort(),
      );
      expect(pending.status).toBe(unknown.status);
    });
  });

  /* ================================================= SEC-013: login and logout */

  describe('SEC-013: login and logout', () => {
    it('issues an access token in the body and the refresh token only as a cookie', async () => {
      const identifier = `${RUN}-login@example.com`;
      const created = await identity.createAccount(
        adminActor(),
        { loginIdentifier: identifier, displayName: 'login', personalAccountAttested: true },
        context(),
      );
      await identity.activateAccount(created.activationToken, FIRST_PASSWORD, context());

      const res = await post('/api/v1/auth/login').send({
        loginIdentifier: identifier,
        password: FIRST_PASSWORD,
        deviceLabel: 'office laptop',
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('authenticated');
      expect(res.body.tokenType).toBe('Bearer');
      expect(res.body.expiresIn).toBe(600);
      // The refresh token is never in a body.
      const cookie = refreshCookieFrom(res);
      const cookieValue = cookie.split('=')[1] as string;
      expect(JSON.stringify(res.body)).not.toContain(cookieValue);

      const attributes = setCookies(res).join(';');
      expect(attributes).toContain('HttpOnly');
      expect(attributes).toContain('SameSite=Strict');
      expect(attributes).toContain('Path=/api/v1/auth');
    });

    it('accepts the access token on a protected route and refuses a missing or wrong one', async () => {
      const user = await provision('me-route', { roleKeys: [R_PLAIN] });
      const ok = await api().get('/api/v1/me').set(auth(user.accessToken));
      expect(ok.status).toBe(200);
      expect(ok.body.account.accountId).toBe(user.accountId);
      expect(JSON.stringify(ok.body)).not.toContain('passwordHash');

      expect((await api().get('/api/v1/me')).status).toBe(401);
      expect((await api().get('/api/v1/me').set(auth('not-a-token'))).status).toBe(401);
      expect((await api().get('/api/v1/me').set({ Authorization: user.accessToken })).status).toBe(
        401,
      );
    });

    it('answers a wrong password exactly as it answers an unknown identifier', async () => {
      const user = await provision('enumeration');
      const wrong = await post('/api/v1/auth/login').send({
        loginIdentifier: user.loginIdentifier,
        password: SECOND_PASSWORD,
      });
      const unknown = await post('/api/v1/auth/login').send({
        loginIdentifier: `${RUN}-absent@example.com`,
        password: SECOND_PASSWORD,
      });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.error.code).toBe(unknown.body.error.code);
      expect(Object.keys(wrong.body.error).sort()).toEqual(['code', 'correlationId']);
      // Nothing in either answer hints at which account exists.
      expect(JSON.stringify(unknown.body)).not.toContain(user.loginIdentifier);
    });

    it('spends comparable work on an unknown identifier, so timing does not reveal existence', async () => {
      const user = await provision('timing');
      const measure = async (loginIdentifier: string): Promise<number> => {
        const started = process.hrtime.bigint();
        await post('/api/v1/auth/login').send({ loginIdentifier, password: SECOND_PASSWORD });
        return Number(process.hrtime.bigint() - started) / 1e6;
      };
      const known = await measure(user.loginIdentifier);
      const unknown = await measure(`${RUN}-nobody-here@example.com`);
      // A bare "no such row" answer would return in about a millisecond; a dummy verification does not.
      expect(unknown).toBeGreaterThan(5);
      expect(known).toBeGreaterThan(5);
    });

    it('ends the session on logout, immediately', async () => {
      const user = await provision('logout', { roleKeys: [R_PLAIN] });
      expect((await api().get('/api/v1/me').set(auth(user.accessToken))).status).toBe(200);

      const out = await post('/api/v1/auth/logout')
        .set(auth(user.accessToken))
        .set('Cookie', user.cookie);
      expect(out.status).toBe(204);
      expect(setCookies(out).join(';')).toContain('alola_rt=;');

      // The same token, still unexpired, no longer works.
      expect((await api().get('/api/v1/me').set(auth(user.accessToken))).status).toBe(401);
    });
  });

  /* ======================================== SEC-014, SEC-015: tokens and rotation */

  describe('SEC-014: short-lived access tokens and rotated refresh sessions', () => {
    it('rotates the refresh token and keeps the session alive', async () => {
      const user = await provision('rotate', { roleKeys: [R_PLAIN] });
      const refreshed = await post('/api/v1/auth/refresh').set('Cookie', user.cookie);
      expect(refreshed.status).toBe(200);
      expect(refreshed.body.sessionId).toBe(user.sessionId);
      const nextCookie = refreshCookieFrom(refreshed);
      expect(nextCookie).not.toBe(user.cookie);
      expect((await api().get('/api/v1/me').set(auth(refreshed.body.accessToken))).status).toBe(
        200,
      );
    });

    it('refuses a refresh with no cookie at all', async () => {
      expect((await post('/api/v1/auth/refresh')).status).toBe(401);
    });

    it('ends the session after the idle timeout, whatever the token says', async () => {
      const user = await provision('idle', { roleKeys: [R_PLAIN] });
      advanceClock((TTL.sessionIdleSeconds + 60) * 1000);
      expect((await api().get('/api/v1/me').set(auth(user.accessToken))).status).toBe(401);
      expect((await post('/api/v1/auth/refresh').set('Cookie', user.cookie)).status).toBe(401);
    });

    it('ends the session at the absolute timeout even while it is being used', async () => {
      const user = await provision('absolute', { roleKeys: [R_PLAIN] });
      // Keep it active: refresh just inside the idle window, repeatedly, past the absolute deadline.
      advanceClock((TTL.sessionIdleSeconds - 60) * 1000);
      expect((await post('/api/v1/auth/refresh').set('Cookie', user.cookie)).status).toBe(200);
      advanceClock(TTL.sessionAbsoluteSeconds * 1000);
      expect((await api().get('/api/v1/me').set(auth(user.accessToken))).status).toBe(401);
    });

    it('marks the cookie Secure outside development', () => {
      expect(cookiePolicyFor('production').secure).toBe(true);
      expect(cookiePolicyFor('staging').secure).toBe(true);
      expect(cookiePolicyFor('development').secure).toBe(false);
    });
  });

  describe('SEC-015: refresh-token reuse detection', () => {
    it('revokes the whole session family when a rotated token is presented again', async () => {
      const user = await provision('reuse', { roleKeys: [R_PLAIN] });
      const rotated = await post('/api/v1/auth/refresh').set('Cookie', user.cookie);
      expect(rotated.status).toBe(200);
      const newCookie = refreshCookieFrom(rotated);

      // The old token is replayed: this is either a copy or a replay, and both are treated the same.
      const replay = await post('/api/v1/auth/refresh').set('Cookie', user.cookie);
      expect(replay.status).toBe(401);

      // The legitimate holder loses the session too — that is the point of family revocation.
      expect((await post('/api/v1/auth/refresh').set('Cookie', newCookie)).status).toBe(401);
      expect((await api().get('/api/v1/me').set(auth(rotated.body.accessToken))).status).toBe(401);

      const events = await eventsFor(user.accountId);
      expect(
        events.some((event) => event.action === IDENTITY_AUDIT_ACTIONS.sessionReuseDetected),
      ).toBe(true);
    });
  });

  /* =============================================== SEC-016: password lifecycle */

  describe('SEC-016: password change and reset', () => {
    it('changes a password after re-authentication and refuses a wrong current password', async () => {
      const user = await provision('change-password', { roleKeys: [R_PLAIN] });
      const wrong = await post('/api/v1/me/password')
        .set(auth(user.accessToken))
        .send({ currentPassword: SECOND_PASSWORD, newPassword: 'another-long-passphrase-here' });
      expect(wrong.status).toBe(403);
      expect(wrong.body.error.code).toBe('REAUTHENTICATION_REQUIRED');

      const changed = await post('/api/v1/me/password')
        .set(auth(user.accessToken))
        .send({ currentPassword: FIRST_PASSWORD, newPassword: SECOND_PASSWORD });
      expect(changed.status).toBe(204);

      // SEC-020: the session that made the change is gone too.
      expect((await api().get('/api/v1/me').set(auth(user.accessToken))).status).toBe(401);
      await expect(signIn(user.loginIdentifier, SECOND_PASSWORD)).resolves.toBeTruthy();
      const old = await post('/api/v1/auth/login').send({
        loginIdentifier: user.loginIdentifier,
        password: FIRST_PASSWORD,
      });
      expect(old.status).toBe(401);
    });

    it('refuses a new password that fails the policy', async () => {
      const user = await provision('weak-change', { roleKeys: [R_PLAIN] });
      const res = await post('/api/v1/me/password')
        .set(auth(user.accessToken))
        .send({ currentPassword: FIRST_PASSWORD, newPassword: 'password' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('answers a reset request identically whether or not the account exists', async () => {
      const user = await provision('reset-generic');
      const known = await post('/api/v1/auth/password/reset-request').send({
        loginIdentifier: user.loginIdentifier,
      });
      const unknown = await post('/api/v1/auth/password/reset-request').send({
        loginIdentifier: `${RUN}-no-such-person@example.com`,
      });
      expect(known.status).toBe(202);
      expect(unknown.status).toBe(202);
      expect(known.body).toEqual(unknown.body);
      // The token is never in the response, for either case.
      expect(JSON.stringify(known.body)).not.toMatch(/[A-Za-z0-9_-]{43}/);
    });

    it('completes a reset from an administrative token, ends every session, and is single use', async () => {
      const admin = await adminSignIn();
      const user = await provision('admin-reset', { roleKeys: [R_PLAIN] });

      const issued = await post(`/api/v1/security/accounts/${user.accountId}/password-reset`).set(
        auth(admin.accessToken),
      );
      expect(issued.status).toBe(201);
      const token = issued.body.resetToken as string;

      const completed = await post('/api/v1/auth/password/reset').send({
        token,
        password: SECOND_PASSWORD,
      });
      expect(completed.status).toBe(204);
      expect((await api().get('/api/v1/me').set(auth(user.accessToken))).status).toBe(401);
      await expect(signIn(user.loginIdentifier, SECOND_PASSWORD)).resolves.toBeTruthy();

      const replay = await post('/api/v1/auth/password/reset').send({
        token,
        password: FIRST_PASSWORD,
      });
      expect(replay.status).toBe(400);
    });

    it('refuses an expired reset token', async () => {
      const admin = await adminSignIn();
      const user = await provision('expired-reset');
      const issued = await post(`/api/v1/security/accounts/${user.accountId}/password-reset`).set(
        auth(admin.accessToken),
      );
      advanceClock((TTL.passwordResetSeconds + 60) * 1000);
      const res = await post('/api/v1/auth/password/reset').send({
        token: issued.body.resetToken,
        password: SECOND_PASSWORD,
      });
      expect(res.status).toBe(400);
    });
  });

  /* ============================================================= SEC-017: MFA */

  describe('SEC-017: second factor', () => {
    /** Enrols a live session and returns the secret so the test can generate real codes. */
    async function enrol(user: Signed): Promise<{ secret: string; recoveryCodes: string[] }> {
      const started = await post('/api/v1/auth/mfa/enrol').set(auth(user.accessToken)).send({});
      expect(started.status).toBe(200);
      expect(started.body.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(started.body.recoveryCodes).toHaveLength(10);
      return { secret: started.body.secret, recoveryCodes: started.body.recoveryCodes };
    }

    it('is not active until a live code confirms the enrolment', async () => {
      const user = await provision('mfa-confirm', { roleKeys: [R_PLAIN] });
      const { secret } = await enrol(user);
      expect((await identity.getAccount(user.accountId)).mfaEnabled).toBe(false);

      const wrong = await post('/api/v1/auth/mfa/confirm')
        .set(auth(user.accessToken))
        .send({ code: '000000' });
      expect(wrong.status).toBe(401);
      expect((await identity.getAccount(user.accountId)).mfaEnabled).toBe(false);

      const code = currentTotpCode({
        secret,
        issuer: TOTP_ISSUER,
        label: user.loginIdentifier,
        now: clock,
      });
      const confirmed = await post('/api/v1/auth/mfa/confirm')
        .set(auth(user.accessToken))
        .send({ code });
      expect(confirmed.status).toBe(204);
      expect((await identity.getAccount(user.accountId)).mfaEnabled).toBe(true);
    });

    it('demands the code at the next sign-in and accepts a real one', async () => {
      const user = await provision('mfa-login', { roleKeys: [R_PLAIN] });
      const { secret } = await enrol(user);
      await post('/api/v1/auth/mfa/confirm')
        .set(auth(user.accessToken))
        .send({
          code: currentTotpCode({
            secret,
            issuer: TOTP_ISSUER,
            label: user.loginIdentifier,
            now: clock,
          }),
        });

      const challenge = await post('/api/v1/auth/login').send({
        loginIdentifier: user.loginIdentifier,
        password: FIRST_PASSWORD,
      });
      expect(challenge.status).toBe(200);
      expect(challenge.body.status).toBe('mfaRequired');
      expect(challenge.body.stage).toBe('verify');
      // A password alone produced no session and no cookie.
      expect(challenge.headers['set-cookie']).toBeUndefined();

      // Move one step on, so the confirmation code cannot simply be replayed.
      advanceClock(31_000);
      const verified = await post('/api/v1/auth/mfa/verify').send({
        challengeToken: challenge.body.challengeToken,
        code: currentTotpCode({
          secret,
          issuer: TOTP_ISSUER,
          label: user.loginIdentifier,
          now: clock,
        }),
      });
      expect(verified.status).toBe(200);
      expect(verified.body.status).toBe('authenticated');
      expect((await api().get('/api/v1/me').set(auth(verified.body.accessToken))).status).toBe(200);
    });

    it('refuses a replayed code and a wrong code', async () => {
      const user = await provision('mfa-replay', { roleKeys: [R_PLAIN] });
      const { secret } = await enrol(user);
      const label = user.loginIdentifier;
      await post('/api/v1/auth/mfa/confirm')
        .set(auth(user.accessToken))
        .send({ code: currentTotpCode({ secret, issuer: TOTP_ISSUER, label, now: clock }) });

      advanceClock(31_000);
      const code = currentTotpCode({ secret, issuer: TOTP_ISSUER, label, now: clock });
      const challengeOne = await post('/api/v1/auth/login').send({
        loginIdentifier: label,
        password: FIRST_PASSWORD,
      });
      const first = await post('/api/v1/auth/mfa/verify').send({
        challengeToken: challengeOne.body.challengeToken,
        code,
      });
      expect(first.status).toBe(200);

      // The same code again, inside its own window: refused (SEC-017 replay resistance).
      const challengeTwo = await post('/api/v1/auth/login').send({
        loginIdentifier: label,
        password: FIRST_PASSWORD,
      });
      const replayed = await post('/api/v1/auth/mfa/verify').send({
        challengeToken: challengeTwo.body.challengeToken,
        code,
      });
      expect(replayed.status).toBe(401);
    });

    it('consumes a recovery code exactly once', async () => {
      const user = await provision('mfa-recovery', { roleKeys: [R_PLAIN] });
      const { secret, recoveryCodes } = await enrol(user);
      const label = user.loginIdentifier;
      await post('/api/v1/auth/mfa/confirm')
        .set(auth(user.accessToken))
        .send({ code: currentTotpCode({ secret, issuer: TOTP_ISSUER, label, now: clock }) });

      const recovery = recoveryCodes[0] as string;
      const challengeOne = await post('/api/v1/auth/login').send({
        loginIdentifier: label,
        password: FIRST_PASSWORD,
      });
      const used = await post('/api/v1/auth/mfa/verify').send({
        challengeToken: challengeOne.body.challengeToken,
        code: recovery,
      });
      expect(used.status).toBe(200);

      const challengeTwo = await post('/api/v1/auth/login').send({
        loginIdentifier: label,
        password: FIRST_PASSWORD,
      });
      const reused = await post('/api/v1/auth/mfa/verify').send({
        challengeToken: challengeTwo.body.challengeToken,
        code: recovery,
      });
      expect(reused.status).toBe(401);

      const events = await eventsFor(user.accountId);
      expect(
        events.some((event) => event.action === IDENTITY_AUDIT_ACTIONS.mfaRecoveryCodeUsed),
      ).toBe(true);
    });

    it('stores the shared secret encrypted, and never in plaintext', async () => {
      const user = await provision('mfa-encrypted', { roleKeys: [R_PLAIN] });
      const { secret, recoveryCodes } = await enrol(user);
      await post('/api/v1/auth/mfa/confirm')
        .set(auth(user.accessToken))
        .send({
          code: currentTotpCode({
            secret,
            issuer: TOTP_ISSUER,
            label: user.loginIdentifier,
            now: clock,
          }),
        });

      const document = await accountModel(connection)
        .findOne({ accountId: user.accountId })
        .lean<SecurityAccountDocument>()
        .exec();
      expect(document?.mfa.secret?.ciphertext).toEqual(expect.any(String));
      const stored = JSON.stringify(document);
      expect(stored).not.toContain(secret);
      for (const code of recoveryCodes) expect(stored).not.toContain(code);
      // Recovery codes are hashed independently, not stored as a list of values.
      expect(
        document?.mfa.recoveryCodes.every((entry) => entry.hash.startsWith('$argon2id$')),
      ).toBe(true);
    });

    it('requires a privileged account to enrol before it can sign in (SEC-017)', async () => {
      // The administrative role makes a second factor mandatory.
      const identifier = `${RUN}-privileged@example.com`;
      const created = await identity.createAccount(
        adminActor(),
        { loginIdentifier: identifier, displayName: 'privileged', personalAccountAttested: true },
        context(),
      );
      await identity.activateAccount(created.activationToken, FIRST_PASSWORD, context());
      await grant(created.account.accountId, [R_ADMIN]);

      const challenge = await post('/api/v1/auth/login').send({
        loginIdentifier: identifier,
        password: FIRST_PASSWORD,
      });
      expect(challenge.status).toBe(200);
      expect(challenge.body.status).toBe('mfaRequired');
      expect(challenge.body.stage).toBe('enrol');
      expect(challenge.headers['set-cookie']).toBeUndefined();

      // Enrolment proceeds on the challenge alone, and only enrolment.
      const started = await post('/api/v1/auth/mfa/enrol').send({
        challengeToken: challenge.body.challengeToken,
      });
      expect(started.status).toBe(200);
      const confirmed = await post('/api/v1/auth/mfa/confirm').send({
        challengeToken: challenge.body.challengeToken,
        code: currentTotpCode({
          secret: started.body.secret,
          issuer: TOTP_ISSUER,
          label: identifier,
          now: clock,
        }),
      });
      expect(confirmed.status).toBe(201);
      expect(confirmed.body.status).toBe('authenticated');
      expect((await api().get('/api/v1/me').set(auth(confirmed.body.accessToken))).status).toBe(
        200,
      );
    });

    it('will not let a verify challenge be spent on enrolment', async () => {
      const user = await provision('mfa-stage', { roleKeys: [R_PLAIN] });
      const { secret } = await enrol(user);
      const label = user.loginIdentifier;
      await post('/api/v1/auth/mfa/confirm')
        .set(auth(user.accessToken))
        .send({ code: currentTotpCode({ secret, issuer: TOTP_ISSUER, label, now: clock }) });

      const challenge = await post('/api/v1/auth/login').send({
        loginIdentifier: label,
        password: FIRST_PASSWORD,
      });
      expect(challenge.body.stage).toBe('verify');
      const misuse = await post('/api/v1/auth/mfa/enrol').send({
        challengeToken: challenge.body.challengeToken,
      });
      expect(misuse.status).toBe(401);
    });

    it('requires the password to disable a second factor, and ends every session', async () => {
      const user = await provision('mfa-disable', { roleKeys: [R_PLAIN] });
      const { secret } = await enrol(user);
      const label = user.loginIdentifier;
      await post('/api/v1/auth/mfa/confirm')
        .set(auth(user.accessToken))
        .send({ code: currentTotpCode({ secret, issuer: TOTP_ISSUER, label, now: clock }) });

      const wrong = await post('/api/v1/me/mfa/disable')
        .set(auth(user.accessToken))
        .send({ currentPassword: SECOND_PASSWORD });
      expect(wrong.status).toBe(403);
      expect((await identity.getAccount(user.accountId)).mfaEnabled).toBe(true);

      const disabled = await post('/api/v1/me/mfa/disable')
        .set(auth(user.accessToken))
        .send({ currentPassword: FIRST_PASSWORD });
      expect(disabled.status).toBe(204);
      expect((await identity.getAccount(user.accountId)).mfaEnabled).toBe(false);
      expect((await api().get('/api/v1/me').set(auth(user.accessToken))).status).toBe(401);
    });

    it('lets an administrator reset a second factor, and refuses anyone without the permission', async () => {
      const admin = await adminSignIn();
      const user = await provision('mfa-admin-reset', { roleKeys: [R_PLAIN] });
      const { secret } = await enrol(user);
      await post('/api/v1/auth/mfa/confirm')
        .set(auth(user.accessToken))
        .send({
          code: currentTotpCode({
            secret,
            issuer: TOTP_ISSUER,
            label: user.loginIdentifier,
            now: clock,
          }),
        });

      const byPeer = await post(`/api/v1/security/accounts/${user.accountId}/mfa/reset`).set(
        auth(user.accessToken),
      );
      expect(byPeer.status).toBe(403);
      expect((await identity.getAccount(user.accountId)).mfaEnabled).toBe(true);

      const byAdmin = await post(`/api/v1/security/accounts/${user.accountId}/mfa/reset`).set(
        auth(admin.accessToken),
      );
      expect(byAdmin.status).toBe(204);
      expect((await identity.getAccount(user.accountId)).mfaEnabled).toBe(false);
    });

    it('never records a secret, a URI, or a recovery code in the audit trail or the log', async () => {
      const user = await provision('mfa-redaction', { roleKeys: [R_PLAIN] });
      const { secret, recoveryCodes } = await enrol(user);
      await post('/api/v1/auth/mfa/confirm')
        .set(auth(user.accessToken))
        .send({
          code: currentTotpCode({
            secret,
            issuer: TOTP_ISSUER,
            label: user.loginIdentifier,
            now: clock,
          }),
        });

      const events = JSON.stringify(await eventsFor(user.accountId));
      const logged = logs();
      for (const material of [secret, ...recoveryCodes, 'otpauth://']) {
        expect(events).not.toContain(material);
        expect(logged).not.toContain(material);
      }
    });
  });

  /* ================================================ SEC-018: devices and sessions */

  describe('SEC-018: session and device listing with revocation', () => {
    it('lists this account’s live sessions, marks the current one, and exposes no secret', async () => {
      const user = await provision('sessions-list', { roleKeys: [R_PLAIN] });
      const second = await signIn(user.loginIdentifier, FIRST_PASSWORD);

      const res = await api().get('/api/v1/me/sessions').set(auth(user.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThanOrEqual(2);
      const items = res.body.items as { current: boolean; sessionId: string }[];
      const current = items.filter((item) => item.current);
      expect(current).toHaveLength(1);
      expect(current[0]?.sessionId).toBe(user.sessionId);

      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain(second.cookie.split('=')[1] ?? '');
      for (const forbidden of ['tokenHash', 'refreshToken', 'Mozilla/']) {
        expect(serialized).not.toContain(forbidden);
      }
    });

    it('summarizes the client rather than storing the raw user agent', async () => {
      const identifier = `${RUN}-ua@example.com`;
      const created = await identity.createAccount(
        adminActor(),
        { loginIdentifier: identifier, displayName: 'ua', personalAccountAttested: true },
        context(),
      );
      await identity.activateAccount(created.activationToken, FIRST_PASSWORD, context());
      const res = await post('/api/v1/auth/login')
        .set(
          'User-Agent',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
        )
        .send({ loginIdentifier: identifier, password: FIRST_PASSWORD });
      expect(res.status).toBe(200);

      const stored = await sessionModel(connection)
        .findOne({ sessionId: res.body.sessionId })
        .lean()
        .exec();
      expect(stored?.client).toBe('Chrome on Windows');
      expect(JSON.stringify(stored)).not.toContain('AppleWebKit');
    });

    it('revokes one session by id, leaving the others alone', async () => {
      const user = await provision('revoke-one', { roleKeys: [R_PLAIN] });
      const other = await signIn(user.loginIdentifier, FIRST_PASSWORD);

      const res = await api()
        .delete(`/api/v1/me/sessions/${other.sessionId}`)
        .set(auth(user.accessToken))
        .set('Origin', ALLOWED_ORIGIN);
      expect(res.status).toBe(204);
      expect((await api().get('/api/v1/me').set(auth(other.accessToken))).status).toBe(401);
      expect((await api().get('/api/v1/me').set(auth(user.accessToken))).status).toBe(200);
    });

    it('revokes every other session and keeps the current one', async () => {
      const user = await provision('revoke-others', { roleKeys: [R_PLAIN] });
      const second = await signIn(user.loginIdentifier, FIRST_PASSWORD);
      const third = await signIn(user.loginIdentifier, FIRST_PASSWORD);

      const res = await post('/api/v1/me/sessions/revoke-others').set(auth(user.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.revoked).toBeGreaterThanOrEqual(2);
      expect((await api().get('/api/v1/me').set(auth(user.accessToken))).status).toBe(200);
      expect((await api().get('/api/v1/me').set(auth(second.accessToken))).status).toBe(401);
      expect((await api().get('/api/v1/me').set(auth(third.accessToken))).status).toBe(401);
    });

    it('cannot touch another account’s session, and says "not found" rather than "forbidden"', async () => {
      const one = await provision('cross-a', { roleKeys: [R_PLAIN] });
      const two = await provision('cross-b', { roleKeys: [R_PLAIN] });

      const res = await api()
        .delete(`/api/v1/me/sessions/${two.sessionId}`)
        .set(auth(one.accessToken))
        .set('Origin', ALLOWED_ORIGIN);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      // The other session is untouched.
      expect((await api().get('/api/v1/me').set(auth(two.accessToken))).status).toBe(200);
    });

    it('lets an administrator list and revoke another account’s sessions, and nobody else', async () => {
      const admin = await adminSignIn();
      const user = await provision('admin-sessions', { roleKeys: [R_PLAIN] });
      const peer = await provision('admin-sessions-peer', { roleKeys: [R_PLAIN] });

      expect(
        (
          await api()
            .get(`/api/v1/security/accounts/${user.accountId}/sessions`)
            .set(auth(peer.accessToken))
        ).status,
      ).toBe(403);

      const listed = await api()
        .get(`/api/v1/security/accounts/${user.accountId}/sessions`)
        .set(auth(admin.accessToken));
      expect(listed.status).toBe(200);
      expect(listed.body.items).toHaveLength(1);

      const revoked = await post(
        `/api/v1/security/accounts/${user.accountId}/sessions/revoke-all`,
      ).set(auth(admin.accessToken));
      expect(revoked.status).toBe(200);
      expect(revoked.body.revoked).toBe(1);
      expect((await api().get('/api/v1/me').set(auth(user.accessToken))).status).toBe(401);
    });
  });

  /* =========================== SEC-019, SEC-020, SEC-021: lifecycle and revocation */

  describe('SEC-019, SEC-020: suspension without deletion, effective immediately', () => {
    it('suspends an account, ends its sessions at once, and keeps the record', async () => {
      const admin = await adminSignIn();
      const user = await provision('suspend', { roleKeys: [R_PLAIN] });
      expect((await api().get('/api/v1/me').set(auth(user.accessToken))).status).toBe(200);

      const suspended = await post(`/api/v1/security/accounts/${user.accountId}/suspend`)
        .set(auth(admin.accessToken))
        .send({ reason: 'under investigation' });
      expect(suspended.status).toBe(200);
      expect(suspended.body.state).toBe('suspended');

      // A suspended account whose session is still live is not suspended (gap G-08).
      expect((await api().get('/api/v1/me').set(auth(user.accessToken))).status).toBe(401);
      const login = await post('/api/v1/auth/login').send({
        loginIdentifier: user.loginIdentifier,
        password: FIRST_PASSWORD,
      });
      expect(login.status).toBe(401);
      expect(login.body.error.code).toBe('UNAUTHENTICATED');

      // The row is still there: nothing is hard-deleted (ADR-0009).
      const stored = await accountModel(connection)
        .findOne({ accountId: user.accountId })
        .lean()
        .exec();
      expect(stored?.state).toBe('suspended');
      expect(stored?.suspensionReason).toBe('under investigation');
    });

    it('reactivates a suspended account, and refuses an impossible transition', async () => {
      const admin = await adminSignIn();
      const user = await provision('reactivate', { roleKeys: [R_PLAIN] });
      await post(`/api/v1/security/accounts/${user.accountId}/suspend`)
        .set(auth(admin.accessToken))
        .send({ reason: 'temporary' });

      const again = await post(`/api/v1/security/accounts/${user.accountId}/suspend`)
        .set(auth(admin.accessToken))
        .send({ reason: 'again' });
      expect(again.status).toBe(409);

      const reactivated = await post(`/api/v1/security/accounts/${user.accountId}/reactivate`).set(
        auth(admin.accessToken),
      );
      expect(reactivated.status).toBe(200);
      expect(reactivated.body.state).toBe('active');
      await expect(signIn(user.loginIdentifier, FIRST_PASSWORD)).resolves.toBeTruthy();
    });

    it('applies a permission change to the very next request (SEC-032 under real sessions)', async () => {
      const user = await provision('permission-change');
      // No grant yet: authenticated, authorized for nothing.
      const before = await api().get('/api/v1/audit/events').set(auth(user.accessToken));
      expect(before.status).toBe(403);

      await grant(user.accountId, [R_PLAIN]);
      const after = await api().get('/api/v1/audit/events').set(auth(user.accessToken));
      expect(after.status).toBe(200);
    });
  });

  describe('SEC-021: offboarding as one audited action', () => {
    it('terminates the account, ends every session, and invalidates outstanding tokens', async () => {
      const admin = await adminSignIn();
      const identifier = `${RUN}-offboard@example.com`;
      const created = await identity.createAccount(
        adminActor(),
        {
          loginIdentifier: identifier,
          displayName: 'offboard',
          employeeRef: `${RUN}-emp-offboard`,
          personalAccountAttested: true,
        },
        context(),
      );
      await identity.activateAccount(created.activationToken, FIRST_PASSWORD, context());
      const user = await signIn(identifier, FIRST_PASSWORD);
      const reset = await post(`/api/v1/security/accounts/${user.accountId}/password-reset`).set(
        auth(admin.accessToken),
      );

      const res = await post(`/api/v1/security/accounts/${user.accountId}/offboard`)
        .set(auth(admin.accessToken))
        .send({ reason: 'employment ended', recordHandoverAcknowledged: true });
      expect(res.status).toBe(200);
      expect(res.body.state).toBe('terminated');

      expect((await api().get('/api/v1/me').set(auth(user.accessToken))).status).toBe(401);
      expect((await post('/api/v1/auth/refresh').set('Cookie', user.cookie)).status).toBe(401);
      // An outstanding reset link must not outlive the account.
      const afterwards = await post('/api/v1/auth/password/reset').send({
        token: reset.body.resetToken,
        password: SECOND_PASSWORD,
      });
      expect(afterwards.status).toBe(400);

      // The employee reference is kept and nothing is deleted: HR-EMP owns the employee record.
      const stored = await accountModel(connection)
        .findOne({ accountId: user.accountId })
        .lean()
        .exec();
      expect(stored?.employeeRef).toBe(`${RUN}-emp-offboard`);
      expect(stored?.state).toBe('terminated');

      // One offboarding event, whatever else the action revoked.
      const events = await connection.db
        ?.collection(AUDIT_COLLECTION)
        .find({
          action: IDENTITY_AUDIT_ACTIONS.accountOffboarded,
          'target.id': user.accountId,
        })
        .toArray();
      expect(events).toHaveLength(1);
    });

    it('requires the handover acknowledgement, because offboarding is not reassignment', async () => {
      const admin = await adminSignIn();
      const user = await provision('offboard-ack');
      const res = await post(`/api/v1/security/accounts/${user.accountId}/offboard`)
        .set(auth(admin.accessToken))
        .send({ reason: 'left' });
      expect(res.status).toBe(400);
      expect((await identity.getAccount(user.accountId)).state).toBe('active');
    });

    it('cannot bring a terminated account back', async () => {
      const admin = await adminSignIn();
      const user = await provision('offboard-final');
      await post(`/api/v1/security/accounts/${user.accountId}/offboard`)
        .set(auth(admin.accessToken))
        .send({ reason: 'left', recordHandoverAcknowledged: true });

      const reactivated = await post(`/api/v1/security/accounts/${user.accountId}/reactivate`).set(
        auth(admin.accessToken),
      );
      expect(reactivated.status).toBe(409);
      const login = await post('/api/v1/auth/login').send({
        loginIdentifier: user.loginIdentifier,
        password: FIRST_PASSWORD,
      });
      expect(login.status).toBe(401);
    });
  });

  /* ====================================================== throttling and abuse */

  describe('SEC-003 applied to authentication', () => {
    it('throttles repeated wrong passwords, reports a retry delay, and records the lockout', async () => {
      const user = await provision('lockout');
      const clientIp = nextAddress();
      let limited:
        | { status: number; headers: Record<string, unknown>; body: { error: { code: string } } }
        | undefined;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const res = await post('/api/v1/auth/login', clientIp).send({
          loginIdentifier: user.loginIdentifier,
          password: `wrong-attempt-${attempt}`,
        });
        if (res.status === 429) {
          limited = {
            status: res.status,
            headers: res.headers as unknown as Record<string, unknown>,
            body: res.body as { error: { code: string } },
          };
          break;
        }
      }
      expect(limited, 'the limiter never engaged').toBeDefined();
      expect(limited?.body.error.code).toBe('RATE_LIMITED');
      expect(Number(limited?.headers['retry-after'])).toBeGreaterThan(0);
      // The message says to wait, not how many attempts remain or what the threshold is.
      expect(JSON.stringify(limited?.body)).not.toMatch(/\b8\b|threshold|remaining/);

      const events = await eventsFor(user.accountId);
      expect(events.some((event) => event.action === IDENTITY_AUDIT_ACTIONS.accountLockedOut)).toBe(
        true,
      );

      // Even the correct password waits out the lockout: the limiter is checked before the credential.
      const correct = await post('/api/v1/auth/login').send({
        loginIdentifier: user.loginIdentifier,
        password: FIRST_PASSWORD,
      });
      expect(correct.status).toBe(429);
    });

    it('throttles a spray across many accounts from one address', async () => {
      const clientIp = nextAddress();
      let limited = false;
      for (let attempt = 0; attempt < 200 && !limited; attempt += 1) {
        // Every attempt names a different account, so only the per-address rule can stop this.
        const res = await post('/api/v1/auth/login', clientIp).send({
          loginIdentifier: `${RUN}-spray-${attempt}@example.com`,
          password: 'whatever-passphrase-here',
        });
        limited = res.status === 429;
      }
      expect(limited).toBe(true);
    });

    it('clears the counter after a successful sign-in, so a forgetful person is not stuck', async () => {
      const user = await provision('recovery');
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await post('/api/v1/auth/login').send({
          loginIdentifier: user.loginIdentifier,
          password: 'still-wrong-passphrase',
        });
      }
      await expect(signIn(user.loginIdentifier, FIRST_PASSWORD)).resolves.toBeTruthy();
      // The budget is back: three more failures do not immediately block.
      const res = await post('/api/v1/auth/login').send({
        loginIdentifier: user.loginIdentifier,
        password: 'wrong-again',
      });
      expect(res.status).toBe(401);
    });

    it('stores throttle state in Redis with a bounded lifetime, so nothing locks permanently', async () => {
      const user = await provision('ttl-check');
      await post('/api/v1/auth/login').send({
        loginIdentifier: user.loginIdentifier,
        password: 'wrong-passphrase-here',
      });
      const keys = await redis.keys(`throttle-login-account:*${RUN}-ttl-check*`);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        const ttl = await redis.ttl(key);
        // A key with no expiry (-1) would be a permanent lockout.
        expect(ttl).toBeGreaterThan(0);
      }
    });

    it('throttles second-factor attempts as well', async () => {
      const user = await provision('mfa-throttle', { roleKeys: [R_PLAIN] });
      const started = await post('/api/v1/auth/mfa/enrol').set(auth(user.accessToken)).send({});
      await post('/api/v1/auth/mfa/confirm')
        .set(auth(user.accessToken))
        .send({
          code: currentTotpCode({
            secret: started.body.secret,
            issuer: TOTP_ISSUER,
            label: user.loginIdentifier,
            now: clock,
          }),
        });

      let limited = false;
      for (let attempt = 0; attempt < 10 && !limited; attempt += 1) {
        const challenge = await post('/api/v1/auth/login').send({
          loginIdentifier: user.loginIdentifier,
          password: FIRST_PASSWORD,
        });
        if (challenge.status === 429) {
          limited = true;
          break;
        }
        const res = await post('/api/v1/auth/mfa/verify').send({
          challengeToken: challenge.body.challengeToken,
          code: '111111',
        });
        limited = res.status === 429;
      }
      expect(limited).toBe(true);
    });
  });

  /* ============================================ audit coverage and redaction */

  describe('AUDIT-005 for security events, and redaction (AUDIT-006)', () => {
    it('records the whole lifecycle with actor, target, outcome, and correlation id', async () => {
      const admin = await adminSignIn();
      const user = await provision('audit-lifecycle', { roleKeys: [R_PLAIN] });
      await post('/api/v1/auth/login').send({
        loginIdentifier: user.loginIdentifier,
        password: 'deliberately-wrong-value',
      });
      await post('/api/v1/auth/logout').set(auth(user.accessToken)).set('Cookie', user.cookie);
      await post(`/api/v1/security/accounts/${user.accountId}/suspend`)
        .set(auth(admin.accessToken))
        .send({ reason: 'audit coverage' });

      const events = await eventsFor(user.accountId);
      const actions = new Set(events.map((event) => event.action));
      for (const expected of [
        IDENTITY_AUDIT_ACTIONS.accountActivated,
        IDENTITY_AUDIT_ACTIONS.sessionCreated,
        IDENTITY_AUDIT_ACTIONS.sessionRevoked,
        AUDIT_ACTIONS.authenticationSucceeded,
        AUDIT_ACTIONS.authenticationFailed,
        AUDIT_ACTIONS.authenticationLoggedOut,
      ]) {
        expect(actions, `missing ${expected}`).toContain(expected);
      }
      for (const event of events) {
        expect(event.context.correlationId).toEqual(expect.any(String));
        expect(['succeeded', 'denied', 'failed']).toContain(event.outcome);
        expect(event.target.type).toEqual(expect.any(String));
      }
      // The suspension is recorded against the target account, by the administrator.
      const suspension = (await connection.db?.collection(AUDIT_COLLECTION).findOne({
        action: IDENTITY_AUDIT_ACTIONS.accountSuspended,
        'target.id': user.accountId,
      })) as { actor?: { accountId?: string } } | null;
      expect(suspension?.actor?.accountId).toBe(admin.accountId);
    });

    it('never records a password, token, cookie, or secret anywhere in the audit trail', async () => {
      const user = await provision('audit-redaction', { roleKeys: [R_PLAIN] });
      await post('/api/v1/auth/login').send({
        loginIdentifier: user.loginIdentifier,
        password: FIRST_PASSWORD,
      });
      const serialized = JSON.stringify(await allRunEvents());
      for (const material of [
        FIRST_PASSWORD,
        SECOND_PASSWORD,
        user.accessToken,
        user.cookie.split('=')[1] as string,
        'passwordHash',
        'Bearer ',
      ]) {
        expect(serialized).not.toContain(material);
      }
    });

    it('keeps credentials out of the log as well', async () => {
      const user = await provision('log-redaction', { roleKeys: [R_PLAIN] });
      await post('/api/v1/auth/login')
        .set('Cookie', 'alola_rt=a-fake-but-secret-looking-value')
        .send({ loginIdentifier: user.loginIdentifier, password: FIRST_PASSWORD });
      const text = logs();
      expect(text).not.toContain(FIRST_PASSWORD);
      expect(text).not.toContain('a-fake-but-secret-looking-value');
      expect(text).not.toContain(user.accessToken);
    });
  });

  /* ============================================================ bootstrap path */

  describe('bootstrap is deliberate and refuses to repeat itself', () => {
    it('will not create a second bootstrap account once any account exists', async () => {
      await expect(
        identity.createBootstrapAccount(
          { loginIdentifier: `${RUN}-second-bootstrap@example.com`, displayName: 'second' },
          context(),
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('left the first account unactivated until a human chose a password', async () => {
      const events = await connection.db
        ?.collection(AUDIT_COLLECTION)
        .find({ 'target.id': adminAccountId, action: IDENTITY_AUDIT_ACTIONS.accountCreated })
        .toArray();
      expect(events).toHaveLength(1);
      // Recorded as a system action, because no authenticated actor existed yet.
      const first = (events ?? [])[0] as unknown as { actor: { kind: string } } | undefined;
      expect(first?.actor.kind).toBe('system');
    });
  });
});
