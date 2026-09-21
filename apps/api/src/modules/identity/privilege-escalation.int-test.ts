import {
  AUDIT_ACTIONS,
  PERMISSIONS,
  ScopeAssignmentSchema,
  type ActorContext,
  type Permission,
  type ScopeAssignment,
} from '@alola/contracts';
import {
  DevKeyEncryptor,
  PasswordHasher,
  TokenIssuer,
  createLogger,
  currentTotpCode,
} from '@alola/security';
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
import { accountModel, accountTokenModel, refreshTokenModel, sessionModel } from './model';
import { accountAdminRouter, authRouter, meRouter } from './router';
import { IdentityService } from './service';
import { AuthThrottle } from './throttle';

/**
 * Privilege-escalation suite (`SEC-010`).
 *
 * The registry defines `SEC-010` as the escalation **test suite** — the cross-cutting one, not a feature.
 * `SEC-031` covers the rules inside the authorization core and is exercised by
 * `security/authorization.int-test.ts`. This file attacks the identity surface those rules now sit on:
 * every route, token, and lifecycle state that could be turned into more authority than it was granted.
 *
 * Each test states the attack, then asserts both that it fails **and** that nothing changed.
 */
const gate = serviceGate(['mongodb', 'redis']);
const RUN = `it-escalation-${Date.now()}`;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const TOTP_ISSUER = 'ALOLA TEST';
const PASSWORD = 'seven-blue-harbour-lanterns';
const OTHER_PASSWORD = 'nine-quiet-almond-terraces';

const scope = (level: ScopeAssignment['level']): ScopeAssignment =>
  ScopeAssignmentSchema.parse({ level });

