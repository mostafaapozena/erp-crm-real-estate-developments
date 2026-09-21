import {
  AccountQuerySchema,
  ActivateAccountRequestSchema,
  ChangePasswordRequestSchema,
  CompletePasswordResetRequestSchema,
  ConfirmMfaRequestSchema,
  CreateAccountRequestSchema,
  DisableMfaRequestSchema,
  LoginRequestSchema,
  OffboardAccountRequestSchema,
  RequestPasswordResetRequestSchema,
  SuspendAccountRequestSchema,
  VerifyMfaRequestSchema,
  type ActorContext,
} from '@alola/contracts';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors';
import {
  currentActor,
  requireAuthenticated,
  requirePermission,
  type GuardOptions,
} from '../../http/actor';
import { markAuditExempt } from '../../http/audit-context';
import { correlationIdOf } from '../../http/correlation';
import { validate, validated } from '../../http/validate';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
  summarizeClient,
  type CookiePolicy,
} from './cookies';
import type { IdentityService, IssuedSession, RequestContext } from './service';

/**
 * Identity HTTP surface (`SEC-011` … `SEC-022`), in three routers with three different guards:
 *
 * - `/auth` — unauthenticated by necessity: signing in, activating, refreshing, resetting.
 * - `/me` — authenticated, no permission required: your own password, sessions, and second factor.
 * - `/security/accounts` — administrative, one explicit permission per operation.
 *
 * No route accepts an account id, role, permission, scope, or state from the client for its *own*
 * identity: the actor comes from the session, and an administrator's target comes from the path and is
 * always checked against a permission.
 */
export interface IdentityRouterOptions {
  getService: () => IdentityService;
  cookiePolicy: CookiePolicy;
  guard?: GuardOptions;
}

const AccountIdParamsSchema = z.strictObject({
  accountId: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9._:-]+$/, { message: 'ACCOUNT_ID_EXPECTED' }),
});

const SessionIdParamsSchema = z.strictObject({
  sessionId: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9._:-]+$/, { message: 'SESSION_ID_EXPECTED' }),
});

const AccountSessionParamsSchema = z.strictObject({
  ...AccountIdParamsSchema.shape,
  ...SessionIdParamsSchema.shape,
});

/** Enrolment and confirmation work either from a login challenge or from an authenticated session. */
const EnrolMfaRequestSchema = z.strictObject({
  challengeToken: z.string().min(1).max(4096).optional(),
});

const ConfirmMfaWithChallengeSchema = z.strictObject({
  ...ConfirmMfaRequestSchema.shape,
  challengeToken: z.string().min(1).max(4096).optional(),
  deviceLabel: z.string().trim().min(1).max(100).optional(),
});

function requestContext(req: Request, res: Response, route: string): RequestContext {
  return {
    correlationId: correlationIdOf(res),
    method: req.method,
    route,
    ...(req.ip ? { ip: req.ip } : {}),
    // Stored as a coarse summary only; the raw header never reaches storage.
    ...(summarizeClient(req.get('user-agent'))
      ? { userAgent: summarizeClient(req.get('user-agent')) }
      : {}),
  };
}

function actorOf(res: Response): ActorContext {
  const actor = currentActor(res);
  if (!actor) throw new AppError('UNAUTHENTICATED', 401);
  return actor;
}

/** One place that turns an issued session into a response: the refresh token only ever becomes a cookie. */
function respondWithSession(
  res: Response,
  policy: CookiePolicy,
  session: IssuedSession,
  status = 200,
): void {
  setRefreshCookie(res, policy, session.refreshToken, session.refreshTokenMaxAgeSeconds);
  res.status(status).json({
    status: session.status,
    accessToken: session.accessToken,
    expiresIn: session.expiresIn,
    tokenType: session.tokenType,
    account: session.account,
    sessionId: session.sessionId,
  });
}

/* ------------------------------------------------------------------- /auth */

