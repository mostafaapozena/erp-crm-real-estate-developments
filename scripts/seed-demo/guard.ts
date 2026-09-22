/**
 * The refusals that stop a demonstration seed from ever touching something real.
 *
 * Seeding writes fictional customers, contracts and receipts, and it writes account passwords. Run
 * against the wrong database that is not a mistake you recover from by deleting rows — the audit
 * trail is append-only by design, and the money figures would be indistinguishable from real ones
 * two weeks later.
 *
 * So the guard is deliberately paranoid and checks three independent things. Any one of them failing
 * refuses the run, and none of them can be satisfied by accident:
 *
 * 1. `APP_ENV` must be `development` or `test`.
 * 2. The database name must carry an explicit development or demonstration marker.
 * 3. The connection must point at the local machine.
 *
 * A production database would have to be named like a development one **and** be reachable on
 * localhost **and** be configured as `development` before any of this could run against it.
 */
export class SeedRefusedError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'SeedRefusedError';
  }
}

const SAFE_NAME = /(^|[-_])(dev|development|demo|local|test)([-_]|$)/i;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|host\.docker\.internal|mongodb)$/i;

/** Hosts a connection string points at, with credentials and options discarded. */
export function hostsOf(uri: string): string[] {
  // Deliberately parsed by hand: `new URL` rejects several valid mongodb:// forms, and this must
  // never throw its way into "cannot tell, proceed anyway".
  const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//i, '');
  const authority = withoutScheme.split('/')[0] ?? '';
  const hostPart = authority.includes('@')
    ? authority.slice(authority.lastIndexOf('@') + 1)
    : authority;
  return hostPart
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const bracketed = /^\[(.+)\]/.exec(entry);
      if (bracketed?.[1]) return `[${bracketed[1]}]`;
      const host = entry.split(':')[0] ?? '';
      return host;
    })
    .filter(Boolean);
}

export interface SeedTarget {
  appEnv: string;
  databaseName: string;
  mongoUri: string;
}

/** Throws unless every check passes. Returns nothing: there is no "probably fine". */
export function assertSeedAllowed(target: SeedTarget): void {
  if (target.appEnv !== 'development' && target.appEnv !== 'test') {
    throw new SeedRefusedError(
      `APP_ENV is "${target.appEnv}". The demonstration seed runs only in development or test.`,
    );
  }

  if (!SAFE_NAME.test(target.databaseName)) {
    throw new SeedRefusedError(
      `The database name "${target.databaseName}" carries no development or demonstration marker. ` +
        'Expected a name containing dev, development, demo, local or test.',
    );
  }

  const hosts = hostsOf(target.mongoUri);
  if (hosts.length === 0) {
    throw new SeedRefusedError('No host could be read from MONGODB_URI; refusing to guess.');
  }
  const remote = hosts.filter((host) => !LOCAL_HOST.test(host));
  if (remote.length > 0) {
    throw new SeedRefusedError(
      `MONGODB_URI points at ${remote.join(', ')}, which is not the local machine. ` +
        'The demonstration seed never runs against a remote database.',
    );
  }
}
