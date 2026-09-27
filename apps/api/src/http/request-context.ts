import type { ActorContext } from '@alola/contracts';
import type { Request, Response } from 'express';
import { AppError } from '../errors';
import type { RequestContext } from '../platform/audit-port';
import { currentActor } from './actor';
import { correlationIdOf } from './correlation';

/** The request facts a service records with its audit evidence. */
export function requestContextOf(req: Request, res: Response, route: string): RequestContext {
  return {
    correlationId: correlationIdOf(res),
    method: req.method,
    route,
    ...(req.ip ? { ip: req.ip } : {}),
  };
}

/** The authenticated actor. Guards run first, so its absence here is a programming error answered 401. */
export function requireActor(res: Response): ActorContext {
  const actor = currentActor(res);
  if (!actor) throw new AppError('UNAUTHENTICATED', 401);
  return actor;
}
