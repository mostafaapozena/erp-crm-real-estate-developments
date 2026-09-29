import { preloadCharts } from '../charts';
import { preloadPages } from '../routes';

/**
 * Test stability for screens that load code lazily.
 *
 * The first test that renders a lazily loaded page or a chart pays for compiling and importing that
 * chunk (recharts alone is most of a second on an idle machine). Timed inside a test, that one-off
 * cost ran into vitest's 5 s per-test limit whenever the machine was busy, although the behaviour under
 * test was fine. `warmLazyModules` pays it once, in `beforeAll`, under its own budget, so every test
 * times only rendering and behaviour.
 */
export async function warmLazyModules(): Promise<void> {
  await Promise.all([preloadPages(), preloadCharts()]);
}

/** The compile-and-import budget for the warm-up hook only; no assertion runs under it. */
export const WARM_UP_BUDGET_MS = 60_000;

/**
 * How long a test waits for the first render of the shell. Deliberately **below** vitest's 5 s
 * per-test limit: a lookup that waits longer than the test may run never reports what it was
 * looking for, only that the test ran out of time.
 */
export const FIRST_RENDER = { timeout: 4_000 } as const;
