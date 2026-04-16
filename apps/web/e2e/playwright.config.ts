import { defineConfig, devices } from '@playwright/test'

/**
 * T-054: Playwright E2E configuration
 * Spec: flows through signup → onboarding → project → COC → snag → marketplace order
 *
 * Required env vars:
 *   BASE_URL          — e.g. http://localhost:3000
 *   E2E_USER_EMAIL    — test user email (must already exist)
 *   E2E_USER_PASSWORD — test user password
 *   E2E_ORG_ID        — existing org ID for the test user
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,   // Auth state is shared; run sequentially
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'html',
  timeout: 30_000,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.CI ? undefined : {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