export function authRouter(options: IdentityRouterOptions): Router {
  const router = Router();

  router.post('/login', validate({ body: LoginRequestSchema }), async (req, res) => {
    const body = validated<typeof LoginRequestSchema._output>(res, 'body');
    const result = await options
      .getService()
      .login(body, requestContext(req, res, '/api/v1/auth/login'));
    if (result.status === 'mfaRequired') {
      res.status(200).json(result);
      return;
    }
    respondWithSession(res, options.cookiePolicy, result);
  });

  router.post('/activate', validate({ body: ActivateAccountRequestSchema }), async (req, res) => {
    const body = validated<typeof ActivateAccountRequestSchema._output>(res, 'body');
    const account = await options
      .getService()
      .activateAccount(
        body.token,
        body.password,
        requestContext(req, res, '/api/v1/auth/activate'),
      );
    res.status(200).json(account);
  });

  router.post('/refresh', async (req, res) => {
    const token = readRefreshCookie(req);
    if (!token) throw new AppError('UNAUTHENTICATED', 401);
    const session = await options
      .getService()
      .refreshSession(token, requestContext(req, res, '/api/v1/auth/refresh'));
    respondWithSession(res, options.cookiePolicy, session);
  });

  router.post('/logout', requireAuthenticated(options.guard), async (req, res) => {
    const actor = actorOf(res);
    await options.getService().logout(actor, requestContext(req, res, '/api/v1/auth/logout'));
    clearRefreshCookie(res, options.cookiePolicy);
    res.status(204).end();
  });

  router.post('/mfa/verify', validate({ body: VerifyMfaRequestSchema }), async (req, res) => {
    const body = validated<typeof VerifyMfaRequestSchema._output>(res, 'body');
    const session = await options
      .getService()
      .verifyMfaChallenge(
        body.challengeToken,
        body.code,
        body.deviceLabel,
        requestContext(req, res, '/api/v1/auth/mfa/verify'),
      );
    respondWithSession(res, options.cookiePolicy, session);
  });

  /**
   * Enrolment during a login that demands a second factor, or voluntarily from a live session. The
   * secret is returned exactly once and is not active until `/mfa/confirm` accepts a code from it.
   */
  router.post('/mfa/enrol', validate({ body: EnrolMfaRequestSchema }), async (req, res) => {
    const body = validated<typeof EnrolMfaRequestSchema._output>(res, 'body');
    const service = options.getService();
    const accountId = await resolveMfaSubject(service, res, body.challengeToken, 'enrol');
    const enrolment = await service.startMfaEnrolment(
      accountId,
      requestContext(req, res, '/api/v1/auth/mfa/enrol'),
    );
    res.status(200).json(enrolment);
  });

  router.post(
    '/mfa/confirm',
    validate({ body: ConfirmMfaWithChallengeSchema }),
    async (req, res) => {
      const body = validated<typeof ConfirmMfaWithChallengeSchema._output>(res, 'body');
      const service = options.getService();
      const context = requestContext(req, res, '/api/v1/auth/mfa/confirm');
      const accountId = await resolveMfaSubject(service, res, body.challengeToken, 'enrol');
      await service.confirmMfaEnrolment(accountId, body.code, context);

      if (!body.challengeToken) {
        // Already signed in: enabling a second factor does not start a new session.
        res.status(204).end();
        return;
      }
      // Enrolled as part of signing in, so the factor is satisfied and the session can begin.
      const session = await service.completeEnrolmentLogin(accountId, body.deviceLabel, context);
      respondWithSession(res, options.cookiePolicy, session, 201);
    },
  );

  router.post(
    '/password/reset-request',
    validate({ body: RequestPasswordResetRequestSchema }),
    async (req, res) => {
      const body = validated<typeof RequestPasswordResetRequestSchema._output>(res, 'body');
      await options
        .getService()
        .requestPasswordReset(
          body.loginIdentifier,
          requestContext(req, res, '/api/v1/auth/password/reset-request'),
        );
      /**
       * Always the same answer, whether or not the identifier exists (`SEC-016`). The token is never in
       * this response: delivery belongs to `CORE-NOTIFY`, and an administrator can issue one meanwhile
       * through `POST /security/accounts/{accountId}/password-reset`.
       */
      res.status(202).json({ status: 'accepted' });
    },
  );

  router.post(
    '/password/reset',
    validate({ body: CompletePasswordResetRequestSchema }),
    async (req, res) => {
      const body = validated<typeof CompletePasswordResetRequestSchema._output>(res, 'body');
      await options
        .getService()
        .completePasswordReset(
          body.token,
          body.password,
          requestContext(req, res, '/api/v1/auth/password/reset'),
        );
      clearRefreshCookie(res, options.cookiePolicy);
      res.status(204).end();
    },
  );

  return router;
}

/**
 * Whose second factor is being set up: the account named by a login challenge, or the signed-in account.
 * A challenge token can only ever name its own account, and it cannot be swapped for a different stage.
 */
async function resolveMfaSubject(
  service: IdentityService,
  res: Response,
  challengeToken: string | undefined,
  stage: 'enrol' | 'verify',
): Promise<string> {
  if (challengeToken) return service.accountIdFromChallenge(challengeToken, stage);
  const actor = currentActor(res);
  if (!actor) throw new AppError('UNAUTHENTICATED', 401);
  return actor.accountId;
}

