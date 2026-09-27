import type { FieldIssue } from '@alola/contracts';
import type { RequestHandler, Response } from 'express';
import type { z } from 'zod';
import { AppError } from '../errors';

/**
 * Validation at the API boundary (SEC-004). Schemas are strict objects, so unknown fields are
 * **rejected**, not silently dropped — dropping them would hide mass-assignment attempts.
 *
 * Errors carry machine issue codes and field paths only; the client localizes them.
 */
export interface RequestSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

export interface Validated {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

export function validated<T>(res: Response, part: keyof Validated): T {
  const store = res.locals['validated'] as Validated | undefined;
  return store?.[part] as T;
}

export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, res, next) => {
    const issues: FieldIssue[] = [];
    const output: Validated = {};
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (result.success) {
        output[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          issues.push({
            path: [part, ...issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p))],
            // A refinement states its stable code as its message (`RESET_WITHOUT_DATE_COMPONENT`); every
            // other issue keeps Zod's own code. Either way the client receives a code, never prose.
            code:
              issue.code === 'custom' && /^[A-Z][A-Z0-9_]*$/.test(issue.message)
                ? issue.message
                : issue.code,
          });
        }
      }
    }
    if (issues.length > 0) {
      next(new AppError('VALIDATION_FAILED', 400, issues));
      return;
    }
    // Express 5 exposes req.query as a getter; parsed values live in res.locals instead.
    res.locals['validated'] = output;
    next();
  };
}
