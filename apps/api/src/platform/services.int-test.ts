import { createLogger } from '@alola/security';
import { serviceGate } from '@alola/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { MongoConnector, configureMongoose } from './mongo';
import { RedisConnector } from './redis';

/**
 * Integration tier (TEST-001). Runs only against the approved development services (ADR-0018) and is
 * skipped — loudly, and reported as skipped — when they are not configured.
 */
const logger = createLogger({ name: 'api-int', level: 'silent' });

const mongoGate = serviceGate(['mongodb']);
describe.skipIf(!mongoGate.available)(`MongoDB (PLAT-014) — ${mongoGate.reason}`, () => {
  configureMongoose();
  const mongo = new MongoConnector(
    { uri: process.env['MONGODB_URI'], dbName: process.env['MONGODB_DB_NAME'] },
    logger,
  );
  afterAll(() => mongo.close());

  it('connects and reports transaction support (replica set required)', async () => {
    await mongo.connect();
    expect(await mongo.health()).toEqual({ status: 'up', transactions: true });
  });
});

const redisGate = serviceGate(['redis']);
describe.skipIf(!redisGate.available)(`Redis (PLAT-015) — ${redisGate.reason}`, () => {
  const redis = new RedisConnector(process.env['REDIS_URL'], logger);
  afterAll(() => redis.close());

  it('connects and answers ping', async () => {
    redis.connect();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await redis.health()).toEqual({ status: 'up' });
  });
});
