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

const [entry, outfile] = process.argv.slice(2);
if (!entry || !outfile) {
  console.error('Usage: build-node-app.mjs <entry> <outfile>');
  process.exit(1);
}

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
  logLevel: 'info',
});
