/**
 * Auth guard E2E — unauthenticated access redirects to /login.
 * Runs without storageState (no auth cookie).
 */
import { test, expect } from '@playwright/test'

const PROTECTED_ROUTES = [
  '/dashboard',
  '/projects',
  '/snags',
  '/compliance',
  '/rfis',
  '/diary',
  '/procurement',
  '/marketplace',
  '/health',
  '/settings/profile',
  '/settings/organisation',
]

for (const route of PROTECTED_ROUTES) {
  test(`unauthenticated ${route} → redirects to /login`, async ({ page }) => {
    await page.goto(route)
    await page.waitForURL(/\/login/, { timeout: 10_000 })
    await expect(page).toHaveURL(/\/login/)
  })
}

test('login page renders sign-in form', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await expect(page.getByRole('button', { name: /Sign In/i })).toBeVisible()
})

test('invalid credentials shows error', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('nobody@nowhere.co.za')
  await page.getByLabel('Password').fill('wrong-password')
  await page.getByRole('button', { name: /Sign In/i }).click()
  // Should stay on login and show an error
  await expect(page).toHaveURL(/\/login/)
  await expect(page.locator('body')).toContainText(/invalid|error|incorrect/i)
})

test('legal pages are publicly accessible without auth', async ({ page }) => {
  for (const route of ['/privacy', '/terms', '/acceptable-use', '/cookies']) {
    await page.goto(route)
    // Should NOT redirect to login
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('body')).not.toContainText('Sign In')
  }
})
