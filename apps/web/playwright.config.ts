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
 * Tests run serially. They sign in, navigate real data, and one of them approves a real pending
 * approval request; running those in parallel against one database would make the suite depend on
 * scheduling, and a flaky gate is worse than a slow one.
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
