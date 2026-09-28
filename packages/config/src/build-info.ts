import type { BuildInfo } from '@alola/contracts';

/**
 * Which build is running (OPS-006). A production bundle has the values compiled in by
 * `scripts/build-node-app.mjs`; a process run from source reports itself as a development build.
 */
declare const __ALOLA_BUILD__: BuildInfo | undefined;

export function buildInfo(): BuildInfo {
  return typeof __ALOLA_BUILD__ !== 'undefined'
    ? __ALOLA_BUILD__
    : { version: 'development', commit: 'working-tree', builtAt: 'not-built' };
}
