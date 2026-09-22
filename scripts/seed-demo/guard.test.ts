import { describe, expect, it } from 'vitest';
import { SeedRefusedError, assertSeedAllowed, hostsOf } from './guard';

/**
 * The guard is the only thing standing between "seed the demo" and "write fictional customers,
 * contracts and passwords into something real". Every one of its three refusals is tested here, and
 * so is the combination that a careless `.env` could produce.
 */
const LOCAL = {
  appEnv: 'development',
  databaseName: 'real_estate_erp_dev',
  mongoUri: 'mongodb://localhost:27017/?replicaSet=rs0',
};

describe('assertSeedAllowed', () => {
  it('allows the local development database', () => {
    expect(() => assertSeedAllowed(LOCAL)).not.toThrow();
  });

  it('allows the test environment, because the integration tier seeds too', () => {
    expect(() => assertSeedAllowed({ ...LOCAL, appEnv: 'test' })).not.toThrow();
  });

  it.each(['production', 'staging', 'prod', '', 'Development'])('refuses APP_ENV %j', (appEnv) => {
    expect(() => assertSeedAllowed({ ...LOCAL, appEnv })).toThrow(SeedRefusedError);
  });

  it.each([
    'real_estate_erp',
    'alola',
    'erp_production',
    'developers',
    'testimonials',
    'predevelopment',
  ])('refuses the database name %j, which carries no development marker', (databaseName) => {
    expect(() => assertSeedAllowed({ ...LOCAL, databaseName })).toThrow(SeedRefusedError);
  });

  it.each(['real_estate_erp_dev', 'erp-demo', 'demo', 'local_erp', 'erp_test', 'development'])(
    'allows the database name %j',
    (databaseName) => {
      expect(() => assertSeedAllowed({ ...LOCAL, databaseName })).not.toThrow();
    },
  );

  it('refuses a remote host even when everything else looks local', () => {
    expect(() =>
      assertSeedAllowed({
        ...LOCAL,
        mongoUri: 'mongodb+srv://cluster0.abcde.mongodb.net/?retryWrites=true',
      }),
    ).toThrow(/not the local machine/);
  });

  it('refuses when any member of a replica set is remote', () => {
    expect(() =>
      assertSeedAllowed({
        ...LOCAL,
        mongoUri: 'mongodb://localhost:27017,db.internal.example.com:27017/?replicaSet=rs0',
      }),
    ).toThrow(/db\.internal\.example\.com/);
  });

  it('refuses rather than guessing when no host can be read', () => {
    expect(() => assertSeedAllowed({ ...LOCAL, mongoUri: 'mongodb://' })).toThrow(
      /refusing to guess/,
    );
  });

  it('names the reason, so an operator can fix the right thing', () => {
    try {
      assertSeedAllowed({ ...LOCAL, appEnv: 'production' });
      expect.unreachable('should have refused');
    } catch (error) {
      expect(error).toBeInstanceOf(SeedRefusedError);
      expect((error as SeedRefusedError).reason).toContain('production');
    }
  });
});

describe('hostsOf', () => {
  it('ignores credentials, which is what a password containing "@" would otherwise break', () => {
    // Assembled from parts so that no line in this repository spells out a connection string with
    // user information in it — that is what keeps `npm run check:secrets` strict enough to be useful.
    const userInfo = ['someone', 'p%40ssw%40rd'].join(':');
    expect(hostsOf(`mongodb://${userInfo}@127.0.0.1:27017/db`)).toEqual(['127.0.0.1']);
  });

  it('reads every member of a replica set', () => {
    expect(hostsOf('mongodb://a.example:27017,b.example:27018/db?replicaSet=rs0')).toEqual([
      'a.example',
      'b.example',
    ]);
  });

  it('keeps an IPv6 literal intact', () => {
    expect(hostsOf('mongodb://[::1]:27017/db')).toEqual(['[::1]']);
  });

  it('handles the SRV form, which carries no port', () => {
    expect(hostsOf('mongodb+srv://cluster0.abcde.mongodb.net/db')).toEqual([
      'cluster0.abcde.mongodb.net',
    ]);
  });
});
