import { defineConfig, devices } from '@playwright/test'

/**
 * T-054: Playwright E2E configuration
 *
 * Auth state is pre-saved by auth.setup.ts for three demo roles so tests
 * don't repeat login on every run. Each role has a separate storageState file.
 *
 * Required env vars (copy from apps/web/.env.local):
 *   BASE_URL                — default: http://localhost:3000
 *   E2E_USER_EMAIL          — owner role (default: demo.owner@wmeng.co.za)
 *   E2E_USER_PASSWORD       — all accounts share Demo@esite2025!
 *   E2E_FIELD_EMAIL         — default: demo.field@wmeng.co.za
 *   E2E_FIELD_PASSWORD      — default: Demo@esite2025!
 *   E2E_CLIENT_EMAIL        — default: demo.client@wmeng.co.za
 *   E2E_CLIENT_PASSWORD     — default: Demo@esite2025!
 *
 * Run:  pnpm --filter web test:e2e
 * UI:   pnpm --filter web test:e2e:ui
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
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
    // Auth setup runs first — saves auth state for all three roles
    { name: 'setup', testMatch: /auth\.setup\.ts/ },

    // Owner / admin role — most test specs run under this role
    {
      name: 'chromium-owner',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/auth.json',
      },
      testMatch: /0[1-6].*\.spec\.ts/,
      dependencies: ['setup'],
    },

    // Field worker role
    {
      name: 'chromium-field',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/auth-field.json',
      },
      testMatch: /07-field\.spec\.ts/,
      dependencies: ['setup'],
    },

    // Client viewer role — RBAC restrictions
    {
      name: 'chromium-client',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/auth-client.json',
      },
      testMatch: /08-rbac\.spec\.ts/,
      dependencies: ['setup'],
    },

    // Unauthenticated — redirect tests
    {
      name: 'chromium-unauth',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /00-auth-guard\.spec\.ts/,
    },
  ],
  webServer: process.env.CI ? undefined : {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
