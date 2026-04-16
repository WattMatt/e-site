/**
 * Auth setup — signs in once and saves auth state for all E2E tests.
 * Other tests use storageState: 'e2e/auth.json' to skip login.
 */
import { test as setup, expect } from '@playwright/test'
import path from 'path'

const AUTH_FILE = path.join(__dirname, '../auth.json')

setup('authenticate as test user', async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL
  const password = process.env.E2E_USER_PASSWORD

  if (!email || !password) {
    console.warn('E2E_USER_EMAIL / E2E_USER_PASSWORD not set — skipping auth setup')
    return
  }

  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign In' }).click()

  // Wait for redirect to dashboard
  await page.waitForURL('**/dashboard', { timeout: 10_000 })
  await expect(page).toHaveURL(/dashboard/)

  await page.context().storageState({ path: AUTH_FILE })
})
