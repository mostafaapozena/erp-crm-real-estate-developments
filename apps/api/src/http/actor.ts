import { AUDIT_ACTIONS, type ActorContext, type Permission } from '@alola/contracts';
import { PermissionDeniedError, UnauthenticatedError, can } from '@alola/security';
import type { Request, RequestHandler, Response } from 'express';
import { AppError } from '../errors';
import { correlationIdOf } from './correlation';

/**
 * Actor resolution and the permission guard (SEC-025, ADR-0006).
 *
 * The actor is built **on the server** from stored grants. Nothing about identity, roles, permissions, or
 * ownership is ever read from the request: a body, header, or query parameter claiming a role is data, not
 * authority. Authorization is enforced here, in the API — never only in the UI.
 *
 * Until session authentication lands (`SEC-013`, `SEC-014`), the production resolver returns no actor, so
 * every protected endpoint answers `401`. Tests inject their own resolver; there is no development
 * bypass compiled into the application.
 */
export type ActorResolver = (req: Request) => Promise<ActorContext | undefined>;

/** Default resolver: no authenticated actor exists yet. */
export const unauthenticatedResolver: ActorResolver = () => Promise.resolve(undefined);

export function attachActor(resolver: ActorResolver): RequestHandler {
  return (req, res, next) => {
    resolver(req)
      .then((actor) => {
        if (actor) res.locals['actor'] = actor;
        next();
      })
      .catch(next);
  };
}

export function currentActor(res: Response): ActorContext | undefined {
  return res.locals['actor'] as ActorContext | undefined;
}

/** Details handed to the audit subsystem when a request is denied (AUDIT-005). */
export interface AuthorizationDenial {
  requiredPermission: Permission;
  actor: ActorContext | undefined;
  correlationId: string;
  method: string;
  route: string;
  ip?: string;
}

export interface GuardOptions {
  /** Records the denial as a security event. Failure to record must not mask the denial itself. */
  onDenied?: (denial: AuthorizationDenial) => Promise<void>;
}

/**
 * Require one permission. Denials are audited as `security.authorization.denied`, and the response never
 * names the missing permission — that would describe the policy to an attacker.
 */
export function requirePermission(
  permission: Permission,
  options: GuardOptions = {},
): RequestHandler {
  return (req, res, next) => {
    const actor = currentActor(res);
    if (actor && can(actor, permission)) {
      next();
      return;
    }
    const error = actor ? new PermissionDeniedError(permission) : new UnauthenticatedError();
    const denial: AuthorizationDenial = {
      requiredPermission: permission,
      actor,
      correlationId: correlationIdOf(res),
      method: req.method,
      route: req.originalUrl.split('?')[0] ?? req.originalUrl,
      ...(req.ip ? { ip: req.ip } : {}),
    };
    const finish = () => {
      next(new AppError(error.code, error.code === 'UNAUTHENTICATED' ? 401 : 403));
    };
    if (!options.onDenied) {
      finish();
      return;
    }
    options.onDenied(denial).then(finish, finish);
  };
}

export const AUTHORIZATION_DENIED_ACTION = AUDIT_ACTIONS.authorizationDenied;

/**
 * Require an authenticated actor and nothing more (`SEC-013`).
 *
 * Self-service routes — your own sessions, your own password, your own second factor — need identity, not
 * a permission. Granting a permission for "manage my own account" would be the wrong shape: it could be
 * withheld, and then a person could not sign out.
 */
export function requireAuthenticated(options: GuardOptions = {}): RequestHandler {
  return (req, res, next) => {
    if (currentActor(res)) {
      next();
      return;
    }
    const denial: AuthorizationDenial = {
      // Recorded as the permission that was effectively missing: being signed in at all.
      requiredPermission: 'authenticated' as Permission,
      actor: undefined,
      correlationId: correlationIdOf(res),
      method: req.method,
      route: req.originalUrl.split('?')[0] ?? req.originalUrl,
      ...(req.ip ? { ip: req.ip } : {}),
    };
    const finish = () => next(new AppError('UNAUTHENTICATED', 401));
    if (!options.onDenied) {
      finish();
      return;
    }
    options.onDenied(denial).then(finish, finish);
  };
}
