import { createLogger } from '@alola/security';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { correlation } from './correlation';
import { errorHandler } from './errors';
import { validate, validated } from './validate';

/**
 * Boundary validation (SEC-004, I18N-008): unknown fields are refused, and every refusal carries a
 * machine code the client can localize — never prose.
 */
function appWith(schema: z.ZodType) {
  const app = express();
  app.use(correlation());
  app.use(express.json());
  app.post('/probe', validate({ body: schema }), (_req, res) => {
    res.json(validated(res, 'body'));
  });
  app.use(errorHandler(createLogger({ name: 'validate-test', level: 'silent' })));
  return app;
}

describe('validate', () => {
  const schema = z
    .strictObject({ from: z.number(), to: z.number() })
    .refine((value) => value.from <= value.to, { message: 'RANGE_INVERTED', path: ['to'] });

  it('answers a refinement with the stable code it declares', async () => {
    const res = await request(appWith(schema)).post('/probe').send({ from: 5, to: 1 }).expect(400);
    expect(res.body.error.issues).toEqual([{ path: ['body', 'to'], code: 'RANGE_INVERTED' }]);
  });

  it("keeps Zod's own code for every other issue, and for a refinement with no stable code", async () => {
    const unknown = await request(appWith(schema))
      .post('/probe')
      .send({ from: 1, to: 2, extra: true })
      .expect(400);
    expect(unknown.body.error.issues[0].code).toBe('unrecognized_keys');
    const prose = z.strictObject({ a: z.number() }).refine(() => false, { message: 'not a code' });
    const res = await request(appWith(prose)).post('/probe').send({ a: 1 }).expect(400);
    expect(res.body.error.issues[0].code).toBe('custom');
  });

  it('passes valid input through unchanged', async () => {
    const res = await request(appWith(schema)).post('/probe').send({ from: 1, to: 2 }).expect(200);
    expect(res.body).toEqual({ from: 1, to: 2 });
  });
});