/* --------------------------------------------------------------------- /me */

export function meRouter(options: IdentityRouterOptions): Router {
  const router = Router();
  router.use(requireAuthenticated(options.guard));

  router.get('/', async (_req, res) => {
    const actor = actorOf(res);
    res.json({
      account: await options.getService().getAccount(actor.accountId),
      permissions: [...actor.permissions],
      scope: actor.scope,
      ...(actor.sessionId ? { sessionId: actor.sessionId } : {}),
    });
  });

  router.post('/password', validate({ body: ChangePasswordRequestSchema }), async (req, res) => {
    const actor = actorOf(res);
    const body = validated<typeof ChangePasswordRequestSchema._output>(res, 'body');
    await options
      .getService()
      .changePassword(actor, body, requestContext(req, res, '/api/v1/me/password'));
    // Every session ended, including this one (`SEC-020`), so the cookie goes too.
    clearRefreshCookie(res, options.cookiePolicy);
    res.status(204).end();
  });

  router.get('/sessions', async (_req, res) => {
    const actor = actorOf(res);
    const items = await options.getService().listSessions(actor.accountId, actor.sessionId);
    res.json({ items });
  });

  router.delete(
    '/sessions/:sessionId',
    validate({ params: SessionIdParamsSchema }),
    async (req, res) => {
      const actor = actorOf(res);
      const { sessionId } = validated<typeof SessionIdParamsSchema._output>(res, 'params');
      await options
        .getService()
        .revokeSession(
          actor,
          sessionId,
          requestContext(req, res, '/api/v1/me/sessions/:sessionId'),
          {
            // Ownership is part of the query, so another account's session is simply absent (`SEC-030`).
            ownerAccountId: actor.accountId,
          },
        );
      res.status(204).end();
    },
  );

  router.post('/sessions/revoke-others', async (req, res) => {
    const actor = actorOf(res);
    const revoked = await options
      .getService()
      .revokeAllSessions(
        actor,
        actor.accountId,
        requestContext(req, res, '/api/v1/me/sessions/revoke-others'),
        { ...(actor.sessionId ? { exceptSessionId: actor.sessionId } : {}) },
      );
    // No other session existed, so there is nothing to audit for this request (AUDIT-003).
    if (revoked === 0) markAuditExempt(res);
    res.json({ revoked });
  });

  router.post('/mfa/disable', validate({ body: DisableMfaRequestSchema }), async (req, res) => {
    const actor = actorOf(res);
    const body = validated<typeof DisableMfaRequestSchema._output>(res, 'body');
    await options
      .getService()
      .disableMfa(actor, body.currentPassword, requestContext(req, res, '/api/v1/me/mfa/disable'));
    clearRefreshCookie(res, options.cookiePolicy);
    res.status(204).end();
  });

  return router;
}

/* --------------------------------------------------- /security/accounts */