describe.skipIf(!gate.available)(`privilege escalation — ${gate.reason}`, () => {
  let connection: Connection;
  let redis: Redis;
  let audit: AuditService;
  let security: SecurityService;
  let identity: IdentityService;
  let app: Express;
  let clock: Date;

  const R_ADMIN = `${RUN}-r-admin`;
  const R_PLAIN = `${RUN}-r-plain`;
  const R_ACCOUNT_CREATOR = `${RUN}-r-creator`;
  const ADMIN_LOGIN = `${RUN}-admin@example.com`;
  let adminAccountId = '';
  let adminTotpSecret = '';

  let addressCounter = 0;
  const nextAddress = (): string => {
    addressCounter += 1;
    return `198.51.100.${(addressCounter % 250) + 1}`;
  };

  const api = () => request(app);
  const post = (path: string) =>
    api().post(path).set('Origin', ALLOWED_ORIGIN).set('X-Forwarded-For', nextAddress());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function context() {
    return { correlationId: `${RUN}-${Math.random().toString(36).slice(2)}`, method: 'POST' };
  }

  function systemActor(): ActorContext {
    return {
      accountId: `${RUN}-bootstrap`,
      kind: 'account',
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

  interface Signed {
    accessToken: string;
    cookie: string;
    accountId: string;
    sessionId: string;
    loginIdentifier: string;
  }

  function cookieFrom(res: { headers: Record<string, unknown> }): string {
    const raw: unknown = res.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw.map(String) : [];
    const cookie = list.find((entry) => entry.startsWith('alola_rt='));
    expect(cookie, 'no refresh cookie').toBeDefined();
    return (cookie as string).split(';')[0] as string;
  }

  /** An account with no second factor; used for every non-privileged actor in this file. */
  async function provision(
    localPart: string,
    roleKeys: string[] = [],
    password = PASSWORD,
  ): Promise<Signed> {
    const loginIdentifier = `${RUN}-${localPart}@example.com`;
    const created = await identity.createAccount(
      systemActor(),
      { loginIdentifier, displayName: localPart, personalAccountAttested: true },
      context(),
    );
    await identity.activateAccount(created.activationToken, password, context());
    if (roleKeys.length > 0) await grant(created.account.accountId, roleKeys);
    let res = await post('/api/v1/auth/login').send({ loginIdentifier, password });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    if (res.body.status === 'mfaRequired') {
      // An account holding any privileged permission must enrol a second factor before it can sign in
      // (`SEC-017`), so a privileged fixture goes through that flow rather than around it.
      expect(res.body.stage).toBe('enrol');
      const challengeToken = res.body.challengeToken as string;
      const enrolment = await post('/api/v1/auth/mfa/enrol').send({ challengeToken });
      expect(enrolment.status).toBe(200);
      clock = new Date(clock.getTime() + 31_000);
      res = await post('/api/v1/auth/mfa/confirm').send({
        challengeToken,
        code: currentTotpCode({
          secret: enrolment.body.secret,
          issuer: TOTP_ISSUER,
          label: loginIdentifier,
          now: clock,
        }),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }

    return {
      accessToken: res.body.accessToken,
      cookie: cookieFrom(res),
      accountId: res.body.account.accountId,
      sessionId: res.body.sessionId,
      loginIdentifier,
    };
  }

  /** The administrator holds privileged permissions, so signing in requires its second factor. */
  async function adminSignIn(): Promise<Signed> {
    clock = new Date(clock.getTime() + 31_000);
    const challenge = await post('/api/v1/auth/login').send({
      loginIdentifier: ADMIN_LOGIN,
      password: PASSWORD,
    });
    expect(challenge.body.status).toBe('mfaRequired');
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
      cookie: cookieFrom(verified),
      accountId: verified.body.account.accountId,
      sessionId: verified.body.sessionId,
      loginIdentifier: ADMIN_LOGIN,
    };
  }

  beforeAll(async () => {
    configureMongoose();
    connection = mongoose.createConnection(process.env['MONGODB_URI'] as string, {
      dbName: process.env['MONGODB_DB_NAME'],
      serverSelectionTimeoutMS: 10_000,
    });
    await connection.asPromise();
    const logger = createLogger({ name: 'escalation-int', level: 'silent' });
    await ensureIndexes(connection, logger);
    redis = new Redis(process.env['REDIS_URL'] as string, { maxRetriesPerRequest: 2 });
    const stale = await redis.keys('throttle-*198.51.100.*');
    if (stale.length > 0) await redis.del(...stale);
    clock = new Date();

    audit = new AuditService({ connection, logger, onRecorded: noteAuditWrite });
    security = new SecurityService({ connection, audit });

    for (const [key, permissions] of [
      [R_ADMIN, [...PERMISSIONS]],
      [R_PLAIN, ['audit.view'] as Permission[]],
      // Deliberately narrow: may create an account, may not grant anything to it.
      [R_ACCOUNT_CREATOR, ['security.account.create', 'security.account.view'] as Permission[]],
    ] as const) {
      await bootstrapRole(connection, {
        key,
        name: { ar: key, en: key },
        permissions,
        isAdministrative: key !== R_PLAIN,
      });
    }

    identity = new IdentityService({
      connection,
      logger,
      audit,
      hasher: new PasswordHasher(),
      tokens: new TokenIssuer({
        secret: 'escalation-suite-signing-secret-of-sufficient-length',
        issuer: 'alola-erp-api',
        audience: 'alola-erp',
        accessTokenTtlSeconds: 600,
        mfaChallengeTtlSeconds: 300,
      }),
      encryptor: new DevKeyEncryptor('test', Buffer.alloc(32, 3).toString('base64')),
      throttle: new AuthThrottle(redis),
      resolveGrants: (accountId) => security.resolveActor(accountId),
      ttl: {
        sessionIdleSeconds: 1800,
        sessionAbsoluteSeconds: 43_200,
        activationSeconds: 259_200,
        passwordResetSeconds: 1800,
      },
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
      config: { CORS_ALLOWED_ORIGINS: [ALLOWED_ORIGIN], TRUST_PROXY_HOPS: 1, APP_ENV: 'test' },
      logger,
      mongo: { health: () => Promise.resolve({ status: 'up', transactions: true }) },
      redis: { health: () => Promise.resolve({ status: 'up' }) },
      rateLimiter: new RateLimiterMemory({ points: 100_000, duration: 60 }),
      actorResolver,
      modules,
    });

    const bootstrap = await identity.createBootstrapAccount(
      { loginIdentifier: ADMIN_LOGIN, displayName: 'administrator' },
      context(),
    );
    adminAccountId = bootstrap.account.accountId;
    await identity.activateAccount(bootstrap.activationToken, PASSWORD, context());
    await grant(adminAccountId, [R_ADMIN]);
    const first = await post('/api/v1/auth/login').send({
      loginIdentifier: ADMIN_LOGIN,
      password: PASSWORD,
    });
    const enrolment = await post('/api/v1/auth/mfa/enrol').send({
      challengeToken: first.body.challengeToken,
    });
    adminTotpSecret = enrolment.body.secret;
    await post('/api/v1/auth/mfa/confirm').send({
      challengeToken: first.body.challengeToken,
      code: currentTotpCode({
        secret: adminTotpSecret,
        issuer: TOTP_ISSUER,
        label: ADMIN_LOGIN,
        now: clock,
      }),
    });
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.db?.collection(AUDIT_COLLECTION).deleteMany({
      $or: [
        { 'context.correlationId': { $regex: `^${RUN}` } },
        { 'target.id': { $regex: `^${RUN}` } },
      ],
    });
    const accounts = await accountModel(connection)
      .find({ loginIdentifier: { $regex: `^${RUN}` } })
      .lean()
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
    const keys = [
      ...(await redis.keys(`throttle-*${RUN}*`)),
      ...(await redis.keys('throttle-*198.51.100.*')),
    ];
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
    await connection.close();
  });

  describe('a plain account cannot administer anything', () => {
    it('is refused on every administrative account route', async () => {
      const attacker = await provision('plain-admin-routes', [R_PLAIN]);
      const victim = await provision('plain-victim', [R_PLAIN]);
      const attempts: { status: number; label: string }[] = [];

      attempts.push({
        label: 'create account',
        status: (
          await post('/api/v1/security/accounts')
            .set(auth(attacker.accessToken))
            .send({
              loginIdentifier: `${RUN}-made-by-attacker@example.com`,
              displayName: 'x',
              personalAccountAttested: true,
            })
        ).status,
      });
      attempts.push({
        label: 'list accounts',
        status: (await api().get('/api/v1/security/accounts').set(auth(attacker.accessToken)))
          .status,
      });
      attempts.push({
        label: 'suspend',
        status: (
          await post(`/api/v1/security/accounts/${victim.accountId}/suspend`)
            .set(auth(attacker.accessToken))
            .send({ reason: 'because I can' })
        ).status,
      });
      attempts.push({
        label: 'offboard',
        status: (
          await post(`/api/v1/security/accounts/${victim.accountId}/offboard`)
            .set(auth(attacker.accessToken))
            .send({ reason: 'because I can', recordHandoverAcknowledged: true })
        ).status,
      });
      attempts.push({
        label: 'password reset',
        status: (
          await post(`/api/v1/security/accounts/${victim.accountId}/password-reset`).set(
            auth(attacker.accessToken),
          )
        ).status,
      });
      attempts.push({
        label: 'mfa reset',
        status: (
          await post(`/api/v1/security/accounts/${victim.accountId}/mfa/reset`).set(
            auth(attacker.accessToken),
          )
        ).status,
      });
      attempts.push({
        label: 'list sessions',
        status: (
          await api()
            .get(`/api/v1/security/accounts/${victim.accountId}/sessions`)
            .set(auth(attacker.accessToken))
        ).status,
      });
      attempts.push({
        label: 'revoke all sessions',
        status: (
          await post(`/api/v1/security/accounts/${victim.accountId}/sessions/revoke-all`).set(
            auth(attacker.accessToken),
          )
        ).status,
      });
      attempts.push({
        label: 'create role',
        status: (
          await post('/api/v1/security/roles')
            .set(auth(attacker.accessToken))
            .send({
              key: `${RUN}-r-attacker`,
              name: { ar: 'x', en: 'x' },
              permissions: ['security.grant.assignAny'],
            })
        ).status,
      });
      attempts.push({
        label: 'grant itself permissions',
        status: (
          await api()
            .put(`/api/v1/security/accounts/${attacker.accountId}/grants`)
            .set('Origin', ALLOWED_ORIGIN)
            .set(auth(attacker.accessToken))
            .send({ roleKeys: [R_ADMIN], deniedPermissions: [], scope: { level: 'all' } })
        ).status,
      });

      expect(attempts.map((attempt) => `${attempt.label}:${attempt.status}`)).toEqual(
        attempts.map((attempt) => `${attempt.label}:403`),
      );
      // Nothing changed: the victim is still active and the attacker still holds only what it had.
      expect((await identity.getAccount(victim.accountId)).state).toBe('active');
      expect((await api().get('/api/v1/me').set(auth(victim.accessToken))).status).toBe(200);
      const attackerGrant = await security.getGrant(attacker.accountId);
      expect(attackerGrant?.roleKeys).toEqual([R_PLAIN]);
    });

    it('cannot give a new account any authority, even when it may create accounts', async () => {
      const creator = await provision('creator', [R_ACCOUNT_CREATOR]);
      const created = await post('/api/v1/security/accounts')
        .set(auth(creator.accessToken))
        .send({
          loginIdentifier: `${RUN}-fresh@example.com`,
          displayName: 'fresh',
          personalAccountAttested: true,
        });
      expect(created.status).toBe(201);

      // Creating an account grants nothing; assigning a role needs a permission this account lacks.
      const grantAttempt = await api()
        .put(`/api/v1/security/accounts/${created.body.account.accountId}/grants`)
        .set('Origin', ALLOWED_ORIGIN)
        .set(auth(creator.accessToken))
        .send({ roleKeys: [R_ADMIN], deniedPermissions: [], scope: { level: 'all' } });
      expect(grantAttempt.status).toBe(403);
      expect(await security.getGrant(created.body.account.accountId)).toBeUndefined();

      // And the new account, once activated, can do nothing.
      await identity.activateAccount(created.body.activationToken, PASSWORD, context());
      const fresh = await post('/api/v1/auth/login').send({
        loginIdentifier: `${RUN}-fresh@example.com`,
        password: PASSWORD,
      });
      expect(
        (await api().get('/api/v1/audit/events').set(auth(fresh.body.accessToken))).status,
      ).toBe(403);
    });
  });

  describe('an administrator cannot use an administrative route on themselves', () => {
    it('refuses a self-targeted MFA reset, password reset, suspension, and offboarding', async () => {
      const admin = await adminSignIn();
      const results = [
        (
          await post(`/api/v1/security/accounts/${admin.accountId}/mfa/reset`).set(
            auth(admin.accessToken),
          )
        ).status,
        (
          await post(`/api/v1/security/accounts/${admin.accountId}/password-reset`).set(
            auth(admin.accessToken),
          )
        ).status,
        (
          await post(`/api/v1/security/accounts/${admin.accountId}/suspend`)
            .set(auth(admin.accessToken))
            .send({ reason: 'oops' })
        ).status,
        (
          await post(`/api/v1/security/accounts/${admin.accountId}/offboard`)
            .set(auth(admin.accessToken))
            .send({ reason: 'oops', recordHandoverAcknowledged: true })
        ).status,
      ];
      expect(results).toEqual([403, 403, 403, 403]);

      // The second factor is intact and the account is still active, so nothing was weakened.
      const account = await identity.getAccount(admin.accountId);
      expect(account.mfaEnabled).toBe(true);
      expect(account.state).toBe('active');
      expect((await api().get('/api/v1/me').set(auth(admin.accessToken))).status).toBe(200);
    });

    it('records the refusal, so a self-administration attempt is visible afterwards', async () => {
      const admin = await adminSignIn();
      await post(`/api/v1/security/accounts/${admin.accountId}/mfa/reset`).set(
        auth(admin.accessToken),
      );
      const events = (await connection.db
        ?.collection(AUDIT_COLLECTION)
        .find({ 'target.id': adminAccountId, outcome: 'denied' })
        .toArray()) as { reason?: string }[];
      expect(events.some((event) => (event.reason ?? '').includes("caller's own account"))).toBe(
        true,
      );
    });
  });

  describe('a second factor cannot be bypassed', () => {
    it('drops the authority of a session that predates the account becoming privileged', async () => {
      // Signed in with a password only, which was correct at the time.
      const user = await provision('late-privilege', [R_PLAIN]);
      expect((await api().get('/api/v1/audit/events').set(auth(user.accessToken))).status).toBe(
        200,
      );

      // The account is then given administrative permissions, which require a second factor.
      await grant(user.accountId, [R_ADMIN]);

      // The existing password-only session must not become an administrative session.
      expect((await api().get('/api/v1/me').set(auth(user.accessToken))).status).toBe(401);
      expect(
        (await api().get('/api/v1/security/accounts').set(auth(user.accessToken))).status,
      ).toBe(401);
    });

    it('will not accept a challenge token where an access token is required', async () => {
      const user = await provision('challenge-misuse', [R_PLAIN]);
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
      const challenge = await post('/api/v1/auth/login').send({
        loginIdentifier: user.loginIdentifier,
        password: PASSWORD,
      });
      expect(challenge.body.status).toBe('mfaRequired');

      // The challenge is not a session, whatever it is presented as.
      expect((await api().get('/api/v1/me').set(auth(challenge.body.challengeToken))).status).toBe(
        401,
      );
      expect(
        (await api().get('/api/v1/audit/events').set(auth(challenge.body.challengeToken))).status,
      ).toBe(401);
    });

    it('will not let one account spend another account’s challenge', async () => {
      const victim = await provision('challenge-owner', [R_PLAIN]);
      const started = await post('/api/v1/auth/mfa/enrol').set(auth(victim.accessToken)).send({});
      await post('/api/v1/auth/mfa/confirm')
        .set(auth(victim.accessToken))
        .send({
          code: currentTotpCode({
            secret: started.body.secret,
            issuer: TOTP_ISSUER,
            label: victim.loginIdentifier,
            now: clock,
          }),
        });
      const challenge = await post('/api/v1/auth/login').send({
        loginIdentifier: victim.loginIdentifier,
        password: PASSWORD,
      });

      // The attacker knows the victim's challenge token but not its code.
      const guessed = await post('/api/v1/auth/mfa/verify').send({
        challengeToken: challenge.body.challengeToken,
        code: '123456',
      });
      expect(guessed.status).toBe(401);

      // It cannot be turned into an enrolment either, which would replace the factor.
      const enrolAttempt = await post('/api/v1/auth/mfa/enrol').send({
        challengeToken: challenge.body.challengeToken,
      });
      expect(enrolAttempt.status).toBe(401);
      expect((await identity.getAccount(victim.accountId)).mfaEnabled).toBe(true);
    });
  });

  describe('credential recovery cannot be redirected', () => {
    it('binds a password-reset token to one account', async () => {
      const admin = await adminSignIn();
      const victim = await provision('reset-target', [R_PLAIN]);
      const attacker = await provision('reset-attacker', [R_PLAIN], OTHER_PASSWORD);

      const issued = await post(`/api/v1/security/accounts/${victim.accountId}/password-reset`).set(
        auth(admin.accessToken),
      );
      expect(issued.status).toBe(201);

      // Using the victim's token sets the victim's password — it carries the account, not the caller.
      const used = await post('/api/v1/auth/password/reset').send({
        token: issued.body.resetToken,
        password: 'a-brand-new-long-passphrase',
      });
      expect(used.status).toBe(204);

      // The attacker's own password is untouched.
      const attackerLogin = await post('/api/v1/auth/login').send({
        loginIdentifier: attacker.loginIdentifier,
        password: OTHER_PASSWORD,
      });
      expect(attackerLogin.status).toBe(200);
      const guessed = await post('/api/v1/auth/login').send({
        loginIdentifier: attacker.loginIdentifier,
        password: 'a-brand-new-long-passphrase',
      });
      expect(guessed.status).toBe(401);
    });

    it('refuses an activation token for an account that is already active', async () => {
      const created = await identity.createAccount(
        systemActor(),
        {
          loginIdentifier: `${RUN}-double-activate@example.com`,
          displayName: 'double',
          personalAccountAttested: true,
        },
        context(),
      );
      await identity.activateAccount(created.activationToken, PASSWORD, context());
      // A replayed activation would be a way to set a password without knowing the old one.
      const replay = await post('/api/v1/auth/activate').send({
        token: created.activationToken,
        password: 'attacker-chosen-passphrase',
      });
      expect(replay.status).toBe(400);
      const login = await post('/api/v1/auth/login').send({
        loginIdentifier: `${RUN}-double-activate@example.com`,
        password: 'attacker-chosen-passphrase',
      });
      expect(login.status).toBe(401);
    });
  });

  describe('a revoked or ended identity cannot act', () => {
    it('stops a suspended account mid-session, even with a valid access token', async () => {
      const admin = await adminSignIn();
      const user = await provision('suspended-actor', [R_PLAIN]);
      expect((await api().get('/api/v1/audit/events').set(auth(user.accessToken))).status).toBe(
        200,
      );

      await post(`/api/v1/security/accounts/${user.accountId}/suspend`)
        .set(auth(admin.accessToken))
        .send({ reason: 'suspended during a session' });

      expect((await api().get('/api/v1/audit/events').set(auth(user.accessToken))).status).toBe(
        401,
      );
      expect((await post('/api/v1/auth/refresh').set('Cookie', user.cookie)).status).toBe(401);
      // It cannot lift its own suspension either: there is no session to do it with.
      expect(
        (
          await post(`/api/v1/security/accounts/${user.accountId}/reactivate`).set(
            auth(user.accessToken),
          )
        ).status,
      ).toBe(401);
    });

    it('stops an offboarded account and its outstanding tokens', async () => {
      const admin = await adminSignIn();
      const user = await provision('offboarded-actor', [R_PLAIN]);
      await post(`/api/v1/security/accounts/${user.accountId}/offboard`)
        .set(auth(admin.accessToken))
        .send({ reason: 'left', recordHandoverAcknowledged: true });

      expect((await api().get('/api/v1/me').set(auth(user.accessToken))).status).toBe(401);
      expect((await post('/api/v1/auth/refresh').set('Cookie', user.cookie)).status).toBe(401);
      const login = await post('/api/v1/auth/login').send({
        loginIdentifier: user.loginIdentifier,
        password: PASSWORD,
      });
      expect(login.status).toBe(401);
    });

    it('does not let a revoked session be revived by its own refresh cookie', async () => {
      const user = await provision('revived', [R_PLAIN]);
      await post('/api/v1/auth/logout').set(auth(user.accessToken)).set('Cookie', user.cookie);
      expect((await post('/api/v1/auth/refresh').set('Cookie', user.cookie)).status).toBe(401);
    });
  });

  describe('nothing about authority is taken from the request', () => {
    it('ignores headers, cookies, and query parameters that claim identity or permissions', async () => {
      const user = await provision('claims', [R_PLAIN]);
      const res = await api()
        .get('/api/v1/security/accounts')
        .set(auth(user.accessToken))
        .set('x-account-id', adminAccountId)
        .set('x-permissions', 'security.account.view')
        .set('x-roles', R_ADMIN)
        .set('Cookie', `permissions=security.account.view; roles=${R_ADMIN}`);
      expect(res.status).toBe(403);
    });

    it('will not accept an access token as a refresh cookie', async () => {
      const user = await provision('token-swap', [R_PLAIN]);
      const res = await post('/api/v1/auth/refresh').set('Cookie', `alola_rt=${user.accessToken}`);
      expect(res.status).toBe(401);
      // The real session is untouched by the attempt.
      expect((await api().get('/api/v1/me').set(auth(user.accessToken))).status).toBe(200);
    });

    it('will not let a body override the account a self-service route acts on', async () => {
      const user = await provision('self-scope', [R_PLAIN]);
      const victim = await provision('self-scope-victim', [R_PLAIN]);
      // Strict schemas reject the extra field outright rather than ignoring it.
      const res = await post('/api/v1/me/password').set(auth(user.accessToken)).send({
        currentPassword: PASSWORD,
        newPassword: 'another-long-enough-passphrase',
        accountId: victim.accountId,
      });
      expect(res.status).toBe(400);
      // The victim's password still works.
      const login = await post('/api/v1/auth/login').send({
        loginIdentifier: victim.loginIdentifier,
        password: PASSWORD,
      });
      expect(login.status).toBe(200);
    });
  });
});
