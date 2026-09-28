/**
 * Production build for a Node application (PLAT-021).
 *
 * Bundles the app and the internal @alola/* workspace packages (which ship TypeScript source) into one
 * ESM file. Third-party dependencies stay external and are installed normally, so native modules and
 * license files are untouched.
 *
 * Usage: node ../../scripts/build-node-app.mjs <entry> <outfile>
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [entry, outfile] = process.argv.slice(2);
if (!entry || !outfile) {
  console.error('Usage: build-node-app.mjs <entry> <outfile>');
  process.exit(1);
}

/**
 * Build metadata compiled into the bundle (OPS-006): the app version, the commit and whether the tree
 * had uncommitted changes. Read by `buildInfo()` in @alola/config. No secret is ever part of it.
 */
function gitOutput(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}
const commit = gitOutput(['rev-parse', '--short', 'HEAD']) || 'unknown';
const dirty = gitOutput(['status', '--porcelain']) !== '';
const buildInfo = {
  version: JSON.parse(readFileSync('package.json', 'utf8')).version,
  commit: dirty ? `${commit}+dirty` : commit,
  builtAt: new Date().toISOString(),
};

/** @type {import('esbuild').Plugin} */
const externalizeThirdParty = {
  name: 'externalize-third-party',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.kind === 'entry-point' || args.path.startsWith('@alola/')) return undefined;
      return { path: args.path, external: true };
    });
  },
};

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  legalComments: 'linked',
  plugins: [externalizeThirdParty],
  define: { __ALOLA_BUILD__: JSON.stringify(buildInfo) },
  logLevel: 'info',
});