export function accountAdminRouter(options: IdentityRouterOptions): Router {
  const router = Router();

  router.get(
    '/accounts',
    requirePermission('security.account.view', options.guard),
    validate({ query: AccountQuerySchema }),
    async (_req, res) => {
      const query = validated<typeof AccountQuerySchema._output>(res, 'query');
      const items = await options
        .getService()
        .listAccounts({ ...(query.state ? { state: query.state } : {}) }, query.limit);
      res.json({ items });
    },
  );

  router.post(
    '/accounts',
    requirePermission('security.account.create', options.guard),
    validate({ body: CreateAccountRequestSchema }),
    async (req, res) => {
      const actor = actorOf(res);
      const body = validated<typeof CreateAccountRequestSchema._output>(res, 'body');
      const created = await options
        .getService()
        .createAccount(actor, body, requestContext(req, res, '/api/v1/security/accounts'));
      res.status(201).json({
        account: created.account,
        activationToken: created.activationToken,
        activationExpiresAt: created.activationExpiresAt.toISOString(),
      });
    },
  );

  router.get(
    '/accounts/:accountId',
    requirePermission('security.account.view', options.guard),
    validate({ params: AccountIdParamsSchema }),
    async (_req, res) => {
      const { accountId } = validated<typeof AccountIdParamsSchema._output>(res, 'params');
      res.json(await options.getService().getAccount(accountId));
    },
  );

  router.post(
    '/accounts/:accountId/suspend',
    requirePermission('security.account.suspend', options.guard),
    validate({ params: AccountIdParamsSchema, body: SuspendAccountRequestSchema }),
    async (req, res) => {
      const actor = actorOf(res);
      const { accountId } = validated<typeof AccountIdParamsSchema._output>(res, 'params');
      const body = validated<typeof SuspendAccountRequestSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .suspendAccount(
            actor,
            accountId,
            body.reason,
            requestContext(req, res, '/api/v1/security/accounts/:accountId/suspend'),
          ),
      );
    },
  );

  router.post(
    '/accounts/:accountId/reactivate',
    requirePermission('security.account.reactivate', options.guard),
    validate({ params: AccountIdParamsSchema }),
    async (req, res) => {
      const actor = actorOf(res);
      const { accountId } = validated<typeof AccountIdParamsSchema._output>(res, 'params');
      res.json(
        await options
          .getService()
          .reactivateAccount(
            actor,
            accountId,
            requestContext(req, res, '/api/v1/security/accounts/:accountId/reactivate'),
          ),
      );
    },
  );

  router.post(
    '/accounts/:accountId/offboard',
    requirePermission('security.account.offboard', options.guard),
    validate({ params: AccountIdParamsSchema, body: OffboardAccountRequestSchema }),
    async (req, res) => {
      const actor = actorOf(res);
      const { accountId } = validated<typeof AccountIdParamsSchema._output>(res, 'params');
      const body = validated<typeof OffboardAccountRequestSchema._output>(res, 'body');
      res.json(
        await options
          .getService()
          .offboardAccount(
            actor,
            accountId,
            body.reason,
            requestContext(req, res, '/api/v1/security/accounts/:accountId/offboard'),
          ),
      );
    },
  );

  router.post(
    '/accounts/:accountId/password-reset',
    requirePermission('security.account.resetPassword', options.guard),
    validate({ params: AccountIdParamsSchema }),
    async (req, res) => {
      const actor = actorOf(res);
      const { accountId } = validated<typeof AccountIdParamsSchema._output>(res, 'params');
      const issued = await options
        .getService()
        .issueAdministrativePasswordReset(
          actor,
          accountId,
          requestContext(req, res, '/api/v1/security/accounts/:accountId/password-reset'),
        );
      // Handed to the administrator to deliver out of band until `CORE-NOTIFY` exists.
      res.status(201).json({
        resetToken: issued.token,
        expiresAt: issued.expiresAt.toISOString(),
      });
    },
  );

  router.post(
    '/accounts/:accountId/mfa/reset',
    requirePermission('security.account.resetMfa', options.guard),
    validate({ params: AccountIdParamsSchema }),
    async (req, res) => {
      const actor = actorOf(res);
      const { accountId } = validated<typeof AccountIdParamsSchema._output>(res, 'params');
      await options
        .getService()
        .resetMfaAsAdministrator(
          actor,
          accountId,
          requestContext(req, res, '/api/v1/security/accounts/:accountId/mfa/reset'),
        );
      res.status(204).end();
    },
  );

  router.get(
    '/accounts/:accountId/sessions',
    requirePermission('security.session.viewAny', options.guard),
    validate({ params: AccountIdParamsSchema }),
    async (_req, res) => {
      const { accountId } = validated<typeof AccountIdParamsSchema._output>(res, 'params');
      res.json({ items: await options.getService().listSessions(accountId) });
    },
  );

  router.delete(
    '/accounts/:accountId/sessions/:sessionId',
    requirePermission('security.session.revokeAny', options.guard),
    validate({ params: AccountSessionParamsSchema }),
    async (req, res) => {
      const actor = actorOf(res);
      const { accountId, sessionId } = validated<typeof AccountSessionParamsSchema._output>(
        res,
        'params',
      );
      await options
        .getService()
        .revokeSession(
          actor,
          sessionId,
          requestContext(req, res, '/api/v1/security/accounts/:accountId/sessions/:sessionId'),
          { ownerAccountId: accountId },
        );
      res.status(204).end();
    },
  );

  router.post(
    '/accounts/:accountId/sessions/revoke-all',
    requirePermission('security.session.revokeAny', options.guard),
    validate({ params: AccountIdParamsSchema }),
    async (req, res) => {
      const actor = actorOf(res);
      const { accountId } = validated<typeof AccountIdParamsSchema._output>(res, 'params');
      const revoked = await options
        .getService()
        .revokeAllSessions(
          actor,
          accountId,
          requestContext(req, res, '/api/v1/security/accounts/:accountId/sessions/revoke-all'),
        );
      if (revoked === 0) {
        // Nothing changed, so there is no audit record to expect for this request (AUDIT-003).
        markAuditExempt(res);
      }
      res.json({ revoked });
    },
  );

  return router;
}
