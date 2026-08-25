import { defineConfig, devices } from '@playwright/test';

/**
 * Two projects, two audiences, and they do not run the same tests.
 *
 * The agency surface is a desktop tool used all day by someone who is paid to
 * be there. The client surface is a link opened once on a phone by someone who
 * is not motivated, and it is the acquisition surface. Running both suites
 * against both devices would double the runtime and prove nothing — the split
 * is by directory so that a test cannot accidentally be written for the wrong
 * audience.
 *
 * `tests/e2e/client/**` must never touch an agency route. That claim is asserted
 * inside the tests themselves, at the request level, not inferred from the fact
 * that the flow completed.
 */
export default defineConfig({
  testDir: './tests/e2e',
  /**
   * Serial, deliberately.
   *
   * `POST /api/test/seed` TRUNCATEs every content table and reseeds fixed uuids.
   * Two specs running at once therefore destroy each other's rows mid-flight —
   * which surfaces as `VALIDATION_FAILED · 400, that code is not valid or has
   * expired` on a code that was valid when it was read, i.e. as flake rather
   * than as the shared-database collision it is. Flake gets "fixed" with
   * retries, and retries hide it for good.
   *
   * One database, one writer. If this suite ever needs to be faster, the fix is
   * a database per worker, not more workers against one.
   */
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // One worker in CI: the suite shares one Postgres and the plan-gate and
  // archive tests both assert on counts that a parallel run would move.
  workers: 1,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['junit', { outputFile: 'playwright-report/junit.xml' }]]
    : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    // Traces are the artifact CI uploads on failure. `on-first-retry` keeps the
    // green path cheap and still captures every flake.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'agency',
      testMatch: /agency\/.*\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // The client board is the acquisition surface and the client is on a phone.
      name: 'client-mobile',
      testMatch: /client\/.*\.spec\.ts$/,
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
