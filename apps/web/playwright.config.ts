import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (TEST-003) against the **production build of the web application talking to the
 * real API, the real MongoDB and the real Redis**. Nothing is mocked and no route is stubbed.
 *
 * Two servers are started, in order: the API on 4000, then the preview server on 4173, which proxies
 * `/api` to it. One origin serves both, because the session cookie is `SameSite=Strict` and would
 * never come back across two.
 *
 * **These tests need the demonstration data.** Run, once:
 *
 *   npm run dev:services:up
 *   npm run seed:demo
 *
 * The suite signs in as the seeded accounts, reading their generated passwords from the ignored
 * `.demo-credentials.md`. That is deliberate — it exercises the same sign-in every person uses, with
 * a password this repository has never seen, rather than a test-only back door into the session.
 *
 * Tests run serially. They sign in and navigate real data; running them in parallel against one
 * database would make the suite depend on scheduling, and a flaky gate is worse than a slow one.
 *
 * **The suite changes no business record.** It reads, and it signs in and out — so it adds sessions
 * and audit events, and nothing else. In particular it never decides the demonstration's pending
 * discount approval, which is left undecided on purpose for the live walkthrough.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173',
    colorScheme: 'light',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      // The built API, not a development server: the point is to test what would be deployed.
      command: 'npm run build -w @alola/api && node apps/api/dist/main.js',
      cwd: '../../',
      url: 'http://localhost:4000/health/live',
      // One address signs in about a hundred times per run and loads every screen: budgets sized for
      // an office would make two runs within fifteen minutes fail. Test configuration only — the
      // configuration loader refuses a raised sign-in budget in staging and production.
      env: { AUTH_LOGIN_IP_MAX_ATTEMPTS: '2000', RATE_LIMIT_MAX_REQUESTS: '5000' },
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: 'npm run build && npm run preview',
      url: 'http://localhost:4173',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
