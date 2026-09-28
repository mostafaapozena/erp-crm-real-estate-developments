import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from './migration-list';
import {
  MIGRATION_CHECKSUM_SCHEME,
  MigrationError,
  migrationChecksum,
  validateMigrations,
} from './migration-registry';
import { schemaHealth, type Migration, type MigrationStatus } from './migrations';

/** OPS-004: a migration's checksum is its declared identity, the same under every compiler. */
const base: Migration = {
  id: '0001-example',
  revision: 1,
  fingerprint: 'noop:example',
  description: 'An example.',
  transactional: true,
  up: () => Promise.resolve(),
};

/**
 * The baseline's checksum, pinned: a change to canonicalization shows up here, not in production.
 * Independently reproducible as the SHA-256 of
 * `["alola-migration-checksum/v2","0001-foundation-baseline",1,"noop:record-baseline-version"]`.
 */
const BASELINE_CHECKSUM = 'c7e83edee2658f22d8ad158f844f2f700a9d812671a89162a90ea2ecd59df83e';

describe('migration checksum', () => {
  it('ignores the text of the function, however it was written or compiled', () => {
    const spaced: Migration = { ...base, up: () => Promise.resolve() };
    const compact: Migration = {
      ...base,
      up: function up() {
        return Promise.resolve();
      },
    };
    const asyncBody: Migration = { ...base, up: async () => {} };
    expect(spaced.up.toString()).not.toBe(compact.up.toString());
    expect(migrationChecksum(spaced)).toBe(migrationChecksum(base));
    expect(migrationChecksum(compact)).toBe(migrationChecksum(base));
    expect(migrationChecksum(asyncBody)).toBe(migrationChecksum(base));
  });

  it('ignores the description, which is prose for people', () => {
    const reworded: Migration = { ...base, description: 'Reworded.' };
    expect(migrationChecksum(reworded)).toBe(migrationChecksum(base));
  });

  it('changes with the revision, the fingerprint or the identifier', () => {
    const checksum = migrationChecksum(base);
    expect(migrationChecksum({ ...base, revision: 2 })).not.toBe(checksum);
    expect(migrationChecksum({ ...base, fingerprint: 'noop:other' })).not.toBe(checksum);
    expect(migrationChecksum({ ...base, id: '0001-other' })).not.toBe(checksum);
  });

  it('is a stable, pinned value for the shipped baseline', () => {
    expect(MIGRATION_CHECKSUM_SCHEME).toBe('alola-migration-checksum/v2');
    const baseline = MIGRATIONS[0] as Migration;
    expect(migrationChecksum(baseline)).toBe(BASELINE_CHECKSUM);
    expect(migrationChecksum(baseline)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is identical in an esbuild bundle of the registry, minified or not', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const out = mkdtempSync(join(tmpdir(), 'alola-migration-parity-'));
    try {
      for (const minify of [false, true]) {
        const outfile = join(out, `bundle-${String(minify)}.mjs`);
        await build({
          stdin: {
            contents:
              "export { MIGRATIONS } from './migration-list';\n" +
              "export { migrationChecksum } from './migration-registry';\n",
            resolveDir: here,
            loader: 'ts',
          },
          outfile,
          bundle: true,
          platform: 'node',
          format: 'esm',
          target: 'node24',
          minify,
          logLevel: 'silent',
        });
        const bundled = (await import(pathToFileURL(outfile).href)) as {
          MIGRATIONS: Migration[];
          migrationChecksum: (migration: Migration) => string;
        };
        const sourceUp = (MIGRATIONS[0] as Migration).up.toString();
        const bundledUp = (bundled.MIGRATIONS[0] as Migration).up.toString();
        if (minify) expect(bundledUp).not.toBe(sourceUp);
        expect(bundled.MIGRATIONS.map((m) => bundled.migrationChecksum(m))).toEqual(
          MIGRATIONS.map((m) => migrationChecksum(m)),
        );
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe('migration list validation', () => {
  const invalid = (migrations: unknown[]) => () =>
    validateMigrations(migrations as readonly Migration[]);

  it('accepts the shipped list', () => {
    expect(() => validateMigrations(MIGRATIONS)).not.toThrow();
  });

  it('refuses a missing or malformed fingerprint', () => {
    const { fingerprint: _omitted, ...withoutFingerprint } = base;
    expect(invalid([withoutFingerprint])).toThrow(/fingerprint/);
    for (const fingerprint of ['', ' padded', 'padded ', 'ٱ-not-ascii', 'x'.repeat(201), 7]) {
      expect(invalid([{ ...base, fingerprint }])).toThrow(MigrationError);
    }
  });

  it('refuses a missing or invalid revision', () => {
    const { revision: _omitted, ...withoutRevision } = base;
    expect(invalid([withoutRevision])).toThrow(/revision/);
    for (const revision of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
      expect(invalid([{ ...base, revision }])).toThrow(/revision/);
    }
  });

  it('refuses a duplicate identifier', () => {
    expect(invalid([base, { ...base, fingerprint: 'noop:again' }])).toThrow(
      /Duplicate migration id/,
    );
    let caught: unknown;
    try {
      invalid([base, base])();
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: 'MIGRATION_INVALID' });
  });

  it('keeps ordering and identifier rules', () => {
    expect(
      invalid([
        { ...base, id: '0002-b' },
        { ...base, id: '0001-a' },
      ]),
    ).toThrow(/out of order/);
    expect(invalid([{ ...base, id: 'first' }])).toThrow(/Bad migration id/);
  });

  it('refuses a missing description, function or transactional flag', () => {
    expect(invalid([{ ...base, description: ' ' }])).toThrow(/description/);
    expect(invalid([{ ...base, up: 'not a function' }])).toThrow(/up function/);
    expect(invalid([{ ...base, transactional: undefined }])).toThrow(/transactional/);
  });
});

describe('schema health for readiness', () => {
  const status = (overrides: Partial<MigrationStatus>): MigrationStatus => ({
    databaseVersion: '0001-a',
    codeVersion: '0001-a',
    applied: ['0001-a'],
    pending: [],
    changed: [],
    unknown: [],
    ...overrides,
  });

  it('is current only when nothing is pending, changed or unknown', () => {
    expect(schemaHealth(status({}))).toEqual({ status: 'current' });
    expect(schemaHealth(status({ pending: ['0002-b'] }))).toEqual({ status: 'pending' });
    expect(schemaHealth(status({ changed: ['0001-a'] }))).toEqual({ status: 'mismatch' });
    expect(schemaHealth(status({ unknown: ['0002-b'] }))).toEqual({ status: 'mismatch' });
    expect(schemaHealth(status({ pending: ['0002-b'], changed: ['0001-a'] }))).toEqual({
      status: 'mismatch',
    });
  });
});
